/**
 * Portal OAuth server gate (Phase 1.16). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The portal mirror of lib/auth/oauth. Runs after exchangeCodeForSession in the
 * /portal/auth/callback route handler. Resolves the client_user BY id (the
 * authority), applies the pure gate (lib/portal/oauth-gate), activates an
 * INVITED user on first Google login, audits, and — on rejection — deletes the
 * orphan auth.users row when the id has NO profile of EITHER class (a staff
 * account, which has an app_user, is never deleted).
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { recordPortalLogin } from "@/lib/users/presence-track";
import { evaluatePortalOAuth, type PortalGateResult } from "./oauth-gate";

export type PortalOAuthOutcome =
  | { ok: true }
  | { ok: false; reason: string; orphanDeleted: boolean };

export async function gatePortalOAuthLogin(): Promise<PortalOAuthOutcome> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false, reason: "no_session", orphanDeleted: false };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, tenant_id, email, status")
    .eq("id", user.id)
    .maybeSingle();

  const emailVerified =
    user.email_confirmed_at != null ||
    (Array.isArray(user.identities) &&
      user.identities.some((i) => (i.identity_data as { email_verified?: boolean } | null)?.email_verified === true));

  const result: PortalGateResult = evaluatePortalOAuth({
    profile: cu ? { email: cu.email, status: cu.status } : null,
    authEmail: user.email ?? null,
    emailVerified,
  });

  if (result.ok) {
    // First Google login of an invited portal user activates them.
    if (result.activate) {
      await admin.from("client_user").update({ status: "ACTIVE" }).eq("id", user.id);
      await safeAudit({
        action: AuditActions.PORTAL_USER_ACTIVATED,
        clientUserId: user.id,
        tenantId: cu?.tenant_id ?? null,
        entity: "client_user",
        entityId: user.id,
      });
    }
    // Phase 2.1A — portal Google login metadata (presence): last_login/seen/method/count.
    await recordPortalLogin(user.id, "portal_google");
    await safeAudit({
      action: AuditActions.PORTAL_LOGIN_GOOGLE,
      clientUserId: user.id,
      tenantId: cu?.tenant_id ?? null,
      entity: "client_user",
      entityId: user.id,
      after: { method: "google" },
    });
    return { ok: true };
  }

  // Rejected. Delete the auth user ONLY if it has no profile of either class.
  let orphanDeleted = false;
  if (result.reason === "not_portal") {
    const { data: appUser } = await admin.from("app_user").select("id").eq("id", user.id).maybeSingle();
    if (!appUser) {
      try {
        await admin.auth.admin.deleteUser(user.id);
        orphanDeleted = true;
      } catch {
        /* best-effort: signOut in the caller still tears down the session */
      }
    }
  }

  await safeAudit({
    action: AuditActions.PORTAL_LOGIN_REJECTED,
    tenantId: cu?.tenant_id ?? null,
    entity: "client_user",
    entityId: user.id,
    after: { method: "google", flow: "portal", reason: result.reason, orphan_deleted: orphanDeleted },
  });

  return { ok: false, reason: result.reason, orphanDeleted };
}

async function safeAudit(event: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(event);
  } catch {
    /* never block auth on audit failure */
  }
}
