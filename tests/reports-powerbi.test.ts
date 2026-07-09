import { describe, it, expect } from "vitest";
import { toXlsxWorkbook } from "@/lib/bi/xlsx";
import { buildPowerBiDatasets, toPowerBiWorkbook, toPowerBiCsvZip } from "@/lib/reports/powerbi";
import { BI, CT, ANALYTICS, latin1 } from "./fixtures/report-data";

const EXPECTED_KEYS = [
  "revenue", "clients", "operations", "finance", "sla",
  "shipments", "tasks", "departments", "risk", "control_tower",
];

describe("multi-sheet XLSX writer", () => {
  it("emits one worksheet part per sheet in a valid ZIP", () => {
    const bytes = toXlsxWorkbook([
      { name: "A", headers: ["X"], rows: [[1]] },
      { name: "B", headers: ["Y"], rows: [["z"]] },
    ]);
    const s = latin1(bytes);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(s).toContain("xl/worksheets/sheet1.xml");
    expect(s).toContain("xl/worksheets/sheet2.xml");
    expect(s).toContain('name="A"');
    expect(s).toContain('name="B"');
  });

  it("sanitises illegal tab characters and clamps to 31 chars", () => {
    const s = latin1(toXlsxWorkbook([{ name: "Rev/enue: [2026]*?", headers: ["X"], rows: [] }]));
    expect(s).not.toMatch(/name="[^"]*[:\\/?*[\]]/); // no illegal chars survive in the tab name
    expect(s).toMatch(/name="Rev enue\s+2026"/);
    const long = latin1(toXlsxWorkbook([{ name: "X".repeat(50), headers: ["A"], rows: [] }]));
    expect(long).toContain(`name="${"X".repeat(31)}"`);
  });
});

describe("Power BI datasets (Deliverable 3)", () => {
  const datasets = buildPowerBiDatasets({ bi: BI, ct: CT, analytics: ANALYTICS });

  it("produces exactly the 10 required normalized datasets", () => {
    expect(datasets.map((d) => d.key)).toEqual(EXPECTED_KEYS);
  });

  it("uses Power BI-friendly English shipment columns", () => {
    const shipments = datasets.find((d) => d.key === "shipments")!;
    expect(shipments.headers).toEqual([
      "Shipment Number", "Client Name", "Type", "Priority", "File Status",
      "Current Department", "Lifecycle Stage", "Risk Level", "Risk Score",
      "SLA Status", "Days Open", "Customs Status", "Transport Status",
      "Payment Status", "Outstanding",
    ]);
    expect(shipments.rows).toHaveLength(2);
    expect(shipments.rows[0][0]).toBe("EFT-IMP-2026-00001");
    expect(shipments.rows[0][7]).toBe("high"); // Risk Level
  });

  it("keeps every dataset rectangular (no ragged rows — pure tabular data)", () => {
    for (const d of datasets) {
      for (const row of d.rows) expect(row).toHaveLength(d.headers.length);
    }
  });

  it("reflects finance visibility: hidden outstanding renders as empty, not 0", () => {
    const hidden = { ...CT, canFinance: false, dossiers: [{ ...CT.dossiers![0], outstanding: null, paymentStatus: "—" }] };
    const ds = buildPowerBiDatasets({ bi: BI, ct: hidden, analytics: ANALYTICS });
    const ship = ds.find((d) => d.key === "shipments")!;
    expect(ship.rows[0][14]).toBe(""); // Outstanding blank
    expect(ship.rows[0][13]).toBe("—"); // Payment Status masked
  });

  it("falls back to no shipment rows when per-dossier data was not requested", () => {
    const noDossiers = { ...CT, dossiers: undefined };
    const ds = buildPowerBiDatasets({ bi: BI, ct: noDossiers, analytics: ANALYTICS });
    expect(ds.find((d) => d.key === "shipments")!.rows).toHaveLength(0);
    // aggregate sheets are unaffected
    expect(ds.find((d) => d.key === "revenue")!.rows.length).toBeGreaterThan(0);
  });
});

describe("Power BI workbook + CSV package (Deliverables 3 & 4)", () => {
  const datasets = buildPowerBiDatasets({ bi: BI, ct: CT, analytics: ANALYTICS });

  it("workbook is a valid 10-sheet ZIP", () => {
    const bytes = toPowerBiWorkbook(datasets);
    const s = latin1(bytes);
    expect(bytes[0]).toBe(0x50);
    expect(s).toContain("xl/worksheets/sheet10.xml");
    expect(s).toContain('name="Shipments"');
    expect(s).toContain("Shipment Number");
  });

  it("CSV package contains the 10 required RFC-4180 UTF-8-BOM files", () => {
    const bytes = toPowerBiCsvZip(datasets);
    const s = latin1(bytes);
    expect(bytes[0]).toBe(0x50);
    for (const key of EXPECTED_KEYS) expect(s).toContain(`${key}.csv`);
    // UTF-8 BOM (EF BB BF) precedes each CSV payload.
    expect(s).toContain("ï»¿");
    expect(s).toContain("Shipment Number");
  });
});
