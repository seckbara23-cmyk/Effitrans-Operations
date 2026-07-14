/**
 * THE navigation builder (Phase 5.0E-1, Deliverable 12). PURE.
 * ---------------------------------------------------------------------------
 * ONE function decides what a user sees in the sidebar. Before 5.0E-1 that
 * decision was spread across three places — the static `navSections`, the
 * role-aware `buildProcessNav`, and `canSeeNav` inside the client sidebar — and
 * they had already drifted (the `collections` queue and the /collections panel
 * both rendered as "Recouvrement", indistinguishably).
 *
 * Two rules hold this together:
 *
 *  1. FILTERING HAPPENS HERE, ON THE SERVER. The client renders exactly what it is
 *     handed and makes no visibility decision of its own. Permissions are still
 *     re-checked by every route — this filter is what the user SEES, never what
 *     they may DO.
 *
 *  2. WITH THE WORKSPACES FLAG OFF, THE OUTPUT IS TODAY'S NAVIGATION, unchanged.
 *     5.0E-1 must not become the phase that lit up the process engine by accident.
 *
 * Queue labels and keys are never re-declared here; they come from the canonical
 * queue registry (Deliverable 6), which derives them from the 26-step registry.
 */
import { LEGACY_SECTIONS } from "@/lib/nav";
import { visibleQueues } from "@/lib/process/queues/registry";
import type { ProcessDepartment } from "@/lib/process/types";
import { primaryRoleLabel } from "./roles";
import { resolveLandingRoute, LANDING_MY_WORK } from "./landing";
import type {
  Navigation,
  NavigationContext,
  NavigationItem,
  NavigationSection,
  NavIconKey,
} from "./types";

const QUEUE_ICON: Record<ProcessDepartment, NavIconKey> = {
  cotation: "report",
  operations: "container",
  account_management: "users",
  coordination: "tower",
  transit: "stamp",
  customs_declaration: "stamp",
  finance_customs: "finance",
  customs_field: "stamp",
  transport: "truck",
  pickup: "truck",
  billing: "finance",
  finance: "finance",
  administration: "building",
  courier: "truck",
  collections: "finance",
};

const OVERSIGHT = ["OPS_SUPERVISOR", "SYSTEM_ADMIN"];

/** Drop items the user cannot see. A permission-less item is always visible. */
function grant(permissions: string[], items: (NavigationItem | null)[]): NavigationItem[] {
  return items.filter(
    (i): i is NavigationItem => i !== null && (!i.permission || permissions.includes(i.permission)),
  );
}

function section(key: string, label: string, items: NavigationItem[]): NavigationSection | null {
  return items.length > 0 ? { key, label, items } : null;
}

/**
 * Build the whole sidebar for one user. Deterministic: same context in, same
 * sections out. No I/O, no clock, no env — the caller resolves all of that.
 */
