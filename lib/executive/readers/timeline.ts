/**
 * Executive — unified operational timeline reader (Phase 7.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE chronological view across shipping / air / road / customs / customer / documents / finance.
 * There is NO executive event store and NO new event written: each origin's own rows are read
 * bounded + newest-first and PROJECTED into a common entry shape; ordering/dedup is pure
 * (mergeTimeline in ../compose).
 *
 * BOUNDED + PERMISSION-DEGRADED: one indexed, newest-first, capped query per origin, all issued
 * concurrently under Promise.allSettled. An origin the viewer cannot read (or that fails) simply
 * contributes nothing and is reported by the caller as unavailable — never rendered as "no
 * activity". No N+1: dossier labels are resolved by ONE batched lookup per origin.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";
import { airMilestoneLabel, type AirMilestone } from "@/lib/air/intelligence/milestones";
import { mergeTimeline } from "../compose";
import type { ExecutiveTimelineEntry } from "../types";

/** Rows read per origin (newest-first). The merged result is capped again by mergeTimeline. */
const PER_ORIGIN = 25;
const MERGED_CAP = 30;

type FileLabel = { file_number: string | null; client: { name: string | null } | null };
type Admin = ReturnType<typeof getAdminSupabaseClient>;

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

/** ONE batched dossier-label lookup for a set of shipment ids (never per-row). */
async function labelsForShipments(admin: Admin, tenant: string, ids: string[]) {
  const map = new Map<string, { fileId: string; label: FileLabel | null }>();
  if (!ids.length) return map;
  const { data } = await admin
    .from("shipment")
    .select("id, file_id, file:file_id(file_number, client:client_id(name))")
    .eq("tenant_id", tenant)
    .in("id", ids)
    .returns<{ id: string; file_id: string; file: FileLabel | null }[]>();
  for (const s of data ?? []) map.set(s.id, { fileId: s.file_id, label: s.file });
  return map;
}

/** ONE batched dossier-label lookup for a set of file ids. */
async function labelsForFiles(admin: Admin, tenant: string, ids: string[]) {
  const map = new Map<string, FileLabel>();
  if (!ids.length) return map;
  const { data } = await admin
    .from("operational_file")
    .select("id, file_number, client:client_id(name)")
    .eq("tenant_id", tenant)
    .in("id", ids)
    .returns<{ id: string; file_number: string | null; client: { name: string | null } | null }[]>();
  for (const f of data ?? []) map.set(f.id, { file_number: f.file_number, client: f.client });
  return map;
}

export type TimelineResult = {
  entries: ExecutiveTimelineEntry[];
  /** origins that could not be read (unauthorized or failed) — Missing ≠ Negative */
  unavailable: string[];
};

