/**
 * Process engine — join gates (Phase 5.0B). PURE. Deterministic and testable.
 * ---------------------------------------------------------------------------
 * The convergence points of the official process. The pickup gate is the one the
 * official document actually specifies: the customs branch and the
 * transport-readiness branch run independently and MUST both be satisfied before
 * anything leaves the port.
 *
 * The existing platform had exactly one, single-criterion gate — canPickup(),
 * which checked customs RELEASED and nothing else. This replaces it with the six
 * official requirements, each reported SEPARATELY so the blocker is never a
 * mystery, and each resolved from a REAL record (never inferred from free text).
 *
 * Operation-type exceptions are explicit configuration, taken from the registry's
 * PICKUP_READINESS.appliesToFileTypes — we do NOT fabricate a customs requirement
 * for TRP/HND dossiers, which officially have no customs leg.
 */
import { isVehicleAssigned } from "@/lib/transport/vehicle-identity";
import { PICKUP_READINESS, evaluatePickupReadiness } from "../effitrans-process";
import { checkEvidence, fullyPaid, hasIssuedInvoice, podReceived, type EvidenceSnapshot } from "./evidence";
import { liveByKey, type ExecutionView } from "./state";
import { isDone } from "./types";

export type GateRequirementResult = {
  key: string;
  labelFr: string;
  satisfied: boolean;
  /** True when this requirement does not apply to this dossier type. */
  notApplicable: boolean;
  /**
   * True when this view could not EVALUATE the requirement — the facts it needs
   * were not available here (FIN-TRN-DOC-01).
   *
   * Distinct from `!satisfied`, and the distinction is the point: an
   * unevaluated requirement is not a failing one, and rendering it as a blocker
   * states a defect the dossier may not have. It never opens the gate either —
   * see `ready` below.
   */
  unauthorized?: boolean;
  /** Why it is not satisfied. Never free text from a user. */
  detail?: string;
};

export type GateResult = {
  key: string;
  ready: boolean;
  requirements: GateRequirementResult[];
  /** Keys of the requirements that are blocking. Empty when ready. */
  missing: string[];
  /**
   * Keys this view could not evaluate. A gate with any of these is NEVER ready:
   * not knowing is not the same as passing. Mirrors `ClosureEvaluation`'s own
   * `unauthorized`, so the two closure surfaces speak one vocabulary.
   */
  unauthorized: string[];
};

/** `ready` only when nothing blocks AND nothing went unevaluated. */
function settle(key: string, requirements: GateRequirementResult[]): GateResult {
  const missing = requirements
    .filter((r) => !r.satisfied && !r.notApplicable && !r.unauthorized)
    .map((r) => r.key);
  const unauthorized = requirements.filter((r) => r.unauthorized).map((r) => r.key);
  return {
    key,
    ready: missing.length === 0 && unauthorized.length === 0,
    requirements,
    missing,
    unauthorized,
  };
}

const nonEmpty = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * Resolve the six official pickup requirements against real records.
 *
 * customs_released      customs_record.status = RELEASED (or customs not required)
 * bon_a_delivrer        an APPROVED BON_A_DELIVRER document
 * pre_gate              an APPROVED PRE_GATE_AUTHORIZATION document
 * bordereau_livraison   an APPROVED BORDEREAU_LIVRAISON document
 * vehicle_assigned      transport_record.vehicle_id (fleet) OR vehicle_plate (external/legacy)
 * driver_assigned       transport_record.driver_user_id OR driver_name
 *
 * NOTE: three of these document types do not exist in the catalog until Phase
 * 5.0D. Until then they resolve to `missing` — the gate stays CLOSED rather than
 * silently opening. That is the correct failure direction: goods must not leave
 * the port because the platform cannot yet store a Bon à Délivrer.
 */
