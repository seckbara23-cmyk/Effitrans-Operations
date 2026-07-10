/**
 * Assigned Effitrans officer for the portal (Phase 3.3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only officer contact for the dossier the portal user owns. Ownership is
 * checked with the RLS user-context client; the officer's public contact (name,
 * email, department, availability) is then read with the admin client. No new
 * business logic, no schema change — availability is derived from the existing
 * presence field (last_seen_at). Phone is not stored, so it is intentionally
 * omitted (the UI shows a placeholder and a mailto "Contact" action).
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { classifyAvailability } from "./shipment-view";
import type { PortalOfficer } from "./types";

export async function getPortalOfficer(fileId: string): Promise<PortalOfficer | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;

  const ctx = getServerSupabaseClient();
  const { data: own } = await ctx
    .from("operational_file")
    .select("id, assigned_to_user_id, account_manager_id, coordinator_id")
    .eq("id", fileId)
    .maybeSingle<{ id: string; assigned_to_user_id: string | null; account_manager_id: string | null; coordinator_id: string | null }>();
  if (!own) return null;

  const officerId = own.assigned_to_user_id ?? own.account_manager_id ?? own.coordinator_id;
  if (!officerId) return null;

  const admin = getAdminSupabaseClient();
  const [{ data: u }, { data: roleRows }] = await Promise.all([
    admin.from("app_user").select("name, email, last_seen_at").eq("id", officerId).eq("tenant_id", user.tenantId).maybeSingle<{ name: string | null; email: string; last_seen_at: string | null }>(),
    admin.from("user_role").select("role:role_id(label_fr, code)").eq("user_id", officerId).eq("tenant_id", user.tenantId).returns<{ role: { label_fr: string | null; code: string } | null }[]>(),
  ]);
  if (!u) return null;

  const department = roleRows?.[0]?.role?.label_fr ?? roleRows?.[0]?.role?.code ?? null;
  return {
    name: u.name,
    email: u.email,
    department,
    availability: classifyAvailability(u.last_seen_at, new Date()),
  };
}
