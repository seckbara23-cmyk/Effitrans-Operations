/**
 * Power BI export pack (Phase 3.0B — Deliverables 3 & 4). Server + client safe.
 * ---------------------------------------------------------------------------
 * Builds the Power BI-ready dataset package — 10 NORMALIZED worksheets with
 * Power BI-friendly (English) column names, pure data (no merged cells, no
 * formatting, no formulas). Every dataset is derived from the EXISTING BI +
 * Control Tower + Analytics outputs; nothing is recalculated here.
 *
 *   toPowerBiWorkbook  -> effitrans_powerbi_export.xlsx (multi-sheet)   [D3]
 *   toPowerBiCsvZip    -> zip of revenue.csv … control_tower.csv (BOM)  [D4]
 *
 * The XLSX/ZIP writers and the RFC-4180 CSV builder are the existing ones.
 */
import type { BusinessIntelligence } from "@/lib/bi/service";
import type { ControlTowerData } from "@/lib/control-tower/service";
import type { AnalyticsData } from "@/lib/analytics/types";
import { toXlsxWorkbook, type Sheet } from "@/lib/bi/xlsx";
import { toCsv } from "@/lib/bi/aggregate";
import { zip } from "@/lib/bi/zip";
import type { DeptKey, SlaCounts } from "@/lib/sla/aggregate";

export type PowerBiDataset = {
  /** file slug for the CSV package (e.g. "control_tower") */
  key: string;
  /** worksheet tab name for the XLSX pack */
  sheet: string;
  headers: string[];
  rows: (string | number | null)[][];
};

const na = (n: number | null): number | string => (n == null ? "N/A" : n);
const DEPTS: DeptKey[] = ["documentation", "customs", "transport", "finance"];
const DEPT_LABEL: Record<DeptKey, string> = {
  documentation: "Documentation",
  customs: "Customs",
  transport: "Transport",
  finance: "Finance",
};

function compliance(c: SlaCounts): number | string {
  const tracked = c.normal + c.warning + c.critical;
  return tracked > 0 ? Math.round((c.normal / tracked) * 100) : "N/A";
}

