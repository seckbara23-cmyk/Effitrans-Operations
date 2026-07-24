import Link from "next/link";
import { comparisonDisplay, formatMoneyAmount } from "@/lib/operations/kpi/format";
import type { OperationsKpi } from "@/lib/operations/kpi/types";

/**
 * Centre d'Opérations — one executive KPI card (Phase 10.0D-4). PRESENTATIONAL.
 * ---------------------------------------------------------------------------
 * Renders exactly what the authoritative engine produced — it computes nothing,
 * combines no currencies, redefines no status, and never infers a missing value
 * as zero:
 *   - status "unavailable" → a truthful « Indisponible » (NEVER 0);
 *   - a real count of 0 / an empty money set → rendered as the real zero;
 *   - status "partial"     → the valid value + a subtle « Données partielles »
 *                            (+ safe basis count — never IDs or error detail);
 *   - amount kind          → per-currency list, each with its OWN comparison;
 *   - comparison           → shown only as supplied; unknown ⇒ no arrow.
 */
function StatusNote({ kpi }: { kpi: OperationsKpi }) {
  if (kpi.status !== "partial") return null;
  const excluded = kpi.basis?.excluded ?? 0;
  return (
    <p className="mt-1 text-[11px] text-amber-600">
      Données partielles{excluded > 0 ? ` · ${excluded} élément(s) exclu(s)` : ""}
    </p>
  );
}

function Comparison({ kpi, currency }: { kpi: OperationsKpi; currency?: string }) {
  // Amount KPIs carry per-currency comparisons; count KPIs use the top-level one.
  const comparison = currency
    ? kpi.amounts?.find((a) => a.currency === currency)?.comparison
    : kpi.comparison;
  const c = comparisonDisplay(comparison);
  if (!c) return null;
  return (
    <p className="mt-0.5 text-[11px] text-slate-500">
      <span aria-hidden>{c.text}</span>
      <span className="sr-only">{c.srText}</span>
    </p>
  );
}

function CardShell({ kpi, children }: { kpi: OperationsKpi; children: React.ReactNode }) {
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
      {children}
      <StatusNote kpi={kpi} />
    </>
  );
  const cls = "surface relative overflow-hidden p-4 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-navy-700";
  return kpi.href ? (
    <Link href={kpi.href} className={`${cls} block transition-shadow hover:shadow-card-hover`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function ExecutiveKpiCard({ kpi }: { kpi: OperationsKpi }) {
  // Unavailable — truthful, never a zero.
  if (kpi.status === "unavailable") {
    return (
      <CardShell kpi={kpi}>
        <p className="mt-2 text-sm font-medium text-slate-400">Indisponible</p>
      </CardShell>
    );
  }

  if (kpi.kind === "amount") {
    const amounts = kpi.amounts ?? [];
    return (
      <CardShell kpi={kpi}>
        {amounts.length === 0 ? (
          // A successful source with no money is a REAL zero (never "unavailable").
          <p className="mt-2 text-sm font-medium text-navy-900">Aucun montant sur la période</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {amounts.map((a) => (
              <li key={a.currency}>
                <p className="tabular text-lg font-bold text-navy-900">{formatMoneyAmount(a.amount, a.currency)}</p>
                <Comparison kpi={kpi} currency={a.currency} />
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    );
  }

  // count / rate / duration — a real 0 renders as 0.
  const suffix = kpi.unit === "days" ? " j" : kpi.unit === "percent" ? " %" : "";
  return (
    <CardShell kpi={kpi}>
      <p className="mt-2 tabular text-2xl font-bold text-navy-900">
        {kpi.value ?? 0}
        {suffix}
      </p>
      <Comparison kpi={kpi} />
    </CardShell>
  );
}
