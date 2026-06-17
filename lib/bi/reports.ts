/**
 * Report table builders (Phase 3.0) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Turn the derived BI data into { headers, rows } tables shared by the reporting
 * center (preview) and the CSV/XLSX export route. Raw numeric values (no money
 * formatting) for export fidelity. No I/O.
 */
import type { BusinessIntelligence } from "./service";
import type { SlaCounts, DeptKey } from "@/lib/sla/aggregate";

export type ReportType = "revenue" | "clients" | "operations" | "sla" | "finance";
export type ReportTable = { headers: string[]; rows: (string | number | null)[][] };

const NA = "N/A";

export function revenueReport(bi: BusinessIntelligence): ReportTable {
  const r = bi.revenue;
  return {
    headers: ["Métrique", "Montant"],
    rows: [
      ["Revenu (mois en cours)", r.thisMonth],
      ["Revenu (mois précédent)", r.lastMonth],
      ["Revenu (année)", r.ytd],
      ["Encours clients", r.outstanding],
      ["Encaissé (mois)", r.collectedThisMonth],
      ["Facture moyenne", r.avgInvoiceValue],
    ],
  };
}

export function clientsReport(bi: BusinessIntelligence): ReportTable {
  return {
    headers: ["Client", "Revenu", "Expéditions", "Encours", "Délai paiement (j)", "Dernière activité"],
    rows: bi.clients.map((c) => [
      c.clientName ?? "—",
      c.revenue,
      c.shipments,
      c.outstanding,
      c.avgPaymentDelayDays ?? NA,
      c.lastActivity ? c.lastActivity.slice(0, 10) : "—",
    ]),
  };
}

export function operationsReport(bi: BusinessIntelligence): ReportTable {
  const p = bi.productivity;
  return {
    headers: ["Service", "Indicateur", "Valeur"],
    rows: [
      ["Documentation", "Documents traités", p.documentation.processed],
      ["Documentation", "Documents validés", p.documentation.verified],
      ["Douane", "Déclarations", p.customs.declarations],
      ["Douane", "Mainlevées", p.customs.releases],
      ["Douane", "Délai moyen (j)", p.customs.avgClearanceDays ?? NA],
      ["Transport", "Livraisons", p.transport.delivered],
      ["Transport", "POD reçus", p.transport.podReceived],
      ["Transport", "Taux POD (%)", p.transport.podRate ?? NA],
      ["Transport", "Délai livraison (j)", p.transport.avgDeliveryDays ?? NA],
      ["Finance", "Factures émises", p.finance.invoicesIssued],
      ["Finance", "Paiements", p.finance.paymentsRecorded],
      ["Finance", "Taux de recouvrement (%)", p.finance.collectionRate ?? NA],
    ],
  };
}

export function financeReport(bi: BusinessIntelligence): ReportTable {
  const a = bi.aging;
  const rows: (string | number | null)[][] = [
    ["Encours total", bi.revenue.outstanding],
    ["En retard 0–30 j", a.b0_30],
    ["En retard 31–60 j", a.b31_60],
    ["En retard 61–90 j", a.b61_90],
    ["En retard 90+ j", a.b90p],
    ["Total en retard", a.total],
    ["Factures en retard", a.count],
  ];
  for (const c of bi.topOverdueClients) rows.push([`En retard — ${c.clientName ?? "—"}`, c.outstanding]);
  return { headers: ["Indicateur", "Montant"], rows };
}

const DEPTS: DeptKey[] = ["documentation", "customs", "transport", "finance"];
const DEPT_LABEL: Record<DeptKey, string> = {
  documentation: "Documentation",
  customs: "Douane",
  transport: "Transport",
  finance: "Finance",
};

export function slaReport(slaByDept: Record<DeptKey, SlaCounts>): ReportTable {
  return {
    headers: ["Service", "Dans les délais", "Alerte", "Critique", "Conformité (%)"],
    rows: DEPTS.map((d) => {
      const c = slaByDept[d];
      const totalTracked = c.normal + c.warning + c.critical;
      const compliance = totalTracked > 0 ? Math.round((c.normal / totalTracked) * 100) : NA;
      return [DEPT_LABEL[d], c.normal, c.warning, c.critical, compliance];
    }),
  };
}
