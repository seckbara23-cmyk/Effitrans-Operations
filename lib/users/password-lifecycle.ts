/**
 * Staff password lifecycle — PURE. No I/O, no clock, no imports. Client-safe.
 * ---------------------------------------------------------------------------
 * The rules governing a temporary password: how long it lives, when the login
 * gate must intervene, why it was issued, and how the state reads to an
 * administrator. Every one of them is a decision that must be identical on the
 * server (which enforces) and in the UI (which explains), so all of them live
 * here and both sides call the same function.
 *
 * `now` is always a parameter. Nothing in this file reads the clock, so every
 * boundary — expiry to the millisecond — is directly testable.
 */

// ---------------------------------------------------------------------------
// Why a temporary password was issued
// ---------------------------------------------------------------------------
/**
 * A CLOSED vocabulary, ratified 2026-07-29. Free text alone would produce an
 * audit trail nobody can aggregate ("forgot", "fgt pwd", "user called"); a
 * closed list makes "how often are we resetting for lost credentials?" a
 * question the audit log can actually answer. OTHER exists so the list never
 * forces a false reason, and it is the one value that REQUIRES a note.
 */
export const TEMP_PASSWORD_REASONS = [
  "FORGOT_PASSWORD",
  "LOCKED_ACCOUNT",
  "NEW_WORKSTATION",
  "OTHER",
] as const;

export type TempPasswordReason = (typeof TEMP_PASSWORD_REASONS)[number];

export const TEMP_PASSWORD_REASON_LABEL_FR: Record<TempPasswordReason, string> = {
  FORGOT_PASSWORD: "Mot de passe oublié",
  LOCKED_ACCOUNT: "Compte verrouillé",
  NEW_WORKSTATION: "Nouveau poste de travail",
  OTHER: "Autre motif",
};

/** Max length of the free-text note. Long enough to be useful, bounded so it cannot be abused as a data sink. */
export const TEMP_PASSWORD_NOTE_MAX = 280;

export type ReasonError = "reason_required" | "reason_invalid" | "reason_note_required" | "reason_note_too_long";

/**
 * Validate the administrator's stated reason. Returns null when acceptable.
 *
 * OTHER without a note is refused: "Autre" alone records that a reset happened
 * for a reason the administrator declined to give, which is worse than no
 * vocabulary at all because it looks like an answer.
 */
export function validateTempPasswordReason(input: {
  reason?: string | null;
  note?: string | null;
}): ReasonError | null {
  const reason = (input.reason ?? "").trim();
  if (!reason) return "reason_required";
  if (!(TEMP_PASSWORD_REASONS as readonly string[]).includes(reason)) return "reason_invalid";

  const note = (input.note ?? "").trim();
  if (reason === "OTHER" && note.length === 0) return "reason_note_required";
  if (note.length > TEMP_PASSWORD_NOTE_MAX) return "reason_note_too_long";
  return null;
}

/** The audit-ready reason string: the code, plus the note when one was given. */
export function formatTempPasswordReason(reason: TempPasswordReason, note?: string | null): string {
  const trimmed = (note ?? "").trim();
  return trimmed ? `${reason}: ${trimmed}` : reason;
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------
export const DEFAULT_TEMP_PASSWORD_TTL_HOURS = 24;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 24 * 14; // two weeks — beyond this it is not "temporary"

/**
 * Configured lifetime in hours, from the raw env value.
 *
 * Anything unparseable, non-positive or absurd falls back to the 24-hour
 * default rather than throwing: a typo in an environment variable must not take
 * down authentication, and it must never silently produce a temporary password
 * that lives for a year.
 */
export function tempPasswordTtlHours(raw?: string | null): number {
  const n = Number((raw ?? "").trim());
  if (!Number.isFinite(n)) return DEFAULT_TEMP_PASSWORD_TTL_HOURS;
  const whole = Math.floor(n);
  if (whole < MIN_TTL_HOURS || whole > MAX_TTL_HOURS) return DEFAULT_TEMP_PASSWORD_TTL_HOURS;
  return whole;
}

/** ISO expiry instant for a temporary password issued at `now`. */
export function tempPasswordExpiry(now: Date, ttlHours: number): string {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

/** True once `expiresAt` has passed. A null expiry never expires (none outstanding). */
export function isTempPasswordExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false; // an unreadable value must not lock anyone out
  return t <= now.getTime();
}

// ---------------------------------------------------------------------------
// The login gate
// ---------------------------------------------------------------------------
/**
 *   ok            let the request through
 *   must_change   route to the forced-change screen before anything renders
 *   temp_expired  the temporary password is past its lifetime; deny the app and
 *                 tell them to ask for a new one. It is never auto-renewed —
 *                 renewal is an audited administrative act, by design.
 */
export type PasswordGateState = "ok" | "must_change" | "temp_expired";

export function evaluatePasswordGate(input: {
  mustChangePassword?: boolean | null;
  tempPasswordExpiresAt?: string | null;
  now: Date;
}): PasswordGateState {
  const expired = isTempPasswordExpired(input.tempPasswordExpiresAt, input.now);
  // Expiry is checked FIRST: an expired temporary password must not be
  // exchangeable for a permanent one through the change screen. The credential
  // is dead, and the only way forward is a new administrative issue.
  if (expired) return "temp_expired";
  if (input.mustChangePassword === true) return "must_change";
  return "ok";
}

// ---------------------------------------------------------------------------
// How the state reads in the admin directory
// ---------------------------------------------------------------------------
/**
 *   unknown     no recorded change — the platform genuinely does not know.
 *               Every user predating the lifecycle columns is here, and saying
 *               so is more useful than a manufactured date.
 *   set         the user has changed their password since it started recording.
 *   temporary   an administrator issued a temporary password; not yet changed.
 *   expired     that temporary password ran out. The user cannot sign in.
 */
export type PasswordStatus = "unknown" | "set" | "temporary" | "expired";

export function passwordStatus(input: {
  passwordChangedAt?: string | null;
  mustChangePassword?: boolean | null;
  tempPasswordExpiresAt?: string | null;
  now: Date;
}): PasswordStatus {
  if (input.mustChangePassword === true) {
    return isTempPasswordExpired(input.tempPasswordExpiresAt, input.now) ? "expired" : "temporary";
  }
  return input.passwordChangedAt ? "set" : "unknown";
}

export const PASSWORD_STATUS_LABEL_FR: Record<PasswordStatus, string> = {
  unknown: "Inconnu — aucune modification enregistrée",
  set: "Défini par l'utilisateur",
  temporary: "Mot de passe temporaire en attente de changement",
  expired: "Mot de passe temporaire expiré — en générer un nouveau",
};
