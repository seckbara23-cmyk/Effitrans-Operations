/**
 * Logistics Command Center — server reader (Phase 7.3C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Composes the Command Center by calling each domain's EXISTING bounded read service
 * (road / ocean / air / customs). No new domain calculation. Every module read is isolated
 * (Promise.allSettled) so one failure or missing permission degrades ONLY its section — the
 * page never crashes. Tenant + actor are resolved server-side; admin reads are tenant-filtered.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getTransportQueue } from "@/lib/transport/service";
import { transportCards } from "@/lib/departments/classify";
import { readyForDispatchCount } from "@/lib/handoffs/service";
import { getShippingDashboard, listOceanShipments } from "@/lib/shipping/intelligence/service";
import { getAttentionQueue } from "@/lib/shipping/intelligence/manage-service";
import { milestoneLabel } from "@/lib/shipping/intelligence/milestones";
import { getAirDashboard, listAirShipments } from "@/lib/air/intelligence/service";
import { getAirAttentionQueue } from "@/lib/air/intelligence/manage-service";
import { airMilestoneLabel } from "@/lib/air/intelligence/milestones";
import { getIntelligenceDashboard } from "@/lib/customs/intelligence/service";
import { getReviewQueueSummary } from "@/lib/docintel/service";
import {
  platformState, mergeAttention, headlineKpis, sortUpcoming, countBySeverity,
  type ModuleSummary, type PlatformState, type UnifiedAlert, type UpcomingMovement, type HeadlineKpis,
  type RoadKpis, type OceanKpis, type AirKpis, type CustomsKpis,
} from "./compose";

const DAY = 86_400_000;
type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type PlatformCard = { mode: "road" | "ocean" | "air" | "customs"; available: boolean; state: PlatformState; kpis: { label: string; value: number }[] };
export type JourneyRow = { fileNumber: string | null; clientName: string | null; ocean: string | null; air: string | null; customs: string | null; road: string | null };
export type RoadQueueRow = { id: string; fileId: string; fileNumber: string | null; clientName: string | null; status: string; driverName: string | null; vehiclePlate: string | null; deliveryPlanned: string | null };
export type CommandCenter = {
  headline: HeadlineKpis;
  cards: PlatformCard[];
  attention: UnifiedAlert[];
  upcoming: UpcomingMovement[];
  journey: JourneyRow[];
  roadRows: RoadQueueRow[];
  roadAvailable: boolean;
  customsAuthorized: boolean;
  docIntel: { readyForReview: number; failed: number } | null; // bounded indicator (document:read)
};

const ACTIVE_ROAD = ["NOT_STARTED", "PLANNED", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

// ---------------------------------------------------------------- road ----
async function loadRoad(nowMs: number) {
  const [rows, ready] = await Promise.all([getTransportQueue(), readyForDispatchCount().catch(() => 0)]);
  const cards = transportCards(rows);
  const overdueRows = rows.filter((r) => ACTIVE_ROAD.includes(r.status) && r.status !== "DELIVERED" && r.deliveryPlanned && new Date(r.deliveryPlanned).getTime() < nowMs);
  const kpis: RoadKpis = { readyForDispatch: ready || cards.readyForDispatch, assigned: cards.assigned, inTransit: cards.inTransit, podRequired: cards.podRequired, overdue: overdueRows.length };
  const attention: UnifiedAlert[] = [
    ...overdueRows.slice(0, 6).map((r): UnifiedAlert => ({ mode: "road", severity: "warning", reference: r.fileNumber, clientName: r.clientName, reason: "Livraison routière en retard", link: `/files/${r.fileId}`, occurredAt: r.deliveryPlanned })),
    ...rows.filter((r) => r.status === "DELIVERED").slice(0, 4).map((r): UnifiedAlert => ({ mode: "road", severity: "warning", reference: r.fileNumber, clientName: r.clientName, reason: "POD requis", link: `/files/${r.fileId}` })),
  ];
  const upcoming: UpcomingMovement[] = rows
    .filter((r) => r.deliveryPlanned && ACTIVE_ROAD.includes(r.status) && r.status !== "DELIVERED" && new Date(r.deliveryPlanned).getTime() >= nowMs - DAY && new Date(r.deliveryPlanned).getTime() <= nowMs + 2 * DAY)
    .map((r): UpcomingMovement => ({ mode: "road", reference: r.fileNumber, clientName: r.clientName, route: "— → livraison", at: r.deliveryPlanned as string, status: r.status, link: `/files/${r.fileId}` }));
  const queue: RoadQueueRow[] = rows.slice(0, 20).map((r) => ({ id: r.id, fileId: r.fileId, fileNumber: r.fileNumber, clientName: r.clientName, status: r.status, driverName: r.driverName, vehiclePlate: r.vehiclePlate, deliveryPlanned: r.deliveryPlanned }));
  return { kpis, attention, upcoming, hasData: rows.length > 0, queue };
}

// ---------------------------------------------------------------- ocean ----
async function loadOcean(nowMs: number) {
  const [{ dashboard }, attn, list] = await Promise.all([getShippingDashboard(), getAttentionQueue(), listOceanShipments({}, 0)]);
  const kpis: OceanKpis = { inTransit: dashboard.inTransit, containersLoaded: dashboard.containersLoaded, arriving7d: dashboard.vesselsArrivingWithin7Days, delayed: dashboard.delayed, stale: dashboard.staleTracking, exceptions: dashboard.exceptions, awaitingCustoms: dashboard.containersAwaitingCustoms };
  const attention: UnifiedAlert[] = attn.slice(0, 8).map((q): UnifiedAlert => { const a = q.alerts[0]; return { mode: "ocean", severity: a.severity, reference: q.fileNumber, clientName: q.clientName, reason: a.message, link: `/shipping/shipments/${q.shipmentId}` }; });
  const upcoming: UpcomingMovement[] = list.items
    .filter((s) => s.estimatedArrival && new Date(s.estimatedArrival).getTime() >= nowMs - DAY && new Date(s.estimatedArrival).getTime() <= nowMs + 7 * DAY)
    .map((s): UpcomingMovement => ({ mode: "ocean", reference: s.fileNumber, clientName: s.clientName, route: `${s.origin ?? "—"} → ${s.destination ?? "—"}`, at: s.estimatedArrival as string, status: s.milestoneLabel, link: `/shipping/shipments/${s.id}` }));
  return { kpis, attention, upcoming, hasData: dashboard.total > 0 };
}

// ---------------------------------------------------------------- air ----
async function loadAir(nowMs: number) {
  const [{ dashboard }, attn, list] = await Promise.all([getAirDashboard(), getAirAttentionQueue(), listAirShipments({}, 0)]);
  const kpis: AirKpis = { flightsToday: dashboard.flightsToday, awaitingLoading: dashboard.awaitingLoading, inFlight: dashboard.inFlight, arriving: dashboard.arriving, delayed: dashboard.delayed, exceptions: dashboard.exceptions };
  const attention: UnifiedAlert[] = attn.slice(0, 8).map((q): UnifiedAlert => { const a = q.alerts[0]; return { mode: "air", severity: a.severity, reference: q.fileNumber, clientName: q.clientName, reason: a.message, link: `/air/shipments/${q.shipmentId}` }; });
  const upcoming: UpcomingMovement[] = list.items
    .filter((s) => s.estimatedArrival && new Date(s.estimatedArrival).getTime() >= nowMs - DAY && new Date(s.estimatedArrival).getTime() <= nowMs + 3 * DAY)
    .map((s): UpcomingMovement => ({ mode: "air", reference: s.fileNumber, clientName: s.clientName, route: `${s.origin ?? "—"} → ${s.destination ?? "—"}`, at: s.estimatedArrival as string, status: s.milestoneLabel, link: `/air/shipments/${s.id}` }));
  return { kpis, attention, upcoming, hasData: dashboard.total > 0 };
}

// ---------------------------------------------------------------- customs ----
async function loadCustoms() {
  const { dashboard } = await getIntelligenceDashboard();
  const sb = dashboard.statusBreakdown;
  const blockedRejected = (sb.REJECTED ?? 0) + (sb.CANCELLED ?? 0);
  const awaitingPayment = sb.AWAITING_PAYMENT ?? 0;
  const kpis: CustomsKpis = { pending: dashboard.pending, inspection: dashboard.inspectionQueueSize, awaitingPayment, released: dashboard.released, blockedRejected };
  const attention: UnifiedAlert[] = [];
  if (blockedRejected > 0) attention.push({ mode: "customs", severity: "critical", reference: null, clientName: null, reason: `${blockedRejected} déclaration(s) bloquée(s) / rejetée(s)`, link: "/customs/intelligence" });
  if (dashboard.inspectionQueueSize > 0) attention.push({ mode: "customs", severity: "warning", reference: null, clientName: null, reason: `${dashboard.inspectionQueueSize} en inspection`, link: "/customs/intelligence" });
  if (awaitingPayment > 0) attention.push({ mode: "customs", severity: "warning", reference: null, clientName: null, reason: `${awaitingPayment} en attente de paiement`, link: "/customs/intelligence" });
  return { kpis, attention, hasData: dashboard.total > 0 };
}

// ---------------------------------------------------------------- journey snapshot (batched) ----
async function loadJourney(admin: Admin, tenantId: string, includeCustoms: boolean): Promise<JourneyRow[]> {
  const { data: files } = await admin.from("operational_file").select("id, file_number, client:client_id(name)").eq("tenant_id", tenantId).neq("status", "CLOSED").order("updated_at", { ascending: false }).limit(8).returns<{ id: string; file_number: string; client: { name: string } | null }[]>();
  const ids = (files ?? []).map((f) => f.id);
  if (ids.length === 0) return [];
  const [ships, custs, trans] = await Promise.all([
    admin.from("shipment").select("file_id, transport_mode, ocean_milestone, air_milestone").eq("tenant_id", tenantId).in("file_id", ids).returns<{ file_id: string; transport_mode: string | null; ocean_milestone: string; air_milestone: string }[]>(),
    includeCustoms ? admin.from("customs_record").select("file_id, status").eq("tenant_id", tenantId).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string }[]>() : Promise.resolve({ data: [] as { file_id: string; status: string }[] }),
    admin.from("transport_record").select("file_id, status").eq("tenant_id", tenantId).in("file_id", ids).is("deleted_at", null).returns<{ file_id: string; status: string }[]>(),
  ]);
  const shipBy = new Map((ships.data ?? []).map((s) => [s.file_id, s]));
  const custBy = new Map((custs.data ?? []).map((c) => [c.file_id, c]));
  const transBy = new Map((trans.data ?? []).map((t) => [t.file_id, t]));
  return (files ?? []).map((f): JourneyRow => {
    const s = shipBy.get(f.id);
    const ocean = s && (s.transport_mode === "SEA" || s.transport_mode === "MULTIMODAL") ? milestoneLabel(s.ocean_milestone as never) : null;
    const air = s && s.transport_mode === "AIR" ? airMilestoneLabel(s.air_milestone as never) : null;
    return { fileNumber: f.file_number, clientName: f.client?.name ?? null, ocean, air, customs: custBy.get(f.id)?.status ?? null, road: transBy.get(f.id)?.status ?? null };
  });
}

function summary(available: boolean, hasData: boolean, critical: number, warning: number): ModuleSummary {
  return { available, hasData, critical, warning };
}
function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

// Phase 10.0B — request-level cache(): the Command Center page, the executive reader and the
// cockpit composition share ONE multi-modal read per render (zero-arg ⇒ perfect memoization).
export const getCommandCenter = cache(async (): Promise<CommandCenter> => {
  const user = await assertPermission("transport:read"); // baseline (this IS the transport dept)
  const perms = await getEffectivePermissions(user.id);
  const canCustoms = hasPermission(perms, "customs:read");
  const admin = getAdminSupabaseClient();
  const now = new Date();
  const nowMs = now.getTime();

  const [roadR, oceanR, airR, customsR, journeyR, docIntelR] = await Promise.allSettled([
    loadRoad(nowMs), loadOcean(nowMs), loadAir(nowMs),
    canCustoms ? loadCustoms() : Promise.reject(new Error("unauthorized")),
    loadJourney(admin, user.tenantId, canCustoms),
    getReviewQueueSummary(), // document:read; degrades to null if unauthorized
  ]);
  const road = settled(roadR), ocean = settled(oceanR), air = settled(airR), customs = settled(customsR);
  const dq = settled(docIntelR);
  const docIntel = dq ? { readyForReview: dq.readyForReview, failed: dq.failed } : null;

  const attention = mergeAttention([...(road?.attention ?? []), ...(ocean?.attention ?? []), ...(air?.attention ?? []), ...(customs?.attention ?? [])]);
  const upcoming = sortUpcoming([...(road?.upcoming ?? []), ...(ocean?.upcoming ?? []), ...(air?.upcoming ?? [])]);
  const headline = headlineKpis({ ocean: ocean?.kpis ?? null, air: air?.kpis ?? null, road: road?.kpis ?? null, customs: customs?.kpis ?? null, criticalAlerts: countBySeverity(attention, "critical") });

  const cards: PlatformCard[] = [
    { mode: "road", available: !!road, state: platformState(summary(!!road, road?.hasData ?? false, 0, (road?.kpis.overdue ?? 0) + (road?.kpis.podRequired ?? 0))), kpis: road ? [{ label: "Prêt au dispatch", value: road.kpis.readyForDispatch }, { label: "Chauffeur affecté", value: road.kpis.assigned }, { label: "En transit", value: road.kpis.inTransit }, { label: "POD requis", value: road.kpis.podRequired }, { label: "En retard", value: road.kpis.overdue }] : [] },
    { mode: "ocean", available: !!ocean, state: platformState(summary(!!ocean, ocean?.hasData ?? false, ocean?.kpis.exceptions ?? 0, (ocean?.kpis.delayed ?? 0) + (ocean?.kpis.stale ?? 0))), kpis: ocean ? [{ label: "En transit", value: ocean.kpis.inTransit }, { label: "Conteneurs chargés", value: ocean.kpis.containersLoaded }, { label: "Arrivées 7 j", value: ocean.kpis.arriving7d }, { label: "Retards", value: ocean.kpis.delayed }, { label: "Suivi ancien", value: ocean.kpis.stale }, { label: "Exceptions", value: ocean.kpis.exceptions }] : [] },
    { mode: "air", available: !!air, state: platformState(summary(!!air, air?.hasData ?? false, air?.kpis.exceptions ?? 0, air?.kpis.delayed ?? 0)), kpis: air ? [{ label: "Vols aujourd'hui", value: air.kpis.flightsToday }, { label: "Attente chargement", value: air.kpis.awaitingLoading }, { label: "En vol", value: air.kpis.inFlight }, { label: "Arrivées proches", value: air.kpis.arriving }, { label: "Retards", value: air.kpis.delayed }, { label: "Exceptions", value: air.kpis.exceptions }] : [] },
    { mode: "customs", available: !!customs, state: platformState(summary(!!customs, customs?.hasData ?? false, customs?.kpis.blockedRejected ?? 0, (customs?.kpis.inspection ?? 0) + (customs?.kpis.awaitingPayment ?? 0))), kpis: customs ? [{ label: "En cours", value: customs.kpis.pending }, { label: "Inspections", value: customs.kpis.inspection }, { label: "Attente paiement", value: customs.kpis.awaitingPayment }, { label: "Mainlevées", value: customs.kpis.released }, { label: "Bloquées/rejetées", value: customs.kpis.blockedRejected }] : [] },
  ];

  return { headline, cards, attention, upcoming, journey: settled(journeyR) ?? [], roadRows: road?.queue ?? [], roadAvailable: !!road, customsAuthorized: canCustoms, docIntel };
});
