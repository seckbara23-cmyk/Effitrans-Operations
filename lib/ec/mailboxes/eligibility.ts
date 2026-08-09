/**
 * EMP-4A / EMP-5E — which mailboxes a user is ELIGIBLE for. PURE.
 *
 * Eligibility is a SUGGESTION and never a grant. The onboarding flow proposes;
 * an administrator confirms. That separation is deliberate: "the system added
 * it" is not an answer to "who gave this person access to that mailbox?", and
 * membership rows carry a named grantor precisely so the question always has
 * one.
 *
 * Departments are DERIVED from roles (Phase 9.0A) — there is no department
 * column on a user — so eligibility keys off the role-derived department, not a
 * stored field.
 *
 * EMP-5E RENAMED THE VOCABULARY, AND THAT IS THE POINT OF THE PHASE.
 * ------------------------------------------------------------------
 * These six values used to be called SHARED_MAILBOX_PURPOSES and were compared
 * against `ec_mailbox.purpose` by string equality — a column EC-1 designed as
 * free tenant vocabulary with `default 'GENERAL'`. Whether a mailbox was ever
 * offered to anyone therefore depended on its SPELLING: `Operations` or a
 * trailing space made it invisible while it looked perfectly healthy.
 *
 * They now name the controlled key `ec_mailbox.department_eligibility`
 * (migration 20260818000001), and `purpose` goes back to being what EC-1 wrote
 * it to be: a label. A type called `SharedMailboxPurpose` used to decide
 * eligibility would keep the confusion alive in the code that fixed it.
 */
import { ROLE_CANONICAL_DEPARTMENT } from "@/lib/organization/departments";

/** The controlled department-eligibility vocabulary. Mirrors the CHECK on
 *  `ec_mailbox.department_eligibility` — the database rejects anything else. */
export const DEPARTMENT_ELIGIBILITY_VALUES = [
  "OPERATIONS", "TRANSIT", "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT",
] as const;
export type DepartmentEligibility = (typeof DEPARTMENT_ELIGIBILITY_VALUES)[number];

/**
 * Canonical department → the eligibility buckets someone in it typically needs.
 *
 * SUPPORT is in every list because every department answers customers, and
 * COMMERCIAL is deliberately NOT implied by OPERATIONS: quoting is a distinct
 * authority (the EC-3 lesson), and a coordinator who should see commercial mail
 * is an explicit decision rather than a side effect of their department.
 *
 * THE SINGLE SOURCE. Nothing else — no column, no migration, no UI list —
 * decides which department implies which bucket.
 */
const DEPARTMENT_MAILBOXES: Record<string, readonly DepartmentEligibility[]> = {
  OPERATIONS: ["OPERATIONS", "SUPPORT"],
  TRANSIT: ["TRANSIT", "CUSTOMS", "SUPPORT"],
  FINANCE: ["FINANCE", "SUPPORT"],
  HUMAN_RESOURCES: ["SUPPORT"],
};

export type EligibleMailbox = {
  eligibility: DepartmentEligibility;
  /** Why it is proposed — shown to the administrator, never inferred silently. */
  reason: string;
};

/** Is this a value the eligibility key may hold? NULL is handled separately —
 *  it is valid, and it means "not a departmental mailbox". */
export function isDepartmentEligibility(v: unknown): v is DepartmentEligibility {
  return typeof v === "string"
    && (DEPARTMENT_ELIGIBILITY_VALUES as readonly string[]).includes(v);
}

/**
 * May a mailbox of this type carry a department eligibility at all?
 *
 * PERSONAL cannot. A personal mailbox belongs primarily to one natural person;
 * proposing it to a whole department would be proposing access to someone's
 * mail because of where they work. SHARED and FUNCTIONAL both may — a
 * functional address (`support@`, `devis@`) is exactly the kind a department
 * legitimately staffs.
 */
export function canHoldDepartmentEligibility(mailboxType: string): boolean {
  return mailboxType !== "PERSONAL";
}

/**
 * Propose eligibility buckets for a set of roles.
 *
 * A role with no canonical department (SYSTEM_ADMIN, CEO, MAIL_ADMIN,
 * COMPLIANCE_HSSE, external identities) proposes NOTHING. That is not an
 * oversight: those roles are cross-cutting or external, and guessing a
 * department for them would be inventing one.
 */
export function eligibleMailboxes(roleCodes: readonly string[]): EligibleMailbox[] {
  const out = new Map<DepartmentEligibility, string>();

  // Roles are sorted so the recorded REASON is deterministic too, not just the
  // list of buckets: two administrators looking at the same user must see the
  // same justification, whatever order the roles happened to arrive in.
  for (const role of [...roleCodes].sort()) {
    const dept = ROLE_CANONICAL_DEPARTMENT[role];
    if (!dept) continue;
    for (const bucket of DEPARTMENT_MAILBOXES[dept] ?? []) {
      if (!out.has(bucket)) out.set(bucket, `Département ${dept} (rôle ${role})`);
    }
  }

  // Stable order, so the same roles always propose the same list in the same
  // sequence — an administrator reviewing two users should not have to re-read.
  return DEPARTMENT_ELIGIBILITY_VALUES.filter((p) => out.has(p)).map((eligibility) => ({
    eligibility,
    reason: out.get(eligibility) as string,
  }));
}

/** A personal mailbox address suggestion. Never applied automatically. */
export function suggestPersonalAddress(
  name: string | null,
  email: string,
  domain: string | null,
): string | null {
  // Without a configured domain there is nothing to suggest, and inventing one
  // would produce an address that can never receive mail. No domain
  // provisioning exists (RATIFY-EMP-4), so this is usually null today.
  if (!domain) return null;

  const local = (name ?? email.split("@")[0] ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip accents
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!local) return null;
  return `${local}@${domain}`;
}
