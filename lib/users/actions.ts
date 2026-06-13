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
import { validateCreateUser } from "./validate";
import type { ActionResult } from "./types";

async function tenantRoleIds(supabase: ReturnType<typeof getAdminSupabaseClient>, tenantId: string): Promise<Set<string>> {
  const { data } = await supabase.from("role").select("id").eq("tenant_id", tenantId);
  return new Set((data ?? []).map((r) => r.id));
}

export async function createUser(form: {
  email: string;
  name?: string;
  password: string;
  roleIds?: string[];
}): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("admin:users:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateCreateUser({ email: form.email, name: form.name, password: form.password });
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();
  const email = form.email.trim();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: form.password,
    email_confirm: true,
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? "create_failed" };

  const newId = data.user.id;
  const { error: insErr } = await supabase.from("app_user").insert({
    id: newId,
    tenant_id: admin.tenantId,
    email,
    name: form.name?.trim() || null,
    status: "active",
  });
  if (insErr) return { ok: false, error: insErr.message };

  // Only assign roles that belong to the caller's tenant (defends against tampered input).
  const validRoleIds = await tenantRoleIds(supabase, admin.tenantId);
  const toAssign = (form.roleIds ?? []).filter((id) => validRoleIds.has(id));
  for (const roleId of toAssign) {
    await supabase.from("user_role").insert({ user_id: newId, role_id: roleId, tenant_id: admin.tenantId });
  }

  await writeAudit({
    action: AuditActions.USER_CREATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "app_user",
    entityId: newId,
    after: { email, roles: toAssign },
  });
  revalidatePath("/users");
  return { ok: true };
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

  const { error } = await supabase
    .from("app_user")
    .update({ status })
    .eq("id", userId)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

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
  if (error && !/duplicate|unique/i.test(error.message)) return { ok: false, error: error.message };

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
  if (error) return { ok: false, error: error.message };

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
