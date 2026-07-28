/**
 * UAT-2A — Finance issuance validation, issuance UX, and reporting reconciliation.
 *
 * Three defects confirmed in production UAT:
 *   * a draft totalling 0 XOF could be ISSUED, burning an official invoice
 *     number on a document with no accounting meaning;
 *   * issuance opened a native `window.prompt` for the due date;
 *   * dashboards reported "awaiting POD" and missing documents for a dossier
 *     whose delivery note the dossier page already showed as verified, because
 *     those aggregates still compared to the pre-WES-4 "APPROVED" literal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateIssuance, dueDateFromTerm, PAYMENT_TERMS, DEFAULT_PAYMENT_TERM_DAYS } from "@/lib/finance/issuance";
import { invoiceTotals, MAX_LINE_AMOUNT } from "@/lib/finance/calc";
import { isVerified } from "@/lib/documents/doctrine";
import { getDossierLifecycle, type LifecycleInput } from "@/lib/files/lifecycle";
import { buildCanonicalProjection } from "@/lib/workflow/projection";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const line = (over: Partial<{ quantity: number; unitAmount: number; taxRate: number }> = {}) => ({
  description: "Prestation",
  quantity: 1,
  unitAmount: 750_000,
  taxRate: 0,
  ...over,
});
const ISSUE = "2026-07-28";

// ---------------------------------------------------------------------------
describe("issuance validation — the authority is the server", () => {
  it("accepts the UAT fixture: one line of 750 000 XOF", () => {
    const r = validateIssuance({ lines: [line()], issueDate: ISSUE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe(750_000);
  });

  it("REFUSES an empty invoice", () => {
    expect(validateIssuance({ lines: [], issueDate: ISSUE })).toEqual({ ok: false, error: "no_lines" });
  });

  it("REFUSES a zero total — the defect that burned an invoice number", () => {
    const r = validateIssuance({ lines: [line({ unitAmount: 0 })], issueDate: ISSUE });
    expect(r).toEqual({ ok: false, error: "zero_total" });
  });

  it("REFUSES negative quantity and negative unit price", () => {
    expect(validateIssuance({ lines: [line({ quantity: -1 })], issueDate: ISSUE }).ok).toBe(false);
    expect(validateIssuance({ lines: [line({ unitAmount: -5 })], issueDate: ISSUE }).ok).toBe(false);
  });

  it("REFUSES malformed numbers — NaN and Infinity", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(validateIssuance({ lines: [line({ unitAmount: bad })], issueDate: ISSUE }).ok, String(bad)).toBe(false);
      expect(validateIssuance({ lines: [line({ quantity: bad })], issueDate: ISSUE }).ok, String(bad)).toBe(false);
    }
  });

  it("REFUSES an invalid tax rate", () => {
    expect(validateIssuance({ lines: [line({ taxRate: -1 })], issueDate: ISSUE }).ok).toBe(false);
    expect(validateIssuance({ lines: [line({ taxRate: 101 })], issueDate: ISSUE }).ok).toBe(false);
  });

  it("REFUSES an overflowing total", () => {
    const r = validateIssuance({ lines: [line({ unitAmount: MAX_LINE_AMOUNT, quantity: 1 })], issueDate: ISSUE });
    // one line at the cap is allowed; two are not
    const two = validateIssuance({
      lines: [line({ unitAmount: MAX_LINE_AMOUNT }), line({ unitAmount: MAX_LINE_AMOUNT })],
      issueDate: ISSUE,
    });
    expect(r.ok).toBe(true);
    expect(two).toEqual({ ok: false, error: "total_too_large" });
  });

  it("the validated total equals the persisted lines' total — one formula", () => {
    const lines = [line(), line({ unitAmount: 250_000, taxRate: 18 })];
    const r = validateIssuance({ lines, issueDate: ISSUE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe(invoiceTotals(lines).total);
  });
});

// ---------------------------------------------------------------------------
describe("due date", () => {
  it("REFUSES a due date before the issue date", () => {
    expect(validateIssuance({ lines: [line()], issueDate: ISSUE, dueDate: "2026-07-27" }))
      .toEqual({ ok: false, error: "due_before_issue" });
  });

  it("accepts the issue date itself (comptant)", () => {
    expect(validateIssuance({ lines: [line()], issueDate: ISSUE, dueDate: ISSUE }).ok).toBe(true);
  });

  it("REFUSES a malformed due date", () => {
    for (const bad of ["28/07/2026", "2026-13-45", "demain", "2026-7-8"]) {
      expect(validateIssuance({ lines: [line()], issueDate: ISSUE, dueDate: bad }).ok, bad).toBe(false);
    }
  });

  it("treats an omitted due date as valid and defaults to 30 days", () => {
    expect(validateIssuance({ lines: [line()], issueDate: ISSUE, dueDate: null }).ok).toBe(true);
    expect(validateIssuance({ lines: [line()], issueDate: ISSUE, dueDate: "" }).ok).toBe(true);
    expect(dueDateFromTerm(ISSUE, DEFAULT_PAYMENT_TERM_DAYS)).toBe("2026-08-27");
  });

  it("computes the offered terms correctly", () => {
    expect(PAYMENT_TERMS.map((t) => t.days)).toEqual([0, 15, 30, 45, null]);
    expect(dueDateFromTerm(ISSUE, 0)).toBe(ISSUE);
    expect(dueDateFromTerm(ISSUE, 15)).toBe("2026-08-12");
  });

  it("the server validates before allocating a number", () => {
    const src = code("lib/finance/actions.ts");
    const fn = src.slice(src.indexOf("export async function issueInvoice"), src.indexOf("export async function voidInvoice"));
    const validate = fn.indexOf("validateIssuance(");
    const allocate = fn.indexOf("next_invoice_number");
    expect(validate).toBeGreaterThan(-1);
    expect(allocate).toBeGreaterThan(validate); // numbering happens AFTER validation
    expect(fn).toContain("if (!check.ok) return { ok: false, error: check.error };");
  });
});

// ---------------------------------------------------------------------------
describe("issuance UX — no native prompts", () => {
  it("no window.prompt remains anywhere in Finance", () => {
    for (const f of [
      "components/finance/invoice-card.tsx",
      "components/finance/reconciliation-actions.tsx",
      "components/finance/finance-panel.tsx",
    ]) {
      expect(code(f), f).not.toContain("window.prompt");
      expect(code(f), f).not.toContain("window.confirm");
      expect(code(f), f).not.toContain("window.alert");
    }
  });

  it("the dialog is accessible and keyboard-operable", () => {
    const d = code("components/finance/prompt-dialog.tsx");
    expect(d).toContain('role="dialog"');
    expect(d).toContain('aria-modal="true"');
    expect(d).toContain("aria-labelledby");
    expect(d).toContain('e.key === "Escape"');
    expect(d).toContain('e.key === "Enter"');
    expect(d).toContain("fieldRef.current?.focus()");
  });

  it("uses a native date input and blocks an early due date client-side too", () => {
    const d = code("components/finance/prompt-dialog.tsx");
    expect(d).toContain('type={mode === "date" ? "date" : "text"}');
    expect(d).toContain("value < (minDate as string)");
  });

  it("ONE dialog serves all three flows", () => {
    expect(code("components/finance/invoice-card.tsx")).toContain("PromptDialog");
    expect(code("components/finance/reconciliation-actions.tsx")).toContain("PromptDialog");
  });
});

// ---------------------------------------------------------------------------
describe("reporting reconciliation — every surface uses canonical doctrine", () => {
  const SURFACES = [
    "lib/files/lifecycle.ts",
    "lib/workflow/projection.ts",
    "lib/control-tower/service.ts",
    "lib/collections/closure-input.ts",
    "lib/copilot/context.ts",
    "lib/portal/shipments.ts",
    "lib/portal/tracking.ts",
    "lib/bi/aggregate.ts",
    "lib/customer-notify/triggers.ts",
    "lib/handoffs/triggers.ts",
    "lib/departments/classify.ts",
    "lib/customs/actions.ts",
    "lib/customs/service.ts",
    "lib/process/engine/service.ts",
    "lib/process/panels/transport.ts",
    "lib/process/queues/control-tower.ts",
    "lib/process/queues/service.ts",
  ];

  it("no document-status surface compares to the legacy APPROVED literal", () => {
    for (const f of SURFACES) {
      expect(code(f), f).not.toMatch(/d\.status === "APPROVED"/);
    }
  });

  it("each one uses the canonical predicate instead", () => {
    for (const f of SURFACES) {
      expect(code(f), f).toContain("isVerified");
    }
  });

  it("a VERIFIED POD is not reported as awaiting POD", () => {
    expect(isVerified("VERIFIED")).toBe(true);
    expect(isVerified("CONSUMED_AS_EVIDENCE")).toBe(true);
    expect(isVerified("APPROVED")).toBe(true);
  });

  it("the canonical ratchet advances on a VERIFIED document", () => {
    const base: LifecycleInput = {
      fileId: "f", file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "VERIFIED" }], missingRequired: [],
      customs: null, transport: null, invoices: [], podApproved: false,
    };
    // Before the fix this ordinal was never reached for a VERIFIED document.
    expect(buildCanonicalProjection(base)).not.toBeNull();
    const legacy = buildCanonicalProjection({ ...base, documents: [{ status: "APPROVED" }] });
    expect(buildCanonicalProjection(base)?.progressPercent).toBe(legacy?.progressPercent);
  });

  it("the lifecycle counts a VERIFIED document as collected", () => {
    const mk = (status: string): LifecycleInput => ({
      fileId: "f", file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status }], missingRequired: [{ label: "BL" }],
      customs: null, transport: null, invoices: [], podApproved: false,
    });
    // VERIFIED and APPROVED must produce identical lifecycle answers.
    expect(getDossierLifecycle(mk("VERIFIED")).currentStep)
      .toBe(getDossierLifecycle(mk("APPROVED")).currentStep);
  });

  it("leaves NON-document APPROVED statuses alone (finance_request)", () => {
    // A mechanical global replace would have corrupted these.
    expect(read("lib/finance/requests.ts")).toContain('r.status === "APPROVED"');
    expect(read("lib/operations/compose.ts")).toContain('r.status === "APPROVED"');
  });
});

// ---------------------------------------------------------------------------
describe("early verified POD", () => {
  it("shows a remediation message instead of failing silently", () => {
    const p = code("components/transport/delivery-proof-panel.tsx");
    expect(p).toMatch(/if \(verified && rank !== "DELIVERED" && rank !== "POD_RECEIVED"\)/);
    expect(p).toContain("le transport n&apos;est pas encore marqué comme livré");
    expect(p).toContain("poursuivre automatiquement vers la Finance");
  });

  it("converges automatically when DELIVERED is later recorded — no re-verification", () => {
    const src = code("lib/transport/actions.ts");
    expect(src).toMatch(/if \(toStatus === "DELIVERED"\) \{[\s\S]{0,240}recordPodReceiptFromVerifiedEvidence/);
  });

  it("does NOT auto-correct the transport state from the panel", () => {
    // It READS the status to decide what to say; it must never WRITE it.
    const p = code("components/transport/delivery-proof-panel.tsx");
    expect(p).not.toContain("changeTransportStatus");
    expect(p).not.toContain("recordPodReceiptFromVerifiedEvidence");
    expect(p).not.toMatch(/"use client"|onClick|action=/);
  });

  it("the receipt stays idempotent on the convergence path", () => {
    const r = code("lib/transport/pod-receipt.ts");
    expect(r).toMatch(/\.eq\("status", "DELIVERED"\)/);
    expect(r).toMatch(/if \(transport\.status === "POD_RECEIVED"\) return "already";/);
  });
});

// ---------------------------------------------------------------------------
describe("navigation and action visibility", () => {
  it("the lifecycle Ouvrir targets the CURRENT dossier's finance section", () => {
    expect(code("lib/files/lifecycle.ts")).toContain('finance: "#finance"');
    expect(code("lib/files/lifecycle.ts")).toContain("`/files/${input.fileId}${ANCHOR[r.department]}`");
  });

  it("the cockpit card names its destination honestly", () => {
    const c = code("components/operations/finance-pipeline-card.tsx");
    expect(c).toContain('label: "Finance / Facturation"');
    expect(c).not.toContain('label: "Ouvrir Finance"');
  });

  it("Finance roles can VIEW artifacts but cannot generate them", () => {
    // Generation is gated on transport:manage, which no Finance role holds.
    expect(code("app/files/[id]/page.tsx")).toContain('hasPermission(permissions, "transport:manage")');
    const t = read("lib/platform/role-templates.ts");
    // Slice to the NEXT role, not a fixed byte count — a fixed window ran into
    // the following role's permission list.
    const start = t.indexOf('key: "FINANCE_OFFICER"');
    const next = t.indexOf('key: "', start + 10);
    const finance = t.slice(start, next > start ? next : undefined);
    expect(finance).not.toContain('"transport:manage"');
  });
});

// ---------------------------------------------------------------------------
describe("scope discipline", () => {
  it("ships no migration in UAT-2A", () => {
    expect(code("lib/finance/issuance.ts")).not.toMatch(/create table|alter table/i);
  });

  it("adds no invoice PDF, artifact or download — that is UAT-2B", () => {
    const s = code("lib/finance/actions.ts") + code("lib/finance/issuance.ts");
    expect(s).not.toContain("OFFICIAL_INVOICE");
    expect(s).not.toContain("%PDF");
  });

  it("does not alter the payment maker-checker split", () => {
    const s = code("lib/finance/actions.ts");
    for (const fn of ["recordPayment", "verifyPayment", "rejectPayment", "reversePayment"]) {
      expect(s).toContain(`export async function ${fn}`);
    }
  });
});
