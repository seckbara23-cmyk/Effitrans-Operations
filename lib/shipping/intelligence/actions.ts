"use server";

/**
 * Shipping Line Platform — manual tracking + provider refresh (Phase 7.2A). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The write path for ocean tracking. Tenant + actor come from the SESSION (never the
 * browser). Manual events are validated (event type, timestamp, coordinates), always
 * labelled source=MANUAL / confidence=MANUAL, deduplicated by fingerprint, and — when they
 * are a milestone — validated against the canonical model before the shipment's milestone
 * is recomputed with compare-and-set. Provider refresh normalizes + validates before
 * persisting; in 7.2A every provider resolves to not_configured (recorded honestly). No
 * client-supplied tenant, actor, coordinate, or provider response is trusted.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { ShippingEngine, resolveShippingProvider } from "./provider";
import { isCanonicalEvent, eventIsMilestone, eventFingerprint } from "./events";
import { classifyMilestone, isShippingMilestone, type ShippingMilestone } from "./milestones";
import { coerceMilestone as coerceStored } from "./persistence";
import { isValidCoordinate, normalizeUnlocode } from "./validators";
import { mapCarrierStatus } from "./status-map";

export type ManualEventInput = {
  eventType: string;
  occurredAt: string;
  containerId?: string | null;
  locationName?: string | null;
  locationUnlocode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  /** Required to apply a regression / correction milestone (an earlier-than-current one). */
  confirmCorrection?: boolean;
};

export type ShippingActionResult =
  | { ok: true; milestone?: ShippingMilestone; version?: number; eventId?: string }
  | { ok: false; error: string };

type Admin = ReturnType<typeof getAdminSupabaseClient>;
const PROVIDER_TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout), ms); });
  try { return await Promise.race([p, guard]); } finally { if (timer) clearTimeout(timer); }
}

type ShipmentLite = { id: string; tenant_id: string; transport_mode: string | null; ocean_milestone: string; provider_code: string; tracking_version: number };

async function loadShipment(admin: Admin, id: string, tenantId: string): Promise<ShipmentLite | null> {
  const { data } = await admin
    .from("shipment")
    .select("id, tenant_id, transport_mode, ocean_milestone, provider_code, tracking_version")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<ShipmentLite>();
  return data ?? null;
}

function revalidate(id: string) {
  revalidatePath("/shipping");
  revalidatePath("/shipping/shipments");
  revalidatePath(`/shipping/shipments/${id}`);
}

/** Record a clearly-labelled MANUAL tracking event and, if it is a milestone, advance the
 *  shipment's canonical milestone (validated + compare-and-set). */
