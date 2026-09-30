/**
 * STEP22-ISSUANCE-INTEGRITY-01 — an invoice is issued, or it is not.
 * ---------------------------------------------------------------------------
 * WHAT PRODUCTION PROVED. On EFT-IMP-2026-00013, official step 22 reached
 * COMPLETED while the invoice was still VALIDATED: no official number, no issue
 * date, no official document, and an `invoice_issued` email that had FAILED with
 * `provider_not_configured`. The dossier then displayed « Facture émise ».
 *
 * Three things had to be true at once for that, and each is pinned below.
 *
 *   1. `FINAL_INVOICE` — a ratified HARD_GATE — accepted any invoice that was
 *      not a DRAFT. VALIDATED satisfied it, so the gate that was supposed to
 *      protect step 22 protected nothing. EIGHT places spelled "issued" that
 *      way — seven found by the design audit and `fullyPaid` found while
 *      fixing them; all eight now ask `isIssuedStatus`.
 *   2. `billing_dispatch` was not domain-owned, so the generic « Terminer »
 *      could close it. It is now, and its fact is ISSUANCE — a status and an
 *      official number written together, which only the governed action writes.
 *   3. Issuance ran AFTER the send, so a provider failure left an official
 *      number spent and the invoice unissued. The durable facts are written
 *      first now; delivery is a separate, retryable concern.
 *
 * WHY THESE EXECUTE. Ordering, idempotency and "what happens when the provider
 * fails" are behaviour, not shape. The module boundaries are mocked and the real
 * `emailValidatedInvoice` runs against an in-memory table, exactly as
 * STEP20-BILLING-ATOMICITY-01 does — structural assertions are used only where
 * the subject is genuinely a server module this suite cannot execute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "tenant-1";
const FILE = "file-1";
const INVOICE = "inv-1";
const ISSUER = "user-billing-officer";

type Row = Record<string, unknown>;

const db: {
  invoice: Row | null;
  messages: Row[];
  counter: number;
  artifactCalls: Row[];
  providerConfigured: boolean;
  sendStatus: string;
} = {
  invoice: null,
  messages: [],
  counter: 0,
  artifactCalls: [],
  providerConfigured: true,
  sendStatus: "SENT",
};

/** A small PostgREST stand-in: filters, update, select, plus the two tables used. */
function makeClient() {
  function query(table: string, op: string, patch?: Row, opts?: { count?: string; head?: boolean }) {
    const filters: Array<(r: Row) => boolean> = [];
    const self = {
      eq(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return self;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return self;
      },
      not(col: string, _o: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) !== val);
        return self;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return self;
      },
      order: () => self,
      limit: () => self,
      select: () => self,
      maybeSingle() {
        return self.then((r: { data: Row[] | null }) => ({ data: (r.data ?? [])[0] ?? null, error: null }));
      },
      then(resolve: (v: { data: Row[] | null; error: unknown; count?: number }) => unknown) {
        const rows: Row[] =
          table === "invoice" && db.invoice
            ? [db.invoice]
            : table === "communication_message"
              ? db.messages
              : table === "invoice_line"
                ? [{ quantity: 1, unit_amount: 1_500_000, tax_rate: 0, invoice_id: INVOICE, tenant_id: TENANT }]
                : table === "client_contact"
                  ? [{ name: "Client", email: "client@example.test", is_primary: true, client_id: "client-1", tenant_id: TENANT }]
                  : table === "client"
                    ? [{ id: "client-1", name: "Client", email: "client@example.test", tenant_id: TENANT }]
                    : [];
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update" && patch) {
          matched.forEach((r) => Object.assign(r, patch));
          return Promise.resolve(resolve({ data: matched, error: null }));
        }
        if (opts?.count) return Promise.resolve(resolve({ data: null, error: null, count: matched.length }));
        return Promise.resolve(resolve({ data: matched, error: null }));
      },
    };
    return self;
  }
  return {
    from: (table: string) => ({
      select: (_c: string, o?: { count?: string; head?: boolean }) => query(table, "select", undefined, o),
      update: (patch: Row) => query(table, "update", patch),
      insert: (v: Row) => query(table, "insert", v),
    }),
    // The real counter: monotonic, never reused — exactly next_invoice_number.
    rpc: async (fn: string) => {
      if (fn !== "next_invoice_number") return { data: null, error: null };
      db.counter += 1;
      return { data: `EFT-INV-2026-${String(db.counter).padStart(5, "0")}`, error: null };
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => makeClient() }));
vi.mock("@/lib/auth/require-permission", () => ({
  assertPermission: async () => ({ id: ISSUER, tenantId: TENANT }),
}));
vi.mock("@/lib/authz/visibility", () => ({ isFileVisible: async () => true }));
vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => ["finance:create", "finance:validate", "finance:issue"],
  hasPermission: (p: string[], k: string) => p.includes(k),
}));
const audits: Row[] = [];
vi.mock("@/lib/audit/log", () => ({ writeAudit: async (a: Row) => void audits.push(a) }));
vi.mock("@/lib/comms/provider", () => ({ isProviderConfigured: () => db.providerConfigured }));
vi.mock("@/lib/comms/queue", () => ({
  queueAndSend: async () => {
    db.messages.push({ id: "m1", status: db.sendStatus, related_entity: "invoice", related_entity_id: INVOICE, tenant_id: TENANT });
    return { id: "m1", status: db.sendStatus };
  },
}));
vi.mock("@/lib/finance/invoice-artifact", () => ({
  ensureOfficialInvoiceArtifact: async (i: Row) => {
    db.artifactCalls.push({ ...i, invoiceStatusAtCall: db.invoice?.status, numberAtCall: db.invoice?.invoice_number });
    return { id: "art-1" };
  },
}));
vi.mock("@/lib/process/rollout-server", () => ({
  globalKillSwitch: () => ({ enabled: true }),
  getTenantProcessFlags: async () => ({ enabled: true }),
}));
vi.mock("@/lib/process/engine/gate-authority", () => ({ authoritativeBillingReady: async () => true }));
vi.mock("@/lib/process/engine/snapshot", () => ({
  loadProcessSnapshot: async () => ({
    instance: { id: "pi-1" },
    executions: [{ stepKey: "billing_dispatch", state: "ACTIVE", assignedUserId: null }],
    handoffs: [],
  }),
  toViews: () => [],
}));
type EngineOutcome = { ok: true; id: string } | { ok: false; error: string };
const engine = {
  submitStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  approveStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  rejectStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  activateStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
};
vi.mock("@/lib/process/engine/actions", () => ({
  submitStep: (...a: unknown[]) => engine.submitStep(...(a as [])),
  approveStep: (...a: unknown[]) => engine.approveStep(...(a as [])),
  rejectStep: (...a: unknown[]) => engine.rejectStep(...(a as [])),
  activateStep: (...a: unknown[]) => engine.activateStep(...(a as [])),
}));