export async function readExecutiveTimeline(): Promise<TimelineResult> {
  const user = await assertPermission("executive:dashboard:read");
  const perms = await getEffectivePermissions(user.id);
  const can = {
    transport: hasPermission(perms, "transport:read"),
    customs: hasPermission(perms, "customs:read"),
    document: hasPermission(perms, "document:read"),
    finance: hasPermission(perms, "finance:read"),
    client: hasPermission(perms, "client:read"),
  };
  const admin = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const unavailable: string[] = [];
  const deny = () => Promise.reject(new Error("unauthorized"));

  const [oceanR, airR, roadR, customsR, customerR, docsR, financeR] = await Promise.allSettled([
    can.transport
      ? admin.from("ocean_tracking_event").select("shipment_id, event_type, occurred_at")
          .eq("tenant_id", tenant).order("occurred_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ shipment_id: string; event_type: string; occurred_at: string }[]>()
      : deny(),
    can.transport
      ? admin.from("air_tracking_event").select("shipment_id, event_type, occurred_at")
          .eq("tenant_id", tenant).order("occurred_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ shipment_id: string; event_type: string; occurred_at: string }[]>()
      : deny(),
    can.transport
      ? admin.from("transport_record").select("file_id, status, updated_at")
          .eq("tenant_id", tenant).is("deleted_at", null).order("updated_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ file_id: string; status: string; updated_at: string }[]>()
      : deny(),
    can.customs
      ? admin.from("customs_record").select("file_id, status, updated_at")
          .eq("tenant_id", tenant).is("deleted_at", null).order("updated_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ file_id: string; status: string; updated_at: string }[]>()
      : deny(),
    can.client
      ? admin.from("client_notification").select("title, category, file_id, created_at")
          .eq("tenant_id", tenant).order("created_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ title: string; category: string; file_id: string | null; created_at: string }[]>()
      : deny(),
    can.document
      ? admin.from("document").select("file_id, type_code, status, updated_at")
          .eq("tenant_id", tenant).is("deleted_at", null).order("updated_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ file_id: string; type_code: string; status: string; updated_at: string }[]>()
      : deny(),
    can.finance
      ? admin.from("invoice").select("file_id, invoice_number, status, updated_at")
          .eq("tenant_id", tenant).order("updated_at", { ascending: false }).limit(PER_ORIGIN)
          .returns<{ file_id: string; invoice_number: string | null; status: string; updated_at: string }[]>()
      : deny(),
  ]);

  const ocean = settled(oceanR)?.data ?? (oceanR.status === "rejected" ? (unavailable.push("shipping"), []) : []);
  const air = settled(airR)?.data ?? (airR.status === "rejected" ? (unavailable.push("air"), []) : []);
  const road = settled(roadR)?.data ?? (roadR.status === "rejected" ? (unavailable.push("road"), []) : []);
  const customs = settled(customsR)?.data ?? (customsR.status === "rejected" ? (unavailable.push("customs"), []) : []);
  const customer = settled(customerR)?.data ?? (customerR.status === "rejected" ? (unavailable.push("customer"), []) : []);
  const docs = settled(docsR)?.data ?? (docsR.status === "rejected" ? (unavailable.push("documents"), []) : []);
  const finance = settled(financeR)?.data ?? (financeR.status === "rejected" ? (unavailable.push("finance"), []) : []);

  // Two batched label lookups total — never one per row.
  const [shipLabels, fileLabels] = await Promise.all([
    labelsForShipments(admin, tenant, [...ocean.map((e) => e.shipment_id), ...air.map((e) => e.shipment_id)]),
    labelsForFiles(admin, tenant, [
      ...road.map((r) => r.file_id),
      ...customs.map((r) => r.file_id),
      ...docs.map((r) => r.file_id),
      ...finance.map((r) => r.file_id),
      ...customer.map((r) => r.file_id).filter((x): x is string => Boolean(x)),
    ]),
  ]);

  const entries: ExecutiveTimelineEntry[] = [];

  for (const e of ocean) {
    const s = shipLabels.get(e.shipment_id);
    entries.push({ at: e.occurred_at, origin: "shipping", title: milestoneLabel(e.event_type as ShippingMilestone), reference: s?.label?.file_number ?? null, clientName: s?.label?.client?.name ?? null, href: `/shipping/shipments/${e.shipment_id}` });
  }
  for (const e of air) {
    const s = shipLabels.get(e.shipment_id);
    entries.push({ at: e.occurred_at, origin: "air", title: airMilestoneLabel(e.event_type as AirMilestone), reference: s?.label?.file_number ?? null, clientName: s?.label?.client?.name ?? null, href: `/air/shipments/${e.shipment_id}` });
  }
  for (const r of road) {
    const f = fileLabels.get(r.file_id);
    entries.push({ at: r.updated_at, origin: "road", title: `Transport — ${r.status}`, reference: f?.file_number ?? null, clientName: f?.client?.name ?? null, href: `/files/${r.file_id}` });
  }
  for (const r of customs) {
    const f = fileLabels.get(r.file_id);
    entries.push({ at: r.updated_at, origin: "customs", title: `Douane — ${r.status}`, reference: f?.file_number ?? null, clientName: f?.client?.name ?? null, href: `/files/${r.file_id}` });
  }
  for (const n of customer) {
    const f = n.file_id ? fileLabels.get(n.file_id) : null;
    entries.push({ at: n.created_at, origin: "customer", title: n.title, reference: f?.file_number ?? null, clientName: f?.client?.name ?? null, href: n.file_id ? `/files/${n.file_id}` : "/clients" });
  }
  for (const d of docs) {
    const f = fileLabels.get(d.file_id);
    entries.push({ at: d.updated_at, origin: "documents", title: `${d.type_code} — ${d.status}`, reference: f?.file_number ?? null, clientName: f?.client?.name ?? null, href: `/files/${d.file_id}` });
  }
  for (const i of finance) {
    const f = fileLabels.get(i.file_id);
    entries.push({ at: i.updated_at, origin: "finance", title: `Facture ${i.invoice_number ?? "—"} — ${i.status}`, reference: f?.file_number ?? null, clientName: f?.client?.name ?? null, href: `/files/${i.file_id}` });
  }

  return { entries: mergeTimeline(entries, MERGED_CAP), unavailable };
}
