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
import type { TrackingActionResult, TrackingSessionStatus } from "@/lib/tracking/types";
import { resolveVehicleIdentity } from "@/lib/transport/vehicle-identity";
import { LIVE_SESSION_STATUSES } from "./mission-gates";
import { notifyDispatchers } from "./mission-auth";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/**
 * The transport row `startMission` reads, including the embedded fleet vehicle.
 * Declared because the generated types do not describe the `vehicle_id` join,
 * and an un-typed embed collapses the whole row to `never`.
 */
type StartMissionTransport = {
  id: string;
  /** `not null` in the schema — a transport always belongs to a dossier. */
  file_id: string;
  /** `not null`, CHECK-constrained. */
  status: string;
  vehicle_plate: string | null;
  driver_user_id: string | null;
  vehicle: { registration: string | null } | null;
};
export type SessionActionResult = TrackingActionResult & { sessionId?: string; status?: TrackingSessionStatus };

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
    // `vehicle:vehicle_id(registration)` is embedded because the notification
    // below has to NAME the vehicle, and the free-text plate is not where a
    // fleet vehicle's identity lives (TRN-VEHICLE-01). An embed needs its row
    // type stated — the generated types do not carry the join — which is the
    // same shape lib/transport/service.ts declares for the same embed.
    .select("id, file_id, status, vehicle_plate, driver_user_id, vehicle:vehicle_id(registration)")
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle()
    .returns<StartMissionTransport>();
  if (!tr || tr.driver_user_id !== user.id) return { ok: false, error: "forbidden" };
  if (tr.status === "CANCELLED" || tr.status === "POD_RECEIVED") return { ok: false, error: "invalid_state" };

  // Idempotent: reuse the session this mission ALREADY has.
  //
  // UAT-TRANSPORT-POD-FIX-01 (D5). Matching ACTIVE alone let a SECOND live
  // session be inserted beside a PAUSED or RETURNING one — the unique index
  // covers ACTIVE only — which would split one return leg across two rows and
  // leave one of them never completed. The status is returned so the screen
  // cannot show a paused session as though it were sharing.
  const { data: liveRows } = await supabase
    .from("tracking_session")
    .select("id, status")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", transportId)
    .in("status", [...LIVE_SESSION_STATUSES])
    .order("started_at", { ascending: false })
    .limit(1);
  const existing = (liveRows ?? [])[0];
  if (existing) {
    return { ok: true, id: existing.id, sessionId: existing.id, status: existing.status as TrackingSessionStatus };
  }

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
      if (again.data) return { ok: true, id: again.data.id, sessionId: again.data.id, status: "ACTIVE" };
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

  // 01B-B4 — tell the office a mission is under way.
  //
  // PLACED HERE DELIBERATELY. This function has three successful exits: an
  // ALREADY-live session is returned above without inserting, a duplicate-key
  // race re-reads and returns the winner, and only this path actually opened a
  // session. Notifying at the top would re-notify on every repeated tap of
  // « Démarrer » — which is exactly what the idempotent early return exists to
  // make harmless. One new session, one notification.
  //
  // Non-blocking by contract: `notifyDispatchers` cannot throw into the mission,
  // so a notification problem never costs the driver her start.
  if (tr.file_id) {
    // ⚠ NOT `vehicle_plate` ALONE (TRN-VEHICLE-01). A mission run on an
    // Effitrans fleet truck has `vehicle_id` set and `vehicle_plate` correctly
    // NULL, so reading the free text by itself would announce
    // « véhicule non renseigné » for the fleet's own vehicles — precisely the
    // misread `resolveVehicleIdentity` exists to end. The plate remains the
    // fallback for an external or hired vehicle.
    const vehicle = resolveVehicleIdentity({
      registration: tr.vehicle?.registration,
      plate: tr.vehicle_plate,
    });
    await notifyDispatchers(
      supabase,
      user.tenantId,
      tr.file_id,
      "Mission démarrée",
      vehicle ? `Suivi en cours — véhicule ${vehicle}.` : "Suivi en cours — aucun véhicule enregistré.",
      "MISSION_STARTED",
    );
  }
  revalidate(transportId);
  return { ok: true, id: data.id, sessionId: data.id, status: "ACTIVE" };
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

