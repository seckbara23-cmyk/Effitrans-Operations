import "server-only";

/**
 * Platform Copilot context (Phase 6.0F). SERVER-ONLY — platform admins only.
 * ---------------------------------------------------------------------------
 * Builds an ALLOWLISTED, aggregate-first snapshot of tenant operations for the read-only
 * Platform Copilot. It is deliberately built by allowlist (a fixed set of safe fields
 * assembled below), NOT by redacting a broad object — so a new sensitive column can never
 * leak by omission of a blacklist rule.
 *
 * Every field here is safe platform metadata already surfaced in the Companies Console:
 * lifecycle, plan, trial window, onboarding progress, coarse counts, rollout state,
 * branding completeness, login recency, derived health. It EXCLUDES by construction:
 * document bodies, customer PII, passwords, setup links, tokens, provider credentials,
 * raw audit payloads, financial/customs/shipment content, and private communications.
 * The tenant administrator email is reduced to a boolean (hasAdministrator) — no PII.
 *
 * Bounded: 3 platform reads total (companies, rollout, a user aggregate), independent of
 * tenant count. Gated by platform:copilot:read.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { listCompanies } from "@/lib/platform/companies";
import { getRolloutOverview } from "@/lib/platform/rollout-read";
import { deriveOnboardingChecklist } from "@/lib/platform/console/onboarding";
import { deriveTrialState } from "@/lib/platform/console/table";
import { deriveInvitationState } from "@/lib/users/invitation-state";
import {
  PLATFORM_COPILOT_CATEGORIES,
  type PlatformCopilotContext,
  type PlatformTenantSnapshot,
} from "./types";

export { PLATFORM_COPILOT_CATEGORIES };
export type { PlatformCopilotContext, PlatformTenantSnapshot };

/** Days without a tenant login before we call activity "stale". */
const STALE_ACTIVITY_DAYS = 14;

function healthOf(s: {
  hasAdministrator: boolean;
  onboardingComplete: boolean;
  brandingComplete: boolean;
  engineLive: boolean;
}): "healthy" | "attention" | "setup" {
  if (!s.hasAdministrator || !s.onboardingComplete || !s.brandingComplete) return "setup";
  if (!s.engineLive) return "attention";
  return "healthy";
}

/**
 * Assemble the allowlisted platform context. `now` is injected for deterministic trial /
 * staleness derivation. Gated by platform:copilot:read.
 */
export async function buildPlatformCopilotContext(now: number): Promise<PlatformCopilotContext> {
  await assertPlatformPermission("platform:copilot:read");

  const [companies, rollout] = await Promise.all([listCompanies(), getRolloutOverview()]);
  const rolloutByTenant = new Map(rollout.rows.map((r) => [r.tenantId, r]));

  // One bounded, platform-wide user aggregate for invitation summaries (safe columns only).
  const admin = getAdminSupabaseClient();
  const { data: users } = await admin
    .from("app_user")
    .select("tenant_id, status, last_login_at, onboarding_email_sent_at");
  const invByTenant = new Map<string, { awaitingSetup: number; cancelled: number }>();
  for (const u of users ?? []) {
    const acc = invByTenant.get(u.tenant_id) ?? { awaitingSetup: 0, cancelled: 0 };
    const state = deriveInvitationState({
      status: u.status,
      lastLoginAt: u.last_login_at,
      onboardingEmailSentAt: u.onboarding_email_sent_at,
    });
    if (state === "email_sent" || state === "no_invitation") acc.awaitingSetup++;
    else if (state === "cancelled") acc.cancelled++;
    invByTenant.set(u.tenant_id, acc);
  }

  const tenants: PlatformTenantSnapshot[] = companies.map((c) => {
    const row = rolloutByTenant.get(c.id);
    const engineLive = row?.effective.process_engine ?? false;
    const features = row
      ? (["process_engine", "process_workspaces", "physical_invoice_deposit", "collections"] as const).filter(
          (f) => row.effective[f],
        )
      : [];
    const checklist = deriveOnboardingChecklist(c, { rowExists: Boolean(row), live: engineLive });
    const trial = deriveTrialState(c, now);
    const lastLoginMs = c.lastTenantLoginAt ? new Date(c.lastTenantLoginAt).getTime() : null;
    const activityStale = lastLoginMs === null || now - lastLoginMs > STALE_ACTIVITY_DAYS * 86_400_000;
    const hasAdministrator = c.userCount > 0 && c.administratorEmail !== null;

    return {
      id: c.id,
      displayName: c.displayName,
      slug: c.slug,
      lifecycleStatus: c.lifecycleStatus,
      plan: c.planKey,
      trial,
      onboarding: {
        completed: checklist.completed,
        total: checklist.total,
        incomplete: checklist.items.filter((i) => !i.complete).map((i) => i.label),
      },
      userCount: c.userCount,
      activeDossierCount: c.activeDossierCount,
      rollout: { engineLive, features },
      brandingComplete: c.brandingComplete,
      lastTenantLoginAt: c.lastTenantLoginAt,
      activityStale,
      hasAdministrator,
      invitations: invByTenant.get(c.id) ?? { awaitingSetup: 0, cancelled: 0 },
      health: healthOf({
        hasAdministrator,
        onboardingComplete: c.onboardingStatus === "complete",
        brandingComplete: c.brandingComplete,
        engineLive,
      }),
    };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    tenantCount: tenants.length,
    categories: [...PLATFORM_COPILOT_CATEGORIES],
    tenants,
  };
}
