/**
 * STEP20-INVOICE-02 — finance refusal visibility, and the empty-draft fail-open.
 *
 * Two defects, both found on EFT-IMP-2026-00013 and both about the platform
 * knowing something and not saying it.
 *
 * FIX 1. `issueInvoice` is correctly refused at step 20: issuance belongs to
 * step 22 (`billing_dispatch`), and the control gate says so. But the refusal
 * arrives as `step_gate_step_not_open`, which matched no key in the finance
 * error map and fell through to « L'action a échoué. Veuillez réessayer. » The
 * customs panel was repaired for exactly this in 2026; the finance panels never
 * were. Five `IssuanceError` variants and the submitted-to-Finance freeze were
 * unmapped for the same reason.
 *
 * FIX 2. Financial clearance asked `invoiceState === "none"`, and an invoice
 * ROW is free to create. So a DRAFT carrying 0 XOF — no lines, no number —
 * satisfied « une facture », and the dossier reported « Toutes les conditions
 * financières sont réunies » next to it.
 *
 * Neither fix changes a gate, a permission, a step or a state machine. The
 * refusals were always right; one of them was silent and the other was absent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLEARANCE_MISSING_LABELS_FR,
  evaluateFinancialClearance,
  invoiceConditionShortfall,
  type ClearanceInput,
} from "@/lib/finance/requests";
import { invoiceTotals, lineAmount } from "@/lib/finance/calc";
import { validateIssuance } from "@/lib/finance/issuance";
import { CONTROL_GATE_MESSAGE_FR, stepGateMessageFr } from "@/lib/process/control-gate";
import { t } from "@/lib/i18n";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — a pin must match CODE, never a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = "components/finance/finance-panel.tsx";
const CARD = "components/finance/invoice-card.tsx";
const CUSTOMS = "components/customs/customs-panel.tsx";
const REQUESTS = "lib/finance/requests.ts";
const ACTIONS = "lib/finance/request-actions.ts";
const FINANCE_ACTIONS = "lib/finance/actions.ts";

const errors = t.finance.errors as Record<string, string>;

/** A dossier whose every other financial condition is satisfied. */
const CLEAR: ClearanceInput = {
  requests: [{ status: "DISBURSED", evidenceStatus: "VERIFIED" }],
  openFinanceBlockers: 0,
  pendingPaymentDecision: false,
  invoiceState: "issued",
  invoiceTotal: null,
  invoiceIntentionallyDeferred: false,
};

const draft = (invoiceTotal: number | null): ClearanceInput => ({
  ...CLEAR,
  invoiceState: "draft",
  invoiceTotal,
});

// ===========================================================================
// FIX 1 — the refusals speak
// ===========================================================================
describe("Fix 1 · every process-gate refusal reaches the operator in French", () => {
  it("1 — every control-gate reason has a message, via the shared accessor", () => {
    const reasons = Object.keys(CONTROL_GATE_MESSAGE_FR);
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    for (const r of reasons) {
      const message = stepGateMessageFr(`step_gate_${r}`);
      expect(message, r).toBeTruthy();
      expect(message, r).not.toMatch(/^step_gate_/);
      expect(message, r).not.toBe(errors.generic);
    }
  });

  it("2 — THE reported case: issuance refused at step 20 now says why", () => {
    // `finance.invoice_issue` is owned by `billing_dispatch` (step 22). At step
    // 20 that row is PENDING, so the gate answers `step_not_open`.
    expect(stepGateMessageFr("step_gate_step_not_open")).toBe("Cette étape n'est pas encore ouverte.");
    expect(stepGateMessageFr("step_gate_step_not_open")).not.toBe(errors.generic);
  });

  it("3 — both finance surfaces resolve the gate FIRST, exactly as customs does", () => {
    const expected = "stepGateMessageFr(res.error) ?? (f.errors as Record<string, string>)[res.error] ?? f.errors.generic";
    for (const f of [PANEL, CARD]) {
      expect(code(f), f).toContain("stepGateMessageFr");
      expect(code(f), f).toContain(expected);
      expect(code(f), f).toContain('from "@/lib/process/control-gate"');
    }
    // The pattern is the customs panel's, not a new one.
    expect(code(CUSTOMS)).toContain("stepGateMessageFr(res.error) ??");
  });

  it("4 — a non-gate code still resolves through the finance map, unchanged", () => {
    expect(stepGateMessageFr("not_draft")).toBeNull();
    expect(stepGateMessageFr(null)).toBeNull();
    expect(stepGateMessageFr(undefined)).toBeNull();
    // …so the existing mapped errors keep their own sentences.
    for (const key of ["forbidden", "not_found", "not_draft", "no_lines", "invalid_amount"]) {
      expect(errors[key], key).toBeTruthy();
    }
  });

  it("5 — an unknown gate reason is NOT invented", () => {
    expect(stepGateMessageFr("step_gate_something_new")).toBeNull();
  });
});

