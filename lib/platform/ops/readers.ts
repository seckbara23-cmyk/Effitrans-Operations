/**
 * Operations & Support console — composed snapshot (Phase 8.2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE platform-scoped reader that COMPOSES existing capabilities into the ops dashboard.
 * It invents no business logic:
 *   - AI:          getAIStatus (lib/ai/health — secret-free snapshot; live probe only on the
 *                  explicit "verify" action, never on page load) + copilot audit aggregates
 *   - Email/queue: isProviderConfigured (lib/comms/provider) + communication status counts
 *   - Tenants:     getPlatformCompanyStats (lib/platform/companies) + platform-wide user counts
 *   - Activity:    bounded HEAD counts over audit_log by action, today
 *   - Deployment:  Vercel build env + the build-info constants + a data-probe of the newest
 *                  probeable migration marker
 *   - Storage:     bounded counts over storage.objects per bucket
 *
 * DEGRADE-BY-CARD: every section loads under Promise.allSettled; a failing subsystem renders
 * that ONE card as unavailable — the page never crashes and never fakes health (Missing ≠
 * Healthy). SECRET-FREE by construction: no key, token, URL credential, connection string,
 * recipient address, or stack trace is ever returned; the AI section carries host + booleans
 * only (the existing getAIStatus contract).
 *
 * Gate: platform:audit:read (existing platform RBAC — SUPER_ADMIN, SUPPORT, READ_ONLY).
 * Read-only: this module performs zero writes.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { getPlatformCompanyStats, type PlatformCompanyStats } from "@/lib/platform/companies";
import { getAIStatus, type AIStatus } from "@/lib/ai/health";
import { isProviderConfigured } from "@/lib/comms/provider";
import { AuditActions } from "@/lib/audit/events";
import { LATEST_MIGRATION, MIGRATION_COUNT, MIGRATION_PROBE } from "./build-info";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const COPILOT_ACTIONS = [
  AuditActions.LOGISTICS_COPILOT_QUERY,
  AuditActions.PORTAL_COPILOT_QUERY,
  AuditActions.EXECUTIVE_COPILOT_QUERY,
  AuditActions.PLATFORM_COPILOT_QUERY,
] as string[];

const LOGIN_ACTIONS = [
  AuditActions.AUTH_LOGIN, AuditActions.AUTH_LOGIN_GOOGLE,
  AuditActions.PORTAL_LOGIN, AuditActions.PORTAL_LOGIN_GOOGLE,
] as string[];

const REJECTED_LOGIN_ACTIONS = [AuditActions.AUTH_LOGIN_REJECTED, AuditActions.PORTAL_LOGIN_REJECTED] as string[];

/** Actions surfaced in the Critical Events card (reuses the audit trail — no second event store). */
const CRITICAL_ACTIONS = [
  ...REJECTED_LOGIN_ACTIONS,
  AuditActions.USER_ARCHIVED, AuditActions.USER_RESTORED,
  AuditActions.PLATFORM_TENANT_STATUS_CHANGED,
] as string[];

export type CardState = "ok" | "warn" | "down" | "unavailable";

