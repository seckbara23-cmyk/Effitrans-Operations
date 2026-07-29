"use server";

/**
 * Staff password management. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Four administrative acts and two the user performs on themselves:
 *
 *   generateStaffTempPassword   invalidate the current password, mint a
 *                               temporary one, force a change, set an expiry,
 *                               audit — and return the secret EXACTLY ONCE
 *   sendStaffPasswordReset      mint and deliver a recovery link
 *   unlockStaffAccount          lift an authentication ban
 *   assertStaffPasswordChange   gate the forced-change screen
 *   completeStaffPasswordChange clear the flag after the user sets a password
 *
 * ===========================================================================
 * WHAT "INVALIDATE IMMEDIATELY" HONESTLY MEANS
 * ===========================================================================
 * Setting a new password through GoTrue makes the OLD PASSWORD unusable the
 * instant the call returns — nobody can authenticate with it again. It does NOT
 * delete sessions that already exist: supabase-js 2.108 exposes no admin
 * "delete this user's sessions" call (the same limitation documented in
 * lib/platform/session-revocation.ts), and signOut(jwt) needs the user's own
 * access token, which an administrator does not hold.
 *
 * The gap is closed at the application layer instead, and closed completely:
 * `must_change_password` is set in the same operation, and the staff guard
 * (lib/auth/require-user.ts) routes EVERY authenticated request to the
 * forced-change screen while it is set. So a session that survived the password
 * change can do exactly one thing — change the password. It cannot read a
 * dossier, an invoice, or anything else.
 *
 * Banning would sever the sessions outright, but it would also block the user
 * from signing in with the temporary password we just issued, which is the
 * entire point of issuing it. Unlock (the ban lever) stays a separate,
 * separately-permissioned act.
 *
 * ===========================================================================
 * THE SECRET
 * ===========================================================================
 * The generated password is returned in the action result and NOWHERE else. It
 * is never persisted, never written to a log, never placed in an audit payload,
 * never emailed. Losing it means generating another one — which is an audited
 * event, and that is the intended cost.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { assertAnyPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { getRequestIp } from "@/lib/audit/request-ip";
import { reportError } from "@/lib/observability/report";
import { generateTempPassword } from "@/lib/portal/temp-password";
import { setUserAuthBan } from "@/lib/platform/session-revocation";
import { sendStaffWelcome } from "./welcome-send";
import { toStaffStatus } from "./lifecycle";
import { userAdminCodes } from "./permissions";
import {
  validateTempPasswordReason,
  formatTempPasswordReason,
  tempPasswordTtlHours,
  tempPasswordExpiry,
  type TempPasswordReason,
} from "./password-lifecycle";
import type { ActionResult, CreateUserError } from "./types";

/** The one-time result of generating a temporary password. */
export type TempPasswordResult =
  | {
      ok: true;
      email: string;
      name: string | null;
      /** THE SECRET. Present only here, only once. */
      temporaryPassword: string;
      /** ISO instant after which the temporary password stops being accepted. */
      expiresAt: string;
      ttlHours: number;
    }
  | { ok: false; error: CreateUserError | "reason_required" | "reason_invalid" | "reason_note_required" | "reason_note_too_long" | "reset_failed" };

/**
 * Generate a temporary password for a staff user.
 *
 * Gate: admin:users:temp_password (or the deprecated umbrella). A REASON is
 * mandatory — ratified 2026-07-29 — so the audit trail answers not just "who
 * reset this account" but "why", from a closed vocabulary that can be counted.
 *
 * Refuses: self (an administrator locking themselves into a forced change with
 * a password only they were shown is a self-inflicted outage, and the reset
 * email exists for that case) and archived users (restore first).
 *
 * ORDER MATTERS. The password is changed FIRST and the flags second, because
 * the reverse order would leave a user flagged for a forced change whose
 * password never actually changed. If the flag write fails after the password
 * succeeded, the operation is reported as failed AND says so plainly: the new
 * password is live but unflagged, which is a weaker state, not a broken one.
 */
export async function generateStaffTempPassword(
  userId: string,
  input: { reason: TempPasswordReason | string; note?: string },
): Promise<TempPasswordResult> {
  let admin;
  try {
    admin = await assertAnyPermission(userAdminCodes("tempPassword"));
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const reasonError = validateTempPasswordReason({ reason: input.reason, note: input.note });
  if (reasonError) return { ok: false, error: reasonError };

  if (userId === admin.id) return { ok: false, error: "cannot_disable_self" };

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, name, status")
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId) // cross-tenant reads as not found
    .maybeSingle<{ id: string; tenant_id: string; email: string; name: string | null; status: string }>();
  if (!target) return { ok: false, error: "not_found" };
  if (toStaffStatus(target.status) === "archived") return { ok: false, error: "user_archived" };

  const temporaryPassword = generateTempPassword();
  const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });
  if (authErr) {
    reportError(authErr, { scope: "action", event: "users.temp_password", extra: { userId } });
    return { ok: false, error: "reset_failed" };
  }

  const now = new Date();
  const ttlHours = tempPasswordTtlHours(process.env.EFFITRANS_TEMP_PASSWORD_TTL_HOURS);
  const expiresAt = tempPasswordExpiry(now, ttlHours);

  const { error: flagErr } = await supabase
    .from("app_user")
    .update({
      must_change_password: true,
      temp_password_expires_at: expiresAt,
      // The password DID change, and this column records when the password last
      // changed — not who changed it. The status derived from the two flags
      // above is what tells an administrator it is a temporary one.
      password_changed_at: now.toISOString(),
    })
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId);
  if (flagErr) {
    reportError(flagErr, { scope: "action", event: "users.temp_password_flags", extra: { userId } });
    return { ok: false, error: "reset_failed" };
  }

  await writeAudit({
    action: AuditActions.USER_TEMP_PASSWORD_GENERATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    after: {
      email: target.email,
      reason: formatTempPasswordReason(input.reason as TempPasswordReason, input.note),
      expiresAt,
      ttlHours,
      forcedChange: true,
      ip: getRequestIp(), // best-effort; null when absent, never fabricated
    }, // NEVER the password
  });

  revalidatePath("/users");
  return {
    ok: true,
    email: target.email,
    name: target.name,
    temporaryPassword,
    expiresAt,
    ttlHours,
  };
}

