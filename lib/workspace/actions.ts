"use server";

/**
 * Workspace selection (Phase 6.0H). SERVER ACTION.
 * ---------------------------------------------------------------------------
 * The server-verified step when a user selects a TENANT workspace. It trusts NO client
 * data beyond the requested tenantId, and reuses the existing identity stack:
 *   - getCurrentUser resolves the caller's own ACTIVE + OPERABLE tenant (null when the
 *     tenant is suspended/archived/trial-expired — the lifecycle enforcement point);
 *   - membership is verified by matching that resolved tenant to the requested id (a user
 *     has one membership; a request for any other tenant is rejected as not_member);
 *   - the destination is the EXISTING landing resolver (getLandingRoute → resolveLandingRoute
 *     → postLoginPath), so identity routing (driver / courier / system admin) is not
 *     duplicated.
 *
 * This is NOT impersonation and creates NO membership: it only returns the route the user
 * would already land on for a tenant they already belong to. Platform selection needs no
 * action — it is a direct link to /platform, guarded by the platform layout.
 */
import { getCurrentUser, getStaffTenantBlockReason } from "@/lib/auth/current-user";
import { getLandingRoute } from "@/lib/navigation/server";

export type WorkspaceSelectResult =
  | { ok: true; href: string }
  | { ok: false; error: "unauthorized" | "not_member" | "not_operable" };

export async function selectTenantWorkspace(tenantId: string): Promise<WorkspaceSelectResult> {
  if (!tenantId) return { ok: false, error: "not_member" };

  const user = await getCurrentUser();
  if (!user) {
    // Null means either signed out OR the caller's tenant is lifecycle-blocked. Distinguish
    // so the UI can say "unavailable" rather than bounce.
    const blocked = await getStaffTenantBlockReason();
    return { ok: false, error: blocked ? "not_operable" : "unauthorized" };
  }

  // The caller may only select a tenant they are an ACTIVE member of. getCurrentUser only
  // resolves their own membership, so a mismatch is an attempt to switch to a tenant that
  // is not theirs.
  if (user.tenantId !== tenantId) return { ok: false, error: "not_member" };

  const href = await getLandingRoute();
  return { ok: true, href: href ?? "/dashboard" };
}
