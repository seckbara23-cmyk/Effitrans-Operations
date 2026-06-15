/**
 * Executive alerts panel (Phase 1.13B). Server-safe, presentational.
 * Alerts are derived from existing data (no notification-system changes).
 */
import { t } from "@/lib/i18n";
import type { Alert } from "@/lib/analytics/executive";

const DOT: Record<string, string> = { RED: "bg-red-500", AMBER: "bg-amber-500", GREEN: "bg-teal-500" };

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const a = t.analytics.exec.alerts as Record<string, string>;
  return (
    <section className="surface space-y-2 p-4">
      <h2 className="text-sm font-semibold text-navy-900">{a.title}</h2>
      <ul className="space-y-1.5">
        {alerts.map((al, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[al.level]}`} />
            {al.key === "allClear" ? a.allClear : `${al.count} ${a[al.key] ?? al.key}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
