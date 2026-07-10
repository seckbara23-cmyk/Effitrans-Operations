/**
 * Premium portal shipment cards (Phase 3.3 / 3.3A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * BATCHED loader for the client dashboard + shipment list. Ownership is enforced
 * by the RLS user-context client; the full inputs for those owned ids are then
 * read with the admin client in a FIXED number of queries (no N+1) PURELY to
 * derive the customer-facing view. Reuses the EXISTING engines
 * (getDossierLifecycle → toPortalTimeline, the Risk Engine, the ETA engine) and
 * the pure derivers — no duplicated lifecycle / risk / route / ETA calculation.
 * Presentation-only; no RLS or schema change.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { assessRisk, type RiskInput } from "@/lib/copilot/risk-engine";
import { toPortalTimeline } from "./progress-map";
import { derivePortalEta } from "./eta";
import { resolveRoute, deriveDelay, deriveNextStep } from "./tracking-derive";
import type { PortalShipmentCard } from "./types";

type FileRow = {
  id: string;
  file_number: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to_user_id: string | null;
  account_manager_id: string | null;
  coordinator_id: string | null;
  shipment:
    | { origin: string | null; destination: string | null; transport_mode: string | null; bl_awb_ref: string | null; container_ref: string | null; eta: string | null }[]
    | null;
};

const FILE_SELECT =
  "id, file_number, type, status, created_at, updated_at, assigned_to_user_id, account_manager_id, coordinator_id, " +
  "shipment(origin, destination, transport_mode, bl_awb_ref, container_ref, eta)";

export async function getPortalShipments(): Promise<PortalShipmentCard[]> {
  const user = await getCurrentPortalUser();
  if (!user) return [];

  const ctx = getServerSupabaseClient();
  const { data: files } = await ctx
    .from("operational_file")
    .select(FILE_SELECT)
    .order("created_at", { ascending: false })
    .returns<FileRow[]>();
  if (!files?.length) return [];

  const ids = files.map((f) => f.id);
  const officerIds = Array.from(
    new Set(files.map((f) => f.assigned_to_user_id ?? f.account_manager_id ?? f.coordinator_id).filter((x): x is string => Boolean(x))),
  );
  const tenant = user.tenantId;
  const admin = getAdminSupabaseClient();
  const now = new Date();

  const [docsRes, typesRes, customsRes, transportRes, invRes, officersRes] = await Promise.all([
    admin.from("document").select("file_id, type_code, status").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; type_code: string; status: string }[]>(),
    admin.from("document_type").select("code, required_for, label_fr").eq("active", true).returns<{ code: string; required_for: string[] | null; label_fr: string | null }[]>(),
    admin.from("customs_record").select("file_id, status, required, updated_at").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string; required: boolean; updated_at: string }[]>(),
    admin.from("transport_record").select("file_id, status, updated_at, pickup_location, delivery_location, pickup_actual, delivery_planned, delivery_actual").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string; updated_at: string; pickup_location: string | null; delivery_location: string | null; pickup_actual: string | null; delivery_planned: string | null; delivery_actual: string | null }[]>(),
    admin.from("invoice").select("file_id, status, due_date, updated_at").eq("tenant_id", tenant).in("file_id", ids).returns<{ file_id: string; status: string; due_date: string | null; updated_at: string }[]>(),
    officerIds.length
      ? admin.from("app_user").select("id, name, email, is_system_admin").eq("tenant_id", tenant).in("id", officerIds).returns<{ id: string; name: string | null; email: string; is_system_admin: boolean }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string | null; email: string; is_system_admin: boolean }[] }),
  ]);

  const docTypes = typesRes.data ?? [];
  const labelByCode = new Map(docTypes.map((t) => [t.code, t.label_fr ?? t.code] as const));
  const requiredFor = (fileType: string) => docTypes.filter((t) => (t.required_for ?? []).includes(fileType)).map((t) => t.code);

  const docsByFile = new Map<string, { type_code: string; status: string }[]>();
  for (const d of docsRes.data ?? []) {
    const arr = docsByFile.get(d.file_id) ?? [];
    arr.push({ type_code: d.type_code, status: d.status });
    docsByFile.set(d.file_id, arr);
  }
  const customsByFile = new Map((customsRes.data ?? []).map((c) => [c.file_id, c]));
  const transportByFile = new Map((transportRes.data ?? []).map((tr) => [tr.file_id, tr]));
  const invByFile = new Map<string, { status: string; due_date: string | null; updated_at: string }[]>();
  for (const inv of invRes.data ?? []) {
    const arr = invByFile.get(inv.file_id) ?? [];
    arr.push({ status: inv.status, due_date: inv.due_date, updated_at: inv.updated_at });
    invByFile.set(inv.file_id, arr);
  }
  const officerById = new Map((officersRes.data ?? []).map((o) => [o.id, o]));

  return files.map((f) => {
    const s = f.shipment?.[0] ?? null;
    const fileDocs = docsByFile.get(f.id) ?? [];
    const approved = new Set(fileDocs.filter((d) => d.status === "APPROVED").map((d) => d.type_code));
    const missingCodes = requiredFor(f.type).filter((code) => !approved.has(code));
    const cust = customsByFile.get(f.id) ?? null;
    const tr = transportByFile.get(f.id) ?? null;
    const invoices = invByFile.get(f.id) ?? [];
    const podApproved = fileDocs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

    const lifecycle = getDossierLifecycle({
      fileId: f.id,
      file: { status: f.status, type: f.type },
      documents: fileDocs.map((d) => ({ status: d.status })),
      missingRequired: missingCodes.map((code) => ({ label: labelByCode.get(code) ?? code })),
      customs: cust ? { status: cust.status, required: cust.required } : null,
      transport: tr ? { status: tr.status } : null,
      invoices: invoices.map((i) => ({ status: i.status, balance: 0 })),
      podApproved,
    });
    const timeline = toPortalTimeline(lifecycle.steps);

    const awaitingPod = tr?.status === "DELIVERED" && !podApproved;
    const overdue = invoices.filter((i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.due_date != null && new Date(i.due_date).getTime() < now.getTime());
    const riskInput: RiskInput = {
      lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
      sla: null,
      documents: { missingRequiredCount: missingCodes.length },
      customs: cust ? { underInspection: cust.status === "INSPECTION", inspectionDays: null } : null,
      transport: tr ? { awaitingPod, transitExceedsSla: false } : null,
      finance: invoices.length ? { overdueCount: overdue.length, maxOverdueDays: null } : null,
    };
    const delay = deriveDelay(assessRisk(riskInput).level, {
      missingDocs: missingCodes.length,
      customsInspection: cust?.status === "INSPECTION",
      awaitingPod,
    });

    const route = resolveRoute({
      shipmentOrigin: s?.origin ?? null,
      shipmentDestination: s?.destination ?? null,
      pickupLocation: tr?.pickup_location ?? null,
      deliveryLocation: tr?.delivery_location ?? null,
    });
    const eta = derivePortalEta({
      deliveredActual: tr?.delivery_actual ?? null,
      scheduledDelivery: tr?.delivery_planned ?? null,
      transportEta: s?.eta ?? null,
      pickupActual: tr?.pickup_actual ?? null,
      currentStageKey: timeline.currentKey,
      now,
    });
    const nextStep = deriveNextStep(timeline.currentKey, { missingDocLabels: missingCodes.map((c) => labelByCode.get(c) ?? c) });

    const lastActivity = [f.updated_at, cust?.updated_at, tr?.updated_at, ...invoices.map((i) => i.updated_at)]
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop() ?? null;

    const officerId = f.assigned_to_user_id ?? f.account_manager_id ?? f.coordinator_id;
    const officer = officerId ? officerById.get(officerId) ?? null : null;
    const officerName = officer && !officer.is_system_admin && officer.name ? officer.name : null;

    return {
      id: f.id,
      fileNumber: f.file_number,
      reference: s?.bl_awb_ref ?? s?.container_ref ?? null,
      type: f.type,
      origin: s?.origin ?? null,
      destination: s?.destination ?? null,
      routeDisplay: route.display,
      transportMode: s?.transport_mode ?? null,
      status: f.status,
      currentStageKey: timeline.currentKey,
      percent: timeline.percent,
      officerName,
      eta: eta.estimatedDate,
      lastActivity,
      delayState: delay.state,
      delayLabel: delay.label,
      nextStepTitle: nextStep.title,
    } satisfies PortalShipmentCard;
  });
}
