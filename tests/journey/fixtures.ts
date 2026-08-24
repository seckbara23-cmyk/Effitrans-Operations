/**
 * Journey fixtures — created through the LEGITIMATE application path only.
 * ---------------------------------------------------------------------------
 * No SQL manipulates process state anywhere in this harness. Identities are the
 * one thing seeded directly, because "who exists and what roles they hold" is
 * tenant configuration, not workflow state — the equivalent of an administrator
 * having created the accounts in `/users` before the rehearsal. Everything that
 * MOVES a dossier goes through a server action.
 */
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth/current-user";

export const TENANT_A = "00000000-0000-0000-0000-000000000001";

export function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "journey harness requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(the CI rls-tests job's local Supabase). Refusing to run against nothing.",
    );
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}

/**
 * Seed a staff identity holding exactly `roleCodes` in tenant A, and return the
 * `CurrentUser` the harness will impersonate. Permissions are NOT stubbed: they
 * are resolved from these real role grants by the real RBAC code.
 */
export async function seedIdentity(
  label: string,
  roleCodes: string[],
): Promise<CurrentUser> {
  const admin = db();
  const id = randomUUID();
  const email = `journey.${label}.${id.slice(0, 8)}@test.local`;

  // auth.users first (app_user.id references it in the platform's model).
  const { error: authErr } = await admin.schema("auth").from("users").insert({ id, email });
  if (authErr && !/duplicate/i.test(authErr.message)) {
    throw new Error(`seedIdentity(${label}): auth.users insert failed: ${authErr.message}`);
  }

  const { error: userErr } = await admin
    .from("app_user")
    .insert({ id, tenant_id: TENANT_A, email, name: `Journey ${label}`, status: "active" });
  if (userErr) throw new Error(`seedIdentity(${label}): app_user insert failed: ${userErr.message}`);

  for (const code of roleCodes) {
    const { data: role, error: roleErr } = await admin
      .from("role")
      .select("id")
      .eq("tenant_id", TENANT_A)
      .eq("code", code)
      .maybeSingle();
    if (roleErr || !role) throw new Error(`seedIdentity(${label}): role ${code} not found in tenant A`);
    const { error: urErr } = await admin
      .from("user_role")
      .insert({ user_id: id, role_id: role.id, tenant_id: TENANT_A });
    if (urErr) throw new Error(`seedIdentity(${label}): grant ${code} failed: ${urErr.message}`);
  }

  return { id, tenantId: TENANT_A, email, isSystemAdmin: false, roles: roleCodes };
}

/** Read an execution row — ASSERTION ONLY. The harness never writes these. */
export async function execution(fileId: string, stepKey: string) {
  const { data } = await db()
    .from("process_step_execution")
    .select("state, assigned_user_id, started_at, submitted_by, submitted_at, completed_at, process_instance_id")
    .eq("step_key", stepKey)
    .in(
      "process_instance_id",
      (await db().from("process_instance").select("id").eq("file_id", fileId)).data?.map((r) => r.id) ?? [],
    )
    .maybeSingle();
  return data;
}

/** Read audit rows for an entity — ASSERTION ONLY. */
export async function auditFor(action: string, entityId: string) {
  const { data } = await db()
    .from("audit_log")
    .select("action, actor_id, entity, entity_id, after, occurred_at")
    .eq("action", action)
    .eq("entity_id", entityId);
  return data ?? [];
}

/** The single open handoff on a dossier, if any — ASSERTION ONLY. */
export async function handoffs(fileId: string) {
  const inst = (await db().from("process_instance").select("id").eq("file_id", fileId)).data ?? [];
  const { data } = await db()
    .from("process_handoff")
    .select("id, from_step_key, to_step_key, status, sent_by, received_by")
    .in("process_instance_id", inst.map((r) => r.id));
  return data ?? [];
}
