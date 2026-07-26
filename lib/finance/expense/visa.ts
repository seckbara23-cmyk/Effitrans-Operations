/**
 * Autorisation de Dépenses — visa chain evaluator (Phase 11.0D). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The signer map + the sequential-approval rules that 11.0B deliberately left as
 * a seam ("the signer-map (step → role) is built in 11.0C/D", ./types).
 *
 * EVERY approval DECISION is made here, by a total function over plain data, so
 * the server action performs no reasoning of its own and the UI can render the
 * exact same verdict without a second implementation. This mirrors the process
 * engine's state.ts discipline and lib/finance/requests.ts.
 *
 * THE CHAIN IS THE RATIFIED ONE (DEC-C08, `AUTHORIZATION_VISA_STEPS`): Demandeur
 * → Chef de Transit → Coordonnateur → Opération → Trésorière → DAF → DG. It is
 * the order PRINTED on the paper form and rendered in the seven visa boxes of
 * the 11.0C PDF — the chain and the document cannot disagree.
 *
 * TWO SIGNERS ARE DELIBERATELY UNBOUND: VISA_OPERATIONS (BLK-FIN-2) here, and
 * VISA_RECEPTION (BLK-FIN-1) on the Bon. An unbound step HALTS the chain
 * honestly — it is never auto-signed, never skipped, and never signable by an
 * unauthorized actor. No signer is invented.
 */

import { AUTHORIZATION_VISA_STEPS, isUnboundVisaStep, type VisaDecision, type VisaStep } from "./types";

// ============================================================== signer map ==

/**
 * Step → the role that may sign it (DEC-C11, ratified 2026-07-25).
 * `null` = the business has NOT named the signer (a tracked blocker).
 *
 * VISA_DEMANDEUR is intentionally absent from the ROLE map: it is signed by an
 * IDENTITY (the authenticated requester of this very document), not by a role —
 * see `REQUESTER_STEP` below.
 */
export const AUTHORIZATION_SIGNER_MAP: Readonly<Record<string, string | null>> = {
  VISA_DEMANDEUR: null, // identity-bound, not role-bound — see REQUESTER_STEP
  VISA_CHEF_TRANSIT: "CHIEF_OF_TRANSIT",
  VISA_COORDONNATEUR: "COORDINATOR",
  VISA_OPERATIONS: null, // BLK-FIN-2 — business has not named the signer
  VISA_TRESORIERE: "TREASURER",
  VISA_DAF: "DAF",
  VISA_DG: "CEO",
};

/** The one step signed by identity rather than by role (the document's requester). */
export const REQUESTER_STEP = "VISA_DEMANDEUR";

/** French captions — the same words printed on the form (single source of truth). */
export const AUTHORIZATION_VISA_LABELS_FR: Readonly<Record<string, string>> = {
  VISA_DEMANDEUR: "Visa Demandeur",
  VISA_CHEF_TRANSIT: "Chef de Transit",
  VISA_COORDONNATEUR: "Coordonnateur",
  VISA_OPERATIONS: "Opération",
  VISA_TRESORIERE: "Trésorière",
  VISA_DAF: "DAF",
  VISA_DG: "DG",
};

export function visaLabelFr(code: string): string {
  return AUTHORIZATION_VISA_LABELS_FR[code] ?? code;
}

/**
 * The role that may sign a step, or null when the step is identity-bound
 * (Demandeur) or its signer is an unresolved business blocker (Opération).
 */
export function signerRoleFor(code: string): string | null {
  return AUTHORIZATION_SIGNER_MAP[code] ?? null;
}

/**
 * A step nobody can sign yet: the signer is a tracked BUSINESS BLOCKER. The
 * requester step is NOT blocked — it is identity-bound and always signable by
 * the document's own requester.
 */
export function isBlockedStep(code: string): boolean {
  return isUnboundVisaStep(code) && code !== REQUESTER_STEP;
}

// ========================================================== chain evaluation ==

/** One recorded approval, reduced to what the rules actually need. */
export type RecordedVisa = {
  stepOrdinal: number;
  decision: VisaDecision;
  signerUserId: string;
};

/**
 * The next step that must be signed, given the visas ALREADY recorded on the
 * current version + current attempt. Returns null when the chain is complete.
 *
 * Only APPROVED visas advance the chain: a REJECTED/RETURNED decision closes the
 * attempt, so it can never leave a half-advanced chain behind.
 */
export function nextRequiredStep(visas: readonly RecordedVisa[]): VisaStep | null {
  const approved = new Set(visas.filter((v) => v.decision === "APPROVED").map((v) => v.stepOrdinal));
  for (const step of AUTHORIZATION_VISA_STEPS) {
    if (!approved.has(step.ordinal)) return step;
  }
  return null;
}

/** Whether every step of the chain carries an APPROVED visa. */
export function isChainComplete(visas: readonly RecordedVisa[]): boolean {
  return nextRequiredStep(visas) === null;
}

// ============================================================== sign verdict ==

export type SignRefusal =
  /** Every step is already signed — nothing left to approve. */
  | "chain_complete"
  /** The step's signer is an unresolved business blocker (BLK-FIN-2). */
  | "signer_not_configured"
  /** The caller does not hold the role (or identity) this step requires. */
  | "wrong_signer"
  /** The caller already signed this version — one signer, one visa. */
  | "already_signed"
  /** The caller aimed at a step that is not the next one — the chain is strict. */
  | "out_of_sequence";