/**
 * TMS-2 — the driver declares the RETURN LEG: delivered, driving back to base.
 *
 * TELEMETRY ONLY, and the point of the whole slice. This reads no transport
 * status and writes none: a mission the platform has not yet recorded as
 * DELIVERED can still be on its return leg, and declaring the return leg never
 * delivers anything, never creates a POD and never closes a dossier. Tracking
 * continues — that is exactly why the state exists.
 *
 * Authority is ASSIGNMENT, like every other act here: `loadOwnSession` resolves
 * the session only for the driver it belongs to.
 */
export async function startReturnLeg(sessionId: string): Promise<SessionActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverCtx();
  if (!user) return { ok: false, error: "forbidden" };
  const supabase = getAdminSupabaseClient();
  const s = await loadOwnSession(supabase, user, sessionId);
  if (!s) return { ok: false, error: "forbidden" };
  // Only an outbound session turns around. A completed or cancelled one does
  // not resurrect, and a second declaration is refused rather than re-stamped.
  if (s.status !== "ACTIVE" && s.status !== "PAUSED") return { ok: false, error: "invalid_state" };

  const { error } = await supabase
    .from("tracking_session")
    .update({ status: "RETURNING", return_started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRACKING_SESSION_RETURN_STARTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "tracking_session",
    entityId: sessionId,
    before: { status: s.status },
    after: { status: "RETURNING" },
  });
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
  // TMS-2 — a round trip ends FROM the return leg, so RETURNING is a legal
  // predecessor of COMPLETED alongside the outbound states.
  if (s.status !== "ACTIVE" && s.status !== "PAUSED" && s.status !== "RETURNING") {
    return { ok: false, error: "invalid_state" };
  }

  // COMPARE-AND-SET, NOT A BLIND WRITE.
  //
  // The guard above READ the status; this writes it. Two taps of « Terminer »
  // landing together both read a live session, and without a predicate on the
  // write both would succeed — producing two TRACKING_STOPPED events and, once
  // 01B-B4 notifies below, two « Mission terminée » alerts to every dispatcher.
  // PostgREST reports no error for an UPDATE that matches nothing, so the
  // predicate has to be paired with `.select()` to find out who actually won.
  // The status list is the gate's own, so the CAS cannot drift from the guard.
  const { data: stopped, error } = await supabase
    .from("tracking_session")
    .update({ status: "COMPLETED", ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("tenant_id", user.tenantId)
    .in("status", [...LIVE_SESSION_STATUSES])
    .select("id");
  if (error) return { ok: false, error: error.message };

  // Lost the race: the mission IS completed, by the other caller, which is the
  // outcome this one asked for — so it succeeds, and stays silent. Everything
  // below is the consequence of having been the one to close the session.
  const closedItHere = (stopped ?? []).length > 0;
  if (!closedItHere) return { ok: true, id: sessionId, sessionId };

  await writeAudit({ action: AuditActions.TRACKING_SESSION_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_session", entityId: sessionId });
  if (s.transport_id) {
    await supabase.from("tracking_event").insert({ tenant_id: user.tenantId, file_id: s.file_id, transport_id: s.transport_id, tracking_session_id: sessionId, type: "TRACKING_STOPPED", source: "driver_mobile", customer_visible: false, created_by: user.id });
    revalidate(s.transport_id);
  }

  // 01B-B4 — and tell them it finished.
  //
  // Reached only by the caller that actually moved the row, so a repeat — whether
  // sequential (the guard returns `invalid_state`) or concurrent (the CAS matches
  // nothing) — cannot notify twice. Idempotency is the state machine's and the
  // database's, not a flag of ours.
  if (s.file_id) {
    await notifyDispatchers(
      supabase,
      user.tenantId,
      s.file_id,
      "Mission terminée",
      "Le suivi de la mission est clôturé.",
      "MISSION_COMPLETED",
    );
  }
  return { ok: true, id: sessionId, sessionId };
}
