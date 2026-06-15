/**
 * Executive health banner (Phase 1.13B). Server-safe, presentational.
 */
import { t } from "@/lib/i18n";
import type { ExecBanner, ExecutiveHealth } from "@/lib/analytics/executive";

const HEALTH: Record<ExecutiveHealth, { dot: string; ring: string; text: string }> = {
  GREEN: { dot: "bg-teal-400", ring: "border-teal-300", text: "text-teal-50" },
  AMBER: { dot: "bg-amber-400", ring: "border-amber-300", text: "text-amber-50" },
  RED: { dot: "bg-red-400", ring: "border-red-300", text: "text-red-50" },
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-300">{label}</p>
      <p className="mt-1 text-lg font-bold tabular text-white">{value}</p>
    </div>
  );
}

export function HealthBanner({
  banner,
  health,
  lastUpdated,
  currency,
}: {
  banner: ExecBanner;
  health: ExecutiveHealth;
  lastUpdated: string;
  currency: string;
}) {
  const e = t.analytics.exec;
  const money = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} ${currency}`);
  const h = HEALTH[health];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-5 shadow-card sm:px-7">
      <div className="absolute inset-0 bg-chart-grid bg-[size:28px_28px] opacity-50" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${h.ring} ${h.text}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${h.dot}`} />
            {e.health[health]}
          </span>
          <span className="text-xs text-slate-400">
            {e.lastUpdated}: {lastUpdated.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={e.banner.revenue} value={money(banner.revenueThisMonth)} />
          <Tile label={e.banner.active} value={String(banner.activeDossiers)} />
          <Tile label={e.banner.inTransit} value={String(banner.inTransit)} />
          <Tile label={e.banner.outstanding} value={money(banner.outstanding)} />
        </div>
      </div>
    </section>
  );
}