export type SignVerdict = { ok: true; step: VisaStep } | { ok: false; reason: SignRefusal };

export type SignAttempt = {
  /** Visas already recorded on THIS version + THIS attempt. */
  visas: readonly RecordedVisa[];
  actorUserId: string;
  actorRoleCodes: readonly string[];
  /** The document's requester — the only identity that may sign VISA_DEMANDEUR. */
  requesterUserId: string;
  /**
   * The step the caller believes they are signing. Optional: the chain decides
   * the step, so omitting it simply signs the next one. Supplying a DIFFERENT
   * step is an explicit out-of-sequence attempt and is refused.
   */
  intendedStepCode?: string;
};

/**
 * The single authority on whether an approval may be recorded. Total and pure:
 * the server action only executes this verdict, and the UI renders it.
 *
 * Refusal order is deliberate — the most specific, most explainable cause wins,
 * so an operator is told « signataire non configuré » rather than a generic
 * « interdit » when the real problem is an unnamed business signer.
 */
export function evaluateSign(attempt: SignAttempt): SignVerdict {
  const step = nextRequiredStep(attempt.visas);
  if (!step) return { ok: false, reason: "chain_complete" };

  // Aiming at any step other than the next one is refused — no skipping, and no
  // going back to re-sign an earlier step.
  if (attempt.intendedStepCode && attempt.intendedStepCode !== step.code) {
    return { ok: false, reason: "out_of_sequence" };
  }

  // An unnamed signer halts the chain. Never auto-signed, never skipped.
  if (isBlockedStep(step.code)) return { ok: false, reason: "signer_not_configured" };

  // One signer holds at most one visa per version (11.0A §6, conservative default).
  if (attempt.visas.some((v) => v.signerUserId === attempt.actorUserId)) {
    return { ok: false, reason: "already_signed" };
  }

  if (step.code === REQUESTER_STEP) {
    // Identity-bound: only the document's own requester signs the Demandeur box.
    return attempt.actorUserId === attempt.requesterUserId
      ? { ok: true, step }
      : { ok: false, reason: "wrong_signer" };
  }

  const required = signerRoleFor(step.code);
  if (!required) return { ok: false, reason: "signer_not_configured" };
  return attempt.actorRoleCodes.includes(required)
    ? { ok: true, step }
    : { ok: false, reason: "wrong_signer" };
}

// ============================================================== chain display ==

export type VisaStepState =
  /** Approved on the current version. */
  | "SIGNED"
  /** The step awaiting signature right now. */
  | "CURRENT"
  /** Not yet reached. */
  | "PENDING"
  /** Reached (or reachable) but unsignable — signer not configured. */
  | "BLOCKED"
  /** This step carried the REJECTED/RETURNED decision that closed the attempt. */
  | "REFUSED";

export type ChainStepView = {
  code: string;
  ordinal: number;
  labelFr: string;
  roleCode: string | null;
  state: VisaStepState;
  /** Populated for SIGNED / REFUSED steps. */
  signerDisplayName?: string;
  decidedAt?: string;
  decision?: VisaDecision;
  comment?: string | null;
};

export type ChainVisa = RecordedVisa & {
  stepCode: string;
  signerDisplayName: string;
  decidedAt: string;
  comment?: string | null;
};

/**
 * Project the whole chain for display. Pure — the timeline, the queue badge and
 * the detail page all render this one projection, so what a user is told about
 * "where the document is" cannot drift between screens.
 */
export function chainStateView(visas: readonly ChainVisa[]): ChainStepView[] {
  const byOrdinal = new Map(visas.map((v) => [v.stepOrdinal, v]));
  const next = nextRequiredStep(visas);

  return AUTHORIZATION_VISA_STEPS.map((step) => {
    const visa = byOrdinal.get(step.ordinal);
    const base = {
      code: step.code,
      ordinal: step.ordinal,
      labelFr: visaLabelFr(step.code),
      roleCode: signerRoleFor(step.code),
    };

    if (visa) {
      return {
        ...base,
        state: visa.decision === "APPROVED" ? ("SIGNED" as const) : ("REFUSED" as const),
        signerDisplayName: visa.signerDisplayName,
        decidedAt: visa.decidedAt,
        decision: visa.decision,
        comment: visa.comment ?? null,
      };
    }

    if (next && step.ordinal === next.ordinal) {
      return { ...base, state: isBlockedStep(step.code) ? ("BLOCKED" as const) : ("CURRENT" as const) };
    }
    return { ...base, state: "PENDING" as const };
  });
}

/** Human explanation of a refusal — one message, reused by every surface. */
export const SIGN_REFUSAL_LABELS_FR: Readonly<Record<SignRefusal, string>> = {
  chain_complete: "Tous les visas ont déjà été apposés sur cette version.",
  signer_not_configured:
    "Le signataire de cette étape n'est pas encore défini par la direction. Le circuit s'arrête ici tant qu'il ne l'est pas.",
  wrong_signer: "Vous n'êtes pas le signataire attendu à cette étape.",
  already_signed: "Vous avez déjà apposé un visa sur cette version.",
  out_of_sequence: "Le circuit est strictement séquentiel : cette étape n'est pas la prochaine.",
};
