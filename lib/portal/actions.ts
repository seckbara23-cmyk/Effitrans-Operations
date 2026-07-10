"use server";

/**
 * Portal session action (Phase 1.12A). SERVER ACTION.
 * ---------------------------------------------------------------------------
 * Called by the portal login page after a successful sign-in. Verifies the
 * authenticated user IS a portal user, flips INVITED -> ACTIVE on first login,
 * stamps last_login_at, and audits. Rejects DISABLED and non-portal (staff)
 * users so they can never establish a portal session.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export async function recordPortalLogin(): Promise<{ ok: boolean; error?: string; mustChangePassword?: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false, error: "no_session" };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, status, tenant_id, login_count, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_portal" };
  if (cu.status === "DISABLED") return { ok: false, error: "disabled" };

  const wasInvited = cu.status === "INVITED";
  // Phase 2.1A — portal password login metadata (presence).
  const now = new Date().toISOString();
  await admin
    .from("client_user")
    .update({
      status: "ACTIVE",
      last_login_at: now,
      last_seen_at: now,
      last_login_method: "portal_password",
      login_count: (cu.login_count ?? 0) + 1,
    })
    .eq("id", user.id);

  if (wasInvited) {
    await writeAudit({
      action: AuditActions.PORTAL_USER_ACTIVATED,
      clientUserId: user.id,
      tenantId: cu.tenant_id,
      entity: "client_user",
      entityId: user.id,
    });
  }
  await writeAudit({
    action: AuditActions.PORTAL_LOGIN,
    clientUserId: user.id,
    tenantId: cu.tenant_id,
    entity: "client_user",
    entityId: user.id,
  });
  // Phase 3.2B — signal the client to route through the forced change-password
  // screen. The (app) layout guard enforces this server-side regardless.
  return { ok: true, mustChangePassword: cu.must_change_password === true };
}