export async function addManualTrackingEvent(shipmentId: string, input: ManualEventInput): Promise<ShippingActionResult> {
  let user;
  try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }

  if (!isCanonicalEvent(input.eventType)) return { ok: false, error: "invalid_event_type" };
  const occurred = new Date(input.occurredAt);
  if (!Number.isFinite(occurred.getTime())) return { ok: false, error: "invalid_timestamp" };
  // Reject arbitrary coordinates: if one is supplied, both must be valid.
  const hasCoord = input.latitude != null || input.longitude != null;
  if (hasCoord && !(input.latitude != null && input.longitude != null && isValidCoordinate(input.latitude, input.longitude))) {
    return { ok: false, error: "invalid_coordinate" };
  }
  const unlocode = input.locationUnlocode ? normalizeUnlocode(input.locationUnlocode) : null;
  if (input.locationUnlocode && !unlocode) return { ok: false, error: "invalid_unlocode" };

  const admin = getAdminSupabaseClient();
  const s = await loadShipment(admin, shipmentId, user.tenantId);
  if (!s) return { ok: false, error: "not_found" };
  if (s.transport_mode !== "SEA" && s.transport_mode !== "MULTIMODAL") return { ok: false, error: "not_ocean" };

  const current = coerceStored(s.ocean_milestone);
  const isMilestone = eventIsMilestone(input.eventType);
  if (isMilestone && isShippingMilestone(input.eventType)) {
    const verdict = classifyMilestone(current, input.eventType as ShippingMilestone);
    if (!verdict.ok) return { ok: false, error: verdict.reason };
    // A correction (moving to an earlier milestone) must be explicitly confirmed.
    if (verdict.kind === "regress" && !input.confirmCorrection) return { ok: false, error: "confirmation_required" };
  }

  const occurredAt = occurred.toISOString();
  const location = { name: input.locationName ?? null, unlocode, latitude: input.latitude ?? null, longitude: input.longitude ?? null };
  const fingerprint = eventFingerprint({ shipmentId, containerId: input.containerId ?? null, eventType: input.eventType, occurredAt, location });

  const { data: inserted, error: insErr } = await admin
    .from("ocean_tracking_event")
    .insert({
      tenant_id: user.tenantId, shipment_id: shipmentId, container_id: input.containerId ?? null,
      event_type: input.eventType, occurred_at: occurredAt, source: "MANUAL", provider_code: s.provider_code,
      confidence: "MANUAL", location_name: location.name, location_unlocode: location.unlocode,
      latitude: location.latitude, longitude: location.longitude, description: input.description ?? null,
      fingerprint, created_by: user.id,
    })
    .select("id");
  if (insErr) {
    if (insErr.code === "23505") return { ok: false, error: "duplicate_event" }; // dedup via unique constraint
    return { ok: false, error: insErr.message };
  }
  const eventId = inserted?.[0]?.id;

  await writeAudit({
    action: AuditActions.SHIPPING_TRACKING_MANUAL_EVENT,
    actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId,
    after: { eventType: input.eventType, source: "MANUAL", confidence: "MANUAL" },
  });

  let milestone = current;
  let version = s.tracking_version;
  if (isMilestone && isShippingMilestone(input.eventType) && input.eventType !== current) {
    const next = input.eventType as ShippingMilestone;
    const { data: upd, error: updErr } = await admin
      .from("shipment")
      .update({ ocean_milestone: next, tracking_version: s.tracking_version + 1, tracking_synced_at: new Date().toISOString() })
      .eq("id", shipmentId)
      .eq("tenant_id", user.tenantId)
      .eq("tracking_version", s.tracking_version)
      .select("id");
    if (updErr) return { ok: false, error: updErr.message };
    if (!upd || upd.length === 0) return { ok: false, error: "stale_transition" };
    milestone = next;
    version = s.tracking_version + 1;
    await writeAudit({
      action: AuditActions.SHIPPING_MILESTONE_CHANGED,
      actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId,
      before: { milestone: current }, after: { milestone: next, source: "MANUAL" },
    });
  }

  revalidate(shipmentId);
  return { ok: true, milestone, version, eventId };
}

/** Refresh tracking from the bound provider. Provider-configured check first; response is
 *  normalized + validated before anything is persisted. In 7.2A this resolves to
 *  not_configured for every provider (recorded honestly; no fabricated status). */
export async function refreshShipmentTracking(shipmentId: string): Promise<ShippingActionResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const admin = getAdminSupabaseClient();
  const s = await loadShipment(admin, shipmentId, user.tenantId);
  if (!s) return { ok: false, error: "not_found" };

  await writeAudit({
    action: AuditActions.SHIPPING_PROVIDER_REFRESH_REQUESTED,
    actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId,
    after: { provider: s.provider_code },
  });

  const engine = new ShippingEngine(resolveShippingProvider(s.provider_code));
  const current = coerceStored(s.ocean_milestone);
  const syncedAt = new Date().toISOString();

  const res = await withTimeout(
    engine.refresh(current, { reference: shipmentId, type: "booking" }),
    PROVIDER_TIMEOUT_MS,
    { ok: false as const, error: "timeout" as const },
  );

  await admin.from("shipment").update({ tracking_synced_at: syncedAt }).eq("id", shipmentId).eq("tenant_id", user.tenantId);

  if (!res.ok) {
    await writeAudit({
      action: AuditActions.SHIPPING_PROVIDER_REFRESH_FAILED,
      actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId,
      after: { provider: s.provider_code, error: res.error },
    });
    revalidate(shipmentId);
    return { ok: false, error: res.error };
  }

  // 7.2B path: normalize provider statuses via the allowlist, validate, then persist events
  // + advance the milestone with compare-and-set. Unknown statuses never transition.
  const raw = res.data.milestone;
  if (raw) mapCarrierStatus(s.provider_code, raw); // allowlist-guarded (empty until verified)

  await writeAudit({
    action: AuditActions.SHIPPING_PROVIDER_REFRESH_SUCCEEDED,
    actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId,
    after: { provider: s.provider_code },
  });
  revalidate(shipmentId);
  return { ok: true, milestone: current, version: s.tracking_version };
}
