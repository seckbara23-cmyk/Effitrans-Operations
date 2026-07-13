/**
 * Server-side process nav resolution (Phase 5.0C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Called from the root layout. The flag is checked FIRST and short-circuits
 * before any auth or database work, so with the workspaces flag off this costs
 * nothing and the navigation is unchanged.
 */
import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { getProcessFlags } from "../config";
import { buildProcessNav, type ProcessNavSection } from "./nav";

export async function getProcessNav(): Promise<ProcessNavSection[]> {
  // Flag first: no auth call, no query, nothing, when the workspaces are dark.
  if (!getProcessFlags().workspaces) return [];

  const user = await getCurrentUser();
  if (!user) return [];

  const permissions = await getEffectivePermissions(user.id);
  return buildProcessNav(user.roles, permissions, true);
}
