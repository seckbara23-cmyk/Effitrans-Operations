/**
 * EMP-4A — bulk mailbox assignment. The CLASSIFIER is pure.
 *
 * The whole point of this module is that an administrator sees exactly what
 * will change BEFORE anything changes. So the decision — what happens to each
 * user — is a pure function of data already read, and the executor does nothing
 * the preview did not predict.
 *
 * Every user lands in exactly one outcome. There is no "other": a user the
 * classifier cannot place would be a user whose fate the preview does not show,
 * which is the failure this design exists to prevent.
 */
import {
  eligibleMailboxes, canHoldDepartmentEligibility, type DepartmentEligibility,
} from "./eligibility";
import { ROLE_CANONICAL_DEPARTMENT } from "@/lib/organization/departments";

export type BulkCapabilities = {
  canRead: boolean;
  canSend: boolean;
  canManageMembers: boolean;
  isDefaultSender: boolean;
};

/** One candidate, as the classifier needs them. */
export type BulkCandidate = {
  userId: string;
  name: string | null;
  email: string;
  tenantId: string;
  roleCodes: string[];
  /** Their existing membership on the TARGET mailbox, if any. */
  existing: {
    id: string;
    canRead: boolean;
    canSend: boolean;
    canManageMembers: boolean;
    isDefaultSender: boolean;
    revokedAt: string | null;
  } | null;
  /** True when this user already has a default sender on ANOTHER mailbox. */
  hasOtherDefaultSender: boolean;
};

export type BulkOutcome =
  | "GRANT_NEW"          // no membership -> one will be created
  | "REACTIVATE"         // revoked membership -> the SAME row is restored
  | "UPDATE"             // active membership whose capabilities differ
  | "UNCHANGED"          // active membership already matching
  | "SKIPPED_NO_DEPARTMENT"  // no role maps to a department
  | "SKIPPED_NOT_ELIGIBLE"   // department does not propose this mailbox
  | "SKIPPED_MAILBOX_NOT_DEPARTMENTAL" // the MAILBOX proposes to nobody
  | "REJECTED_CROSS_TENANT"  // belongs to another tenant
  | "CONFLICT_DEFAULT_SENDER"; // would be a second default sender

export type BulkDecision = {
  userId: string;
  name: string | null;
  email: string;
  outcome: BulkOutcome;
  /** Plain-language reason, shown in the preview. Never a code alone. */
  reason: string;
  /** True when executing this decision writes something. */
  writes: boolean;
};

export const OUTCOME_FR: Record<BulkOutcome, string> = {
  GRANT_NEW: "Nouvelle appartenance",
  REACTIVATE: "Appartenance révoquée réactivée",
  UPDATE: "Capacités modifiées",
  UNCHANGED: "Inchangé",
  SKIPPED_NO_DEPARTMENT: "Ignoré — aucun département dérivé du rôle",
  SKIPPED_NOT_ELIGIBLE: "Ignoré — boîte non proposée pour ce département",
  SKIPPED_MAILBOX_NOT_DEPARTMENTAL: "Ignoré — boîte sans éligibilité départementale",
  REJECTED_CROSS_TENANT: "Refusé — autre tenant",
  CONFLICT_DEFAULT_SENDER: "Conflit — expéditeur par défaut déjà défini ailleurs",
};

function sameCapabilities(
  e: NonNullable<BulkCandidate["existing"]>,
  c: BulkCapabilities,
): boolean {
  return e.canRead === c.canRead
    && e.canSend === c.canSend
    && e.canManageMembers === c.canManageMembers
    && e.isDefaultSender === c.isDefaultSender;
}

/**
 * Decide what would happen to each candidate. PURE — no I/O, no clock.
 *
 * `requireEligibility` reflects how the administrator chose the audience: when
 * they filtered by department, a user outside it is SKIPPED rather than
 * silently granted; when they picked users by hand, their choice stands and
 * eligibility is only advisory.
 *
 * EMP-5E — THE KEY IS `mailboxEligibility`, NOT `purpose`.
 * Until this phase the classifier compared the mailbox's free-text `purpose`
 * against the department vocabulary by string equality, so a mailbox typed
 * `Operations` or `OPERATIONS ` was proposed to nobody while looking healthy.
 * The controlled column decides now, and `purpose` is not an input here at all
 * — which is why its spelling can no longer change who is proposed.
 *
 * NULL eligibility means the mailbox is not departmental. It does NOT mean
 * GENERAL, and it does NOT mean every department: nobody is proposed for it,
 * and it is assigned by hand.
 */
