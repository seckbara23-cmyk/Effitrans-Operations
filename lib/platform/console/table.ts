/**
 * Companies console table logic (Phase 6.0C). PURE — no React, no I/O.
 * ---------------------------------------------------------------------------
 * Search, filter, sort, paginate and derive over the safe CompanySummary list.
 * Extracted so the console's behaviour is unit-tested in node (this repo has no
 * jsdom) and the client table is a thin renderer.
 *
 * NOTHING HERE FABRICATES DATA. Trial state is computed from the trial dates already
 * on the row; health is a rollup of facts we already read (branding complete, has an
 * admin, onboarding complete, rollout live) — never an invented uptime or job metric.
 */
import type { CompanySummary } from "@/lib/platform/companies";
import type { TenantRollout } from "@/lib/process/rollout";

// --------------------------------------------------------------- trial ----

export type TrialState = {
  onTrial: boolean;
  expired: boolean;
  daysLeft: number | null;
};

/** Derive the trial window from the row's own dates. `now` is injected for testability. */
export function deriveTrialState(company: CompanySummary, now: number): TrialState {
  if (company.lifecycleStatus !== "TRIAL" || !company.trialEndsAt) {
    return { onTrial: false, expired: false, daysLeft: null };
  }
  const ends = new Date(company.trialEndsAt).getTime();
  const daysLeft = Math.ceil((ends - now) / 86_400_000);
  return { onTrial: true, expired: daysLeft < 0, daysLeft };
}

// --------------------------------------------------------------- health ----

export type HealthLevel = "healthy" | "attention" | "setup";

export type CompanyHealth = {
  level: HealthLevel;
  brandingComplete: boolean;
  hasAdministrator: boolean;
  onboardingComplete: boolean;
  rolloutLive: boolean;
  /** Short French summary of the single most useful fact. */
  summary: string;
};

/**
 * Roll up the facts we already have into a health level. `rolloutLive` is the
 * EFFECTIVE engine state (kill switch ANDed with the tenant row), passed in from the
 * rollout overview — never recomputed here.
 */
export function deriveCompanyHealth(company: CompanySummary, rolloutLive: boolean): CompanyHealth {
  const hasAdministrator = company.userCount > 0 && company.administratorEmail !== null;
  const onboardingComplete = company.onboardingStatus === "complete";
  const brandingComplete = company.brandingComplete;

  let level: HealthLevel;
  let summary: string;
  if (!hasAdministrator) {
    level = "setup";
    summary = "En attente du premier administrateur";
  } else if (!onboardingComplete || !brandingComplete) {
    level = "setup";
    summary = "Onboarding en cours";
  } else if (!rolloutLive) {
    level = "attention";
    summary = "Processus officiel non activé";
  } else {
    level = "healthy";
    summary = "Opérationnel";
  }

  return { level, brandingComplete, hasAdministrator, onboardingComplete, rolloutLive, summary };
}

// --------------------------------------------------------------- rows ----

/** A company enriched with its rollout + derived views — what the table renders. */
export type ConsoleRow = {
  company: CompanySummary;
  rollout: TenantRollout | null;
  rolloutLive: boolean;
  trial: TrialState;
  health: CompanyHealth;
};

export function buildConsoleRows(
  companies: CompanySummary[],
  rolloutByTenant: Map<string, { rollout: TenantRollout; live: boolean }>,
  now: number,
): ConsoleRow[] {
  return companies.map((company) => {
    const r = rolloutByTenant.get(company.id);
    const rolloutLive = r?.live ?? false;
    return {
      company,
      rollout: r?.rollout ?? null,
      rolloutLive,
      trial: deriveTrialState(company, now),
      health: deriveCompanyHealth(company, rolloutLive),
    };
  });
}

// --------------------------------------------------------------- filter ----

export type ConsoleFilter = {
  search?: string;
  status?: string; // lifecycle_status
  plan?: string;
  onboarding?: string;
  health?: HealthLevel;
  rollout?: "live" | "off";
};

export function filterRows(rows: ConsoleRow[], filter: ConsoleFilter): ConsoleRow[] {
  const q = filter.search?.trim().toLowerCase();
  return rows.filter((r) => {
    const c = r.company;
    if (q) {
      const hay = [c.displayName, c.slug ?? "", c.administratorEmail ?? ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter.status && c.lifecycleStatus !== filter.status) return false;
    if (filter.plan && c.planKey !== filter.plan) return false;
    if (filter.onboarding && c.onboardingStatus !== filter.onboarding) return false;
    if (filter.health && r.health.level !== filter.health) return false;
    if (filter.rollout === "live" && !r.rolloutLive) return false;
    if (filter.rollout === "off" && r.rolloutLive) return false;
    return true;
  });
}

// --------------------------------------------------------------- sort ----

export type SortKey = "company" | "created" | "lastActivity" | "users" | "plan" | "status";
export type SortDir = "asc" | "desc";

const PLAN_ORDER: Record<string, number> = { STARTER: 1, PROFESSIONAL: 2, ENTERPRISE: 3 };

export function sortRows(rows: ConsoleRow[], key: SortKey, dir: SortDir): ConsoleRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: ConsoleRow): string | number => {
    switch (key) {
      case "company":
        return r.company.displayName.toLowerCase();
      case "created":
        return r.company.createdAt;
      case "lastActivity":
        return r.company.lastTenantLoginAt ?? "";
      case "users":
        return r.company.userCount;
      case "plan":
        return PLAN_ORDER[r.company.planKey ?? ""] ?? 0;
      case "status":
        return r.company.lifecycleStatus;
    }
  };
  // Copy first — never sort the caller's array in place.
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    // Stable tiebreak by id so pagination is deterministic.
    return a.company.id < b.company.id ? -1 : 1;
  });
}

// --------------------------------------------------------------- paginate ----

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const from = (p - 1) * pageSize;
  return { items: items.slice(from, from + pageSize), page: p, pageSize, total, totalPages };
}

/** The whole pipeline: rows → filter → sort → paginate. Deterministic. */
export function queryConsole(
  rows: ConsoleRow[],
  opts: { filter?: ConsoleFilter; sortKey?: SortKey; sortDir?: SortDir; page?: number; pageSize?: number },
): Page<ConsoleRow> {
  const filtered = filterRows(rows, opts.filter ?? {});
  const sorted = sortRows(filtered, opts.sortKey ?? "created", opts.sortDir ?? "desc");
  return paginate(sorted, opts.page ?? 1, opts.pageSize ?? 20);
}
