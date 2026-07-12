/**
 * Driver mission authorization + dispatcher notify (Phase 3.4C-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Shared helpers for the driver write actions: resolve the DRIVER caller, load a
 * transport ONLY if it is assigned to them (driver_user_id = caller), find the
 * current live session, and notify the dossier's dispatch owners. Trusted
 * associations are always derived server-side — never taken from the browser.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { createNotification } from "@/lib/notifications/create";
import { isDriver } from "./auth";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export async function driverContext(): Promise<CurrentUser | null> {
  const u = await getCurrentUser();
  return u && isDriver(u) ? u : null;
}

export type AssignedTransport = { id: string; file_id: string; status: string };

export async function loadAssignedTransport(supabase: Admin, user: CurrentUser, transportId: string): Promise<AssignedTransport | null> {
  const { data } = await supabase
    .from("transport_record")
    .select("id, file_id, status, driver_user_id")
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data || data.driver_user_id !== user.id) return null;
  return { id: data.id, file_id: data.file_id, status: data.status };
}

export type CurrentSession = { id: string; status: string; file_id: string };

/** The live (ACTIVE or PAUSED) session for the transport, or null. */
export async function currentSession(supabase: Admin, user: CurrentUser, transportId: string): Promise<CurrentSession | null> {
  const { data } = await supabase
    .from("tracking_session")
    .select("id, status, file_id")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", transportId)
    .in("status", ["ACTIVE", "PAUSED"])
    .order("started_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0];
  return row ? { id: row.id, status: row.status, file_id: row.file_id } : null;
}

/** Notify the dossier's dispatch owners (account manager / coordinator / creator). */
export async function notifyDispatchers(supabase: Admin, tenantId: string, fileId: string, title: string, body: string): Promise<void> {
  const { data: file } = await supabase
    .from("operational_file")
    .select("account_manager_id, coordinator_id, created_by")
    .eq("id", fileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!file) return;
  const targets = new Set<string>(
    [file.account_manager_id, file.coordinator_id, file.created_by].filter((x): x is string => Boolean(x)),
  );
  for (const uid of targets) {
    // Reuse the existing in-app inbox (FILE_ASSIGNED category); title conveys the alert.
    await createNotification({ tenantId, userId: uid, type: "FILE_ASSIGNED", fileId, title, body });
  }
}
