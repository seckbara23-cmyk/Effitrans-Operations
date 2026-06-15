import { describe, it, expect } from "vitest";
import {
  lineAmount,
  lineTax,
  invoiceTotals,
  paidAmount,
  balanceDue,
  paymentStatus,
  isOverdue,
} from "@/lib/finance/calc";
import {
  canEditInvoice,
  canIssue,
  canVoid,
  canRecordPayment,
  canDeleteInvoice,
  isInvoiceStatus,
} from "@/lib/finance/status";
import {
  canReject,
  canVerify,
  isMissingReference,
  isVerificationStatus,
  VERIFICATION_STATUSES,
} from "@/lib/finance/verification";

describe("finance calc", () => {
  const lines = [
    { quantity: 2, unitAmount: 1000, taxRate: 0 }, // 2000
    { quantity: 1, unitAmount: 500, taxRate: 18 }, // 500 + 90 tax
  ];

  it("computes line amount and tax", () => {
    expect(lineAmount({ quantity: 2, unitAmount: 1000 })).toBe(2000);
    expect(lineTax({ quantity: 1, unitAmount: 500, taxRate: 18 })).toBe(90);
  });

  it("computes invoice totals (subtotal/tax/total)", () => {
    expect(invoiceTotals(lines)).toEqual({ subtotal: 2500, tax: 90, total: 2590 });
    expect(invoiceTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });

  it("sums non-reversed payments and computes balance", () => {
    const payments = [
      { amount: 1000, reversed: false },
      { amount: 500, reversed: true }, // reversed -> excluded
      { amount: 200, reversed: false },
    ];
    expect(paidAmount(payments)).toBe(1200);
    expect(balanceDue(2590, 1200)).toBe(1390);
  });

  it("derives payment status", () => {
    expect(paymentStatus(2590, 0)).toBe("ISSUED");
    expect(paymentStatus(2590, 1000)).toBe("PARTIALLY_PAID");
    expect(paymentStatus(2590, 2590)).toBe("PAID");
    expect(paymentStatus(2590, 3000)).toBe("PAID"); // overpay clamps to paid
  });

  it("flags overdue only for unpaid, past-due, issued invoices", () => {
    const NOW = new Date("2026-06-15T12:00:00Z");
    expect(isOverdue("ISSUED", "2026-06-01", 1000, NOW)).toBe(true);
    expect(isOverdue("ISSUED", "2026-12-01", 1000, NOW)).toBe(false); // future
    expect(isOverdue("ISSUED", "2026-06-01", 0, NOW)).toBe(false); // paid off
    expect(isOverdue("PAID", "2026-06-01", 1000, NOW)).toBe(false); // not issued state
    expect(isOverdue("DRAFT", "2026-06-01", 1000, NOW)).toBe(false);
  });
});

describe("invoice workflow predicates", () => {
  it("edit/issue/delete only while DRAFT", () => {
    expect(canEditInvoice("DRAFT")).toBe(true);
    expect(canEditInvoice("ISSUED")).toBe(false);
    expect(canIssue("DRAFT")).toBe(true);
    expect(canIssue("ISSUED")).toBe(false);
    expect(canDeleteInvoice("DRAFT")).toBe(true);
    expect(canDeleteInvoice("ISSUED")).toBe(false);
  });
  it("void/pay only on issued, not-fully-paid", () => {
    expect(canVoid("ISSUED")).toBe(true);
    expect(canVoid("PARTIALLY_PAID")).toBe(true);
    expect(canVoid("PAID")).toBe(false);
    expect(canVoid("DRAFT")).toBe(false);
    expect(canRecordPayment("ISSUED")).toBe(true);
    expect(canRecordPayment("PAID")).toBe(false);
  });
  it("status guard", () => {
    expect(isInvoiceStatus("PARTIALLY_PAID")).toBe(true);
    expect(isInvoiceStatus("REFUNDED")).toBe(false);
  });
});

describe("payment verification (1.15A)", () => {
  it("only PENDING can be verified or rejected", () => {
    expect(canVerify("PENDING")).toBe(true);
    expect(canVerify("VERIFIED")).toBe(false);
    expect(canVerify("REJECTED")).toBe(false);
    expect(canReject("PENDING")).toBe(true);
    expect(canReject("VERIFIED")).toBe(false);
    expect(canReject("REJECTED")).toBe(false);
  });
  it("status guard", () => {
    for (const s of VERIFICATION_STATUSES) expect(isVerificationStatus(s)).toBe(true);
    expect(isVerificationStatus("PARTIAL")).toBe(false);
  });
  it("missing reference = no reference AND no provider reference", () => {
    expect(isMissingReference({ reference: null, providerReference: null })).toBe(true);
    expect(isMissingReference({ reference: "  ", providerReference: "" })).toBe(true);
    expect(isMissingReference({ reference: "TX-1", providerReference: null })).toBe(false);
    expect(isMissingReference({ reference: null, providerReference: "WAVE-9" })).toBe(false);
  });
});
