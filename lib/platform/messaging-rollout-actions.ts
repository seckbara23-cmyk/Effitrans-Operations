"use server";

/**
 * Tenant messaging rollout toggle (Phase 8.7). SERVER ACTION — platform admins only.
 * ---------------------------------------------------------------------------
 * The only write path into public.tenant_messaging_rollout — same shape as
 * lib/platform/rollout-actions.ts's setTenantRollout, kept as its own tiny action
 * (not folded into that one) because messaging has no process-engine dependency.
 * The table has no write RLS policy, so this service-role action is the only route.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission, PlatformAuthError } from "./auth";
import { isTenantOperable, isLifecycleStatus } from "./company-metadata";
import { writeAudit } from "@/lib/audit/log";

export type MessagingRolloutResult = { ok: true; enabled: boolean } | { ok: false; error: string };

export async function setTenantMessagingRollout(tenantId: string, enabled: boolean, note?: string): Promise<MessagingRolloutResult> {
  let actor;
  try {
    actor = await assertPlatformPermission("platform:rollout:manage");
  } catch (e) {
    if (e instanceof PlatformAuthError) return { ok: false, error: "forbidden" };
    throw e;
  }
  if (!tenantId) return { ok: false, error: "tenant_required" };

  const admin = getAdminSupabaseClient();
  const { data: org } = await admin.from("organization").select("id, lifecycle_status").eq("id", tenantId).maybeSingle();
  if (!org) return { ok: false, error: "tenant_not_found" };
  if (isLifecycleStatus(org.lifecycle_status) && !isTenantOperable(org.lifecycle_status)) {
    return { ok: false, error: "tenant_not_operable" };
  }

  const { data: existing } = await admin.from("tenant_messaging_rollout").select("enabled").eq("tenant_id", tenantId).maybeSingle();
  const before = existing?.enabled === true;
  const nowEnabling = !before && enabled;

  const { error } = await admin.from("tenant_messaging_rollout").upsert(
    {
      tenant_id: tenantId,
      enabled,
      note: note ?? null,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
      ...(nowEnabling ? { first_enabled_at: new Date().toISOString() } : {}),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: "write_failed" };

  await writeAudit({
    action: "platform.messaging_rollout.updated",
    tenantId,
    platformActorId: actor.id,
    entity: "tenant_messaging_rollout",
    entityId: tenantId,
    before: { enabled: before },
    after: { enabled, note: note ?? null },
  });

  revalidatePath("/platform/rollout");
  return { ok: true, enabled };
}
