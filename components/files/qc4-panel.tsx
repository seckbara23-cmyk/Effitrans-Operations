import type { QC4Evidence } from "@/lib/files/qc4";

/**
 * Contrôle Qualité N°4 — Opérations Transit. Read-only.
 *
 * Same four states as QC2, for the same reason: « we do not track it », « it has
 * not happened », and « you may not see it » are three different claims, and
 * none of them may ever be rendered as another.
 *
 * No « Conforme » anywhere — every Transit SLA policy bearing on QC4 is
 * unconfigured in the official registry, whose own doctrine is that such a
 * policy must never produce a late status.
 */
const DOT: Record<string, string> = {
  observed: "bg-teal-500",
  absent: "bg-slate-300",
  restricted: "bg-slate-200",
  not_represented: "bg-slate-200",
};

export function QC4Panel({ evidence }: { evidence: QC4Evidence }) {
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Contrôle Qualité N°4 — Opérations Transit
        </h2>
        <span className="text-[11px] text-slate-500">Constats, sans jugement de conformité</span>
      </div>

      <dl className="mt-3 divide-y divide-slate-100">
        {evidence.controls.map((c) => (
          <div key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} />
            <dt className="min-w-[14rem] text-sm text-slate-600">{c.labelFr}</dt>
            <dd className="flex-1 text-sm">
              {c.state === "observed" && <span className="font-medium text-navy-900">{c.value}</span>}
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
