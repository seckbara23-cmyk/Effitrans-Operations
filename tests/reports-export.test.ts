import { describe, it, expect } from "vitest";
import { AuditActions } from "@/lib/audit/events";
import { validateAuditEvent } from "@/lib/audit/validate";
import { inDateRange } from "@/lib/bi/date-range";
import { toCsv } from "@/lib/bi/aggregate";
import { revenueReport, clientsReport } from "@/lib/bi/reports";
import { BI } from "./fixtures/report-data";

describe("export audit events (Deliverable 6)", () => {
  it("exposes the four attributed report export actions", () => {
    expect(AuditActions.REPORT_EXPORT_CSV).toBe("report.export.csv");
    expect(AuditActions.REPORT_EXPORT_XLSX).toBe("report.export.xlsx");
    expect(AuditActions.REPORT_EXPORT_PDF).toBe("report.export.pdf");
    expect(AuditActions.REPORT_EXPORT_POWERBI).toBe("report.export.powerbi");
  });

  it("requires an actor for every export audit event (fail closed)", () => {
    for (const action of [
      AuditActions.REPORT_EXPORT_CSV,
      AuditActions.REPORT_EXPORT_XLSX,
      AuditActions.REPORT_EXPORT_PDF,
      AuditActions.REPORT_EXPORT_POWERBI,
    ]) {
      expect(() => validateAuditEvent({ action })).toThrow();
      expect(() => validateAuditEvent({ action, actorId: "u1" })).not.toThrow();
    }
  });
});

describe("report date filtering (Deliverable, date range)", () => {
  it("keeps dates inside an inclusive [from, to] window", () => {
    const r = { from: "2026-01-01", to: "2026-03-31" };
    expect(inDateRange("2026-01-01T00:00:00.000Z", r)).toBe(true); // inclusive lower
    expect(inDateRange("2026-02-15T12:00:00.000Z", r)).toBe(true);
    expect(inDateRange("2026-04-01T00:00:00.000Z", r)).toBe(false);
    expect(inDateRange("2025-12-31T23:59:59.000Z", r)).toBe(false);
  });

  it("treats an unbounded side as open and a null date as excluded", () => {
    expect(inDateRange("2026-06-01", { from: "2026-01-01" })).toBe(true);
    expect(inDateRange("2020-01-01", { to: "2026-12-31" })).toBe(true);
    expect(inDateRange("2026-06-01", {})).toBe(true); // no bounds → all pass
    expect(inDateRange(null, { from: "2026-01-01" })).toBe(false);
  });
});

describe("existing CSV export is unchanged (RFC-4180 + UTF-8 BOM)", () => {
  it("prefixes a BOM and CRLF-separates rows", () => {
    const csv = toCsv(["A", "B"], [[1, "x,y"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"x,y"'); // comma-bearing field quoted
  });

  it("keeps the standard report table shape (regression guard)", () => {
    expect(revenueReport(BI).headers).toEqual(["Métrique", "Montant"]);
    expect(clientsReport(BI).headers).toEqual([
      "Client", "Revenu", "Expéditions", "Encours", "Délai paiement (j)", "Dernière activité",
    ]);
  });
});