export type OpsDeployment = {
  sha: string | null; ref: string | null; env: string | null; region: string | null;
  latestMigration: string; migrationCount: number;
  /** null = probe unavailable; true = marker present (migrations ≥ probe point); false = MISSING */
  probeApplied: boolean | null; probeMigration: string;
};
export type OpsHealth = { state: CardState; dbReachable: boolean; dbLatencyMs: number | null; hosted: boolean };
export type OpsAi = {
  status: AIStatus | null;
  todayRequests: number; todayAnswered: number; todayFallback: number; todayFailed: number;
  avgLatencyMs: number | null; lastSuccessAt: string | null;
};
export type OpsEmail = {
  providerConfigured: boolean;
  queuedNow: number; sentToday: number; failedToday: number; lastSentAt: string | null;
  state: CardState;
};
export type OpsJobs = {
  /** the ONLY queue on this platform is the communications queue — stated honestly */
  commsQueued: number; commsFailed: number; lastProcessedAt: string | null;
  scheduledJobsExist: false;
};
export type OpsStorageBucket = { bucket: string; objectCount: number | null; latestUploadAt: string | null };
export type OpsStorage = { buckets: OpsStorageBucket[]; state: CardState };
export type OpsUsers = { staffActive: number; staffInactive: number; staffArchived: number; portalUsers: number };
export type OpsActivity = {
  logins: number; rejectedLogins: number; usersCreated: number; usersArchived: number; usersRestored: number;
  aiRequests: number; documentsUploaded: number;
};
export type OpsCriticalEvent = { action: string; occurredAt: string; entity: string | null };
export type OpsEnvironment = {
  supabaseConfigured: boolean; aiConfigured: boolean; emailConfigured: boolean;
  storageConfigured: boolean; siteUrlConfigured: boolean;
};
export type OpsPerformance = { dbProbeMs: number | null; aiAvgLatencyMs: number | null; collected: false };

export type OpsConsole = {
  generatedAt: string;
  /** cards that could not be read this render — shown as unavailable, never as healthy */
  unavailable: string[];
  deployment: OpsDeployment | null;
  health: OpsHealth | null;
  ai: OpsAi | null;
  email: OpsEmail | null;
  jobs: OpsJobs | null;
  storage: OpsStorage | null;
  tenants: PlatformCompanyStats | null;
  users: OpsUsers | null;
  activity: OpsActivity | null;
  critical: OpsCriticalEvent[];
  environment: OpsEnvironment | null;
  performance: OpsPerformance | null;
};

const startOfTodayIso = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

async function countAudit(admin: Admin, actions: string[], sinceIso: string): Promise<number> {
  const { count } = await admin
    .from("audit_log").select("id", { count: "exact", head: true })
    .in("action", actions).gte("occurred_at", sinceIso);
  return count ?? 0;
}

// ---------------------------------------------------------------- sections ----

async function readDeployment(admin: Admin): Promise<OpsDeployment> {
  let probeApplied: boolean | null = null;
  try {
    const { data } = await admin.from("permission").select("code").eq("code", MIGRATION_PROBE.permissionCode).maybeSingle();
    probeApplied = Boolean(data);
  } catch { probeApplied = null; }
  return {
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? (process.env.VERCEL === "1" ? "production" : "local"),
    region: process.env.VERCEL_REGION ?? null,
    latestMigration: LATEST_MIGRATION,
    migrationCount: MIGRATION_COUNT,
    probeApplied,
    probeMigration: MIGRATION_PROBE.migration,
  };
}

async function readHealth(admin: Admin): Promise<OpsHealth> {
  const t0 = Date.now();
  const { error } = await admin.from("organization").select("id", { count: "exact", head: true });
  const dbLatencyMs = Date.now() - t0;
  const dbReachable = !error;
  return {
    state: dbReachable ? (dbLatencyMs > 2000 ? "warn" : "ok") : "down",
    dbReachable,
    dbLatencyMs: dbReachable ? dbLatencyMs : null,
    hosted: process.env.VERCEL === "1",
  };
}

type CopilotAuditRow = { occurred_at: string; after: { outcome?: string; durationMs?: number } | null };

async function readAi(admin: Admin, verify: boolean): Promise<OpsAi> {
  // Config snapshot is secret-free by contract; the LIVE probe runs ONLY on the explicit action.
  const status = await getAIStatus(process.env, { runHealthCheck: verify });
  const { data } = await admin
    .from("audit_log").select("occurred_at, after")
    .in("action", COPILOT_ACTIONS).gte("occurred_at", startOfTodayIso())
    .order("occurred_at", { ascending: false }).range(0, 500)
    .returns<CopilotAuditRow[]>();
  const rows = data ?? [];
  let answered = 0, fallback = 0, failed = 0, durSum = 0, durN = 0;
  let lastSuccessAt: string | null = null;
  for (const r of rows) {
    const o = r.after?.outcome;
    if (o === "answered") { answered++; if (!lastSuccessAt) lastSuccessAt = r.occurred_at; }
    else if (o === "fallback" || o === "rate_limited") fallback++;
    else if (o === "failed") failed++;
    if (typeof r.after?.durationMs === "number") { durSum += r.after.durationMs; durN++; }
  }
  return {
    status,
    todayRequests: rows.length, todayAnswered: answered, todayFallback: fallback, todayFailed: failed,
    avgLatencyMs: durN ? Math.round(durSum / durN) : null,
    lastSuccessAt,
  };
}

