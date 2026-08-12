import type { QC2Evidence } from "@/lib/files/qc2";

/**
 * Contrôle Qualité N°2 — Account Manager. Read-only.
 *
 * Four states, deliberately distinct, because collapsing any two of them would
 * state something the platform does not know:
 *
 *   observed        — a recorded fact
 *   absent          — the step has not happened on this dossier
 *   restricted      — the VIEWER may not see it. Never rendered as zero: a
 *                     reader without document:read must not be told there are
 *                     no documents.
 *   not_represented — the platform does not record this control, with why.
 *
 * No « Conforme » anywhere: Effitrans has defined no opening criterion and no
 * procedure référentiel, so there is nothing to judge against.
 */
const DOT: Record<string, string> = {
  observed: "bg-teal-500",
  absent: "bg-slate-300",
  restricted: "bg-slate-200",
  not_represented: "bg-slate-200",
};

export function QC2Panel({ evidence }: { evidence: QC2Evidence }) {
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Contrôle Qualité N°2 — Account Manager
        </h2>
        <span className="text-[11px] text-slate-500">Constats, sans jugement de conformité</span>
      </div>

      <dl className="mt-3 divide-y divide-slate-100">
        {evidence.controls.map((c) => (
          <div key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} />
            <dt className="min-w-[12rem] text-sm text-slate-600">{c.labelFr}</dt>
            <dd className="flex-1 text-sm">
              {c.state === "observed" && (
                <span className="font-medium text-navy-900">{c.value}</span>
              )}
              {c.state === "absent" && <span className="text-slate-400">Non renseigné</span>}
              {c.state === "restricted" && (
                <span className="text-slate-400">Non visible avec vos accès</span>
              )}
              {c.state === "not_represented" && (
                <span className="text-slate-400">Non suivi par la plateforme</span>
              )}
              {c.reason && <span className="block text-[11px] text-slate-400">{c.reason}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
