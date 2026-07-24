/**
 * THE BASE NAVIGATION — the five agreed sections. PURE DATA.
 * ---------------------------------------------------------------------------
 * PILOTAGE · DOSSIERS · DÉPARTEMENTS · MANAGEMENT · ADMINISTRATION
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT WAS WRONG UNTIL 5.0E-3B
 * -------------------------------------------------------------
 * These sections used to be the *legacy* sidebar — the pre-process-engine navigation,
 * rendered only when the workspaces flag was OFF. The agreed five-section structure
 * lived exclusively in the flag-ON branch of the navigation builder.
 *
 * That was a mistake, and production showed it: with the flag off (which is every
 * tenant today), the deployed app still displayed "Dédouanement", stranded "Direction"
 * under DÉPARTEMENTS, and titled a section "OPÉRATIONS". The agreed structure never
 * appeared anywhere.
 *
 * The error was conceptual. INFORMATION ARCHITECTURE IS NOT A FEATURE OF THE PROCESS
 * ENGINE. Dossiers, Clients, Communications, the four departments, Direction, Rapports,
 * the executive board, Utilisateurs, the audit log and Paramètres all exist today and
 * all work with the engine dark. Only two entries genuinely depend on it — "Mon Travail"
 * and "Parcours des dossiers" — and those are added by the builder when the flag is on.
 *
 * So this is the BASE. It is what every tenant sees, flag or no flag. The engine adds
 * to it; it does not replace it.
 *
 * WHY THE LABELS ARE LITERAL AND NOT t.nav.*
 * ------------------------------------------
 * The i18n keys carried the wrong words ("Dédouanement", "Paramètres IA", a section
 * called "Opérations"). Those strings are still used elsewhere; renaming the keys under
 * them would have been a rename with a blast radius. The sidebar's labels are part of
 * the agreed contract and are asserted verbatim by tests/journeys.test.ts, so they are
 * stated here, once, where the contract is.
 *
 * NOTE ON FILTERING: this list is NOT permission-filtered. On the flag-off path the
 * root layout deliberately resolves NO session (that is what keeps /login statically
 * prerendered and costs a dark deployment zero auth work), so the client applies the
 * same cosmetic `canSeeNav` filter it has since Phase 2.0 — see Navigation.filtered.
 * Every route re-checks server-side regardless; a hidden link has never been the
 * authorization.
 */
import type { NavigationItem, NavigationSection } from "./navigation/types";

export type NavItem = NavigationItem;
export type NavSection = NavigationSection;

