"use server";

/**
 * Auth-event audit actions (interim task 5). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Records login/logout in the append-only audit log, attributed to the acting
 * user. These run on the server (writeAudit stays server-only); the client
 * invokes them as server actions. Best-effort — an audit failure must NEVER
 * block authentication, so each swallows its own errors.
 */
import { getCurrentUser } from "./current-user";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export async function recordLoginAudit(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    await writeAudit({
      action: AuditActions.AUTH_LOGIN,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "app_user",
      entityId: user.id,
    });
  } catch {
    // best-effort: never block auth on audit failure
  }
}

export async function recordLogoutAudit(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    await writeAudit({
      action: AuditActions.AUTH_LOGOUT,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "app_user",
      entityId: user.id,
    });
  } catch {
    // best-effort
  }
}