/** Build the 10 normalized Power BI datasets. */
export function buildPowerBiDatasets(input: {
  bi: BusinessIntelligence;
  ct: ControlTowerData;
  analytics: AnalyticsData;
}): PowerBiDataset[] {
  const { bi, ct, analytics } = input;
  const dossiers = ct.dossiers ?? [];

  const revenue: PowerBiDataset = {
    key: "revenue",
    sheet: "Revenue",
    headers: ["Metric", "Value"],
    rows: [
      ["Revenue This Month", bi.revenue.thisMonth],
      ["Revenue Last Month", bi.revenue.lastMonth],
      ["Revenue Year To Date", bi.revenue.ytd],
      ["Outstanding", bi.revenue.outstanding],
      ["Collected This Month", bi.revenue.collectedThisMonth],
      ["Average Invoice Value", bi.revenue.avgInvoiceValue],
    ],
  };

  const clients: PowerBiDataset = {
    key: "clients",
    sheet: "Clients",
    headers: ["Client Name", "Revenue", "Shipments", "Outstanding", "Avg Payment Delay Days", "Last Activity"],
    rows: bi.clients.map((c) => [
      c.clientName ?? "",
      c.revenue,
      c.shipments,
      c.outstanding,
      na(c.avgPaymentDelayDays),
      c.lastActivity ? c.lastActivity.slice(0, 10) : "",
    ]),
  };

  const p = bi.productivity;
  const operations: PowerBiDataset = {
    key: "operations",
    sheet: "Operations",
    headers: ["Department", "Metric", "Value"],
    rows: [
      ["Documentation", "Documents Processed", p.documentation.processed],
      ["Documentation", "Documents Verified", p.documentation.verified],
      ["Customs", "Declarations", p.customs.declarations],
      ["Customs", "Releases", p.customs.releases],
      ["Customs", "Avg Clearance Days", na(p.customs.avgClearanceDays)],
      ["Transport", "Delivered", p.transport.delivered],
      ["Transport", "POD Received", p.transport.podReceived],
      ["Transport", "POD Rate %", na(p.transport.podRate)],
      ["Transport", "Avg Delivery Days", na(p.transport.avgDeliveryDays)],
      ["Finance", "Invoices Issued", p.finance.invoicesIssued],
      ["Finance", "Payments Recorded", p.finance.paymentsRecorded],
      ["Finance", "Collection Rate %", na(p.finance.collectionRate)],
    ],
  };

  const a = bi.aging;
  const finance: PowerBiDataset = {
    key: "finance",
    sheet: "Finance",
    headers: ["Metric", "Amount"],
    rows: [
      ["Total Outstanding", bi.revenue.outstanding],
      ["Overdue 0-30 Days", a.b0_30],
      ["Overdue 31-60 Days", a.b31_60],
      ["Overdue 61-90 Days", a.b61_90],
      ["Overdue 90+ Days", a.b90p],
      ["Total Overdue", a.total],
      ["Overdue Invoice Count", a.count],
    ],
  };

  const sla: PowerBiDataset = {
    key: "sla",
    sheet: "SLA",
    headers: ["Department", "On Time", "Warning", "Critical", "Compliance %"],
    rows: DEPTS.map((d) => {
      const c = ct.slaByDept[d];
      return [DEPT_LABEL[d], c.normal, c.warning, c.critical, compliance(c)];
    }),
  };

  const shipments: PowerBiDataset = {
    key: "shipments",
    sheet: "Shipments",
    headers: [
      "Shipment Number",
      "Client Name",
      "Type",
      "Priority",
      "File Status",
      "Current Department",
      "Lifecycle Stage",
      "Risk Level",
      "Risk Score",
      "SLA Status",
      "Days Open",
      "Customs Status",
      "Transport Status",
      "Payment Status",
      "Outstanding",
    ],
    rows: dossiers.map((d) => [
      d.fileNumber ?? "",
      d.clientName ?? "",
      d.type,
      d.priority,
      d.fileStatus,
      d.currentDepartment ?? "",
      d.lifecycleStage ?? "",
      d.riskLevel,
      d.riskScore,
      d.slaStatus,
      d.daysOpen,
      d.customsStatus ?? "",
      d.transportStatus ?? "",
      d.paymentStatus,
      d.outstanding == null ? "" : d.outstanding,
    ]),
  };

  const tasks: PowerBiDataset = {
    key: "tasks",
    sheet: "Tasks",
    headers: ["Metric", "Value"],
    rows: [
      ["Open Tasks", analytics.team.openTasks],
      ["Completed Tasks", analytics.team.completedTasks],
      ["Avg Closure Days", na(analytics.team.avgClosureDays)],
    ],
  };

  const departments: PowerBiDataset = {
    key: "departments",
    sheet: "Departments",
    headers: ["Department", "Tracked Dossiers", "On Time", "Warning", "Critical"],
    rows: DEPTS.map((d) => {
      const c = ct.slaByDept[d];
      return [DEPT_LABEL[d], c.normal + c.warning + c.critical, c.normal, c.warning, c.critical];
    }),
  };

  const risk: PowerBiDataset = {
    key: "risk",
    sheet: "Risk",
    headers: ["Shipment Number", "Client Name", "Department", "Priority", "Days Open", "Risk Level", "Risk Score", "SLA Status"],
    rows: dossiers.map((d) => [
      d.fileNumber ?? "",
      d.clientName ?? "",
      d.currentDepartment ?? "",
      d.priority,
      d.daysOpen,
      d.riskLevel,
      d.riskScore,
      d.slaStatus,
    ]),
  };

  const controlTower: PowerBiDataset = {
    key: "control_tower",
    sheet: "Control Tower",
    headers: ["Metric", "Value"],
    rows: [
      ["Funnel - Draft/Quote", ct.funnel.draft],
      ["Funnel - Documentation", ct.funnel.documents],
      ["Funnel - Customs", ct.funnel.customs],
      ["Funnel - Transport", ct.funnel.transport],
      ["Funnel - Delivered", ct.funnel.delivered],
      ["Funnel - Invoiced", ct.funnel.invoiced],
      ["Funnel - Paid", ct.funnel.paid],
      ["Funnel - Archived", ct.funnel.archived],
      ["Aging 0-2 Days", ct.aging.b0_2],
      ["Aging 3-5 Days", ct.aging.b3_5],
      ["Aging 6-10 Days", ct.aging.b6_10],
      ["Aging 10+ Days", ct.aging.b10p],
      ["Active Dossiers", ct.kpis.activeDossiers],
      ["Delivered This Month", ct.kpis.deliveredThisMonth],
      ["Avg Customs Days", na(ct.kpis.avgCustomsDays)],
      ["Avg Delivery Days", na(ct.kpis.avgDeliveryDays)],
      ["Risk Critical", ct.riskKpis.critical],
      ["Risk High", ct.riskKpis.high],
      ["SLA Breaches", ct.riskKpis.slaBreaches],
    ],
  };

  return [revenue, clients, operations, finance, sla, shipments, tasks, departments, risk, controlTower];
}

/** Multi-sheet .xlsx (effitrans_powerbi_export.xlsx). */
export function toPowerBiWorkbook(datasets: PowerBiDataset[]): Uint8Array {
  const sheets: Sheet[] = datasets.map((d) => ({ name: d.sheet, headers: d.headers, rows: d.rows }));
  return toXlsxWorkbook(sheets);
}

/** ZIP of RFC-4180 UTF-8-BOM CSVs (revenue.csv … control_tower.csv). */
export function toPowerBiCsvZip(datasets: PowerBiDataset[]): Uint8Array {
  const enc = new TextEncoder();
  return zip(
    datasets.map((d) => ({
      name: `${d.key}.csv`,
      data: enc.encode(toCsv(d.headers, d.rows)),
    })),
  );
}
