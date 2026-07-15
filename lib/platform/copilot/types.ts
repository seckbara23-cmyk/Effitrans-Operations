/**
 * Platform Copilot context types + category allowlist (Phase 6.0F). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * Kept separate from the server-only context builder so the pure prompt serializer and
 * the tests can import the shape and the allowlist without loading server modules.
 *
 * The category allowlist is the SAFE surface the platform Copilot may reason over. It
 * deliberately contains no business category (dossier / finance / customs / document /
 * communication) — those are never assembled into the context.
 */
export const PLATFORM_COPILOT_CATEGORIES = [
  "lifecycle",
  "plan",
  "trial",
  "onboarding",
  "rollout",
  "branding",
  "activity",
  "invitations",
  "health",
] as const;

export type PlatformCopilotCategory = (typeof PLATFORM_COPILOT_CATEGORIES)[number];

export type PlatformTenantSnapshot = {
  id: string;
  displayName: string;
  slug: string | null;
  lifecycleStatus: string;
  plan: string | null;
  trial: { onTrial: boolean; expired: boolean; daysLeft: number | null };
  onboarding: { completed: number; total: number; incomplete: string[] };
  userCount: number;
  activeDossierCount: number;
  rollout: { engineLive: boolean; features: string[] };
  brandingComplete: boolean;
  lastTenantLoginAt: string | null;
  activityStale: boolean;
  hasAdministrator: boolean;
  invitations: { awaitingSetup: number; cancelled: number };
  health: "healthy" | "attention" | "setup";
};

export type PlatformCopilotContext = {
  /** ISO time the snapshot was assembled — freshness for the answer. */
  generatedAt: string;
  tenantCount: number;
  /** The safe field groups included — echoed to the audit + the caveat line. */
  categories: string[];
  tenants: PlatformTenantSnapshot[];
};
