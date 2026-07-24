import Link from "next/link";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitEmptyState, CockpitUnavailableState } from "./cockpit-states";
import type { OperationalAlert, OperationalAlertSet } from "@/lib/operations/alerts/types";
import type { ExecutiveAlertLevel } from "@/lib/executive/types";

/**
 * Centre d'Opérations — attention panel (Phase 10.0E-3). The SINGLE operational
 * alert renderer on /dashboard. It consumes the unified, permission-shaped
 * OperationalAlertSet exactly as the composition layer produced it — it does NOT
 * dedupe, re-sort, recount, remap severity or interpret codes; it trusts the
 * engine. It renders ONLY safe normalized fields (level / reason / reference /
 * clientName / href) — never a code, entityId, source key or raw id.
 *
 * Source honesty (DEC-B58): a `null` set (the reader itself failed) or all
 * permitted sources unavailable ⇒ « Alertes temporairement indisponibles »
 * (never « 0 alertes »). Some sources unavailable alongside real alerts ⇒ a
 * quiet partial warning. Omitted sources (permission absent) never warn — the
 * set is simply permission-shaped; a viewer with no alert source sees no panel.
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
const TITLE = "Attention requise";

/** A quiet, accessible chip — no internal source keys are ever named. */
function PartialWarning() {
  return (
    <p role="status" className="mt-1 text-[11px] text-amber-600">
      ○ Certaines sources d'alerte sont temporairement indisponibles.
    </p>
  );
}

function AlertRow({ a, index }: { a: OperationalAlert; index: number }) {
  const body = (
    <>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[a.level]}`}>
        <span aria-hidden>{LEVEL_DOT[a.level]}</span>
        {LEVEL_LABEL[a.level]}
      </span>
      <span className="font-medium text-navy-900">{a.reason}</span>
      {a.reference && <span className="tabular text-teal-700">{a.reference}</span>}
      {a.clientName && <span className="text-slate-500">· {a.clientName}</span>}
    </>
  );
  const cls = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm";
  // href may be empty for a credible-destination-less alert (DEC-B54) — render a non-link row then.
  return a.href
    ? <Link href={a.href} className={`${cls} transition hover:bg-slate-50/70`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function CockpitAttentionPanel({ set }: { set: OperationalAlertSet | null }) {
  // The reader itself failed ⇒ truthful unavailable, never « 0 alertes ».
  if (!set) {
    return (
      <CockpitSectionShell title={TITLE}>
        <CockpitUnavailableState message="Alertes temporairement indisponibles." />
      </CockpitSectionShell>
    );
  }

  const { alerts, counts, sources } = set;
  const anyUnavailable = sources.some((s) => s.status === "unavailable");
  const anyOk = sources.some((s) => s.status === "ok");

  // No alerts + a permitted source could not be read ⇒ we cannot claim zero.
  if (alerts.length === 0 && anyUnavailable) {
    return (
      <CockpitSectionShell title={TITLE}>
        <CockpitUnavailableState message="Alertes temporairement indisponibles." />
      </CockpitSectionShell>
    );
  }

  // No alerts and no readable source at all (every source omitted by permission) ⇒
  // permission-shaped: this viewer simply has no alert surface — omit the panel, no warning.
  if (alerts.length === 0 && !anyOk) return null;

  // No alerts, all permitted sources succeeded ⇒ truthful empty state.
  if (alerts.length === 0) {
    return (
      <CockpitSectionShell title={TITLE}>
        <CockpitEmptyState message="Aucune alerte opérationnelle pour le moment." />
      </CockpitSectionShell>
    );
  }

  const shown = alerts.slice(0, PRIMARY_CAP); // trust the engine's order — no re-sort
  return (
    <CockpitSectionShell
      title={TITLE}
      subtitle={`${counts.critical} critique(s) · ${counts.high} élevé(s) · ${counts.medium} moyen(s)`}
    >
      {anyUnavailable && <PartialWarning />}
      <div className="surface divide-y divide-slate-100">
        <ul>
          {shown.map((a, i) => (
            <li key={`${a.reference ?? ""}|${i}`}>
              <AlertRow a={a} index={i} />
            </li>
          ))}
        </ul>
        {alerts.length > shown.length && (
          <p className="px-4 py-2 text-xs text-slate-500">
            {alerts.length - shown.length} autre(s) alerte(s) — affinez par département.
          </p>
        )}
      </div>
    </CockpitSectionShell>
  );
}
