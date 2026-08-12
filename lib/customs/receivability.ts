/**
 * Recevabilité — Quality Control N°3 (Déclarant en Douane). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité » lists « Recevabilité » as the
 * first control the Déclarant en Douane performs. This module holds the
 * vocabulary of that decision and nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT: the criteria. The manual names the control; it
 * does not define what makes a file receivable. Any list of required documents
 * or conditions written here would be an invention frozen into code, so the
 * decision is recorded as the declarant's judgement and the criteria stay
 * unwritten until Effitrans supplies them. When they arrive they become
 * configuration — not a rewrite of this module.
 *
 * WHAT IT IS NOT: a workflow state. Recevabilité is a judgement ABOUT the file,
 * not a position IN the declaration lifecycle. Nothing here maps to
 * `customs_record.status` or to a process step, and no gate reads it.
 */

/** The three outcomes, in the manual's own vocabulary. */
export const RECEIVABILITY_OUTCOMES = ["RECEVABLE", "NON_RECEVABLE", "SOUS_RESERVE"] as const;
export type ReceivabilityOutcome = (typeof RECEIVABILITY_OUTCOMES)[number];

export function isReceivabilityOutcome(v: string | null | undefined): v is ReceivabilityOutcome {
  return typeof v === "string" && (RECEIVABILITY_OUTCOMES as readonly string[]).includes(v);
}

export const RECEIVABILITY_LABELS_FR: Record<ReceivabilityOutcome, string> = {
  RECEVABLE: "Recevable",
  NON_RECEVABLE: "Non recevable",
  SOUS_RESERVE: "Sous réserve",
};

/**
 * A reason is mandatory for everything except a clean acceptance.
 *
 * A refusal nobody can explain is a refusal nobody can act on, and « sous
 * réserve » is meaningless without naming the reservation. This is the one
 * rule the evidence genuinely supports — it constrains the RECORD, never the
 * decision itself.
 */
export function reasonRequired(outcome: ReceivabilityOutcome): boolean {
  return outcome !== "RECEVABLE";
}

export type ReceivabilityDecision = {
  outcome: ReceivabilityOutcome;
  note: string | null;
};

export type ReceivabilityRejection =
  | "invalid_outcome"
  | "reason_required"
  | "unchanged";

/**
 * Validate a proposed decision against the standing one.
 *
 * `unchanged` exists because re-deciding is legitimate — a file refused on
 * Monday becomes receivable on Tuesday once the missing document lands — but
 * re-recording the SAME outcome with the SAME reason only fills the timeline
 * with noise. EMP-5H.1 was exactly that failure: three identical writes nobody
 * could see, so the operator kept repeating them.
 */
export function validateReceivability(
  proposed: { outcome: string; note: string | null | undefined },
  current: { outcome: string | null; note: string | null } | null,
): { ok: true; decision: ReceivabilityDecision } | { ok: false; error: ReceivabilityRejection } {
  if (!isReceivabilityOutcome(proposed.outcome)) return { ok: false, error: "invalid_outcome" };
  const note = (proposed.note ?? "").trim() || null;
  if (reasonRequired(proposed.outcome) && !note) return { ok: false, error: "reason_required" };

  if (current && current.outcome === proposed.outcome && (current.note ?? "") === (note ?? "")) {
    return { ok: false, error: "unchanged" };
  }
  return { ok: true, decision: { outcome: proposed.outcome, note } };
}

/**
 * Has this control been performed at all?
 *
 * NULL is "not yet assessed" and is deliberately distinct from every recorded
 * outcome — an unassessed file is not a receivable one, and it is not a refused
 * one either. Quality reporting must be able to tell those three apart.
 */
export function isAssessed(status: string | null | undefined): boolean {
  return isReceivabilityOutcome(status);
}
