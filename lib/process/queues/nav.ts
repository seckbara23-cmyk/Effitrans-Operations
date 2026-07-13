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

  const sections: ProcessNavSection[] = [
    {
      title: "Processus officiel",
      items: [{ label: "Mon travail", href: "/my-work", iconKey: "tower", permission: "process:read" }],
    },
  ];

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
