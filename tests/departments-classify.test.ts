import { describe, it, expect } from "vitest";
import {
  summarizeDossierDocs,
  documentationCards,
  documentationNextAction,
  customsCards,
  customsNextAction,
  transportCards,
  transportNextAction,
  financeCards,
  financeNextAction,
} from "@/lib/departments/classify";
import type { DocDossierRow } from "@/lib/departments/types";

describe("departments — documentation classification", () => {
  it("summarizes pending / verified / missing against required codes", () => {
    const docs = [
      { typeCode: "BL", status: "APPROVED" },
      { typeCode: "INVOICE", status: "PENDING_REVIEW" },
      { typeCode: "PACKING", status: "UPLOADED" },
    ];
    expect(summarizeDossierDocs(docs, ["BL", "INVOICE", "CERT"])).toEqual({
      pending: 2,
      verified: 1,
      missing: 2, // INVOICE (not approved) + CERT (absent); BL approved
    });
    expect(summarizeDossierDocs([], ["BL"])).toEqual({ pending: 0, verified: 0, missing: 1 });
  });

  const rows: DocDossierRow[] = [
    { fileId: "1", fileNumber: "A", clientName: null, fileType: "IMP", priority: "high", openedAt: null, pending: 1, verified: 0, missing: 2 },
    { fileId: "2", fileNumber: "B", clientName: null, fileType: "IMP", priority: "normal", openedAt: null, pending: 0, verified: 3, missing: 0 },
    { fileId: "3", fileNumber: "C", clientName: null, fileType: "EXP", priority: "critical", openedAt: null, pending: 2, verified: 1, missing: 0 },
  ];

  it("counts dashboard cards", () => {
    expect(documentationCards(rows)).toEqual({ pending: 2, missing: 1, verified: 1, urgent: 2 });
  });

  it("derives the next action / hand-off", () => {
    expect(documentationNextAction(rows[0]).key).toBe("request_missing");
    expect(documentationNextAction(rows[2]).key).toBe("verify");
    expect(documentationNextAction(rows[1]).key).toBe("to_customs"); // verified -> hand off to customs
  });
});

describe("departments — customs classification", () => {
  it("buckets dashboard cards by status", () => {
    const rows = [
      { status: "NOT_STARTED" as const },
      { status: "DECLARATION_PREPARED" as const },
      { status: "DECLARED" as const },
      { status: "INSPECTION" as const },
      { status: "DUTIES_ASSESSED" as const },
      { status: "RELEASED" as const },
    ];
    expect(customsCards(rows)).toEqual({
      readyForDeclaration: 2,
      awaitingResponse: 1,
      underInspection: 1,
      readyForRelease: 1,
    });
  });

  it("hands off to transport once released", () => {
    expect(customsNextAction("DECLARATION_PREPARED").key).toBe("declare");
    expect(customsNextAction("DUTIES_ASSESSED").key).toBe("release");
    expect(customsNextAction("RELEASED").key).toBe("to_transport");
  });
});

describe("departments — transport classification", () => {
  it("buckets dashboard cards by status", () => {
    const rows = [
      { status: "PLANNED" as const },
      { status: "DRIVER_ASSIGNED" as const },
      { status: "IN_TRANSIT" as const },
      { status: "DELIVERED" as const },
      { status: "POD_RECEIVED" as const },
    ];
    expect(transportCards(rows)).toEqual({
      readyForDispatch: 1,
      assigned: 1,
      inTransit: 1,
      podRequired: 1,
      delivered: 1,
    });
  });

  it("hands off to finance once POD received", () => {
    expect(transportNextAction("DELIVERED").key).toBe("upload_pod");
    expect(transportNextAction("POD_RECEIVED").key).toBe("to_finance");
  });
});

describe("departments — finance classification", () => {
  const invoices = [
    { status: "DRAFT" as const, balance: 0, overdue: false },
    { status: "ISSUED" as const, balance: 1000, overdue: true },
    { status: "PARTIALLY_PAID" as const, balance: 500, overdue: false },
    { status: "PAID" as const, balance: 0, overdue: false },
  ];

  it("computes dashboard cards", () => {
    expect(financeCards(invoices, 3, 250000)).toEqual({
      invoicesPending: 2,
      outstanding: 1500,
      overdue: 1,
      paymentsToVerify: 3,
      revenueMonth: 250000,
    });
  });

  it("hands off to archive once paid", () => {
    expect(financeNextAction("DRAFT").key).toBe("issue");
    expect(financeNextAction("ISSUED").key).toBe("record_payment");
    expect(financeNextAction("PAID").key).toBe("to_archive");
  });
});