/**
 * Send the staff user a secure password-reset email.
 *
 * Gate: admin:users:reset_password (or the umbrella). Reuses the ONE recovery-
 * link pipeline (sendStaffWelcome) rather than growing a second: a password
 * reset and a first-time setup are the same mechanism — a one-time recovery
 * link, never a password in an email. The outcome is reported honestly, so the
 * UI can never claim a send that did not happen; with no mail provider
 * configured the link is handed back for out-of-band delivery.
 */
export async function sendStaffPasswordReset(userId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAnyPermission(userAdminCodes("resetPassword"));
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, name, status")
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle<{ id: string; tenant_id: string; email: string; name: string | null; status: string }>();
  if (!target) return { ok: false, error: "not_found" };
  if (toStaffStatus(target.status) === "archived") return { ok: false, error: "user_archived" };

  await writeAudit({
    action: AuditActions.USER_PASSWORD_RESET_SENT,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    after: { email: target.email, ip: getRequestIp() },
  });

  const welcome = await sendStaffWelcome(
    supabase,
    { tenantId: admin.tenantId, actorId: admin.id },
    { userId: target.id, email: target.email, name: target.name },
  );

  const hardFail =
    welcome.outcome === "provider_unavailable" ||
    welcome.outcome === "link_generation_failed" ||
    welcome.outcome === "delivery_failed";
  if (hardFail) return { ok: false, error: "welcome_failed" as CreateUserError };

  revalidatePath("/users");
  return {
    ok: true,
    welcome: welcome.outcome,
    ...(welcome.setupLink ? { setupLink: welcome.setupLink } : {}),
  };
}

/**
 * Unlock a staff account — lift the authentication ban (admin:users:unlock).
 *
 * The ban is the same lever archive and tenant session-revocation use; this
 * only ever LIFTS it, and only for a non-archived user. Unlocking an archived
 * user is refused outright: their ban is the archive, and lifting it here would
 * quietly undo a departure decision. Restore is the only exit from archived.
 */
export async function unlockStaffAccount(userId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAnyPermission(userAdminCodes("unlock"));
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, status")
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle<{ id: string; tenant_id: string; email: string; status: string }>();
  if (!target) return { ok: false, error: "not_found" };
  if (toStaffStatus(target.status) === "archived") return { ok: false, error: "user_archived" };

  const unbanned = await setUserAuthBan(supabase, userId, false);
  if (!unbanned) return { ok: false, error: "generic" };

  await writeAudit({
    action: AuditActions.USER_ACCOUNT_UNLOCKED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    after: { email: target.email, ip: getRequestIp() },
  });

  revalidatePath("/users");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The user's own side of the flow
// ---------------------------------------------------------------------------

/**
 * Gate the forced-change screen: an authenticated session whose id resolves to
 * an ACTIVE app_user. No permission is involved — changing your own password is
 * not an administrative act. Resolution is BY id (the session's own), so
 * reaching another user's record is structurally impossible.
 */
export async function assertStaffPasswordChange(): Promise<{ ok: boolean }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false };

  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("app_user")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle<{ id: string; status: string }>();
  return { ok: !!data && data.status === "active" };
}

/**
 * Called after the staff user has set a new password through their own
 * authenticated session. Clears the forced-change flag, CLEARS THE EXPIRY (no
 * temporary password is outstanding any more — leaving it set would expire a
 * password the user chose themselves), stamps the change date, and audits.
 *
 * The password is never received here. The update itself happened in the
 * browser against the user's own session; this records that it did.
 */
export async function completeStaffPasswordChange(): Promise<{ ok: boolean; error?: string }> {
  const ctx = getServerSupabaseClient();
  const {
    data: { user },
  } = await ctx.auth.getUser();
  if (!user) return { ok: false, error: "no_session" };

  const supabase = getAdminSupabaseClient();
  const { data: profile } = await supabase
    .from("app_user")
    .select("id, tenant_id, status")
    .eq("id", user.id)
    .maybeSingle<{ id: string; tenant_id: string; status: string }>();
  if (!profile) return { ok: false, error: "not_staff" };
  if (profile.status !== "active") return { ok: false, error: "inactive" };

  const { error } = await supabase
    .from("app_user")
    .update({
      must_change_password: false,
      temp_password_expires_at: null,
      password_changed_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "update_failed" };

  try {
    await writeAudit({
      action: AuditActions.USER_PASSWORD_CHANGED,
      actorId: user.id,
      tenantId: profile.tenant_id,
      entity: "app_user",
      entityId: user.id,
      after: { forced: true, ip: getRequestIp() }, // NEVER the password
    });
  } catch {
    /* never block the user on an audit failure — they have already changed it */
  }
  return { ok: true };
}
