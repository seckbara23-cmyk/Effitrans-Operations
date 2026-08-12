import type { QC1Evidence } from "@/lib/commercial/qc1";

/**
 * Contrôle Qualité N°1 — Service Commercial. Read-only.
 *
 * Shows what the commercial authority already knows, and says plainly where it
 * knows nothing. Three states, deliberately distinct:
 *
 *   observed        — a recorded fact, shown as the fact
 *   absent          — the step has not happened yet on this request
 *   not_represented — the platform does not record this control at all, with
 *                     the reason. NEVER rendered as a failure, because "we do
 *                     not track it" and "it was not done" are different claims
 *                     and only one of them is ours to make.
 *
 * There is no « Conforme » / « Non conforme » anywhere: no authoritative
 * commercial deadline exists to judge against, and manufacturing one would turn
 * an unratified rule into a verdict on someone's work.
 */
const DOT: Record<string, string> = {
  observed: "bg-teal-500",
  absent: "bg-slate-300",
  not_represented: "bg-slate-200",
};

export function QC1Panel({ evidence }: { evidence: QC1Evidence }) {
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-navy-900">
          Contrôle Qualité N°1 — Service Commercial
        </h2>
        <span className="text-[11px] text-slate-500">Constats, sans jugement de conformité</span>
      </div>

      <dl className="mt-3 divide-y divide-slate-100">
        {evidence.controls.map((c) => (
          <div key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} />
            <dt className="min-w-[13rem] text-sm text-slate-600">{c.labelFr}</dt>
            <dd className="flex-1 text-sm">
              {c.state === "observed" && <span className="font-medium text-navy-900">{c.value}</span>}
              {c.state === "absent" && <span className="text-slate-400">Non renseigné</span>}
              {c.state === "not_represented" && (
                <span className="text-slate-400">
                  Non suivi par la plateforme
                  {c.reason && <span className="block text-[11px] text-slate-400">{c.reason}</span>}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
