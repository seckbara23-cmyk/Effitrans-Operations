/**
 * "Parcours officiel Effitrans" — compact dossier panel (5.0E-1, Deliverable 10).
 * ---------------------------------------------------------------------------
 * SERVER component. Renders nothing at all when the process engine is dark, when
 * the user cannot read the process, or when this dossier has no instance — so the
 * dossier page is byte-for-byte unchanged in today's production.
 *
 * Deliberately NOT a 26-step checklist. It answers "where is this, who has it, what
 * happens next" and links to the full inspector for anyone who needs the chain.
 */
import Link from "next/link";
import { getProcessState } from "@/lib/process/engine/service";
import { getIntakeState } from "@/lib/process/engine/intake-actions";
import { summarizeJourney } from "@/lib/navigation/journey";

export async function ProcessJourneyPanel({ fileId }: { fileId: string }) {
  // No flag read here on purpose. getProcessState is the single gate: it checks the
  // global kill switch, resolves the user, checks THAT TENANT's rollout, enforces
  // process:read, and returns null for anything it will not answer. A second flag
  // check here would be a second place to get the rollout rule wrong.
  const model = await getProcessState(fileId);

  // DEFECT-UAT15c — the catch-22 this closes.
  //
  // getProcessState returns null when the dossier has NO instance, and this
  // panel held the ONLY link to /files/{id}/process. So the surface where a
  // dossier's process is opened was unreachable from the dossier page for
  // exactly the dossiers that still needed opening: the link appeared only
  // once the process already existed.
  //
  // In production that cost three UAT-15 attempts. The operator used the
  // controls that WERE visible — « Responsable » and « Faire avancer → Ouvert »
  // — which move operational_file.status to OPENED and create no instance, and
  // reasonably read that as having opened the dossier.
  //
  // The invitation must not be shown to someone who could not act on it, so the
  // gate is `getIntakeState`: the SAME resolver the process page and the
  // diagnostics route use, which enforces the intake flags, process:read and
  // file visibility. Nothing is opened here — this is a signpost, not an action.
  if (!model) {
    const intake = await getIntakeState(fileId);
    if (!intake || intake.hasInstance) return null;
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-navy-900">Parcours officiel Effitrans</h2>
        <p className="mt-1 text-xs text-slate-600">
          Le processus officiel de ce dossier n&apos;est pas encore ouvert. Tant qu&apos;il ne
          l&apos;est pas, les étapes, les responsables et la vérification des documents ne sont
          pas disponibles — le statut du dossier ne suffit pas à l&apos;ouvrir.
        </p>
        <Link
          href={`/files/${fileId}/process`}
          className="mt-2 inline-block text-xs font-medium text-teal-700 hover:text-teal-900"
        >
          Ouvrir le processus officiel →
        </Link>
      </section>
    );
  }

  const j = summarizeJourney(model);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy-900">Parcours officiel Effitrans</h2>
          <p className="truncate text-xs text-slate-500">{j.stageLabel}</p>
        </div>
        <Link
          href={`/files/${fileId}/process`}
          className="shrink-0 text-xs font-medium text-teal-700 hover:text-teal-900"
        >
          Voir les 26 étapes
        </Link>
      </div>

      {/* WES-2 — a COUNT of official steps, never a percentage. Dossier progress
          has exactly one number and the lifecycle tracker on this page renders
          it; a second bar here would be a second answer. */}
      <div className="mb-3">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="font-medium text-slate-700">
            {j.completed}/{j.total} étapes officielles
          </span>
          {j.inferred && <span className="text-amber-700">Historique reconstitué, non vérifié</span>}
        </div>
        {j.unverifiedCount > 0 && (
          <p className="mt-1 text-[11px] text-amber-700">
            {j.unverifiedCount} étape(s) supposée(s) à partir de l&apos;ancien dossier — sans preuve.
          </p>
        )}
      </div>

      {/* Who has it now. */}
      <dl className="mb-3 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">Détenteur</dt>
          <dd className="font-medium text-navy-900">{j.ownerLabel ?? "Personne — non attribué"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">Prochaine action</dt>
          <dd className="font-medium text-navy-900">{j.nextAction}</dd>
        </div>
        {j.current.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">Étape(s) en cours</dt>
            <dd className="min-w-0 text-navy-900">
              {j.current.map((c) => (
                <span key={`${c.stepNumber}-${c.labelFr}`} className="block truncate">
                  {c.stepNumber ? `${c.stepNumber}. ` : ""}
                  {c.labelFr}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {/* The parallel branch — the part of the official process a linear list hides. */}
      <div className="grid grid-cols-2 gap-2">
        {j.branches.map((b) => (
          <div
            key={b.labelFr}
            className={`rounded border px-2.5 py-1.5 text-xs ${
              b.complete
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            <p className="font-semibold">{b.labelFr}</p>
            <p className="truncate">{b.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