describe("Fix 1 · every IssuanceError has an operator-facing message", () => {
  // The seven variants of `IssuanceError`, enumerated from the union itself.
  const ISSUANCE_ERRORS = [
    "no_lines", "invalid_amount", "zero_total", "negative_total",
    "total_too_large", "due_before_issue", "invalid_due_date",
  ] as const;

  it("6 — the union is exactly these seven (a new one must fail this test)", () => {
    const src = read("lib/finance/issuance.ts");
    const union = src.slice(src.indexOf("export type IssuanceError"), src.indexOf("export type IssuanceCheck"));
    const found = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(found.sort()).toEqual([...ISSUANCE_ERRORS].sort());
  });

  it("7 — each one is mapped, and none falls through to the generic sentence", () => {
    for (const e of ISSUANCE_ERRORS) {
      expect(errors[e], e).toBeTruthy();
      expect(errors[e], e).not.toBe(errors.generic);
    }
  });

  it("8 — the five that were missing are the five now added", () => {
    expect(errors.zero_total).toContain("nul");
    expect(errors.negative_total).toContain("négatif");
    expect(errors.total_too_large).toContain("plafond");
    expect(errors.due_before_issue).toContain("échéance");
    expect(errors.invalid_due_date).toContain("échéance");
  });

  it("9 — and the submitted-to-Finance freeze, which was unmapped too", () => {
    expect(code(FINANCE_ACTIONS)).toContain('error: "awaiting_validation"');
    expect(errors.awaiting_validation).toBeTruthy();
    expect(errors.awaiting_validation).not.toBe(errors.generic);
  });

  it("10 — every error literal this surface can return is mapped", () => {
    // Raw Postgres messages are excluded on purpose: they are not codes, and
    // `generic` is the honest answer for them.
    const literals = [...code(FINANCE_ACTIONS).matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]);
    const unmapped = [...new Set(literals)].filter((c) => !errors[c]);
    expect(unmapped, `unmapped finance error codes:\n${unmapped.join("\n")}`).toEqual([]);
  });

  it("11 — no gate behaviour changed: the surfaces call the same actions", () => {
    const src = code(CARD);
    expect(src).toContain("issueInvoice");
    // The gate itself is untouched — no surface decides sequencing.
    for (const f of [PANEL, CARD]) {
      expect(code(f), f).not.toContain("CONTROL_OWNING_STEP");
      expect(code(f), f).not.toContain("assertControlStep");
      expect(code(f), f).not.toContain("evaluateControlGate");
    }
  });
});

