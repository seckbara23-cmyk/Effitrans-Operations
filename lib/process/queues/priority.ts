/**
 * Queue priority model (Phase 5.0C, Deliverable 12). PURE and DETERMINISTIC.
 * ---------------------------------------------------------------------------
 * No AI. No invented SLA commitments. A score is a sum of explicit, named signals,
 * and every item carries the REASONS that produced its score — a user must always
 * be able to see why something is at the top of their queue.
 *
 * Nothing here treats an unconfigured SLA as overdue. The only time-based signal
 * is `provisional_threshold_exceeded`, which fires ONLY for the four legacy
 * thresholds that are live-but-unratified — and it says so in its label.
 */
import { getSlaPolicy } from "../sla-policies";

export type PriorityReason = {
  code: string;
  labelFr: string;
  weight: number;
};

export type PrioritySignals = {
  /** operational_file.priority */
  filePriority: string;
  /** This attempt corrects a rejected one — someone is waiting on a fix. */
  isCorrection: boolean;
  /** A handoff was sent but nobody has confirmed reception. */
  handoffUnreceived: boolean;
  /** Hours since the step became this queue's problem. */
  ageHours: number;
  /** The step's SLA policy key (from the registry). */
  slaPolicyKey: string;
  /** The step cannot proceed — a gate or evidence is missing. */
  blocked: boolean;
  /** The pickup gate needs only one more requirement. */
  nearlyReady: boolean;
  /** Delivered, but no approved POD yet. */
  podMissing: boolean;
  /** Billing-ready and nobody has picked it up. */
  billingIdle: boolean;
  /** An issued invoice is past its due date with a balance. */
  invoiceOverdue: boolean;
  /** The client is waiting on this (customer-visible step). */
  customerImpacting: boolean;
};

const R = (code: string, labelFr: string, weight: number): PriorityReason => ({ code, labelFr, weight });

export type PriorityResult = {
  score: number;
  reasons: PriorityReason[];
  /** Display bucket, derived from the score. */
  level: "critical" | "high" | "normal" | "low";
};

/**
 * Deterministic priority. Same inputs => same score, always.
 *
 * Weights are ORDERING signals, not business SLAs. They say "a rejected dossier
 * outranks an idle one"; they do not claim Effitrans promised anything.
 */
export function evaluatePriority(s: PrioritySignals): PriorityResult {
  const reasons: PriorityReason[] = [];

  if (s.isCorrection) {
    reasons.push(R("correction_required", "Correction demandée après rejet", 50));
  }
  if (s.handoffUnreceived) {
    reasons.push(R("handoff_unreceived", "Transfert non réceptionné", 40));
  }
  if (s.invoiceOverdue) {
    reasons.push(R("invoice_overdue", "Facture échue avec solde", 35));
  }
  if (s.podMissing) {
    reasons.push(R("pod_missing", "Livré sans bordereau signé", 30));
  }
  if (s.blocked) {
    reasons.push(R("blocked", "Étape bloquée (prérequis ou preuve manquante)", 25));
  }
  if (s.customerImpacting) {
    reasons.push(R("customer_impacting", "Le client attend cette étape", 20));
  }
  if (s.billingIdle) {
    reasons.push(R("billing_idle", "Prêt à facturer, non pris en charge", 20));
  }
  if (s.nearlyReady) {
    reasons.push(R("nearly_ready", "Porte d'enlèvement presque satisfaite", 15));
  }

  // Explicit operational priority on the dossier.
  const fileWeight: Record<string, number> = { critical: 40, high: 25, normal: 0, low: -10 };
  const fw = fileWeight[s.filePriority] ?? 0;
  if (fw !== 0) {
    reasons.push(R(`file_priority_${s.filePriority}`, `Priorité dossier : ${s.filePriority}`, fw));
  }

  // Time. ONLY fires for a policy that actually has a value — and every such
  // policy is `unratified`, so we say so rather than claiming an SLA breach.
  const policy = getSlaPolicy(s.slaPolicyKey);
  if (policy && policy.state === "unratified" && policy.criticalHours !== null && policy.warningHours !== null) {
    if (s.ageHours >= policy.criticalHours) {
      reasons.push(R("provisional_threshold_exceeded", "Seuil interne provisoire dépassé (non ratifié)", 30));
    } else if (s.ageHours >= policy.warningHours) {
      reasons.push(R("provisional_threshold_warning", "Approche du seuil interne provisoire (non ratifié)", 15));
    }
  }
  // An `unconfigured` policy contributes NOTHING. No fabricated overdue status.

  const score = reasons.reduce((sum, r) => sum + r.weight, 0);

  const level: PriorityResult["level"] =
    score >= 70 ? "critical" : score >= 40 ? "high" : score >= 15 ? "normal" : "low";

  return { score, reasons, level };
}

/** Stable sort: score desc, then oldest first, then dossier number for determinism. */
export function compareQueueItems(
  a: { priority: PriorityResult; ageHours: number; fileNumber: string },
  b: { priority: PriorityResult; ageHours: number; fileNumber: string },
): number {
  if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
  if (b.ageHours !== a.ageHours) return b.ageHours - a.ageHours;
  return a.fileNumber.localeCompare(b.fileNumber);
}
