"use server";

/**
 * Auth-event audit actions (interim task 5). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Records login/logout in the append-only audit log, attributed to the acting
 * user. These run on the server (writeAudit stays server-only); the client
 * invokes them as server actions. Best-effort — an audit failure must NEVER
 * block authentication, so each swallows its own errors.
 */
import { getCurrentUser, getSessionClass } from "./current-user";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { recordStaffLogin } from "@/lib/users/presence-track";

/**
 * Where a just-signed-in user belongs (Phase 3.2B hotfix). A PORTAL client who
 * mistakenly used the STAFF /login (same Auth project accepts their password) is
 * sent to /portal instead of /dashboard — never into the staff loop. The portal
 * (app) layout then routes them to the forced change-password screen if needed.
 */
export async function loginDestination(): Promise<string> {
  const cls = await getSessionClass();
  if (cls === "portal") return "/portal";
  return "/dashboard"; // staff (and the orphan edge case, which /login re-renders)
}

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
    // Phase 2.1A — staff email/password login metadata (presence).
    await recordStaffLogin(user.id, "password");
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
