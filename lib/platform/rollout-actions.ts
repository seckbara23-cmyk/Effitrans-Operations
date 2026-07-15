"use server";

/**
 * Tenant rollout toggle (Phase 5.0E-2A). SERVER ACTION — platform admins only.
 * ---------------------------------------------------------------------------
 * The only write path into public.tenant_process_rollout. The table has no
 * insert/update/delete RLS policy and no write grant for `authenticated`, so this
 * service-role action is not merely the preferred route — it is the only one. A
 * tenant SYSTEM_ADMIN cannot enable their own pilot, by construction.
 *
 * Every change is AUDITED with before/after, because "who turned the workflow on for
 * a live freight forwarder, and when" is exactly the question that gets asked at 2am.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission, PlatformAuthError } from "./auth";
import { isTenantOperable, isLifecycleStatus } from "./company-metadata";
import { writeAudit } from "@/lib/audit/log";
import {
  normalizeRollout,
  ROLLOUT_FEATURES,
  type RolloutFeature,
  type TenantRollout,
} from "@/lib/process/rollout";

export type RolloutResult =
  | { ok: true; rollout: TenantRollout }
  | { ok: false; error: string };

export type RolloutInput = Partial<Record<RolloutFeature, boolean>> & {
  tenantId: string;
  /** Why. Recorded on the row and in the audit entry. */
  note?: string;
};

/**
 * Set a tenant's rollout state. Upserts: a tenant with no row is disabled, and the
 * first enable creates it.
 *
 * Turning the ENGINE off cascades: every sub-capability goes off with it. That is
 * the rollback path, and it must not be possible to leave a tenant with queues over
 * a dark engine (which would render as permanently empty lists).
 */
export async function setTenantRollout(input: RolloutInput): Promise<RolloutResult> {
  let actor;
  try {
    actor = await assertPlatformPermission("platform:rollout:manage");
  } catch (e) {
    if (e instanceof PlatformAuthError) return { ok: false, error: "forbidden" };
    throw e;
  }

  if (!input.tenantId) return { ok: false, error: "tenant_required" };

  const admin = getAdminSupabaseClient();

  // The tenant must exist. Without this an arbitrary uuid would create an orphan
  // row (the FK would catch it, but with an opaque error).
  const { data: org } = await admin
    .from("organization")
    .select("id, lifecycle_status")
    .eq("id", input.tenantId)
    .maybeSingle();
  if (!org) return { ok: false, error: "tenant_not_found" };

  // Phase 6.0D — deny rollout changes on a non-operable tenant. Suspend/archive must
  // block rollout actions; a suspended tenant's users cannot reach the engine anyway
  // (they resolve to no session), so enabling it would be meaningless, and archived is
  // permanently read-only. Only ACTIVE/TRIAL tenants may have their rollout changed.
  if (isLifecycleStatus(org.lifecycle_status) && !isTenantOperable(org.lifecycle_status)) {
    return { ok: false, error: "tenant_not_operable" };
  }

  const { data: existing } = await admin
    .from("tenant_process_rollout")
    .select("process_engine, process_workspaces, physical_invoice_deposit, collections")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  const before = normalizeRollout(existing as Record<string, unknown> | null);

  // Apply only the features the caller named; everything else keeps its value.
  const next: TenantRollout = { ...before };
  for (const f of ROLLOUT_FEATURES) {
    const v = input[f];
    if (typeof v === "boolean") next[f] = v;
  }

  // Disabling the engine disables everything under it. normalizeRollout enforces
  // this; running the input through it means a caller cannot construct an
  // incoherent state even by asking for one.
  const after = normalizeRollout(next as unknown as Record<string, unknown>);

  const nowEnabling = !before.process_engine && after.process_engine;

  const { error } = await admin.from("tenant_process_rollout").upsert(
    {
      tenant_id: input.tenantId,
      ...after,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
      ...(nowEnabling ? { first_enabled_at: new Date().toISOString() } : {}),
    },
    { onConflict: "tenant_id" },
  );

  if (error) return { ok: false, error: "write_failed" };

  await writeAudit({
    action: "platform.rollout.updated",
    tenantId: input.tenantId,
    platformActorId: actor.id,
    entity: "tenant_process_rollout",
    entityId: input.tenantId,
    before,
    after: { ...after, note: input.note ?? null },
  });

  revalidatePath("/platform/rollout");
  return { ok: true, rollout: after };
}

/**
 * Emergency rollback for ONE tenant: everything off, in one call.
 *
 * Deliberately a named action rather than "call setTenantRollout with four falses" —
 * under pressure, the operator should not have to remember which four. It is audited
 * as a distinct action so a rollback is legible in the audit trail, not inferable
 * from a diff.
 */
export async function rollbackTenantRollout(
  tenantId: string,
  reason: string,
): Promise<RolloutResult> {
  return setTenantRollout({
    tenantId,
    process_engine: false,
    process_workspaces: false,
    physical_invoice_deposit: false,
    collections: false,
    note: `ROLLBACK: ${reason}`,
  });
}