async function readEmail(admin: Admin): Promise<OpsEmail> {
  const today = startOfTodayIso();
  const [queuedRes, sentRes, failedRes, lastRes] = await Promise.all([
    admin.from("communication").select("id", { count: "exact", head: true }).eq("status", "QUEUED"),
    admin.from("communication").select("id", { count: "exact", head: true }).eq("status", "SENT").gte("created_at", today),
    admin.from("communication").select("id", { count: "exact", head: true }).eq("status", "FAILED").gte("created_at", today),
    admin.from("communication").select("created_at").eq("status", "SENT").order("created_at", { ascending: false }).limit(1).maybeSingle<{ created_at: string }>(),
  ]);
  const providerConfigured = isProviderConfigured();
  const failedToday = failedRes.count ?? 0;
  return {
    providerConfigured,
    queuedNow: queuedRes.count ?? 0,
    sentToday: sentRes.count ?? 0,
    failedToday,
    lastSentAt: lastRes.data?.created_at ?? null,
    // Not configured = the deliberate no-op stub, a WARNING not a failure; failures today = warn.
    state: !providerConfigured ? "warn" : failedToday > 0 ? "warn" : "ok",
  };
}

async function readJobs(email: OpsEmail | null): Promise<OpsJobs> {
  return {
    commsQueued: email?.queuedNow ?? 0,
    commsFailed: email?.failedToday ?? 0,
    lastProcessedAt: email?.lastSentAt ?? null,
    scheduledJobsExist: false, // honest: no cron/scheduled jobs exist on this platform
  };
}

const BUCKETS = ["documents", "brand-assets"] as const;

async function readStorage(admin: Admin): Promise<OpsStorage> {
  // The generated Database types cover the public schema only; storage.objects is a Supabase
  // system table (service-role readable). The cast is contained to this one bounded reader.
  const storageSchema = (admin as unknown as { schema: (s: string) => Admin }).schema("storage");
  const buckets: OpsStorageBucket[] = [];
  for (const bucket of BUCKETS) {
    try {
      const [countRes, lastRes] = await Promise.all([
        storageSchema.from("objects").select("id", { count: "exact", head: true }).eq("bucket_id", bucket),
        storageSchema.from("objects").select("created_at").eq("bucket_id", bucket).order("created_at", { ascending: false }).limit(1).maybeSingle<{ created_at: string }>(),
      ]);
      buckets.push({ bucket, objectCount: countRes.count ?? 0, latestUploadAt: lastRes.data?.created_at ?? null });
    } catch {
      buckets.push({ bucket, objectCount: null, latestUploadAt: null });
    }
  }
  const anyReadable = buckets.some((b) => b.objectCount !== null);
  return { buckets, state: anyReadable ? "ok" : "unavailable" };
}

async function readUsers(admin: Admin): Promise<OpsUsers> {
  const [act, inact, arch, portal] = await Promise.all([
    admin.from("app_user").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("app_user").select("id", { count: "exact", head: true }).eq("status", "inactive"),
    admin.from("app_user").select("id", { count: "exact", head: true }).eq("status", "archived"),
    admin.from("client_user").select("id", { count: "exact", head: true }),
  ]);
  return {
    staffActive: act.count ?? 0, staffInactive: inact.count ?? 0,
    staffArchived: arch.count ?? 0, portalUsers: portal.count ?? 0,
  };
}

