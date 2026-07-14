/**
 * Authoritative closure readiness (Phase 5.0D-4, Deliverable 12). PURE.
 * ---------------------------------------------------------------------------
 * ONE evaluator. Every requirement is reported INDEPENDENTLY — satisfied, blocked,
 * not-applicable, or unauthorized — so a refusal always comes with the complete
 * list of what is missing rather than a single opaque "not ready".
 *
 * THE RULES THIS ENFORCES, none of which the platform had before:
 *   delivery alone does not close
 *   a POD alone does not close
 *   a validated invoice alone does not close
 *   an emailed invoice alone does not close
 *   an accepted deposit proof alone does not close
 *   FULL PAYMENT ALONE DOES NOT CLOSE  <- so no payment webhook can ever close a
 *                                         dossier as a side effect
 *   an open dispute blocks closure
 *   an unresolved correction blocks closure
 *   an UNVERIFIED_HISTORICAL step never counts as done
 *
 * Nothing is ever inferred from a file's age or a status label.
 */
import { isDone, type StepState } from "./types";

export type RequirementState = "satisfied" | "blocked" | "not_applicable" | "unauthorized";

export type ClosureRequirement = {
  key: string;
  labelFr: string;
  state: RequirementState;
  /** Why it is blocked. Never free text from a user. */
  detail?: string;
  /** What proves it — an id, never a document body. */
  evidence?: string | null;
};

export type ClosureEvaluation = {
  ready: boolean;
  requirements: ClosureRequirement[];
  blockers: string[];
  satisfied: string[];
  notApplicable: string[];
  unauthorized: string[];
  /** When this evaluation was made. Set by the caller — never Date.now() here. */
  evaluatedAt: string;
};

export type ClosureInput = {
  evaluatedAt: string;
  /** What the caller may see. An unreadable module yields `unauthorized`, not a pass. */
  access: { finance: boolean; documents: boolean; transport: boolean };

  // Operational
  transportDelivered: boolean;
  podApproved: boolean;
  podDocumentId: string | null;

  // Completeness (official steps 18-19)
  coordinatorCompletenessDone: boolean;
  amCompletenessDone: boolean;

  // Billing (official steps 20-22)
  invoiceId: string | null;
  invoiceValidated: boolean;
  invoiceEmailed: boolean;

  // Physical deposit (official steps 23-25) — EXPLICIT configuration
  depositRequired: boolean;
  depositProofAccepted: boolean;
  depositProofDocumentId: string | null;
  handedToCollections: boolean;

  // Collections (official step 26)
  outstandingBalance: number;
  disputeOpen: boolean;
  collectionsCompleted: boolean;

  // Process
  stepStates: { stepKey: string; state: StepState }[];
  unresolvedCorrections: number;
};

const S = (
  key: string,
  labelFr: string,
  ok: boolean,
  detail: string,
  evidence: string | null = null,
): ClosureRequirement => ({
  key,
  labelFr,
  state: ok ? "satisfied" : "blocked",
  detail: ok ? undefined : detail,
  evidence: ok ? evidence : null,
});

