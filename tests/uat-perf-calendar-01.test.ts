/**
 * UAT-PERF-CALENDAR-01 — the calendar is as readable as what it explains.
 * ---------------------------------------------------------------------------
 * The finding: two authorized users in one tenant resolved different calendar
 * VIEWS. The read was gated on hr:read alone while the page's own comment
 * promised performance:read — and nothing pinned the two together, so they
 * drifted in silence for a whole slice.
 *
 * So the parity itself is now a test. Three statements of one rule — the page
 * gate, the action gate, and the RLS policy (migration 134) — are asserted
 * against each other here; changing any one alone turns this file red.
 *
 * What did NOT change, and is pinned so it stays that way: management is
 * hr:manage, no Performance role gains hr:*, and the calculation engine reads
 * the calendar with a server-resolved tenant and no viewer context — which is
 * why this was display-only rather than a calculation-integrity incident.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260926000001_calendar_read_parity.sql";
const m = strip(read(MIGRATION));
const actions = strip(read("lib/hr/calendar-actions.ts"));
const page = strip(read("app/performance/calendrier/page.tsx"));
const perfRead = strip(read("lib/performance/read.ts"));
const sqlSuite = read("supabase/tests/hr_calendar_day_test.sql");

const listFn = (() => {
  const i = actions.indexOf("export async function listCalendarDays");
  expect(i).toBeGreaterThan(-1);
  const rest = actions.slice(i);
  return rest.slice(0, rest.indexOf("export async function", 10));
})();

// ═══════════════ the read lane, stated identically in three places ═════════

describe("UAT-PERF-CALENDAR-01 — read = hr:read OR performance:read", () => {
  it("the server action accepts either capability", () => {
    expect(listFn).toContain('assertPermission("hr:read")');
    expect(listFn).toContain('assertPermission("performance:read")');
    // Neither alone is required, and with neither the contract is unchanged.
    expect(listFn).toContain("return [];");
  });

  it("the page gate states the same rule", () => {
    expect(page).toContain('hasPermission(permissions, "hr:read") || hasPermission(permissions, "performance:read")');
  });

  it("the RLS policy states the same rule, tenant-scoped", () => {
    expect(m).toContain("create policy hr_calendar_day_select on public.hr_calendar_day");
    expect(m).toContain("tenant_id = public.auth_tenant_id()");
    expect(m).toContain("public.has_permission('hr:read') or public.has_permission('performance:read')");
  });

  it("PARITY — page gate, action gate and policy name the SAME two capabilities", () => {
    // This is the test whose absence let the comment and the code disagree.
    const caps = (src: string) =>
      [...new Set([...src.matchAll(/(hr:read|performance:read)/g)].map((x) => x[1]))].sort();
    const pageGate = page.slice(page.indexOf("const canRead"), page.indexOf("const sp ="));
    expect(caps(pageGate)).toEqual(["hr:read", "performance:read"]);
    expect(caps(listFn)).toEqual(["hr:read", "performance:read"]);
    const policy = m.slice(m.indexOf("create policy"), m.indexOf(";", m.indexOf("create policy")));
    expect(caps(policy)).toEqual(["hr:read", "performance:read"]);
  });

  it("the empty-state notice names both lanes — it told Fary the wrong rule before", () => {
    const raw = read("app/performance/calendrier/page.tsx");
    expect(raw).toContain("performance:read");
    expect(raw).toContain("hr:read");
  });
});

// ═══════════════ management is untouched ═══════════════════════════════════

describe("UAT-PERF-CALENDAR-01 — reading is not managing", () => {
  it("add and remove still require hr:manage, and only that", () => {
    for (const name of ["addCalendarDay", "removeCalendarDay"]) {
      const i = actions.indexOf(`export async function ${name}`);
      expect(i, name).toBeGreaterThan(-1);
      const rest = actions.slice(i);
      const body = rest.slice(0, rest.indexOf("export async function", 10));
      expect(body, name).toContain('assertPermission("hr:manage")');
      expect(body, `${name} must not accept a performance capability`).not.toContain("performance:");
    }
  });

  it("the page still gates its controls on hr:manage", () => {
    expect(page).toContain('hasPermission(permissions, "hr:manage")');
    expect(page).toContain("canManage={canManage}");
  });

  it("the migration adds NO write policy and grants nothing", () => {
    expect(m).not.toMatch(/for\s+(insert|update|delete)/i);
    expect(m).not.toMatch(/\binsert\s+into\s+public\.(role_permission|permission)\b/i);
    expect(m).not.toMatch(/^\s*grant\s/im);
    expect(m).toContain("expected exactly 1 select policy and 0 write policies");
  });

  it("no Performance role was given hr:* — the fix widened a policy, not authority", () => {
    const templates = read("lib/platform/role-templates.ts");
    for (const key of ["PERFORMANCE_MANAGEMENT", "PERFORMANCE_PUBLISHER"]) {
      const i = templates.indexOf(`key: "${key}"`);
      expect(i, key).toBeGreaterThan(-1);
      const block = templates.slice(i, templates.indexOf("},", templates.indexOf("permissions: [", i)));
      expect(block, `${key} must not hold hr:*`).not.toMatch(/"hr:[a-z:]+"/);
    }
    expect(read("supabase/seed.sql")).not.toMatch(/'hr:read'[\s\S]{0,200}PERFORMANCE_/);
  });

  it("no SYSTEM_ADMIN bypass appeared anywhere in the path", () => {
    for (const src of [actions, page, m]) {
      expect(src).not.toContain("SYSTEM_ADMIN");
    }
  });
});

// ═══════════════ calculation integrity stays viewer-independent ════════════

describe("UAT-PERF-CALENDAR-01 — the engine never reads through a viewer", () => {
  it("loadCalendar takes a server-resolved tenant and no permission context", () => {
    const i = perfRead.indexOf("export async function loadCalendar");
    expect(i).toBeGreaterThan(-1);
    const body = perfRead.slice(i, perfRead.indexOf("\n}\n", i));
    expect(body).toContain("loadCalendar(tenantId: string");
    expect(body).toContain('.eq("tenant_id", tenantId)');
    for (const forbidden of ["assertPermission", "auth.uid", "getCurrentUser", "requireUser", "hasPermission"]) {
      expect(body, `${forbidden} must never reach the calculation calendar read`).not.toContain(forbidden);
    }
  });

  it("it is not routed through the user-facing read service", () => {
    const i = perfRead.indexOf("export async function loadCalendar");
    const body = perfRead.slice(i, perfRead.indexOf("\n}\n", i));
    expect(body).not.toContain("listCalendarDays");
  });
});

// ═══════════════ the SQL suite proves the behaviour, and CI runs it ════════

describe("UAT-PERF-CALENDAR-01 — real-Postgres coverage exists", () => {
  it("the Performance lane and same-tenant parity are asserted", () => {
    expect(sqlSuite).toContain("performance_reader_sees_calendar");
    expect(sqlSuite).toContain("performance_manager_sees_calendar");
    expect(sqlSuite).toContain("two_authorized_readers_identical_facts");
    // Parity compares the DAYS, not merely the row count.
    expect(sqlSuite).toContain("d3.perf_mgr_days");
    expect(sqlSuite).toContain("the calendar became viewer-dependent");
  });

  it("both lanes are proven tenant-isolated", () => {
    expect(sqlSuite).toContain("cross_tenant_calendar_invisible");
    expect(sqlSuite).toContain("cross_tenant_invisible_to_performance");
  });

  it("the read widening is proven to grant no management authority", () => {
    expect(sqlSuite).toContain("read_widening_added_no_write_policy");
    expect(sqlSuite).toContain("performance_roles_hold_no_hr");
  });

  it("a check that quietly records 0 fails the suite", () => {
    expect(sqlSuite).toContain("from _r where value <> 1");
  });

  it("CI runs it, before the journey harness", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/hr_calendar_day_test.sql");
    expect(ci.indexOf("hr_calendar_day_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });
});
