import type { ComponentType, SVGProps } from "react";
import { t } from "./i18n";
import {
  IconTower,
  IconUsers,
  IconContainer,
  IconStamp,
  IconDocument,
  IconTask,
  IconFinance,
  IconReport,
  IconGear,
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
    title: t.nav.section_operations,
    items: [
      { label: t.nav.clients, href: "/clients", icon: IconUsers, permission: "client:read" },
      { label: t.nav.files, href: "/files", icon: IconContainer, permission: "file:read" },
      { label: t.nav.customers, href: "/customers", icon: IconUsers },
      { label: t.nav.shipments, href: "/shipments", icon: IconContainer },
      { label: t.nav.customs, href: "/customs", icon: IconStamp },
      { label: t.nav.documents, href: "/documents", icon: IconDocument },
      { label: t.nav.tasks, href: "/tasks", icon: IconTask },
    ],
  },
  {
    title: t.nav.section_administration,
    items: [
      { label: t.nav.finance, href: "/finance", icon: IconFinance },
      { label: t.nav.reports, href: "/reports", icon: IconReport },
      { label: t.nav.users, href: "/users", icon: IconUsers, permission: "admin:users:manage" },
      { label: t.nav.audit, href: "/settings/audit", icon: IconStamp, permission: "audit:read:all" },
      { label: t.nav.settings, href: "/settings", icon: IconGear, permission: "admin:config:manage" },
    ],
  },
];

// Flat list (used by topbar breadcrumb / page metadata lookups)
export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);