// ===========================================================================
// FIX 2 — an empty draft is not an invoice
// ===========================================================================
describe("Fix 2 · the empty-draft fail-open is closed", () => {
  it("12 — DRAFT with ZERO LINES does not satisfy clearance", () => {
    const total = invoiceTotals([]).total;
    expect(total).toBe(0);
    const r = evaluateFinancialClearance(draft(total));
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("invoice_without_value");
  });

  it("13 — DRAFT totalling 0 XOF does not satisfy clearance", () => {
    // A line that exists but is worth nothing — the 00013 shape once a line
    // is added with a zero amount.
    const total = invoiceTotals([{ quantity: 3, unitAmount: 0, taxRate: 0 }]).total;
    expect(total).toBe(0);
    expect(evaluateFinancialClearance(draft(total)).missing).toContain("invoice_without_value");
  });

  it("14 — DRAFT with a NEGATIVE total does not satisfy clearance", () => {
    const total = invoiceTotals([{ quantity: 1, unitAmount: -50_000, taxRate: 0 }]).total;
    expect(total).toBeLessThan(0);
    expect(evaluateFinancialClearance(draft(total)).missing).toContain("invoice_without_value");
  });

  it("15 — a SUBSTANTIVE positive DRAFT keeps its existing behaviour", () => {
    // Governance (phase-9.0e) requires « an invoice (or an explicit, reasoned
    // invoicing deferral) » — it does NOT say VALIDATED or ISSUED. So a draft
    // with real value still qualifies, exactly as before this slice.
    const total = invoiceTotals([{ quantity: 2, unitAmount: 250_000, taxRate: 18 }]).total;
    expect(total).toBeGreaterThan(0);
    const r = evaluateFinancialClearance(draft(total));
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("16 — an un-totalled draft fails CLOSED", () => {
    // A caller that forgets to total it must lose the clearance, not win it.
    expect(evaluateFinancialClearance(draft(null)).missing).toContain("invoice_without_value");
  });

  it("17 — VALIDATED / ISSUED / PARTIALLY_PAID / PAID semantics are unchanged", () => {
    for (const invoiceState of ["validated", "issued"] as const) {
      const r = evaluateFinancialClearance({ ...CLEAR, invoiceState, invoiceTotal: null });
      expect(r.ready, invoiceState).toBe(true);
      expect(r.missing, invoiceState).toEqual([]);
    }
    // PARTIALLY_PAID and PAID both resolve to the `issued` tier upstream.
    expect(code(ACTIONS)).toContain('["ISSUED", "PARTIALLY_PAID", "PAID"].includes(s)');
    // …and they are never re-gated on value.
    expect(invoiceConditionShortfall({ invoiceState: "issued", invoiceTotal: 0, invoiceIntentionallyDeferred: false })).toEqual([]);
    expect(invoiceConditionShortfall({ invoiceState: "validated", invoiceTotal: null, invoiceIntentionallyDeferred: false })).toEqual([]);
  });

  it("18 — NO invoice at all still reports invoice_not_generated, not the new code", () => {
    const r = evaluateFinancialClearance({ ...CLEAR, invoiceState: "none", invoiceTotal: null });
    expect(r.missing).toContain("invoice_not_generated");
    expect(r.missing).not.toContain("invoice_without_value");
  });

  it("19 — an explicit deferral remains governed by its existing contract", () => {
    // Unchanged: a reasoned deferral answers the invoice question outright.
    expect(evaluateFinancialClearance({
      ...CLEAR, invoiceState: "none", invoiceTotal: null, invoiceIntentionallyDeferred: true,
    }).ready).toBe(true);
    // …including over an empty draft, exactly as before.
    expect(evaluateFinancialClearance({ ...draft(0), invoiceIntentionallyDeferred: true }).ready).toBe(true);
    // And the reason is still mandatory at the action.
    expect(code(ACTIONS)).toContain("if (opts?.invoiceIntentionallyDeferred && !opts.deferralReason?.trim())");
  });

  it("20 — both shortfalls carry a French operator sentence", () => {
    for (const key of ["invoice_not_generated", "invoice_without_value"] as const) {
      expect(CLEARANCE_MISSING_LABELS_FR[key], key).toBeTruthy();
    }
    expect(CLEARANCE_MISSING_LABELS_FR.invoice_without_value).toContain("brouillon");
    // Every missing code the evaluator can emit is labelled.
    const all = evaluateFinancialClearance({
      requests: [{ status: "REQUESTED", evidenceStatus: "NONE" }, { status: "APPROVED", evidenceStatus: "NONE" },
                 { status: "DISBURSED", evidenceStatus: "SUBMITTED" }],
      openFinanceBlockers: 1, pendingPaymentDecision: true,
      invoiceState: "draft", invoiceTotal: 0, invoiceIntentionallyDeferred: false,
    });
    expect(all.missing.length).toBe(6);
    for (const m of all.missing) expect(CLEARANCE_MISSING_LABELS_FR[m], m).toBeTruthy();
  });
});

describe("Fix 2 · the other clearance conditions remain fail-closed", () => {
  it("21 — a request awaiting review still blocks", () => {
    for (const status of ["REQUESTED", "RETURNED"] as const) {
      expect(evaluateFinancialClearance({ ...CLEAR, requests: [{ status, evidenceStatus: "NONE" }] }).missing)
        .toContain("requests_awaiting_review");
    }
  });

  it("22 — approved-but-undisbursed still blocks", () => {
    expect(evaluateFinancialClearance({ ...CLEAR, requests: [{ status: "APPROVED", evidenceStatus: "NONE" }] }).missing)
      .toContain("approved_not_disbursed");
  });

  it("23 — a disbursement without VERIFIED evidence still blocks", () => {
    for (const evidenceStatus of ["NONE", "SUBMITTED", "REJECTED"] as const) {
      expect(evaluateFinancialClearance({ ...CLEAR, requests: [{ status: "DISBURSED", evidenceStatus }] }).missing)
        .toContain("evidence_missing_or_unverified");
    }
  });

  it("24 — open finance blockers and pending payment decisions still block", () => {
    expect(evaluateFinancialClearance({ ...CLEAR, openFinanceBlockers: 1 }).missing).toContain("open_finance_blockers");
    expect(evaluateFinancialClearance({ ...CLEAR, pendingPaymentDecision: true }).missing).toContain("pending_payment_decision");
  });

  it("25 — a fully settled dossier still clears", () => {
    expect(evaluateFinancialClearance(CLEAR)).toEqual({ ready: true, missing: [] });
  });
});

// ===========================================================================
// One derivation, one calculation
// ===========================================================================
describe("no second monetary opinion, no second state ladder", () => {
  it("26 — the draft total comes from the CANONICAL invoiceTotals", () => {
    const src = code(ACTIONS);
    expect(src).toContain('import { invoiceTotals } from "./calc"');
    expect(src).toContain("const { total } = invoiceTotals(");
    // No hand-rolled arithmetic over invoice lines in this module.
    expect(src).not.toMatch(/unit_amount\s*\*\s*quantity/);
    expect(src).not.toMatch(/reduce\([^)]*unit_amount/);
  });

  it("27 — and `invoiceTotals` is the same function issuance and the card use", () => {
    expect(code("lib/finance/issuance.ts")).toContain("invoiceTotals");
    expect(code("lib/collections/closure-input.ts")).toContain("invoiceTotals");
    // Behavioural: the rule and the issuance validator agree about zero.
    const zero = invoiceTotals([{ quantity: 1, unitAmount: 0, taxRate: 0 }]).total;
    expect(zero).toBe(0);
    const check = validateIssuance({ lines: [{ quantity: 1, unitAmount: 0, taxRate: 0 }], issueDate: "2026-09-29" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toBe("zero_total");
    expect(invoiceConditionShortfall({ invoiceState: "draft", invoiceTotal: zero, invoiceIntentionallyDeferred: false }))
      .toEqual(["invoice_without_value"]);
  });

  it("28 — the invoice-state ladder is derived ONCE, by one loader", () => {
    const src = code(ACTIONS);
    expect(src).toContain("async function loadInvoiceCondition(");
    // Both consumers read it; neither re-derives the ladder.
    expect((src.match(/await loadInvoiceCondition\(/g) ?? []).length).toBe(2);
    expect((src.match(/invStatuses/g) ?? []).length).toBe(0);
  });

  it("29 — a VOID invoice cannot pay for the clearance", () => {
    // Only DRAFT rows are totalled, so a voided document's lines never count.
    expect(code(ACTIONS)).toContain('rows.filter((i) => i.status === "DRAFT").map((i) => i.id)');
  });

  it("30 — lineAmount stays the single line calculation", () => {
    expect(lineAmount({ quantity: 2, unitAmount: 1_000 })).toBe(2_000);
    expect(invoiceTotals([{ quantity: 2, unitAmount: 1_000, taxRate: 0 }]).total).toBe(2_000);
  });
});

// ===========================================================================
// Scope
// ===========================================================================
describe("scope · nothing beyond Fix 1 and Fix 2", () => {
  it("31 — the Step 20→21→22 billing lane is still NOT exposed", () => {
    // Deferred deliberately (STEP20-INVOICE-01 Fix 3).
    for (const fn of ["prepareInvoiceDraft", "submitInvoiceToFinance", "approveInvoice", "emailValidatedInvoice",
                      "queuePrepareInvoice", "queueSubmitInvoice", "queueApproveInvoice", "queueEmailInvoice"]) {
      for (const f of [PANEL, CARD]) {
        expect(code(f), `${f} / ${fn}`).not.toContain(fn);
      }
    }
  });

  it("32 — no step, prerequisite, numbering or maker-checker rule moved", () => {
    const src = code(ACTIONS) + code(REQUESTS) + code(PANEL) + code(CARD);
    for (const forbidden of ["next_invoice_number", "CONTROL_OWNING_STEP", "MAKER_CHECKER_PAIRS",
                             "process_step_owning_role", "prerequisites"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("33 — this slice ships no migration", () => {
    const buildInfo = read("lib/platform/ops/build-info.ts");
    expect(buildInfo).toContain('LATEST_MIGRATION = "20261007000001_delivery_note_signed_label"');
    expect(buildInfo).toContain("MIGRATION_COUNT = 145");
  });

  it("34 — the pure evaluator stays pure", () => {
    const src = code(REQUESTS);
    expect(src).not.toMatch(/\.(insert|update|delete)\(/);
    expect(src).not.toContain("getAdminSupabaseClient");
    expect(src).not.toContain("server-only");
  });
});