const { emailValidatedInvoice } = await import("@/lib/process/billing/actions");
const { checkEvidence, hasIssuedInvoice, fullyPaid } = await import("@/lib/process/engine/evidence");
const { domainFactSatisfied, DOMAIN_OWNED_STEPS, isGenericTransitionWithdrawn } = await import(
  "@/lib/process/domain-owned-steps"
);
const { isIssuedStatus, ISSUED_STATUSES } = await import("@/lib/finance/status");
const { billingQueueState, BILLING_ERROR_FR } = await import("@/lib/process/billing/state");

const snap = (statuses: string[], finance = true) =>
  ({
    fileType: "IMP",
    access: { documents: true, customs: true, transport: true, finance },
    documents: [],
    customs: null,
    transport: null,
    invoices: statuses.map((status) => ({ status, balance: 0 })),
  }) as Parameters<typeof checkEvidence>[1];

const snapWithBalance = (invoices: { status: string; balance: number }[]) =>
  ({
    fileType: "IMP",
    access: { documents: true, customs: true, transport: true, finance: true },
    documents: [],
    customs: null,
    transport: null,
    invoices,
  }) as Parameters<typeof checkEvidence>[1];

const fact = (over: Row = {}) => ({
  status: "VALIDATED",
  submittedAt: "t",
  validatedAt: "t",
  rejectionReason: null,
  invoiceNumber: null,
  ...over,
}) as Parameters<typeof domainFactSatisfied>[2][number];

