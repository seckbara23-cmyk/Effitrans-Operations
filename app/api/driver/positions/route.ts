/**
 * Driver position batch endpoint (Phase 3.4C) — POST /api/driver/positions.
 * ---------------------------------------------------------------------------
 * The ONLY write path for driver GPS. Server-derives ALL trusted associations
 * (tenant, file, transport, driver) from the tracking session — the client
 * supplies only the sessionId + positions. Rejects: unauthenticated / non-DRIVER,
 * flag off, session not ACTIVE, session not owned by the caller, oversized batch,
 * invalid coords/timestamps, excessive replay. Idempotent (pre-filter by key +
 * the unique index backstop). Audits batch ACCEPTANCE (count) — never per point.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isDriver } from "@/lib/driver/auth";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { validatePositionBatch, MAX_POSITION_BATCH, type RawDriverPosition } from "@/lib/driver/batch";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!driverMobileTrackingEnabled()) {
    return NextResponse.json({ error: "tracking_disabled" }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!isDriver(user)) return new NextResponse("Forbidden", { status: 403 });

  const body = (await req.json().catch(() => null)) as { trackingSessionId?: unknown; positions?: unknown } | null;
  const sessionId = typeof body?.trackingSessionId === "string" ? body.trackingSessionId : "";
  const positions = Array.isArray(body?.positions) ? (body!.positions as RawDriverPosition[]) : null;
  if (!sessionId || !positions) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (positions.length > MAX_POSITION_BATCH) {
    return NextResponse.json({ error: "batch_too_large", max: MAX_POSITION_BATCH }, { status: 413 });
  }

  const supabase = getAdminSupabaseClient();

  // Trusted associations come from the SESSION, not the client.
  const { data: session } = await supabase
    .from("tracking_session")
    .select("id, tenant_id, file_id, transport_id, driver_id, status")
    .eq("id", sessionId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!session || session.driver_id !== user.id) return new NextResponse("Forbidden", { status: 403 });
  if (session.status !== "ACTIVE") return NextResponse.json({ error: "session_not_active" }, { status: 409 });

  const now = new Date();
  const { accepted, rejected } = validatePositionBatch(positions, now);
  if (accepted.length === 0) {
    return NextResponse.json({ accepted: 0, duplicates: 0, rejected });
  }

  // Idempotency: drop keys already stored for this tenant (offline-replay safe).
  const keys = accepted.map((p) => p.idempotencyKey);
  const { data: existing } = await supabase
    .from("tracking_position")
    .select("idempotency_key")
    .eq("tenant_id", user.tenantId)
    .in("idempotency_key", keys);
  const known = new Set((existing ?? []).map((e) => e.idempotency_key));
  const fresh = accepted.filter((p) => !known.has(p.idempotencyKey));

  let inserted = 0;
  if (fresh.length > 0) {
    const receivedAt = now.toISOString();
    const rows = fresh.map((p) => ({
      tenant_id: user.tenantId,
      tracking_session_id: session.id,
      file_id: session.file_id,
      transport_id: session.transport_id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_meters: p.accuracyMeters ?? null,
      heading_degrees: p.headingDegrees ?? null,
      speed_kph: p.speedKph ?? null,
      source: "driver_mobile",
      customer_visible: false,
      recorded_at: p.recordedAt,
      received_at: receivedAt,
      recorded_by: user.id,
      idempotency_key: p.idempotencyKey,
    }));
    const { error } = await supabase.from("tracking_position").insert(rows);
    if (error && !/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
    inserted = fresh.length;

    // Advance the session's last-position marker (drives freshness/health).
    const latest = fresh.reduce((m, p) => (p.recordedAt > m ? p.recordedAt : m), fresh[0].recordedAt);
    await supabase.from("tracking_session").update({ last_position_at: latest }).eq("id", session.id).eq("tenant_id", user.tenantId);
  }

  // Audit batch ACCEPTANCE only (never per GPS point).
  await writeAudit({
    action: AuditActions.TRACKING_BATCH_RECEIVED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "tracking_session",
    entityId: session.id,
    after: { inserted, duplicates: accepted.length - fresh.length, rejected: rejected.length },
  });

  return NextResponse.json({ accepted: inserted, duplicates: accepted.length - fresh.length, rejected });
}
