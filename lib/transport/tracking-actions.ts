"use server";

/**
 * TMS-1C — governed management of a mission's external tracking reference.
 * ---------------------------------------------------------------------------
 * AUTHORITY, taken from the repository and not invented: attaching or changing
 * the reference is `transport:assign` — the dispatch-time authority that
 * already governs binding a vehicle and a driver to a mission (COORDINATOR,
 * OPS_SUPERVISOR, SYSTEM_ADMIN, TRANSPORT_OFFICER). Reading is
 * `transport:read`, the gate on the mission panel this renders inside, and
 * deliberately NOT `tracking:read`, which DRIVER holds — a provider link can
 * expose a whole fleet to the person being tracked.
 *
 * NOT AUTHORITATIVE FOR WORKFLOW. Nothing here touches transport status, the
 * step engine, the pickup gate or closure. Ending tracking is not delivering;
 * a verified POD remains the only proof of delivery.
 *
 * The table has no RLS write policy, so these actions ARE the boundary.
 */
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import {
  validateTrackingUrl,
  validateProvider,
  normalizeExternalReference,
} from "./tracking-reference";

export type TrackingActionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The mission, re-resolved server-side with its tenant. Never trusts a
 * client-supplied tenant or dossier: both are read from the mission row.
 */
async function loadMission(transportId: string, tenantId: string) {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("transport_record")
    .select("id, tenant_id, file_id")
    .eq("id", transportId)
    .eq("tenant_id", tenantId)          // cross-tenant reads return nothing
    .is("deleted_at", null)
    .maybeSingle<{ id: string; tenant_id: string; file_id: string }>();
  return data ?? null;
}

/**
 * Attach or replace the mission's external tracking reference.
 *
 * Idempotent by mission (one reference per mission, UNIQUE transport_id): a
 * second call updates rather than duplicating, and the audit distinguishes the
 * two acts so the trail says whether a link was established or changed.
 */
export async function attachMissionTracking(input: {
  transportId: string;
  provider: string;
  trackingUrl: string;
  externalReference?: string | null;
}): Promise<TrackingActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const provider = validateProvider(input.provider);
  if (!provider.ok) return { ok: false, error: provider.error };
  const url = validateTrackingUrl(input.trackingUrl);
  if (!url.ok) return { ok: false, error: url.error };
  const externalReference = normalizeExternalReference(input.externalReference);

  const mission = await loadMission(input.transportId, user.tenantId);
  if (!mission) return { ok: false, error: "not_found" };

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("transport_tracking_reference")
    .select("id, provider, tracking_url, external_reference, ended_at")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", mission.id)
    .maybeSingle<{
      id: string; provider: string; tracking_url: string;
      external_reference: string | null; ended_at: string | null;
    }>();

  if (existing) {
    const { error } = await admin
      .from("transport_tracking_reference")
      .update({
        provider: provider.provider,
        tracking_url: url.url,
        external_reference: externalReference,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
        // Re-attaching reopens a closed reference: the mission is being
        // tracked again, and a stale end would hide the live link.
        ended_by: null,
        ended_at: null,
        end_reason: null,
      })
      .eq("id", existing.id)
      .eq("tenant_id", user.tenantId);
    if (error) return { ok: false, error: error.message };

    await writeAudit({
      action: AuditActions.TRANSPORT_TRACKING_UPDATED,
      actorId: user.id, tenantId: user.tenantId,
      entity: "transport_record", entityId: mission.id,
      // The URL is recorded as its HOST only: a signed provider link must not
      // be copied into the audit trail, which is read far more widely.
      before: { provider: existing.provider, host: hostOf(existing.tracking_url), external_reference: existing.external_reference },
      after: { provider: provider.provider, host: hostOf(url.url), external_reference: externalReference },
    });
    revalidate(mission.file_id);
    return { ok: true, id: existing.id };
  }

  const { data: created, error } = await admin
    .from("transport_tracking_reference")
    .insert({
      tenant_id: user.tenantId,
      transport_id: mission.id,
      file_id: mission.file_id,           // server-resolved; guard trigger re-checks
      provider: provider.provider,
      tracking_url: url.url,
      external_reference: externalReference,
      attached_by: user.id,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.TRANSPORT_TRACKING_ATTACHED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_record", entityId: mission.id,
    after: { provider: provider.provider, host: hostOf(url.url), external_reference: externalReference },
  });
  revalidate(mission.file_id);
  return { ok: true, id: created.id as string };
}

/**
 * End live tracking for the mission — a bookkeeping act, NOT a workflow one.
 * The mission's status, its POD and its closure are untouched and unconsulted.
 * The row is kept: a mission that WAS tracked should still say so.
 */
export async function endMissionTracking(
  transportId: string,
  reason?: string | null,
): Promise<TrackingActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const mission = await loadMission(transportId, user.tenantId);
  if (!mission) return { ok: false, error: "not_found" };

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("transport_tracking_reference")
    .select("id, provider, tracking_url, ended_at")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", mission.id)
    .maybeSingle<{ id: string; provider: string; tracking_url: string; ended_at: string | null }>();
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.ended_at) return { ok: false, error: "already_ended" };

  const { error } = await admin
    .from("transport_tracking_reference")
    .update({
      ended_by: user.id,
      ended_at: new Date().toISOString(),
      end_reason: (reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null,
    })
    .eq("id", existing.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_TRACKING_ENDED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_record", entityId: mission.id,
    before: { provider: existing.provider, host: hostOf(existing.tracking_url) },
    after: { ended: true },
  });
  revalidate(mission.file_id);
  return { ok: true, id: existing.id };
}

/** Remove the reference entirely (a mistaken attachment). */
export async function removeMissionTracking(transportId: string): Promise<TrackingActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const mission = await loadMission(transportId, user.tenantId);
  if (!mission) return { ok: false, error: "not_found" };

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("transport_tracking_reference")
    .select("id, provider, tracking_url")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", mission.id)
    .maybeSingle<{ id: string; provider: string; tracking_url: string }>();
  if (!existing) return { ok: false, error: "not_found" };

  const { error } = await admin
    .from("transport_tracking_reference")
    .delete()
    .eq("id", existing.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_TRACKING_REMOVED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_record", entityId: mission.id,
    before: { provider: existing.provider, host: hostOf(existing.tracking_url) },
  });
  revalidate(mission.file_id);
  return { ok: true, id: existing.id };
}

// ------------------------------------------------------------------ helpers --

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/transport");
}
