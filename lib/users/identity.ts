/**
 * THE canonical professional identity of a staff member. PURE, client-safe.
 * ---------------------------------------------------------------------------
 * ADMIN-USER-IDENTITY-01 / DBC-STAFF-IDENTITY-01, ratified 2026-09-07.
 *
 * ── WHAT THE AUDIT FOUND, BECAUSE IT DECIDED THE SHAPE OF THIS FILE ─────────
 * Three tables could have claimed this, and only one of them should:
 *
 *   `app_user`           the LOGIN. `id` (= the auth identity), `email`,
 *                        `status`, `is_system_admin`, the password lifecycle —
 *                        and `name`, one free-text string, populated on 58 of
 *                        60 rows. No first/last anywhere.
 *   `workforce_profile`  the STAFF PROFESSIONAL PROFILE. Keyed `user_id`,
 *                        carries `job_title` (populated on 30 of 32 rows with
 *                        real Effitrans titles), phones, photo, signature
 *                        variant, card token. It already feeds the Digital
 *                        Business Card, the e-mail signature and generated
 *                        documents.
 *   `employee`           HR's REGISTRY. `first_name`, `last_name`,
 *                        `department`, its own `job_title`, an employee number
 *                        and a hire/termination lifecycle — three rows, two of
 *                        them linked to a login, and both of those disagree
 *                        with `app_user.name` ("Joe Doe" vs "Finance Demo").
 *
 * So `workforce_profile` is extended rather than a fourth authority created: it
 * is already keyed by the user, already holds the title, and already feeds
 * every branding surface. `employee` stays HR's — a person who is employed is
 * not the same object as a person who can log in, and reconciling the two is a
 * business decision nobody has taken (RQ-ID-1).
 *
 * ── DISPLAY NAME: DERIVED, WITH A DETERMINISTIC FALLBACK ────────────────────
 *
 *      first_name + last_name        canonical, when both are recorded
 *              ↓  written to
 *      app_user.name                 the display name every surface already
 *                                    reads — kept, not replaced, because 204
 *                                    foreign keys and every selector, card,
 *                                    signature and assignee label resolve
 *                                    through it
 *              ↓  falls back to
 *      email                         the final fallback the architecture
 *                                    already requires
 *
 * A legacy user with a `name` and no first/last keeps that name verbatim. It is
 * NOT split on whitespace: "Cheikh Ahmadou Bamba SECK" has no safe split, and
 * guessing one would silently invent a surname. The vCard exporter guesses
 * because a vCard demands the structure; the platform does not.
 *
 * ── AND THE RULE THAT OUTRANKS EVERY OTHER LINE HERE ────────────────────────
 * NONE OF THIS IS RBAC. Fonction and Titre principal are what a person DOES;
 * roles and permissions are what the platform LETS them do. Setting a title of
 * « Chef de Transit » grants nothing — not the CHIEF_OF_TRANSIT role, not
 * `customs:validate`, not a department authority, not an assignment. Nothing in
 * this module imports the RBAC modules, and a test asserts that.
 */

/** The four ratified editable facts, plus what the platform derives from them. */
export type StaffIdentity = {
  /** Canonical given name. Null on every user who predates the column. */
  firstName: string | null;
  /** Canonical family name. Null likewise. */
  lastName: string | null;
  /** What every surface renders. Derived when possible, legacy otherwise. */
  displayName: string;
  /** « Fonction » — the organisational function. NOT the department, NOT a role. */
  functionLabel: string | null;
  /** « Titre principal » — the professional designation. */
  mainTitle: string | null;
};

/** What an administrator submits. Every field optional: partial edits are the norm. */
export type StaffIdentityInput = {
  firstName?: string | null;
  lastName?: string | null;
  functionLabel?: string | null;
  mainTitle?: string | null;
  /**
   * The legacy single-field name, editable while first/last cannot be stored
   * (migration 20261003000001 unapplied). Never sent together with first/last:
   * the action refuses that rather than guessing which one the admin meant.
   */
  displayName?: string | null;
};

/**
 * Suggestions, NOT a catalogue.
 *
 * The ratified brief lists these, and the live data settles the question of
 * whether to close the set: the 30 titles in production are free-form and
 * inconsistently cased — "DECLARANT EN DOUANE", "declarant en douane",
 * "responsable opération". A rigid catalogue would reject legitimate values on
 * the day it shipped. These are offered as a datalist; anything may be typed.
 */
export const SUGGESTED_FUNCTIONS: readonly string[] = [
  "Opérations",
  "Transit",
  "Douane",
  "Transport",
  "Finance",
  "Facturation",
  "Ressources humaines",
  "Commercial",
  "Direction",
  "Administration",
] as const;

