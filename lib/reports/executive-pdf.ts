/**
 * Executive Summary PDF (Phase 3.0B — Deliverable 2). SERVER + client safe.
 * ---------------------------------------------------------------------------
 * A single board-level PDF assembled entirely from the EXISTING BI + Control
 * Tower outputs (no new aggregation): revenue, operations, department + risk
 * KPIs, SLA, top clients, outstanding, bottlenecks, attention queue, operational
 * funnel and department workload. Reuses ./templates + the pure slaReport builder.
 */
import type { BusinessIntelligence } from "@/lib/bi/service";
import type { ControlTowerData } from "@/lib/control-tower/service";
import { slaReport } from "@/lib/bi/reports";
import { FUNNEL_ORDER, type FunnelStage } from "@/lib/control-tower/aggregate";
import type { RiskLevel } from "@/lib/copilot/risk-engine";
import { ReportLayout, fmtNumber, type ReportMeta, type KpiCard } from "./templates";

const XOF = (n: number | null) => (n == null ? "—" : `${fmtNumber(n)} XOF`);

const FUNNEL_LABEL: Record<FunnelStage, string> = {
  draft: "Brouillon / devis",
  documents: "Documentation",
  customs: "Douane",
  transport: "Transport",
  delivered: "Livré (à facturer)",
  invoiced: "Facturé (à encaisser)",
  paid: "Payé (à archiver)",
  archived: "Archivé / clôturé",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  critical: "Critique",
};

export function buildExecutivePdf(input: {
  bi: BusinessIntelligence;
  ct: ControlTowerData;
  meta: ReportMeta;
}): Uint8Array {
  const { bi, ct } = input;
  const L = new ReportLayout(input.meta, "landscape");

  // ---- Synthèse + headline KPIs ----------------------------------------------
  L.sectionHeader("Synthèse exécutive");
  L.paragraph(
    "Vue consolidée des opérations Effitrans dérivée des enregistrements existants : revenus, " +
      "productivité, SLA, risque et dossiers nécessitant une attention. Aucune donnée n'est recalculée " +
      "en dehors des services BI et Control Tower.",
  );
  L.gap(6);
  L.kpiCards([
    { label: "Revenu (mois)", value: XOF(ct.kpis.revenueThisMonth), accent: "teal" },
    { label: "Encours clients", value: XOF(ct.kpis.outstanding), accent: "red" },
    { label: "Dossiers actifs", value: fmtNumber(ct.kpis.activeDossiers), accent: "navy" },
    { label: "Livrés (mois)", value: fmtNumber(ct.kpis.deliveredThisMonth) },
  ]);

  // ---- Risk KPIs -------------------------------------------------------------
  L.sectionHeader("Risque & attention");
  L.kpiCards([
    { label: "Risque critique", value: fmtNumber(ct.riskKpis.critical), accent: "red" },
    { label: "Risque élevé", value: fmtNumber(ct.riskKpis.high), accent: "red" },
    { label: "Ruptures SLA", value: fmtNumber(ct.riskKpis.slaBreaches), accent: "navy" },
    {
      label: "Finance en retard",
      value: ct.riskKpis.overdueFinance == null ? "—" : fmtNumber(ct.riskKpis.overdueFinance),
    },
  ]);

  // ---- Operational funnel ----------------------------------------------------
  L.sectionHeader("Entonnoir opérationnel");
  L.table(
    ["Étape", "Dossiers"],
    FUNNEL_ORDER.map((s) => [FUNNEL_LABEL[s], ct.funnel[s]]),
    { weights: [3, 1], align: ["left", "right"] },
  );

  // ---- SLA by department (reuse the pure builder) ----------------------------
  L.sectionHeader("SLA par service");
  L.table(slaReport(ct.slaByDept).headers, slaReport(ct.slaByDept).rows, {
    weights: [2, 1.3, 1.1, 1.1, 1.4],
  });

  // ---- Department workload (tracked dossiers by department) ------------------
  L.sectionHeader("Charge par service");
  const depts = ["documentation", "customs", "transport", "finance"] as const;
  const deptLabel: Record<(typeof depts)[number], string> = {
    documentation: "Documentation",
    customs: "Douane",
    transport: "Transport",
    finance: "Finance",
  };
  L.table(
    ["Service", "Dossiers suivis", "En alerte", "En critique"],
    depts.map((d) => {
      const c = ct.slaByDept[d];
      return [deptLabel[d], c.normal + c.warning + c.critical, c.warning, c.critical];
    }),
    { weights: [2, 1.4, 1.2, 1.2] },
  );

  // ---- Current bottlenecks ---------------------------------------------------
  L.sectionHeader("Goulots d'étranglement");
  if (ct.bottlenecks.length) {
    L.table(["Goulot", "Dossiers"], ct.bottlenecks.map((b) => [b.label, b.count]), {
      weights: [4, 1],
      align: ["left", "right"],
    });
  } else {
    L.paragraph("Aucun goulot d'étranglement significatif détecté.");
  }

  // ---- Attention queue -------------------------------------------------------
  L.sectionHeader("File d'attention (risque)");
  if (ct.attentionQueue.length) {
    L.table(
      ["Dossier", "Client", "Service", "Niveau", "Score", "Jours", "Motif principal"],
      ct.attentionQueue.map((a) => [
        a.fileNumber ?? "—",
        a.clientName ?? "—",
        a.department ?? "—",
        RISK_LABEL[a.level],
        a.score,
        a.ageDays,
        a.primaryReason,
      ]),
      { weights: [1.4, 2, 1.3, 1.1, 0.9, 0.9, 3.5], align: ["left", "left", "left", "left", "right", "right", "left"] },
    );
  } else {
    L.paragraph("Aucun dossier ne requiert une attention particulière.");
  }

  // ---- Top clients -----------------------------------------------------------
  L.sectionHeader("Meilleurs clients");
  const topClients = bi.clients.slice(0, 8);
  if (topClients.length) {
    L.table(
      ["Client", "Revenu", "Expéditions", "Encours"],
      topClients.map((c) => [c.clientName ?? "—", c.revenue, c.shipments, c.outstanding]),
      { weights: [3, 2, 1.4, 2] },
    );
  } else {
    L.paragraph("Aucune donnée client disponible.");
  }

  // ---- Outstanding / receivables --------------------------------------------
  L.sectionHeader("Encours & créances");
  const a = bi.aging;
  L.table(
    ["Indicateur", "Montant"],
    [
      ["Encours total", bi.revenue.outstanding],
      ["En retard 0–30 j", a.b0_30],
      ["En retard 31–60 j", a.b31_60],
      ["En retard 61–90 j", a.b61_90],
      ["En retard 90+ j", a.b90p],
      ["Total en retard", a.total],
    ],
    { weights: [3, 2], align: ["left", "right"] },
  );

  L.signatureBlock();
  return L.finish();
}
