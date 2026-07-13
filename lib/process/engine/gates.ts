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
import { PICKUP_READINESS, evaluatePickupReadiness } from "../effitrans-process";
import { checkEvidence, fullyPaid, podReceived, type EvidenceSnapshot } from "./evidence";
import { liveByKey, type ExecutionView } from "./state";
import { isDone } from "./types";

export type GateRequirementResult = {
  key: string;
  labelFr: string;
  satisfied: boolean;
  /** True when this requirement does not apply to this dossier type. */
  notApplicable: boolean;
  /** Why it is not satisfied. Never free text from a user. */
  detail?: string;
};

export type GateResult = {
  key: string;
  ready: boolean;
  requirements: GateRequirementResult[];
  /** Keys of the requirements that are blocking. Empty when ready. */
  missing: string[];
};

const nonEmpty = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * Resolve the six official pickup requirements against real records.
 *
 * customs_released      customs_record.status = RELEASED (or customs not required)
 * bon_a_delivrer        an APPROVED BON_A_DELIVRER document
 * pre_gate              an APPROVED PRE_GATE_AUTHORIZATION document
 * bordereau_livraison   an APPROVED BORDEREAU_LIVRAISON document
 * vehicle_assigned      transport_record.vehicle_plate is a real value
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

  const vehicleAssigned = nonEmpty(snap.transport?.vehiclePlate);
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

  return {
    key: "pickup_readiness",
    ready: readiness.ready,
    requirements,
    missing: readiness.missing,
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

  const missing = requirements.filter((r) => !r.satisfied).map((r) => r.key);
  return { key: "billing_readiness", ready: missing.length === 0, requirements, missing };
}

/**
 * Closure readiness. DELIVERED != CLOSED: a dossier closes only on FULL PAYMENT
 * plus operational completion. The legacy canCloseFile() checked customs release
 * alone, so an unbilled, unpaid dossier could be closed — this is the gate that
 * fixes that, and it never mutates the dossier in 5.0B (readiness is reported,
 * not applied).
 */
export function evaluateClosureGate(executions: ExecutionView[], snap: EvidenceSnapshot): GateResult {
  const paid = fullyPaid(snap);
  const pod = podReceived(snap);

  const live = liveByKey(executions);
  const unfinished = [...live.values()].filter((e) => !isDone(e.state));
  const unverified = [...live.values()].filter((e) => e.state === "UNVERIFIED_HISTORICAL");

  const requirements: GateRequirementResult[] = [
    {
      key: "fully_paid",
      labelFr: "Paiement intégral encaissé",
      satisfied: paid,
      notApplicable: false,
      detail: paid ? undefined : "balance_outstanding",
    },
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
  ];

  const missing = requirements.filter((r) => !r.satisfied).map((r) => r.key);
  return { key: "closure_readiness", ready: missing.length === 0, requirements, missing };
}
