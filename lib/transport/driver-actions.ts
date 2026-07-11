"use server";

/**
 * Dispatcher driver assignment (Phase 3.4C). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Assign / unassign a DRIVER app_user to a transport (sets transport_record.
 * driver_user_id — the link the driver mobile app + tracking RLS key on). Gated
 * by transport:assign + dossier visibility. The driver must be an ACTIVE,
 * same-tenant DRIVER (cross-tenant / inactive / non-driver rejected). Audited
 * (transport.driver.assigned/unassigned) with before/after; the driver gets one
 * in-app notification (reuses FILE_ASSIGNED — no new notification engine).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import type { ActionResult } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadTransport(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("transport_record")
    .select("id, file_id, driver_user_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

/** True iff userId is an ACTIVE, same-tenant app_user holding the DRIVER role. */
async function isTenantDriver(supabase: Admin, tenantId: string, userId: string): Promise<boolean> {
  const { data: appUser } = await supabase
    .from("app_user")
    .select("id, status, tenant_id")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!appUser || appUser.status !== "active") return false;
  const { data: roles } = await supabase
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .returns<{ role: { code: string } | null }[]>();
  return (roles ?? []).some((r) => r.role?.code === "DRIVER");
}

export async function assignDriverUser(transportId: string, driverUserId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, transportId, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };
  if (!(await isTenantDriver(supabase, user.tenantId, driverUserId))) return { ok: false, error: "invalid_driver" };
  if (rec.driver_user_id === driverUserId) return { ok: true, id: transportId }; // no-op, no notification spam

  const { error } = await supabase
    .from("transport_record")
    .update({ driver_user_id: driverUserId, assigned_by: user.id })
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_DRIVER_ASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: transportId,
    before: { driver_user_id: rec.driver_user_id },
    after: { driver_user_id: driverUserId },
  });
  // Best-effort: notify the assigned driver (reuses the existing in-app inbox).
  await createNotification({
    tenantId: user.tenantId,
    userId: driverUserId,
    type: "FILE_ASSIGNED",
    fileId: rec.file_id,
    title: "Nouvelle mission de transport",
    body: "Une mission vous a été assignée.",
  });
  revalidatePath(`/files/${rec.file_id}`);
  revalidatePath("/transport");
  return { ok: true, id: transportId };
}

export async function unassignDriverUser(transportId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, transportId, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };
  if (!rec.driver_user_id) return { ok: true, id: transportId };

  const { error } = await supabase
    .from("transport_record")
    .update({ driver_user_id: null })
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_DRIVER_UNASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: transportId,
    before: { driver_user_id: rec.driver_user_id },
    after: { driver_user_id: null },
  });
  revalidatePath(`/files/${rec.file_id}`);
  revalidatePath("/transport");
  return { ok: true, id: transportId };
}
