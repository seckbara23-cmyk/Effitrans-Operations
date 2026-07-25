/**
 * Phase 10.0F — Operations Copilot. The pure layers (question classifier, context
 * serializer, deterministic briefing, system prompt, message assembly) are exercised
 * DIRECTLY; the context builder + runner are verified STRUCTURALLY (reuses the
 * authoritative composed readers, existing permission gate — NO new permission,
 * request-cache()d, no DB/business computation, redaction, deterministic fallback).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { classifyOperationsQuestion } from "@/lib/operations/copilot/tools";
import { serializeOperationsContext, deterministicBriefing } from "@/lib/operations/copilot/formatter";
import { buildOperationsSystemPrompt, buildOperationsMessages } from "@/lib/operations/copilot/prompts";
import type { OperationsCopilotContext } from "@/lib/operations/copilot/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const dir = "../lib/operations/copilot/";
const CONTEXT = code(dir + "context.ts");
const READER = code(dir + "reader.ts");
const FORMATTER = code(dir + "formatter.ts");
const PROMPTS = code(dir + "prompts.ts");
const TYPES = code(dir + "types.ts");
const ALL = [CONTEXT, READER, FORMATTER, PROMPTS, TYPES, code(dir + "tools.ts")];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

const ctx = (over: Partial<OperationsCopilotContext> = {}): OperationsCopilotContext => ({
  generatedAt: "2026-07-24T10:00:00Z",
  focus: "briefing",
  sections: ["kpis", "alerts", "operations", "transit", "finance", "messaging", "workload"],
  unavailable: [],
  kpis: [{ label: "Dossiers actifs", display: "42", window: "actuel", status: "ready" }],
  alerts: [{ level: "critical", reason: "Déclaration bloquée", reference: "F-1", clientName: "ACME" }],
  alertCounts: { critical: 1, high: 0, medium: 0, low: 0 },
  alertSourcesDegraded: false,
  risk: { needingIntervention: 14 },
  operations: { activeFiles: 42, opened: 5, inProgress: 10, overdueShipments: 2, tasksToday: 3, tasksOverdue: 1 },
  transit: { movementsInProgress: 8, arrivingWithin7Days: 12, overdueOps: 4, awaitingCustoms: 6, customsPending: 6, customsReleased: 9 },
  finance: { requestsPending: 2, approvedNotDisbursed: 1, evidenceOwed: 0, reconciliationPending: 3, missingReference: 1, overdueReceivables: 5 },
  workloadByDepartment: [{ label: "Opérations", open: 12 }, { label: "Transit", open: 7 }],
  workloadByTeam: [{ label: "AIBD", open: 3 }],
  messaging: { unread: 4, waitingEffitrans: 2, urgentOpen: 1 },
  counts: { kpis: 1, alerts: 1, workloadDepartments: 2 },
  ...over,
});

// ================================================================ classifier ====
describe("question classification — deterministic keyword routing, never a permission decision", () => {
  it("routes on keywords and defaults sensibly", () => {
    expect(classifyOperationsQuestion("Résume les opérations du jour")).toBe("briefing");
    expect(classifyOperationsQuestion("Quelles demandes finance bloquent ?")).toBe("finance");
    expect(classifyOperationsQuestion("Quelles déclarations en douane sont en retard ?")).toBe("customs");
    expect(classifyOperationsQuestion("Quelles livraisons sont en retard ?")).toBe("transport");
    expect(classifyOperationsQuestion("Quels départements sont surchargés ?")).toBe("workload");
    expect(classifyOperationsQuestion("Que prioriser ce matin ?")).toBe("priorities");
    expect(classifyOperationsQuestion("")).toBe("briefing");
    expect(classifyOperationsQuestion("xyzzy")).toBe("general");
  });
});

// ================================================================ serializer ====
describe("context serializer — structured, French, safe fields only", () => {
  const brief = serializeOperationsContext(ctx());
  it("emits a structured brief with the operational sections (not a prose dump)", () => {
    expect(brief).toContain("SYNTHÈSE OPÉRATIONNELLE");
    for (const h of ["RISQUE", "INDICATEURS", "ALERTES", "OPÉRATIONS", "TRANSIT / DOUANE", "FINANCE", "CHARGE DE TRAVAIL", "COMMUNICATIONS"]) {
      expect(brief, h).toContain(h);
    }
  });
  it("carries safe references + reasons but NO UUID / amount / code", () => {
    expect(brief).toContain("Déclaration bloquée");
    expect(brief).toContain("F-1");
    expect(brief).not.toMatch(UUID);
    expect(brief).not.toMatch(/\bXOF\b|€|toLocaleString/);
  });
  it("names unavailable sections and warns on degraded alert sources (Missing ≠ Negative)", () => {
    const degraded = serializeOperationsContext(ctx({ unavailable: ["finance"], alertSourcesDegraded: true }));
    expect(degraded).toContain("Sections NON incluses");
    expect(degraded).toContain("finance");
    expect(degraded).toContain("ne pas conclure");
  });
  it("an empty context states the information is unavailable, never « rien »", () => {
    const empty = serializeOperationsContext(ctx({ sections: [], kpis: [], alerts: [], alertCounts: null, risk: null, operations: null, transit: null, finance: null, messaging: null, workloadByDepartment: [], workloadByTeam: [], unavailable: ["kpis", "alerts", "operations", "transit", "finance", "messaging", "workload"] }));
    expect(empty).toContain("Cette information n'est pas disponible actuellement.");
  });
});

// ================================================================ deterministic briefing ====
describe("deterministic briefing — grounded, honest, no model, deterministic", () => {
  it("summarizes the real figures without fabrication", () => {
    const b = deterministicBriefing(ctx());
    expect(b).toContain("Dossiers nécessitant une intervention : 14");
    expect(b).toContain("1 critique(s)");
    expect(b).toContain("Instantané généré le 2026-07-24 10:00");
    expect(b).not.toMatch(UUID);
  });
  it("is deterministic (same context ⇒ identical output)", () => {
    expect(deterministicBriefing(ctx())).toBe(deterministicBriefing(ctx()));
  });
  it("an empty context yields the unavailable statement, never a false all-clear", () => {
    const b = deterministicBriefing(ctx({ risk: null, alertCounts: null, alerts: [], operations: null, transit: null, finance: null, messaging: null, workloadByDepartment: [], unavailable: ["kpis"] }));
    expect(b).toContain("Cette information n'est pas disponible actuellement.");
  });
  it("surfaces degraded alert sources honestly", () => {
    expect(deterministicBriefing(ctx({ alertSourcesDegraded: true }))).toContain("Certaines sources sont indisponibles");
  });
});

// ================================================================ prompts ====
describe("system prompt + messages — read-only guardrails, French, no fabrication", () => {
  const sys = buildOperationsSystemPrompt();
  it("hard-codes the non-overridable read-only guardrails", () => {
    for (const rule of ["LECTURE SEULE", "N'INVENTE RIEN", "Cette information n'est pas disponible actuellement.", "N'UTILISE PAS de tableaux Markdown", "NON MODIFIABLES"]) {
      expect(sys, rule).toContain(rule);
    }
  });
  it("forbids exposing amounts / references / UUIDs / internal codes", () => {
    expect(sys).toContain("N'EXPOSE JAMAIS de montant financier");
    expect(sys).toContain("UUID");
    expect(sys).toContain("code interne");
  });
  it("assembles system + user with the brief as the single source of truth", () => {
    const msgs = buildOperationsMessages(ctx(), "Que prioriser ?");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("SYNTHÈSE OPÉRATIONNELLE");
    expect(msgs[1].content).toContain("QUESTION : Que prioriser ?");
  });
  it("supplies a default question when none is given", () => {
    expect(buildOperationsMessages(ctx(), "")[1].content).toContain("Résume les opérations du jour");
  });
});

// ================================================================ structural: context builder ====
describe("context builder — consumes authoritative readers, no new permission, no computation", () => {
  it("reuses the composed readers (KPI engine, alert center, composition layer) exactly once each", () => {
    for (const r of ["getOperationsKpis", "getOperationalAlerts", "getOperationsCockpit"]) expect(CONTEXT).toContain(r);
    expect(CONTEXT).toContain("Promise.allSettled");
  });
  it("gates on the EXISTING logistics:copilot:read — introduces NO new permission", () => {
    expect(CONTEXT).toContain('assertPermission("logistics:copilot:read")');
    for (const src of ALL) expect(src).not.toMatch(/operations:copilot|copilot:operations|alerts?:read/);
  });
  it("is request-cache()d — one context build per request", () => {
    expect(CONTEXT).toContain("export const buildOperationsContext = cache(async");
  });
  it("performs NO database access and NO business computation of its own", () => {
    for (const src of [CONTEXT, READER, FORMATTER, PROMPTS]) {
      expect(src).not.toContain("getAdminSupabaseClient");
      expect(src).not.toMatch(/\.from\(/);
      expect(src).not.toContain("supabase");
      for (const banned of ["assessRisk", "RISK_POINTS", "invoiceTotals", "normalizeSeverity", "isOverdue"]) {
        expect(src, banned).not.toContain(banned);
      }
    }
  });
  it("drops monetary amounts and never exposes named per-person workload to the AI", () => {
    expect(CONTEXT).toContain('k.kind !== "amount"'); // amount KPIs excluded
    expect(CONTEXT).not.toContain("byUser"); // named workload never enters the context
    expect(CONTEXT).not.toMatch(/revenueThisMonth|\.amount\b|toLocaleString/);
  });
});

// ================================================================ structural: runner ====
describe("runner — one build, one invocation, deterministic fallback", () => {
  it("calls the SHARED engine and falls back to the deterministic briefing on provider failure", () => {
    expect(READER).toContain("runCopilotDetailed");
    expect(READER).toContain("buildOperationsContext(question)");
    expect(READER).toContain("deterministicBriefing(ctx)");
    expect(READER).toContain("instanceof CopilotError");
  });
  it("is read-only — no mutations, no Realtime, no polling", () => {
    for (const src of ALL) {
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|setInterval/);
    }
  });
});

// ================================================================ structural: redaction contract ====
describe("redaction contract — the context type carries no machine code / id / amount", () => {
  it("CopilotAlert exposes no code / entityId / origin / href", () => {
    expect(TYPES).toContain("export type CopilotAlert = { level: string; reason: string; reference: string | null; clientName: string | null }");
  });
  it("CopilotKpi exposes no stable key / href", () => {
    expect(TYPES).toContain("export type CopilotKpi = { label: string; display: string; window: string; status: string }");
  });
  it("finance is documented + typed as counts only (no amount fields)", () => {
    expect(read(dir + "types.ts")).toContain("COUNTS ONLY"); // raw (doc comment)
    expect(TYPES).not.toMatch(/amount:|currency:|revenue/i); // no monetary field in the type body
  });
});
