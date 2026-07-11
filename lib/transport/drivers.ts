/**
 * Assignable drivers list (Phase 3.4C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ACTIVE, same-tenant app_users holding the DRIVER role — for the dispatcher
 * assignment dropdown. Gated by transport:assign. Admin client after the gate;
 * scoped to the caller's tenant (no cross-tenant drivers).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";

export type AssignableDriver = { id: string; email: string };

export async function listAssignableDrivers(): Promise<AssignableDriver[]> {
  const user = await assertPermission("transport:assign");
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("user_role")
    .select("user:user_id(id, email, status), role:role_id(code)")
    .eq("tenant_id", user.tenantId)
    .returns<{ user: { id: string; email: string; status: string } | null; role: { code: string } | null }[]>();

  const seen = new Set<string>();
  const drivers: AssignableDriver[] = [];
  for (const r of data ?? []) {
    if (r.role?.code !== "DRIVER" || !r.user || r.user.status !== "active") continue;
    if (seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    drivers.push({ id: r.user.id, email: r.user.email });
  }
  return drivers;
}
