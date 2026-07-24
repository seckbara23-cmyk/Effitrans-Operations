/**
 * Phase 10.0D-1 — Executive KPI Engine. The pure layer (tenant-tz windows DEC-B39,
 * currency core DEC-B40, comparisons DEC-B41, builders + data-quality DEC-B46) is
 * exercised DIRECTLY; the reader is verified STRUCTURALLY (consume-never-own, the one
 * organization.timezone read, DEC-B36 gate, no legacy analytics, no Realtime/polling).
 * The DEC-B43 unification is pinned: THE canonical active predicate exists and every
 * former duplicate site delegates to it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TERMINAL_FILE_STATUSES, isActiveFileStatus, canCancel, FILE_STATUSES,
} from "@/lib/files/status";
import {
  DEFAULT_TIMEZONE, resolveTimezone, tenantToday, addDays, monthStart,
  previousMonthBounds, currentWindow, todayWindow, monthToDateWindow,
} from "@/lib/operations/kpi/windows";
import { groupAmountsByCurrency, flowComparison, countKpi, amountKpi } from "@/lib/operations/kpi/compose";
import { KPI_WINDOW_KEYS } from "@/lib/operations/kpi/types";
import { todayInTimezone } from "@/lib/collections/aging";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const READER = code("../lib/operations/kpi/reader.ts");
const COMPOSE = code("../lib/operations/kpi/compose.ts");
const WINDOWS = code("../lib/operations/kpi/windows.ts");
const TYPES = code("../lib/operations/kpi/types.ts");
const KPI_FILES = [READER, COMPOSE, WINDOWS, TYPES];

// ================================================================ DEC-B43: ONE active definition ====
describe("DEC-B43 — THE single active-dossier definition", () => {
  it("terminal = CLOSED + CANCELLED; everything else (DRAFT, DELIVERED included) is active", () => {
    expect([...TERMINAL_FILE_STATUSES]).toEqual(["CLOSED", "CANCELLED"]);
    for (const s of FILE_STATUSES) {
      expect(isActiveFileStatus(s), s).toBe(s !== "CLOSED" && s !== "CANCELLED");
    }
    expect(isActiveFileStatus("DRAFT")).toBe(true);
    expect(isActiveFileStatus("DELIVERED")).toBe(true);
  });
  it("cancellable ⇔ active — one terminal set, not two", () => {
    for (const s of FILE_STATUSES) expect(canCancel(s), s).toBe(isActiveFileStatus(s));
  });
  it("every former duplicate site now delegates to the canonical predicate", () => {
    for (const p of [
      "../lib/files/filter.ts",
      "../lib/files/aggregate.ts",
      "../lib/analytics/calc.ts",
      "../lib/bi/aggregate.ts",
      "../lib/control-tower/aggregate.ts",
      "../lib/control-tower/service.ts",
      "../lib/portal/progress-map.ts",
    ]) {
      expect(code(p), p).toContain("isActiveFileStatus");
    }
  });
  it("no re-derived active predicate survives in the unified sites", () => {
    // The old idioms — `status !== "CLOSED"` as an ACTIVE definition — are gone.
    expect(code("../lib/files/filter.ts")).not.toContain('status !== "CLOSED";');
    expect(code("../lib/files/aggregate.ts")).not.toContain("rows.length - byStatus.CLOSED");
    expect(code("../lib/bi/aggregate.ts")).not.toContain('f.status !== "CLOSED"');
    expect(code("../lib/control-tower/service.ts")).not.toContain('r.fileStatus !== "CLOSED" && r.fileStatus !== "DRAFT"');
    expect(code("../lib/portal/progress-map.ts")).not.toContain('f.status !== "CLOSED"');
  });
});

// ================================================================ windows (DEC-B38/B39) ====
describe("tenant-timezone windows (DEC-B39 — never UTC business logic)", () => {
  const NOW = new Date("2026-07-31T12:00:00Z");

  it("resolves a valid IANA zone and falls back to Africa/Dakar on garbage", () => {
    expect(resolveTimezone("Africa/Dakar")).toBe("Africa/Dakar");
    expect(resolveTimezone("Pacific/Kiritimati")).toBe("Pacific/Kiritimati");
    expect(resolveTimezone("Not/AZone")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone("")).toBe(DEFAULT_TIMEZONE);
  });
  it("reuses THE proven tenant-day mechanic (collections todayInTimezone) — no second clock", () => {
    expect(tenantToday("Africa/Dakar", NOW)).toBe(todayInTimezone("Africa/Dakar", NOW));
    expect(WINDOWS).toContain('from "@/lib/collections/aging"');
  });
  it("the tenant's calendar day differs from UTC where the zone does — proving tz-awareness", () => {
    // 12:00Z on Jul 31 is ALREADY Aug 1 in Kiritimati (UTC+14).
    expect(tenantToday("Africa/Dakar", NOW)).toBe("2026-07-31");
    expect(tenantToday("Pacific/Kiritimati", NOW)).toBe("2026-08-01");
  });
  it("today window = [today, tomorrow) in the tenant zone", () => {
    expect(todayWindow("Africa/Dakar", NOW)).toEqual({
      key: "today", start: "2026-07-31", end: "2026-08-01", timezone: "Africa/Dakar",
    });
    expect(todayWindow("Pacific/Kiritimati", NOW)).toEqual({
      key: "today", start: "2026-08-01", end: "2026-08-02", timezone: "Pacific/Kiritimati",
    });
  });
  it("month-to-date = [1st of tenant month, tomorrow) — the month FOLLOWS the tenant day", () => {
    expect(monthToDateWindow("Africa/Dakar", NOW)).toEqual({
      key: "month_to_date", start: "2026-07-01", end: "2026-08-01", timezone: "Africa/Dakar",
    });
    // In Kiritimati it is already August — its MTD starts Aug 1, not Jul 1.
    expect(monthToDateWindow("Pacific/Kiritimati", NOW)).toEqual({
      key: "month_to_date", start: "2026-08-01", end: "2026-08-02", timezone: "Pacific/Kiritimati",
    });
  });
  it("previous full month bounds are [prev 1st, this 1st) — incl. the year boundary", () => {
    expect(previousMonthBounds("Africa/Dakar", NOW)).toEqual({ start: "2026-06-01", end: "2026-07-01" });
    expect(previousMonthBounds("Africa/Dakar", new Date("2026-01-15T00:00:00Z"))).toEqual({
      start: "2025-12-01", end: "2026-01-01",
    });
  });
  it("date arithmetic crosses month/year edges correctly", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthStart("2026-07-31")).toBe("2026-07-01");
  });
  it("snapshots carry no date bounds and only ratified window keys exist (DEC-B38)", () => {
    expect(currentWindow("Africa/Dakar")).toEqual({ key: "current", start: null, end: null, timezone: "Africa/Dakar" });
    expect([...KPI_WINDOW_KEYS]).toEqual(["current", "today", "month_to_date"]);
  });
});

// ================================================================ currency core (DEC-B40) ====
describe("currency core — money is grouped per currency, NEVER summed across (DEC-B40)", () => {
  it("groups per currency, sorts, and never merges", () => {
    const { amounts, excluded } = groupAmountsByCurrency([
      { currency: "XOF", amount: 100 },
      { currency: "EUR", amount: 20 },
      { currency: "XOF", amount: 50 },
    ]);
    expect(amounts).toEqual([
      { currency: "EUR", amount: 20 },
      { currency: "XOF", amount: 150 },
    ]);
    expect(excluded).toBe(0);
  });
  it("drops currency-less / non-finite rows and COUNTS them (DEC-B46 basis, never silent)", () => {
    const { amounts, excluded } = groupAmountsByCurrency([
      { currency: "XOF", amount: 100 },
      { currency: null, amount: 999 },
      { currency: "  ", amount: 5 },
      { currency: "EUR", amount: Number.NaN },
      { currency: "EUR", amount: undefined },
    ]);
    expect(amounts).toEqual([{ currency: "XOF", amount: 100 }]);
    expect(excluded).toBe(4);
  });
});

// ================================================================ comparisons (DEC-B41) ====
describe("flow comparisons — prior 0/null is UNKNOWN, never ∞ or fabricated growth (DEC-B41)", () => {
  it("computes direction + rounded percent on a real prior", () => {
    expect(flowComparison(120, 100, "vs juin (mois complet)")).toEqual({
      label: "vs juin (mois complet)", value: 100, direction: "up", changePercent: 20,
    });
    expect(flowComparison(80, 100, "vs juin (mois complet)").direction).toBe("down");
    expect(flowComparison(100, 100, "vs juin (mois complet)")).toMatchObject({ direction: "flat", changePercent: 0 });
    expect(flowComparison(1, 3, "x").changePercent).toBe(-66.7);
  });
  it("prior 0 or null (or current null) ⇒ unknown + null percent", () => {
    for (const [cur, prev] of [[5, 0], [5, null], [null, 100], [null, null]] as const) {
      const c = flowComparison(cur, prev, "x");
      expect(c.direction).toBe("unknown");
      expect(c.changePercent).toBeNull();
    }
  });
});

// ================================================================ builders (DEC-B46) ====
describe("KPI builders — Missing ≠ Negative, partial on exclusions (DEC-B46)", () => {
  const w = currentWindow("Africa/Dakar");
  it("count: null value ⇒ unavailable; exclusions ⇒ partial; clean ⇒ ready", () => {
    expect(countKpi({ key: "k", label: "L", value: null, window: w, source: "s" }).status).toBe("unavailable");
    expect(countKpi({ key: "k", label: "L", value: 3, window: w, source: "s" }).status).toBe("ready");
    const partial = countKpi({ key: "k", label: "L", value: 3, window: w, source: "s", basis: { included: 3, excluded: 2 } });
    expect(partial.status).toBe("partial");
    expect(partial.basis).toEqual({ included: 3, excluded: 2 });
  });
  it("amount: value stays null by contract (no cross-currency scalar is representable)", () => {
    const k = amountKpi({ key: "m", label: "M", amounts: [{ currency: "XOF", amount: 5 }], window: w, source: "s" });
    expect(k.kind).toBe("amount");
    expect(k.value).toBeNull();
    expect(k.amounts).toEqual([{ currency: "XOF", amount: 5 }]);
    expect(k.status).toBe("ready");
    // Null amounts (source dark) ⇒ unavailable; empty list (real zero) ⇒ ready.
    expect(amountKpi({ key: "m", label: "M", amounts: null, window: w, source: "s" }).status).toBe("unavailable");
    expect(amountKpi({ key: "m", label: "M", amounts: [], window: w, source: "s" }).status).toBe("ready");
  });
  it("every KPI is traceable (source) and live-request fresh (DEC-B45)", () => {
    const k = countKpi({ key: "k", label: "L", value: 1, window: w, source: "analytics" });
    expect(k.source).toBe("analytics");
    expect(k.freshness).toBe("live-request");
  });
});

// ================================================================ structural: the reader ====
describe("KPI reader — consume-never-own, one authoritative engine (DEC-B35)", () => {
  it("is server-only, request-cached, allSettled-degraded", () => {
    expect(read("../lib/operations/kpi/reader.ts")).toContain('import "server-only"');
    expect(READER).toContain("export const getOperationsKpis = cache(async");
    expect(READER).toContain("Promise.allSettled");
  });
  it("DEC-B36 — the strip is gated analytics:read (null set, never zeroes) + finance:read for money", () => {
    expect(READER).toContain('if (!hasPermission(perms, "analytics:read")) return null');
    expect(READER).toContain('hasPermission(perms, "finance:read")');
  });
  it("touches NO business table — the only direct read is organization.timezone (DEC-B39)", () => {
    const froms = [...READER.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(froms).toEqual(["organization"]);
    expect(READER).not.toContain("scopedFrom");
    expect(READER).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
  it("composes ONLY authoritative readers — no re-derived business formula", () => {
    for (const dep of ["getAnalytics", "getControlTower", "getIntelligenceDashboard", "getFinanceRequestQueue"]) {
      expect(READER).toContain(dep);
    }
    // No invoice/payment/customs/file table math in the engine.
    for (const banned of ["invoiceTotals", "balanceDue", "invoice_line", "file_state_transition"]) {
      expect(READER).not.toContain(banned);
    }
  });
  it("ships the ratified 10.0D-1 set incl. the CEO attention KPI over the ONE risk engine", () => {
    for (const key of ["dossiers_actifs", "dossiers_intervention", "douane_en_cours", "demandes_finance"]) {
      expect(READER).toContain(`"${key}"`);
    }
    expect(READER).toContain("riskKpis.critical + ct.riskKpis.high");
    expect(READER).toContain("Dossiers nécessitant une intervention");
  });
  it("doctrine: no Realtime, no polling, no Copilot, no legacy analytics, no new permission", () => {
    for (const src of KPI_FILES) {
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes|setInterval/);
      expect(src).not.toContain("getExecutiveAnalytics");
      expect(src).not.toContain("copilot");
      expect(src).not.toContain('"use server"');
      expect(src).not.toContain("revalidatePath");
    }
    expect(READER).not.toMatch(/operations:kpi|kpi:read/); // no invented permission
  });
  it("the pure layers have no I/O", () => {
    for (const src of [COMPOSE, WINDOWS, TYPES]) {
      expect(src).not.toContain("supabase");
      expect(src).not.toContain("server-only");
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });
});
