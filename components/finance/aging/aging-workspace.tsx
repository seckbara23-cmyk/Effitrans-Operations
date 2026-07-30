"use client";

/**
 * Balance âgée — the read-only five-tab workspace. Client component.
 * ---------------------------------------------------------------------------
 * It FORMATS a finished report. It does not compute one: every figure below
 * comes from the view model the server built with the pure engine, and the only
 * thing this file decides is which rows the raw-data table shows.
 *
 * The five tabs are projections of ONE object, so they cannot disagree — the
 * dashboard's total, the client ranking's total and the chart's bars are
 * literally the same numbers. Reconciliation is asserted in the engine (which
 * throws rather than emit an inconsistent report) and again in the test suite.
 *
 * READ-ONLY. No form, no server action, no mutation. Changing the arrêté or the
 * currency is a navigation (a new URL), not a write.
 */
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AVERAGE_DELAY_NOTE,
  BUCKET_FILL,
  EXCLUSION_LABEL_FR,
  PROVENANCE_LABEL_FR,
  RISK_CHIP_CLASS,
  dossierLabel,
  filterRows,
  formatAmount,
  formatAmountCompact,
  formatDateFr,
  formatDateLongFr,
  formatDays,
  formatInteger,
  formatShare,
  hasActiveFilters,
  type RowFilters,
} from "@/lib/finance/aging/presentation";
import {
  BUCKET_KEYS,
  RISK_LABEL_FR,
  type AgingReportViewModel,
  type AgingRow as AgingRowT,
  type BucketKey,
  type RiskKey,
} from "@/lib/finance/aging";
import { BucketAmountChart, BucketShareChart, RiskDistribution, TopClientsChart } from "./aging-charts";

const TABS = [
  { key: "dashboard", label: "Tableau de bord", icon: "📊" },
  { key: "rows", label: "Données brutes", icon: "📋" },
  { key: "clients", label: "Analyse clients", icon: "👥" },
  { key: "critical", label: "Dossiers critiques", icon: "⛔" },
  { key: "charts", label: "Graphiques", icon: "📈" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PAGE_SIZE = 50;

/** Columns the raw-data table can be ordered by. Display only — see `sortRows`. */
const SORTABLE = {
  invoiceNumber: "Facture",
  issueDate: "Date édition",
  dueDate: "Échéance",
  clientName: "Client",
  outstanding: "Montant",
  daysOverdue: "Jours retard",
} as const;
type SortKey = keyof typeof SORTABLE;

/**
 * Order rows for display. Comparison only — no row is added, removed or
 * recomputed, so every total on every other tab is untouched. Ties break on
 * invoice number so the order is total and a re-render cannot reshuffle equals.
 */
function sortRows(rows: AgingRowT[], sort: { key: SortKey; dir: "asc" | "desc" } | null): AgingRowT[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const k = sort.key;
    let d: number;
    if (k === "outstanding" || k === "daysOverdue") d = (a[k] as number) - (b[k] as number);
    else d = String(a[k]).localeCompare(String(b[k]), "fr");
    return d !== 0 ? d * sign : a.invoiceNumber.localeCompare(b.invoiceNumber, "fr");
  });
}

function Info({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      title={text}
      aria-label={text}
      className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
    >
      ?
    </span>
  );
}

/**
 * A sortable column heading. `aria-sort` is what makes the ordering audible to a
 * screen reader; without it the arrow is decoration only sighted users can read.
 */