export function evaluateClosure(input: ClosureInput): ClosureEvaluation {
  const reqs: ClosureRequirement[] = [];

  // --- operational ---------------------------------------------------------
  if (!input.access.transport) {
    reqs.push({ key: "delivery_complete", labelFr: "Livraison effectuée", state: "unauthorized" });
  } else {
    reqs.push(S("delivery_complete", "Livraison effectuée", input.transportDelivered, "not_delivered"));
  }

  if (!input.access.documents) {
    reqs.push({ key: "pod_received", labelFr: "Bordereau de Livraison signé (POD)", state: "unauthorized" });
  } else {
    reqs.push(
      S("pod_received", "Bordereau de Livraison signé (POD)", input.podApproved, "no_approved_pod", input.podDocumentId),
    );
  }

  // --- completeness --------------------------------------------------------
  reqs.push(
    S(
      "coordinator_completeness",
      "Contrôle de complétude du Coordinateur",
      input.coordinatorCompletenessDone,
      "coordinator_check_incomplete",
    ),
  );
  reqs.push(
    S(
      "am_completeness",
      "Contrôle de complétude de l'Account Manager",
      input.amCompletenessDone,
      "am_check_incomplete",
    ),
  );

  // --- billing -------------------------------------------------------------
  if (!input.access.finance) {
    for (const [key, labelFr] of [
      ["invoice_validated", "Facture validée par la Finance"],
      ["invoice_emailed", "Facture envoyée au client"],
      ["balance_zero", "Solde nul"],
      ["no_open_dispute", "Aucun litige ouvert"],
    ] as const) {
      reqs.push({ key, labelFr, state: "unauthorized" });
    }
  } else {
    reqs.push(
      S("invoice_validated", "Facture validée par la Finance", input.invoiceValidated, "invoice_not_validated", input.invoiceId),
    );
    reqs.push(S("invoice_emailed", "Facture envoyée au client", input.invoiceEmailed, "invoice_not_sent", input.invoiceId));

    // FULL PAYMENT IS ONE REQUIREMENT AMONG MANY. On its own it closes nothing.
    reqs.push(
      S("balance_zero", "Solde nul (paiement intégral)", input.outstandingBalance <= 0, "balance_outstanding"),
    );

    // An open dispute blocks closure — and does NOT erase the amount due.
    reqs.push(S("no_open_dispute", "Aucun litige ouvert", !input.disputeOpen, "dispute_open"));
  }

  // --- physical deposit: explicit configuration, never implicit skipping ----
  if (!input.depositRequired) {
    reqs.push({
      key: "deposit_proof_accepted",
      labelFr: "Preuve de dépôt physique validée",
      state: "not_applicable",
      detail: "deposit_not_required_for_this_client",
    });
    reqs.push({
      key: "handed_to_collections",
      labelFr: "Remis au recouvrement",
      state: "not_applicable",
      detail: "deposit_not_required_for_this_client",
    });
  } else {
    reqs.push(
      S(
        "deposit_proof_accepted",
        "Preuve de dépôt physique validée",
        input.depositProofAccepted,
        "proof_not_accepted",
        input.depositProofDocumentId,
      ),
    );
    reqs.push(
      S("handed_to_collections", "Remis au recouvrement", input.handedToCollections, "not_handed_to_collections"),
    );
  }

  // --- collections (step 26) ----------------------------------------------
  reqs.push(
    S("collections_complete", "Travail de recouvrement terminé", input.collectionsCompleted, "collections_incomplete"),
  );

  // --- process -------------------------------------------------------------
  const unfinished = input.stepStates.filter(
    (s) => s.state !== "REJECTED" && s.state !== "CANCELLED" && !isDone(s.state),
  );
  const unverified = unfinished.filter((s) => s.state === "UNVERIFIED_HISTORICAL");

  reqs.push(
    S(
      "process_complete",
      "Toutes les étapes officielles terminées",
      unfinished.length === 0,
      // An UNVERIFIED_HISTORICAL step never counts as done: the engine will not
      // close a legacy dossier on the strength of evidence nobody ever captured.
      unverified.length > 0 ? "unverified_historical_steps" : "steps_incomplete",
    ),
  );
  reqs.push(
    S(
      "no_unresolved_corrections",
      "Aucune correction en suspens",
      input.unresolvedCorrections === 0,
      "corrections_outstanding",
    ),
  );

  const blockers = reqs.filter((r) => r.state === "blocked").map((r) => r.key);
  const satisfied = reqs.filter((r) => r.state === "satisfied").map((r) => r.key);
  const notApplicable = reqs.filter((r) => r.state === "not_applicable").map((r) => r.key);
  const unauthorized = reqs.filter((r) => r.state === "unauthorized").map((r) => r.key);

  return {
    // An UNAUTHORIZED requirement is NOT a pass: a caller who cannot see finance
    // cannot close a dossier on the strength of what they cannot check.
    ready: blockers.length === 0 && unauthorized.length === 0,
    requirements: reqs,
    blockers,
    satisfied,
    notApplicable,
    unauthorized,
    evaluatedAt: input.evaluatedAt,
  };
}
