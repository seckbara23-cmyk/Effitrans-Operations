/**
 * Phase 4.0B-4 — report chrome branding + export filenames (tenant-resolved).
 */
import { describe, it, expect } from "vitest";
import { reportBrand, exportFilename, powerbiFilename, hexToRgb } from "@/lib/reports/brand";
import type { TenantBranding } from "@/lib/branding/types";

const EFFITRANS: TenantBranding = {
  displayName: "Effitrans Operations",
  pdfHeaderText: "EFFITRANS OPERATIONS",
  tagline: "Transit • Logistique • Douane",
  primaryColor: "#0B1F33",
  secondaryColor: "#0F766E",
};

describe("report brand + export filenames", () => {
  it("reproduces the Effitrans chrome from the backfill (byte-stable)", () => {
    const b = reportBrand(EFFITRANS);
    expect(b.header).toBe("EFFITRANS OPERATIONS");
    expect(b.footer).toBe("Effitrans Operations — Document confidentiel");
    expect(b.displayName).toBe("Effitrans Operations");
    expect(b.subtitle).toBe("Transit • Logistique • Douane");
    expect(b.primary).toEqual([11 / 255, 31 / 255, 51 / 255]);
    expect(b.accent).toEqual([15 / 255, 118 / 255, 110 / 255]);
  });

  it("hexToRgb parses #rgb/#rrggbb and rejects junk", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
    expect(hexToRgb("nope")).toBeUndefined();
    expect(hexToRgb(null)).toBeUndefined();
    expect(hexToRgb(undefined)).toBeUndefined();
  });

  it("a tenant without colors/tagline gets undefined chrome extras (report falls back)", () => {
    const b = reportBrand({ displayName: "Baobab" });
    expect(b.subtitle).toBeUndefined();
    expect(b.primary).toBeUndefined();
    expect(b.accent).toBeUndefined();
  });

  it("derives the header from displayName when pdfHeaderText is absent", () => {
    const b = reportBrand({ displayName: "Baobab" });
    expect(b.header).toBe("BAOBAB");
    expect(b.footer).toBe("Baobab — Document confidentiel");
  });

  it("builds filenames from the tenant slug (Effitrans byte-stable)", () => {
    expect(exportFilename("effitrans", "executive", "pdf")).toBe("effitrans-executive.pdf");
    expect(exportFilename("effitrans", "revenue", "csv")).toBe("effitrans-revenue.csv");
    expect(powerbiFilename("effitrans", "xlsx")).toBe("effitrans_powerbi_export.xlsx");
    expect(powerbiFilename("effitrans", "zip")).toBe("effitrans_powerbi_csv.zip");
  });

  it("falls back to 'export' when the tenant has no slug", () => {
    expect(exportFilename(null, "revenue", "pdf")).toBe("export-revenue.pdf");
    expect(powerbiFilename(undefined, "xlsx")).toBe("export_powerbi_export.xlsx");
  });

  it("a different tenant produces different chrome + filenames (no leak)", () => {
    expect(reportBrand({ displayName: "Tenant B" }).header).toBe("TENANT B");
    expect(exportFilename("tenant-b", "revenue", "pdf")).toBe("tenant-b-revenue.pdf");
  });
});
