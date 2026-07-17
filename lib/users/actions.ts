"use server";

/**
 * User-management server actions (Task 6a). SERVER ACTIONS / SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Every action: (1) gates on a permission, (2) scopes to the caller's tenant,
 * (3) performs the privileged op via the service-role admin client, (4) writes
 * an append-only audit entry, (5) revalidates /users. The service role never
 * reaches the client — the client only invokes these action proxies.
 *
 * No session/presence/IP/device tracking (that is Task 6b).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";
import { validateCreateUser } from "./validate";
import { generateTempPassword } from "@/lib/portal/temp-password";
// The secure welcome / set-password pipeline now lives in ONE shared module (6.0E-3),
// reused by this tenant action and the platform invitation action alike.
import { sendStaffWelcome, returnsLink, type WelcomeResult } from "./welcome-send";
import { canTransition, toStaffStatus } from "./lifecycle";
import { setUserAuthBan } from "@/lib/platform/session-revocation";
import type { ActionResult, CredentialMode, CreateUserError } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/**
 * Find an existing auth user by email, or null. GoTrue's admin API has no get-by-email;
 * page until found or exhausted. (Same shape as the 6.0A provisioning engine.)
 */
async function findAuthUserByEmail(supabase: Admin, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function tenantRoleIds(supabase: ReturnType<typeof getAdminSupabaseClient>, tenantId: string): Promise<Set<string>> {
  const { data } = await supabase.from("role").select("id").eq("tenant_id", tenantId);
  return new Set((data ?? []).map((r) => r.id));
}

/**
 * Create a tenant staff user (Phase 5.0E-4 — repaired).
 *
 * THE ROOT-CAUSE FIXES this rewrite carries:
 *   1. RECONCILE, don't blindly create. An email whose auth user exists but has NO
 *      app_user is REUSED (the orphan from a prior partial failure heals) rather than
 *      failing forever on "already registered". An email that already has an app_user
 *      is a real duplicate → email_conflict.
 *   2. COMPENSATE on partial failure — but ONLY delete an auth user THIS call created.
 *      A pre-existing auth user is never deleted. No more orphans, no more unusable
 *      half-created users.
 *   3. CLOSED, SAFE ERROR CODES — never a raw GoTrue/Supabase/service-role string.
 *
 * CREDENTIAL MODES: setup_email (no password; secure link), generate (CSPRNG temp
 * password shown once), manual (admin-entered). A password is NEVER emailed in any mode.
 */
export async function createUser(form: {
  email: string;
  name?: string;
  password?: string;
  roleIds?: string[];
  sendWelcome?: boolean;
  credentialMode?: CredentialMode;
}): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const mode: CredentialMode = form.credentialMode ?? "setup_email";
  const email = form.email.trim().toLowerCase();

  // Validate. In manual mode the entered password must meet the policy; in the other
  // modes there is no admin-entered password to validate.
  if (mode === "manual") {
    // validateCreateUser returns "invalid_email" | "weak_password" | null — both are
    // members of the safe CreateUserError vocabulary.
    const invalid = validateCreateUser({ email, name: form.name, password: form.password ?? "" });
    if (invalid === "invalid_email" || invalid === "weak_password") return { ok: false, error: invalid };
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_email" };
  }

  const supabase = getAdminSupabaseClient();

  // Roles: EVERY submitted role must be a real role of THIS tenant. We reject rather
  // than silently drop, so the admin learns their selection was rejected.
  const validRoleIds = await tenantRoleIds(supabase, admin.tenantId);
  const requestedRoles = form.roleIds ?? [];
  if (requestedRoles.some((id) => !validRoleIds.has(id))) {
    return { ok: false, error: "invalid_role" };
  }

  // The credential we hand GoTrue. setup_email: none (they set it via the link).
  const generated = mode === "generate" ? generateTempPassword() : null;
  const password = mode === "manual" ? form.password : mode === "generate" ? generated! : undefined;

  // --- Stage 1: reconcile or create the auth user -----------------------------------
  const existingAuthId = await findAuthUserByEmail(supabase, email);
  let authId: string;
  let createdHere: boolean;

  if (existingAuthId) {
    // Does this auth user already belong to a tenant? If so it is a genuine duplicate.
    const { data: existingProfile } = await supabase
      .from("app_user")
      .select("id")
      .eq("id", existingAuthId)
      .maybeSingle();
    if (existingProfile) return { ok: false, error: "email_conflict" };

    // Orphan (auth user, no profile): REUSE it. Set the password if one was chosen.
    authId = existingAuthId;
    createdHere = false;
    if (password) {
      const { error } = await supabase.auth.admin.updateUserById(authId, { password });
      if (error) return { ok: false, error: "auth_failed" };
    }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      ...(password ? { password } : {}),
      email_confirm: true,
    });
    if (error || !data.user) {
      reportError(error, { scope: "action", event: "users.auth_create" });
      // GoTrue's own duplicate signal, mapped to the safe code.
      const msg = (error?.message ?? "").toLowerCase();
      return { ok: false, error: /already|registered|exists/.test(msg) ? "email_conflict" : "auth_failed" };
    }
    authId = data.user.id;
    createdHere = true;
  }

  // --- Stage 2: the tenant profile --------------------------------------------------
  const { error: insErr } = await supabase.from("app_user").insert({
    id: authId,
    tenant_id: admin.tenantId,
    email,
    name: form.name?.trim() || null,
    status: "active",
  });
  if (insErr) {
    // COMPENSATE: undo ONLY what we created. A reused (pre-existing) auth user is left
    // untouched — deleting it could destroy a real login. A created one is removed so
    // the email is not poisoned for the retry.
    if (createdHere) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(authId);
      if (delErr) reportError(delErr, { scope: "action", event: "users.compensation_failed", extra: { authId } });
    }
    reportError(insErr, { scope: "action", event: "users.profile_insert" });
    return { ok: false, error: "profile_failed" };
  }

  // --- Stage 3: roles (all validated above) -----------------------------------------
  for (const roleId of requestedRoles) {
    await supabase.from("user_role").insert({ user_id: authId, role_id: roleId, tenant_id: admin.tenantId });
  }

  // --- Audit. The generated password NEVER appears here — only that one was issued. --
  await writeAudit({
    action: generated ? AuditActions.USER_CREATED_WITH_TEMP_PASSWORD : AuditActions.USER_CREATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: authId,
    after: { email, roles: requestedRoles, credentialMode: mode, reusedAuthUser: !createdHere },
  });

  // --- Welcome (best-effort). A password is never emailed; setup_email always sends a
  // link, generate/manual send one only if the admin asked. --------------------------
  const wantWelcome = mode === "setup_email" || form.sendWelcome === true;
  const welcome: WelcomeResult = wantWelcome
    ? await sendStaffWelcome(
        supabase,
        { tenantId: admin.tenantId, actorId: admin.id },
        { userId: authId, email, name: form.name?.trim() || null },
      )
    : { outcome: "skipped" };

  revalidatePath("/users");
  return {
    ok: true,
    userId: authId,
    welcome: welcome.outcome,
    // The one-time secret, returned ONCE, in the result only. Never persisted/logged.
    ...(generated ? { temporaryPassword: generated } : {}),
    ...(returnsLink(welcome.outcome) && welcome.setupLink ? { setupLink: welcome.setupLink } : {}),
  };
}

