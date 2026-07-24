/**
 * Phase 10.0E-1 — Unified Alert Center composition layer. The pure layer (code
 * vocabulary, code-aware dedupe, ordering, counts, set assembly) is exercised
 * DIRECTLY; the reader + adapter interface are verified STRUCTURALLY (consume-never-own,
 * cache()+allSettled, zero adapters, no business query, no second severity table,
 * no duplicate normalizer/ordering, no mutations/Realtime/legacy analytics).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ALERT_CODES, ALERT_CODE_PATTERN, isAlertCode, FINANCE_ALERT_CODES,
} from "@/lib/operations/alerts/codes";
import {
  ALERT_DOMAINS, ALERT_ENTITY_TYPES, type OperationalAlert,
} from "@/lib/operations/alerts/types";
import {
  alertDedupeKey, dedupeAlerts, orderAlerts, composeAlertSet, emptyAlertSet,
} from "@/lib/operations/alerts/compose";
import { ALERT_LEVELS } from "@/lib/executive/types";
import type { ExecutiveAlert } from "@/lib/executive/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const READER = code("../lib/operations/alerts/reader.ts");
const COMPOSE = code("../lib/operations/alerts/compose.ts");
const TYPES = code("../lib/operations/alerts/types.ts");
const CODES = code("../lib/operations/alerts/codes.ts");
const ALL = [READER, COMPOSE, TYPES, CODES];

const alert = (over: Partial<OperationalAlert> = {}): OperationalAlert => ({
  level: "high", origin: "risk", reference: "F-1", clientName: "ACME",
  reason: "Un document requis est manquant.", href: "/files/f1",
  occurredAt: "2026-07-20T08:00:00Z", sourceSeverity: "high",
  domain: "operations", ...over,
});

// ================================================================ contract shape ====
describe("OperationalAlert is an additive structural extension of ExecutiveAlert", () => {
  it("an OperationalAlert is assignable to ExecutiveAlert (supertype — executive dashboard can consume it)", () => {
    const op: OperationalAlert = alert({ code: "operations.dossier.risk_high", entityType: "dossier", entityId: "f1" });
    const exec: ExecutiveAlert = op; // must compile: OperationalAlert ⊇ ExecutiveAlert
    expect(exec.level).toBe("high");
    expect(exec.href).toBe("/files/f1");
  });
  it("code / entityType / entityId are OPTIONAL (rollout-safe)", () => {
    const bare = alert();
    expect(bare.code).toBeUndefined();
    expect(bare.entityType).toBeUndefined();
    expect(bare.entityId).toBeUndefined();
  });
  it("domains and entity types are the approved sets — no aliases", () => {
    expect([...ALERT_DOMAINS]).toEqual(["operations", "customs", "transport", "shipping", "air", "finance", "documents", "messaging", "system"]);
    expect(ALERT_ENTITY_TYPES).toContain("finance_request");
  });
});

// ================================================================ code model ====
describe("stable code model — domain.entity.condition, unique, approved-only", () => {
  it("every code matches the pattern and is unique", () => {
    for (const c of ALERT_CODES) expect(c, c).toMatch(ALERT_CODE_PATTERN);
    expect(new Set(ALERT_CODES).size).toBe(ALERT_CODES.length);
  });
  it("codes carry no translated text / ids / uppercase", () => {
    for (const c of ALERT_CODES) {
      expect(c).toBe(c.toLowerCase());
      expect(c).not.toMatch(/[0-9]/);
    }
  });
  it("only the approved initial vocabulary is present (no fabricated future codes)", () => {
    expect(ALERT_CODES).toContain("operations.dossier.risk_critical");
    expect(ALERT_CODES).toContain("finance.reconciliation.missing_reference");
    expect(FINANCE_ALERT_CODES).toContain("finance.receivable.overdue");
    // Documents codes exist but are the only E-2-later members named.
    expect(ALERT_CODES).toContain("documents.document.expired");
    // A plausible-but-unratified code is absent.
    expect(isAlertCode("operations.dossier.stale")).toBe(false);
  });
  it("isAlertCode narrows correctly", () => {
    expect(isAlertCode("customs.declaration.blocked")).toBe(true);
    expect(isAlertCode("not.a.code.here")).toBe(false);
  });
});

// ================================================================ dedupe (DEC-B52) ====
describe("code-aware deduplication", () => {
  it("keys by code|entityType|entityId when a code exists", () => {
    expect(alertDedupeKey(alert({ code: "transport.delivery.overdue", entityType: "transport", entityId: "t9" })))
      .toBe("transport.delivery.overdue|transport|t9");
  });
  it("count-style alerts (code, no entity) dedupe by code alone", () => {
    const a = alert({ code: "finance.reconciliation.pending", reference: null, reason: "3 paiements à vérifier" });
    const b = alert({ code: "finance.reconciliation.pending", reference: null, reason: "5 paiements à vérifier" });
    expect(alertDedupeKey(a)).toBe(alertDedupeKey(b));
    expect(dedupeAlerts([a, b])).toHaveLength(1);
  });
  it("falls back to origin|reference|reason ONLY when no code (never French-text-only once a code exists)", () => {
    expect(alertDedupeKey(alert({ reference: "F-2", reason: "X" }))).toBe("risk|F-2|X");
    // Two codeless alerts with same origin+ref+reason merge; differing reason stays distinct.
    expect(dedupeAlerts([alert({ code: undefined }), alert({ code: undefined })])).toHaveLength(1);
    expect(dedupeAlerts([alert({ reason: "A" }), alert({ reason: "B" })])).toHaveLength(2);
  });
  it("distinct codes for the same dossier SURVIVE (different lenses, DEC-B52)", () => {
    const risk = alert({ code: "operations.dossier.risk_high", entityType: "dossier", entityId: "f1" });
    const road = alert({ code: "transport.delivery.overdue", entityType: "dossier", entityId: "f1", origin: "road" });
    expect(dedupeAlerts([risk, road])).toHaveLength(2);
  });
  it("on collision: highest severity wins, earliest timestamp is kept, no description merge", () => {
    const hi = alert({ code: "customs.declaration.blocked", entityType: "dossier", entityId: "f1", level: "high", occurredAt: "2026-07-20T00:00:00Z", reason: "HIGH reason" });
    const crit = alert({ code: "customs.declaration.blocked", entityType: "dossier", entityId: "f1", level: "critical", occurredAt: "2026-07-22T00:00:00Z", reason: "CRIT reason" });
    const [survivor] = dedupeAlerts([hi, crit]);
    expect(survivor.level).toBe("critical"); // highest severity wins the item
    expect(survivor.reason).toBe("CRIT reason"); // survivor's own reason — no merge
    expect(survivor.occurredAt).toBe("2026-07-20T00:00:00Z"); // earliest timestamp kept
  });
});

// ================================================================ ordering (DEC-B50/§6) ====
describe("ordering reuses the executive doctrine — severity → oldest → domain", () => {
  it("orders by severity (critical first) then oldest within a level then domain", () => {
    const ordered = orderAlerts([
      alert({ level: "low", occurredAt: "2026-01-01T00:00:00Z", domain: "finance" }),
      alert({ level: "critical", occurredAt: "2026-07-02T00:00:00Z", domain: "customs" }),
      alert({ level: "critical", occurredAt: "2026-07-01T00:00:00Z", domain: "transport" }),
    ]);
    expect(ordered.map((a) => [a.level, a.occurredAt?.slice(0, 10)])).toEqual([
      ["critical", "2026-07-01"], ["critical", "2026-07-02"], ["low", "2026-01-01"],
    ]);
  });
  it("domain is the FINAL tie-break (equal severity + timestamp) — operations before finance", () => {
    const ordered = orderAlerts([
      alert({ level: "high", occurredAt: "2026-07-01T00:00:00Z", domain: "finance" }),
      alert({ level: "high", occurredAt: "2026-07-01T00:00:00Z", domain: "operations" }),
    ]);
    expect(ordered.map((a) => a.domain)).toEqual(["operations", "finance"]);
  });
  it("a null timestamp sorts after dated peers within its level", () => {
    const ordered = orderAlerts([
      alert({ level: "high", occurredAt: null, domain: "operations", reason: "undated" }),
      alert({ level: "high", occurredAt: "2026-07-01T00:00:00Z", domain: "operations", reason: "dated" }),
    ]);
    expect(ordered.map((a) => a.reason)).toEqual(["dated", "undated"]);
  });
  it("the level rank is derived from the shared ALERT_LEVELS list (no second severity table)", () => {
    expect([...ALERT_LEVELS]).toEqual(["critical", "high", "medium", "low"]);
    expect(COMPOSE).toContain("ALERT_LEVELS.indexOf");
    expect(COMPOSE).not.toContain("LEVEL_RANK ="); // no local rank table
    expect(COMPOSE).not.toContain("SEVERITY_MAP"); // no second normalizer/table
  });
});

// ================================================================ set assembly + counts + sources ====
describe("composeAlertSet — dedupe → order → cap → counts + sources", () => {
  it("assembles a valid set with counts from the shared countAlertsByLevel", () => {
    const set = composeAlertSet(
      [alert({ level: "critical" }), alert({ level: "high", reason: "R2" }), alert({ level: "high", reason: "R3" })],
      [{ key: "risk", status: "ok" }],
      "2026-07-24T10:00:00Z",
    );
    expect(set.generatedAt).toBe("2026-07-24T10:00:00Z");
    expect(set.counts).toEqual({ critical: 1, high: 2, medium: 0, low: 0 });
    expect(set.sources).toEqual([{ key: "risk", status: "ok" }]);
  });
  it("caps the merged list", () => {
    const many = Array.from({ length: 60 }, (_, i) => alert({ reason: `R${i}`, code: undefined }));
    expect(composeAlertSet(many, [], "t", 40).alerts).toHaveLength(40);
  });
  it("the empty set is truthful: no alerts, all-zero counts, no sources", () => {
    const empty = emptyAlertSet("2026-07-24T10:00:00Z");
    expect(empty.alerts).toEqual([]);
    expect(empty.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(empty.sources).toEqual([]);
  });
  it("source statuses distinguish ok / unavailable / omitted (DEC-B58) — never « 0 alertes »", () => {
    const set = composeAlertSet([], [
      { key: "risk", status: "ok" },
      { key: "finance", status: "unavailable" },
      { key: "customs", status: "omitted" },
    ], "t");
    expect(set.alerts).toEqual([]); // zero alerts, but the sources tell the honest story
    expect(set.sources.map((s) => s.status)).toEqual(["ok", "unavailable", "omitted"]);
  });
});

// ================================================================ structural: reader + doctrine ====
describe("reader — consume-never-own, cache()+allSettled, ZERO adapters (10.0E-1)", () => {
  it("is server-only, request-cached, allSettled-degraded, permission-shaped", () => {
    expect(read("../lib/operations/alerts/reader.ts")).toContain('import "server-only"');
    expect(READER).toContain("export const getOperationalAlerts = cache(async");
    expect(READER).toContain("Promise.allSettled");
    expect(READER).toContain("getEffectivePermissions");
  });
  it("consumes the ALERT_ADAPTERS registry via injection (architecture unchanged; E-2 populated it)", () => {
    expect(READER).toContain("const ADAPTERS = ALERT_ADAPTERS");
    expect(READER).toContain('from "./adapters"');
  });
  it("has NO business query of its own (no supabase client, no .from()) and no top-level gate", () => {
    expect(READER).not.toContain("getAdminSupabaseClient");
    expect(READER).not.toContain("scopedFrom");
    expect(READER).not.toMatch(/\.from\(/);
    expect(READER).not.toContain("assertPermission"); // DEC-B49: no blanket gate
  });
  it("the adapter interface is a pure contract (available? gate + load)", () => {
    expect(TYPES).toContain("export type OperationalAlertAdapter");
    expect(TYPES).toContain("available?(ctx: AlertAdapterContext): boolean");
    expect(TYPES).toContain("load(ctx: AlertAdapterContext): Promise<OperationalAlert[]>");
  });
});

describe("structural guarantees (DEC doctrine)", () => {
  it("no mutations, no server action, no revalidate anywhere in the layer", () => {
    for (const src of ALL) {
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toContain("revalidatePath");
    }
  });
  it("reuses the executive engine — no duplicate normalizeSeverity, no second severity table", () => {
    expect(COMPOSE).toContain("countAlertsByLevel"); // reused, not reimplemented
    for (const src of ALL) {
      expect(src).not.toContain("function normalizeSeverity");
      expect(src).not.toContain("SEVERITY_MAP =");
    }
  });
  it("does NOT score risk or read the risk engine directly (consumes its OUTPUT via future adapters)", () => {
    for (const src of ALL) {
      expect(src).not.toContain("assessRisk");
      expect(src).not.toContain("RISK_POINTS");
      expect(src).not.toContain("riskLevel(");
    }
  });
  it("no legacy analytics, no Realtime, no polling", () => {
    for (const src of ALL) {
      expect(src).not.toContain("getExecutiveAnalytics");
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes|setInterval/);
    }
  });
  it("the pure layers hold no I/O", () => {
    for (const src of [COMPOSE, TYPES, CODES]) {
      expect(src).not.toContain("server-only");
      expect(src).not.toContain("supabase");
      expect(src).not.toMatch(/\bfetch\(/);
    }
    // compose is deterministic — generatedAt is injected, never new Date().
    expect(COMPOSE).not.toContain("new Date(");
  });
  it("introduces NO new permission string", () => {
    for (const src of ALL) expect(src).not.toMatch(/alerts?:read|operations:alerts/);
  });
});
