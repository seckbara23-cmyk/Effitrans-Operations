/**
 * Platform navigation (Phase 4.0B-4). PURE descriptor — no I/O.
 * ---------------------------------------------------------------------------
 * The platform shell's nav. Kept entirely separate from the tenant nav
 * (lib/nav.ts): tenant users never see these items, and platform users never see
 * tenant items. Items are cosmetically filtered by platform permission; the
 * routes re-check on the server.
 */
import type { PlatformPermission } from "./roles";

export type PlatformNavItem = {
  label: string;
  href: string;
  permission?: PlatformPermission;
};

export const PLATFORM_SECTION_TITLE = "Plateforme";

export const platformNav: readonly PlatformNavItem[] = [
  { label: "Tableau de bord", href: "/platform" },
  { label: "Entreprises", href: "/platform/companies", permission: "platform:companies:read" },
  { label: "Plans", href: "/platform/plans", permission: "platform:plans:read" },
  { label: "Déploiement processus", href: "/platform/rollout", permission: "platform:rollout:manage" },
  { label: "Santé système", href: "/platform/health", permission: "platform:companies:read" },
  { label: "Journal plateforme", href: "/platform/audit", permission: "platform:audit:read" },
  { label: "Paramètres", href: "/platform/settings", permission: "platform:settings:manage" },
];

export function visiblePlatformNav(permissions: readonly string[]): PlatformNavItem[] {
  return platformNav.filter((i) => !i.permission || permissions.includes(i.permission));
}
