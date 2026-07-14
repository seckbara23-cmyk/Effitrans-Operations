/**
 * Legacy (pre-process-engine) navigation — PURE DATA.
 * ---------------------------------------------------------------------------
 * Phase 5.0E-1: this file used to carry React icon COMPONENTS, which is why the
 * client sidebar had to own the visibility filtering. It is now plain data with
 * icon KEYS, so it can cross the server→client boundary and be consumed by the
 * single navigation builder (lib/navigation/build.ts).
 *
 * These sections are what a user sees when the process workspaces flag is OFF —
 * i.e. today's production navigation. Content, order and permission gates are
 * unchanged from Phase 2.0.
 */
import { t } from "./i18n";
import type { NavigationItem, NavigationSection } from "./navigation/types";

export type NavItem = NavigationItem;
export type NavSection = NavigationSection;

export const LEGACY_SECTIONS: NavigationSection[] = [
  {
    key: "pilotage",
    label: t.nav.section_pilotage,
    items: [
      { key: "control_tower", label: t.nav.controlTower, href: "/dashboard", iconKey: "tower" },
    ],
  },
  {
    // Phase 2.0 — department workspaces are the primary workflow entry point
    // (filtered views over the same records; direct module routes are preserved).
    key: "departements",
    label: t.nav.section_departements,
    items: [
      { key: "dept_documentation", label: t.nav.dept_documentation, href: "/departments/documentation", iconKey: "document", permission: "document:read" },
      { key: "dept_customs", label: t.nav.dept_customs, href: "/departments/customs", iconKey: "stamp", permission: "customs:read" },
      { key: "dept_transport", label: t.nav.dept_transport, href: "/departments/transport", iconKey: "truck", permission: "transport:read" },
      { key: "dept_finance", label: t.nav.dept_finance, href: "/departments/finance", iconKey: "finance", permission: "finance:read" },
      { key: "dept_management", label: t.nav.dept_management, href: "/departments/management", iconKey: "building", permission: "analytics:read" },
    ],
  },
  {
    key: "operations",
    label: t.nav.section_operations,
    items: [
      { key: "files", label: t.nav.files, href: "/files", iconKey: "container", permission: "file:read" },
      { key: "clients", label: t.nav.clients, href: "/clients", iconKey: "users", permission: "client:read" },
      { key: "communications", label: t.nav.communications, href: "/communications", iconKey: "bell", permission: "communication:read" },
    ],
  },
  {
    key: "administration",
    label: t.nav.section_administration,
    items: [
      { key: "executive", label: t.nav.executive, href: "/dashboard/executive", iconKey: "building", permission: "analytics:read" },
      { key: "reports", label: t.nav.reports, href: "/reports", iconKey: "report", permission: "analytics:read" },
      { key: "users", label: t.nav.users, href: "/users", iconKey: "users", permission: "admin:users:manage" },
      { key: "audit", label: t.nav.audit, href: "/settings/audit", iconKey: "stamp", permission: "audit:read:all" },
      { key: "ai", label: t.nav.aiSettings, href: "/settings/ai", iconKey: "tower", permission: "admin:config:manage" },
    ],
  },
];

/** Back-compat alias — the legacy name, same data. */
export const navSections = LEGACY_SECTIONS;

/** Flat list (used by the topbar breadcrumb / page metadata lookups). */
export const allNavItems: NavItem[] = LEGACY_SECTIONS.flatMap((s) => s.items);

/**
 * Top-bar primary action — "Nouveau dossier". Points at the existing dossier
 * creation route and is cosmetically gated by file:create (canSeeNav); the
 * /files/new route re-checks the permission server-side. Kept as a pure
 * descriptor so the route + gate are unit-testable without rendering the
 * client top bar.
 */
export const newDossierAction = {
  href: "/files/new",
  permission: "file:create",
} as const;
