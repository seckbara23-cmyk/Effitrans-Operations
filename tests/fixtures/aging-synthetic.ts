/**
 * Synthetic Aging Balance fixtures. NO REAL EFFITRANS DATA — by construction.
 * ---------------------------------------------------------------------------
 * Client names are deliberately obvious placeholders (« Client Alpha », « Client
 * Bêta », …). The reference workbook is never used as a fixture: the copy that
 * reached us still carried real client names and receivable amounts on its
 * Graphiques tab, and this repository is public. What survives from the workbook
 * is STRUCTURE only, in aging-workbook-structure.json, and a test asserts that
 * file stays free of business data.
 *
 * The dataset is built to exercise every boundary the Finance Manager ratified,
 * not to look realistic:
 *   * one invoice on each side of every bucket edge (0/1, 30/31, 60/61, 90/91,
 *     180/181, 365/366);
 *   * a client whose invoices are all in the future — the negative-average case
 *     that proves the « Faible » floor;
 *   * partial payment, full settlement, overpayment, cancellation, draft,
 *     missing due date, foreign currency, dispute;
 *   * movements dated after the arrêté, and a reversal after the arrêté, which
 *     must both leave the historical figures untouched.
 */
import {
  isoDate,
  money,
  type Allocation,
  type InvoiceInput,
  type IsoDate,
} from "@/lib/finance/aging";

export const TENANT = "00000000-0000-0000-0000-000000000001";
export const OTHER_TENANT = "00000000-0000-0000-0000-0000000000b9";
export const ARRETE: IsoDate = isoDate("2026-06-12");
export const CURRENCY = "XOF";

/** 1 000 000,00 in minor units — round numbers keep the arithmetic checkable by hand. */
export const M = (majorUnits: number) => money(Math.round(majorUnits * 100));

let seq = 0;
function nextNumber(): string {
  seq += 1;
  return `EFT-INV-2026-${String(seq).padStart(5, "0")}`;
}

/** Reset the counter so a suite's invoice numbers are deterministic per run. */
export function resetSequence(): void {
  seq = 0;
}

export function payment(amountMajor: number, on: string, reversedOn?: string): Allocation {
  return {
    kind: "PAYMENT",
    amount: M(amountMajor),
    effectiveDate: isoDate(on),
    reversedOn: reversedOn ? isoDate(reversedOn) : null,
  };
}

export function creditNote(amountMajor: number, on: string): Allocation {
  return { kind: "CREDIT_NOTE", amount: M(amountMajor), effectiveDate: isoDate(on), reversedOn: null };
}

export function debitAdjustment(amountMajor: number, on: string): Allocation {
  return { kind: "ADJUSTMENT_DEBIT", amount: M(amountMajor), effectiveDate: isoDate(on), reversedOn: null };
}

export function invoice(overrides: Partial<InvoiceInput> & { dueDate: IsoDate | null }): InvoiceInput {
  const number = overrides.invoiceNumber ?? nextNumber();
  return {
    tenantId: TENANT,
    invoiceId: overrides.invoiceId ?? `id-${number}`,
    invoiceNumber: number,
    clientId: "client-alpha",
    clientName: "Client Alpha",
    dossierReference: "EFT-IMP-2026-00001",
    externalDossierReference: null,
    currency: CURRENCY,
    issueDate: isoDate("2024-01-01"),
    status: "ISSUED",
    originalAmount: M(1_000_000),
    cancelledOn: null,
    disputed: false,
    allocations: [],
    ...overrides,
  };
}

/** An invoice due exactly `days` before the arrêté (negative = due in the future). */
export function dueDaysBeforeArrete(days: number): IsoDate {
  const [y, m, d] = ARRETE.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86_400_000;
  return isoDate(new Date(ms).toISOString().slice(0, 10));
}

/**
 * The boundary dataset: one invoice per critical day count, all for one client,
 * plus the edge-case invoices. Amounts are distinct so a misattributed row is
 * visible in a total rather than hidden by symmetry.
 */
export const BOUNDARY_DAYS = [-122, -1, 0, 1, 30, 31, 60, 61, 90, 91, 180, 181, 365, 366, 2505];

export function boundaryInvoices(): InvoiceInput[] {
  resetSequence();
  return BOUNDARY_DAYS.map((days, i) =>
    invoice({
      dueDate: dueDaysBeforeArrete(days),
      originalAmount: M(100_000 * (i + 1)),
      clientId: "client-boundary",
      clientName: "Client Boundary",
    }),
  );
}

/**
 * A portfolio covering every population rule. Exactly SIX rows are aged:
 * two for Client Alpha, one for Client Bêta, one for Client Gamma (partial),
 * one disputed, one over 365 days.
 */
export function portfolio(): InvoiceInput[] {
  resetSequence();
  return [
    // --- aged rows -------------------------------------------------------
    invoice({ dueDate: dueDaysBeforeArrete(10), originalAmount: M(500_000) }),
    invoice({ dueDate: dueDaysBeforeArrete(200), originalAmount: M(300_000) }),
    invoice({
      dueDate: dueDaysBeforeArrete(45),
      originalAmount: M(800_000),
      clientId: "client-beta",
      clientName: "Client Bêta",
    }),
    // partial payment: amount reduced, due date (and therefore the clock) unchanged
    invoice({
      dueDate: dueDaysBeforeArrete(100),
      originalAmount: M(1_000_000),
      clientId: "client-gamma",
      clientName: "Client Gamma",
      status: "PARTIALLY_PAID",
      allocations: [payment(400_000, "2026-05-01")],
    }),
    // disputed: still visible, balance untouched, dispute state carried
    invoice({
      dueDate: dueDaysBeforeArrete(75),
      originalAmount: M(250_000),
      clientId: "client-delta",
      clientName: "Client Delta",
      disputed: true,
      disputeReason: "Contestation tarifaire",
    }),
    // critical
    invoice({
      dueDate: dueDaysBeforeArrete(500),
      originalAmount: M(2_000_000),
      clientId: "client-epsilon",
      clientName: "Client Epsilon",
      comment: "Relance recommandée",
    }),

    // --- excluded, each for a different ratified reason -------------------
    invoice({ dueDate: dueDaysBeforeArrete(20), status: "DRAFT" }),
    invoice({ dueDate: dueDaysBeforeArrete(20), cancelledOn: isoDate("2026-01-15"), status: "VOID" }),
    invoice({
      dueDate: dueDaysBeforeArrete(20),
      originalAmount: M(600_000),
      status: "PAID",
      allocations: [payment(600_000, "2026-03-01")],
    }),
    invoice({ dueDate: null, originalAmount: M(150_000) }),
    invoice({ dueDate: dueDaysBeforeArrete(20), originalAmount: M(999_000), currency: "EUR" }),
    // overpaid: receivable is zero, the excess becomes an unapplied credit
    invoice({
      dueDate: dueDaysBeforeArrete(20),
      originalAmount: M(100_000),
      allocations: [payment(120_000, "2026-04-01")],
    }),
  ];
}

/** A client whose invoices are ALL in the future — the negative-average case. */
export function futureOnlyClient(): InvoiceInput[] {
  resetSequence();
  return [
    invoice({
      dueDate: dueDaysBeforeArrete(-30),
      originalAmount: M(400_000),
      clientId: "client-future",
      clientName: "Client Futur",
    }),
    invoice({
      dueDate: dueDaysBeforeArrete(-58),
      originalAmount: M(600_000),
      clientId: "client-future",
      clientName: "Client Futur",
    }),
  ];
}
