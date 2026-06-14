/**
 * Client directory reads (Phase 1.1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reads go through the USER-CONTEXT client so RLS (tenant + client:read)
 * applies — the S2 read pattern. assertPermission gives a clean error instead
 * of a silent empty list. Reads are not audited.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/require-permission";
import type { ClientDetail, ClientListItem, ClientStatus } from "./types";

export async function listClients(opts?: { includeArchived?: boolean }): Promise<ClientListItem[]> {
  await assertPermission("client:read");
  const supabase = getServerSupabaseClient();

  let query = supabase
    .from("client")
    .select("id, name, ninea, segment, email, phone, status")
    .order("name", { ascending: true });

  if (!opts?.includeArchived) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;
  if (error) throw new Error(`[clients] list failed: ${error.message}`);

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    ninea: c.ninea,
    segment: c.segment,
    email: c.email,
    phone: c.phone,
    status: (c.status === "archived" ? "archived" : "active") as ClientStatus,
  }));
}

export async function getClient(id: string): Promise<ClientDetail | null> {
  await assertPermission("client:read");
  const supabase = getServerSupabaseClient();

  const { data: client } = await supabase
    .from("client")
    .select(
      "id, tenant_id, name, ninea, segment, email, phone, address, account_manager_id, status, created_at, archived_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!client) return null;

  const { data: contacts } = await supabase
    .from("client_contact")
    .select("id, name, role, email, phone, is_primary")
    .eq("client_id", id)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });

  return {
    id: client.id,
    tenantId: client.tenant_id,
    name: client.name,
    ninea: client.ninea,
    segment: client.segment,
    email: client.email,
    phone: client.phone,
    address: client.address,
    accountManagerId: client.account_manager_id,
    status: (client.status === "archived" ? "archived" : "active") as ClientStatus,
    createdAt: client.created_at,
    archivedAt: client.archived_at,
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.is_primary,
    })),
  };
}