export function previewBulkAssignment(input: {
  tenantId: string;
  /** `ec_mailbox.department_eligibility`. NULL = not a departmental mailbox. */
  mailboxEligibility: DepartmentEligibility | string | null;
  /** `ec_mailbox.mailbox_type`. PERSONAL is never department-proposed. */
  mailboxType: string;
  capabilities: BulkCapabilities;
  candidates: readonly BulkCandidate[];
  requireEligibility: boolean;
}): BulkDecision[] {
  const {
    tenantId, mailboxEligibility, mailboxType,
    capabilities, candidates, requireEligibility,
  } = input;

  // A mailbox-level fact, decided once: it applies to every candidate
  // identically, and saying so is more useful to an administrator than forty
  // rows claiming each individual department is at fault.
  const mailboxProposesNobody = !canHoldDepartmentEligibility(mailboxType)
    ? "Cette boîte est personnelle : elle n'est jamais proposée à un département."
    : !mailboxEligibility
      ? "Cette boîte n'a aucun département éligible : elle s'attribue manuellement."
      : null;

  return candidates.map((u): BulkDecision => {
    const base = { userId: u.userId, name: u.name, email: u.email };

    // Tenant first: nothing else matters if the user is not ours.
    if (u.tenantId !== tenantId) {
      return { ...base, outcome: "REJECTED_CROSS_TENANT", writes: false,
        reason: "Cet utilisateur appartient à un autre tenant." };
    }

    if (requireEligibility && mailboxProposesNobody) {
      return { ...base, outcome: "SKIPPED_MAILBOX_NOT_DEPARTMENTAL", writes: false,
        reason: mailboxProposesNobody };
    }

    const departments = u.roleCodes.map((r) => ROLE_CANONICAL_DEPARTMENT[r]).filter(Boolean);
    if (requireEligibility && departments.length === 0) {
      return { ...base, outcome: "SKIPPED_NO_DEPARTMENT", writes: false,
        reason: "Aucun de ses rôles n'est rattaché à un département." };
    }
    if (requireEligibility) {
      const proposed = eligibleMailboxes(u.roleCodes).map((e) => e.eligibility as string);
      if (!proposed.includes(mailboxEligibility as string)) {
        return { ...base, outcome: "SKIPPED_NOT_ELIGIBLE", writes: false,
          reason: `Son département ne propose pas les boîtes « ${mailboxEligibility} ».` };
      }
    }

    // A second default sender is refused by a unique index, so the preview says
    // so rather than letting execution surface a constraint error.
    if (capabilities.isDefaultSender && u.hasOtherDefaultSender
        && !(u.existing?.isDefaultSender && !u.existing.revokedAt)) {
      return { ...base, outcome: "CONFLICT_DEFAULT_SENDER", writes: false,
        reason: "Cet utilisateur a déjà un expéditeur par défaut sur une autre boîte." };
    }

    if (!u.existing) {
      return { ...base, outcome: "GRANT_NEW", writes: true,
        reason: "Aucune appartenance existante." };
    }
    if (u.existing.revokedAt) {
      return { ...base, outcome: "REACTIVATE", writes: true,
        reason: "Appartenance révoquée : la même ligne sera réactivée, son historique conservé." };
    }
    if (sameCapabilities(u.existing, capabilities)) {
      return { ...base, outcome: "UNCHANGED", writes: false,
        reason: "Les capacités demandées sont déjà en place." };
    }
    return { ...base, outcome: "UPDATE", writes: true,
      reason: "Appartenance existante dont les capacités diffèrent." };
  });
}

/** Counts for the confirmation summary. */
export function summarize(decisions: readonly BulkDecision[]): Record<BulkOutcome, number> {
  const out = Object.fromEntries(
    (Object.keys(OUTCOME_FR) as BulkOutcome[]).map((k) => [k, 0]),
  ) as Record<BulkOutcome, number>;
  for (const d of decisions) out[d.outcome] += 1;
  return out;
}

/** The decisions that actually write — what execution will touch, and only that. */
export function writableDecisions(decisions: readonly BulkDecision[]): BulkDecision[] {
  return decisions.filter((d) => d.writes);
}

/** What the batch was previewed AGAINST, not just what it decided. */
export type PreviewContext = {
  mailboxId: string;
  capabilities: BulkCapabilities;
  requireEligibility: boolean;
  /** EMP-5E — the classification the preview was computed under. */
  mailboxEligibility: string | null;
  mailboxType: string;
};

/**
 * A stable fingerprint of a preview.
 *
 * Execution carries the fingerprint it was shown; if the data moved underneath
 * — someone else granted a membership in the meantime — it no longer matches
 * and the batch is refused rather than performing writes nobody previewed.
 *
 * It binds the CONTEXT as well as the decisions, and that is not decoration.
 * For a user with no existing membership the outcome is `GRANT_NEW` whatever
 * capabilities are requested, so a decisions-only fingerprint would be
 * identical for "grant read to these 40 people" and "grant read, send and
 * member-management to these 40 people". A caller could then confirm the
 * harmless preview while executing the powerful one, and the server would see
 * a matching fingerprint and agree. Binding the mailbox, the capabilities and
 * the eligibility filter is what makes "execution replays exactly this
 * preview" true rather than merely claimed in the UI.
 *
 * EMP-5E binds the mailbox's CLASSIFICATION for the same reason. Usually a
 * changed eligibility also changes the decisions, so the body would move — but
 * not always: an empty candidate list, or a set of users eligible for both the
 * old and the new value, yields byte-identical decisions on a different
 * authorization basis. Reclassifying a mailbox between preview and confirmation
 * must invalidate the preview, so it is bound in the head where it cannot be
 * masked by the decisions.
 */
export function previewFingerprint(
  decisions: readonly BulkDecision[],
  context: PreviewContext,
): string {
  const c = context.capabilities;
  const head = [
    `mailbox=${context.mailboxId}`,
    `caps=${[c.canRead, c.canSend, c.canManageMembers, c.isDefaultSender].map(Number).join("")}`,
    `eligibility=${context.requireEligibility ? 1 : 0}`,
    `dept=${context.mailboxEligibility ?? "-"}`,
    `type=${context.mailboxType}`,
  ].join(";");

  const body = decisions
    .map((d) => `${d.userId}:${d.outcome}`)
    .sort()
    .join("|");

  return `${head}#${body}`;
}