export function evaluatePickupGate(
  snap: EvidenceSnapshot,
  executions: ExecutionView[] = [],
): GateResult {
  const customsReleased = snap.customs?.status === "RELEASED";
  const customsRequired = snap.customs?.required ?? false;

  const bad = checkEvidence("BON_A_DELIVRER", snap);
  const preGate = checkEvidence("PRE_GATE_AUTHORIZATION", snap);
  const bl = checkEvidence("BORDEREAU_LIVRAISON", snap);

  // TRN-VEHICLE-01 — a bound fleet vehicle is an assignment, exactly as a
  // linked driver is one line below. The plate alone left every fleet-executed
  // mission refused here with `no_vehicle_plate`.
  const vehicleAssigned = isVehicleAssigned({ vehicleId: snap.transport?.vehicleId, plate: snap.transport?.vehiclePlate });
  const driverAssigned = nonEmpty(snap.transport?.driverUserId) || nonEmpty(snap.transport?.driverName);

  // The registry owns the operation-type exceptions; we never invent one.
  const readiness = evaluatePickupReadiness({
    fileType: snap.fileType,
    customsReleased,
    customsRequired,
    bonADelivrer: bad.status === "satisfied",
    preGate: preGate.status === "satisfied",
    bordereauLivraison: bl.status === "satisfied",
    vehicleAssigned,
    driverAssigned,
  });

  const detailFor: Record<string, string | undefined> = {
    customs_released: customsReleased ? undefined : "customs_not_released",
    bon_a_delivrer: bad.detail,
    pre_gate: preGate.detail,
    bordereau_livraison: bl.detail,
    vehicle_assigned: vehicleAssigned ? undefined : "no_vehicle_plate",
    driver_assigned: driverAssigned ? undefined : "no_driver_assigned",
  };

  const requirements: GateRequirementResult[] = PICKUP_READINESS.map((r) => {
    const notApplicable = readiness.notApplicable.includes(r.key);
    const satisfied = !notApplicable && !readiness.missing.includes(r.key);
    return {
      key: r.key,
      labelFr: r.labelFr,
      satisfied,
      notApplicable,
      detail: satisfied || notApplicable ? undefined : detailFor[r.key],
    };
  });

  // The REGISTRY's verdict is authoritative here — `evaluatePickupReadiness`
  // owns the operation-type exceptions — so this gate keeps reporting exactly
  // what it decided. No pickup requirement can be unevaluated: every one of them
  // is resolved from the snapshot this function was handed.
  return {
    key: "pickup_readiness",
    ready: readiness.ready,
    requirements,
    missing: readiness.missing,
    unauthorized: [],
  };
}

/**
 * Billing readiness (official step 19 -> 20). No invoice may be drafted until BOTH
 * completeness checkpoints have passed. Today the platform has NO billing gate at
 * all: an invoice can be created on any dossier at any time, with no evidence.
 */
export function evaluateBillingGate(executions: ExecutionView[], snap: EvidenceSnapshot): GateResult {
  const live = liveByKey(executions);

  const coordinatorDone = isDone(live.get("coordinator_completeness")?.state ?? "PENDING");
  const amDone = isDone(live.get("am_completeness")?.state ?? "PENDING");
  const pod = podReceived(snap);

  const requirements: GateRequirementResult[] = [
    {
      key: "pod_received",
      labelFr: "Bordereau de Livraison signé reçu",
      satisfied: pod,
      notApplicable: false,
      detail: pod ? undefined : "no_approved_pod",
    },
    {
      key: "coordinator_completeness",
      labelFr: "Contrôle de complétude du Coordinateur",
      satisfied: coordinatorDone,
      notApplicable: false,
      detail: coordinatorDone ? undefined : "coordinator_check_incomplete",
    },
    {
      key: "am_completeness",
      labelFr: "Contrôle de complétude de l'Account Manager",
      satisfied: amDone,
      notApplicable: false,
      detail: amDone ? undefined : "am_check_incomplete",
    },
  ];

  return settle("billing_readiness", requirements);
}

/**
 * The post-delivery facts the closure gate needs, beyond the evidence snapshot.
 * All DERIVED from existing records — nothing new is stored to answer these.
 */
export type ClosureContext = {
  /** invoice.validated_by is set (official step 21 passed). */
  invoiceValidated: boolean;
  /** A communication_message for this invoice reached SENT (official step 22). */
  invoiceEmailed: boolean;
  /**
   * Whether a physical deposit is required for this dossier. EXPLICIT
   * configuration — never implicit skipping. When false, the deposit
   * requirements below report `notApplicable`, not `satisfied`.
   */
  depositRequired: boolean;
  /** invoice_deposit reached PROOF_ACCEPTED. */
  depositProofAccepted: boolean;
  /** invoice_deposit reached HANDED_TO_COLLECTIONS (official step 25). */
  handedToCollections: boolean;
  /** Any rejected step or rejected deposit proof still awaiting correction. */
  unresolvedCorrections: number;
};

/**
 * FINAL CLOSURE GATE (Phase 5.0D, Deliverable 12).
 *
 * DELIVERED != CLOSED, and now neither does anything else on its own:
 *   * delivery alone does not close
 *   * a POD alone does not close
 *   * an emailed invoice alone does not close
 *   * FULL PAYMENT ALONE DOES NOT CLOSE — this is the important one. Money
 *     arriving cannot short-circuit the operational workflow, so no payment
 *     webhook can ever close a dossier as a side effect.
 *
 * The legacy canCloseFile() checked customs release and nothing else, so an
 * unbilled, unpaid dossier could be closed. This is the gate that ends that.
 * It REPORTS readiness; the explicit closure action applies it.
 */