export function buildNavigation(ctx: NavigationContext): Navigation {
  const label = primaryRoleLabel(ctx.roleCodes);

  // Platform, driver, courier-app and portal identities render their own shells.
  // The staff sidebar is never built for them — in particular, a tenant admin is
  // NEVER offered /platform, and a staff user is never linked into /portal.
  if (ctx.identityType !== "tenant") {
    return { sections: [], primaryRoleLabel: label, myWorkHref: null, filtered: true };
  }

  const { workspaces, physicalDeposit, collections } = ctx.featureFlags;
  const perms = ctx.permissions;
  const roles = new Set(ctx.roleCodes);
  const has = (...r: string[]) => r.some((x) => roles.has(x));
  const process = workspaces && perms.includes("process:read");

  // ---------------------------------------------------------------------------
  // Flag off => today's navigation, byte for byte. Same sections, same order,
  // same permission gates; only the filtering moved from the client to here.
  // ---------------------------------------------------------------------------
  if (!process) {
    const legacy = LEGACY_SECTIONS.map((s) =>
      section(s.key, s.label, grant(perms, s.items)),
    ).filter((s): s is NavigationSection => s !== null);
    return { sections: legacy, primaryRoleLabel: label, myWorkHref: null, filtered: true };
  }

  const sections: (NavigationSection | null)[] = [];

  // --- MON TRAVAIL -----------------------------------------------------------
  // First, always. The one question every operator opens the app to answer:
  // "what is waiting on me?"
  sections.push(
    section(
      "my_work",
      "Mon travail",
      grant(perms, [
        {
          key: "my_work",
          label: "Mon travail",
          href: LANDING_MY_WORK,
          iconKey: "tower",
          permission: "process:read",
          hint: "Vos dossiers, réceptions, validations et corrections",
        },
        roles.has("COURIER") && physicalDeposit
          ? {
              key: "courier_runs",
              label: "Mes dépôts",
              href: "/courier",
              iconKey: "truck",
              permission: "courier:deposit",
              hint: "Vos courses de dépôt de facture",
            }
          : null,
      ]),
    ),
  );

  // --- PILOTAGE --------------------------------------------------------------
  // The Coordinator's control tower is the EXISTING /dashboard, which already
  // carries the process section from 5.0C. We link into it; we do not build a
  // second tower (Deliverable 4).
  sections.push(
    section(
      "pilotage",
      "Pilotage",
      grant(perms, [
        {
          key: "control_tower",
          label: has("COORDINATOR", ...OVERSIGHT) ? "Tour de contrôle" : "Vue d'ensemble",
          href: "/dashboard",
          iconKey: "tower",
          hint: "Qui détient le dossier, et qu'attend-il ?",
        },
        {
          key: "executive",
          label: "Direction",
          href: "/dashboard/executive",
          iconKey: "building",
          permission: "analytics:read",
        },
        {
          key: "reports",
          label: "Rapports",
          href: "/reports",
          iconKey: "report",
          permission: "analytics:read",
        },
      ]),
    ),
  );

  // --- RELATION CLIENT -------------------------------------------------------
  sections.push(
    section(
      "relation_client",
      "Relation client",
      grant(perms, [
        has("ACCOUNT_MANAGER", ...OVERSIGHT)
          ? {
              key: "portfolio",
              label: "Portefeuille clients",
              href: "/portfolio",
              iconKey: "users",
              permission: "process:read",
              hint: "Vos comptes, leurs dossiers en cours et ce qui les bloque",
            }
          : null,
        { key: "clients", label: "Clients", href: "/clients", iconKey: "users", permission: "client:read" },
        {
          key: "communications",
          label: "Communications",
          href: "/communications",
          iconKey: "bell",
          permission: "communication:read",
        },
      ]),
    ),
  );

  // --- OPÉRATIONS ------------------------------------------------------------
  // Department modules stay reachable (Deliverable 9) — they are simply no longer
  // the front door. They are filtered views over the same records.
  sections.push(
    section(
      "operations",
      "Opérations",
      grant(perms, [
        { key: "files", label: "Dossiers", href: "/files", iconKey: "container", permission: "file:read" },
        {
          key: "dept_documentation",
          label: "Documentation",
          href: "/departments/documentation",
          iconKey: "document",
          permission: "document:read",
        },
        {
          key: "dept_customs",
          label: "Douane",
          href: "/departments/customs",
          iconKey: "stamp",
          permission: "customs:read",
        },
        {
          key: "dept_transport",
          label: "Transport",
          href: "/departments/transport",
          iconKey: "truck",
          permission: "transport:read",
        },
        {
          key: "dept_finance",
          label: "Finance",
          href: "/departments/finance",
          iconKey: "finance",
          permission: "finance:read",
        },
        {
          key: "dept_management",
          label: "Management",
          href: "/departments/management",
          iconKey: "building",
          permission: "analytics:read",
        },
      ]),
    ),
  );

  // --- RÔLES OPÉRATIONNELS ---------------------------------------------------
  // The 15 official queues, plus the panels that belong to a role rather than to a
  // step. A user sees only the queues their role staffs — never all fifteen
  // (visibleQueues enforces role AND permission).
  const queueItems: NavigationItem[] = visibleQueues(ctx.roleCodes, perms).map((q) => ({
    key: `queue_${q.key}`,
    label: q.labelFr,
    href: `/queues/${q.key}`,
    iconKey: QUEUE_ICON[q.key],
    permission: q.permission,
    hint: q.description,
  }));

  const panels = grant(perms, [
    has("TRANSPORT_OFFICER", "COORDINATOR", ...OVERSIGHT)
      ? {
          key: "transport_readiness",
          label: "Préparation transport",
          href: "/transport-readiness",
          iconKey: "truck" as NavIconKey,
          permission: "transport:read",
          hint: "Véhicule, chauffeur et porte d'enlèvement",
        }
      : null,
    has("ADMINISTRATIVE_OFFICER", ...OVERSIGHT) && physicalDeposit
      ? {
          key: "deposits",
          label: "Dépôts physiques",
          href: "/deposits",
          iconKey: "building" as NavIconKey,
          permission: "admin_service:manage",
          hint: "Remise des factures papier et chaîne de garde",
        }
      : null,
    // NOT "Recouvrement" — that label already belongs to the `collections` QUEUE
    // above, and two identical entries pointing at different pages is precisely
    // the confusion this phase is here to remove. The queue is step-26 handoff
    // work; this panel is the aging balance.
    has("COLLECTIONS_OFFICER", "FINANCE_OFFICER", ...OVERSIGHT) && collections
      ? {
          key: "collections_panel",
          label: "Balance âgée",
          href: "/collections",
          iconKey: "finance" as NavIconKey,
          permission: "collections:manage",
          hint: "Créances, relances, promesses et litiges",
        }
      : null,
  ]);

  sections.push(section("roles", "Rôles opérationnels", [...queueItems, ...panels]));

  // --- ADMINISTRATION --------------------------------------------------------
  // Tenant administration only. /platform is a different identity stack and is
  // deliberately absent — a tenant admin must never be offered it.
  sections.push(
    section(
      "administration",
      "Administration",
      grant(perms, [
        { key: "users", label: "Utilisateurs", href: "/users", iconKey: "users", permission: "admin:users:manage" },
        {
          key: "audit",
          label: "Journal d'audit",
          href: "/settings/audit",
          iconKey: "stamp",
          permission: "audit:read:all",
        },
        {
          key: "ai",
          label: "Assistant IA",
          href: "/settings/ai",
          iconKey: "tower",
          permission: "admin:config:manage",
        },
      ]),
    ),
  );

  return {
    sections: sections.filter((s): s is NavigationSection => s !== null),
    primaryRoleLabel: label,
    myWorkHref: LANDING_MY_WORK,
    filtered: true,
  };
}

/**
 * The flag-off sidebar, resolved WITHOUT a session.
 *
 * This exists so the root layout can short-circuit on the feature flag before it
 * touches auth — which is what keeps a flag-off deployment doing zero auth work in
 * the layout, and keeps /login and /_not-found statically prerenderable. The client
 * applies the same cosmetic permission filter it has applied since Phase 2.0.
 */
export function legacyNavigation(): Navigation {
  return {
    sections: LEGACY_SECTIONS,
    primaryRoleLabel: null,
    myWorkHref: null,
    filtered: false,
  };
}

export { resolveLandingRoute } from "./landing";
