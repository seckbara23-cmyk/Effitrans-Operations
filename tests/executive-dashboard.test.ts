/**
 * Phase 7.7 — Executive Intelligence Dashboard. The pure layer (severity NORMALIZATION, alert
 * merge, timeline merge, map adapter, KPI traceability/formatting) and the deterministic executive
 * card engine are exercised DIRECTLY; the server-only reader/route and the page are verified
 * STRUCTURALLY (composition-only, no duplicated logic, no second state machine, permission gate,
 * degrade-by-section, bounded/no-N+1, no provider call, safe audit, drill-down completeness).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  SEVERITY_MAP, normalizeSeverity, isKnownSeverity, mergeExecutiveAlerts, countAlertsByLevel,
  mergeTimeline, markerBounds, toShipmentProjection, formatKpi, kpi, successRate,
} from "@/lib/executive/compose";
import { DRILL, MODE_HREF } from "@/lib/executive/links";
import { ALERT_LEVELS, EXECUTIVE_SECTIONS, KPI_SOURCES, type ExecutiveAlert, type ExecutiveIntelligence, type ExecutiveMap } from "@/lib/executive/types";
import { buildExecutiveRecommendations, executiveDeterministicSummary } from "@/lib/executive/copilot/cards";
import { serializeExecutiveContext, buildExecutiveSystemPrompt, buildExecutiveMessages } from "@/lib/executive/copilot/prompt";
import { EXEC_CARD_KINDS } from "@/lib/executive/copilot/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const alert = (over: Partial<ExecutiveAlert> = {}): ExecutiveAlert => ({
  level: "critical", origin: "ocean", reference: "F1", clientName: "ACME",
  reason: "Retard d'escale", href: "/shipping/shipments/s1", occurredAt: "2026-07-16T08:00:00Z",
  sourceSeverity: "critical", ...over,
});

function ctx(over: Partial<ExecutiveIntelligence> = {}): ExecutiveIntelligence {
  return {
    generatedAt: "2026-07-17T10:00:00Z",
    sections: [...EXECUTIVE_SECTIONS],
    unavailable: [],
    kpis: [],
    operations: null, financial: null, customers: null, documents: null, ai: null,
    performance: null, governance: null, map: null,
    timeline: [], alerts: [], alertCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    canFinance: true, currency: "XOF",
    ...over,
  };
}

const FULL = ctx({
  operations: {
    headline: { movementsInProgress: 10, arrivingWithin7Days: 12, overdueOps: 4, criticalAlerts: 2, awaitingCustoms: 6, exceptions: 1 },
    modules: [
      { mode: "ocean", available: true, state: "critical", kpis: [{ label: "En transit", value: 5 }, { label: "Retards", value: 2 }], href: "/shipping" },
      { mode: "air", available: false, state: "no_data", kpis: [], href: "/air" },
    ],
  },
  financial: {
    currency: "XOF", revenueThisMonth: 1_000_000, revenueYtd: 9_000_000, outstanding: 4_000_000,
    collectedThisMonth: 500_000, avgInvoiceValue: 250_000, avgPaymentDelayDays: 42,
    aging: [{ bucket: "0–30 j", value: 1_000_000 }, { bucket: "31–60 j", value: 1_000_000 }, { bucket: "61–90 j", value: 0 }, { bucket: "> 90 j", value: 2_000_000 }],
    topOverdueClients: [{ clientName: "Zeta", outstanding: 2_000_000 }],
  },
  performance: { avgCustomsDays: 9, avgDeliveryDays: 6, avgTransportDays: 4, timeToInvoiceDays: 3, timeToPaymentDays: 42, etaAccuracyPercent: null },
  documents: { missingRequired: null, reviewQueue: 8, failed: 2, unresolvedConflicts: 1, queued: 3, processing: 1 },
  ai: { windowDays: 7, total: 20, answered: 12, fallback: 8, failed: 0, successRatePercent: 60, avgDurationMs: 900, tokens: { prompt: 10, completion: 5, total: 15 }, providerConfigured: true, provider: "openai", model: "gpt-4o-mini" },
  customers: { activeClients: 12, portalUsers: 30, portalActiveClients: 9, sharedDocuments: 40, portalDownloads: 88, portalInvoiceViews: 15, notificationsDelivered: 60, notificationsUnread: 7, notificationWindowDays: 30, topOverdueClients: [{ clientName: "Zeta", outstanding: 2_000_000 }] },
  alerts: [alert()],
  alertCounts: { critical: 1, high: 0, medium: 0, low: 0 },
  kpis: [kpi("activeDossiers", "Dossiers actifs", 42, "control-tower", DRILL.management)],
});

// ---------------------------------------------------------------- severity: normalized, never invented ----
describe("alert severity is NORMALIZED from each engine's own token — never invented", () => {
  it("maps every existing vocabulary 1:1 (logistics critical/warning/info + analytics RED/AMBER/GREEN)", () => {
    expect(normalizeSeverity("critical")).toBe("critical");
    expect(normalizeSeverity("warning")).toBe("high");
    expect(normalizeSeverity("info")).toBe("medium");
    expect(normalizeSeverity("RED")).toBe("critical");
    expect(normalizeSeverity("AMBER")).toBe("high");
    expect(normalizeSeverity("GREEN")).toBe("low");
  });
  it("every mapped level is one of the four executive levels", () => {
    for (const level of Object.values(SEVERITY_MAP)) expect(ALERT_LEVELS).toContain(level);
  });
  it("an unknown token is neither dropped nor promoted to critical", () => {
    expect(isKnownSeverity("banana")).toBe(false);
    expect(normalizeSeverity("banana")).toBe("medium");
    expect(normalizeSeverity("banana")).not.toBe("critical");
  });
  it("carries the source severity for audit of the normalization", () => {
    const merged = mergeExecutiveAlerts([alert({ sourceSeverity: "warning", level: normalizeSeverity("warning") })]);
    expect(merged[0].level).toBe("high");
    expect(merged[0].sourceSeverity).toBe("warning");
  });
  it("the compose layer never computes a severity from data (no scoring, no thresholds)", () => {
    const src = code("../lib/executive/compose.ts");
    expect(src).not.toMatch(/assessRisk|riskScore|score\s*[><]=?|if\s*\(.*count\s*[><]/);
  });
});

describe("consolidated alert queue — dedupe, order by level then age, bounded", () => {
  it("dedupes on origin+reference+reason", () => {
    expect(mergeExecutiveAlerts([alert(), alert()])).toHaveLength(1);
  });
  it("orders critical before high before medium before low", () => {
    const merged = mergeExecutiveAlerts([
      alert({ level: "low", reason: "d" }), alert({ level: "high", reason: "b" }),
      alert({ level: "critical", reason: "a" }), alert({ level: "medium", reason: "c" }),
    ]);
    expect(merged.map((a) => a.level)).toEqual(["critical", "high", "medium", "low"]);
  });
  it("orders oldest first WITHIN a level (the longest-standing problem leads)", () => {
    const merged = mergeExecutiveAlerts([
      alert({ reason: "new", occurredAt: "2026-07-16T00:00:00Z" }),
      alert({ reason: "old", occurredAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(merged.map((a) => a.reason)).toEqual(["old", "new"]);
  });
  it("is bounded", () => {
    const many = Array.from({ length: 100 }, (_, i) => alert({ reason: `r${i}` }));
    expect(mergeExecutiveAlerts(many, 10)).toHaveLength(10);
  });
  it("counts all four levels (a real zero here, not a missing value)", () => {
    expect(countAlertsByLevel([alert(), alert({ level: "high", reason: "x" })])).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
  });
});

// ---------------------------------------------------------------- timeline ----
describe("unified timeline — merged, newest first, no second event store", () => {
  const e = (origin: ExecutiveIntelligence["timeline"][number]["origin"], at: string, title = "t") =>
    ({ at, origin, title, reference: "F1", clientName: "ACME", href: "/files/f1" });
  it("sorts newest first across origins", () => {
    const merged = mergeTimeline([e("customs", "2026-07-01T00:00:00Z"), e("shipping", "2026-07-16T00:00:00Z"), e("finance", "2026-07-10T00:00:00Z")]);
    expect(merged.map((x) => x.origin)).toEqual(["shipping", "finance", "customs"]);
  });
  it("drops undated events rather than placing them arbitrarily", () => {
    expect(mergeTimeline([e("road", ""), e("road", "2026-07-01T00:00:00Z")])).toHaveLength(1);
  });
  it("dedupes identical events and bounds the result", () => {
    expect(mergeTimeline([e("road", "2026-07-01T00:00:00Z"), e("road", "2026-07-01T00:00:00Z")])).toHaveLength(1);
    expect(mergeTimeline(Array.from({ length: 50 }, (_, i) => e("road", `2026-07-01T00:00:${String(i).padStart(2, "0")}Z`)), 5)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------- map ----
describe("aggregate map reuses the EXISTING projection engine", () => {
  const map: ExecutiveMap = {
    markers: [
      { kind: "ship", label: "MSC ISABELLA", latitude: 10, longitude: 20, status: "IN_TRANSIT", freshness: "LIVE", confidence: "CONFIRMED", source: "AIS", occurredAt: "2026-07-16T00:00:00Z", reference: "F1", href: "/shipping/shipments/s1" },
      { kind: "port", label: "Port de Dakar", latitude: 14, longitude: -17, status: null, freshness: null, confidence: null, source: null, occurredAt: null, reference: "SNDKR", href: "/shipping/ports" },
    ],
    bounds: null, capped: false, cap: 60, warnings: ["Position maritime obsolète : F9"],
  };
  it("adapts to ShipmentMapProjection and preserves status/freshness/confidence/source", () => {
    const p = toShipmentProjection(map);
    expect(p.milestones).toHaveLength(2);
    const ship = p.milestones[0];
    expect(ship.freshness).toBe("LIVE");
    expect(ship.confidence).toBe("CONFIRMED");
    expect(ship.source).toBe("AIS");
    expect(ship.occurredAt).toBe("2026-07-16T00:00:00Z");
  });
  it("maps movers → current and places → port (the renderer's own vocabulary)", () => {
    const p = toShipmentProjection(map);
    expect(p.milestones[0].kind).toBe("current");
    expect(p.milestones[1].kind).toBe("port");
  });
  it("carries the underlying warnings through (never hides a stale position)", () => {
    expect(toShipmentProjection(map).warnings).toContain("Position maritime obsolète : F9");
  });
  it("computes bounds over real markers only, and null for none", () => {
    expect(markerBounds(map.markers)).toEqual({ minLat: 10, minLon: -17, maxLat: 14, maxLon: 20 });
    expect(markerBounds([])).toBeNull();
  });
  it("the map reader builds NO mapping engine — it reuses the shared freshness model", () => {
    const src = code("../lib/executive/readers/fleet-map.ts");
    expect(src).toContain("classifyFreshness");
    expect(src).not.toMatch(/leaflet|mapbox|google\.maps/i);
  });
});

// ---------------------------------------------------------------- KPI traceability ----
describe("every KPI is traceable and never fakes a zero", () => {
  it("carries an authoritative source and a drill-down href", () => {
    const k = kpi("x", "X", 5, "control-tower", DRILL.management);
    expect(KPI_SOURCES).toContain(k.source);
    expect(k.href).toBe("/departments/management");
  });
  it("a null value renders as unavailable — NEVER as 0", () => {
    const k = kpi("x", "X", null, "control-tower", DRILL.management);
    expect(k.value).toBeNull();
    expect(k.display).toBeNull();
    expect(k.display).not.toBe("0");
  });
  it("formats by unit", () => {
    expect(formatKpi(5, "days")).toMatch(/^5\s*j$/);
    expect(formatKpi(60, "percent")).toMatch(/^60\s*%$/);
    expect(formatKpi(900, "ms")).toMatch(/^900\s*ms$/);
    expect(formatKpi(null, "currency")).toBeNull();
  });
  it("a rate over zero requests is UNKNOWN, not 0 %", () => {
    expect(successRate(0, 0)).toBeNull();
    expect(successRate(12, 20)).toBe(60);
  });
});

// ---------------------------------------------------------------- executive cards ----
describe("deterministic executive engine — grounded, cited, honest", () => {
  const cards = buildExecutiveRecommendations(FULL);
  const kind = (k: string) => cards.find((c) => c.kind === k);

  it("emits only allowlisted executive card kinds", () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(EXEC_CARD_KINDS).toContain(c.kind);
  });
  it("surfaces cash-collection risk with the real aged balance", () => {
    const c = kind("CASH_COLLECTION_RISK")!;
    expect(c.finding).toContain("90 jours");
    expect(JSON.stringify(c.evidence)).toContain("Ancienneté");
  });
  it("names the customers concentrating overdue exposure", () => {
    expect(JSON.stringify(kind("HIGH_RISK_CUSTOMERS")!.evidence)).toContain("Zeta");
  });
  it("flags customs congestion and links to Customs Intelligence", () => {
    const c = kind("CUSTOMS_CONGESTION")!;
    expect(c.finding).toContain("6");
    expect(c.evidence.some((e) => e.href === DRILL.customs)).toBe(true);
  });
  it("reports AI fallback rate from the audit aggregates", () => {
    expect(kind("PROVIDER_AVAILABILITY")!.finding).toContain("40 %");
  });
  it("warns when no provider is configured", () => {
    const c = buildExecutiveRecommendations(ctx({ sections: ["ai"], ai: { ...FULL.ai!, providerConfigured: false, total: 0, fallback: 0, answered: 0 } }));
    expect(c.find((x) => x.kind === "PROVIDER_AVAILABILITY")!.finding).toMatch(/Aucun fournisseur IA/);
  });
  it("GROWING_DELAYS states measured LEVELS and explicitly refuses to claim a trend", () => {
    const c = kind("GROWING_DELAYS")!;
    expect(c.reasoning).toMatch(/pas une tendance|aucune progression/i);
    // The TITLE must not assert a direction the data cannot support either — no period-over-period
    // history is kept, so "en progression"/"en hausse" would contradict the card's own reasoning.
    expect(c.title).not.toMatch(/progression|hausse|croissan|augmentation|dégrad/i);
  });
  it("no card title claims a trend, growth or improvement anywhere", () => {
    for (const c of cards) expect(c.title, `card ${c.kind}`).not.toMatch(/progression|hausse|croissan|augmentation|amélior|dégrad/i);
  });
  it("no suggested action points at a workspace that does not exist", () => {
    for (const c of cards) expect(c.suggestedAction, `card ${c.kind}`).not.toMatch(/Document Intelligence/);
  });
  it("Missing ≠ Negative: an unavailable section yields NO card and NO all-clear", () => {
    const noFin = buildExecutiveRecommendations(ctx({ sections: ["operations"], unavailable: ["financial"], financial: FULL.financial }));
    expect(noFin.some((c) => c.kind === "CASH_COLLECTION_RISK")).toBe(false);
    expect(noFin.some((c) => c.kind === "REVENUE_RISK")).toBe(false);
    const s = executiveDeterministicSummary(ctx({ sections: ["operations"], unavailable: ["financial", "ai"] }), []);
    expect(s).toMatch(/NON incluses/);
    expect(s).toMatch(/donnée manquante ≠ absence de problème/i);
  });
  it("an empty snapshot yields no cards and invents nothing", () => {
    expect(buildExecutiveRecommendations(ctx({ sections: [] }))).toEqual([]);
    expect(executiveDeterministicSummary(ctx({ sections: [] }), [])).toMatch(/Aucun point d'attention/);
  });
  it("the deterministic summary is a real fallback answer", () => {
    const s = executiveDeterministicSummary(FULL, buildExecutiveRecommendations(FULL));
    expect(s).toContain("Dossiers actifs");
    expect(s).toMatch(/Alertes consolidées/);
  });
  it("every card evidence href points at an existing operational workspace", () => {
    const known = new Set<string>(Object.values(DRILL));
    for (const c of cards) for (const e of c.evidence) if (e.href) expect(known.has(e.href)).toBe(true);
  });
});

// ---------------------------------------------------------------- prompt ----
describe("executive prompt — traceable brief + non-overridable guardrails", () => {
  const brief = serializeExecutiveContext(FULL);
  const sys = buildExecutiveSystemPrompt();

  it("labels every KPI with its authoritative source", () => {
    expect(brief).toMatch(/source : control-tower/);
  });
  it("states unmeasured figures as unavailable and forbids estimating them", () => {
    expect(brief).toMatch(/Précision des ETA=NON MESURÉE/);
    expect(brief).toMatch(/ne pas l'estimer/);
    expect(brief).toMatch(/Documents obligatoires manquants=NON DISPONIBLE/);
  });
  it("marks an unavailable module honestly inside the operations block", () => {
    expect(brief).toMatch(/air : NON DISPONIBLE/);
  });
  it("guardrails forbid invented numbers, invented trends and false all-clears", () => {
    expect(sys).toMatch(/NON MODIFIABLES/);
    expect(sys).toMatch(/LECTURE SEULE/);
    expect(sys).toMatch(/N'INVENTE AUCUN CHIFFRE/);
    expect(sys).toMatch(/N'AFFIRME AUCUNE TENDANCE/);
    expect(sys).toMatch(/DONNÉE MANQUANTE ≠ ABSENCE DE PROBLÈME/);
    expect(sys).toMatch(/NE RÉINVENTE PAS LA GRAVITÉ/);
    expect(sys).toMatch(/CITE TOUJOURS LA SOURCE/);
  });
  it("assembles system+user with bounded history and the question last", () => {
    const msgs = buildExecutiveMessages(FULL, "Où sont nos goulots ?", [{ role: "user", content: "bonjour" }]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content.trim().endsWith("QUESTION DE LA DIRECTION : Où sont nos goulots ?")).toBe(true);
  });
  it("reuses the SHARED budget (no third budgeting scheme)", () => {
    expect(code("../lib/executive/copilot/prompt.ts")).toContain('from "@/lib/copilot/budget"');
  });
});

// ---------------------------------------------------------------- structural: reader layer ----
describe("reader layer: composition only — no duplicated logic, no second state machine", () => {
  const src = code("../lib/executive/reader.ts");

  it("composes the EXISTING authoritative readers", () => {
    for (const r of ["getControlTower", "getBusinessIntelligence", "getAnalytics", "getCommandCenter", "getDocIntelDashboard", "getCopilotUsageSummary"]) {
      expect(src).toContain(r);
    }
  });
  it("runs NO lifecycle / risk / SLA / finance calculation of its own (no second state machine)", () => {
    expect(src).not.toMatch(/getDossierLifecycle|assessRisk|classifySla|invoiceTotals|balanceDue|paidAmount|stageDuration/);
  });
  it("queries NO table directly — every figure comes through a module reader", () => {
    expect(src).not.toMatch(/\.from\("/);
    expect(src).not.toMatch(/getAdminSupabaseClient/);
  });
  it("is gated on executive:dashboard:read", () => {
    expect(src).toContain('assertPermission("executive:dashboard:read")');
  });
  it("degrades by section (Missing ≠ Negative) rather than crashing", () => {
    expect(src).toContain("Promise.allSettled");
    expect(src).toContain("unavailable.push");
  });
  it("withholds the financial row without finance:read instead of showing zero revenue", () => {
    expect(src).toMatch(/bi\.canFinance/);
    expect(src).toMatch(/unavailable\.push\("financial"\)/);
  });
  it("is request-cached so one render reads each module once", () => {
    expect(src).toContain("cache(");
    expect(read("../lib/executive/reader.ts")).toContain('from "react"');
  });
  it("makes NO provider call — AI availability is configuration state only", () => {
    expect(src).toContain("getCopilotConfig()");
    expect(src).not.toMatch(/runCopilot|generateAI|@\/lib\/ai/);
  });
  it("no module imports the dashboard (the dependency points one way)", () => {
    const offenders: string[] = [];
    for (const f of [
      "../lib/logistics/reader.ts", "../lib/control-tower/service.ts", "../lib/bi/service.ts",
      "../lib/analytics/service.ts", "../lib/docintel/service.ts", "../lib/shipping/intelligence/service.ts",
      "../lib/air/intelligence/service.ts", "../lib/customs/intelligence/service.ts",
      "../lib/logistics/copilot/usage.ts", "../lib/portal/tracking.ts",
    ]) {
      if (existsSync(fileURLToPath(new URL(f, import.meta.url))) && read(f).includes("@/lib/executive")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------- structural: new readers ----
describe("the two new readers are narrow, bounded and duplicate nothing", () => {
  it("the notification reader fills ONLY the documented gap (portal adoption stays in analytics)", () => {
    const src = code("../lib/executive/readers/portal-ops.ts");
    expect(src).toContain("client_notification");
    // portal adoption KPIs must NOT be recomputed here — getAnalytics().portal is authoritative
    expect(src).not.toMatch(/client_user|computePortal/);
    expect(src).toMatch(/head: true/);
  });
  it("the fleet map never scans all tracking history (bounded per mode, capped, disclosed)", () => {
    const src = code("../lib/executive/readers/fleet-map.ts");
    expect(src).toMatch(/EVENT_SCAN/);
    expect(src).toMatch(/\.limit\(EVENT_SCAN\)/);
    expect(src).toContain("capped");
  });
  it("the fleet map resolves labels in ONE batched lookup (no N+1)", () => {
    const src = code("../lib/executive/readers/fleet-map.ts");
    expect(src).toMatch(/\.in\("id", shipmentIds\)/);
    expect(src).not.toMatch(/for\s*\([\s\S]{0,200}await admin\.from/);
  });
  it("the timeline reader is bounded per origin and batches its labels (no N+1)", () => {
    const src = code("../lib/executive/readers/timeline.ts");
    expect(src).toMatch(/\.limit\(PER_ORIGIN\)/);
    expect(src).toContain("Promise.allSettled");
    expect(src).not.toMatch(/for\s*\([\s\S]{0,200}await admin\.from/);
  });
  it("the timeline creates no event store — it only reads each module's own rows", () => {
    const src = code("../lib/executive/readers/timeline.ts");
    expect(src).not.toMatch(/insert|upsert|update\(/);
  });
});

// ---------------------------------------------------------------- structural: route + page ----
describe("executive AI route: gated, shared engine, safe audit, deterministic fallback", () => {
  const src = code("../app/api/executive/copilot/route.ts");
  it("is gated on executive:dashboard:read", () => {
    expect(src).toContain('assertPermission("executive:dashboard:read")');
  });
  it("reuses the SHARED provider-neutral engine — never lib/ai or a provider", () => {
    expect(src).toContain("runCopilotDetailed(");
    expect(src).not.toMatch(/generateAI\(|from "@\/lib\/ai|openai|ollama|vllm/i);
  });
  it("reuses the request-cached snapshot rather than re-reading the modules", () => {
    expect(src).toContain("getExecutiveIntelligence()");
    expect(src).not.toMatch(/getControlTower|getBusinessIntelligence|getCommandCenter/);
  });
  it("always returns deterministic cards (answered, fallback, rate-limited)", () => {
    expect((src.match(/cards,/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("executiveDeterministicSummary");
  });
  it("reuses the shared rate limiter", () => {
    expect(src).toContain("checkAuditRateLimit(");
  });
  it("audits SAFE metadata only — never the prompt, answer, history, or any metric", () => {
    expect(src).toContain("EXECUTIVE_COPILOT_QUERY");
    expect(src).toContain("durationMs");
    expect(src).not.toMatch(/after:[\s\S]{0,500}(\bprompt\b|\banswer\b|history|revenue|outstanding)/);
  });
});

describe("the dashboard page: read-only, server-rendered, drill-down complete", () => {
  const src = code("../app/dashboard/executive/page.tsx");
  it("is server-rendered (no client directive)", () => {
    expect(src).not.toMatch(/^\s*"use client"/m);
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });
  it("is gated on the new permission, not analytics:read", () => {
    expect(src).toContain('hasPermission(permissions, "executive:dashboard:read")');
    expect(src).not.toContain('hasPermission(permissions, "analytics:read")');
  });
  it("owns no data — it renders the composed snapshot only", () => {
    expect(src).toContain("getExecutiveIntelligence()");
    expect(src).not.toMatch(/getControlTower|getBusinessIntelligence|\.from\("/);
  });
  it("is READ-ONLY — no form action, no mutation, no server action", () => {
    expect(src).not.toMatch(/<form|action=\{|"use server"|revalidatePath/);
  });
  it("reuses the EXISTING Leaflet renderer (no second map component)", () => {
    expect(src).toContain("ShipmentMapLoader");
    expect(src).toContain("toShipmentProjection");
  });
  it("audits the VIEW but stores no executive metric", () => {
    expect(src).toContain("EXECUTIVE_DASHBOARD_VIEWED");
    expect(src).not.toMatch(/after:[\s\S]{0,200}(revenue|outstanding|kpis:)/);
  });
  it("renders the unavailable notice rather than a confident zero", () => {
    expect(src).toContain("Unavailable");
    expect(src).toMatch(/donnée manquante ≠ absence de problème/);
  });
  it("every drill-down target resolves to a real page", () => {
    for (const href of Object.values(DRILL)) {
      const route = href.replace(/^\//, "");
      const candidates = [`../app/${route}/page.tsx`, `../app/(app)/${route}/page.tsx`];
      const found = candidates.some((c) => existsSync(fileURLToPath(new URL(c, import.meta.url))));
      expect(found, `no page for drill-down ${href}`).toBe(true);
    }
  });
  it("MODE_HREF covers every Command Center mode", () => {
    expect(Object.keys(MODE_HREF).sort()).toEqual(["air", "customs", "ocean", "road"]);
  });
});

// ---------------------------------------------------------------- permission wiring ----
describe("executive:dashboard:read wired across migration + seed + templates + nav + events", () => {
  it("migration and seed grant it to the same three roles", () => {
    const mig = read("../supabase/migrations/20260719000001_executive_dashboard.sql");
    const seed = read("../supabase/seed.sql");
    expect(mig).toContain("'executive:dashboard:read'");
    expect(seed).toContain("'executive:dashboard:read'");
    for (const role of ["SYSTEM_ADMIN", "CEO", "OPS_SUPERVISOR"]) {
      expect(mig).toContain(role);
    }
  });
  it("role templates grant it to exactly the three executive/management roles", () => {
    const tmpl = read("../lib/platform/role-templates.ts");
    expect((tmpl.match(/"executive:dashboard:read"/g) ?? []).length).toBe(3);
  });
  it("never granted to a customer/partner/driver identity", () => {
    const seed = read("../supabase/seed.sql");
    const block = seed.slice(seed.indexOf("executive:dashboard:read"));
    const grant = block.slice(0, block.indexOf("on conflict do nothing;"));
    for (const role of ["CLIENT_USER", "PARTNER_AGENT", "DRIVER"]) expect(grant).not.toContain(role);
  });
  it("the nav gates the executive item on the new permission", () => {
    expect(read("../lib/nav.ts")).toContain('permission: "executive:dashboard:read"');
  });
  it("the audit registry carries the view/export/AI actions", () => {
    const ev = read("../lib/audit/events.ts");
    expect(ev).toContain('EXECUTIVE_DASHBOARD_VIEWED: "executive.dashboard.viewed"');
    expect(ev).toContain('EXECUTIVE_DASHBOARD_EXPORTED: "executive.dashboard.exported"');
    expect(ev).toContain('EXECUTIVE_COPILOT_QUERY: "executive.copilot.query"');
  });
});
