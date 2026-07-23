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
import { BASE_SECTIONS } from "@/lib/nav";
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

/**
 * Drop items the user cannot see. A permission-less item is always visible; an
 * item with `permissionsAnyOf` is visible when the user holds ANY of them
 * (aggregated hubs like Transit over customs+transport); otherwise `permission`.
 */
function grant(permissions: string[], items: (NavigationItem | null)[]): NavigationItem[] {
  return items.filter((i): i is NavigationItem => {
    if (i === null) return false;
    if (i.permissionsAnyOf) return i.permissionsAnyOf.some((p) => permissions.includes(p));
    return !i.permission || permissions.includes(i.permission);
  });
}

function section(key: string, label: string, items: NavigationItem[]): NavigationSection | null {
  return items.length > 0 ? { key, label, items } : null;
}

/**
 * "Messagerie" (Phase 8.7) is injected into the files section's item list, never
 * baked into BASE_SECTIONS — gated behind the TENANT rollout flag (not the process
 * engine, which it has no dependency on), so a tenant with messaging disabled sees
 * no trace of it, exactly like a disabled process-workspaces tenant sees no
 * "Mon Travail".
 */
function withMessagingItem(base: NavigationSection, ctx: NavigationContext): NavigationItem[] {
  if (base.key !== "files" || !ctx.messagingEnabled) return base.items;
  return [
    ...base.items,
    { key: "messages", label: "Messagerie", href: "/messages", iconKey: "message", permission: "messaging:read" },
  ];
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
    const base = BASE_SECTIONS.map((s) =>
      section(s.key, s.label, grant(perms, withMessagingItem(s, ctx))),
    ).filter((s): s is NavigationSection => s !== null);
    return { sections: base, primaryRoleLabel: label, myWorkHref: null, filtered: true };
  }

  // ===========================================================================
  // THE FIVE SECTIONS (Phase 5.0E-3). Order fixed, and part of the contract:
  //
  //   PILOTAGE · DOSSIERS · DÉPARTEMENTS · MANAGEMENT · ADMINISTRATION
  //
  // DERIVED FROM BASE_SECTIONS, never redeclared. Until 5.0E-3B this branch spelled the
  // five sections out again, in parallel with lib/nav.ts — and they promptly drifted:
  // production (flag off) rendered the OLD labels, "Dédouanement" and all, while the
  // agreed structure existed only in this branch, which nobody had switched on yet.
  //
  // The engine ADDS to the base. It does not replace it. Exactly two entries in the
  // whole sidebar depend on the process engine — Mon Travail, and Parcours des dossiers.
  //
  // The sidebar shows APPLICATIONS AND WORKSPACES. It does not show job titles. 5.0E-1
  // put the fifteen department queues and the five role panels here; that was honest —
  // each was role-gated, so nobody saw a colleague's queue — but an OPS_SUPERVISOR
  // opened the app to twenty-odd links, and it conflated an APPLICATION you navigate to
  // ("Douane") with WORK waiting on you ("Déclarant : 3 dossiers"). The second is not
  // navigation. It is a to-do list. See workspacesFor().
  // ===========================================================================

  const sections: (NavigationSection | null)[] = BASE_SECTIONS.map((base) => {
    if (base.key !== "pilotage") {
      return section(base.key, base.label, grant(perms, withMessagingItem(base, ctx)));
    }

    // PILOTAGE is the only section the engine changes.
    //
    // ORDER, when the workspaces are live:
    //
    //   1. ⭐ Mon Travail          <- FIRST. Always.
    //   2.    Centre d'opérations
    //   3.    Parcours des dossiers
    //
    // Mon Travail goes first because the first item in the first section is the one
    // people click without reading, and for almost everyone in the building the right
    // answer to "what now" is their own queue — not a dashboard of everyone else's.
    // Leaving the control tower on top made the app open on a view most staff have no
    // permission to populate and no reason to read.
    //
    // The control tower STAYS — it is the supervisory entry point, and for a Coordinator
    // it is still the landing page. It is simply not the default thing to click.
    const controlTower = base.items.find((i) => i.key === "operations-center")!;

    const items: (NavigationItem | null)[] = [
      {
        key: "my-work",
        label: "Mon Travail",
        href: LANDING_MY_WORK,
        // The ONLY starred item in the sidebar. A star on everything marks nothing.
        iconKey: "star",
        permission: "process:read",
        hint: "Vos dossiers, réceptions, validations et corrections",
      },
      // The control tower, gated. A Déclarant holds no analytics:read and would open an
      // empty page — which is how a user decides a product is broken. We can hide it
      // safely ONLY here, in the flag-on branch, because Mon Travail now exists as the
      // better destination for them. (With the engine dark it stays visible to everyone;
      // see BASE_SECTIONS. You may only take away someone's front door once you have
      // given them another one.)
      has("COORDINATOR", ...OVERSIGHT) || perms.includes("analytics:read") ? controlTower : null,
      {
        key: "file-journeys",
        label: "Parcours des dossiers",
        href: "/journeys",
        iconKey: "report",
        permission: "process:read",
        hint: "Où en est chaque dossier dans le processus officiel",
      },
    ];

    return section(base.key, base.label, grant(perms, items));
  });

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

  // Phase 9.3A — Caisse & Trésorerie. Gated on the EFFECTIVE caisse:manage
  // permission (never on role === "CASHIER"), so any authorized user sees it and
  // a finance:read-only user does not. No feature flag: Caisse is a Finance
  // workspace, not a process-engine sub-feature. The label is the WORKSPACE name
  // ("Caisse"), never the employee title.
  if (can("caisse:manage")) {
    out.push({
      key: "caisse",
      label: "Caisse",
      href: "/finance/caisse",
      hint: "Opérations de caisse et de trésorerie — espèces, chèques, Mobile Money, banques",
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
    sections: BASE_SECTIONS,
    primaryRoleLabel: null,
    myWorkHref: null,
    filtered: false,
  };
}

export { resolveLandingRoute } from "./landing";
