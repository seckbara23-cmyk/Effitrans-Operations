/**
 * CTRL-C-4A — official invoice numbers, against a real database.
 * ===========================================================================
 * The structural half lives in tests/ctrl-c-4a-issuance-atomicity.test.ts. This
 * file proves the behaviour that no amount of source reading can: that two
 * requests genuinely in flight against PostgreSQL produce one issuance, one
 * number and one audit row.
 *
 * WHY THESE FIXTURES OPEN NO WORKFLOW. Legacy `issueInvoice` consults
 * `assertControlStep`, which ALLOWS when a dossier has no process instance.
 * That is the legacy lane's own reachable condition and the one this slice must
 * make atomic. It is also, separately, the CTRL-C-3 control bypass — recorded
 * here as the condition under test, never endorsed. Nothing in this file
 * asserts that invoicing without a verified delivery note is acceptable.
 *
 * SAME IDENTITY ON BOTH SIDES OF EVERY RACE. `./identity` holds the current
 * user in a module variable, so two DIFFERENT identities in flight would race
 * the identity rather than the row and would prove nothing about the database.
 * Two requests from one Finance officer is also the realistic shape: a
 * double-submitted form, or a retried click.
 *
 * NUMBERING IS UNIQUE, NOT GAPLESS. `next_invoice_number` is an atomic upsert
 * on `invoice_counter`, so concurrent callers receive DISTINCT values. A caller
 * that draws a number and is then refused leaves that value unused. Case A
 * asserts that gap explicitly rather than pretending it does not exist: a gap
 * is the correct outcome, because the alternative is a second official number
 * on an already-issued invoice.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as } from "./identity";
import { identity, db, invoiceMoney, auditFor, TENANT_A, CLIENT_NO_DEPOSIT } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { createInvoice, addInvoiceLine, issueInvoice } from "@/lib/finance/actions";

let am: CurrentUser; // ACCOUNT_MANAGER — the only journey identity holding file:create
let finance: CurrentUser; // FINANCE_OFFICER — holds finance:create, :update and :issue

type Draft = { fileId: string; invoiceId: string };

/** A dossier carrying a DRAFT invoice with one billable line. No workflow. */
async function billableDraft(tag: string, withLine = true): Promise<Draft> {
  const created = await as(am, () =>
    createFile({
      type: "IMP",
      clientId: CLIENT_NO_DEPOSIT,
      priority: "normal",
      shipment: {
        transportMode: "SEA",
        origin: "JOURNEY ORIGIN",
        destination: "Dakar",
        blAwbRef: `C4A-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      },
    }),
  );
  expect(created.ok, `createFile failed: ${JSON.stringify(created)}`).toBe(true);
  const fileId = (created as { id: string }).id;

  const inv = await as(finance, () => createInvoice(fileId));
  expect(inv.ok, `createInvoice failed: ${JSON.stringify(inv)}`).toBe(true);
  const invoiceId = (inv as { id: string }).id;

  if (withLine) {
    const line = await as(finance, () =>
      addInvoiceLine(invoiceId, {
        description: `Prestation — ${tag}`,
        quantity: 1,
        unitAmount: 150000,
        taxRate: 18,
      }),
    );
    expect(line.ok, `addInvoiceLine failed: ${JSON.stringify(line)}`).toBe(true);
  }

  return { fileId, invoiceId };
}

/** The tenant's official-number counter for the current year. ASSERTION ONLY. */
async function counter(): Promise<number> {
  const year = new Date().getFullYear();
  const { data } = await db()
    .from("invoice_counter")
    .select("next_seq")
    .eq("tenant_id", TENANT_A)
    .eq("year", year)
    .maybeSingle<{ next_seq: number }>();
  return data?.next_seq ?? 0;
}

const NUMBER_SHAPE = /^EFT-INV-\d{4}-\d{5}$/;

/**
 * Either refusal is honest, and which one arrives depends on scheduling: the
 * eligibility read answers `not_draft` when it happens after the winner
 * committed, and the compare-and-set answers `already_issued` when both read a
 * DRAFT before either wrote. Pinning one would pin the scheduler.
 */
const REFUSALS = ["already_issued", "not_draft"];

let A: Draft;
let C1: Draft;
let C2: Draft;
let D: Draft;
let E: Draft;

beforeAll(async () => {
  am = await identity("am");
  finance = await identity("finance");

  A = await billableDraft("A");
  C1 = await billableDraft("C1");
  C2 = await billableDraft("C2");
  D = await billableDraft("D", false); // deliberately no line: refused before allocation
  E = await billableDraft("E");
});

// ═══════════ A — two requests for ONE invoice, genuinely concurrent ═════════

describe("CTRL-C-4A / A — two concurrent issuances of the same invoice", () => {
  it("A.1 — exactly one succeeds, and the loser is refused", async () => {
    const before = await counter();

    const [x, y] = await Promise.all([
      as(finance, () => issueInvoice(A.invoiceId)),
      as(finance, () => issueInvoice(A.invoiceId)),
    ]);

    const won = [x, y].filter((r) => r.ok);
    const lost = [x, y].filter((r) => !r.ok);
    expect(won, `exactly one must succeed: ${JSON.stringify([x, y])}`).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(REFUSALS, JSON.stringify(lost[0])).toContain((lost[0] as { error: string }).error);

    // THE INTEGRITY CLAIM. Before the fence, both wrote: the invoice ended up
    // carrying the second number, the first was lost, and two audit rows each
    // named a different number for one invoice.
    const money = await invoiceMoney(A.invoiceId);
    expect(money.status).toBe("ISSUED");
    expect(money.invoiceNumber).toMatch(NUMBER_SHAPE);

    const audit = await auditFor("invoice.issued", A.invoiceId);
    expect(audit).toHaveLength(1);
    expect((audit[0].after as { invoice_number?: string } | null)?.invoice_number).toBe(money.invoiceNumber);

    // UNIQUE, NOT GAPLESS — asserted rather than glossed. Both calls drew a
    // value from the atomic counter, so it advanced twice while exactly one
    // number landed on an invoice. That unused value is a gap, and a gap is the
    // safe outcome.
    const after = await counter();
    expect(after - before).toBe(2);
  });

  it("A.2 — the losing request wrote nothing at all", async () => {
    // One issuance, one number, one audit row, and no second invoice row on the
    // dossier that a failed-then-retried write might have produced.
    const { data: rows } = await db()
      .from("invoice")
      .select("id, status, invoice_number, issued_by")
      .eq("file_id", A.fileId)
      .eq("tenant_id", TENANT_A);
    expect(rows ?? []).toHaveLength(1);
    expect((rows ?? [])[0].status).toBe("ISSUED");
    expect((rows ?? [])[0].issued_by).toBe(finance.id);

    // and the number is unique across the tenant, which the schema also enforces
    const num = (rows ?? [])[0].invoice_number as string;
    const { data: sameNumber } = await db()
      .from("invoice")
      .select("id")
      .eq("tenant_id", TENANT_A)
      .eq("invoice_number", num);
    expect(sameNumber ?? []).toHaveLength(1);
  });
});

// ═══════════ B — the same request again, after it succeeded ════════════════

describe("CTRL-C-4A / B — a repeated issuance changes nothing", () => {
  it("B.1 — refused, with no new number and no second audit row", async () => {
    const beforeMoney = await invoiceMoney(A.invoiceId);
    const beforeSeq = await counter();

    const again = await as(finance, () => issueInvoice(A.invoiceId));
    expect(again.ok).toBe(false);
    expect(REFUSALS, JSON.stringify(again)).toContain((again as { error: string }).error);

    const afterMoney = await invoiceMoney(A.invoiceId);
    expect(afterMoney.invoiceNumber).toBe(beforeMoney.invoiceNumber);
    expect(afterMoney.status).toBe("ISSUED");
    expect(await auditFor("invoice.issued", A.invoiceId)).toHaveLength(1);

    // A repeat is refused by the eligibility read BEFORE the allocator is
    // called, so it does not even consume a value: the counter is untouched.
    expect(await counter()).toBe(beforeSeq);
  });
});

// ═══════════ C — two DIFFERENT invoices at once ════════════════════════════

describe("CTRL-C-4A / C — concurrent numbering of two invoices", () => {
  it("C.1 — both succeed with distinct numbers and no collision", async () => {
    const [r1, r2] = await Promise.all([
      as(finance, () => issueInvoice(C1.invoiceId)),
      as(finance, () => issueInvoice(C2.invoiceId)),
    ]);
    expect(r1.ok, `C1 failed: ${JSON.stringify(r1)}`).toBe(true);
    expect(r2.ok, `C2 failed: ${JSON.stringify(r2)}`).toBe(true);

    const m1 = await invoiceMoney(C1.invoiceId);
    const m2 = await invoiceMoney(C2.invoiceId);
    expect(m1.invoiceNumber).toMatch(NUMBER_SHAPE);
    expect(m2.invoiceNumber).toMatch(NUMBER_SHAPE);
    expect(m1.invoiceNumber).not.toBe(m2.invoiceNumber);
    expect(m1.status).toBe("ISSUED");
    expect(m2.status).toBe("ISSUED");

    expect(await auditFor("invoice.issued", C1.invoiceId)).toHaveLength(1);
    expect(await auditFor("invoice.issued", C2.invoiceId)).toHaveLength(1);

    // Neither overwrote the other: both numbers are still present and distinct.
    const { data: both } = await db()
      .from("invoice")
      .select("id, invoice_number")
      .in("id", [C1.invoiceId, C2.invoiceId]);
    const numbers = new Set((both ?? []).map((r) => r.invoice_number as string));
    expect(numbers.size).toBe(2);
  });
});

// ═══════════ D — a failure before the write ════════════════════════════════

describe("CTRL-C-4A / D — a refused issuance leaves nothing behind", () => {
  it("D.1 — no partial issuance, no false audit, no consumed number", async () => {
    // A REAL failure path, not a mock: this draft carries no line, so
    // `validateIssuance` refuses it. That check deliberately runs BEFORE the
    // allocator so a meaningless document is refused while refusing is free.
    const beforeSeq = await counter();

    const refused = await as(finance, () => issueInvoice(D.invoiceId));
    expect(refused.ok).toBe(false);
    expect(["zero_total", "no_lines"], JSON.stringify(refused)).toContain((refused as { error: string }).error);

    const money = await invoiceMoney(D.invoiceId);
    expect(money.status).toBe("DRAFT");
    expect(money.invoiceNumber).toBeNull();
    expect(await auditFor("invoice.issued", D.invoiceId)).toHaveLength(0);
    expect(await counter()).toBe(beforeSeq);

    // WHAT THIS DOES NOT PROVE, stated plainly: it covers a failure BEFORE
    // allocation. A process that dies AFTER drawing a number and before the
    // write leaves that number unused — the same gap case A asserts. There is
    // no transaction spanning the allocation and the write, so that outcome is
    // a property of the design rather than a defect this slice introduced.
  });
});

// ═══════════ E — the legacy lifecycle still behaves as it did ══════════════

describe("CTRL-C-4A / E — compatibility", () => {
  it("E.1 — an ordinary single issuance of a DRAFT still succeeds", async () => {
    // RECORDED, NOT ENDORSED. Legacy issuance still goes straight from DRAFT to
    // ISSUED, skipping VALIDATED and its second pair of eyes. That is the
    // CTRL-C-4B defect, and this slice deliberately preserves it: making
    // eligibility atomic is not the same as changing what is eligible.
    const before = await invoiceMoney(E.invoiceId);
    expect(before.status).toBe("DRAFT");
    expect(before.invoiceNumber).toBeNull();

    const issued = await as(finance, () => issueInvoice(E.invoiceId));
    expect(issued.ok, `issueInvoice failed: ${JSON.stringify(issued)}`).toBe(true);

    const after = await invoiceMoney(E.invoiceId);
    expect(after.status).toBe("ISSUED");
    expect(after.invoiceNumber).toMatch(NUMBER_SHAPE);
    expect(after.total).toBe(177000); // 150000 + 18% VAT, unchanged arithmetic
    expect(await auditFor("invoice.issued", E.invoiceId)).toHaveLength(1);
  });

  it("E.2 — every invoice this suite issued is intact and distinctly numbered", async () => {
    const ids = [A.invoiceId, C1.invoiceId, C2.invoiceId, E.invoiceId];
    const { data: rows } = await db()
      .from("invoice")
      .select("id, status, invoice_number, tenant_id")
      .in("id", ids);
    expect(rows ?? []).toHaveLength(4);
    for (const r of rows ?? []) {
      expect(r.status, r.id as string).toBe("ISSUED");
      expect(r.invoice_number as string, r.id as string).toMatch(NUMBER_SHAPE);
      expect(r.tenant_id).toBe(TENANT_A);
    }
    expect(new Set((rows ?? []).map((r) => r.invoice_number as string)).size).toBe(4);
  });
});
