/**
 * Premium portal shipment cards (Phase 3.3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * BATCHED loader for the client dashboard + shipment list. Ownership is enforced
 * by the RLS user-context client (a portal user only ever resolves their own
 * client's dossiers); the full inputs for those owned ids are then read with the
 * admin client in a FIXED number of queries (no N+1) PURELY to derive the
 * customer-facing view. Reuses the EXISTING engines — getDossierLifecycle,
 * toPortalTimeline and the Risk Engine (assessRisk) — so there is no duplicated
 * lifecycle / risk / SLA calculation. Presentation-only; no RLS or schema change.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { assessRisk, overdueDays, type RiskInput } from "@/lib/copilot/risk-engine";
import { toPortalTimeline } from "./progress-map";
import { toPortalRisk, deriveEta } from "./shipment-view";
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
    | { origin: string | null; destination: string | null; transport_mode: string | null; bl_awb_ref: string | null; container_ref: string | null }[]
    | null;
};

const FILE_SELECT =
  "id, file_number, type, status, created_at, updated_at, assigned_to_user_id, account_manager_id, coordinator_id, " +
  "shipment(origin, destination, transport_mode, bl_awb_ref, container_ref)";

export async function getPortalShipments(): Promise<PortalShipmentCard[]> {
  const user = await getCurrentPortalUser();
  if (!user) return [];

  // Ownership boundary: RLS restricts this to the caller's own client's files.
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

  // Fixed set of batched reads for ALL owned files — never per-file (no N+1).
  const [docsRes, typesRes, customsRes, transportRes, invRes, officersRes] = await Promise.all([
    admin.from("document").select("file_id, type_code, status").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; type_code: string; status: string }[]>(),
    admin.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
    admin.from("customs_record").select("file_id, status, required, updated_at").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string; required: boolean; updated_at: string }[]>(),
    admin.from("transport_record").select("file_id, status, updated_at, delivery_planned, delivery_actual").eq("tenant_id", tenant).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string; updated_at: string; delivery_planned: string | null; delivery_actual: string | null }[]>(),
    admin.from("invoice").select("file_id, status, due_date, updated_at").eq("tenant_id", tenant).in("file_id", ids).returns<{ file_id: string; status: string; due_date: string | null; updated_at: string }[]>(),
    officerIds.length
      ? admin.from("app_user").select("id, name, email").eq("tenant_id", tenant).in("id", officerIds).returns<{ id: string; name: string | null; email: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string | null; email: string }[] }),
  ]);

  const docTypes = typesRes.data ?? [];
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
    const missingRequired = requiredFor(f.type).filter((code) => !approved.has(code)).map((code) => ({ label: code }));
    const cust = customsByFile.get(f.id) ?? null;
    const tr = transportByFile.get(f.id) ?? null;
    const invoices = invByFile.get(f.id) ?? [];
    const podApproved = fileDocs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

    // Reuse the lifecycle engine (single source of truth) → customer timeline.
    const lifecycle = getDossierLifecycle({
      fileId: f.id,
      file: { status: f.status, type: f.type },
      documents: fileDocs.map((d) => ({ status: d.status })),
      missingRequired,
      customs: cust ? { status: cust.status, required: cust.required } : null,
      transport: tr ? { status: tr.status } : null,
      invoices: invoices.map((i) => ({ status: i.status, balance: 0 })),
      podApproved,
    });
    const timeline = toPortalTimeline(lifecycle.steps);

    // Reuse the Risk Engine. Finance overdue is approximated from invoice
    // status + due date here (the light dashboard view); the detail page derives
    // it precisely from balances. SLA is omitted (no per-file SLA load).
    const overdue = invoices.filter(
      (i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.due_date != null && new Date(i.due_date).getTime() < now.getTime(),
    );
    const maxOverdue = overdue.reduce((m, i) => Math.max(m, overdueDays(i.due_date, now)), 0);
    const riskInput: RiskInput = {
      lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
      sla: null,
      documents: { missingRequiredCount: missingRequired.length },
      customs: cust ? { underInspection: cust.status === "INSPECTION", inspectionDays: null } : null,
      transport: tr ? { awaitingPod: tr.status === "DELIVERED" && !podApproved, transitExceedsSla: false } : null,
      finance: invoices.length ? { overdueCount: overdue.length, maxOverdueDays: maxOverdue || null } : null,
    };
    const risk = toPortalRisk(assessRisk(riskInput).level);

    const lastActivity = [f.updated_at, cust?.updated_at, tr?.updated_at, ...invoices.map((i) => i.updated_at)]
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop() ?? null;

    const eta = deriveEta({
      deliveryPlanned: tr?.delivery_planned ?? null,
      deliveryActual: tr?.delivery_actual ?? null,
      delivered: timeline.stages.find((st) => st.key === "delivered")?.status === "completed",
      lastUpdate: lastActivity,
      now,
    });

    const officerId = f.assigned_to_user_id ?? f.account_manager_id ?? f.coordinator_id;
    const officer = officerId ? officerById.get(officerId) ?? null : null;

    return {
      id: f.id,
      fileNumber: f.file_number,
      reference: s?.bl_awb_ref ?? s?.container_ref ?? null,
      type: f.type,
      origin: s?.origin ?? null,
      destination: s?.destination ?? null,
      transportMode: s?.transport_mode ?? null,
      status: f.status,
      currentStageKey: timeline.currentKey,
      percent: timeline.percent,
      officerName: officer?.name ?? officer?.email ?? null,
      eta: eta.estimated,
      lastActivity,
      risk,
    } satisfies PortalShipmentCard;
  });
}