async function readActivity(admin: Admin): Promise<OpsActivity> {
  const today = startOfTodayIso();
  const [logins, rejected, created, archived, restored, ai, docs] = await Promise.all([
    countAudit(admin, LOGIN_ACTIONS, today),
    countAudit(admin, REJECTED_LOGIN_ACTIONS, today),
    countAudit(admin, [AuditActions.USER_CREATED, AuditActions.USER_CREATED_WITH_TEMP_PASSWORD] as string[], today),
    countAudit(admin, [AuditActions.USER_ARCHIVED] as string[], today),
    countAudit(admin, [AuditActions.USER_RESTORED] as string[], today),
    countAudit(admin, COPILOT_ACTIONS, today),
    countAudit(admin, [AuditActions.DOCUMENT_UPLOADED, AuditActions.PORTAL_DOCUMENT_UPLOADED] as string[], today),
  ]);
  return { logins, rejectedLogins: rejected, usersCreated: created, usersArchived: archived, usersRestored: restored, aiRequests: ai, documentsUploaded: docs };
}

async function readCritical(admin: Admin): Promise<OpsCriticalEvent[]> {
  const { data } = await admin
    .from("audit_log").select("action, occurred_at, entity")
    .in("action", CRITICAL_ACTIONS)
    .order("occurred_at", { ascending: false }).limit(15)
    .returns<{ action: string; occurred_at: string; entity: string | null }[]>();
  return (data ?? []).map((r) => ({ action: r.action, occurredAt: r.occurred_at, entity: r.entity }));
}

function readEnvironment(ai: OpsAi | null, email: OpsEmail | null, storage: OpsStorage | null): OpsEnvironment {
  return {
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    aiConfigured: Boolean(ai?.status?.configOk && ai.status.credentialsPresent),
    emailConfigured: Boolean(email?.providerConfigured),
    storageConfigured: storage?.state === "ok",
    siteUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
  };
}

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

/**
 * The whole console in one composed, degrade-by-card read.
 * @param opts.verifyAi run the LIVE AI provider probe (explicit operator action only)
 */
export async function getOpsConsole(opts: { verifyAi?: boolean } = {}): Promise<OpsConsole> {
  await assertPlatformPermission("platform:audit:read");
  const admin = getAdminSupabaseClient();
  const unavailable: string[] = [];

  const [depR, healthR, aiR, emailR, storageR, tenantsR, usersR, activityR, criticalR] = await Promise.allSettled([
    readDeployment(admin),
    readHealth(admin),
    readAi(admin, opts.verifyAi === true),
    readEmail(admin),
    readStorage(admin),
    getPlatformCompanyStats(),
    readUsers(admin),
    readActivity(admin),
    readCritical(admin),
  ]);

  const deployment = settled(depR); if (!deployment) unavailable.push("deployment");
  const health = settled(healthR); if (!health) unavailable.push("health");
  const ai = settled(aiR); if (!ai) unavailable.push("ai");
  const email = settled(emailR); if (!email) unavailable.push("email");
  const storage = settled(storageR); if (!storage) unavailable.push("storage");
  const tenants = settled(tenantsR); if (!tenants) unavailable.push("tenants");
  const users = settled(usersR); if (!users) unavailable.push("users");
  const activity = settled(activityR); if (!activity) unavailable.push("activity");
  const critical = settled(criticalR) ?? [];

  return {
    generatedAt: new Date().toISOString(),
    unavailable,
    deployment,
    health,
    ai,
    email,
    jobs: await readJobs(email),
    storage,
    tenants,
    users,
    activity,
    critical,
    environment: readEnvironment(ai, email, storage),
    performance: {
      dbProbeMs: health?.dbLatencyMs ?? null,
      aiAvgLatencyMs: ai?.avgLatencyMs ?? null,
      collected: false, // honest: per-endpoint response times are not collected in-app (Vercel Observability)
    },
  };
}
