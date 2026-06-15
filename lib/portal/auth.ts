/**
 * Portal identity + guard (Phase 1.12A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the authenticated user to a client_user (the portal identity) via
 * the RLS-respecting user-context client (self-select policy). Staff users have
 * no client_user row -> null. Only ACTIVE portal users pass requirePortalUser.
 */
import "server-only";
import { redirect } from "next/navigation";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import type { PortalRole, PortalUserStatus } from "./access";
import type { PortalUser } from "./types";

type Row = {
  id: string;
  tenant_id: string;
  client_id: string;
  email: string;
  name: string | null;
  status: string;
  role: string;
  client: { name: string } | null;
};

export async function getCurrentPortalUser(): Promise<PortalUser | null> {
  const supabase = getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("client_user")
    .select("id, tenant_id, client_id, email, name, status, role, client:client_id(name)")
    .eq("id", user.id)
    .maybeSingle<Row>();
  if (!data) return null;

  return {
    id: data.id,
    tenantId: data.tenant_id,
    clientId: data.client_id,
    email: data.email,
    name: data.name,
    status: data.status as PortalUserStatus,
    role: data.role as PortalRole,
    clientName: data.client?.name ?? null,
  };
}

/** Active portal user or redirect to the portal login. */
export async function requirePortalUser(): Promise<PortalUser> {
  const u = await getCurrentPortalUser();
  if (!u || u.status !== "ACTIVE") redirect("/portal/login");
  return u;
}