export const BASE_SECTIONS: NavigationSection[] = [
  {
    key: "pilotage",
    label: "Pilotage",
    items: [
      // Ungated here, deliberately. With the process engine dark, /dashboard is the
      // ONLY landing an operational user has — hiding it behind analytics:read would
      // strand them on an empty app. Once the engine is on, Mon Travail exists as the
      // better destination, and the builder DOES gate the control tower by role. You
      // may only take someone's front door away once you have given them another one.
      { key: "operations-center", label: "Centre d'opérations", href: "/dashboard", iconKey: "tower" },
      // "Mon Travail" and "Parcours des dossiers" are added by the navigation builder
      // when the process workspaces are live. They are the only two entries in the
      // whole sidebar that genuinely require the engine.
    ],
  },
  {
    key: "files",
    label: "Dossiers",
    items: [
      { key: "files", label: "Dossiers", href: "/files", iconKey: "container", permission: "file:read" },
      { key: "clients", label: "Clients", href: "/clients", iconKey: "users", permission: "client:read" },
      {
        key: "communications",
        label: "Communications",
        href: "/communications",
        iconKey: "bell",
        permission: "communication:read",
      },
      // "Messagerie" (Phase 8.7) is NOT listed here — unlike everything else in this
      // BASE list, it is gated behind the tenant messaging rollout flag (a disabled
      // tenant must see NO trace of an incomplete feature), so it is injected
      // conditionally by lib/navigation/build.ts, exactly like "Mon Travail" is for
      // the process-workspaces flag.
    ],
  },
  {
    key: "departments",
    label: "Départements",
    // The sidebar Départements now mirror the CANONICAL operational departments
    // (lib/organization/departments.ts): Opérations, Transit, Finance. HR is a
    // support department and stays out of the operational sidebar.
    //
    // Documentation (an Operations capability) and Douane + Transport (Transit
    // execution) are no longer top-level entries — they are WORKSPACES reached
    // from their department hub page. Their ROUTES are unchanged
    // (/departments/documentation, /departments/customs, /departments/transport),
    // so no URL breaks and no redirect is needed; only the sidebar entry-points move.
    items: [
      {
        key: "operations",
        label: "Opérations",
        href: "/departments/operations",
        iconKey: "container",
        // Owns dossiers, clients and documentation — visible to any of their readers.
        permissionsAnyOf: ["file:read", "client:read", "document:read"],
      },
      {
        key: "transit",
        label: "Transit",
        href: "/departments/transit",
        iconKey: "truck",
        // Owns customs + transport execution — either reader sees the hub. "Transit"
        // is a business function, never a job title; "Douane"/"Transport" live inside.
        permissionsAnyOf: ["customs:read", "transport:read"],
      },
      { key: "finance", label: "Finance", href: "/departments/finance", iconKey: "finance", permission: "finance:read" },
    ],
  },
  {
    key: "management",
    label: "Management",
    items: [
      // Direction was previously listed as a fifth "department", which is what it is in
      // the URL but not what it is to the business. It is management oversight.
      {
        key: "direction",
        label: "Direction",
        href: "/departments/management",
        iconKey: "building",
        permission: "analytics:read",
      },
      // Phase HR-1 — HR is a corporate SUPPORT/management function, not an
      // operational department, so its workspace lives under MANAGEMENT (never
      // in DÉPARTEMENTS). Gated on hr:read; the /departments/hr route re-checks.
      {
        key: "hr",
        label: "Ressources humaines",
        href: "/departments/hr",
        iconKey: "users",
        permission: "hr:read",
      },
      { key: "reports", label: "Rapports", href: "/reports", iconKey: "report", permission: "analytics:read" },
      {
        key: "executive",
        label: "Tableau exécutif",
        href: "/dashboard/executive",
        iconKey: "tower",
        // Phase 7.7 — narrowed from analytics:read: the executive command center is for the
        // executive/management tier, while analytics:read remains the wider reporting audience
        // (Direction, Rapports). Filtering is cosmetic; the page re-checks server-side.
        permission: "executive:dashboard:read",
      },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    items: [
      { key: "users", label: "Utilisateurs", href: "/users", iconKey: "users", permission: "admin:users:manage" },
      // DBC-1 — Digital Brand Center (tenant module). Gated by admin:config:manage.
      { key: "brand-center", label: "Centre de marque", href: "/brand-center", iconKey: "building", permission: "admin:config:manage" },
      { key: "audit", label: "Journal d'audit", href: "/settings/audit", iconKey: "stamp", permission: "audit:read:all" },
      // Paramètres is the hub. The AI settings live UNDER it (/settings/ai) rather than
      // as a fourth top-level entry called "Paramètres IA", which described the one
      // settings page that happened to exist first.
      {
        key: "settings",
        label: "Paramètres",
        href: "/settings",
        iconKey: "building",
        permission: "admin:config:manage",
      },
    ],
  },
];

/** Back-compat alias. Same data — this is no longer a "legacy" list, it is the base. */
export const LEGACY_SECTIONS = BASE_SECTIONS;
export const navSections = BASE_SECTIONS;

/** Flat list (used by the topbar breadcrumb / page metadata lookups). */
export const allNavItems: NavItem[] = BASE_SECTIONS.flatMap((s) => s.items);

/**
 * Top-bar primary action — "Nouveau dossier". Points at the existing dossier
 * creation route and is cosmetically gated by file:create (canSeeNav); the
 * /files/new route re-checks the permission server-side.
 */
export const newDossierAction = {
  href: "/files/new",
  permission: "file:create",
} as const;
