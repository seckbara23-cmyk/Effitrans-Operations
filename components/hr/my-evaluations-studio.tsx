"use client";

/**
 * HR-B2 — « Mes évaluations » (client). Three audiences, one page, all scoped
 * by the server: the employee acting on their OWN evaluation, the manager of
 * record reviewing their team's, and Direction finalizing. Every status and
 * refusal is a French sentence; no permission code, SQLSTATE or column name
 * reaches the screen.
 *
 * The C3 prose shown here is disclosed by the ratified Q2 lanes — your own
 * record, or the self-assessment of someone whose review you must write. What
 * is withheld says so plainly rather than appearing empty.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  submitSelfAssessment, submitManagerReview, finalizeEvaluation, acknowledgeEvaluation,
} from "@/lib/hr/performance-actions";
import { EVALUATION_STATUS_FR, formatBp, type EvaluationStatus } from "@/lib/hr/performance/scoring";
import type { EvaluationLine, MyPerformanceWorkspace } from "@/lib/hr/my-performance";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SELF_SUBMITTED: "bg-amber-100 text-amber-800",
  MANAGER_SUBMITTED: "bg-sky-100 text-sky-800",
  FINALIZED: "bg-emerald-100 text-emerald-800",
  ACKNOWLEDGED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

const ERR: Record<string, string> = {
  forbidden: "Vous devez être connecté.",
  forbidden_stage: "Vous n'êtes pas autorisé à effectuer cette étape : seule la personne concernée, son responsable hiérarchique de la campagne ou la Direction peut le faire.",
  forbidden_finalize: "Vous devez être connecté.",
  actor_invalid: "Votre compte n'est pas actif.",
  own_evaluation: "Vous ne pouvez pas évaluer ni finaliser votre propre évaluation.",
  same_actor_self: "Séparation des tâches : l'évaluateur doit différer de l'auto-évalué.",
  same_actor_manager: "Séparation des tâches : le finalisateur doit différer de l'évaluateur — la Direction finalisera cette revue.",
  evaluation_not_found: "Évaluation introuvable.",
  self_already_submitted: "Votre auto-évaluation est déjà soumise.",
  self_not_submitted: "L'auto-évaluation doit être soumise d'abord.",
  manager_not_submitted: "La revue du responsable doit être soumise d'abord.",
  not_finalized: "Seule une évaluation finalisée peut être accusée de réception.",
  evaluation_immutable: "Cette évaluation est finalisée — elle ne peut plus être modifiée.",
  cycle_not_open: "La campagne n'est pas ouverte.",
  weight_total_mismatch: "Le total des pondérations des objectifs ne correspond pas au total attendu de la campagne.",
  save_failed: "Échec de l'enregistrement.",
};

const WITHHELD = "Contenu réservé — vous n'avez pas accès à ce texte.";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}>
      {EVALUATION_STATUS_FR[status as EvaluationStatus] ?? status}
    </span>
  );
}

function Objectives({ line }: { line: EvaluationLine }) {
  if (line.objectives.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-slate-500">Objectifs</p>
      <ul className="space-y-1">
        {line.objectives.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline gap-2 text-sm text-slate-700">
            <span className="font-medium text-navy-900">{o.title}</span>
            <span className="text-xs text-slate-500">pondération {formatBp(o.weightBp)}</span>
            <span className="text-xs text-slate-500">· avancement {formatBp(o.progressBp)}</span>
            {o.managerAchievementBp !== null && (
              <span className="text-xs text-slate-500">· atteinte {formatBp(o.managerAchievementBp)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MyEvaluationsStudio({
  workspace, canFinalize,
}: { workspace: MyPerformanceWorkspace; canFinalize: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, { comments: string; strengths: string; development: string }>>({});

  const { employee, mine, team, awaitingFinalization } = workspace;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setError(null); setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else { setNotice(done); router.refresh(); }
    });
  };

  const review = (id: string) => reviews[id] ?? { comments: "", strengths: "", development: "" };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {!employee && (
        <p className="surface p-4 text-sm text-slate-600">
          Votre compte n&apos;est pas encore lié à un dossier employé — vos évaluations personnelles
          ne sont pas disponibles. Contactez les Ressources humaines pour établir le lien.
        </p>
      )}

      {employee && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Mes évaluations</h2>
          {mine.length === 0 && (
            <p className="text-sm text-slate-500">Aucune évaluation ouverte à votre nom pour le moment.</p>
          )}
          {mine.map((l) => (
            <article key={l.evaluation.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">{l.cycleLabel}</p>
                <StatusBadge status={l.evaluation.status} />
              </div>
              <Objectives line={l} />

              {l.evaluation.status === "DRAFT" && (
                <div className="mt-3 space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Mon auto-évaluation</span>
                    <textarea
                      rows={4}
                      value={drafts[l.evaluation.id] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [l.evaluation.id]: e.target.value })}
                      placeholder="Vos réalisations, vos difficultés, ce que vous souhaitez développer."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    disabled={pending || !(drafts[l.evaluation.id] ?? "").trim()}
                    onClick={() => run(() => submitSelfAssessment(l.evaluation.id, drafts[l.evaluation.id] ?? ""), "Auto-évaluation soumise.")}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    Soumettre mon auto-évaluation
                  </button>
                </div>
              )}

              {l.evaluation.selfComments && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Mon auto-évaluation</span>
                  {l.evaluation.selfComments}
                </p>
              )}
              {l.evaluation.managerComments && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Revue de mon responsable</span>
                  {l.evaluation.managerComments}
                </p>
              )}
              {l.evaluation.managerStrengths && (
                <p className="mt-2 text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Points forts</span>
                  {l.evaluation.managerStrengths}
                </p>
              )}
              {l.evaluation.managerDevelopment && (
                <p className="mt-2 text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Axes de développement</span>
                  {l.evaluation.managerDevelopment}
                </p>
              )}
              {l.evaluation.finalSummary && (
                <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Synthèse finale</span>
                  {l.evaluation.finalSummary}
                </p>
              )}
              {l.evaluation.contentWithheld && <p className="mt-3 text-sm text-slate-400">{WITHHELD}</p>}

              {l.evaluation.status === "FINALIZED" && (
                <div className="mt-3">
                  <button
                    disabled={pending}
                    onClick={() => run(() => acknowledgeEvaluation(l.evaluation.id), "Accusé de réception enregistré.")}
                    className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
                  >
                    J&apos;accuse réception
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    L&apos;accusé de réception atteste que vous avez pris connaissance de cette évaluation ; il ne vaut pas approbation.
                  </p>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {team.length > 0 && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Évaluations de mon équipe</h2>
          {team.map((l) => (
            <article key={l.evaluation.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">
                  {l.employeeName}{" "}
                  <span className="font-normal text-slate-500">({l.employeeNumber} · {l.departmentFr})</span>
                </p>
                <StatusBadge status={l.evaluation.status} />
              </div>
              <p className="text-xs text-slate-500">{l.cycleLabel}</p>

              {l.evaluation.selfComments && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">
                  <span className="block text-xs font-medium text-slate-500">Auto-évaluation de l&apos;employé</span>
                  {l.evaluation.selfComments}
                </p>
              )}
              {l.evaluation.contentWithheld && <p className="mt-3 text-sm text-slate-400">{WITHHELD}</p>}

              {l.evaluation.status === "SELF_SUBMITTED" && (
                <div className="mt-3 space-y-2">
                  <textarea
                    rows={3}
                    value={review(l.evaluation.id).comments}
                    onChange={(e) => setReviews({ ...reviews, [l.evaluation.id]: { ...review(l.evaluation.id), comments: e.target.value } })}
                    placeholder="Votre appréciation d'ensemble"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={review(l.evaluation.id).strengths}
                      onChange={(e) => setReviews({ ...reviews, [l.evaluation.id]: { ...review(l.evaluation.id), strengths: e.target.value } })}
                      placeholder="Points forts"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      value={review(l.evaluation.id).development}
                      onChange={(e) => setReviews({ ...reviews, [l.evaluation.id]: { ...review(l.evaluation.id), development: e.target.value } })}
                      placeholder="Axes de développement"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    disabled={pending || !review(l.evaluation.id).comments.trim()}
                    onClick={() => run(() => submitManagerReview({
                      evaluationId: l.evaluation.id,
                      comments: review(l.evaluation.id).comments,
                      strengths: review(l.evaluation.id).strengths || null,
                      development: review(l.evaluation.id).development || null,
                    }), "Revue transmise.")}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    Transmettre ma revue
                  </button>
                </div>
              )}

              {l.evaluation.status === "MANAGER_SUBMITTED" && (
                <p className="mt-2 text-xs text-slate-500">
                  Revue transmise — la finalisation revient à la Direction (un responsable ne finalise jamais la revue qu&apos;il a écrite).
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {canFinalize && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Évaluations à finaliser (Direction)</h2>
          {awaitingFinalization.length === 0 && (
            <p className="text-sm text-slate-500">Aucune évaluation en attente de finalisation.</p>
          )}
          {awaitingFinalization.map((l) => (
            <article key={l.evaluation.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">
                  {l.employeeName}{" "}
                  <span className="font-normal text-slate-500">({l.employeeNumber} · {l.departmentFr})</span>
                </p>
                <StatusBadge status={l.evaluation.status} />
              </div>
              <p className="text-xs text-slate-500">{l.cycleLabel}</p>
              {l.evaluation.contentWithheld && <p className="mt-3 text-sm text-slate-400">{WITHHELD}</p>}
              <button
                disabled={pending}
                onClick={() => run(() => finalizeEvaluation({ evaluationId: l.evaluation.id }), "Évaluation finalisée.")}
                className="mt-3 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                Finaliser
              </button>
              <p className="mt-1 text-xs text-slate-500">
                La finalisation verrouille définitivement l&apos;évaluation et ses objectifs.
              </p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
