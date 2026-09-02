/**
 * TMS-1C — reading a mission's external tracking reference. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gate: `transport:read` — the SAME authority the RLS select policy requires
 * and the gate on the mission panel this feeds. Deliberately NOT
 * `tracking:read`: DRIVER holds that, and a provider link can expose an entire
 * fleet to the person being tracked.
 *
 * The admin client bypasses RLS, so this app gate is the boundary (EC-3C), and
 * the tenant filter below is the rebuilt RLS predicate (MAYA-P0.8-C).
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { TrackingReference } from "./tracking-reference";

type Row = {
  id: string;
  transport_id: string;
  provider: string;
  external_reference: string | null;
  tracking_url: string;
  attached_at: string;
  updated_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

/**
 * The mission's tracking reference, or null when none is configured.
 * Returns null (never throws) for an unauthorized reader, so a panel renders
 * its neutral state rather than exploding.
 */
export async function getMissionTracking(transportId: string): Promise<TrackingReference | null> {
  let user;
  try {
    user = await assertPermission("transport:read");
  } catch {
    return null;
  }
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("transport_tracking_reference")
    .select("id, transport_id, provider, external_reference, tracking_url, attached_at, updated_at, ended_at, end_reason")
    .eq("tenant_id", user.tenantId)     // the rebuilt RLS filter
    .eq("transport_id", transportId)
    .maybeSingle<Row>();
  if (!data) return null;

  return {
    id: data.id,
    transportId: data.transport_id,
    provider: data.provider,
    externalReference: data.external_reference,
    trackingUrl: data.tracking_url,
    attachedAt: data.attached_at,
    updatedAt: data.updated_at,
    endedAt: data.ended_at,
    endReason: data.end_reason,
  };
}