/**
 * Send / resend the secure welcome + set-password email to an EXISTING staff
 * user (Phase 1.19B). Same template + recovery link as the create flow, no
 * plaintext password. Best-effort: a queue failure surfaces as an error to the
 * admin but never changes the user. Tenant-scoped + permission-gated.
 */
export async function sendWelcomeEmail(userId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, name, status")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };
  // 8.1A — an ARCHIVED user receives no invitation / setup link (restore first).
  if (toStaffStatus(target.status) === "archived") return { ok: false, error: "user_archived" };

  // A distinct audit trail for the resend request itself (safe metadata only).
  await writeAudit({
    action: AuditActions.USER_WELCOME_RESEND_REQUESTED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: target.id,
  });

  const welcome = await sendStaffWelcome(
    supabase,
    { tenantId: admin.tenantId, actorId: admin.id },
    { userId: target.id, email: target.email, name: target.name },
  );

  // Honest: only a real, provider-backed delivery — or the deliberate no-provider
  // "link returned" — counts as success. A generation/delivery failure is an error.
  const hardFail =
    welcome.outcome === "provider_unavailable" ||
    welcome.outcome === "link_generation_failed" ||
    welcome.outcome === "delivery_failed";
  if (hardFail) return { ok: false, error: "welcome_failed" as CreateUserError };
  return {
    ok: true,
    welcome: welcome.outcome,
    ...(welcome.setupLink ? { setupLink: welcome.setupLink } : {}),
  };
}

export async function setUserStatus(userId: string, status: "active" | "inactive"): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  // Prevent self-lockout.
  if (userId === admin.id && status === "inactive") return { ok: false, error: "cannot_disable_self" };

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, status")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  // 8.1A — suspend/reactivate never touches an ARCHIVED user; leaving archived is
  // exclusively restoreUser (the single lifecycle module decides what is legal).
  if (!canTransition(toStaffStatus(target.status), status)) {
    return { ok: false, error: target.status === "archived" ? "user_archived" : "generic" };
  }

  const { error } = await supabase
    .from("app_user")
    .update({ status })
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    reportError(error, { scope: "action", event: "users.set_status" });
    return { ok: false, error: "generic" };
  }

  await writeAudit({
    action: status === "active" ? AuditActions.USER_ACTIVATED : AuditActions.USER_DEACTIVATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    before: { status: target.status },
    after: { status },
  });
  revalidatePath("/users");
  return { ok: true };
}

