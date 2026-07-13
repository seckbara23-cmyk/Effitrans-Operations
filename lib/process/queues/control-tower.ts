/**
 * Coordinator process tower (Phase 5.0C, Deliverable 4). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * This UPGRADES the existing Control Tower (/dashboard) — it does not create a
 * second one. It adds a process-driven section computed from the Phase 5.0B
 * engine and gates; the existing funnel/SLA/risk sections are untouched, and with
 * the workspaces flag off this returns null and /dashboard is unchanged.
 *
 * All workflow logic comes from the engine. Nothing is reconstructed here.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "../config";
import { evaluateBranch, type ExecutionView } from "../engine/state";
import { evaluatePickupGate } from "../engine/gates";
import type { EvidenceSnapshot } from "../engine/evidence";
import { OPEN_STATES, isDone } from "../engine/types";

export type TowerBucket = {
  key: string;
  labelFr: string;
  count: number;
  /** Where the Coordinator goes to act on it. */
  href: string;
};

export type ProcessTower = {
  intake: TowerBucket[];
  customs: TowerBucket[];
  parallel: TowerBucket[];
  postDelivery: TowerBucket[];
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * The Coordinator's view of the whole official process. Bounded: 6 queries total,
 * independent of dossier count (capped at 2000 open executions).
 */
export async function getProcessTower(
  tenantId: string,
  permissions: string[],
): Promise<ProcessTower | null> {
  if (!getProcessFlags().workspaces) return null;
  if (!hasPermission(permissions, "process:read")) return null;

  const admin = getAdminSupabaseClient();

  const [{ data: execRows }, { data: handoffRows }, { data: instRows }] = await Promise.all([
    scopedFrom(admin, "process_step_execution", tenantId)
      .select("process_instance_id, step_key, state, correction_of_id")
      .limit(4000),
    scopedFrom(admin, "process_handoff", tenantId).select("process_instance_id, status, to_step_key").limit(2000),
    scopedFrom(admin, "process_instance", tenantId).select("id, file_id").neq("status", "CANCELLED").limit(2000),
  ]);

  const instances = (instRows ?? []) as Row[];
  if (instances.length === 0) return { intake: [], customs: [], parallel: [], postDelivery: [] };

  const fileIds = instances.map((i) => i.file_id as string);

  const [{ data: cusRows }, { data: trnRows }, { data: docRows }] = await Promise.all([
    hasPermission(permissions, "customs:read")
      ? scopedFrom(admin, "customs_record", tenantId).select("file_id, required, status, bae_reference").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    hasPermission(permissions, "transport:read")
      ? scopedFrom(admin, "transport_record", tenantId).select("file_id, status, vehicle_plate, driver_name, driver_user_id").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    hasPermission(permissions, "document:read")
      ? scopedFrom(admin, "document", tenantId).select("file_id, type_code, status").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    ]);

  const execsByInstance = new Map<string, Row[]>();
  for (const e of (execRows ?? []) as Row[]) {
    const k = e.process_instance_id as string;
    const l = execsByInstance.get(k);
    if (l) l.push(e);
    else execsByInstance.set(k, [e]);
  }
  const customsByFile = new Map(((cusRows ?? []) as Row[]).map((c) => [c.file_id as string, c]));
  const transportByFile = new Map(((trnRows ?? []) as Row[]).map((t) => [t.file_id as string, t]));
  const docsByFile = new Map<string, Row[]>();
  for (const d of (docRows ?? []) as Row[]) {
    const k = d.file_id as string;
    const l = docsByFile.get(k);
    if (l) l.push(d);
    else docsByFile.set(k, [d]);
  }

  const handoffs = (handoffRows ?? []) as Row[];
  const unreceived = handoffs.filter((h) => h.status === "SENT").length;
  const rejectedHandoffs = handoffs.filter((h) => h.status === "REJECTED").length;

  // Counters.
  const c = {
    awaitingReception: 0,
    awaitingTransmission: 0,
    waitingChiefTransit: 0,
    waitingDeclarantPrep: 0,
    waitingChiefValidation: 0,
    waitingGaindeRegistration: 0,
    waitingGaindeDocs: 0,
    customsFollowUp: 0,
    waitingFieldAgent: 0,
    baeMissing: 0,
    baeObtained: 0,
    customsReadyTransportNot: 0,
    transportReadyCustomsNot: 0,
    missingBad: 0,
    missingPreGate: 0,
    missingBl: 0,
    missingVehicle: 0,
    missingDriver: 0,
    pickupReady: 0,
    deliveredNoPod: 0,
    podAwaitingCompleteness: 0,
    completenessRejected: 0,
    awaitingAmVerification: 0,
    billingReady: 0,
    deliveredFinanciallyOpen: 0,
  };

  const OPEN = new Set<string>(OPEN_STATES);
  const isOpenAt = (execs: Row[], key: string) =>
    execs.some((e) => e.step_key === key && OPEN.has(e.state as string));

  for (const inst of instances) {
    const execs = execsByInstance.get(inst.id as string) ?? [];
    if (execs.length === 0) continue;
    const fileId = inst.file_id as string;

    const views: ExecutionView[] = execs.map((e) => ({
      stepKey: e.step_key as string,
      state: e.state as ExecutionView["state"],
    }));

    const cus = customsByFile.get(fileId);
    const trn = transportByFile.get(fileId);
    const docs = docsByFile.get(fileId) ?? [];

    const snap: EvidenceSnapshot = {
      fileType: "IMP",
      access: { documents: true, customs: true, transport: true, finance: true },
      documents: docs.map((d) => ({ typeCode: d.type_code as string, status: d.status as string })),
      customs: cus
        ? {
            required: Boolean(cus.required),
            status: cus.status as string,
            baeReference: str(cus.bae_reference),
            declarationNumber: null,
            externalRef: null,
          }
        : null,
      transport: trn
        ? {
            status: trn.status as string,
            vehiclePlate: str(trn.vehicle_plate),
            driverName: str(trn.driver_name),
            driverUserId: str(trn.driver_user_id),
          }
        : null,
      invoices: [],
    };

    // Intake / handoffs.
    if (isOpenAt(execs, "coordinator_reception")) c.awaitingReception++;
    if (isOpenAt(execs, "coordinator_to_finance") || isOpenAt(execs, "coordinator_to_declarant")) {
      c.awaitingTransmission++;
    }

    // Customs progression — each official waiting state, separately.
    if (isOpenAt(execs, "transit_declarant_assignment")) c.waitingChiefTransit++;
    if (isOpenAt(execs, "customs_preparation")) c.waitingDeclarantPrep++;
    if (isOpenAt(execs, "transit_validation")) c.waitingChiefValidation++;
    if (isOpenAt(execs, "gainde_registration")) c.waitingGaindeRegistration++;
    if (isOpenAt(execs, "gainde_document_submission")) c.waitingGaindeDocs++;
    if (isOpenAt(execs, "customs_followup")) c.customsFollowUp++;
    if (isOpenAt(execs, "customs_field_clearance")) c.waitingFieldAgent++;

    const baeOk = typeof cus?.bae_reference === "string" && (cus.bae_reference as string).trim() !== "";
    if (cus?.required && !baeOk) c.baeMissing++;
    if (baeOk) c.baeObtained++;

    // Parallel readiness — the two mismatch buckets the official process cares about.
    const gate = evaluatePickupGate(snap, views);
    const customsBranch = evaluateBranch("customs", views);
    const transportBranch = evaluateBranch("transport_readiness", views);

    if (gate.ready) c.pickupReady++;
    if (customsBranch.complete && !transportBranch.complete) c.customsReadyTransportNot++;
    if (transportBranch.complete && !customsBranch.complete) c.transportReadyCustomsNot++;

    for (const r of gate.requirements) {
      if (r.satisfied || r.notApplicable) continue;
      if (r.key === "bon_a_delivrer") c.missingBad++;
      if (r.key === "pre_gate") c.missingPreGate++;
      if (r.key === "bordereau_livraison") c.missingBl++;
      if (r.key === "vehicle_assigned") c.missingVehicle++;
      if (r.key === "driver_assigned") c.missingDriver++;
    }

    // Post-delivery.
    const podApproved = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");
    if (trn?.status === "DELIVERED" && !podApproved) c.deliveredNoPod++;
    if (podApproved && isOpenAt(execs, "coordinator_completeness")) c.podAwaitingCompleteness++;
    if (execs.some((e) => e.step_key === "coordinator_completeness" && e.correction_of_id !== null)) {
      c.completenessRejected++;
    }
    if (isOpenAt(execs, "am_completeness")) c.awaitingAmVerification++;
    if (isOpenAt(execs, "billing_draft")) c.billingReady++;

    const collectionsDone = execs.some((e) => e.step_key === "collections" && isDone(e.state as never));
    if (trn?.status === "DELIVERED" && !collectionsDone) c.deliveredFinanciallyOpen++;
  }

  const B = (key: string, labelFr: string, count: number, href: string): TowerBucket => ({
    key,
    labelFr,
    count,
    href,
  });

  return {
    intake: [
      B("await_reception", "En attente de réception Coordinateur", c.awaitingReception, "/queues/coordination?unreceived=1"),
      B("await_transmission", "En attente de transmission", c.awaitingTransmission, "/queues/coordination"),
      B("handoff_unreceived", "Transferts non réceptionnés", unreceived, "/queues/coordination?unreceived=1"),
      B("handoff_rejected", "Transferts rejetés", rejectedHandoffs, "/queues/coordination?rejected=1"),
    ],
    customs: [
      B("await_chief", "Affectation Déclarant en attente", c.waitingChiefTransit, "/queues/transit"),
      B("await_prep", "Préparation douane en attente", c.waitingDeclarantPrep, "/queues/customs_declaration"),
      B("await_validation", "Validation Chef de Transit en attente", c.waitingChiefValidation, "/queues/transit"),
      B("await_gainde_reg", "Enregistrement GAINDE en attente", c.waitingGaindeRegistration, "/queues/finance_customs"),
      B("await_gainde_docs", "Documents GAINDE en attente", c.waitingGaindeDocs, "/queues/customs_declaration"),
      B("customs_followup", "Suivi douane en cours", c.customsFollowUp, "/queues/coordination"),
      B("await_field", "Agent de terrain en attente", c.waitingFieldAgent, "/queues/customs_field"),
      B("bae_missing", "BAE manquant", c.baeMissing, "/queues/customs_field"),
      B("bae_obtained", "BAE obtenu", c.baeObtained, "/queues/customs_field"),
    ],
    parallel: [
      B("customs_ready_transport_not", "Douane prête, transport non prêt", c.customsReadyTransportNot, "/queues/transport"),
      B("transport_ready_customs_not", "Transport prêt, douane non libérée", c.transportReadyCustomsNot, "/queues/customs_field"),
      B("missing_bad", "Bon à Délivrer manquant", c.missingBad, "/queues/account_management"),
      B("missing_pregate", "Pre-Gate manquant", c.missingPreGate, "/queues/account_management"),
      B("missing_bl", "Bordereau de Livraison manquant", c.missingBl, "/queues/account_management"),
      B("missing_vehicle", "Véhicule non affecté", c.missingVehicle, "/queues/transport"),
      B("missing_driver", "Chauffeur non affecté", c.missingDriver, "/queues/transport"),
      B("pickup_ready", "Porte d'enlèvement satisfaite", c.pickupReady, "/queues/pickup"),
    ],
    postDelivery: [
      B("delivered_no_pod", "Livré, bordereau signé manquant", c.deliveredNoPod, "/queues/transport"),
      B("pod_await_completeness", "POD reçu, complétude Coordinateur en attente", c.podAwaitingCompleteness, "/queues/coordination"),
      B("completeness_rejected", "Complétude rejetée", c.completenessRejected, "/queues/coordination?rejected=1"),
      B("await_am_verification", "Vérification Account Manager en attente", c.awaitingAmVerification, "/queues/account_management"),
      B("billing_ready", "Prêt à facturer", c.billingReady, "/queues/billing"),
      B("delivered_open", "Livré mais financièrement ouvert", c.deliveredFinanciallyOpen, "/queues/collections"),
    ],
  };
}
