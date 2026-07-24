import { ExecutiveKpiCard } from "./executive-kpi-card";
import type { OperationsKpiSet } from "@/lib/operations/kpi/types";

/**
 * Centre d'Opérations — executive KPI strip (Phase 10.0D-4). PRESENTATIONAL.
 * ---------------------------------------------------------------------------
 * THE single visible executive KPI band on /dashboard (the older Control Tower
 * band is suppressed — see DashboardSupporting). It renders ONLY the authoritative
 * `OperationsKpiSet` the engine produced: permission-shaped (absent KPIs simply
 * don't appear), currency-safe, comparison-honest. No data reading, no totals,
 * no currency merge here.
 *
 * KPIs are grouped by decision context (attention → today's activity → current
 * state → month finance) and each group is omitted when the viewer's permissions
 * leave it empty. Only the curated executive selection is shown; other engine
 * KPIs (e.g. clôtures/conversations/finance-request dailies) are intentionally
 * not surfaced in the strip.
 */
const GROUPS: { key: string; label: string; kpiKeys: string[] }[] = [
  { key: "attention", label: "Attention", kpiKeys: ["dossiers_intervention"] },
  { key: "today", label: "Activité du jour", kpiKeys: ["dossiers_crees_jour", "livraisons_jour", "mainlevees_jour"] },
  { key: "current", label: "Situation actuelle", kpiKeys: ["dossiers_actifs", "douane_en_cours", "demandes_finance"] },
  { key: "finance", label: "Finance du mois", kpiKeys: ["facture_mtd", "encaisse_mtd", "creances_retard"] },
];

export function ExecutiveKpiStrip({ kpis }: { kpis: OperationsKpiSet }) {
  const byKey = new Map(kpis.kpis.map((k) => [k.key, k]));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.kpiKeys.map((k) => byKey.get(k)).filter((k): k is NonNullable<typeof k> => k != null),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="executive-kpis-heading" className="space-y-4">
      <h2 id="executive-kpis-heading" className="text-sm font-semibold text-navy-900">
        Indicateurs exécutifs
      </h2>
      {groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((k) => (
              <ExecutiveKpiCard key={k.key} kpi={k} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
