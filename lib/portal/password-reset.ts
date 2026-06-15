"use server";

/**
 * Portal password recovery (Phase 1.16). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The portal mirror of lib/auth/password-reset. The reset email is triggered
 * from the browser (Supabase resetPasswordForEmail, PKCE); these add the
 * server-side discipline: internal-only audit for a real portal email
 * (anti-enumeration), a recovery-session gate (the id must be a non-DISABLED
 * client_user), and a completion audit. No auto-creation; no email change.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { normalizeEmail } from "@/lib/auth/oauth-gate";
import { isResettablePortal } from "./oauth-gate";

/** Audit a portal reset request, ONLY for a non-disabled portal email. Never leaks. */
export async function recordPortalPasswordResetRequest(email: string): Promise<void> {
  try {
    const target = normalizeEmail(email);
    if (!target) return;
    const admin = getAdminSupabaseClient();
    const { data: cu } = await admin
      .from("client_user")
      .select("id, tenant_id, email, status")
      .ilike("email", target)
      .maybeSingle();
    if (!cu || !isResettablePortal({ email: cu.email, status: cu.status })) return;
    await writeAudit({
      action: AuditActions.PORTAL_PASSWORD_RESET_REQUESTED,
      clientUserId: cu.id,
      tenantId: cu.tenant_id,
      entity: "client_user",
      entityId: cu.id,
      after: { method: "email" },
    });
  } catch {
    /* best-effort, anti-enumeration */
  }
}

/** The recovery session must be a non-DISABLED client_user (by id). Gates the form. */
export async function assertPortalRecovery(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, email, status")
    .eq("id", user.id)
    .maybeSingle();
  return { ok: isResettablePortal(cu ? { email: cu.email, status: cu.status } : null) };
}

/** Attribute + audit a completed portal reset (non-disabled client_user only). */
export async function recordPortalPasswordResetComplete(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const admin = getAdminSupabaseClient();
  const { data: cu } = await admin
    .from("client_user")
    .select("id, tenant_id, email, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!cu || !isResettablePortal({ email: cu.email, status: cu.status })) return { ok: false };

  try {
    await writeAudit({
      action: AuditActions.PORTAL_PASSWORD_RESET_COMPLETED,
      clientUserId: cu.id,
      tenantId: cu.tenant_id,
      entity: "client_user",
      entityId: cu.id,
      after: { method: "email" },
    });
  } catch {
    /* never block on audit */
  }
  return { ok: true };
}
