/**
 * Platform-safe company metadata service (Phase 4.0B-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONLY sanctioned way platform administration reads tenant data. Every entry
 * is gated by an explicit platform permission and returns ONLY safe tenant-level
 * metadata + coarse aggregates — NEVER invoices, payments, customs declarations,
 * documents, client records, driver coordinates, internal notes, or AI content.
 *
 * Uses the service-role client (platform reads are cross-tenant by design; a
 * platform admin has no tenant and cannot use tenant RLS). Queries are bounded
 * (3 total, independent of tenant count) — no N+1. Per-tenant module enablement
 * is DERIVED from the plan via the entitlements contract until per-tenant module
 * storage lands in Phase 4.0D.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission } from "./auth";
import { isPlanKey, resolveTenantModules, type ModuleKey } from "./entitlements";

export type CompanySummary = {
  id: string;
  displayName: string;
  slug: string | null;
  lifecycleStatus: string;
  productProfile: string;
  planKey: string | null;
  country: string | null;
  locale: string;
  currency: string;
  timezone: string;
  onboardingStatus: string;
  brandingComplete: boolean;
  userCount: number;
  activeDossierCount: number;
  lastTenantLoginAt: string | null;
  enabledModules: ModuleKey[];
  createdAt: string;
  /** Trial window (Phase 6.0C — surfaced for the console; already on the row). */
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** The tenant's SYSTEM_ADMIN login, for the console's admin-email search. */
  administratorEmail: string | null;
};

export type PlatformCompanyStats = {
  total: number;
  active: number;
  trial: number;
  suspended: number;
  archived: number;
  totalUsers: number;
  aiEnabled: number;
  trackingEnabled: number;
};

const TERMINAL_FILE_STATUSES = new Set(["CLOSED", "CANCELLED"]);

/** All tenants, with safe metadata + coarse aggregates. Gated + no N+1. */
export async function listCompanies(): Promise<CompanySummary[]> {
  await assertPlatformPermission("platform:companies:read");
  const admin = getAdminSupabaseClient();

  const [orgsRes, usersRes, filesRes] = await Promise.all([
    admin
      .from("organization")
      .select(
        "id, name, trade_name, slug, lifecycle_status, product_profile, plan_key, country, locale, currency, timezone, onboarding_status, branding_complete, created_at, trial_started_at, trial_ends_at",
      )
      .order("created_at"),
    // platform-wide aggregate (no tenant filter — cross-tenant by design); ONLY
    // non-sensitive columns are read.
    // Safe platform metadata only: tenant, login recency, and the SYSTEM_ADMIN's
    // email for search. No names, no other PII beyond the admin login the platform
    // itself provisioned.
    admin.from("app_user").select("tenant_id, email, last_login_at, is_system_admin"),
    admin.from("operational_file").select("tenant_id, status"),
  ]);

  if (orgsRes.error) throw new Error(`[platform] company read failed: ${orgsRes.error.message}`);

  const userCount = new Map<string, number>();
  const lastLogin = new Map<string, string>();
  const adminEmail = new Map<string, string>();
  for (const u of usersRes.data ?? []) {
    userCount.set(u.tenant_id, (userCount.get(u.tenant_id) ?? 0) + 1);
    if (u.last_login_at && (!lastLogin.has(u.tenant_id) || u.last_login_at > lastLogin.get(u.tenant_id)!)) {
      lastLogin.set(u.tenant_id, u.last_login_at);
    }
    if (u.is_system_admin && u.email && !adminEmail.has(u.tenant_id)) {
      adminEmail.set(u.tenant_id, u.email as string);
    }
  }
  const activeFiles = new Map<string, number>();
  for (const f of filesRes.data ?? []) {
    if (!TERMINAL_FILE_STATUSES.has(f.status)) {
      activeFiles.set(f.tenant_id, (activeFiles.get(f.tenant_id) ?? 0) + 1);
    }
  }

  return (orgsRes.data ?? []).map((o) => {
    const pk = o.plan_key;
    const modules = pk && isPlanKey(pk) ? resolveTenantModules(pk) : [];
    return {
      id: o.id,
      displayName: o.trade_name ?? o.name,
      slug: o.slug,
      lifecycleStatus: o.lifecycle_status,
      productProfile: o.product_profile,
      planKey: o.plan_key,
      country: o.country,
      locale: o.locale,
      currency: o.currency,
      timezone: o.timezone,
      onboardingStatus: o.onboarding_status,
      brandingComplete: o.branding_complete,
      userCount: userCount.get(o.id) ?? 0,
      activeDossierCount: activeFiles.get(o.id) ?? 0,
      lastTenantLoginAt: lastLogin.get(o.id) ?? null,
      enabledModules: modules,
      createdAt: o.created_at,
      trialStartedAt: (o as Record<string, unknown>).trial_started_at as string ?? null,
      trialEndsAt: (o as Record<string, unknown>).trial_ends_at as string ?? null,
      administratorEmail: adminEmail.get(o.id) ?? null,
    };
  });
}

/** One tenant's safe metadata, or null. Gated. */
export async function getCompany(id: string): Promise<CompanySummary | null> {
  const all = await listCompanies();
  return all.find((c) => c.id === id) ?? null;
}

/** Aggregate platform dashboard stats derived from the safe company list. */
export async function getPlatformCompanyStats(): Promise<PlatformCompanyStats> {
  const companies = await listCompanies();
  const stats: PlatformCompanyStats = {
    total: companies.length,
    active: 0,
    trial: 0,
    suspended: 0,
    archived: 0,
    totalUsers: 0,
    aiEnabled: 0,
    trackingEnabled: 0,
  };
  for (const c of companies) {
    stats.totalUsers += c.userCount;
    if (c.lifecycleStatus === "ACTIVE") stats.active++;
    else if (c.lifecycleStatus === "TRIAL") stats.trial++;
    else if (c.lifecycleStatus === "SUSPENDED") stats.suspended++;
    else if (c.lifecycleStatus === "ARCHIVED") stats.archived++;
    if (c.enabledModules.includes("module.ai")) stats.aiEnabled++;
    if (c.enabledModules.includes("module.tracking")) stats.trackingEnabled++;
  }
  return stats;
}
