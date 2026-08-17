import "server-only";

/**
 * HR-10A — operational readiness for the guide. SERVER-ONLY, READ-ONLY.
 *
 * RQ-10.2, ratified: a capability that is IMPLEMENTED is not necessarily
 * OPERABLE by Effitrans today. Three shipped maker-checker controls — contract
 * verification, import approval, payroll adjustment decisions — each require a
 * SECOND distinct person; four authorities currently have no holder at all.
 *
 * The guide therefore does not carry a hand-written « non disponible » note
 * that would rot. It COUNTS the distinct active people holding each authority
 * and says what is true today. The day Effitrans designates a second Chargé RH
 * or staffs a Direction seat, the guide corrects itself.
 *
 * This is a census of the permission catalogue — no new table, no stored state.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { GUIDE_SECTIONS, type GuideSection } from "./guide/content";

export { GUIDE_SECTIONS, guideAnchorForRoute } from "./guide/content";
export type { GuideSection, GuideRequirement } from "./guide/content";

/** Distinct ACTIVE people holding each requested authority, in this tenant. */
export async function authorityHolderCounts(
  tenantId: string, codes: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(codes.map((c) => [c, 0]));
  if (codes.length === 0) return counts;
  const s = getAdminSupabaseClient();

  // permission -> roles -> users, keeping only active accounts of this tenant.
  const { data: perms } = await s.from("permission").select("id, code").in("code", [...codes]);
  const permById = new Map((perms ?? []).map((p) => [p.id, p.code]));
  if (permById.size === 0) return counts;

  const { data: rolePerms } = await s.from("role_permission")
    .select("role_id, permission_id").in("permission_id", [...permById.keys()]);
  const rolesByPerm = new Map<string, string[]>();
  for (const rp of rolePerms ?? []) {
    const code = permById.get(rp.permission_id);
    if (!code) continue;
    const list = rolesByPerm.get(code) ?? [];
    list.push(rp.role_id);
    rolesByPerm.set(code, list);
  }

  const allRoleIds = [...new Set((rolePerms ?? []).map((rp) => rp.role_id))];
  if (allRoleIds.length === 0) return counts;
  const { data: userRoles } = await s.from("user_role")
    .select("user_id, role_id").eq("tenant_id", tenantId).in("role_id", allRoleIds);
  const userIds = [...new Set((userRoles ?? []).map((ur) => ur.user_id))];
  if (userIds.length === 0) return counts;

  const { data: users } = await s.from("app_user")
    .select("id").eq("tenant_id", tenantId).eq("status", "active").in("id", userIds);
  const activeIds = new Set((users ?? []).map((u) => u.id));

  for (const [code, roleIds] of rolesByPerm) {
    const holders = new Set<string>();
    for (const ur of userRoles ?? []) {
      if (roleIds.includes(ur.role_id) && activeIds.has(ur.user_id)) holders.add(ur.user_id);
    }
    counts[code] = holders.size;
  }
  return counts;
}

export type SectionReadiness = {
  section: GuideSection;
  available: boolean;
  /** Plain-French reasons, one per unmet requirement. Empty when available. */
  blockedBy: string[];
};

/** Every section, with today's honest availability. */
export async function guideWithReadiness(tenantId: string): Promise<SectionReadiness[]> {
  const codes = [...new Set(GUIDE_SECTIONS.flatMap((s) => s.requires.map((r) => r.code)))];
  const counts = await authorityHolderCounts(tenantId, codes);
  return GUIDE_SECTIONS.map((section) => {
    const blockedBy = section.requires
      .filter((r) => (counts[r.code] ?? 0) < r.minHolders)
      .map((r) => `Il manque ${r.labelFr}.`);
    return { section, available: blockedBy.length === 0, blockedBy };
  });
}
