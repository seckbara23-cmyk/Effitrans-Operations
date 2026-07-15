"use server";

/**
 * Platform invitation operations (Phase 6.0E-3). SERVER ACTIONS — platform admins only.
 * ---------------------------------------------------------------------------
 * Resend, regenerate, and cancel an outstanding staff invitation from the Company Detail
 * console. These REUSE the existing welcome/recovery pipeline (lib/users/welcome-send) —
 * there is no separate invitation subsystem. Every action:
 *   - is gated by platform:companies:update (the closest valid platform company-management
 *     permission; a tenant admin has no platform identity and cannot reach this path);
 *   - resolves the platform actor server-side and validates that the target user belongs
 *     to the target tenant — tenantId/userId are arguments, never spoofable actor claims;
 *   - checks eligibility from the DERIVED invitation state (no resend to someone already
 *     set up; no cancel of a completed setup);
 *   - audits with safe metadata only. A setup link is returned ONLY in the immediate
 *     result, never persisted, logged, audited, or placed in a URL.
 *
 * CANCELLATION IS REAL, NOT COSMETIC: it deactivates the app_user. getCurrentUser resolves
 * a non-active user to NO session, so even if the invitee still holds the old recovery
 * link and sets a password, they get no session and no access. The recovery token is also
 * rotated (best-effort) to close the auth layer too.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission, PlatformAuthError } from "./auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { sendStaffWelcome, returnsLink } from "@/lib/users/welcome-send";
import {
  deriveInvitationState,
  canResendInvitation,
  canCancelInvitation,
} from "@/lib/users/invitation-state";
import type { WelcomeOutcome } from "@/lib/users/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type InvitationOpResult =
  | { ok: true; welcome?: WelcomeOutcome; setupLink?: string }
  | { ok: false; error: "unauthorized" | "not_found" | "ineligible" | "failed" };

type TargetUser = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  last_login_at: string | null;
  onboarding_email_sent_at: string | null;
};

/** Load the target user, scoped to the target tenant. Null if missing or cross-tenant. */
async function loadTenantUser(admin: Admin, tenantId: string, userId: string): Promise<TargetUser | null> {
  const { data } = await admin
    .from("app_user")
    .select("id, tenant_id, email, name, status, last_login_at, onboarding_email_sent_at")
    .eq("id", userId)
    .maybeSingle();
  if (!data || data.tenant_id !== tenantId) return null;
  return data as unknown as TargetUser;
}

async function authorize(): Promise<{ id: string } | null> {
  try {
    return await assertPlatformPermission("platform:companies:update");
  } catch (e) {
    if (e instanceof PlatformAuthError) return null;
    throw e;
  }
}

/** Resend the secure welcome + set-password email to an eligible tenant user. */
export async function resendTenantInvitation(tenantId: string, userId: string): Promise<InvitationOpResult> {
  const actor = await authorize();
  if (!actor) return { ok: false, error: "unauthorized" };

  const admin = getAdminSupabaseClient();
  const user = await loadTenantUser(admin, tenantId, userId);
  if (!user) return { ok: false, error: "not_found" };

  const state = deriveInvitationState({
    status: user.status,
    lastLoginAt: user.last_login_at,
    onboardingEmailSentAt: user.onboarding_email_sent_at,
  });
  if (!canResendInvitation(state)) return { ok: false, error: "ineligible" };

  // A distinct, safe audit of the request itself.
  await writeAudit({
    action: AuditActions.USER_WELCOME_RESEND_REQUESTED,
    platformActorId: actor.id,
    tenantId,
    entity: "app_user",
    entityId: user.id,
  });

  const welcome = await sendStaffWelcome(
    admin,
    { tenantId, actorId: actor.id, platformActor: true },
    { userId: user.id, email: user.email, name: user.name },
  );

  const hardFail =
    welcome.outcome === "provider_unavailable" ||
    welcome.outcome === "link_generation_failed" ||
    welcome.outcome === "delivery_failed";
  if (hardFail) return { ok: false, error: "failed" };

  revalidatePath(`/platform/companies/${tenantId}`);
  return {
    ok: true,
    welcome: welcome.outcome,
    ...(returnsLink(welcome.outcome) && welcome.setupLink ? { setupLink: welcome.setupLink } : {}),
  };
}

/**
 * Regenerate a one-time setup link for an eligible tenant user and return it in the
 * result ONLY. Minting a new GoTrue recovery link rotates the token, invalidating any
 * previously handed-out link. The link is never persisted, logged, audited, or URL-borne.
 */
export async function regenerateTenantSetupLink(tenantId: string, userId: string): Promise<InvitationOpResult> {
  const actor = await authorize();
  if (!actor) return { ok: false, error: "unauthorized" };

  const admin = getAdminSupabaseClient();
  const user = await loadTenantUser(admin, tenantId, userId);
  if (!user) return { ok: false, error: "not_found" };

  const state = deriveInvitationState({
    status: user.status,
    lastLoginAt: user.last_login_at,
    onboardingEmailSentAt: user.onboarding_email_sent_at,
  });
  if (!canResendInvitation(state)) return { ok: false, error: "ineligible" };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: user.email,
    options: { redirectTo: `${siteUrl}/auth/update-password` },
  });
  const setupLink = link?.properties?.action_link ?? null;
  if (error || !setupLink) return { ok: false, error: "failed" };

  // Audit the ACT of regeneration — safe metadata only, NEVER the link.
  await writeAudit({
    action: AuditActions.USER_WELCOME_LINK_RETURNED,
    platformActorId: actor.id,
    tenantId,
    entity: "app_user",
    entityId: user.id,
    after: { regenerated: true, linkGenerated: true },
  });

  return { ok: true, setupLink };
}

/**
 * Cancel an outstanding invitation: deactivate the user (the ENFORCED invalidation) and
 * rotate the recovery token (best-effort). No hard delete — the row is preserved.
 */
export async function cancelTenantInvitation(tenantId: string, userId: string): Promise<InvitationOpResult> {
  const actor = await authorize();
  if (!actor) return { ok: false, error: "unauthorized" };

  const admin = getAdminSupabaseClient();
  const user = await loadTenantUser(admin, tenantId, userId);
  if (!user) return { ok: false, error: "not_found" };

  const state = deriveInvitationState({
    status: user.status,
    lastLoginAt: user.last_login_at,
    onboardingEmailSentAt: user.onboarding_email_sent_at,
  });
  if (!canCancelInvitation(state)) return { ok: false, error: "ineligible" };

  // THE enforced invalidation: a non-active app_user resolves to no session in
  // getCurrentUser, so the outstanding setup link can no longer grant access.
  const { error } = await admin.from("app_user").update({ status: "inactive" }).eq("id", user.id).eq("tenant_id", tenantId);
  if (error) return { ok: false, error: "failed" };

  // Best-effort: rotate the recovery token so the auth layer rejects the old link too.
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    await admin.auth.admin.generateLink({ type: "recovery", email: user.email, options: { redirectTo: `${siteUrl}/auth/update-password` } });
  } catch {
    /* the enforced app-level block already stands; token rotation is defence in depth */
  }

  await writeAudit({
    action: AuditActions.USER_INVITATION_CANCELLED,
    platformActorId: actor.id,
    tenantId,
    entity: "app_user",
    entityId: user.id,
    before: { status: user.status },
    after: { status: "inactive" },
  });

  revalidatePath(`/platform/companies/${tenantId}`);
  return { ok: true };
}
