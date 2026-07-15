/**
 * Console badge vocabulary (Phase 6.0C). PURE.
 * ---------------------------------------------------------------------------
 * French labels + tone classes for the lifecycle, onboarding and health values —
 * derived ONLY from the existing enums (company-metadata.ts, table.ts). No status
 * value is invented here; an unknown value falls back to a neutral label rather than
 * being echoed raw.
 */
import type { HealthLevel } from "./table";

export type BadgeTone = "green" | "amber" | "red" | "slate" | "blue";

export const LIFECYCLE_BADGES: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Actif", tone: "green" },
  TRIAL: { label: "Essai", tone: "blue" },
  SUSPENDED: { label: "Suspendu", tone: "red" },
  ARCHIVED: { label: "Archivé", tone: "slate" },
};

export const ONBOARDING_BADGES: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "À démarrer", tone: "amber" },
  in_progress: { label: "En cours", tone: "blue" },
  complete: { label: "Terminé", tone: "green" },
};

export const HEALTH_BADGES: Record<HealthLevel, { label: string; tone: BadgeTone }> = {
  healthy: { label: "Opérationnel", tone: "green" },
  attention: { label: "Attention", tone: "amber" },
  setup: { label: "Configuration", tone: "slate" },
};

export function lifecycleBadge(status: string) {
  return LIFECYCLE_BADGES[status] ?? { label: status, tone: "slate" as BadgeTone };
}
export function onboardingBadge(status: string) {
  return ONBOARDING_BADGES[status] ?? { label: status, tone: "slate" as BadgeTone };
}

/** Tailwind classes for a tone, dark-platform palette. */
export const TONE_CLASS: Record<BadgeTone, string> = {
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  red: "border-red-400/30 bg-red-400/10 text-red-300",
  blue: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  slate: "border-white/15 bg-white/5 text-slate-300",
};
