/**
 * Phase 7.1A — Customs Intelligence foundation: canonical lifecycle, domain mapping,
 * timeline (reused audit), provider abstraction (+ GAINDE stub), dashboard contracts.
 * Pure — no DB, no external integration.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  DECLARATION_STATUSES, canTransition, validateTransition, isTerminal, isCleared, nextStatuses,
  isDeclarationStatus, declarationLabel, type DeclarationStatus,
} from "@/lib/customs/intelligence/state-machine";
import { toDeclaration, type Declaration } from "@/lib/customs/intelligence/domain";
import { transitionAuditPayload, projectTimeline, timelineBounds } from "@/lib/customs/intelligence/timeline";
import { ManualProvider, GaindeProvider, CustomsEngine, resolveProvider, CUSTOMS_PROVIDERS } from "@/lib/customs/intelligence/provider";
import { pendingCount, releasedCount, inspectionQueue, averageClearanceDays, dutyTotals, dailyActivity, buildCustomsDashboard } from "@/lib/customs/intelligence/dashboard";
import { AuditActions } from "@/lib/audit/events";
import type { CustomsRecord } from "@/lib/customs/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

function record(over: Partial<CustomsRecord> = {}): CustomsRecord {
  return {
    id: "d1", fileId: "f1", status: "DECLARED", required: true, declarationNumber: "DN-1",
    customsOffice: "DKR", regime: "IM4", declarationDate: "2026-07-10", baeReference: null, releaseDate: null,
    inspectionStatus: "PENDING", externalRef: null, notes: null, ...over,
  };
}
function decl(over: Partial<Declaration> = {}): Declaration {
  return {
    id: "d", fileId: "f", reference: "R", status: "SUBMITTED", office: null, regime: null, broker: null,
    containers: [], inspection: { required: true, status: "NOT_REQUIRED", scheduledAt: null }, duties: [], payments: [],
    release: null, transit: null, provider: { provider: "manual", externalReference: null, submittedAt: null }, declarationDate: null, ...over,
  };
}

// ---------------------------------------------------------------- state machine ----

describe("canonical declaration lifecycle", () => {
  it("has the ten canonical statuses", () => {
    expect([...DECLARATION_STATUSES]).toEqual(["DRAFT", "SUBMITTED", "ACCEPTED", "UNDER_REVIEW", "INSPECTION", "AWAITING_PAYMENT", "RELEASED", "COMPLETED", "REJECTED", "CANCELLED"]);
    expect(isDeclarationStatus("DRAFT")).toBe(true);
    expect(isDeclarationStatus("NOPE")).toBe(false);
  });
  it("validates the happy path DRAFT→…→COMPLETED", () => {
    const path: DeclarationStatus[] = ["DRAFT", "SUBMITTED", "ACCEPTED", "INSPECTION", "AWAITING_PAYMENT", "RELEASED", "COMPLETED"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1]), `${path[i]}→${path[i + 1]}`).toBe(true);
  });
  it("rejects illegal + terminal transitions with a typed reason", () => {
    expect(canTransition("DRAFT", "ACCEPTED")).toBe(false);
    expect(canTransition("SUBMITTED", "RELEASED")).toBe(false);
    expect(validateTransition("DRAFT", "ACCEPTED")).toEqual({ ok: false, reason: "invalid_transition" });
    expect(validateTransition("COMPLETED", "DRAFT")).toEqual({ ok: false, reason: "terminal" });
    expect(validateTransition("DRAFT", "SUBMITTED")).toEqual({ ok: true });
  });
  it("terminal + cleared classification", () => {
    for (const s of ["COMPLETED", "REJECTED", "CANCELLED"] as const) { expect(isTerminal(s)).toBe(true); expect(nextStatuses(s)).toEqual([]); }
    expect(isCleared("RELEASED")).toBe(true);
    expect(isCleared("COMPLETED")).toBe(true);
    expect(isCleared("INSPECTION")).toBe(false);
    expect(declarationLabel("AWAITING_PAYMENT")).toBe("En attente de paiement");
  });
});

// ---------------------------------------------------------------- domain mapping ----

describe("toDeclaration maps the existing customs_record (no duplication)", () => {
  it("reuses record fields; provider defaults to manual; release from BAE", () => {
    const d = toDeclaration(record({ baeReference: "BAE-9", releaseDate: "2026-07-15" }), { status: "RELEASED" });
    expect(d.id).toBe("d1");
    expect(d.reference).toBe("DN-1");
    expect(d.office).toEqual({ code: "DKR", name: null });
    expect(d.status).toBe("RELEASED");
    expect(d.release).toEqual({ reference: "BAE-9", releasedAt: "2026-07-15" });
    expect(d.inspection.status).toBe("PENDING");
    expect(d.provider.provider).toBe("manual");
  });
  it("accepts injected provider / containers / duties (from their sources)", () => {
    const d = toDeclaration(record(), { status: "SUBMITTED", provider: { provider: "GAINDE", externalReference: "G-1", submittedAt: "2026-07-11" }, duties: [{ code: "DD", label: "Droit", amount: 100, currency: "XOF" }] });
    expect(d.provider.provider).toBe("GAINDE");
    expect(d.duties).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- timeline (reuse audit) ----

describe("timeline reuses the audit model (no new table)", () => {
  it("a transition maps to a safe customs audit payload", () => {
    const p = transitionAuditPayload({ declarationId: "d1", from: "SUBMITTED", to: "ACCEPTED", provider: "GAINDE", reason: null });
    expect(p.action).toBe(AuditActions.CUSTOMS_STATUS_CHANGED); // reused, no new audit code
    expect(p.entity).toBe("customs_declaration");
    expect(p.after).toEqual({ status: "ACCEPTED", provider: "GAINDE", reason: null });
  });
  it("projects stored rows into an immutable, chronological timeline", () => {
    const rows = [
      { occurredAt: "2026-07-11T10:00:00Z", actorLabel: "Agent", after: { status: "ACCEPTED", provider: "GAINDE" } },
      { occurredAt: "2026-07-10T09:00:00Z", actorLabel: "Agent", after: { status: "SUBMITTED", provider: "GAINDE" } },
      { occurredAt: "2026-07-12T08:00:00Z", actorLabel: null, after: null }, // non-status → dropped
    ];
    const t = projectTimeline(rows);
    expect(t.map((e) => e.status)).toEqual(["SUBMITTED", "ACCEPTED"]); // sorted asc, filtered
    expect(t[0].provider).toBe("GAINDE");
    expect(timelineBounds(t).last?.status).toBe("ACCEPTED");
    expect(timelineBounds([]).first).toBeNull();
  });
});

// ---------------------------------------------------------------- provider abstraction ----

describe("provider abstraction + engine facade", () => {
  it("the GAINDE provider is a STUB — not configured, every op not_configured", async () => {
    const g = new GaindeProvider();
    expect(g.name).toBe("GAINDE");
    expect(g.configured).toBe(false);
    expect(await g.submit()).toEqual({ ok: false, error: "not_configured" });
    expect(await g.poll()).toEqual({ ok: false, error: "not_configured" });
  });
  it("the manual provider acknowledges a submit but cannot poll a live status", async () => {
    const m = new ManualProvider();
    expect((await m.submit({ declarationId: "d1", reference: null, officeCode: null, regime: null }))).toMatchObject({ ok: true, status: "SUBMITTED" });
    expect(await m.poll()).toEqual({ ok: false, error: "not_configured" });
  });
  it("resolveProvider maps names; defaults to manual", () => {
    expect(resolveProvider("GAINDE").name).toBe("GAINDE");
    expect(resolveProvider("unknown").name).toBe("manual");
    expect([...CUSTOMS_PROVIDERS]).toEqual(["manual", "GAINDE"]);
  });
  it("the engine validates transitions LOCALLY and delegates external ops", async () => {
    const engine = new CustomsEngine(new ManualProvider());
    expect(engine.providerName).toBe("manual");
    expect(engine.transition("DRAFT", "SUBMITTED")).toEqual({ ok: true });
    expect(engine.transition("DRAFT", "RELEASED")).toEqual({ ok: false, reason: "invalid_transition" });
    // Poll on manual is not_configured — the engine never invents a status.
    expect(await engine.poll("SUBMITTED", "ref")).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------- dashboard contracts ----

describe("dashboard aggregate contracts (no dashboard UI)", () => {
  const decls: Declaration[] = [
    decl({ status: "SUBMITTED" }),
    decl({ status: "INSPECTION" }),
    decl({ status: "RELEASED", provider: { provider: "manual", externalReference: null, submittedAt: "2026-07-01T00:00:00Z" }, release: { reference: "B", releasedAt: "2026-07-05T00:00:00Z" }, duties: [{ code: "DD", label: "x", amount: 200, currency: "XOF" }] }),
    decl({ status: "COMPLETED", duties: [{ code: "DD", label: "x", amount: 50, currency: "XOF" }, { code: "VAT", label: "y", amount: 30, currency: "EUR" }] }),
    decl({ status: "CANCELLED" }),
  ];
  it("pending / released / inspection queue", () => {
    expect(pendingCount(decls)).toBe(2); // SUBMITTED + INSPECTION (CANCELLED is terminal, RELEASED/COMPLETED cleared)
    expect(releasedCount(decls)).toBe(2); // RELEASED + COMPLETED
    expect(inspectionQueue(decls).map((d) => d.status)).toEqual(["INSPECTION"]);
  });
  it("average clearance days from submit→release", () => {
    expect(averageClearanceDays(decls)).toBe(4); // one measurable span: 4 days
    expect(averageClearanceDays([decl()])).toBeNull();
  });
  it("duty totals per currency + daily activity", () => {
    expect(dutyTotals(decls)).toEqual([{ currency: "EUR", total: 30 }, { currency: "XOF", total: 250 }]);
    const events = [
      { occurredAt: "2026-07-10T10:00:00Z", status: "SUBMITTED" as const, provider: "m", actor: null, description: "", metadata: {} },
      { occurredAt: "2026-07-10T12:00:00Z", status: "ACCEPTED" as const, provider: "m", actor: null, description: "", metadata: {} },
      { occurredAt: "2026-07-11T09:00:00Z", status: "RELEASED" as const, provider: "m", actor: null, description: "", metadata: {} },
    ];
    expect(dailyActivity(events)).toEqual([{ date: "2026-07-10", count: 2 }, { date: "2026-07-11", count: 1 }]);
  });
  it("buildCustomsDashboard composes the contracts", () => {
    const db = buildCustomsDashboard(decls, []);
    expect(db).toMatchObject({ total: 5, pending: 2, released: 2, inspectionQueueSize: 1, averageClearanceDays: 4 });
    expect(db.statusBreakdown.SUBMITTED).toBe(1);
  });
});

// ---------------------------------------------------------------- reuse / no-duplication ----

describe("reuses everything — no new table, permission, or audit code", () => {
  it("persists additively on customs_record — no separate declaration table (7.1B)", () => {
    // 7.1B persists the canonical state as ADDITIVE columns on customs_record (reuse),
    // never a second declaration table, and adds no new RLS step to CI.
    const mig = read("../supabase/migrations/20260716000003_customs_intelligence_state.sql");
    expect(mig).toContain("alter table public.customs_record");
    expect(mig).not.toMatch(/create table/i);
  });
  it("timeline reuses the existing CUSTOMS_STATUS_CHANGED audit action", () => {
    expect(read("../lib/customs/intelligence/timeline.ts")).toContain("AuditActions.CUSTOMS_STATUS_CHANGED");
  });
  it("the modules define no new permission (RBAC unchanged)", () => {
    for (const f of ["state-machine", "provider", "dashboard", "domain", "timeline"]) {
      expect(read(`../lib/customs/intelligence/${f}.ts`)).not.toMatch(/customs:[a-z]+:|assertPermission|PLATFORM_PERMISSIONS/);
    }
  });
});
