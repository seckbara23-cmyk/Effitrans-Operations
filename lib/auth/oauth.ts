/**
 * OAuth server gate (Phase 1.16). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Runs AFTER exchangeCodeForSession in the /auth/callback route handler. Resolves
 * the authenticated user, looks up the staff profile BY auth.users.id (the
 * authority — never an email lookup), applies the pure gate (lib/auth/oauth-gate),
 * audits the outcome, and — on rejection — deletes the orphan auth.users row when
 * the id has NO profile of either class (open-registration backstop, DEC-B25).
 *
 * The caller (route handler) is responsible for signOut() + the redirect; this
 * returns the decision so the cookie/redirect handling stays in the handler.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { evaluateStaffOAuth, type OAuthGateResult } from "./oauth-gate";

export type StaffOAuthOutcome =
  | { ok: true }
  | { ok: false; reason: string; orphanDeleted: boolean };

/**
 * Gate a freshly-exchanged staff OAuth session. Best-effort audit; never throws
 * on the audit/cleanup path (auth correctness must not depend on them).
 */
export async function gateStaffOAuthLogin(): Promise<StaffOAuthOutcome> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false, reason: "no_session", orphanDeleted: false };

  const admin = getAdminSupabaseClient();

  // Profile resolved BY id (authority). Service-role read, scoped to this exact id.
  const { data: appUser } = await admin
    .from("app_user")
    .select("id, tenant_id, email, status")
    .eq("id", user.id)
    .maybeSingle();

  // Supabase marks the email verified on the user and/or the identity.
  const emailVerified =
    user.email_confirmed_at != null ||
    (Array.isArray(user.identities) &&
      user.identities.some((i) => (i.identity_data as { email_verified?: boolean } | null)?.email_verified === true));

  const result: OAuthGateResult = evaluateStaffOAuth({
    profile: appUser ? { email: appUser.email, status: appUser.status } : null,
    authEmail: user.email ?? null,
    emailVerified,
  });

  if (result.ok) {
    await safeAudit({
      action: AuditActions.AUTH_LOGIN_GOOGLE,
      actorId: user.id,
      tenantId: appUser?.tenant_id ?? null,
      entity: "app_user",
      entityId: user.id,
      after: { method: "google" },
    });
    return { ok: true };
  }

  // Rejected. If this auth id has NO profile of EITHER class, it is an orphan
  // (unknown Google account that still got an auth.users row) — delete it so no
  // unknown identity ever persists. A staff/portal account is never touched.
  let orphanDeleted = false;
  if (result.reason === "not_staff") {
    const { data: clientUser } = await admin
      .from("client_user")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!clientUser) {
      try {
        await admin.auth.admin.deleteUser(user.id);
        orphanDeleted = true;
      } catch {
        /* best-effort: signOut in the caller still tears down the session */
      }
    }
  }

  await safeAudit({
    action: AuditActions.AUTH_LOGIN_REJECTED,
    tenantId: appUser?.tenant_id ?? null,
    entity: "app_user",
    entityId: user.id,
    after: { method: "google", flow: "staff", reason: result.reason, orphan_deleted: orphanDeleted },
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
