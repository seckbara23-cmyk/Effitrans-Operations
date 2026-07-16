"use server";

/**
 * Air Cargo — manual tracking + provider refresh (Phase 7.3A). SERVER ACTIONS. Sibling of the
 * shipping actions. Tenant + actor from the SESSION. transport:update for manual events;
 * transport:manage for provider refresh. Validated, MANUAL-labelled, deduped (fingerprint),
 * compare-and-set on air_tracking_version. Safe audit (no coordinates). Reuses the generic
 * event fingerprint helper — no duplicate tracking engine.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { AirCargoEngine, resolveAirProvider, mapAirlineStatus } from "./provider";
import { isAirEvent, airEventIsMilestone } from "./events";
import { eventFingerprint } from "@/lib/shipping/intelligence/events";
import { classifyAirMilestone, isAirMilestone, type AirMilestone } from "./milestones";
import { coerceAirMilestone } from "./persistence";
import { isValidCoordinate } from "@/lib/shipping/intelligence/validators";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export type AirActionResult = { ok: true; milestone?: AirMilestone; version?: number } | { ok: false; error: string };
const TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((r) => { timer = setTimeout(() => r(onTimeout), ms); });
  try { return await Promise.race([p, guard]); } finally { if (timer) clearTimeout(timer); }
}

export type ManualAirEventInput = {
  eventType: string; occurredAt: string; uldId?: string | null; locationName?: string | null; locationIata?: string | null;
  latitude?: number | null; longitude?: number | null; flightNumber?: string | null; description?: string | null; confirmCorrection?: boolean;
};

type ShipLite = { id: string; tenant_id: string; transport_mode: string | null; air_milestone: string; air_provider_code: string; air_tracking_version: number };
async function load(admin: Admin, id: string, tenantId: string): Promise<ShipLite | null> {
  const { data } = await admin.from("shipment").select("id, tenant_id, transport_mode, air_milestone, air_provider_code, air_tracking_version").eq("id", id).eq("tenant_id", tenantId).maybeSingle<ShipLite>();
  return data ?? null;
}
function rv(id: string) { revalidatePath("/air"); revalidatePath("/air/shipments"); revalidatePath(`/air/shipments/${id}`); }

export async function addManualAirEvent(shipmentId: string, input: ManualAirEventInput): Promise<AirActionResult> {
  let user; try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!isAirEvent(input.eventType)) return { ok: false, error: "invalid_event_type" };
  const occurred = new Date(input.occurredAt);
  if (!Number.isFinite(occurred.getTime())) return { ok: false, error: "invalid_timestamp" };
  const hasCoord = input.latitude != null || input.longitude != null;
  if (hasCoord && !(input.latitude != null && input.longitude != null && isValidCoordinate(input.latitude, input.longitude))) return { ok: false, error: "invalid_coordinate" };

  const admin = getAdminSupabaseClient();
  const s = await load(admin, shipmentId, user.tenantId);
  if (!s) return { ok: false, error: "not_found" };
  if (s.transport_mode !== "AIR") return { ok: false, error: "not_air" };

  const current = coerceAirMilestone(s.air_milestone);
  const isMs = airEventIsMilestone(input.eventType as never);
  if (isMs && isAirMilestone(input.eventType)) {
    const verdict = classifyAirMilestone(current, input.eventType as AirMilestone);
    if (!verdict.ok) return { ok: false, error: verdict.reason };
    if (verdict.kind === "regress" && !input.confirmCorrection) return { ok: false, error: "confirmation_required" };
  }

  const occurredAt = occurred.toISOString();
  const iata = input.locationIata ? input.locationIata.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || null : null;
  const fingerprint = eventFingerprint({ shipmentId, containerId: input.uldId ?? null, eventType: input.eventType, occurredAt, location: { name: input.locationName ?? null, unlocode: iata, latitude: input.latitude ?? null, longitude: input.longitude ?? null } });

  const { error: insErr } = await admin.from("air_tracking_event").insert({
    tenant_id: user.tenantId, shipment_id: shipmentId, uld_id: input.uldId ?? null, event_type: input.eventType, occurred_at: occurredAt,
    source: "MANUAL", provider_code: s.air_provider_code, confidence: "MANUAL", location_name: input.locationName ?? null, location_iata: iata,
    latitude: input.latitude ?? null, longitude: input.longitude ?? null, flight_number: input.flightNumber ?? null, description: input.description ?? null,
    fingerprint, created_by: user.id,
  });
  if (insErr) { if (insErr.code === "23505") return { ok: false, error: "duplicate_event" }; return { ok: false, error: insErr.message }; }

  await writeAudit({ action: AuditActions.AIR_TRACKING_MANUAL_EVENT, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { eventType: input.eventType, source: "MANUAL", confidence: "MANUAL" } });

  let milestone = current; let version = s.air_tracking_version;
  if (isMs && isAirMilestone(input.eventType) && input.eventType !== current) {
    const next = input.eventType as AirMilestone;
    const { data: upd, error: updErr } = await admin.from("shipment").update({ air_milestone: next, air_tracking_version: s.air_tracking_version + 1, tracking_synced_at: new Date().toISOString() }).eq("id", shipmentId).eq("tenant_id", user.tenantId).eq("air_tracking_version", s.air_tracking_version).select("id");
    if (updErr) return { ok: false, error: updErr.message };
    if (!upd || upd.length === 0) return { ok: false, error: "stale_transition" };
    milestone = next; version = s.air_tracking_version + 1;
    await writeAudit({ action: AuditActions.AIR_MILESTONE_CHANGED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, before: { milestone: current }, after: { milestone: next, source: "MANUAL" } });
  }
  rv(shipmentId); return { ok: true, milestone, version };
}

export async function refreshAirTracking(shipmentId: string): Promise<AirActionResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  const s = await load(admin, shipmentId, user.tenantId);
  if (!s) return { ok: false, error: "not_found" };
  const engine = new AirCargoEngine(resolveAirProvider(s.air_provider_code));
  const current = coerceAirMilestone(s.air_milestone);
  const res = await withTimeout(engine.refresh(current, { reference: shipmentId, type: "mawb" }), TIMEOUT_MS, { ok: false as const, error: "timeout" as const });
  await admin.from("shipment").update({ tracking_synced_at: new Date().toISOString() }).eq("id", shipmentId).eq("tenant_id", user.tenantId);
  if (!res.ok) { await writeAudit({ action: AuditActions.AIR_MILESTONE_CHANGED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { provider: s.air_provider_code, error: res.error } }); rv(shipmentId); return { ok: false, error: res.error }; }
  // 7.3B path: normalize via allowlist, validate, persist. Empty until verified.
  if (res.data.milestone) mapAirlineStatus(s.air_provider_code, res.data.milestone);
  rv(shipmentId); return { ok: true, milestone: current, version: s.air_tracking_version };
}
