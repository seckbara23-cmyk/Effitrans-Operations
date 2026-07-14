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
import { primaryRoleLabel } from "./roles";
import { resolveLandingRoute, LANDING_MY_WORK } from "./landing";
import type {
  Navigation,
  NavigationContext,
  NavigationItem,
  NavigationSection,
  NavIconKey,
} from "./types";

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

  // ===========================================================================
  // THE FIVE SECTIONS (Phase 5.0E-3). The order is fixed and part of the contract:
  //
  //   PILOTAGE · DOSSIERS · DÉPARTEMENTS · MANAGEMENT · ADMINISTRATION
  //
  // The sidebar shows APPLICATIONS AND WORKSPACES. It does not show job titles.
  //
  // 5.0E-1 put the fifteen department queues and the five role panels in the sidebar.
  // That was honest — each was role-gated, so nobody saw a colleague's queue — but an
  // OPS_SUPERVISOR opened the app to twenty-odd links, and it conflated two different
  // things: an APPLICATION you navigate to ("Douane"), and WORK that is waiting on you
  // ("Déclarant : 3 dossiers"). The second is not navigation. It is a to-do list, and
  // it belongs in Mon Travail — see workspacesFor() below.
  // ===========================================================================

  // --- PILOTAGE --------------------------------------------------------------
  sections.push(
    section(
      "pilotage",
      "Pilotage",
      grant(perms, [
        // The control tower. NOT for everyone: a Déclarant holds no analytics:read and
        // would open an empty page — which is how a user decides a product is broken.
        has("COORDINATOR", ...OVERSIGHT) || perms.includes("analytics:read")
          ? {
              key: "operations-center",
              label: "Centre d'Opérations",
              href: "/dashboard",
              iconKey: "tower" as NavIconKey,
              hint: "Qui détient le dossier, et qu'attend-il ?",
            }
          : null,
        {
          key: "my-work",
          label: "Mon Travail",
          href: LANDING_MY_WORK,
          iconKey: "container",
          permission: "process:read",
          hint: "Vos dossiers, réceptions, validations et corrections",
        },
        {
          key: "file-journeys",
          label: "Parcours des dossiers",
          href: "/journeys",
          iconKey: "report",
          permission: "process:read",
          hint: "Où en est chaque dossier dans le processus officiel",
        },
      ]),
    ),
  );

  // --- DOSSIERS --------------------------------------------------------------
  sections.push(
    section(
      "files",
      "Dossiers",
      grant(perms, [
        { key: "files", label: "Dossiers", href: "/files", iconKey: "container", permission: "file:read" },
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

  // --- DÉPARTEMENTS ----------------------------------------------------------
  // Business domains, never job titles: "Douane", not "Dédouanement" and not
  // "Déclarant". Each is gated on its own domain permission, so a Déclarant sees
  // Douane and nothing else.
  sections.push(
    section(
      "departments",
      "Départements",
      grant(perms, [
        {
          key: "documentation",
          label: "Documentation",
          href: "/departments/documentation",
          iconKey: "document",
          permission: "document:read",
        },
        {
          key: "customs",
          label: "Douane",
          href: "/departments/customs",
          iconKey: "stamp",
          permission: "customs:read",
        },
        {
          key: "transport",
          label: "Transport",
          href: "/departments/transport",
          iconKey: "truck",
          permission: "transport:read",
        },
        {
          key: "finance",
          label: "Finance",
          href: "/departments/finance",
          iconKey: "finance",
          permission: "finance:read",
        },
      ]),
    ),
  );

  // --- MANAGEMENT ------------------------------------------------------------
  // "Direction" is the management DEPARTMENT workspace; "Tableau exécutif" is the
  // executive KPI view. Before 5.0E-3 the sidebar called /dashboard/executive
  // "Direction" AND listed /departments/management as "Management" — two names for one
  // idea, while the actual Direction workspace was reachable under neither.
  sections.push(
    section(
      "management",
      "Management",
      grant(perms, [
        {
          key: "direction",
          label: "Direction",
          href: "/departments/management",
          iconKey: "building",
          permission: "analytics:read",
          hint: "Pilotage des opérations et de la performance",
        },
        { key: "reports", label: "Rapports", href: "/reports", iconKey: "report", permission: "analytics:read" },
        {
          key: "executive",
          label: "Tableau exécutif",
          href: "/dashboard/executive",
          iconKey: "tower",
          permission: "analytics:read",
          hint: "Indicateurs de direction",
        },
      ]),
    ),
  );

  // --- ADMINISTRATION --------------------------------------------------------
  // Tenant administration only. /platform is a separate identity stack and is
  // deliberately absent — a tenant SYSTEM_ADMIN must never be offered it.
  // AI settings live UNDER Paramètres rather than as a fourth top-level item.
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
          key: "settings",
          label: "Paramètres",
          href: "/settings",
          iconKey: "building",
          permission: "admin:config:manage",
          hint: "Assistant IA, console pilote, configuration",
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

// ===========================================================================
// WORKSPACES — what used to clutter the permanent sidebar.
//
// These are not navigation; they are the user's own work. They are surfaced inside
// Mon Travail (and remain reachable by their own guarded routes), so a Déclarant is
// one click from their queue without every other operator carrying a link to it.
// ===========================================================================

export type WorkspaceLink = {
  key: string;
  label: string;
  href: string;
  hint: string;
  /** A role PANEL (portfolio, aging balance…) or one of the 15 official queues. */
  kind: "panel" | "queue";
};

/**
 * The workspaces THIS user may open. Pure — the same authorization rules the sidebar
 * used to apply, rendered somewhere better.
 */
export function workspacesFor(ctx: NavigationContext): WorkspaceLink[] {
  if (ctx.identityType !== "tenant") return [];

  const { workspaces, physicalDeposit, collections } = ctx.featureFlags;
  const perms = ctx.permissions;
  const roles = new Set(ctx.roleCodes);
  const has = (...r: string[]) => r.some((x) => roles.has(x));
  const can = (p: string) => perms.includes(p);

  if (!workspaces || !can("process:read")) return [];

  const out: WorkspaceLink[] = [];

  if (has("ACCOUNT_MANAGER", ...OVERSIGHT)) {
    out.push({
      key: "portfolio",
      label: "Portefeuille clients",
      href: "/portfolio",
      hint: "Vos comptes, leurs dossiers et ce qui les bloque",
      kind: "panel",
    });
  }
  if (has("TRANSPORT_OFFICER", "COORDINATOR", ...OVERSIGHT) && can("transport:read")) {
    out.push({
      key: "transport_readiness",
      label: "Préparation transport",
      href: "/transport-readiness",
      hint: "Véhicule, chauffeur et porte d'enlèvement",
      kind: "panel",
    });
  }
  if (has("ADMINISTRATIVE_OFFICER", ...OVERSIGHT) && physicalDeposit && can("admin_service:manage")) {
    out.push({
      key: "deposits",
      label: "Dépôts physiques",
      href: "/deposits",
      hint: "Remise des factures papier et chaîne de garde",
      kind: "panel",
    });
  }
  if (has("COLLECTIONS_OFFICER", "FINANCE_OFFICER", ...OVERSIGHT) && collections && can("collections:manage")) {
    out.push({
      key: "collections",
      label: "Balance âgée",
      href: "/collections",
      hint: "Créances, relances, promesses et litiges",
      kind: "panel",
    });
  }

  // The official queues this user's roles actually staff. Never all fifteen.
  for (const q of visibleQueues(ctx.roleCodes, perms)) {
    out.push({
      key: `queue_${q.key}`,
      label: q.labelFr,
      href: `/queues/${q.key}`,
      hint: q.description,
      kind: "queue",
    });
  }

  return out;
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
