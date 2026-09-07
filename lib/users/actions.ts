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
import { assertAnyPermission } from "@/lib/auth/require-permission";
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
import { NON_ASSIGNABLE_STAFF_ROLE_CODES } from "./service";
// 2026-07-29 — each action now names the capability it needs instead of sharing
// one `admin:users:manage` token. userAdminCodes() returns [granular, umbrella],
// so a tenant whose migration has not been applied yet is never locked out.
import { userAdminCodes } from "./permissions";
import { displayNameFrom, validateIdentity, type StaffIdentityInput } from "./identity";
import { staffIdentityStored } from "./identity-141";
import type { ActionResult, CredentialMode, CreateUserError } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

function isNonAssignableStaffRole(code: string): boolean {
  return (NON_ASSIGNABLE_STAFF_ROLE_CODES as readonly string[]).includes(code);
}

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

async function tenantRoles(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data } = await supabase.from("role").select("id, code").eq("tenant_id", tenantId);
  return new Map((data ?? []).map((r) => [r.id, r.code] as const));
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
  /**
   * 2026-07-29 — the create form now offers Active / Inactive. Anything other
   * than an explicit "inactive" creates an active user, which is the behaviour
   * every existing caller relies on. Note that an inactive user cannot sign in
   * at all (getCurrentUser denies non-active), so a setup link sent to one will
   * not work until they are reactivated — the UI says so.
   */
  status?: "active" | "inactive";
}): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAnyPermission(userAdminCodes("create"));
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

  // Roles: EVERY submitted role must be a real role of THIS tenant, AND must not be a
  // portal-only code (CLIENT_USER) — that one exists in the catalog for labeling a
  // client_user, never for granting an app_user staff access. Rejected, not silently
  // dropped, so the admin learns their selection was invalid. (The root cause of the
  // production defect where a customer rep landed in the internal shell: she was created
  // here with the CLIENT_USER role instead of via the portal invite flow.)
  const roleCatalog = await tenantRoles(supabase, admin.tenantId);
  const requestedRoles = form.roleIds ?? [];
  if (requestedRoles.some((id) => !roleCatalog.has(id) || isNonAssignableStaffRole(roleCatalog.get(id)!))) {
    return { ok: false, error: "invalid_role" };
  }

  // Dual-identity guard, the reciprocal of lib/portal/admin-actions.ts's "email_is_staff":
  // an email already provisioned as a portal customer must never also become a staff
  // app_user — that would create the exact ambiguity classifySession is built to avoid.
  const { data: existingPortalUser } = await supabase
    .from("client_user")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingPortalUser) return { ok: false, error: "email_is_portal" };

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
  const createdStatus = form.status === "inactive" ? "inactive" : "active";
  const { error: insErr } = await supabase.from("app_user").insert({
    id: authId,
    tenant_id: admin.tenantId,
    email,
    name: form.name?.trim() || null,
    status: createdStatus,
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
    after: {
      email,
      roles: requestedRoles,
      credentialMode: mode,
      status: createdStatus,
      reusedAuthUser: !createdHere,
    },
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
    // Credential DELIVERY, not user creation: this mints the same one-time
    // recovery link a password reset does, so it takes the same capability.
    admin = await assertAnyPermission(userAdminCodes("resetPassword"));
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

// ------------------------------------------- canonical professional identity ----

/**
 * Edit a staff member's CANONICAL PROFESSIONAL IDENTITY from Administration →
 * Users. ADMIN-USER-IDENTITY-01, ratified 2026-09-07.
 *
 * ── WHAT IT WRITES, AND WHERE ───────────────────────────────────────────────
 *   app_user.name                     the display name (derived from first+last
 *                                     when the platform can store them)
 *   workforce_profile.job_title       « Titre principal » — the SAME column the
 *                                     Digital Business Card, the e-mail
 *                                     signature and generated documents already
 *                                     read, so the card needs no second value
 *   workforce_profile.first_name      ⧗ migration 20261003000001
 *   workforce_profile.last_name       ⧗ migration 20261003000001
 *   workforce_profile.staff_function  ⧗ migration 20261003000001
 *
 * ── WHAT IT MUST NEVER DO, AND CANNOT ───────────────────────────────────────
 * Grant anything. There is no role write, no `user_role` touch, no permission
 * lookup and no import of the RBAC modules in this function's reach: setting a
 * title of « Chef de Transit » writes one text column and nothing else. It also
 * never touches `id`, `email`, `status`, `is_system_admin`, the password
 * lifecycle, any assignment, or any of the 204 foreign keys that reference this
 * user — every one of which is a uuid, which is why a rename cannot break an
 * operational reference.
 *
 * ── AND IT NEVER LIES ABOUT PERSISTENCE ─────────────────────────────────────
 * Migration 20261003000001 is written and NOT applied. Rather than accepting a
 * Prénom and dropping it, the action REFUSES with `identity_schema_unavailable`
 * when the caller supplies a field the schema cannot hold. §21, verbatim: « do
 * not claim data was saved when it could not be persisted. »
 */
export async function updateUserIdentity(
  userId: string,
  input: StaffIdentityInput,
): Promise<ActionResult> {
  let admin;
  try {
    // The capability that already exists for editing a user. No new permission:
    // widening authority to change someone's professional identity would be its
    // own ratification, and SYSTEM_ADMIN already holds this.
    admin = await assertAnyPermission(userAdminCodes("update"));
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = validateIdentity(input);
  if (!parsed.ok) return { ok: false, error: "invalid_identity" };
  const v = parsed.value;

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, name, status")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };
  // 8.1A — an archived user is read-only everywhere else in this module; identity
  // is not the exception that reopens a departed account.
  if (target.status === "archived") return { ok: false, error: "user_archived" };

  const canStoreSplit = await staffIdentityStored();
  const wantsSplit =
    v.firstName !== undefined || v.lastName !== undefined || v.functionLabel !== undefined;
  if (wantsSplit && !canStoreSplit) return { ok: false, error: "identity_schema_unavailable" };

  // The profile row may not exist yet: 32 of 60 users have one. Reading it first
  // keeps the audit honest about what actually changed and lets the upsert carry
  // only the touched fields.
  const profileCols = canStoreSplit
    ? "user_id, job_title, first_name, last_name, staff_function"
    : "user_id, job_title";
  const { data: profile, error: profileErr } = await supabase
    .from("workforce_profile")
    .select(profileCols)
    .eq("user_id", userId)
    .maybeSingle();
  if (profileErr) {
    reportError(profileErr, { scope: "action", event: "users.identity.read" });
    return { ok: false, error: "generic" };
  }
  const before = (profile ?? {}) as Record<string, string | null>;

  // ---- the display name -----------------------------------------------------
  // Derived from first+last when both are known, so an administrator is never
  // asked to maintain the same fact twice (§6). On schema 138 the admin edits
  // it directly, which is the same field with one fewer inference.
  const nextFirst = v.firstName !== undefined ? v.firstName : (before.first_name ?? null);
  const nextLast = v.lastName !== undefined ? v.lastName : (before.last_name ?? null);
  const nextName = canStoreSplit
    ? displayNameFrom({
        firstName: nextFirst,
        lastName: nextLast,
        legacyName: v.displayName !== undefined ? v.displayName : target.name,
        email: target.email,
      })
    : displayNameFrom({
        legacyName: v.displayName !== undefined ? v.displayName : target.name,
        email: target.email,
      });

  if (nextName !== target.name) {
    const { error } = await supabase
      .from("app_user")
      .update({ name: nextName })
      .eq("id", userId)
      .eq("tenant_id", admin.tenantId);
    if (error) {
      reportError(error, { scope: "action", event: "users.identity.name" });
      return { ok: false, error: "generic" };
    }
  }

  // ---- the professional profile ---------------------------------------------
  const row: Record<string, unknown> = {
    user_id: userId,
    tenant_id: admin.tenantId,
    updated_by: admin.id,
  };
  if (v.mainTitle !== undefined) row.job_title = v.mainTitle;
  if (canStoreSplit) {
    if (v.firstName !== undefined) row.first_name = v.firstName;
    if (v.lastName !== undefined) row.last_name = v.lastName;
    if (v.functionLabel !== undefined) row.staff_function = v.functionLabel;
  }

  if (Object.keys(row).length > 3) {
    const { error } = await supabase
      .from("workforce_profile")
      .upsert(row as never, { onConflict: "user_id" });
    if (error) {
      reportError(error, { scope: "action", event: "users.identity.profile" });
      return { ok: false, error: "generic" };
    }
  }

  // ---- audit ----------------------------------------------------------------
  // Old and new VALUES, because a name and a title are the change itself and an
  // audit that recorded only field names could not answer « what was it before ».
  // Nothing here is a secret: no password, no token, no session, no auth
  // metadata — this function never reads any.
  const changed: Record<string, { before: string | null; after: string | null }> = {};
  if (nextName !== target.name) changed.display_name = { before: target.name, after: nextName };
  for (const [key, col] of [
    ["mainTitle", "job_title"],
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["functionLabel", "staff_function"],
  ] as const) {
    if (row[col] === undefined) continue;
    changed[col] = { before: before[col] ?? null, after: (row[col] as string | null) ?? null };
  }

  await writeAudit({
    action: AuditActions.USER_IDENTITY_UPDATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: userId,
    before: { display_name: target.name },
    after: { changed, schema: canStoreSplit ? "canonical" : "legacy_display_name_only" },
  });

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  // The branding surfaces read the SAME two stores, so they follow with no
  // second write — but their pages are cached and must be told.
  revalidatePath("/brand-center");
  return { ok: true };
}

export async function setUserStatus(userId: string, status: "active" | "inactive"): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAnyPermission(userAdminCodes("disable"));
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
    admin = await assertAnyPermission(userAdminCodes("disable"));
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
    admin = await assertAnyPermission(userAdminCodes("disable"));
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

/**
 * Role assignment is DUAL-AUTHORITY, and deliberately so. `admin:roles:manage`
 * (which has always guarded it) means "may shape what roles can do";
 * `admin:users:update` means "may edit this staff user", and a user's role
 * assignments are the substance of that edit. Either authorises it.
 *
 * This widens nothing today — SYSTEM_ADMIN is the only holder of both — but it
 * keeps the granular vocabulary honest: a permission described as "edit a staff
 * user (name, status, role assignments)" must actually authorise that.
 */
const ROLE_EDIT_CODES = ["admin:roles:manage", "admin:users:update", "admin:users:manage"] as const;

export async function assignRole(userId: string, roleId: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAnyPermission(ROLE_EDIT_CODES);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: target } = await supabase.from("app_user").select("id, tenant_id").eq("id", userId).maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const { data: role } = await supabase.from("role").select("id, code, tenant_id").eq("id", roleId).maybeSingle();
  if (!role || role.tenant_id !== admin.tenantId) return { ok: false, error: "invalid_role" };
  if (isNonAssignableStaffRole(role.code)) return { ok: false, error: "invalid_role" };

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
    admin = await assertAnyPermission(ROLE_EDIT_CODES);
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
