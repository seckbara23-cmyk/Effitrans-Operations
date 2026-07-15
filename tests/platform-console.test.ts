/**
 * Phase 6.0C — the Platform Companies Console.
 *
 * The console's behaviour is pure (filter/sort/search/paginate/derive) and tested
 * directly; the pages and reads are asserted structurally for their security posture
 * and their reuse of existing infrastructure — the codebase's standing split, no jsdom,
 * no snapshots.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  deriveTrialState,
  deriveCompanyHealth,
  buildConsoleRows,
  filterRows,
  sortRows,
  paginate,
  queryConsole,
  type ConsoleRow,
} from "@/lib/platform/console/table";
import { lifecycleBadge, onboardingBadge, HEALTH_BADGES, LIFECYCLE_BADGES } from "@/lib/platform/console/badges";
import { LIFECYCLE_STATUSES, ONBOARDING_STATUSES } from "@/lib/platform/company-metadata";
import type { CompanySummary } from "@/lib/platform/companies";
import type { TenantRollout } from "@/lib/process/rollout";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const dashboard = read("../app/platform/companies/page.tsx");
const detail = read("../app/platform/companies/[id]/page.tsx");
const consoleComp = code("../components/platform/companies-console.tsx");
const detailReads = read("../lib/platform/company-detail.ts");

const NOW = Date.parse("2026-07-15T00:00:00Z");
const day = 86_400_000;

function company(over: Partial<CompanySummary> = {}): CompanySummary {
  return {
    id: "t-" + (over.slug ?? over.id ?? "x"),
    displayName: "Acme",
    slug: "acme",
    lifecycleStatus: "ACTIVE",
    productProfile: "LOGISTICS_COMPANY",
    planKey: "PROFESSIONAL",
    country: "SN",
    locale: "fr",
    currency: "XOF",
    timezone: "Africa/Dakar",
    onboardingStatus: "complete",
    brandingComplete: true,
    userCount: 3,
    activeDossierCount: 1,
    lastTenantLoginAt: "2026-07-10T10:00:00Z",
    enabledModules: [],
    createdAt: "2026-07-01T00:00:00Z",
    trialStartedAt: null,
    trialEndsAt: null,
    administratorEmail: "admin@acme.sn",
    ...over,
  };
}

const rollout = (over: Partial<TenantRollout> = {}): TenantRollout => ({
  process_engine: false,
  process_workspaces: false,
  physical_invoice_deposit: false,
  collections: false,
  ...over,
});

// --------------------------------------------------------------- trial ----

describe("trial state derives from the row's own dates", () => {
  it("is inactive off-trial", () => {
    expect(deriveTrialState(company({ lifecycleStatus: "ACTIVE" }), NOW).onTrial).toBe(false);
  });

  it("counts days left and flags expiry", () => {
    const fresh = deriveTrialState(company({ lifecycleStatus: "TRIAL", trialEndsAt: new Date(NOW + 5 * day).toISOString() }), NOW);
    expect(fresh.onTrial).toBe(true);
    expect(fresh.expired).toBe(false);
    expect(fresh.daysLeft).toBe(5);

    const gone = deriveTrialState(company({ lifecycleStatus: "TRIAL", trialEndsAt: new Date(NOW - 2 * day).toISOString() }), NOW);
    expect(gone.expired).toBe(true);
    expect(gone.daysLeft).toBeLessThan(0);
  });

  it("is inactive when TRIAL but no end date", () => {
    expect(deriveTrialState(company({ lifecycleStatus: "TRIAL", trialEndsAt: null }), NOW).onTrial).toBe(false);
  });
});

// --------------------------------------------------------------- health ----

describe("health rolls up facts we already have — never fabricated", () => {
  it("is setup with no administrator", () => {
    const h = deriveCompanyHealth(company({ userCount: 0, administratorEmail: null }), false);
    expect(h.level).toBe("setup");
    expect(h.hasAdministrator).toBe(false);
  });

  it("is setup while onboarding or branding is incomplete", () => {
    expect(deriveCompanyHealth(company({ onboardingStatus: "in_progress" }), false).level).toBe("setup");
    expect(deriveCompanyHealth(company({ brandingComplete: false }), false).level).toBe("setup");
  });

  it("is attention when set up but rollout is off", () => {
    expect(deriveCompanyHealth(company(), false).level).toBe("attention");
  });

  it("is healthy only when everything is done and rollout is live", () => {
    const h = deriveCompanyHealth(company(), true);
    expect(h.level).toBe("healthy");
    expect(h.rolloutLive).toBe(true);
  });

  it("uses the EFFECTIVE rollout passed in, never a recomputed one", () => {
    // Same company, different injected rollout → different health. Proves it does not
    // derive rollout itself.
    expect(deriveCompanyHealth(company(), true).level).toBe("healthy");
    expect(deriveCompanyHealth(company(), false).level).toBe("attention");
  });
});

// --------------------------------------------------------------- pipeline ----

describe("search / filter / sort / paginate", () => {
  const rows = buildConsoleRows(
    [
      company({ id: "a", slug: "alpha", displayName: "Alpha SARL", administratorEmail: "x@alpha.sn", lifecycleStatus: "ACTIVE", planKey: "STARTER", createdAt: "2026-01-01T00:00:00Z", userCount: 1 }),
      company({ id: "b", slug: "beta", displayName: "Beta SA", administratorEmail: "y@beta.sn", lifecycleStatus: "TRIAL", planKey: "ENTERPRISE", createdAt: "2026-03-01T00:00:00Z", userCount: 9, trialEndsAt: new Date(NOW + 3 * day).toISOString() }),
      company({ id: "c", slug: "gamma", displayName: "Gamma Ltd", administratorEmail: "z@gamma.sn", lifecycleStatus: "SUSPENDED", planKey: "PROFESSIONAL", createdAt: "2026-02-01T00:00:00Z", userCount: 4 }),
    ],
    new Map([["b", { rollout: rollout({ process_engine: true }), live: true }]]),
    NOW,
  );

  it("searches name, slug and administrator email", () => {
    expect(filterRows(rows, { search: "beta" }).map((r) => r.company.id)).toEqual(["b"]);
    expect(filterRows(rows, { search: "z@gamma" }).map((r) => r.company.id)).toEqual(["c"]);
    expect(filterRows(rows, { search: "ALPHA" }).map((r) => r.company.id)).toEqual(["a"]);
  });

  it("filters by status, plan and rollout", () => {
    expect(filterRows(rows, { status: "TRIAL" }).map((r) => r.company.id)).toEqual(["b"]);
    expect(filterRows(rows, { plan: "STARTER" }).map((r) => r.company.id)).toEqual(["a"]);
    expect(filterRows(rows, { rollout: "live" }).map((r) => r.company.id)).toEqual(["b"]);
    expect(filterRows(rows, { rollout: "off" }).map((r) => r.company.id).sort()).toEqual(["a", "c"]);
  });

  it("sorts by company, users and created, both directions, without mutating input", () => {
    const snapshot = rows.map((r) => r.company.id);
    expect(sortRows(rows, "company", "asc").map((r) => r.company.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "users", "desc").map((r) => r.company.id)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "created", "asc").map((r) => r.company.id)).toEqual(["a", "c", "b"]);
    expect(rows.map((r) => r.company.id)).toEqual(snapshot); // input untouched
  });

  it("paginates deterministically and clamps the page", () => {
    const p = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(p.items).toEqual([3, 4]);
    expect(p.totalPages).toBe(3);
    expect(paginate([1, 2, 3], 99, 2).page).toBe(2); // clamped to last
  });

  it("runs the whole pipeline for a filtered+sorted+paged view", () => {
    const res = queryConsole(rows, { filter: { rollout: "off" }, sortKey: "company", sortDir: "asc", page: 1, pageSize: 1 });
    expect(res.total).toBe(2);
    expect(res.items.map((r) => r.company.id)).toEqual(["a"]);
    expect(res.totalPages).toBe(2);
  });
});

// --------------------------------------------------------------- badges ----

describe("badges use only the existing enums, never an invented status", () => {
  it("labels every lifecycle and onboarding enum value", () => {
    for (const s of LIFECYCLE_STATUSES) expect(LIFECYCLE_BADGES[s]).toBeDefined();
    for (const s of ONBOARDING_STATUSES) expect(onboardingBadge(s).label).not.toBe(s);
  });
  it("falls back to a neutral label for an unknown value rather than inventing one", () => {
    expect(lifecycleBadge("WHATEVER").label).toBe("WHATEVER");
    expect(lifecycleBadge("WHATEVER").tone).toBe("slate");
  });
  it("covers all three health levels", () => {
    for (const l of ["healthy", "attention", "setup"] as const) expect(HEALTH_BADGES[l]).toBeDefined();
  });
});

// --------------------------------------------------------------- security ----

describe("platform authorization is enforced server-side, everywhere", () => {
  it("the dashboard asserts platform:companies:read before loading", () => {
    expect(dashboard).toContain('assertPlatformPermission("platform:companies:read")');
    const assertAt = dashboard.indexOf("assertPlatformPermission");
    const loadAt = dashboard.indexOf("loadConsoleRows");
    expect(assertAt).toBeLessThan(loadAt);
  });

  it("the detail page asserts the permission before any read", () => {
    expect(detail).toContain('assertPlatformPermission("platform:companies:read")');
    const assertAt = detail.indexOf("assertPlatformPermission");
    const readAt = detail.indexOf("getCompany(params.id)");
    expect(assertAt).toBeLessThan(readAt);
  });

  it("every new per-tenant read is itself gated", () => {
    expect(detailReads).toContain('assertPlatformPermission("platform:companies:read")');
    expect(detailReads).toContain('assertPlatformPermission("platform:audit:read")');
  });

  it("the client console holds NO authority and cannot fetch", () => {
    for (const forbidden of ["assertPlatformPermission", "getAdminSupabaseClient", "service_role", ".from(", ".rpc("]) {
      expect(consoleComp, forbidden).not.toContain(forbidden);
    }
  });

  it("reuses the existing rollout controls — rollout logic is not duplicated", () => {
    expect(detail).toContain("RolloutControls");
    expect(detail).toContain("getRolloutOverview()");
    expect(detail).not.toContain("setTenantRollout"); // the console does not re-implement the toggle
  });

  it("reuses the existing audit and branding reads", () => {
    expect(detail).toContain("listCompanyAuditEvents");
    expect(detail).toContain("resolveTenantBranding");
  });
});

// --------------------------------------------------------------- no invented actions ----

describe("only actions that exist are surfaced", () => {
  it("does NOT ship suspend / resume / archive (no backing action or enforcement yet)", () => {
    for (const phantom of ["suspendTenant", "archiveTenant", "resumeTenant", "Suspendre", "Archiver"]) {
      expect(detail, phantom).not.toContain(phantom);
    }
  });

  it("surfaces only real quick actions: copy slug, copy tenant id, open rollout", () => {
    expect(detail).toContain("CopyButton");
    expect(detail).toContain("Copier le slug");
    expect(detail).toContain("Copier l'ID tenant");
  });

  it("invents no billing, storage or fabricated health metric", () => {
    for (const phantom of ["invoice", "stripe", "storageBytes", "uptime", "cpuUsage", "jobQueue"]) {
      expect(detail.toLowerCase(), phantom).not.toContain(phantom.toLowerCase());
    }
  });
});

// --------------------------------------------------------------- bounded reads ----

describe("the per-tenant reads are bounded — no N+1", () => {
  it("users read is a fixed 3 queries joined in memory", () => {
    // app_user + user_role + role, then map. No query inside a loop.
    expect(detailReads).toContain("Promise.all");
    const usersFn = detailReads.slice(detailReads.indexOf("listCompanyUsers"), detailReads.indexOf("CompanyAuditEntry"));
    expect(usersFn).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await/); // no await inside a for
  });

  it("audit read paginates in SQL with .range(), never pulling all rows", () => {
    expect(detailReads).toContain(".range(from, from + pageSize - 1)");
    expect(detailReads).toContain('count: "exact"');
  });

  it("the dashboard join is two bounded reads, not per-company", () => {
    const rowsServer = read("../lib/platform/console/rows-server.ts");
    expect(rowsServer).toContain("Promise.all([listCompanies(), getRolloutOverview()])");
    expect(rowsServer).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await/);
  });
});