export function evaluateClosureGate(
  executions: ExecutionView[],
  snap: EvidenceSnapshot,
  ctx?: ClosureContext,
): GateResult {
  const paid = fullyPaid(snap);
  const invoiced = hasIssuedInvoice(snap);
  const pod = podReceived(snap);

  const live = liveByKey(executions);
  const unfinished = [...live.values()].filter((e) => !isDone(e.state));
  const unverified = [...live.values()].filter((e) => e.state === "UNVERIFIED_HISTORICAL");

  const requirements: GateRequirementResult[] = [
    {
      key: "pod_received",
      labelFr: "Bordereau de Livraison signé reçu",
      satisfied: pod,
      notApplicable: false,
      detail: pod ? undefined : "no_approved_pod",
    },
    {
      key: "process_complete",
      labelFr: "Toutes les étapes officielles terminées",
      // UNVERIFIED_HISTORICAL never counts as done: the engine will not close a
      // legacy dossier on the strength of evidence nobody ever captured.
      satisfied: unfinished.length === 0,
      notApplicable: false,
      detail:
        unfinished.length === 0
          ? undefined
          : unverified.length > 0
            ? "unverified_historical_steps"
            : "steps_incomplete",
    },
    {
      key: "fully_paid",
      labelFr: "Paiement intégral encaissé",
      satisfied: paid,
      notApplicable: false,
      // FIN-TRN-DOC-01 — two different facts, two different sentences. The
      // REQUIREMENT is untouched: a dossier with no invoice is not paid and
      // does not close. It is simply not "solde restant dû" either.
      detail: paid ? undefined : invoiced ? "balance_outstanding" : "no_invoice",
    },
  ];

  // Without the post-delivery context we can only judge what the engine sees.
  // We do NOT assume the billing/deposit chain passed — an absent context means
  // those requirements are unproven, so the gate stays closed.
  if (ctx) {
    requirements.push(
      {
        key: "invoice_validated",
        labelFr: "Facture validée par la Finance",
        satisfied: ctx.invoiceValidated,
        notApplicable: false,
        detail: ctx.invoiceValidated ? undefined : "invoice_not_validated",
      },
      {
        key: "invoice_emailed",
        labelFr: "Facture envoyée au client",
        satisfied: ctx.invoiceEmailed,
        notApplicable: false,
        detail: ctx.invoiceEmailed ? undefined : "invoice_not_sent",
      },
      {
        key: "deposit_proof_accepted",
        labelFr: "Preuve de dépôt physique validée",
        // Explicit configuration, never implicit skipping.
        satisfied: ctx.depositRequired ? ctx.depositProofAccepted : false,
        notApplicable: !ctx.depositRequired,
        detail: !ctx.depositRequired || ctx.depositProofAccepted ? undefined : "proof_not_accepted",
      },
      {
        key: "handed_to_collections",
        labelFr: "Remis au recouvrement",
        satisfied: ctx.depositRequired ? ctx.handedToCollections : false,
        notApplicable: !ctx.depositRequired,
        detail: !ctx.depositRequired || ctx.handedToCollections ? undefined : "not_handed_to_collections",
      },
      {
        key: "no_unresolved_corrections",
        labelFr: "Aucune correction en suspens",
        satisfied: ctx.unresolvedCorrections === 0,
        notApplicable: false,
        detail: ctx.unresolvedCorrections === 0 ? undefined : "corrections_outstanding",
      },
    );
  } else {
    // FIN-TRN-DOC-01 — NOT EVALUATED, not failed.
    //
    // This branch used to emit one requirement whose state was a flat `false`,
    // so every dossier on the inspector reported « ❌ Chaîne facturation /
    // dépôt / recouvrement » — including dossiers whose invoice was validated,
    // sent and paid. The gate was asserting a defect it had not looked for, and
    // could never read « Ouvert » for anyone.
    //
    // The honest report is that this view did not have the facts. It still
    // holds the gate shut (`settle` refuses `ready` while anything is
    // unevaluated), so nothing is opened by not knowing; the display simply
    // stops claiming a blocker it never established. The authoritative path
    // supplies the context and never reaches this branch at all.
    requirements.push({
      key: "post_delivery_chain",
      labelFr: "Chaîne facturation / dépôt / recouvrement",
      satisfied: false,
      notApplicable: false,
      unauthorized: true,
      detail: "post_delivery_context_unavailable",
    });
  }

  return settle("closure_readiness", requirements);
}
