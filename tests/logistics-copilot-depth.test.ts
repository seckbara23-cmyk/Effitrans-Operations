/**
 * Phase 7.6B — Logistics Copilot operational depth & conversational UX. Pure logic (portfolio
 * risk, context budgeting, upgraded cards, invoices, documents, customer-notification) exercised
 * directly; the server-only readers/route/usage and the client panel verified structurally.
 * Read-only, provider-neutral, permission-degraded, deterministic-evidence-first, audit-safe.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { assemblePortfolioRisk, type RiskSignals } from "@/lib/logistics/copilot/risk";
import { classifyQuestion, moduleCaps, capSerialized, BUDGET } from "@/lib/logistics/copilot/budget";
import { buildRecommendations, deterministicSummary } from "@/lib/logistics/copilot/cards";
import type { LogisticsContext } from "@/lib/logistics/copilot/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function ctx(over: Partial<LogisticsContext> = {}): LogisticsContext {
  return {
    generatedAt: "2026-07-17T10:00:00Z", questionClass: "general",
    modules: ["road", "ocean", "air", "customs", "finance", "documents"], unavailable: [], truncated: [],
    authorized: { transport: true, customs: true, finance: true, document: true },
    headline: null, attention: [], upcoming: [], blockedCustoms: [], overdueInvoices: [],
    missingDocs: [], docIntelJobs: [], portfolioRisk: [], notifyOpportunities: [], docReview: null,
    counts: { attention: 0, upcoming: 0, blockedCustoms: 0, overdueInvoices: 0, missingDocs: 0, docIntelJobs: 0, portfolioRisk: 0, cap: 100 },
    ...over,
  };
}

// ---------------------------------------------------------------- portfolio risk (1-6) ----
describe("portfolio risk projection — reuses assessRisk, bounded, no false low", () => {
  const signals: RiskSignals = {
    attention: [{ mode: "ocean", severity: "critical", reference: "F1", clientName: "A", reason: "Retard d'escale", link: "/files/f1" }],
    blockedCustoms: [{ reference: "DEC1", fileNumber: "F1", clientName: "A", office: "DKR", status: "REJECTED", link: "/files/f1" }],
    overdueInvoices: [{ invoiceNumber: "I1", fileNumber: "F2", clientName: "B", balance: 100, currency: "XOF", dueDate: "2026-06-01", daysOverdue: 46, paymentState: "émise", link: "/files/f2" }],
    missingDocs: [{ fileNumber: "F3", fileId: "f3", documentType: "BL", state: "MISSING", due: null, link: "/files/f3" }],
  };
  it("surfaces only files with a concrete risk signal (missing ≠ low risk), ranked, bounded", () => {
    const rows = assemblePortfolioRisk(signals, 2);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.every((r) => r.score > 0)).toBe(true);
    expect(rows.map((r) => r.fileNumber)).toEqual([...rows].sort((a, b) => b.score - a.score).map((r) => r.fileNumber));
  });
  it("carries real contributors + a link + hasUnknown (SLA/lifecycle not evaluated)", () => {
    const f1 = assemblePortfolioRisk(signals, 10).find((r) => r.fileNumber === "F1")!;
    expect(f1.contributors.length).toBeGreaterThan(0);
    expect(f1.link).toBe("/files/f1");
    expect(f1.hasUnknown).toBe(true);
  });
  it("the risk card stands alone (deterministic) with evidence + reasoning caveat", () => {
    const c = buildRecommendations(ctx({ portfolioRisk: assemblePortfolioRisk(signals, 10) })).find((x) => x.kind === "RISK_SHIPMENT")!;
    expect(c.evidence.length).toBeGreaterThan(0);
    expect(c.reasoning).toMatch(/plancher|non évalué|assessRisk/i);
  });
  it("risk.ts reuses assessRisk (no new authoritative risk state)", () => {
    expect(read("../lib/logistics/copilot/risk.ts")).toContain('from "@/lib/copilot/risk-engine"');
  });
});

// ---------------------------------------------------------------- invoices (7-12) ----
describe("overdue invoices — finance-gated, values only for authorized", () => {
  const inv = [{ invoiceNumber: "INV-9", fileNumber: "F9", clientName: "Z", balance: 500, currency: "XOF", dueDate: "2026-07-01", daysOverdue: 16, paymentState: "émise", link: "/files/f9" }];
  it("emits an overdue card with days-overdue + payment state when finance is authorized", () => {
    const c = buildRecommendations(ctx({ overdueInvoices: inv })).find((x) => x.kind === "OVERDUE_INVOICE")!;
    expect(c.evidence[0].reference).toBe("INV-9");
    expect(c.evidence[0].detail).toMatch(/16 j de retard/);
  });
  it("emits NO invoice card and marks finance unavailable when finance is NOT authorized", () => {
    const noFin = ctx({ overdueInvoices: [], authorized: { transport: true, customs: true, finance: false, document: true }, unavailable: ["finance"] });
    expect(buildRecommendations(noFin).some((c) => c.kind === "OVERDUE_INVOICE")).toBe(false);
    expect(deterministicSummary(noFin, []).toLowerCase()).toContain("finance");
  });
});

// ---------------------------------------------------------------- documents (13-20) ----
describe("required documents vs OCR review — distinct", () => {
  const context = ctx({
    missingDocs: [
      { fileNumber: "F1", fileId: "f1", documentType: "BL", state: "MISSING", due: null, link: "/files/f1" },
      { fileNumber: "F2", fileId: "f2", documentType: "Facture", state: "EXPIRED", due: "2026-01-01", link: "/files/f2" },
      { fileNumber: "F3", fileId: "f3", documentType: "COO", state: "AWAITING_REVIEW", due: null, link: "/files/f3" },
    ],
    docIntelJobs: [{ fileNumber: "F4", documentId: "d4abcdef", declaredType: "BILL_OF_LADING", predictedType: null, state: "FAILED", ocrRequired: true, failureCategory: "OCR_REQUIRED", conflictCount: 2, candidateCount: 5, link: "/files/f4/documents/d4/intelligence" }],
  });
  const card = buildRecommendations(context).find((c) => c.kind === "MISSING_DOCUMENT")!;
  it("the finding separates required-doc issues from the OCR review queue", () => {
    expect(card.finding).toMatch(/obligatoire/i);
    expect(card.finding).toMatch(/extraction/i);
    expect(card.reasoning).toMatch(/N'EST PAS la même chose/i);
  });
  it("evidence distinguishes MISSING / EXPIRED / AWAITING_REVIEW and OCR_REQUIRED/conflicts", () => {
    const statuses = card.evidence.map((e) => e.status);
    expect(statuses).toEqual(expect.arrayContaining(["MISSING", "EXPIRED", "AWAITING_REVIEW", "FAILED"]));
    expect(card.evidence.some((e) => /OCR requis/.test(e.detail ?? ""))).toBe(true);
  });
  it("the doc-intel reader never selects extracted values/text", () => {
    const src = code("../lib/logistics/copilot/readers.ts");
    expect(src).not.toMatch(/extracted_text|normalized_value|displayed_value|evidence/);
  });
});

// ---------------------------------------------------------------- customer notification (21-27) ----
describe("customer notification — grounded recommendation, no contact values", () => {
  const c = buildRecommendations(ctx({ notifyOpportunities: [{ mode: "ocean", reference: "F1", clientName: "A", reason: "Arrivée imminente (2026-07-18)", alreadyNotified: false, link: "/files/f1" }] })).find((x) => x.kind === "CUSTOMER_NOTIFICATION")!;
  it("is a suggestion (no send), grounded in a real event, with no email/phone", () => {
    expect(c.confidence).toBe("MEDIUM");
    expect(c.suggestedAction.toLowerCase()).toMatch(/manuel|portail/);
    expect(read("../lib/logistics/copilot/types.ts")).not.toMatch(/email|phone|telephone/i); // notify type carries no contact value
  });
});

// ---------------------------------------------------------------- context budgeting (28-35) ----
describe("deterministic context budgeting", () => {
  it("classifies questions with an allowlisted keyword classifier", () => {
    expect(classifyQuestion("Quelles déclarations douanières sont bloquées ?")).toBe("customs");
    expect(classifyQuestion("Quels navires sont en retard ?")).toBe("transport");
    expect(classifyQuestion("Quelles factures sont impayées ?")).toBe("finance");
    expect(classifyQuestion("Quels dossiers à risque élevé ?")).toBe("risk");
    expect(classifyQuestion("Bonjour")).toBe("general");
  });
  it("prioritizes relevant modules but never empties a module (minor cap > 0)", () => {
    const caps = moduleCaps("customs");
    expect(caps.customs).toBe(BUDGET.priorityCap);
    expect(caps.ocean).toBe(BUDGET.minorCap);
    expect(Object.values(caps).every((v) => v > 0)).toBe(true);
  });
  it("caps the total serialized brief and discloses truncation", () => {
    const long = "x".repeat(BUDGET.maxSerializedChars + 500);
    const r = capSerialized(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(BUDGET.maxSerializedChars + 40);
    expect(capSerialized("court").truncated).toBe(false);
  });
});

// ---------------------------------------------------------------- structural: server + client ----
describe("route: rate-limit + detailed usage + budgeted context + safe audit + fallback", () => {
  const src = code("../app/api/logistics/copilot/route.ts");
  it("enforces a rate limit and passes the question for budgeting", () => {
    expect(src).toContain("checkCopilotRateLimit(");
    expect(src).toContain("buildLogisticsCopilotContext(prompt)");
  });
  it("captures token usage via the additive detailed engine call (still through runCopilot path)", () => {
    expect(src).toContain("runCopilotDetailed(");
    expect(src).not.toMatch(/generateAI\(|from "@\/lib\/ai/);
  });
  it("always returns deterministic cards (answered, fallback, and rate-limited)", () => {
    expect((src.match(/cards,/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("deterministicSummary");
  });
  it("audits SAFE metadata (incl. tokens/outcome) — never prompt/answer/history", () => {
    expect(src).toContain("modulesUnavailable");
    expect(src).toContain("recommendationKinds");
    expect(src).not.toMatch(/after:[\s\S]{0,400}(\bprompt\b|\banswer\b|history)/);
  });
});

describe("engine: additive detailed call reuses generateAI (runCopilot unchanged)", () => {
  const eng = read("../lib/copilot/engine.ts");
  it("runCopilotDetailed exists and reuses generateAI + CopilotError; runCopilot signature intact", () => {
    expect(eng).toContain("export async function runCopilotDetailed");
    expect(eng).toContain("export async function runCopilot(messages: CopilotChatMessage[]): Promise<string>");
    expect((eng.match(/generateAI\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("usage + export endpoints are safe", () => {
  it("usage is admin-gated (audit:read:all) and exposes no prompt/answer", () => {
    const u = code("../lib/logistics/copilot/usage.ts");
    expect(u).toContain('assertPermission("audit:read:all")');
    expect(u).toContain('eq("tenant_id", user.tenantId)');
    // Reads ONLY the safe audit metadata columns (after jsonb + timestamp) — never a body column.
    expect(u).toContain('.select("after, occurred_at")');
    expect(u).not.toMatch(/\bbefore\b|questionText|answerText|promptBody/);
  });
  it("export audits type + count only, never contents", () => {
    const e = code("../app/api/logistics/copilot/export/route.ts");
    expect(e).toContain('outcome: "export"');
    expect(e).toContain("exportType");
    expect(e).toContain("recommendationCount");
    expect(e).not.toMatch(/prompt|answer|text:/);
  });
});

describe("panel: session-only history, no persistence, ships no secret", () => {
  const p = code("../components/logistics/copilot-panel.tsx");
  it("history is React state only — no localStorage/sessionStorage, with a clear control", () => {
    expect(p).toContain('"use client"');
    expect(p).toContain("useState<Turn[]>");
    expect(p).toContain("newConversation");
    expect(p).not.toMatch(/localStorage|sessionStorage/);
  });
  it("auth-aware prompts + export + no service role", () => {
    expect(p).toContain("available[s.needs]");
    expect(p).toContain("/api/logistics/copilot/export");
    expect(p).not.toMatch(/service_role/i);
    expect(p.toLowerCase()).not.toContain("getadminsupabaseclient");
  });
});

describe("context: permission-degraded, bounded, budgeted, no mutation", () => {
  const c = read("../lib/logistics/copilot/context.ts");
  it("additionally gates customs/finance/document and reuses existing readers", () => {
    expect(c).toContain('hasPermission(perms, "finance:read")');
    expect(c).toContain('hasPermission(perms, "customs:read")');
    expect(c).toContain('hasPermission(perms, "document:read")');
    expect(c).toContain("moduleCaps(");
    expect(c).toContain("assemblePortfolioRisk(");
    expect(c).not.toMatch(/manage-actions|\/actions"|notifyCustomer|\.insert\(|\.update\(|\.delete\(/);
  });
});