function seed(over: Row = {}) {
  db.invoice = {
    id: INVOICE,
    file_id: FILE,
    tenant_id: TENANT,
    client_id: "client-1",
    status: "VALIDATED",
    submitted_by: "maker",
    submitted_at: "t",
    validated_by: "checker",
    validated_at: "t",
    rejection_reason: null,
    revision: 1,
    invoice_number: null,
    issue_date: null,
    due_date: null,
    issued_by: null,
    ...over,
  };
}

beforeEach(() => {
  seed();
  db.messages = [];
  db.counter = 0;
  db.artifactCalls = [];
  db.providerConfigured = true;
  db.sendStatus = "SENT";
  audits.length = 0;
  for (const f of Object.values(engine)) f.mockClear();
  engine.submitStep.mockResolvedValue({ ok: true, id: "x" });
});
afterEach(() => vi.restoreAllMocks());

// ============================================ A/B — VALIDATED is not ISSUED ====

describe("VALIDATED is not ISSUED", () => {
  it("A — a VALIDATED invoice does NOT satisfy FINAL_INVOICE", () => {
    const item = checkEvidence("FINAL_INVOICE", snap(["VALIDATED"]));
    expect(item.status).not.toBe("satisfied");
    expect(item.status).toBe("pending_review");
    expect(item.detail).toBe("invoice_not_issued");
  });

  it("…and each issued status does", () => {
    for (const status of ISSUED_STATUSES) {
      expect(checkEvidence("FINAL_INVOICE", snap([status])).status, status).toBe("satisfied");
    }
  });

  it("…while a DRAFT and an absent invoice stay distinguishable", () => {
    expect(checkEvidence("FINAL_INVOICE", snap(["DRAFT"])).detail).toBe("invoice_not_validated");
    expect(checkEvidence("FINAL_INVOICE", snap([])).detail).toBe("no_invoice");
    expect(checkEvidence("FINAL_INVOICE", snap(["VALIDATED"], false)).status).toBe("unauthorized");
  });

  it("B — fullyPaid counts only issued invoices", () => {
    // The eighth site. Only an issued invoice can be collected, so only an issued
    // one can be fully paid — a zero-balance VALIDATED row must not settle a dossier.
    expect(fullyPaid(snapWithBalance([{ status: "VALIDATED", balance: 0 }]))).toBe(false);
    expect(fullyPaid(snapWithBalance([{ status: "ISSUED", balance: 0 }]))).toBe(true);
    expect(fullyPaid(snapWithBalance([{ status: "ISSUED", balance: 5 }]))).toBe(false);
  });

  it("B — hasIssuedInvoice refuses VALIDATED, so closure cannot treat it as billed", () => {
    expect(hasIssuedInvoice(snap(["VALIDATED"]))).toBe(false);
    expect(hasIssuedInvoice(snap(["DRAFT"]))).toBe(false);
    expect(hasIssuedInvoice(snap(["VOID"]))).toBe(false);
    for (const status of ISSUED_STATUSES) {
      expect(hasIssuedInvoice(snap([status])), status).toBe(true);
    }
  });

  it("the predicate lives in ONE place and every reader asks it", () => {
    expect(isIssuedStatus("VALIDATED")).toBe(false);
    expect(ISSUED_STATUSES).toEqual(["ISSUED", "PARTIALLY_PAID", "PAID"]);
    const root = join(__dirname, "..");
    const src = (p: string) =>
      readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const f of [
      "lib/process/engine/evidence.ts",
      "lib/finance/status.ts",
      "lib/finance/service.ts",
      "lib/files/lifecycle.ts",
      "lib/bi/aggregate.ts",
      "lib/handoffs/service.ts",
      "components/finance/invoice-card.tsx",
    ]) {
      expect(src(f), f).toContain("isIssuedStatus");
      expect(src(f), `${f} still spells "issued" as "not a draft"`).not.toMatch(
        /status !== "DRAFT" && .*status !== "VOID"/,
      );
    }
  });

  it("« Facture émise » is not claimed for an issued invoice whose send failed", () => {
    const issued = {
      id: INVOICE, status: "ISSUED" as const, submittedBy: "m", submittedAt: "t",
      validatedBy: "c", validatedAt: "t", rejectionReason: null, revision: 1, lineCount: 1,
    };
    expect(billingQueueState(issued, true, "failed")).toBe("email_failed_retry");
    expect(billingQueueState(issued, true, "sent")).toBe("emailed");
  });
});

// ================================================= C — the generic bypass ======