/**
 * Archive a staff user — permanent employee departure (Phase 8.1A).
 * ---------------------------------------------------------------------------
 * PRESERVES EVERYTHING: no row is deleted or reattributed — audit history, shipment/customs/
 * document/invoice ownership and AI activity remain attributable to this user forever. What
 * ends is ACCESS and FUTURE PARTICIPATION, through mechanisms that already exist:
 *   - app access: getCurrentUser() denies any non-'active' status (existing gate);
 *   - auth layer: the SAME ban lever as tenant session revocation (setUserAuthBan) rejects
 *     login, session refresh AND password-recovery grants at GoTrue;
 *   - invitations: sendWelcomeEmail refuses archived targets;
 *   - assignments/pickers: every reader already filters status='active', and every
 *     assignment write already validates the target is active.
 * Gate: admin:users:manage — held ONLY by SYSTEM_ADMIN (seed + role templates), which is
 * exactly the "only the System Administrator may archive/restore" rule with zero new
 * permissions. There is deliberately NO delete action anywhere in this module.
 */
export async function archiveUser(userId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (userId === admin.id) return { ok: false, error: "cannot_disable_self" };

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, status, email")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };
  if (!canTransition(toStaffStatus(target.status), "archived")) {
    return { ok: false, error: "user_archived" };
  }

  const { error } = await supabase
    .from("app_user")
    .update({ status: "archived" })
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    reportError(error, { scope: "action", event: "users.archive" });
    return { ok: false, error: "generic" };
  }

  // Auth-layer revocation (reused lever). A provider failure is reported + audited but never
  // rolls back the committed transition — the app-layer status gate denies access regardless.
  const banned = await setUserAuthBan(supabase, userId, true);
  if (!banned) reportError(new Error("auth ban failed"), { scope: "action", event: "users.archive_ban", extra: { userId } });

  await writeAudit({
    action: AuditActions.USER_ARCHIVED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    before: { status: target.status },
    after: { status: "archived", authBan: banned ? "ok" : "failed" },
  });
  revalidatePath("/users");
  return { ok: true };
}

/**
 * Restore an archived user to ACTIVE (Phase 8.1A) — the only exit from archived, and only a
 * SYSTEM_ADMIN (admin:users:manage) may perform it. Un-bans the auth user so they can
 * authenticate again; nothing else changes (roles were never removed by archiving).
 */
export async function restoreUser(userId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, status")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };
  if (toStaffStatus(target.status) !== "archived" || !canTransition("archived", "active")) {
    return { ok: false, error: "generic" };
  }

  const { error } = await supabase
    .from("app_user")
    .update({ status: "active" })
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    reportError(error, { scope: "action", event: "users.restore" });
    return { ok: false, error: "generic" };
  }

  const unbanned = await setUserAuthBan(supabase, userId, false);
  if (!unbanned) reportError(new Error("auth unban failed"), { scope: "action", event: "users.restore_unban", extra: { userId } });

  await writeAudit({
    action: AuditActions.USER_RESTORED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    before: { status: "archived" },
    after: { status: "active", authBan: unbanned ? "lifted" : "lift_failed" },
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function assignRole(userId: string, roleId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:roles:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase.from("app_user").select("id, tenant_id").eq("id", userId).maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const { data: role } = await supabase.from("role").select("id, code, tenant_id").eq("id", roleId).maybeSingle();
  if (!role || role.tenant_id !== admin.tenantId) return { ok: false, error: "invalid_role" };

  const { error } = await supabase
    .from("user_role")
    .insert({ user_id: userId, role_id: roleId, tenant_id: admin.tenantId });
  if (error && !/duplicate|unique/i.test(error.message)) {
    reportError(error, { scope: "action", event: "users.assign_role" });
    return { ok: false, error: "generic" };
  }

  await writeAudit({
    action: AuditActions.USER_ROLE_ASSIGNED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "user_role",
    entityId: userId,
    after: { role: role.code },
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function revokeRole(userId: string, roleId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:roles:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: role } = await supabase.from("role").select("id, code, tenant_id").eq("id", roleId).maybeSingle();
  if (!role || role.tenant_id !== admin.tenantId) return { ok: false, error: "invalid_role" };

  // Prevent an admin from revoking their own SYSTEM_ADMIN (self-lockout guard).
  if (userId === admin.id && role.code === "SYSTEM_ADMIN") return { ok: false, error: "cannot_revoke_own_admin" };

  const { error } = await supabase
    .from("user_role")
    .delete()
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    reportError(error, { scope: "action", event: "users.revoke_role" });
    return { ok: false, error: "generic" };
  }

  await writeAudit({
    action: AuditActions.USER_ROLE_REVOKED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "user_role",
    entityId: userId,
    before: { role: role.code },
  });
  revalidatePath("/users");
  return { ok: true };
}