function SortableTh({
  sortKey,
  sort,
  setSort,
  align = "left",
  children,
}: {
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  setSort: (s: { key: SortKey; dir: "asc" | "desc" } | null) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort!.dir : null;
  return (
    <th
      scope="col"
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className={`px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        // asc → desc → back to the engine's own order, so a user can always
        // return to the canonical ordering rather than being stuck in theirs.
        onClick={() =>
          setSort(!active ? { key: sortKey, dir: "asc" } : dir === "asc" ? { key: sortKey, dir: "desc" } : null)
        }
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
      >
        {children}
        <span aria-hidden className={active ? "text-teal-700" : "text-slate-300"}>
          {dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

function RiskChip({ risk }: { risk: RiskKey }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${RISK_CHIP_CLASS[risk]}`}>
      {RISK_LABEL_FR[risk]}
    </span>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
  hint,
  sub,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "critical" | "accent";
  hint?: string;
  sub?: string;
}) {
  const toneClass =
    tone === "critical"
      ? "border-red-200 bg-red-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : tone === "accent"
          ? "border-teal-200 bg-teal-50"
          : "border-slate-200 bg-white";
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-start text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {hint && <Info text={hint} />}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums text-navy-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function AgingWorkspace({
  report,
  currencies,
  canReadFollowUps,
}: {
  report: AgingReportViewModel;
  currencies: readonly string[];
  /** Whether the viewer may see collection follow-up notes on the critical tab. */
  canReadFollowUps: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [filters, setFilters] = useState<RowFilters>({});
  const [page, setPage] = useState(0);
  // Display ordering only. Sorting a table is a way of LOOKING at the same rows;
  // it changes no total, and the tests assert that. Default null = the engine's
  // own deterministic order (invoice number ascending).
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const { rows, kpis, buckets, clients, critical, criticalTotal, charts, exclusions, currency } = report;

  const visibleRows = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const pageRows = visibleRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const filtered = hasActiveFilters(filters);

  const oldest = useMemo(
    () => rows.reduce((max, r) => (r.daysOverdue > max ? r.daysOverdue : max), Number.NEGATIVE_INFINITY),
    [rows],
  );

  // Risk exposure, grouped from the engine's bucket aggregates — not recomputed
  // from rows, so it cannot drift from the bucket table.
  const riskSegments = useMemo(() => {
    const byRisk = new Map<RiskKey, { amount: number; share: number }>();
    for (const b of buckets) {
      const cur = byRisk.get(b.risk) ?? { amount: 0, share: 0 };
      cur.amount += b.amount as number;
      cur.share += b.shareBasisPoints;
      byRisk.set(b.risk, cur);
    }
    const COLOR: Record<RiskKey, string> = {
      NON_ECHU: BUCKET_FILL.NON_ECHU,
      FAIBLE: BUCKET_FILL.D1_30,
      MODERE: BUCKET_FILL.D31_60,
      ELEVE: BUCKET_FILL.D91_180,
      CRITIQUE: BUCKET_FILL.OVER_365,
    };
    return (["NON_ECHU", "FAIBLE", "MODERE", "ELEVE", "CRITIQUE"] as RiskKey[])
      .map((r) => ({
        label: RISK_LABEL_FR[r],
        amount: byRisk.get(r)?.amount ?? 0,
        share: byRisk.get(r)?.share ?? 0,
        color: COLOR[r],
      }));
  }, [buckets]);

  const clientOptions = useMemo(
    () => clients.map((c) => ({ id: c.clientId, name: c.clientName })),
    [clients],
  );

  function navigate(next: Record<string, string>) {
    const q = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.push(`/finance/aging?${q.toString()}`);
  }

  function patch(f: Partial<RowFilters>) {
    setFilters((prev) => ({ ...prev, ...f }));
    setPage(0);
  }

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- controls */}
      <div className="surface flex flex-wrap items-end gap-4 p-4">
        <div>
          <label htmlFor="arrete" className="block text-xs font-medium text-slate-600">
            Date d&apos;arrêté
            <Info text="Toutes les figures sont calculées À CETTE DATE. Les paiements et avoirs postérieurs sont ignorés." />
          </label>
          <input
            id="arrete"
            type="date"
            defaultValue={report.reportingDate}
            onChange={(e) => e.target.value && navigate({ date: e.target.value })}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="devise" className="block text-xs font-medium text-slate-600">
            Devise
            <Info text="Un rapport = une devise. Les créances d'une autre devise sont exclues et comptées, jamais converties." />
          </label>
          <select
            id="devise"
            defaultValue={currency}
            onChange={(e) => navigate({ currency: e.target.value })}
            className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <p className="ml-auto max-w-md text-xs text-slate-500">
          Vue <span className="font-medium text-navy-800">provisoire</span> calculée en direct.
          Aucun rapport n&apos;est enregistré : la validation et la finalisation arriveront dans une phase ultérieure.
        </p>
      </div>

      {/* ---------------------------------------------------------------- tabs
          A COMPLETE ARIA tab pattern, not a partial one. The first version had
          role="tab" and aria-selected but no tabpanel, no aria-controls and no
          arrow-key handling — which announces a widget to a screen reader and
          then fails to behave like it, worse than plain buttons. Roving
          tabindex: one stop for the whole strip, arrows move between tabs. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Vues de la balance âgée">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            id={`aging-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls="aging-tabpanel"
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!delta) return;
              e.preventDefault();
              const next = TABS[(i + delta + TABS.length) % TABS.length];
              setTab(next.key);
              document.getElementById(`aging-tab-${next.key}`)?.focus();
            }}
            className={`-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 ${
              tab === t.key
                ? "border-teal-600 text-navy-900"
                : "border-transparent text-slate-500 hover:text-navy-800"
            }`}
          >
            <span aria-hidden className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div id="aging-tabpanel" role="tabpanel" aria-labelledby={`aging-tab-${tab}`} tabIndex={-1}>

      {/* ================================================== TABLEAU DE BORD */}
      {tab === "dashboard" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total encours" value={formatAmount(kpis.totalOutstanding, currency)} tone="accent" />
            <Kpi label="Nb factures" value={formatInteger(kpis.invoiceCount)} />
            <Kpi label="Nb clients" value={formatInteger(kpis.clientCount)} />
            <Kpi label="Montant en retard" value={formatAmount(kpis.overdueAmount, currency)} tone="warn"
                 hint="Somme des encours dont le retard est d'au moins 1 jour." />
            <Kpi
              label="Retard moyen"
              value={kpis.averageDaysOverdue === null ? "—" : formatDays(kpis.averageDaysOverdue)}
              hint={AVERAGE_DELAY_NOTE[kpis.averageDelayPopulation]}
            />
            <Kpi label="Montant > 1 an" value={formatAmount(kpis.amountOverOneYear, currency)} tone="critical" />
            <Kpi label="Dossiers critiques" value={formatInteger(criticalTotal.invoiceCount)} tone="critical"
                 hint="Factures dont le retard dépasse 365 jours. Aucun seuil de montant n'intervient." />
            <Kpi
              label="Créance la plus ancienne"
              value={rows.length === 0 ? "—" : formatDays(oldest)}
              hint="Retard le plus élevé du portefeuille à la date d'arrêté."
            />
          </div>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">Répartition du risque</h2>
            <div className="mt-4">
              <RiskDistribution segments={riskSegments} currency={currency} />
            </div>
          </section>

          <section className="surface overflow-hidden">
            <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-navy-900">
              Tranches d&apos;ancienneté
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">Encours par tranche d&apos;ancienneté</caption>
                <thead className="bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Tranche d&apos;ancienneté</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Nb factures</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Montant</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Part encours</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Nb clients</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Retard moyen</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Niveau de risque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {buckets.map((b) => (
                    <tr key={b.bucket} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BUCKET_FILL[b.bucket] }} />
                          {b.labelFr}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(b.invoiceCount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatAmount(b.amount, currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatShare(b.shareBasisPoints)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(b.clientCount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatDays(b.averageDaysOverdue)}</td>
                      <td className="px-4 py-2.5">{b.riskLabelDashboardFr}</td>
                    </tr>
                  ))}
                  <tr className="bg-navy-900 font-semibold text-white">
                    <td className="px-4 py-2.5">TOTAL GÉNÉRAL</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(kpis.invoiceCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatAmount(kpis.totalOutstanding, currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rows.length === 0 ? "—" : "100,0 %"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(kpis.clientCount)}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">Principaux clients</h2>
            <div className="mt-4">
              <TopClientsChart series={charts.topClients} currency={currency} />
            </div>
          </section>

          {exclusions.length > 0 && <ExclusionNotice exclusions={exclusions} currency={currency} />}
        </div>
      )}

      {/* ================================================== DONNÉES BRUTES */}
      {tab === "rows" && (
        <div className="space-y-4">
          <div className="surface grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="q" className="block text-xs font-medium text-slate-600">Recherche</label>
              <input
                id="q"
                type="search"
                placeholder="Facture, client, dossier…"
                value={filters.search ?? ""}
                onChange={(e) => patch({ search: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="f-client" className="block text-xs font-medium text-slate-600">Client</label>
              <select id="f-client" value={filters.clientId ?? ""} onChange={(e) => patch({ clientId: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Tous les clients</option>
                {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-bucket" className="block text-xs font-medium text-slate-600">Tranche</label>
              <select id="f-bucket" value={filters.bucket ?? ""} onChange={(e) => patch({ bucket: e.target.value as BucketKey | "" })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Toutes les tranches</option>
                {buckets.map((b) => <option key={b.bucket} value={b.bucket}>{b.labelFr}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-risk" className="block text-xs font-medium text-slate-600">Risque</label>
              <select id="f-risk" value={filters.risk ?? ""} onChange={(e) => patch({ risk: e.target.value as RiskKey | "" })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Tous les risques</option>
                {(["NON_ECHU", "FAIBLE", "MODERE", "ELEVE", "CRITIQUE"] as RiskKey[]).map((r) => (
                  <option key={r} value={r}>{RISK_LABEL_FR[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-prov" className="block text-xs font-medium text-slate-600">Provenance</label>
              <select id="f-prov" value={filters.provenance ?? ""} onChange={(e) => patch({ provenance: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Toutes provenances</option>
                <option value="PLATFORM_NATIVE">Plateforme</option>
                <option value="OPENING_IMPORT">Reprise historique</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" checked={filters.disputedOnly ?? false}
                     onChange={(e) => patch({ disputedOnly: e.target.checked })} />
              Litiges uniquement
            </label>
          </div>

          {/* A filtered table must never read as a smaller portfolio. */}
          <p className="text-xs text-slate-500">
            {filtered ? (
              <>
                <span className="font-medium text-navy-800">{formatInteger(visibleRows.length)}</span> facture(s) affichée(s)
                sur {formatInteger(rows.length)} — les totaux, le classement clients et les graphiques portent toujours sur
                l&apos;intégralité du portefeuille.
                <button onClick={() => { setFilters({}); setPage(0); }} className="ml-2 text-teal-700 underline">
                  Réinitialiser les filtres
                </button>
              </>
            ) : (
              <>{formatInteger(rows.length)} facture(s) en cours au {formatDateFr(report.reportingDate)}.</>
            )}
          </p>

          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <caption className="sr-only">Détail des factures en cours</caption>
                {/* Sticky header: a 50-row table scrolls past its own headings
                    otherwise, and « Montant » vs « Jours retard » are easy to
                    confuse once the labels are gone. */}
                <thead className="sticky top-0 z-10 bg-sand-50 text-xs uppercase tracking-wide text-slate-500 shadow-[inset_0_-1px_0_#e2e8f0]">
                  <tr>
                    <SortableTh sortKey="invoiceNumber" sort={sort} setSort={setSort}>Facture</SortableTh>
                    <SortableTh sortKey="issueDate" sort={sort} setSort={setSort}>Date édition</SortableTh>
                    <SortableTh sortKey="dueDate" sort={sort} setSort={setSort}>Échéance</SortableTh>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Dossier</th>
                    <SortableTh sortKey="clientName" sort={sort} setSort={setSort}>Client</SortableTh>
                    <SortableTh sortKey="outstanding" sort={sort} setSort={setSort} align="right">Montant</SortableTh>
                    <SortableTh sortKey="daysOverdue" sort={sort} setSort={setSort} align="right">Jours retard</SortableTh>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Tranche</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Risque</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Provenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-slate-500">
                      Aucune facture ne correspond à ces critères.
                    </td></tr>
                  )}
                  {pageRows.map((r) => {
                    const d = dossierLabel(r);
                    return (
                      <tr key={r.invoiceId} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-medium text-navy-900">
                          {r.invoiceNumber}
                          {r.disputed && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              litige
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatDateFr(r.issueDate)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatDateFr(r.dueDate)}</td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {d.text}
                          {d.legacy && (
                            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                                  title="Référence externe conservée : cette créance historique n'a pas de dossier plateforme.">
                              réf. héritée
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{r.clientName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-navy-900">
                          {formatAmount(r.outstanding, currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatDays(r.daysOverdue)}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.bucketLabelFr}</td>
                        <td className="px-3 py-2.5"><RiskChip risk={r.risk} /></td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {PROVENANCE_LABEL_FR[r.source ?? "PLATFORM_NATIVE"] ?? r.source}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600">
                <span>Page {page + 1} sur {pageCount}</span>
                <span className="flex gap-2">
                  <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                          className="rounded border border-slate-200 px-2.5 py-1 disabled:opacity-40">Précédent</button>
                  <button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}
                          className="rounded border border-slate-200 px-2.5 py-1 disabled:opacity-40">Suivant</button>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================== ANALYSE CLIENTS */}
      {tab === "clients" && (
        <div className="surface overflow-hidden">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-navy-900">
            Analyse par client — classement décroissant par encours
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <caption className="sr-only">Encours par client</caption>
              <thead className="bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">#</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Client</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Nb factures</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Montant total</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Retard moy.</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Retard max</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Part encours</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Niveau risque
                    <Info text="Le risque client dérive du retard MOYEN. Une moyenne ≤ 30 jours — même négative — est « Faible » : il n'existe pas de niveau « Non échu » au niveau client." />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Aucun encours client à cette date.
                  </td></tr>
                )}
                {clients.map((c, i) => (
                  <tr key={c.clientId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-navy-900">{c.clientName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(c.invoiceCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatAmount(c.amount, currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatDays(c.averageDaysOverdue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatDays(c.maxDaysOverdue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatShare(c.shareBasisPoints)}</td>
                    <td className="px-4 py-2.5"><RiskChip risk={c.risk} /></td>
                  </tr>
                ))}
                {clients.length > 0 && (
                  <tr className="bg-navy-900 font-semibold text-white">
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5">TOTAL</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(kpis.invoiceCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatAmount(kpis.totalOutstanding, currency)}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right tabular-nums">100,0 %</td>
                    <td className="px-4 py-2.5" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================== DOSSIERS CRITIQUES */}
      {tab === "critical" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span className="font-semibold">Critère unique :</span> retard strictement supérieur à 365 jours.
            Aucun seuil de montant n&apos;intervient — 365 jours est exclu, 366 jours est inclus.
          </div>
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <caption className="sr-only">Factures dont le retard dépasse 365 jours</caption>
                <thead className="bg-red-700 text-xs uppercase tracking-wide text-white">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Facture</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Échéance</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Dossier</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Client</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Montant</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Jours retard</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Provenance</th>
                    {canReadFollowUps && <th scope="col" className="px-3 py-2.5 font-semibold">Dernière relance</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {critical.length === 0 && (
                    <tr><td colSpan={canReadFollowUps ? 8 : 7} className="px-3 py-10 text-center text-sm text-slate-500">
                      Aucun dossier critique à cette date.
                    </td></tr>
                  )}
                  {critical.map((r) => {
                    const d = dossierLabel(r);
                    return (
                      <tr key={r.invoiceId} className="odd:bg-red-50/40">
                        <td className="px-3 py-2.5 font-medium text-navy-900">
                          {r.invoiceNumber}
                          {r.disputed && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              litige
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatDateFr(r.dueDate)}</td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {d.text}
                          {d.legacy && <span className="ml-1.5 text-[10px] text-slate-500">(réf. héritée)</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{r.clientName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-700">
                          {formatAmount(r.outstanding, currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-700">
                          {formatInteger(r.daysOverdue)} j
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {PROVENANCE_LABEL_FR[r.source ?? "PLATFORM_NATIVE"] ?? r.source}
                        </td>
                        {canReadFollowUps && (
                          <td className="px-3 py-2.5 max-w-[16rem] truncate text-xs text-slate-500" title={r.comment ?? ""}>
                            {r.comment ?? "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {critical.length > 0 && (
                    <tr className="bg-red-100 font-semibold text-red-900">
                      <td className="px-3 py-2.5" colSpan={4}>TOTAL – Dossiers critiques</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(criticalTotal.amount, currency)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInteger(criticalTotal.invoiceCount)}</td>
                      <td className="px-3 py-2.5" />
                      {canReadFollowUps && <td className="px-3 py-2.5" />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================== GRAPHIQUES */}
      {tab === "charts" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="surface p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-navy-900">Encours par tranche d&apos;ancienneté</h2>
            <div className="mt-3">
              <BucketAmountChart series={charts.bucketAmounts} bucketKeys={BUCKET_KEYS} currency={currency} />
            </div>
          </section>
          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">Répartition % de l&apos;encours par tranche</h2>
            <div className="mt-3">
              <BucketShareChart
                series={charts.bucketShares}
                bucketKeys={BUCKET_KEYS}
                totalLabel={formatAmountCompact(kpis.totalOutstanding, currency)}
              />
            </div>
          </section>
          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">Top 10 clients – Encours</h2>
            <div className="mt-3">
              <TopClientsChart series={charts.topClients} currency={currency} />
            </div>
          </section>
        </div>
      )}

      </div>

      <p className="text-center text-xs text-slate-500">
        Balance âgée arrêtée au {formatDateLongFr(report.reportingDate)} · moteur {report.schemeKey} ·{" "}
        <Link href="/departments/finance" className="underline hover:text-slate-700">Retour à Finance</Link>
      </p>
    </div>
  );
}

/** Excluded receivables, stated rather than silently dropped. */
function ExclusionNotice({
  exclusions,
  currency,
}: {
  exclusions: AgingReportViewModel["exclusions"];
  currency: string;
}) {
  const byReason = new Map<string, { count: number; amount: number }>();
  for (const e of exclusions) {
    const cur = byReason.get(e.reason) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += e.outstanding as number;
    byReason.set(e.reason, cur);
  }
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold text-navy-900">
        Créances exclues du calcul
        <Info text="Une créance exclue n'est jamais effacée : son motif et son montant sont indiqués ici." />
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {[...byReason.entries()].map(([reason, v]) => (
          <li key={reason} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <span className="text-slate-600">{EXCLUSION_LABEL_FR[reason] ?? reason}</span>
            <span className="tabular-nums text-slate-500">
              {formatInteger(v.count)} · {formatAmount(v.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
