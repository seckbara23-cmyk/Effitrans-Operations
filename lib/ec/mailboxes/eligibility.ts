/**
 * EMP-4A — which shared mailboxes a user is ELIGIBLE for. PURE.
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
 */
import { ROLE_CANONICAL_DEPARTMENT } from "@/lib/organization/departments";

/** The shared mailbox purposes EMP-4A recognises, per the ratified list. */
export const SHARED_MAILBOX_PURPOSES = [
  "OPERATIONS", "TRANSIT", "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT",
] as const;
export type SharedMailboxPurpose = (typeof SHARED_MAILBOX_PURPOSES)[number];

/**
 * Canonical department → the mailbox purposes someone in it typically needs.
 *
 * SUPPORT is in every list because every department answers customers, and
 * COMMERCIAL is deliberately NOT implied by OPERATIONS: quoting is a distinct
 * authority (the EC-3 lesson), and a coordinator who should see commercial mail
 * is an explicit decision rather than a side effect of their department.
 */
const DEPARTMENT_MAILBOXES: Record<string, readonly SharedMailboxPurpose[]> = {
  OPERATIONS: ["OPERATIONS", "SUPPORT"],
  TRANSIT: ["TRANSIT", "CUSTOMS", "SUPPORT"],
  FINANCE: ["FINANCE", "SUPPORT"],
  HUMAN_RESOURCES: ["SUPPORT"],
};

export type EligibleMailbox = {
  purpose: SharedMailboxPurpose;
  /** Why it is proposed — shown to the administrator, never inferred silently. */
  reason: string;
};

/**
 * Propose shared mailbox purposes for a set of roles.
 *
 * A role with no canonical department (SYSTEM_ADMIN, CEO, MAIL_ADMIN,
 * COMPLIANCE_HSSE, external identities) proposes NOTHING. That is not an
 * oversight: those roles are cross-cutting or external, and guessing a
 * department for them would be inventing one.
 */
export function eligibleMailboxes(roleCodes: readonly string[]): EligibleMailbox[] {
  const out = new Map<SharedMailboxPurpose, string>();

  // Roles are sorted so the recorded REASON is deterministic too, not just the
  // list of purposes: two administrators looking at the same user must see the
  // same justification, whatever order the roles happened to arrive in.
  for (const role of [...roleCodes].sort()) {
    const dept = ROLE_CANONICAL_DEPARTMENT[role];
    if (!dept) continue;
    for (const purpose of DEPARTMENT_MAILBOXES[dept] ?? []) {
      if (!out.has(purpose)) out.set(purpose, `Département ${dept} (rôle ${role})`);
    }
  }

  // Stable order, so the same roles always propose the same list in the same
  // sequence — an administrator reviewing two users should not have to re-read.
  return SHARED_MAILBOX_PURPOSES.filter((p) => out.has(p)).map((purpose) => ({
    purpose,
    reason: out.get(purpose) as string,
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
