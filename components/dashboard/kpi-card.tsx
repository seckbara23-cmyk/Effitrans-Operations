import { cn } from "@/lib/cn";
import type { Kpi } from "@/lib/mock-data";

const accent: Record<Kpi["tone"], string> = {
  navy: "before:bg-navy-700",
  teal: "before:bg-teal-600",
  amber: "before:bg-amber-500",
  red: "before:bg-red-500",
};

function TrendArrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
      <path
        d={up ? "M6 9V3M6 3 3 6M6 3l3 3" : "M6 3v6M6 9l3-3M6 9 3 6"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const isFlat = kpi.delta === 0;
  const isUp = kpi.delta > 0;
  // Whether this movement is "good" given the metric's preferred direction.
  const isGood = isFlat
    ? true
    : (isUp && kpi.goodDirection === "up") ||
      (!isUp && kpi.goodDirection === "down");

  return (
    <div
      className={cn(
        "surface relative overflow-hidden p-4 transition-shadow hover:shadow-card-hover",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent[kpi.tone],
      )}
    >
      <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="tabular text-3xl font-bold leading-none text-navy-900">
          {kpi.value}
        </span>
        {!isFlat && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              isGood
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600",
            )}
          >
            <TrendArrow up={isUp} />
            {Math.abs(kpi.delta)}
          </span>
        )}
        {isFlat && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
            =
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">vs. hier</p>
    </div>
  );
}
