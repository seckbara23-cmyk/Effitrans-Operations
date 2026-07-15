import "server-only";

/**
 * Workspace switcher resolution (Phase 6.0H). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the switcher menu for the current session. READS OWN ROWS ONLY through the
 * RLS-respecting server client (app_user + organization + user_role for THIS user), so it
 * cannot see another user's memberships and changes no isolation boundary. Platform
 * identity is resolved by the existing getPlatformUser (no inheritance). The pure builder
 * (lib/workspace/model) turns the reads into the menu.
 *
 * A suspended/archived tenant is still READ here (the self-select RLS does not depend on
 * lifecycle) so the membership can be shown DISABLED — unlike getCurrentUser, which hides
 * a blocked tenant entirely (correct for access, wrong for a "why can't I switch" menu).
 */
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getPlatformUser } from "@/lib/platform/auth";
import { buildWorkspaceMenu, type TenantMembershipInput, type WorkspaceMenu } from "./model";

type OrgRel = { name?: string; trade_name?: string | null; lifecycle_status?: string; trial_ends_at?: string | null };

function normalizeOrg(rel: unknown): OrgRel {
  const row = Array.isArray(rel) ? rel[0] : rel;
  return (row && typeof row === "object" ? row : {}) as OrgRel;
}

/** The switcher menu for the current session, or null when signed out. Request-memoized. */
export const getWorkspaceMenu = cache(async (): Promise<WorkspaceMenu | null> => {
  const supabase = getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // The user's OWN tenant membership(s) + their org (self-select RLS). One row today.
  const { data: rows } = await supabase
    .from("app_user")
    .select("tenant_id, status, organization:tenant_id(name, trade_name, lifecycle_status, trial_ends_at)")
    .eq("id", user.id);

  const memberships: TenantMembershipInput[] = [];
  for (const r of rows ?? []) {
    const org = normalizeOrg(r.organization);
    // Roles held in THIS tenant (own rows via RLS) → a French role summary.
    const { data: roleRows } = await supabase
      .from("user_role")
      .select("role:role_id(code)")
      .eq("user_id", user.id)
      .eq("tenant_id", r.tenant_id)
      .returns<{ role: { code: string } | null }[]>();
    const roleCodes = (roleRows ?? []).map((x) => x.role?.code).filter((c): c is string => Boolean(c));

    memberships.push({
      tenantId: r.tenant_id,
      status: r.status,
      name: org.trade_name ?? org.name ?? "Espace",
      lifecycleStatus: typeof org.lifecycle_status === "string" ? org.lifecycle_status : "ACTIVE",
      trialEndsAt: typeof org.trial_ends_at === "string" ? org.trial_ends_at : null,
      roleCodes,
    });
  }

  // Platform identity — existing resolver, no inheritance either way.
  const platform = await getPlatformUser();

  return buildWorkspaceMenu({
    email: user.email ?? "",
    memberships,
    platform: platform ? { role: platform.role } : null,
    now: Date.now(),
  });
});
