"use client";

/**
 * Aging Balance charts — pure SVG, no charting library.
 * ---------------------------------------------------------------------------
 * Each chart receives a FINISHED series from the report view model and draws it.
 * None of them sums, filters, sorts or re-buckets anything: if a chart could
 * aggregate, it could disagree with the table above it, and the whole point of
 * one authoritative view model is that the five tabs cannot say different things.
 *
 * SVG rather than a dependency because these three charts must eventually be
 * reproduced in an XLSX chart part and a vector PDF (FIN-AGING-6/7). Owning the
 * geometry keeps the web, Excel and PDF renderings describable by the same spec.
 */
import { BUCKET_FILL, formatAmountCompact, formatShare } from "@/lib/finance/aging/presentation";
import type { BucketKey, ChartSeries } from "@/lib/finance/aging";

const AXIS = "#94a3b8";
const GRID = "#e2e8f0";

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
      {label}
    </div>
  );
}

/**
 * Chart 1 — « Encours par tranche d'ancienneté ». Vertical bars, value labels
 * above each bar (the workbook deletes the value axis and labels the bars).
 */
export function BucketAmountChart({
  series,
  bucketKeys,
  currency,
}: {
  series: ChartSeries;
  bucketKeys: readonly BucketKey[];
  currency: string;
}) {
  const values = series.values;
  const max = Math.max(...values, 1);
  if (values.every((v) => v === 0)) return <Empty label="Aucun encours à représenter" />;

  const W = 720;
  const H = 260;
  const padL = 8;
  const padB = 54;
  const padT = 26;
  const n = values.length;
  const slot = (W - padL * 2) / n;
  const barW = Math.min(slot * 0.6, 64);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img"
         aria-label="Encours par tranche d'ancienneté">
      <line x1={padL} y1={H - padB} x2={W - padL} y2={H - padB} stroke={GRID} strokeWidth="1" />
      {values.map((v, i) => {
        const h = Math.max(2, ((H - padT - padB) * v) / max);
        const x = padL + i * slot + (slot - barW) / 2;
        const y = H - padB - h;
        return (
          <g key={series.categories[i]}>
            <rect x={x} y={y} width={barW} height={h} rx="3" fill={BUCKET_FILL[bucketKeys[i]]} />
            {v > 0 && (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="#334155">
                {formatAmountCompact(v, currency)}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={H - padB + 16}
              textAnchor="middle"
              fontSize="10"
              fill={AXIS}
            >
              {series.categories[i].replace(" jours", " j").replace("Non échu (≤ 0 j)", "Non échu")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Chart 2 — « Répartition % de l'encours par tranche ». A donut: the same
 * proportions as a pie, with the total legible in the middle rather than
 * inferred from slice sizes.
 */
export function BucketShareChart({
  series,
  bucketKeys,
  totalLabel,
}: {
  series: ChartSeries;
  bucketKeys: readonly BucketKey[];
  totalLabel: string;
}) {
  const bps = series.values;
  const total = bps.reduce((a, b) => a + b, 0);
  if (total === 0) return <Empty label="Aucune répartition à représenter" />;

  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 92;
  const inner = 58;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const arcs = bps.map((bp, i) => {
    const sweep = (bp / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    if (bp === 0) return null;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1);
    const yi1 = cy + inner * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0);
    const yi0 = cy + inner * Math.sin(a0);
    return (
      <path
        key={series.categories[i]}
        d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0} Z`}
        fill={BUCKET_FILL[bucketKeys[i]]}
      />
    );
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-56 w-56 shrink-0" role="img"
           aria-label="Répartition de l'encours par tranche">
        {arcs}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="#64748b">Total</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0f172a">
          {totalLabel}
        </text>
      </svg>
      <ul className="min-w-[220px] flex-1 space-y-1.5">
        {series.categories.map((c, i) => (
          <li key={c} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BUCKET_FILL[bucketKeys[i]] }} />
              {c}
            </span>
            <span className="tabular-nums font-medium text-navy-900">{formatShare(bps[i])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Chart 3 — « Top 10 clients ». Horizontal bars, matching the workbook. */
export function TopClientsChart({ series, currency }: { series: ChartSeries; currency: string }) {
  const values = series.values;
  if (values.length === 0 || values.every((v) => v === 0)) {
    return <Empty label="Aucun client à représenter" />;
  }
  const max = Math.max(...values, 1);

  return (
    <ul className="space-y-2" role="img" aria-label="Top clients par encours">
      {series.categories.map((name, i) => (
        <li key={`${name}-${i}`} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-slate-600" title={name}>{name}</span>
          <span className="h-4 rounded bg-slate-100">
            <span
              className="block h-4 rounded bg-navy-800"
              style={{ width: `${Math.max(2, (values[i] / max) * 100)}%` }}
            />
          </span>
          <span className="tabular-nums text-xs font-medium text-navy-900">
            {formatAmountCompact(values[i], currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Risk distribution — derived in the engine's bucket aggregate, grouped for display. */
export function RiskDistribution({
  segments,
  currency,
}: {
  segments: readonly { label: string; amount: number; color: string; share: number }[];
  currency: string;
}) {
  const total = segments.reduce((a, s) => a + s.amount, 0);
  if (total === 0) return <Empty label="Aucune exposition à représenter" />;
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-md">
        {segments.map((s) =>
          s.amount === 0 ? null : (
            <span
              key={s.label}
              className="h-full"
              style={{ width: `${(s.amount / total) * 100}%`, background: s.color }}
              title={`${s.label} — ${formatAmountCompact(s.amount, currency)}`}
            />
          ),
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs text-slate-600">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums font-medium text-navy-900">{formatShare(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
