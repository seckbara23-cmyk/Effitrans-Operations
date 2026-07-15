"use server";

/**
 * Tenant lifecycle actions (Phase 6.0D). SERVER ACTIONS — platform admins only.
 * ---------------------------------------------------------------------------
 * Suspend / reactivate / archive a tenant. These are the ONLY writers of
 * organization.lifecycle_status, and every one of them:
 *   - requires platform:status:update (a tenant SYSTEM_ADMIN has no platform identity,
 *     so a tenant can never suspend or reactivate ITSELF — assertPlatformPermission
 *     throws for them);
 *   - validates the transition against the small state machine in company-metadata.ts
 *     (no arbitrary status write; ARCHIVED is terminal);
 *   - writes an audit event with actor, before, after and an optional reason.
 *
 * ENFORCEMENT lives elsewhere, on purpose. Flipping the status here is inert until the
 * SINGLE enforcement point (getCurrentUser) reads it and denies the tenant. These
 * actions decide; getCurrentUser enforces. That is why the buttons are real and not
 * theatre: the moment this writes SUSPENDED, the tenant's next request resolves to no
 * session.
 *
 * NO DELETION, NO SOFT-DELETE. Data is untouched; only a status column changes. A
 * platform admin keeps full read access to a suspended or archived tenant (their reads
 * go through the service role, not getCurrentUser).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission, PlatformAuthError } from "./auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { setTenantAuthBan, type RevocationSummary } from "./session-revocation";
import {
  LIFECYCLE_TRANSITIONS,
  canTransition,
  isLifecycleStatus,
  type LifecycleAction,
  type LifecycleStatus,
} from "./company-metadata";

export type LifecycleResult =
  // A successful transition may carry a session-revocation summary (Phase 6.0E-4). Its
  // presence/failure NEVER makes the transition itself "failed" — next-request enforcement
  // already protects the platform; revocation is an added, honest best-effort.
  | { ok: true; from: LifecycleStatus; to: LifecycleStatus; revocation?: RevocationSummary }
  | { ok: false; error: "unauthorized" | "not_found" | "invalid_transition" | "write_failed" };

async function performLifecycle(
  action: LifecycleAction,
  tenantId: string,
  reason: string | null,
): Promise<LifecycleResult> {
  let actor;
  try {
    actor = await assertPlatformPermission("platform:status:update");
  } catch (e) {
    if (e instanceof PlatformAuthError) return { ok: false, error: "unauthorized" };
    throw e;
  }
  if (!tenantId) return { ok: false, error: "not_found" };

  const admin = getAdminSupabaseClient();

  const { data: org } = await admin
    .from("organization")
    .select("id, lifecycle_status")
    .eq("id", tenantId)
    .maybeSingle();
  if (!org) return { ok: false, error: "not_found" };

  const from = org.lifecycle_status;
  if (!isLifecycleStatus(from) || !canTransition(action, from)) {
    // e.g. suspend an already-archived tenant, or reactivate an active one.
    return { ok: false, error: "invalid_transition" };
  }
  const to = LIFECYCLE_TRANSITIONS[action].to;

  // Stage 1 — the lifecycle transition (compare-and-set: only from the state we
  // validated, so two admins acting at once cannot double-apply).
  const { error } = await admin
    .from("organization")
    .update({ lifecycle_status: to, updated_at: new Date().toISOString() })
    .eq("id", tenantId)
    .eq("lifecycle_status", from);
  if (error) return { ok: false, error: "write_failed" };

  // Stage 2 — session revocation (Phase 6.0E-4), best-effort. Suspend/archive BAN the
  // tenant's auth users (revoking new logins + refresh); reactivate UN-BANS so they can
  // authenticate again (this manufactures no session). A partial provider failure is
  // counted, never thrown: the transition in Stage 1 already stands, and next-request
  // enforcement (6.0D) protects the platform regardless.
  let revocation: RevocationSummary | undefined;
  if (action === "suspend" || action === "archive") {
    revocation = await setTenantAuthBan(admin, tenantId, true);
  } else if (action === "reactivate") {
    revocation = await setTenantAuthBan(admin, tenantId, false);
  }

  // Stage 3 — audit the operational outcome: the transition + a SAFE revocation summary
  // (counts only — never a token, session id, or provider error).
  await writeAudit({
    action: AuditActions.PLATFORM_TENANT_STATUS_CHANGED,
    tenantId,
    platformActorId: actor.id,
    entity: "organization",
    entityId: tenantId,
    before: { lifecycleStatus: from },
    // The reason is a platform-internal note. It lives ONLY in the platform-gated audit
    // log, never on the org row (which the tenant can read) — so it does not leak.
    after: {
      lifecycleStatus: to,
      action,
      reason: reason ?? null,
      ...(revocation ? { sessionRevocation: revocation } : {}),
    },
  });

  revalidatePath(`/platform/companies/${tenantId}`);
  revalidatePath("/platform/companies");
  return { ok: true, from, to, ...(revocation ? { revocation } : {}) };
}

/** Block a tenant: no login, no authenticated request, no engine/rollout action. */
export async function suspendTenant(tenantId: string, reason?: string): Promise<LifecycleResult> {
  return performLifecycle("suspend", tenantId, reason?.trim() || null);
}

/** Restore a suspended tenant to full operability. */
export async function reactivateTenant(tenantId: string, reason?: string): Promise<LifecycleResult> {
  return performLifecycle("reactivate", tenantId, reason?.trim() || null);
}

/** Archive a tenant: permanently read-only. Terminal — cannot be undone here. */
export async function archiveTenant(tenantId: string, reason?: string): Promise<LifecycleResult> {
  return performLifecycle("archive", tenantId, reason?.trim() || null);
}
