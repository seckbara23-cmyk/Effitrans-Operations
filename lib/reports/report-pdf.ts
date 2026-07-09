/**
 * Standard report PDFs (Phase 3.0B — Deliverable 1). SERVER + client safe.
 * ---------------------------------------------------------------------------
 * Every report already exportable as CSV / XLSX is now also a professional PDF.
 * Tables are built by the EXISTING pure ./bi/reports builders (no duplicated
 * aggregation); this module only lays them out via the reusable ./templates
 * (executive summary + KPI cards + table + totals). Generated directly from data.
 */
import {
  revenueReport,
  clientsReport,
  operationsReport,
  financeReport,
  slaReport,
  type ReportType,
} from "@/lib/bi/reports";
import type { BusinessIntelligence } from "@/lib/bi/service";
import type { ControlTowerData } from "@/lib/control-tower/service";
import { ReportLayout, fmtNumber, type ReportMeta, type KpiCard } from "./templates";
import type { Orientation } from "./pdf";
import type { DeptKey, SlaCounts } from "@/lib/sla/aggregate";

const XOF = (n: number) => `${fmtNumber(n)} XOF`;

function render(
  meta: ReportMeta,
  summary: string,
  kpis: KpiCard[],
  tableTitle: string,
  table: { headers: string[]; rows: (string | number | null)[][] },
  opts: { orientation?: Orientation; weights?: number[] } = {},
): Uint8Array {
  const L = new ReportLayout(meta, opts.orientation ?? "portrait");
  L.sectionHeader("Synthèse");
  L.paragraph(summary);
  L.gap(8);
  if (kpis.length) {
    L.kpiCards(kpis);
    L.gap(4);
  }
  L.sectionHeader(tableTitle);
  L.table(table.headers, table.rows, { weights: opts.weights });
  return L.finish();
}

function revenuePdf(bi: BusinessIntelligence, meta: ReportMeta): Uint8Array {
  const r = bi.revenue;
  const kpis: KpiCard[] = [
    { label: "Revenu (mois)", value: XOF(r.thisMonth), accent: "teal" },
    { label: "Mois précédent", value: XOF(r.lastMonth) },
    { label: "Revenu (année)", value: XOF(r.ytd), accent: "navy" },
    { label: "Encours clients", value: XOF(r.outstanding), accent: "red" },
  ];
  return render(
    meta,
    "Indicateurs de revenus dérivés des factures émises et des paiements enregistrés sur la période. Les montants sont exprimés en XOF.",
    kpis,
    "Revenus",
    revenueReport(bi),
    { weights: [3, 2] },
  );
}

function clientsPdf(bi: BusinessIntelligence, meta: ReportMeta): Uint8Array {
  const top = bi.clients[0];
  const kpis: KpiCard[] = [
    { label: "Clients actifs", value: fmtNumber(bi.activeClients), accent: "teal" },
    { label: "Clients suivis", value: fmtNumber(bi.clients.length) },
    { label: "Meilleur client", value: top?.clientName ?? "—", hint: top ? XOF(top.revenue) : undefined, accent: "navy" },
  ];
  return render(
    meta,
    "Intelligence client dérivée des dossiers, factures et paiements : revenu, volume d'expéditions, encours et délai moyen de paiement, par client.",
    kpis,
    "Clients",
    clientsReport(bi),
    { orientation: "landscape", weights: [3, 2, 1.4, 2, 1.6, 1.8] },
  );
}

function operationsPdf(bi: BusinessIntelligence, meta: ReportMeta): Uint8Array {
  const p = bi.productivity;
  const kpis: KpiCard[] = [
    { label: "Documents traités", value: fmtNumber(p.documentation.processed), accent: "navy" },
    { label: "Mainlevées douane", value: fmtNumber(p.customs.releases), accent: "teal" },
    { label: "Livraisons", value: fmtNumber(p.transport.delivered) },
    { label: "Taux recouvrement", value: p.finance.collectionRate != null ? `${p.finance.collectionRate}%` : "N/A" },
  ];
  return render(
    meta,
    "Productivité opérationnelle par service (documentation, douane, transport, finance), dérivée des enregistrements opérationnels existants.",
    kpis,
    "Opérations",
    operationsReport(bi),
    { weights: [2, 3, 1.4] },
  );
}

function slaPdf(slaByDept: Record<DeptKey, SlaCounts>, meta: ReportMeta): Uint8Array {
  const depts: DeptKey[] = ["documentation", "customs", "transport", "finance"];
  let normal = 0;
  let tracked = 0;
  for (const d of depts) {
    const c = slaByDept[d];
    normal += c.normal;
    tracked += c.normal + c.warning + c.critical;
  }
  const compliance = tracked > 0 ? Math.round((normal / tracked) * 100) : null;
  const critical = depts.reduce((s, d) => s + slaByDept[d].critical, 0);
  const kpis: KpiCard[] = [
    { label: "Conformité SLA", value: compliance != null ? `${compliance}%` : "N/A", accent: "teal" },
    { label: "Dossiers suivis", value: fmtNumber(tracked), accent: "navy" },
    { label: "En critique", value: fmtNumber(critical), accent: "red" },
  ];
  return render(
    meta,
    "Conformité SLA par service, dérivée de l'étape de cycle de vie et de la durée en cours de chaque dossier (moteur SLA existant).",
    kpis,
    "SLA par service",
    slaReport(slaByDept),
    { weights: [2, 1.4, 1.2, 1.2, 1.4] },
  );
}

function financePdf(bi: BusinessIntelligence, meta: ReportMeta): Uint8Array {
  const a = bi.aging;
  const kpis: KpiCard[] = [
    { label: "Encours total", value: XOF(bi.revenue.outstanding), accent: "navy" },
    { label: "Total en retard", value: XOF(a.total), accent: "red" },
    { label: "Factures en retard", value: fmtNumber(a.count) },
    { label: "90+ jours", value: XOF(a.b90p), accent: "red" },
  ];
  return render(
    meta,
    "Situation financière dérivée : encours clients et ventilation des créances en retard par ancienneté (0–30, 31–60, 61–90, 90+ jours).",
    kpis,
    "Finance — créances",
    financeReport(bi),
    { weights: [3, 2] },
  );
}

/** Build the PDF bytes for a standard report. */
export function buildReportPdf(
  type: ReportType,
  input: { bi: BusinessIntelligence; ct: ControlTowerData; meta: ReportMeta },
): Uint8Array {
  switch (type) {
    case "clients":
      return clientsPdf(input.bi, input.meta);
    case "operations":
      return operationsPdf(input.bi, input.meta);
    case "sla":
      return slaPdf(input.ct.slaByDept, input.meta);
    case "finance":
      return financePdf(input.bi, input.meta);
    case "revenue":
    default:
      return revenuePdf(input.bi, input.meta);
  }
}
