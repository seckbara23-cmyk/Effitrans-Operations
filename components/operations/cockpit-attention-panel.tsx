import Link from "next/link";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitEmptyState } from "./cockpit-states";
import type { CockpitAlerts } from "@/lib/operations/types";
import type { ExecutiveAlertLevel } from "@/lib/executive/types";

/**
 * Centre d'Opérations — attention panel (Phase 10.0C, Scope C).
 * Renders the composition layer's already-normalized, already-merged alert queue
 * (the executive engine — NOT a second merge, NOT code? adapters; those are 10.0E).
 * Severity is shown by label + dot (never colour alone), each alert links to its
 * owning workspace, the list is bounded, and an authorized-but-quiet cockpit shows
 * a truthful empty state.
 */
const LEVEL_LABEL: Record<ExecutiveAlertLevel, string> = {
  critical: "Critique",
  high: "Élevé",
  medium: "Moyen",
  low: "Faible",
};
const LEVEL_BADGE: Record<ExecutiveAlertLevel, string> = {
  critical: "bg-red-50 text-red-700",
  high: "bg-orange-50 text-orange-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};
const LEVEL_DOT: Record<ExecutiveAlertLevel, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };

const PRIMARY_CAP = 8;

export function CockpitAttentionPanel({ alerts }: { alerts: CockpitAlerts }) {
  const { items, counts } = alerts;
  const shown = items.slice(0, PRIMARY_CAP);

  return (
    <CockpitSectionShell
      title="Attention requise"
      subtitle={
        items.length > 0
          ? `${counts.critical} critique(s) · ${counts.high} élevé(s) · ${counts.medium} moyen(s)`
          : undefined
      }
    >
      {items.length === 0 ? (
        <CockpitEmptyState message="Aucune alerte opérationnelle pour le moment." />
      ) : (
        <div className="surface divide-y divide-slate-100">
          <ul>
            {shown.map((a, i) => (
              <li key={`${a.origin}-${a.reference ?? i}-${i}`}>
                <Link
                  href={a.href}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-slate-50/70"
                >
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[a.level]}`}
                  >
                    <span aria-hidden>{LEVEL_DOT[a.level]}</span>
                    {LEVEL_LABEL[a.level]}
                  </span>
                  <span className="font-medium text-navy-900">{a.reason}</span>
                  {a.reference && <span className="tabular text-teal-700">{a.reference}</span>}
                  {a.clientName && <span className="text-slate-500">· {a.clientName}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {items.length > shown.length && (
            <p className="px-4 py-2 text-xs text-slate-500">
              {items.length - shown.length} autre(s) alerte(s) — affinez par département.
            </p>
          )}
        </div>
      )}
    </CockpitSectionShell>
  );
}