/** Longest value any of these fields may carry. Generous; a guard, not a rule. */
export const IDENTITY_MAX = 120;

export type IdentityFieldError =
  | "first_name_invalid"
  | "last_name_invalid"
  | "function_invalid"
  | "main_title_invalid"
  | "display_name_invalid"
  | "name_conflict"
  | "nothing_to_change";

/**
 * Trim, and treat a whitespace-only value as an explicit CLEARING.
 *
 * `undefined` means « the admin did not touch this field » and must leave the
 * stored value alone — that is §11's « preserve untouched values ». `null` and
 * `""` mean « remove it », which an admin is entitled to do for a function or a
 * title nobody has any more.
 */
export function normalizeField(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t;
}

/** Is this a value the platform will store? Length only — names are not patterned. */
function acceptable(v: string | null): boolean {
  return v === null || v.length <= IDENTITY_MAX;
}

export type IdentityValidation =
  | { ok: true; value: Required<Pick<StaffIdentityInput, never>> & StaffIdentityInput }
  | { ok: false; error: IdentityFieldError };

/**
 * Validate and normalise an administrator's submission.
 *
 * WHAT IS DELIBERATELY NOT VALIDATED: the SHAPE of a human name. Senegalese
 * names carry particles, apostrophes, hyphens and multiple given names, and a
 * pattern that "looks like a name" is a pattern that rejects somebody real.
 * Length is the only bound.
 *
 * WHAT IS REFUSED: clearing BOTH first and last name at once while they are the
 * source of the display name — that would leave the person renderable only by
 * e-mail, which is a regression an admin almost certainly did not intend. And
 * sending `displayName` together with first/last, because the platform would
 * then have two answers and no rule for choosing.
 */
export function validateIdentity(input: StaffIdentityInput): IdentityValidation {
  const firstName = normalizeField(input.firstName);
  const lastName = normalizeField(input.lastName);
  const functionLabel = normalizeField(input.functionLabel);
  const mainTitle = normalizeField(input.mainTitle);
  const displayName = normalizeField(input.displayName);

  if (!acceptable(firstName ?? null)) return { ok: false, error: "first_name_invalid" };
  if (!acceptable(lastName ?? null)) return { ok: false, error: "last_name_invalid" };
  if (!acceptable(functionLabel ?? null)) return { ok: false, error: "function_invalid" };
  if (!acceptable(mainTitle ?? null)) return { ok: false, error: "main_title_invalid" };
  if (!acceptable(displayName ?? null)) return { ok: false, error: "display_name_invalid" };

  if (displayName !== undefined && (firstName !== undefined || lastName !== undefined)) {
    return { ok: false, error: "name_conflict" };
  }
  if (displayName === null) return { ok: false, error: "display_name_invalid" };

  const touched =
    firstName !== undefined || lastName !== undefined
    || functionLabel !== undefined || mainTitle !== undefined
    || displayName !== undefined;
  if (!touched) return { ok: false, error: "nothing_to_change" };

  return { ok: true, value: { firstName, lastName, functionLabel, mainTitle, displayName } };
}

/**
 * The display name, from whatever the platform actually knows.
 *
 * ORDER IS THE CONTRACT, and §13 asks for it to be deterministic:
 *   1. first + last, when both are recorded
 *   2. either one alone, when only one is
 *   3. the stored legacy `app_user.name`
 *   4. the e-mail — the final fallback the architecture already uses
 *
 * A title is NEVER part of it, and a ROLE is never part of it: « Chef de
 * Transit » is not a name, and inferring one from RBAC is exactly what §13
 * forbids.
 */
export function displayNameFrom(input: {
  firstName?: string | null;
  lastName?: string | null;
  legacyName?: string | null;
  email: string;
}): string {
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  const composed = [first, last].filter((p) => p.length > 0).join(" ");
  if (composed.length > 0) return composed;
  const legacy = (input.legacyName ?? "").trim();
  if (legacy.length > 0) return legacy;
  return input.email;
}

/** The identity a surface renders, assembled from the two stores. */
export function buildStaffIdentity(input: {
  firstName?: string | null;
  lastName?: string | null;
  legacyName?: string | null;
  email: string;
  functionLabel?: string | null;
  mainTitle?: string | null;
}): StaffIdentity {
  return {
    firstName: normalizeField(input.firstName) ?? null,
    lastName: normalizeField(input.lastName) ?? null,
    displayName: displayNameFrom(input),
    functionLabel: normalizeField(input.functionLabel) ?? null,
    // NEVER derived from a role. An absent title is absent, and « Chef de
    // Transit » must be something a person was given, not something the
    // platform inferred from a permission set.
    mainTitle: normalizeField(input.mainTitle) ?? null,
  };
}
