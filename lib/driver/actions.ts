"use server";

/**
 * Driver mission session lifecycle (Phase 3.4C). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Start / pause / resume / stop the ONE tracking session for an assigned mission.
 * Authority is ASSIGNMENT (transport.driver_user_id / session.driver_id ===
 * caller), not a broad permission. Gated by DRIVER_MOBILE_TRACKING_ENABLED. These
 * are EVIDENCE-layer only: they never change the transport business status (the
 * driver confirms pickup/delivery through the existing lifecycle separately).
 * Start is idempotent (the unique active-session-per-transport index is the
 * race-proof backstop). Audited; no per-GPS-point audit here.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isDriver } from "./auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import type { TrackingActionResult } from "@/lib/tracking/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export type SessionActionResult = TrackingActionResult & { sessionId?: string };

async function driverCtx(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user || !isDriver(user)) return null;
  return user;
}

function revalidate(transportId: string) {
  revalidatePath(`/driver/missions/${transportId}`);
  revalidatePath("/driver");
}

async function loadOwnSession(supabase: Admin, user: CurrentUser, sessionId: string) {
  const { data } = await supabase
    .from("tracking_session")
    .select("id, transport_id, file_id, status, driver_id")
    .eq("id", sessionId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!data || data.driver_id !== user.id) return null;
  return data;
}

export async function startMission(transportId: string): Promise<SessionActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverCtx();
  if (!user) return { ok: false, error: "forbidden" };
  const supabase = getAdminSupabaseClient();

  const { data: tr } = await supabase
    .from("transport_record")
    .select("id, file_id, status, vehicle_plate, driver_user_id")
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tr || tr.driver_user_id !== user.id) return { ok: false, error: "forbidden" };
  if (tr.status === "CANCELLED" || tr.status === "POD_RECEIVED") return { ok: false, error: "invalid_state" };

  // Idempotent: reuse the existing ACTIVE session if present.
  const active = await supabase
    .from("tracking_session")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", transportId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (active.data) return { ok: true, id: active.data.id, sessionId: active.data.id };

  const { data, error } = await supabase
    .from("tracking_session")
    .insert({
      tenant_id: user.tenantId,
      file_id: tr.file_id,
      transport_id: transportId,
      driver_id: user.id,
      vehicle_plate: tr.vehicle_plate,
      source: "driver_mobile",
      status: "ACTIVE",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    // Race: the unique active-session index rejected a concurrent double-tap.
    if (error && /duplicate|unique/i.test(error.message)) {
      const again = await supabase.from("tracking_session").select("id").eq("tenant_id", user.tenantId).eq("transport_id", transportId).eq("status", "ACTIVE").maybeSingle();
      if (again.data) return { ok: true, id: again.data.id, sessionId: again.data.id };
    }
    return { ok: false, error: error?.message ?? "start_failed" };
  }

  await writeAudit({
    action: AuditActions.TRACKING_SESSION_STARTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "tracking_session",
    entityId: data.id,
    after: { transport_id: transportId, source: "driver_mobile" },
  });
  await supabase.from("tracking_event").insert({
    tenant_id: user.tenantId,
    file_id: tr.file_id,
    transport_id: transportId,
    tracking_session_id: data.id,
    type: "TRACKING_STARTED",
    source: "driver_mobile",
    customer_visible: false,
    created_by: user.id,
  });
  revalidate(transportId);
  return { ok: true, id: data.id, sessionId: data.id };
}

export async function pauseTracking(sessionId: string): Promise<SessionActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverCtx();
  if (!user) return { ok: false, error: "forbidden" };
  const supabase = getAdminSupabaseClient();
  const s = await loadOwnSession(supabase, user, sessionId);
  if (!s) return { ok: false, error: "forbidden" };
  if (s.status !== "ACTIVE") return { ok: false, error: "invalid_state" };

  const { error } = await supabase.from("tracking_session").update({ status: "PAUSED" }).eq("id", sessionId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.TRACKING_SESSION_PAUSED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_session", entityId: sessionId });
  if (s.transport_id) revalidate(s.transport_id);
  return { ok: true, id: sessionId, sessionId };
}

export async function resumeTracking(sessionId: string): Promise<SessionActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverCtx();
  if (!user) return { ok: false, error: "forbidden" };
  const supabase = getAdminSupabaseClient();
  const s = await loadOwnSession(supabase, user, sessionId);
  if (!s) return { ok: false, error: "forbidden" };
  if (s.status !== "PAUSED") return { ok: false, error: "invalid_state" };
  // Mission must still be live (not cancelled/completed).
  const { data: tr } = await supabase.from("transport_record").select("status").eq("id", s.transport_id ?? "").maybeSingle();
  if (tr && (tr.status === "CANCELLED" || tr.status === "POD_RECEIVED")) return { ok: false, error: "invalid_state" };

  const { error } = await supabase.from("tracking_session").update({ status: "ACTIVE" }).eq("id", sessionId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.TRACKING_SESSION_RESUMED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_session", entityId: sessionId });
  if (s.transport_id) revalidate(s.transport_id);
  return { ok: true, id: sessionId, sessionId };
}

export async function stopMission(sessionId: string): Promise<SessionActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverCtx();
  if (!user) return { ok: false, error: "forbidden" };
  const supabase = getAdminSupabaseClient();
  const s = await loadOwnSession(supabase, user, sessionId);
  if (!s) return { ok: false, error: "forbidden" };
  if (s.status !== "ACTIVE" && s.status !== "PAUSED") return { ok: false, error: "invalid_state" };

  const { error } = await supabase.from("tracking_session").update({ status: "COMPLETED", ended_at: new Date().toISOString() }).eq("id", sessionId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.TRACKING_SESSION_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_session", entityId: sessionId });
  if (s.transport_id) {
    await supabase.from("tracking_event").insert({ tenant_id: user.tenantId, file_id: s.file_id, transport_id: s.transport_id, tracking_session_id: sessionId, type: "TRACKING_STOPPED", source: "driver_mobile", customer_visible: false, created_by: user.id });
    revalidate(s.transport_id);
  }
  return { ok: true, id: sessionId, sessionId };
}
