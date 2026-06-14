"use server";

/**
 * Client Management server actions (Phase 1.1). SERVER ACTIONS / SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors the established architecture (Task 6a): each action (1) gates on a
 * permission, (2) scopes to the caller's tenant, (3) performs the privileged
 * write via the service-role admin client, (4) writes an append-only audit
 * entry, (5) revalidates the affected paths. The service role never reaches the
 * client — the UI only invokes these action proxies.
 *
 * No shipments / customs / documents / finance.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { validateClient, normalizeNinea } from "./validate";
import type { ActionResult, ClientInput, ClientContactInput } from "./types";

function isUniqueViolation(message: string): boolean {
  return /duplicate key|unique constraint|uq_client_ninea/i.test(message);
}

type AdminClient = ReturnType<typeof getAdminSupabaseClient>;

async function insertContacts(
  supabase: AdminClient,
  tenantId: string,
  clientId: string,
  contacts: ClientContactInput[] | undefined,
): Promise<void> {
  const rows = (contacts ?? [])
    .filter((c) => (c.name ?? "").trim())
    .map((c) => ({
      tenant_id: tenantId,
      client_id: clientId,
      name: c.name.trim(),
      role: c.role?.trim() || null,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      is_primary: Boolean(c.isPrimary),
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from("client_contact").insert(rows);
    if (error) throw new Error(error.message);
  }
}

export async function createClient(input: ClientInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("client:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateClient(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();

  const { data, error } = await supabase
    .from("client")
    .insert({
      tenant_id: admin.tenantId,
      name: input.name.trim(),
      ninea: normalizeNinea(input.ninea),
      segment: input.segment?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      account_manager_id: input.accountManagerId || null,
      status: "active",
      created_by: admin.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error && isUniqueViolation(error.message)) return { ok: false, error: "ninea_taken" };
    return { ok: false, error: error?.message ?? "create_failed" };
  }

  try {
    await insertContacts(supabase, admin.tenantId, data.id, input.contacts);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "contact_failed" };
  }

  await writeAudit({
    action: AuditActions.CLIENT_CREATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "client",
    entityId: data.id,
    after: { name: input.name.trim(), ninea: normalizeNinea(input.ninea) },
  });

  revalidatePath("/clients");
  return { ok: true, id: data.id };
}

export async function updateClient(id: string, input: ClientInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("client:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateClient(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();

  // Tenant scope: ensure the target belongs to the caller's tenant.
  const { data: existing } = await supabase
    .from("client")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("client")
    .update({
      name: input.name.trim(),
      ninea: normalizeNinea(input.ninea),
      segment: input.segment?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      account_manager_id: input.accountManagerId || null,
    })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);

  if (error) {
    if (isUniqueViolation(error.message)) return { ok: false, error: "ninea_taken" };
    return { ok: false, error: error.message };
  }

  // Sync contacts: replace the client's contact set with the provided one.
  if (input.contacts !== undefined) {
    const { error: delErr } = await supabase
      .from("client_contact")
      .delete()
      .eq("client_id", id)
      .eq("tenant_id", admin.tenantId);
    if (delErr) return { ok: false, error: delErr.message };
    try {
      await insertContacts(supabase, admin.tenantId, id, input.contacts);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "contact_failed" };
    }
  }

  await writeAudit({
    action: AuditActions.CLIENT_UPDATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "client",
    entityId: id,
    after: { name: input.name.trim() },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true, id };
}

async function setClientStatus(
  id: string,
  status: "active" | "archived",
  action: typeof AuditActions.CLIENT_ARCHIVED | typeof AuditActions.CLIENT_RESTORED,
): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("client:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("client")
    .select("id, tenant_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("client")
    .update({ status, archived_at: status === "archived" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "client",
    entityId: id,
    before: { status: existing.status },
    after: { status },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true, id };
}

export async function archiveClient(id: string): Promise<ActionResult> {
  return setClientStatus(id, "archived", AuditActions.CLIENT_ARCHIVED);
}

export async function restoreClient(id: string): Promise<ActionResult> {
  return setClientStatus(id, "active", AuditActions.CLIENT_RESTORED);
}
