"use server";

/**
 * Staff password recovery (Phase 1.16). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The reset EMAIL is triggered from the browser (Supabase resetPasswordForEmail,
 * PKCE) so the code-verifier lives in the requester's browser for the later
 * exchange. These actions add the server-side discipline around it:
 *
 *  - recordPasswordResetRequest(email): best-effort, internal audit ONLY when the
 *    email belongs to an ACTIVE app_user. Returns nothing to the client (so it
 *    can never be used to enumerate accounts — the UI always shows a generic
 *    success message regardless).
 *  - assertStaffRecovery(): gate the update-password page — the recovery session
 *    must resolve (BY auth.users.id) to an ACTIVE app_user. Portal/inactive/
 *    orphan sessions are refused so they can never set a password via the staff
 *    flow. No auto-profile creation; email is never changed here.
 *  - recordPasswordResetComplete(): attribute + audit a finished reset.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { recordStaffLogin } from "@/lib/users/presence-track";
import { isActiveStaff, normalizeEmail } from "./oauth-gate";

/** Audit a reset request, but ONLY for an active staff email. Never leaks. */
export async function recordPasswordResetRequest(email: string): Promise<void> {
  try {
    const target = normalizeEmail(email);
    if (!target) return;
    const admin = getAdminSupabaseClient();
    const { data: appUser } = await admin
      .from("app_user")
      .select("id, tenant_id, email, status")
      .ilike("email", target)
      .maybeSingle();
    if (!appUser || !isActiveStaff({ email: appUser.email, status: appUser.status })) return;
    await writeAudit({
      action: AuditActions.AUTH_PASSWORD_RESET_REQUESTED,
      actorId: appUser.id,
      tenantId: appUser.tenant_id,
      entity: "app_user",
      entityId: appUser.id,
      after: { method: "email" },
    });
  } catch {
    /* best-effort: never surface anything (anti-enumeration) */
  }
}

/** The recovery session must be an ACTIVE app_user (by id). Used to gate the form. */
export async function assertStaffRecovery(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const admin = getAdminSupabaseClient();
  const { data: appUser } = await admin
    .from("app_user")
    .select("id, email, status")
    .eq("id", user.id)
    .maybeSingle();
  return { ok: isActiveStaff(appUser ? { email: appUser.email, status: appUser.status } : null) };
}

/** Attribute + audit a completed reset (active app_user only). */
export async function recordPasswordResetComplete(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const admin = getAdminSupabaseClient();
  const { data: appUser } = await admin
    .from("app_user")
    .select("id, tenant_id, email, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!appUser || !isActiveStaff({ email: appUser.email, status: appUser.status })) return { ok: false };

  try {
    await writeAudit({
      action: AuditActions.AUTH_PASSWORD_RESET_COMPLETED,
      actorId: appUser.id,
      tenantId: appUser.tenant_id,
      entity: "app_user",
      entityId: appUser.id,
      after: { method: "email" },
    });
  } catch {
    /* never block on audit */
  }
  // Phase 2.1A — completing a recovery is an authenticated session (presence).
  await recordStaffLogin(appUser.id, "recovery");
  return { ok: true };
}
