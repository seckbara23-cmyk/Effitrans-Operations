/**
 * HR-1 — pure organization-tree helpers. NO imports, NO server coupling —
 * unit-testable, safe for client and server alike.
 */
import type { Database } from "@/lib/db/types";

export type HrOrgUnit = Database["public"]["Tables"]["hr_org_unit"]["Row"];

export const UNIT_KINDS = ["BUSINESS_UNIT", "DEPARTMENT", "SECTION", "TEAM"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_KIND_LABEL_FR: Record<UnitKind, string> = {
  BUSINESS_UNIT: "Direction / Pôle",
  DEPARTMENT: "Département",
  SECTION: "Section",
  TEAM: "Équipe",
};

/** A node of the read-only organization tree. */
export type OrgTreeNode = HrOrgUnit & { children: OrgTreeNode[] };

/**
 * Arrange the flat unit list into a forest. Roots may be any kind (a small
 * tenant has departments and no business units); an orphaned child renders as
 * a root rather than disappearing. Siblings order by kind rank, then name.
 */
export function buildOrgTree(units: HrOrgUnit[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>(units.map((u) => [u.id, { ...u, children: [] }]));
  const roots: OrgTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const kindRank = (k: string) => UNIT_KINDS.indexOf(k as UnitKind);
  const sortRec = (nodes: OrgTreeNode[]) => {
    nodes.sort((a, b) => kindRank(a.unit_kind) - kindRank(b.unit_kind) || a.name.localeCompare(b.name, "fr"));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
