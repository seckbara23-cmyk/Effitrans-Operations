/**
 * Role-aware process navigation (Phase 5.0C, Deliverable 14). PURE.
 * ---------------------------------------------------------------------------
 * The nav a user actually gets. Two rules:
 *   * a queue link appears ONLY if the user's roles staff that queue — an empty,
 *     unauthorized department is never shown,
 *   * nothing appears at all unless the workspaces flag is on, so with the flags
 *     off the sidebar is byte-for-byte what it was before Phase 5.0C.
 *
 * Icons are passed as string KEYS, not components: the nav is computed on the
 * server (which knows the flag and the user's roles) and rendered by a client
 * component, and a React component cannot cross that boundary.
 */
import { visibleQueues } from "./registry";

export type ProcessNavItem = {
  label: string;
  href: string;
  iconKey: "tower" | "stamp" | "truck" | "finance" | "document" | "building" | "users";
  /** Cosmetic only — the route re-checks server-side. */
  permission: string;
};

export type ProcessNavSection = {
  title: string;
  items: ProcessNavItem[];
};

const QUEUE_ICON: Record<string, ProcessNavItem["iconKey"]> = {
  cotation: "document",
  operations: "building",
  account_management: "users",
  coordination: "tower",
  transit: "stamp",
  customs_declaration: "stamp",
  finance_customs: "stamp",
  customs_field: "stamp",
  transport: "truck",
  pickup: "truck",
  billing: "finance",
  finance: "finance",
  administration: "building",
  courier: "truck",
  collections: "finance",
};

/**
 * Build the process nav for one user.
 *
 * `workspacesEnabled` is the Phase 5.0C UI flag. When false this returns [] and
 * the sidebar renders exactly the sections it always did.
 */
export function buildProcessNav(
  roleCodes: string[],
  permissions: string[],
  workspacesEnabled: boolean,
): ProcessNavSection[] {
  if (!workspacesEnabled) return [];
  if (!permissions.includes("process:read")) return [];

  const queues = visibleQueues(roleCodes, permissions);

  const roles = new Set(roleCodes);

  // Phase 5.0D-5 — the specialized panels. Role-aware: an Account Manager gets the
  // portfolio, Transport gets readiness, Collections gets recovery. Nobody sees a
  // panel their role does not staff.
  const panels: ProcessNavItem[] = [
    { label: "Mon travail", href: "/my-work", iconKey: "tower", permission: "process:read" },
  ];
  if (["ACCOUNT_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"].some((r) => roles.has(r))) {
    panels.push({ label: "Portefeuille clients", href: "/portfolio", iconKey: "users", permission: "process:read" });
  }
  if (["TRANSPORT_OFFICER", "COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"].some((r) => roles.has(r))) {
    panels.push({ label: "Préparation transport", href: "/transport-readiness", iconKey: "truck", permission: "transport:read" });
  }
  if (["COLLECTIONS_OFFICER", "FINANCE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"].some((r) => roles.has(r))) {
    panels.push({ label: "Recouvrement", href: "/collections", iconKey: "finance", permission: "collections:manage" });
  }
  if (["ADMINISTRATIVE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"].some((r) => roles.has(r))) {
    panels.push({ label: "Dépôts physiques", href: "/deposits", iconKey: "building", permission: "admin_service:manage" });
  }
  if (roles.has("COURIER")) {
    panels.push({ label: "Mes dépôts", href: "/courier", iconKey: "truck", permission: "courier:deposit" });
  }

  const sections: ProcessNavSection[] = [{ title: "Processus officiel", items: panels }];

  if (queues.length > 0) {
    sections.push({
      title: "Files d'attente",
      items: queues.map((q) => ({
        label: q.labelFr,
        href: `/queues/${q.key}`,
        iconKey: QUEUE_ICON[q.key] ?? "document",
        permission: q.permission,
      })),
    });
  }

  return sections;
}
