/**
 * Phase 10.0B — Centre d'Opérations composition layer. The pure layer (workload rollups,
 * finance-request pipeline aggregation, attention→alert projection, indicators) is exercised
 * DIRECTLY; the server-only readers are verified STRUCTURALLY (consume-never-own: composition
 * only, no direct table read in the composer, read-only aggregations, flag + permission gates,
 * DEC-B29..B34 doctrine pins, request-level cache() on the three shared heavy readers).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  countByKey, rollupQueueDepths, toTeamWorkload, toUserWorkload,
  isActionableFinanceRequest, financeRequestQueueSummary,
  projectAttentionAlerts, taskKpis, reconciliationIndicators,
  type FinanceRequestRowLike,
} from "@/lib/operations/compose";
import { COCKPIT_SECTIONS } from "@/lib/operations/types";
import { TRANSIT_TEAMS, QUEUE_DEPARTMENT_TO_CANONICAL } from "@/lib/organization/departments";
import { QUEUES } from "@/lib/process/queues/registry";
import type { UnifiedAlert } from "@/lib/logistics/compose";
import type { DashboardTasks } from "@/lib/tasks/types";
import type { ReconciliationData } from "@/lib/finance/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const freq = (over: Partial<FinanceRequestRowLike> = {}): FinanceRequestRowLike => ({
  id: "r1", fileId: "f1", status: "REQUESTED", evidenceStatus: "NONE",
  amount: 100_000, currency: "XOF", requestedAt: "2026-07-20T08:00:00Z", ...over,
});

// ---------------------------------------------------------------- pure: counting + workload ----
describe("countByKey drops unassigned rows and counts the rest", () => {
  it("null/empty keys are not a bucket", () => {
    const m = countByKey([{ key: "a" }, { key: "a" }, { key: null }, { key: "" }, { key: "b" }]);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
    expect(m.size).toBe(2);
  });
});

describe("rollupQueueDepths — engine queues → canonical departments (display metadata only)", () => {
  it("rolls the 15-queue counts up via QUEUE_DEPARTMENT_TO_CANONICAL and sorts by open desc", () => {
    const { byDepartment, byQueue } = rollupQueueDepths({ operations: 3, transit: 2, billing: 1, coordination: 4 });
    expect(byDepartment.map((d) => d.key)).toEqual(["OPERATIONS", "TRANSIT", "FINANCE"]);
    expect(byDepartment[0].open).toBe(7); // operations 3 + coordination 4
    expect(byDepartment[1].open).toBe(2);
    expect(byDepartment[2].open).toBe(1);
    expect(byQueue.map((q) => q.key)).toEqual(["coordination", "operations", "transit", "billing"]);
  });
  it("an unknown queue key stays visible in byQueue (raw key) but never fabricates a department", () => {
    const { byDepartment, byQueue } = rollupQueueDepths({ mystery_queue: 5 });
    expect(byDepartment).toEqual([]);
    expect(byQueue).toEqual([{ key: "mystery_queue", labelFr: "mystery_queue", open: 5 }]);
  });
  it("queue labels come from the official queue registry", () => {
    const { byQueue } = rollupQueueDepths({ operations: 1 });
    const def = QUEUES.find((q) => q.key === "operations")!;
    expect(byQueue[0].labelFr).toBe(def.labelFr);
  });
  it("every mapped canonical department is a real registry code", () => {
    for (const dept of Object.values(QUEUE_DEPARTMENT_TO_CANONICAL)) {
      expect(["OPERATIONS", "TRANSIT", "FINANCE", "HUMAN_RESOURCES"]).toContain(dept);
    }
  });
});

describe("team + user workload projections (DEC-B30: coordination data, bounded, honest labels)", () => {
  it("labels known teams from TRANSIT_TEAMS and keeps unknown codes raw — never dropped", () => {
    const rows = toTeamWorkload(new Map([["AIBD", 2], ["MARITIME", 5], ["X9", 1]]));
    const label = (c: string) => TRANSIT_TEAMS.find((t) => t.code === c)?.labelFr ?? c;
    expect(rows.map((r) => r.key)).toEqual(["MARITIME", "AIBD", "X9"]);
    expect(rows[0].labelFr).toBe(label("MARITIME"));
    expect(rows[2].labelFr).toBe("X9");
  });
  it("sorts users by open work desc, resolves names, caps the list and never renders a UUID", () => {
    const counts = new Map(Array.from({ length: 20 }, (_, i) => [`u${i}`, i + 1] as const));
    const names = new Map([["u19", "Ahmed"], ["u18", "Fatou"]]);
    const rows = toUserWorkload(counts, names);
    expect(rows).toHaveLength(15); // bounded
    expect(rows[0]).toEqual({ userId: "u19", displayName: "Ahmed", open: 20 });
    expect(rows[1]).toEqual({ userId: "u18", displayName: "Fatou", open: 19 });
    expect(rows[2].displayName).toBe("Utilisateur inconnu"); // no name resolved — still not a UUID
  });
});

// ---------------------------------------------------------------- pure: finance requests ----
describe("finance-request pipeline aggregation (approval ≠ payment; statuses come from lib/finance)", () => {
  it("actionable = REQUESTED / APPROVED / RETURNED / DISBURSED-until-evidence-VERIFIED", () => {
    expect(isActionableFinanceRequest({ status: "REQUESTED", evidenceStatus: "NONE" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "APPROVED", evidenceStatus: "NONE" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "RETURNED", evidenceStatus: "NONE" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "DISBURSED", evidenceStatus: "NONE" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "DISBURSED", evidenceStatus: "SUBMITTED" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "DISBURSED", evidenceStatus: "REJECTED" })).toBe(true);
    expect(isActionableFinanceRequest({ status: "DISBURSED", evidenceStatus: "VERIFIED" })).toBe(false);
    expect(isActionableFinanceRequest({ status: "REJECTED", evidenceStatus: "NONE" })).toBe(false);
    expect(isActionableFinanceRequest({ status: "CANCELLED", evidenceStatus: "NONE" })).toBe(false);
  });
  it("buckets by lifecycle stage and ignores settled requests entirely", () => {
    const s = financeRequestQueueSummary([
      freq(),
      freq({ id: "r2", status: "APPROVED" }),
      freq({ id: "r3", status: "RETURNED" }),
      freq({ id: "r4", status: "DISBURSED", evidenceStatus: "NONE" }),
      freq({ id: "r5", status: "DISBURSED", evidenceStatus: "SUBMITTED" }),
      freq({ id: "r6", status: "DISBURSED", evidenceStatus: "VERIFIED" }), // settled — invisible
    ]);
    expect(s.pendingReview).toBe(1);
    expect(s.approvedNotDisbursed).toBe(1);
    expect(s.returned).toBe(1);
    expect(s.evidenceMissing).toBe(1);
    expect(s.evidenceToVerify).toBe(1);
  });
  it("sums pending amounts PER CURRENCY over REQUESTED+APPROVED only — never across currencies", () => {
    const s = financeRequestQueueSummary([
      freq({ amount: 100, currency: "XOF" }),
      freq({ id: "r2", status: "APPROVED", amount: 50, currency: "XOF" }),
      freq({ id: "r3", status: "APPROVED", amount: 20, currency: "EUR" }),
      freq({ id: "r4", status: "RETURNED", amount: 999, currency: "XOF" }), // not pending money
      freq({ id: "r5", status: "DISBURSED", evidenceStatus: "NONE", amount: 999, currency: "XOF" }),
    ]);
    expect(s.pendingAmounts).toEqual([
      { currency: "EUR", amount: 20 },
      { currency: "XOF", amount: 150 },
    ]);
  });
  it("oldestRequestedAt tracks actionable requests only", () => {
    const s = financeRequestQueueSummary([
      freq({ requestedAt: "2026-07-01T00:00:00Z", status: "CANCELLED" }),
      freq({ id: "r2", requestedAt: "2026-07-10T00:00:00Z" }),
      freq({ id: "r3", requestedAt: "2026-07-05T00:00:00Z", status: "APPROVED" }),
    ]);
    expect(s.oldestRequestedAt).toBe("2026-07-05T00:00:00Z");
  });
  it("an empty pipeline is all-zero with no fabricated oldest", () => {
    const s = financeRequestQueueSummary([]);
    expect(s.pendingReview + s.approvedNotDisbursed + s.returned + s.evidenceMissing + s.evidenceToVerify).toBe(0);
    expect(s.pendingAmounts).toEqual([]);
    expect(s.oldestRequestedAt).toBeNull();
  });
});

// ---------------------------------------------------------------- pure: projections ----
describe("attention → ExecutiveAlert projection reuses the executive normalization (never re-scored)", () => {
  it("maps the Command Center vocabulary through the ONE severity table and keeps the audit trail", () => {
    const attention: UnifiedAlert[] = [
      { mode: "road", severity: "warning", reference: "F-1", clientName: "ACME", reason: "Livraison routière en retard", link: "/files/f1", occurredAt: "2026-07-20T08:00:00Z" },
      { mode: "customs", severity: "critical", reference: "F-2", clientName: null, reason: "Déclaration bloquée", link: "/files/f2" },
      { mode: "ocean", severity: "info", reference: "F-3", clientName: null, reason: "Suivi ancien", link: "/shipping" },
    ];
    const alerts = projectAttentionAlerts(attention);
    expect(alerts.map((a) => a.level)).toEqual(["high", "critical", "medium"]);
    expect(alerts[0].sourceSeverity).toBe("warning");
    expect(alerts[0].origin).toBe("road");
    expect(alerts[0].href).toBe("/files/f1");
    expect(alerts[1].occurredAt).toBeNull();
  });
});

describe("scalar indicators", () => {
  it("taskKpis projects list lengths and passes null through (Missing ≠ Negative)", () => {
    expect(taskKpis(null)).toBeNull();
    const tasks = { today: [{}, {}], overdue: [{}], mine: [{}, {}, {}] } as unknown as DashboardTasks;
    expect(taskKpis(tasks)).toEqual({ dueToday: 2, overdue: 1, mine: 3 });
  });
  it("reconciliationIndicators counts FAILED/EXPIRED intents only — pending online flows are not alerts", () => {
    expect(reconciliationIndicators(null)).toBeNull();
    const recon = {
      counts: { pending: 4, verified: 9, rejected: 1, missingReference: 2 },
      onlineIntents: [{ status: "FAILED" }, { status: "EXPIRED" }, { status: "PENDING" }, { status: "CREATED" }],
    } as unknown as ReconciliationData;
    expect(reconciliationIndicators(recon)).toEqual({ pending: 4, missingReference: 2, failedIntents: 2 });
  });
});

describe("cockpit sections registry", () => {
  it("declares the seven ratified sections exactly (phase-10.0a §17)", () => {
    expect([...COCKPIT_SECTIONS]).toEqual(["operations", "transit", "finance", "messaging", "alerts", "kpis", "workload"]);
  });
});

// ================================================================ structural ====

const READER = code("../lib/operations/reader.ts");
const COMPOSE = code("../lib/operations/compose.ts");
const WORKLOAD = code("../lib/operations/workload.ts");
const FINREQ = code("../lib/operations/finance-requests.ts");
const TYPES = code("../lib/operations/types.ts");
const ALL = [READER, COMPOSE, WORKLOAD, FINREQ, TYPES];

describe("consume, never own — the composition layer owns no state and mutates nothing", () => {
  it("no lib/operations file writes, revalidates or declares a server action", () => {
    for (const src of ALL) {
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      expect(src).not.toContain("revalidatePath");
      expect(src).not.toContain('"use server"');
    }
  });
  it("the composer performs NO table read of its own — no supabase client, no .from()", () => {
    expect(READER).not.toContain("getAdminSupabaseClient");
    expect(READER).not.toContain("scopedFrom");
    expect(READER).not.toMatch(/\.from\(/);
  });
  it("the pure layer has no I/O and no server-only import", () => {
    expect(COMPOSE).not.toContain("supabase");
    expect(COMPOSE).not.toContain("server-only");
    expect(COMPOSE).not.toMatch(/\bfetch\(/);
  });
  it("types.ts imports are type-only (importable from pure tests)", () => {
    const imports = TYPES.split("\n").filter((l) => l.trimStart().startsWith("import "));
    for (const line of imports) expect(line).toContain("import type");
  });
  it("DEC-B33 — the quarantined legacy executive-analytics stack is never consumed", () => {
    for (const src of ALL) {
      expect(src).not.toContain("getExecutiveAnalytics");
      expect(src).not.toContain("analytics/executive-service");
    }
  });
  it("DEC-B31 — no Realtime, no polling in the composition layer", () => {
    for (const src of ALL) {
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes|setInterval/);
    }
  });
});

describe("composition reader — executive pattern (cache + allSettled + per-section gates)", () => {
  it("is request-cached and degrades by section under Promise.allSettled", () => {
    expect(READER).toContain("export const getOperationsCockpit = cache(async");
    expect(READER).toContain("Promise.allSettled");
  });
  it("has NO top-level permission gate (the cockpit is the ungated landing page) — requireUser only", () => {
    expect(READER).toContain("requireUser()");
    expect(READER).not.toContain("assertPermission");
  });
  it("gates every section BEFORE its read — zero queries for a section the viewer cannot see", () => {
    for (const gate of ['"finance:read"', '"transport:read"', '"analytics:read"', '"process:read"', '"collections:manage"']) {
      expect(READER).toContain(`hasPermission(perms, ${gate})`);
    }
  });
  it("composes the ratified reader set and the two new aggregations", () => {
    for (const dep of [
      "getFileOverview", "getDashboardTasks", "getProcessTower", "getQueueCounts",
      "getCommandCenter", "getControlTower", "getFinanceKpis", "getReconciliation",
      "getFinanceMonthRevenue", "getCollectionsQueue", "getMessagingDashboardSummary",
      "unreadStaffMessagingCount", "getFinanceRequestQueue", "getWorkloadByTeam", "getWorkloadByUser",
    ]) expect(READER).toContain(dep);
  });
  it("reuses the executive alert engine — never a second merge or severity table", () => {
    expect(READER).toContain("mergeExecutiveAlerts");
    expect(READER).toContain("countAlertsByLevel");
    expect(COMPOSE).toContain("normalizeSeverity");
    expect(COMPOSE).not.toContain("SEVERITY_MAP = {"); // no second table
  });
  it("engine surfaces are dark-by-default: kill switch + tenant flag gate the queue depths", () => {
    expect(READER).toContain("globalKillSwitch().workspaces");
    expect(READER).toMatch(/flags\?\.enabled === true && flags\?\.workspaces === true/);
  });
});

describe("new aggregation readers — read-only, tenant-scoped, flag-gated", () => {
  it("workload readers are server-only, tenant-scoped and bounded over OPEN engine work", () => {
    expect(WORKLOAD).toContain('import "server-only"');
    expect(WORKLOAD).toContain('scopedFrom(admin, "process_step_execution", tenantId)');
    expect(WORKLOAD).toContain("OPEN_STATES");
    expect(WORKLOAD).toMatch(/limit\(OPEN_EXECUTION_CAP\)/);
  });
  it("DEC-B30 — named per-person workload sits behind the existing supervision boundary", () => {
    expect(WORKLOAD).toContain('hasPermission(permissions, "analytics:read")');
    expect(WORKLOAD).not.toMatch(/operations:workload|workload:read/); // NO new permission
  });
  it("workload respects engine darkness (kill switch + tenant flags) and degrades on absent tables", () => {
    expect(WORKLOAD).toContain("globalKillSwitch()");
    expect(WORKLOAD).toContain("getTenantProcessFlags");
    expect(WORKLOAD).toMatch(/if \(error\) return null/);
  });
  it("finance-request queue mirrors its sibling getFinanceQueue: finance:read + financeExecution + degrade", () => {
    expect(FINREQ).toContain('import "server-only"');
    expect(FINREQ).toContain('assertPermission("finance:read")');
    expect(FINREQ).toContain("financeExecution");
    expect(FINREQ).toContain('scopedFrom(admin, "finance_request", user.tenantId)');
    expect(FINREQ).toMatch(/if \(error\) return null/);
    expect(FINREQ).toMatch(/limit\(REQUEST_CAP\)/);
  });
});

describe("request-level cache() backfill on the three shared heavy readers (phase-10.0a §28)", () => {
  it("getControlTower, getCommandCenter and getBusinessIntelligence are cache()-wrapped", () => {
    expect(code("../lib/control-tower/service.ts")).toContain("export const getControlTower = cache(async");
    expect(code("../lib/logistics/reader.ts")).toContain("export const getCommandCenter = cache(async");
    expect(code("../lib/bi/service.ts")).toContain("export const getBusinessIntelligence = cache(async");
  });
});
