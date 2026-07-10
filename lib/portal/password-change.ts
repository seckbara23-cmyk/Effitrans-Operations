"use server";

/**
 * Portal forced password change (Phase 3.2B). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Backs /portal/auth/change-password. The password itself is updated by the
 * authenticated portal session client-side (supabase.auth.updateUser) — these
 * actions add the server discipline: gate the screen to a non-DISABLED portal
 * user, and on completion clear must_change_password, stamp presence, and audit
 * (portal.user.password_changed). The password is NEVER received or logged here.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

/** The change-password screen is reachable only by an authenticated, non-DISABLED portal user. */
export async function assertPortalPasswordChange(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle();
  return { ok: !!cu && cu.status !== "DISABLED" };
}

/**
 * Called after the portal user successfully sets a new password. Clears the
 * forced-change flag, refreshes presence, and audits. Only a non-DISABLED
 * client_user resolved BY id (never email) may complete — cross-tenant is
 * impossible because the id is the authenticated session's own id.
 */
export async function completePortalPasswordChange(): Promise<{ ok: boolean; error?: string }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false, error: "no_session" };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, tenant_id, client_id, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_portal" };
  if (cu.status === "DISABLED") return { ok: false, error: "disabled" };

  const { error } = await admin
    .from("client_user")
    .update({ must_change_password: false, last_seen_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  try {
    await writeAudit({
      action: AuditActions.PORTAL_USER_PASSWORD_CHANGED,
      clientUserId: user.id,
      tenantId: cu.tenant_id,
      entity: "client_user",
      entityId: user.id,
      after: { client_id: cu.client_id }, // NEVER the password
    });
  } catch {
    /* never block on audit */
  }
  return { ok: true };
}
