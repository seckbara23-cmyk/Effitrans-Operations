/**
 * Phase 7.6A — Logistics AI Copilot. The deterministic card engine + prompt are exercised
 * directly (recommendation correctness, evidence citation, confidence, Missing ≠ Negative,
 * guardrails); the server-only context/route/panel are verified structurally (permission gate,
 * read-only guarantee, safe audit, provider-down fallback, boundedness, reuse of the shared
 * engine, and the permission wired across migration + seed + role-templates + events).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildRecommendations, deterministicSummary } from "@/lib/logistics/copilot/cards";
import { serializeLogisticsContext, buildLogisticsSystemPrompt, buildLogisticsMessages } from "@/lib/logistics/copilot/prompt";
import type { LogisticsContext } from "@/lib/logistics/copilot/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FULL: LogisticsContext = {
  generatedAt: "2026-07-17T10:00:00Z",
  modules: ["road", "ocean", "air", "customs", "finance", "documents"],
  unavailable: [],
  authorized: { transport: true, customs: true, finance: true, document: true },
  headline: { movementsInProgress: 5, arrivingWithin7Days: 2, overdueOps: 1, criticalAlerts: 1, awaitingCustoms: 3, exceptions: 0 },
  attention: [
    { mode: "ocean", severity: "warning", reference: "EFT-IMP-2099-1", clientName: "ACME", reason: "Retard d'escale", link: "/shipping/shipments/s1" },
    { mode: "air", severity: "critical", reference: "EFT-IMP-2099-2", clientName: "Beta", reason: "Vol en retard", link: "/air/shipments/s2" },
  ],
  upcoming: [{ mode: "ocean", reference: "EFT-IMP-2099-3", clientName: "Gamma", route: "Shanghai → Dakar", at: "2026-07-18T00:00:00Z", status: "En transit", link: "/shipping/shipments/s3" }],
  blockedCustoms: [
    { reference: "DEC-001", fileNumber: "EFT-IMP-2099-4", clientName: "Delta", office: "DKR", status: "REJECTED", link: "/files/f4" },
    { reference: "DEC-002", fileNumber: "EFT-IMP-2099-5", clientName: "Eps", office: "DKR", status: "AWAITING_PAYMENT", link: "/files/f5" },
  ],
  overdueInvoices: [{ invoiceNumber: "INV-01", fileNumber: "EFT-IMP-2099-6", clientName: "Zeta", balance: 1000, currency: "XOF", dueDate: "2026-07-01", link: "/files/f6" }],
  docReview: { readyForReview: 3, failed: 1 },
  counts: { attention: 2, upcoming: 1, blockedCustoms: 2, overdueInvoices: 1, cap: 100 },
};

describe("deterministic recommendation engine — grounded, cited, complete", () => {
  const cards = buildRecommendations(FULL);
  const kinds = cards.map((c) => c.kind);
  it("emits every applicable card kind from real records", () => {
    for (const k of ["BLOCKED_CUSTOMS", "COMPLIANCE_WARNING", "DELAYED_VESSEL", "LATE_FLIGHT", "RISK_SHIPMENT", "UPCOMING_ETA", "CUSTOMER_NOTIFICATION", "OVERDUE_INVOICE", "MISSING_DOCUMENT"]) {
      expect(kinds).toContain(k);
    }
  });
  it("every card carries evidence, confidence, source modules, action, and the snapshot timestamp", () => {
    for (const c of cards) {
      expect(c.sourceModules.length).toBeGreaterThan(0);
      expect(c.suggestedAction.length).toBeGreaterThan(0);
      expect(c.reasoning.length).toBeGreaterThan(0);
      expect(c.timestamp).toBe(FULL.generatedAt);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(c.confidence);
    }
  });
  it("cites real record identifiers (declarations, invoices) as evidence", () => {
    const blocked = cards.find((c) => c.kind === "BLOCKED_CUSTOMS")!;
    expect(blocked.evidence.map((e) => e.reference)).toEqual(expect.arrayContaining(["DEC-001", "DEC-002"]));
    expect(blocked.confidence).toBe("HIGH");
    const inv = cards.find((c) => c.kind === "OVERDUE_INVOICE")!;
    expect(inv.evidence[0].reference).toBe("INV-01");
    expect(inv.sourceModules).toEqual(["finance"]);
  });
  it("customer-notification is a SUGGESTION, never an action", () => {
    const cn = cards.find((c) => c.kind === "CUSTOMER_NOTIFICATION")!;
    expect(cn.confidence).toBe("MEDIUM");
    expect(cn.suggestedAction.toLowerCase()).toContain("manuel");
  });
});

describe("Missing ≠ Negative — unavailable modules never become a false all-clear", () => {
  const partial: LogisticsContext = {
    ...FULL,
    modules: ["road", "ocean", "air"],
    unavailable: ["customs", "finance", "documents"],
    authorized: { transport: true, customs: false, finance: false, document: false },
    blockedCustoms: [], overdueInvoices: [], docReview: null,
  };
  it("produces NO customs/finance/document cards when those modules were not consulted", () => {
    const kinds = buildRecommendations(partial).map((c) => c.kind);
    expect(kinds).not.toContain("BLOCKED_CUSTOMS");
    expect(kinds).not.toContain("COMPLIANCE_WARNING");
    expect(kinds).not.toContain("OVERDUE_INVOICE");
    expect(kinds).not.toContain("MISSING_DOCUMENT");
  });
  it("the summary states the modules were not included, not that there is nothing", () => {
    const s = deterministicSummary(partial, buildRecommendations(partial));
    expect(s).toMatch(/NON inclus/i);
    expect(s).toContain("customs");
    expect(s).toContain("finance");
  });
  it("authorized-but-empty is a legitimate negative (consulted, nothing found)", () => {
    const empty: LogisticsContext = { ...FULL, attention: [], upcoming: [], blockedCustoms: [], overdueInvoices: [], docReview: { readyForReview: 0, failed: 0 } };
    const cards = buildRecommendations(empty);
    expect(cards).toHaveLength(0);
    expect(deterministicSummary(empty, cards)).toMatch(/Aucune recommandation/i);
  });
});

describe("prompt guardrails (non-overridable) + serialization", () => {
  const sys = buildLogisticsSystemPrompt();
  it("hard-codes the read-only / no-fabrication / missing≠negative guardrails", () => {
    expect(sys).toContain("LECTURE SEULE");
    expect(sys).toContain("NON MODIFIABLES");
    expect(sys).toMatch(/N'INVENTE RIEN/);
    expect(sys).toMatch(/NE DEVINE JAMAIS un identifiant/);
    expect(sys).toMatch(/NE FABRIQUE JAMAIS d'ETA/);
    expect(sys).toMatch(/position/i);
    expect(sys).toMatch(/DONNÉE MANQUANTE ≠ RÉSULTAT NÉGATIF/);
    expect(sys).toMatch(/CITE TOUJOURS le\(s\) module\(s\)/);
  });
  it("serializes real references and flags non-included modules", () => {
    const brief = serializeLogisticsContext({ ...FULL, unavailable: ["finance"] });
    expect(brief).toContain("DEC-001");
    expect(brief).toContain("EFT-IMP-2099-1");
    expect(brief).toMatch(/NON inclus/i);
  });
  it("buildLogisticsMessages returns a system + user pair for runCopilot", () => {
    const msgs = buildLogisticsMessages(FULL, "Quelles factures sont en souffrance ?");
    expect(msgs.map((m) => m.role)).toEqual(["system", "user"]);
    expect(msgs[1].content).toContain("QUESTION DE L'OPÉRATEUR");
    expect(msgs[1].content).toContain("INV-01");
  });
});

// ---------------------------------------------------------------- structural ----
describe("route: permission-gated, read-only, safe-audited, deterministic fallback", () => {
  const src = code("../app/api/logistics/copilot/route.ts");
  it("gates on logistics:copilot:read and reuses the shared engine (never a provider)", () => {
    expect(src).toContain('assertPermission("logistics:copilot:read")');
    expect(src).toContain("runCopilot(");
    expect(src).not.toMatch(/openai|anthropic|generateAI\(|from "@\/lib\/ai/i);
  });
  it("returns the DETERMINISTIC summary on any provider failure (never fails the UI)", () => {
    expect(src).toContain("CopilotError");
    expect(src).toContain("deterministicSummary");
    expect(src).toContain("fallback: true");
  });
  it("audits SAFE metadata only — never the prompt or the answer", () => {
    expect(src).toContain("LOGISTICS_COPILOT_QUERY");
    expect(src).toMatch(/after:\s*\{[^}]*outcome/);
    expect(src).not.toMatch(/after:\s*\{[^}]*(\bprompt\b|\banswer\b|text:)/);
  });
});

describe("read-only guarantee — no mutation in the copilot module graph", () => {
  it("context/cards/prompt import only readers, never an action/mutation", () => {
    for (const f of ["context", "cards", "prompt", "types"]) {
      const s = read(`../lib/logistics/copilot/${f}.ts`);
      expect(s).not.toMatch(/manage-actions|\/actions"|notifyCustomer|\.insert\(|\.update\(|\.delete\(/);
    }
  });
  it("the context is server-only, bounded, and permission-degraded", () => {
    const s = read("../lib/logistics/copilot/context.ts");
    expect(s).toContain('import "server-only"');
    expect(s).toContain("const CAP = 100");
    expect(s).toContain("unavailable");
    expect(s).toContain("getCommandCenter(");
    expect(s).toContain("listDeclarations(");
    expect(s).toContain("getFinanceQueue(");
  });
});

describe("permission wired across all four surfaces (parity-safe)", () => {
  it("migration + seed + role-templates + audit event all carry logistics:copilot:read", () => {
    expect(read("../supabase/migrations/20260718000001_logistics_copilot.sql")).toContain("logistics:copilot:read");
    const seed = read("../supabase/seed.sql");
    expect(seed).toContain("'logistics:copilot:read'");
    const tmpl = read("../lib/platform/role-templates.ts");
    expect((tmpl.match(/logistics:copilot:read/g) ?? []).length).toBe(17); // exactly the process:read set
    expect(read("../lib/audit/events.ts")).toContain('LOGISTICS_COPILOT_QUERY: "logistics.copilot.query"');
  });
  it("the panel is a client component that ships no secret and POSTs to the route", () => {
    const p = read("../components/logistics/copilot-panel.tsx");
    expect(p).toContain('"use client"');
    expect(p).toContain("/api/logistics/copilot");
    expect(p).not.toMatch(/service_role/i);
    expect(p.toLowerCase()).not.toContain("getadminsupabaseclient");
  });
});
