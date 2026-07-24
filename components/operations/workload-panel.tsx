import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitEmptyState } from "./cockpit-states";
import type { CockpitWorkload } from "@/lib/operations/types";

/**
 * Centre d'Opérations — Workload widget (Phase 10.0C, Scope G).
 * Open-work distribution as coordination data — explicitly NOT a performance
 * score, NO ranking, NO best/worst, NO HR data, NO raw UUIDs. Named per-person
 * rows appear ONLY when the composition layer returns them (analytics:read
 * supervision boundary, DEC-B30); the UI never circumvents that — it just renders
 * whatever `byUser` the reader supplies (null ⇒ the block is omitted).
 */
type Row = { key: string; label: string; value: number };

function WorkloadBars({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
  if (rows.length === 0) return <p className="text-xs text-slate-400">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-slate-600" title={r.label}>
            {r.label}
          </span>
          <span
            className="h-3 rounded-full bg-teal-500/70"
            style={{ width: `${Math.round((r.value / max) * 100)}%`, minWidth: r.value > 0 ? "0.5rem" : "0" }}
            aria-hidden
          />
          <span className="tabular ml-auto font-semibold text-navy-900">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function WorkloadPanel({ workload }: { workload: CockpitWorkload }) {
  const hasAny =
    workload.byDepartment.length > 0 ||
    (workload.byTeam?.length ?? 0) > 0 ||
    (workload.byUser?.length ?? 0) > 0;

  return (
    <CockpitSectionShell
      title="Charge de travail"
      subtitle="Répartition des tâches ouvertes — donnée de coordination, pas un jugement individuel."
    >
      {!hasAny ? (
        <CockpitEmptyState message="Aucune charge de travail à répartir pour le moment." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Par département</p>
            <WorkloadBars
              rows={workload.byDepartment.map((d) => ({ key: d.key, label: d.labelFr, value: d.open }))}
              emptyLabel="Aucune tâche ouverte."
            />
          </div>

          {workload.byTeam && workload.byTeam.length > 0 && (
            <div className="surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Par équipe (Transit)</p>
              <WorkloadBars
                rows={workload.byTeam.map((t) => ({ key: t.key, label: t.labelFr, value: t.open }))}
                emptyLabel="Aucune tâche affectée à une équipe."
              />
            </div>
          )}

          {workload.byUser && (
            <div className="surface p-4 lg:col-span-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Par intervenant</p>
              <p className="mb-3 text-[11px] text-slate-400">
                Visible pour la supervision. Aide à équilibrer la charge — sans hiérarchie ni notation.
              </p>
              <WorkloadBars
                rows={workload.byUser.map((u) => ({ key: u.userId, label: u.displayName, value: u.open }))}
                emptyLabel="Aucune tâche affectée nominativement."
              />
            </div>
          )}
        </div>
      )}
    </CockpitSectionShell>
  );
}
