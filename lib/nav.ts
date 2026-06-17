import type { ComponentType, SVGProps } from "react";
import { t } from "./i18n";
import {
  IconTower,
  IconUsers,
  IconContainer,
  IconStamp,
  IconTruck,
  IconFinance,
  IconBell,
  IconDocument,
  IconBuilding,
} from "./icons";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Optional permission code required to SEE this item (cosmetic filtering only;
   * server/RLS remain authoritative). Items without it are always shown.
   */
  permission?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    title: t.nav.section_pilotage,
    items: [
      { label: t.nav.controlTower, href: "/dashboard", icon: IconTower },
    ],
  },
  {
    // Phase 2.0 — department workspaces are the primary workflow entry point
    // (filtered views over the same records; direct module routes are preserved).
    title: t.nav.section_departements,
    items: [
      { label: t.nav.dept_documentation, href: "/departments/documentation", icon: IconDocument, permission: "document:read" },
      { label: t.nav.dept_customs, href: "/departments/customs", icon: IconStamp, permission: "customs:read" },
      { label: t.nav.dept_transport, href: "/departments/transport", icon: IconTruck, permission: "transport:read" },
      { label: t.nav.dept_finance, href: "/departments/finance", icon: IconFinance, permission: "finance:read" },
      { label: t.nav.dept_management, href: "/departments/management", icon: IconBuilding, permission: "analytics:read" },
    ],
  },
  {
    title: t.nav.section_operations,
    items: [
      { label: t.nav.files, href: "/files", icon: IconContainer, permission: "file:read" },
      { label: t.nav.clients, href: "/clients", icon: IconUsers, permission: "client:read" },
      { label: t.nav.communications, href: "/communications", icon: IconBell, permission: "communication:read" },
    ],
  },
  {
    title: t.nav.section_administration,
    items: [
      { label: t.nav.users, href: "/users", icon: IconUsers, permission: "admin:users:manage" },
      { label: t.nav.audit, href: "/settings/audit", icon: IconStamp, permission: "audit:read:all" },
    ],
  },
];

// Flat list (used by topbar breadcrumb / page metadata lookups)
export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);