describe("the generic control can no longer close step 22", () => {
  it("C — billing_dispatch is domain-owned and its submit is withdrawn", () => {
    expect(DOMAIN_OWNED_STEPS.billing_dispatch).toBeTruthy();
    expect(DOMAIN_OWNED_STEPS.billing_dispatch.withdraws).toEqual(["submit"]);
    expect(isGenericTransitionWithdrawn("billing_dispatch", "submit")).toBe(true);
  });

  it("C — the fact is ISSUANCE: a status AND an official number", () => {
    // The exact 00013 shape: validated, no number.
    expect(domainFactSatisfied("billing_dispatch", "submit", [fact()])).toBe(false);
    // A number alone, or an issued status alone, is not enough either.
    expect(domainFactSatisfied("billing_dispatch", "submit", [fact({ invoiceNumber: "EFT-INV-2026-00002" })])).toBe(false);
    expect(domainFactSatisfied("billing_dispatch", "submit", [fact({ status: "ISSUED" })])).toBe(false);
    expect(
      domainFactSatisfied("billing_dispatch", "submit", [fact({ status: "ISSUED", invoiceNumber: "EFT-INV-2026-00002" })]),
    ).toBe(true);
  });

  it("the rule is keyed on the STEP, so step 20's fact cannot admit step 22", () => {
    const submittedDraft = [fact({ status: "DRAFT", invoiceNumber: null })];
    expect(domainFactSatisfied("billing_draft", "submit", submittedDraft)).toBe(true);
    expect(domainFactSatisfied("billing_dispatch", "submit", submittedDraft)).toBe(false);
  });

  /**
   * The loader is `server-only` and cannot be executed here, so the one thing a
   * unit test can hold is that it READS the column rather than supplying a value
   * of its own — the same structural pin BILLING-BYPASS-01 keeps on this file,
   * and the reason its ninth probe once survived.
   */
  it("the guard reads the official number from the ROW, never a literal", () => {
    const root = join(__dirname, "..");
    const g = readFileSync(join(root, "lib/process/engine/domain-owned-guard.ts"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(g).toContain("invoice_number");
    expect(g).toContain("invoiceNumber: (i.invoice_number as string | null) ?? null");
    // No fact field is ever assigned a string literal.
    expect(g).not.toMatch(/invoiceNumber:\s*"/);
    expect(g).not.toMatch(/status:\s*"/);
  });

  it("fails closed for an unknown domain-owned step", () => {
    expect(domainFactSatisfied("some_future_step", "submit", [fact({ status: "PAID", invoiceNumber: "n" })])).toBe(false);
  });
});

// ======================================= D/E/F/G/H — the governed action =======

describe("governed issuance", () => {
  it("D — establishes every durable fact, in one CAS, before the send", async () => {
    const res = await emailValidatedInvoice(INVOICE);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(db.invoice!.status).toBe("ISSUED");
    expect(db.invoice!.invoice_number).toBe("EFT-INV-2026-00001");
    expect(db.invoice!.issued_by).toBe(ISSUER);
    expect(db.invoice!.issue_date).toBeTruthy();
    expect(engine.submitStep).toHaveBeenCalledWith(FILE, "billing_dispatch");
  });

  it("E — the artifact is produced only once the invoice is genuinely ISSUED", async () => {
    await emailValidatedInvoice(INVOICE);
    expect(db.artifactCalls).toHaveLength(1);
    expect(db.artifactCalls[0].invoiceStatusAtCall, "never for a non-issued invoice").toBe("ISSUED");
    expect(db.artifactCalls[0].numberAtCall).toBe("EFT-INV-2026-00001");
  });

  it("F — a configured provider that fails does NOT undo issuance, and step 22 still completes", async () => {
    db.sendStatus = "FAILED";

    const res = await emailValidatedInvoice(INVOICE);

    expect(res.ok).toBe(true);
    expect(db.invoice!.status, "issuance stands").toBe("ISSUED");
    expect(db.invoice!.invoice_number).toBe("EFT-INV-2026-00001");
    expect(db.artifactCalls).toHaveLength(1);
    expect(db.messages[0].status, "the failure stays visible").toBe("FAILED");
    expect(engine.submitStep).toHaveBeenCalled();
    const failed = audits.find((a) => a.action === "invoice.email.failed")!;
    expect((failed.after as Row).retryable).toBe(true);
    expect((failed.after as Row).invoice_issued).toBe(true);
  });

  it("G — provider_not_configured refuses BEFORE a number is spent, and step 22 does not complete", async () => {
    db.providerConfigured = false;

    const res = await emailValidatedInvoice(INVOICE);

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("delivery_not_configured");
    expect(db.counter, "no official number may be burned on an impossible send").toBe(0);
    expect(db.invoice!.status).toBe("VALIDATED");
    expect(db.invoice!.invoice_number).toBeNull();
    expect(db.artifactCalls).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(engine.submitStep).not.toHaveBeenCalled();
    expect(BILLING_ERROR_FR.delivery_not_configured).toBeTruthy();
  });

  it("H — a retry reuses the number and does not issue twice", async () => {
    db.sendStatus = "FAILED";
    await emailValidatedInvoice(INVOICE);
    const first = db.invoice!.invoice_number;
    expect(db.counter).toBe(1);

    // The invoice is ISSUED now, so the governed action refuses re-issuance
    // outright — delivery retry is the outbox's job, not a second issuance.
    const again = await emailValidatedInvoice(INVOICE);
    expect(again.ok).toBe(false);
    expect((again as { error: string }).error).toBe("invoice_not_validated");
    expect(db.invoice!.invoice_number, "the same number").toBe(first);
    expect(db.counter, "the counter did not advance again").toBe(1);
    expect(db.artifactCalls, "no second, conflicting artifact").toHaveLength(1);
  });

  it("H — and a row that already carries a number never asks for another", async () => {
    seed({ invoice_number: "EFT-INV-2026-00042" });
    await emailValidatedInvoice(INVOICE);
    expect(db.counter, "reuse, not allocate").toBe(0);
    expect(db.invoice!.invoice_number).toBe("EFT-INV-2026-00042");
  });

  it("an already-SENT invoice is idempotent and sends nothing twice", async () => {
    db.messages.push({ id: "m0", status: "SENT", related_entity: "invoice", related_entity_id: INVOICE, tenant_id: TENANT });
    const res = await emailValidatedInvoice(INVOICE);
    expect(res.ok).toBe(true);
    expect(db.counter).toBe(0);
    expect(db.invoice!.status).toBe("VALIDATED");
  });

  it("refuses an invoice that is not VALIDATED at all", async () => {
    seed({ status: "DRAFT", validated_at: null });
    const res = await emailValidatedInvoice(INVOICE);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("invoice_not_validated");
    expect(db.counter).toBe(0);
  });
});

// ================================================ I/J/K — the neighbours =======

describe("neighbouring contracts", () => {
  const root = join(__dirname, "..");
  const src = (p: string) =>
    readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("I — step 23 needs genuine issuance too", () => {
    // Its own FINAL_INVOICE requirement resolves through the same predicate.
    expect(checkEvidence("FINAL_INVOICE", snap(["VALIDATED"])).status).not.toBe("satisfied");
    expect(checkEvidence("FINAL_INVOICE", snap(["ISSUED"])).status).toBe("satisfied");
  });

  it("J — steps 20 and 21 keep their PR #20 behaviour", () => {
    expect(DOMAIN_OWNED_STEPS.billing_draft.withdraws).toEqual(["submit"]);
    expect(DOMAIN_OWNED_STEPS.finance_invoice_validation.withdraws).toEqual(["approve", "reject"]);
    const a = src("lib/process/billing/actions.ts");
    expect(a).toContain("draftStepPlan(exec ?? null, ctx.userId)");
    expect(a).toContain("compensationOutcome(");
    expect((a.match(/await compensationOutcome\(/g) ?? []).length).toBe(3);
  });

  it("K — maker/checker is untouched", () => {
    const s = src("lib/process/billing/state.ts");
    expect((s.match(/error: "self_approval_forbidden"/g) ?? []).length).toBe(1);
    expect(s).toContain("submittedBy && inv.submittedBy === checkerId");
  });

  it("no migration, no schema change, and numbering is not redesigned", () => {
    const a = src("lib/process/billing/actions.ts");
    expect(a).not.toMatch(/\b(alter table|create table|create or replace function|grant )/i);
    // Exactly one allocation site, and it is guarded by the reuse check.
    expect((a.match(/next_invoice_number/g) ?? []).length).toBe(1);
    expect(a).toContain("if (!invoiceNumber) {");
  });
});
