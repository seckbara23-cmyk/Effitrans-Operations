"use client";

/**
 * HR-6 — Performance workspace (client).
 *
 * THREE THINGS THIS PANEL REFUSES TO DO:
 *   * compute a score — no average, no rating, no ranking is rendered anywhere;
 *   * show C3 prose to a reader without hr:sensitive:read — it says « réservé »
 *     instead, which is a different statement from an empty review;
 *   * offer a finalize button the server would refuse — the missing authority is
 *     NAMED, on the `hr:leave:approve` precedent.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPerformanceCycle, openPerformanceCycle, advancePerformanceCycle,
  assignObjective, submitSelfAssessment, submitManagerReview,
  finalizeEvaluation, acknowledgeEvaluation,
} from "@/lib/hr/performance-actions";
import {
  formatBp, WEIGHT_TOTAL_BP, weightCheck,
  CYCLE_STATUS_FR, EVALUATION_STATUS_FR,
  type PerformanceCycle, type Evaluation, type Objective, type Competency,
} from "@/lib/hr/performance/scoring";

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  forbidden_finalize: "Autorisation de finalisation requise (hr:performance:finalize) — en attente de ratification.",
  forbidden_config: "Autorisation de configuration requise (hr:config:manage).",
  cycle_not_found: "Cycle introuvable.",
  cycle_not_draft: "Seul un cycle en brouillon peut être ouvert.",
  cycle_not_open: "Le cycle n'est pas ouvert.",
  cycle_closed: "Le cycle n'accepte plus d'objectifs.",
  cycle_immutable: "Un cycle finalisé ou annulé est immuable.",
  cycle_terminal: "Un cycle finalisé ou annulé ne peut pas être rouvert.",
  forbidden_transition: "Transition de cycle interdite.",
  evaluation_not_found: "Évaluation introuvable.",
  evaluation_immutable: "Une évaluation finalisée est immuable — seule la prise de connaissance reste possible.",
  self_already_submitted: "L'auto-évaluation est déjà soumise.",
  self_not_submitted: "L'auto-évaluation doit être soumise d'abord.",
  same_actor_self: "Séparation des acteurs : l'évaluateur doit différer de la personne qui a saisi l'auto-évaluation.",
  same_actor_manager: "Séparation des acteurs : le finalisateur doit différer de l'évaluateur.",
  manager_not_submitted: "La revue du manager doit être soumise avant la finalisation.",
  weight_total_mismatch: "Le total des pondérations ne correspond pas au total configuré pour ce cycle.",
  weight_out_of_range: "Pondération hors bornes (0 à 100 %).",
  objective_locked: "Un objectif finalisé est immuable — un amendement crée une nouvelle version.",
  objective_not_found: "Objectif introuvable.",
  title_required: "L'intitulé est obligatoire.",
  not_finalized: "Seule une évaluation finalisée peut être accusée de réception.",
  invalid_period: "Période invalide.",
  invalid_weight_total: "Total de pondération invalide.",
  missing_field: "Champ obligatoire manquant.",
  save_failed: "Échec de l'enregistrement.",
};

const WITHHELD = "Contenu réservé (hr:sensitive:read)";

type Props = {
  cycles: PerformanceCycle[];
  evaluations: Evaluation[];
  objectives: Objective[];
  competencies: Competency[];
  employees: { id: string; label: string }[];
  canManage: boolean;
  canFinalize: boolean;
  canConfigure: boolean;
  canReadSensitive: boolean;
};

export function PerformanceStudio({
  cycles, evaluations, objectives, competencies, employees,
  canManage, canFinalize, canConfigure, canReadSensitive,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<string>(cycles[0]?.id ?? "");

  // New cycle
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  // New objective
  const [objEmployee, setObjEmployee] = useState("");
  const [objTitle, setObjTitle] = useState("");
  const [objWeightPct, setObjWeightPct] = useState("");
  const [objDue, setObjDue] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  const cycle = cycles.find((c) => c.id === selectedCycle) ?? null;
  const cycleEvaluations = useMemo(
    () => evaluations.filter((e) => e.cycleId === selectedCycle),
    [evaluations, selectedCycle],
  );
  const employeeLabel = (id: string) => employees.find((e) => e.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {!canFinalize && (
        <p className="surface p-4 text-sm text-slate-600">
          Les cycles, objectifs et revues sont gérables. <strong className="text-navy-800">La finalisation
          est une autorité distincte</strong> (« hr:performance:finalize ») qui n&apos;est attribuée à aucun
          rôle tant que la ratification n&apos;a pas eu lieu — une évaluation finalisée devient immuable,
          et cet acte ne se confond pas avec la gestion RH courante.
        </p>
      )}
      {!canReadSensitive && (
        <p className="surface p-4 text-sm text-slate-600">
          Le contenu des évaluations (commentaires, points forts, axes de développement) est classé C3 et
          nécessite « hr:sensitive:read ». Le déroulé du processus reste visible ; les textes sont réservés.
        </p>
      )}
      {competencies.length === 0 && canConfigure && (
        <p className="surface p-4 text-sm text-slate-600">
          Aucun référentiel de compétences n&apos;est défini. Les compétences, leurs échelles et les
          niveaux attendus sont propres à votre organisation — la plateforme n&apos;en propose aucun par défaut.
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouveau cycle d&apos;évaluation</h2>
          <div className="grid gap-2 sm:grid-cols-5">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code"
              aria-label="Code du cycle" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Intitulé"
              aria-label="Intitulé du cycle" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Type (annuelle, stage…)"
              aria-label="Type de cycle" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
              aria-label="Début de période" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
              aria-label="Fin de période" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </div>
          <button
            type="button"
            disabled={pending || !code.trim() || !label.trim() || !kind.trim() || !periodStart || !periodEnd}
            onClick={() => run(() => createPerformanceCycle({
              code, labelFr: label, cycleKind: kind, periodStart, periodEnd,
            }))}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Créer le cycle
          </button>
          <p className="text-xs text-slate-500">
            Le type de cycle est votre vocabulaire : rien n&apos;est imposé. Le total de pondération
            attendu est de {formatBp(WEIGHT_TOTAL_BP)} et sera vérifié à la finalisation.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Cycles</h2>
        {cycles.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun cycle d&apos;évaluation enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2">Cycle</th><th>Type</th><th>Période</th>
                  <th>Statut</th><th>Total pondéré</th><th />
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id} className={c.id === selectedCycle ? "bg-teal-50/60" : undefined}>
                    <td className="py-2 font-medium text-navy-900">{c.labelFr}<span className="ml-1 text-xs text-slate-400">{c.code}</span></td>
                    <td className="text-slate-600">{c.cycleKind}</td>
                    <td className="tabular text-slate-600">{c.periodStart} → {c.periodEnd}</td>
                    <td className="text-slate-600">{CYCLE_STATUS_FR[c.status]}</td>
                    <td className="tabular text-slate-600">{formatBp(c.weightTotalBp)}</td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" onClick={() => setSelectedCycle(c.id)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600">
                          Ouvrir
                        </button>
                        {canManage && c.status === "DRAFT" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => openPerformanceCycle(c.id))}
                            className="rounded-md bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
                            Lancer
                          </button>
                        )}
                        {canManage && c.status === "OPEN" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => advancePerformanceCycle(c.id, "IN_REVIEW"))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                            Passer en revue
                          </button>
                        )}
                        {canManage && c.status === "IN_REVIEW" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => advancePerformanceCycle(c.id, "FINALIZED"))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                            Clôturer le cycle
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {cycle && (
        <section className="surface space-y-4 p-5">
          <h2 className="text-sm font-semibold text-navy-900">
            {cycle.labelFr} — évaluations ({cycleEvaluations.length})
          </h2>

          {canManage && cycle.status !== "FINALIZED" && cycle.status !== "CANCELLED" && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigner un objectif</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <select value={objEmployee} onChange={(e) => setObjEmployee(e.target.value)}
                  aria-label="Employé" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                  <option value="">— Employé —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
                <input value={objTitle} onChange={(e) => setObjTitle(e.target.value)} placeholder="Intitulé"
                  aria-label="Intitulé de l'objectif" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
                <input value={objWeightPct} onChange={(e) => setObjWeightPct(e.target.value)}
                  inputMode="decimal" placeholder="Poids %" aria-label="Poids en pourcentage"
                  className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
                <input type="date" value={objDue} onChange={(e) => setObjDue(e.target.value)}
                  aria-label="Échéance" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
              </div>
              <button type="button" disabled={pending || !objEmployee || !objTitle.trim() || !objWeightPct}
                onClick={() => run(() => assignObjective({
                  cycleId: cycle.id, employeeId: objEmployee, title: objTitle,
                  // Percent in, basis points stored. Rounded to an integer here so
                  // no fractional basis point can ever reach the database.
                  weightBp: Math.round(Number(objWeightPct.replace(",", ".")) * 100),
                  dueDate: objDue || null,
                }))}
                className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Assigner
              </button>
            </div>
          )}

          {cycleEvaluations.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune évaluation. Lancez le cycle pour en créer une par employé ciblé.
            </p>
          ) : (
            <ul className="space-y-3">
              {cycleEvaluations.map((ev) => {
                const own = objectives.filter((o) => o.cycleId === cycle.id && o.employeeId === ev.employeeId);
                const w = weightCheck(own, cycle.weightTotalBp);
                return (
                  <li key={ev.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-navy-900">{employeeLabel(ev.employeeId)}</p>
                        <p className="text-xs text-slate-500">
                          {EVALUATION_STATUS_FR[ev.status]}
                          {ev.managerEmployeeId && <> · manager : {employeeLabel(ev.managerEmployeeId)}</>}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {canManage && ev.status === "DRAFT" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => submitSelfAssessment(ev.id, ""))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                            Soumettre l&apos;auto-évaluation
                          </button>
                        )}
                        {canManage && ev.status === "SELF_SUBMITTED" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => submitManagerReview({ evaluationId: ev.id, comments: "" }))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                            Soumettre la revue manager
                          </button>
                        )}
                        {ev.status === "MANAGER_SUBMITTED" && (
                          canFinalize ? (
                            <button type="button" disabled={pending}
                              onClick={() => run(() => finalizeEvaluation({ evaluationId: ev.id }))}
                              className="rounded-md bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
                              Finaliser
                            </button>
                          ) : (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">
                              Finalisation — autorisation en attente
                            </span>
                          )
                        )}
                        {canManage && ev.status === "FINALIZED" && (
                          <button type="button" disabled={pending}
                            onClick={() => run(() => acknowledgeEvaluation(ev.id))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                            Accuser réception
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-slate-500">
                      Objectifs : {own.length} ·{" "}
                      {w.applicable ? (
                        <span className={w.satisfied ? "text-teal-700" : "text-amber-700"}>
                          total {formatBp(w.totalBp)} / {formatBp(w.requiredBp)}
                          {w.satisfied ? "" : " — à corriger avant finalisation"}
                        </span>
                      ) : (
                        <span>revue par compétences uniquement</span>
                      )}
                    </p>

                    {ev.contentWithheld ? (
                      <p className="mt-1 text-xs italic text-slate-400">{WITHHELD}</p>
                    ) : (
                      (ev.managerComments || ev.finalSummary) && (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                          {ev.finalSummary || ev.managerComments}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
