/**
 * Structured reason codes (Phase WES-4F). PURE — client + server safe.
 * ---------------------------------------------------------------------------
 * Implements the WES-9A / DEC-B75 split, which this phase now makes concrete:
 *
 *   PROTECTED DOMAIN RECORD  the structured code AND the free-text explanation,
 *                            the actor, the timestamp, the resolution.
 *   IMMUTABLE EVENT LEDGER   the structured code, a boolean saying whether an
 *                            explanation exists, and a REFERENCE to the review
 *                            row. Never the text.
 *
 * That is the open contradiction WES-9 flagged: ADR-WES-014's privacy section
 * says rejection reasons are included because governance requires them; WES-9
 * omitted them because an immutable table can never redact staff-authored prose.
 * The reference resolves it — governance can always reach the explanation, and
 * the ledger never holds a sentence about a colleague's work that cannot be
 * corrected.
 *
 * The vocabulary is CLOSED and deliberately minimal. WES-4F says not to invent
 * codes unsupported by actual workflows, so each one below traces to a refusal
 * the repository can already produce or an override authority that already
 * exists. Speculative codes are absent.
 */

export type ReasonScope = "REJECTION" | "OVERRIDE";

export type ReasonCodeDef = {
  code: string;
  scope: ReasonScope;
  labelFr: string;
  /** True when the actor must also supply a free-text explanation. */
  explanationRequired: boolean;
};

export const REASON_CODES: readonly ReasonCodeDef[] = [
  // --------------------------------------------------------- rejection
  // The document is not acceptable AS EVIDENCE. Each of these is a judgement a
  // verifier can make by looking at the file, which is why the list is short:
  // anything needing investigation is a correction request, not a rejection.
  { code: "DOCUMENT_INCOMPLETE",    scope: "REJECTION", labelFr: "Document incomplet",                  explanationRequired: false },
  { code: "DOCUMENT_ILLEGIBLE",     scope: "REJECTION", labelFr: "Document illisible",                  explanationRequired: false },
  { code: "DOCUMENT_MISMATCH",      scope: "REJECTION", labelFr: "Incohérence avec le dossier",         explanationRequired: true  },
  { code: "WRONG_DOSSIER",          scope: "REJECTION", labelFr: "Document rattaché au mauvais dossier", explanationRequired: false },
  { code: "EXPIRED_DOCUMENT",       scope: "REJECTION", labelFr: "Document expiré",                     explanationRequired: false },
  { code: "REFERENCE_INVALID",      scope: "REJECTION", labelFr: "Référence invalide",                  explanationRequired: true  },
  { code: "SIGNATURE_MISSING",      scope: "REJECTION", labelFr: "Signature manquante",                 explanationRequired: false },
  { code: "OFFICIAL_STAMP_MISSING", scope: "REJECTION", labelFr: "Cachet officiel manquant",            explanationRequired: false },
  { code: "REPLACEMENT_REQUIRED",   scope: "REJECTION", labelFr: "Remplacement demandé",                explanationRequired: true  },

  // ---------------------------------------------------------- override
  // A governed departure from the normal control. Both REQUIRE an explanation:
  // an override without a stated reason is indistinguishable from a mistake,
  // and it is the only record of why a control was set aside.
  { code: "EMERGENCY_OPERATIONAL_RECOVERY", scope: "OVERRIDE", labelFr: "Reprise opérationnelle d'urgence", explanationRequired: true },
  { code: "DATA_CORRECTION",                scope: "OVERRIDE", labelFr: "Correction de données",            explanationRequired: true },
] as const;

const BY_CODE = new Map(REASON_CODES.map((r) => [r.code, r]));

export function reasonCode(code: string): ReasonCodeDef | null {
  return BY_CODE.get(code) ?? null;
}

export function isRejectionCode(code: string): boolean {
  return reasonCode(code)?.scope === "REJECTION";
}

export function isOverrideCode(code: string): boolean {
  return reasonCode(code)?.scope === "OVERRIDE";
}

export function rejectionCodes(): ReasonCodeDef[] {
  return REASON_CODES.filter((r) => r.scope === "REJECTION");
}

export function overrideCodes(): ReasonCodeDef[] {
  return REASON_CODES.filter((r) => r.scope === "OVERRIDE");
}

export type ReasonValidation =
  | { ok: true; code: string; explanation: string | null }
  | { ok: false; error: "unknown_reason_code" | "wrong_scope" | "explanation_required" };

/**
 * Validate a reason before it reaches the domain record. Fail-closed: an
 * unknown code is refused rather than stored as free text under a made-up name.
 */
export function validateReason(input: {
  code: string;
  explanation?: string | null;
  scope: ReasonScope;
}): ReasonValidation {
  const def = reasonCode(input.code);
  if (!def) return { ok: false, error: "unknown_reason_code" };
  if (def.scope !== input.scope) return { ok: false, error: "wrong_scope" };

  const explanation = input.explanation?.trim() || null;
  if (def.explanationRequired && !explanation) {
    return { ok: false, error: "explanation_required" };
  }
  return { ok: true, code: def.code, explanation };
}

/**
 * The metadata an immutable business event may carry about a reason.
 * Note what it returns and what it cannot: a boolean and a reference, never
 * the explanation itself. A caller that wants the text must read the protected
 * review record, which is exactly the point.
 */
export function eventReasonMetadata(input: {
  code: string;
  explanation: string | null;
  reviewId: string;
  isOverride?: boolean;
}): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {
    reason_code: input.code,
    has_reason: Boolean(input.explanation),
    reason_reference_id: input.reviewId,
  };
  if (input.isOverride) {
    out.is_override = true;
    out.override_reason_code = input.code;
    out.override_reference_id = input.reviewId;
  }
  return out;
}
