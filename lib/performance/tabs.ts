/**
 * Gestion de la Performance — the module's information architecture.
 *
 * The official module name is « Gestion de la Performance ». ICTD, ICAM and
 * IPAM are indicators INSIDE it, never modules and never role names.
 *
 * Every tab here exists because the platform has something legitimate to put on
 * it. ICAM and IPAM are present because management asked for them by name and
 * an absent tab reads as an oversight — but their pages state what is missing
 * rather than rendering a fabricated figure. That is the honest form of
 * "implemented", and it is deliberately different from hiding them.
 */
export type PerformanceTab = {
  key: string;
  label: string;
  href: string;
  /** Whether the tab can currently show real, computed results. */
  populated: boolean;
};

export const PERFORMANCE_TABS: readonly PerformanceTab[] = [
  { key: "overview", label: "Vue d'ensemble", href: "/performance", populated: true },
  { key: "collaborators", label: "Performance des collaborateurs", href: "/performance/collaborateurs", populated: true },
  { key: "ictd", label: "ICTD", href: "/performance/ictd", populated: true },
  { key: "icam", label: "ICAM", href: "/performance/icam", populated: false },
  { key: "ipam", label: "IPAM", href: "/performance/ipam", populated: false },
  { key: "calendar", label: "Calendrier de travail", href: "/performance/calendrier", populated: true },
  { key: "settings", label: "Paramètres", href: "/performance/parametres", populated: true },
  { key: "history", label: "Historique / Traçabilité", href: "/performance/historique", populated: true },
];
