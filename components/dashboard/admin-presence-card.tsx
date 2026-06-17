import { t } from "@/lib/i18n";
import type { PresenceSummary } from "@/lib/users/types";

/**
 * SYSTEM_ADMIN presence summary card (Phase 2.1A). Read-only derived counts;
 * rendered only for admins (admin:users:manage). No per-user detail here.
 */
export function AdminPresenceCard({ summary }: { summary: PresenceSummary }) {
  const s = t.users.presenceSummary;
  const cells = [
    { label: s.online, value: summary.online, tone: "text-emerald-700" },
    { label: s.activeToday, value: summary.activeToday, tone: "text-navy-900" },
    { label: s.neverLoggedIn, value: summary.neverLoggedIn, tone: "text-amber-700" },
    { label: s.portalActiveToday, value: summary.portalActiveToday, tone: "text-navy-900" },
  ];
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold text-navy-900">{s.title}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-100 bg-sand-50/40 p-3">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`mt-1 tabular text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
