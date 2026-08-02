"use client";

/**
 * HR-6 — Training register (client).
 *
 * A REGISTER. There is no course content here, no lesson, no player and no
 * progress bar inside a course: the register records that a person is required
 * to hold a training, whether they completed it, and when it lapses. Where the
 * training actually happened is a reference OUT (`provider_reference`).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertTrainingCourse, retireTrainingCourse, assignTraining,
  advanceEnrollment, completeTraining, closeEnrollment,
} from "@/lib/hr/training-actions";
import {
  DELIVERY_MODE_FR, ENROLLMENT_STATUS_FR,
  type TrainingCourse, type TrainingEnrollment, type DeliveryMode,
} from "@/lib/hr/training/catalog";

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  course_not_found: "Formation introuvable.",
  course_inactive: "Cette formation est retirée du catalogue.",
  employee_not_found: "Employé introuvable.",
  enrollment_not_found: "Inscription introuvable.",
  enrollment_closed: "Cette inscription est clôturée — une reprise se fait par une nouvelle inscription.",
  evidence_required: "Cette formation exige une pièce justificative (certificat).",
  invalid_transition: "Transition impossible depuis le statut actuel.",
  invalid_closure: "Clôture invalide.",
  invalid_duration: "Durée invalide (minutes, entier positif).",
  invalid_validity: "Validité invalide (mois, entier positif).",
  invalid_date: "Date invalide (AAAA-MM-JJ).",
  invalid_period: "Période invalide.",
  reason_required: "Le motif est obligatoire.",
  missing_field: "Champ obligatoire manquant.",
  save_failed: "Échec de l'enregistrement.",
};

const MODES: DeliveryMode[] = ["IN_PERSON", "ONLINE", "INTERNAL", "EXTERNAL", "CERTIFICATION"];

export function TrainingStudio({
  courses, enrollments, employees, canManage, completedThisYear,
}: {
  courses: TrainingCourse[];
  enrollments: TrainingEnrollment[];
  employees: { id: string; label: string }[];
  canManage: boolean;
  completedThisYear: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [mode, setMode] = useState<DeliveryMode>("IN_PERSON");
  const [validity, setValidity] = useState("");
  const [mandatory, setMandatory] = useState(false);

  const [enrEmployee, setEnrEmployee] = useState("");
  const [enrCourse, setEnrCourse] = useState("");
  const [enrDue, setEnrDue] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  const courseTitle = (id: string) => courses.find((c) => c.id === id)?.title ?? id;
  const employeeLabel = (id: string) => employees.find((e) => e.id === id)?.label ?? id;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <p className="surface p-4 text-sm text-slate-600">
        Ce module suit <strong className="text-navy-800">les exigences, les inscriptions, la réalisation
        et les preuves</strong> de formation. Il n&apos;héberge aucun contenu pédagogique : la formation
        se déroule chez le prestataire, et la référence prestataire renvoie vers lui.
        {" "}Formations terminées depuis le 1<sup>er</sup> janvier : <strong>{completedThisYear}</strong>.
      </p>

      {/* ---------------------------------------------------------------- */}
      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Ajouter une formation au catalogue</h2>
          <div className="grid gap-2 sm:grid-cols-5">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code"
              aria-label="Code de la formation" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé"
              aria-label="Intitulé de la formation" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Prestataire"
              aria-label="Prestataire" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <select value={mode} onChange={(e) => setMode(e.target.value as DeliveryMode)}
              aria-label="Modalité" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              {MODES.map((m) => <option key={m} value={m}>{DELIVERY_MODE_FR[m]}</option>)}
            </select>
            <input value={validity} onChange={(e) => setValidity(e.target.value)} inputMode="numeric"
              placeholder="Validité (mois)" aria-label="Validité en mois"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
            Formation obligatoire
          </label>
          <button type="button" disabled={pending || !code.trim() || !title.trim()}
            onClick={() => run(() => upsertTrainingCourse({
              code, title, provider: provider || null, deliveryMode: mode,
              validityMonths: validity ? Number(validity) : null, isMandatory: mandatory,
            }))}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            Ajouter au catalogue
          </button>
          <p className="text-xs text-slate-500">
            La validité est votre intervalle de recyclage : aucune durée légale n&apos;est supposée.
            Laissez vide si la formation n&apos;expire pas.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Catalogue ({courses.length})</h2>
        {courses.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune formation au catalogue.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2">Formation</th><th>Prestataire</th><th>Modalité</th>
                  <th>Validité</th><th>Obligatoire</th><th>État</th><th />
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                    <td className="py-2 font-medium text-navy-900">{c.title}<span className="ml-1 text-xs text-slate-400">{c.code}</span></td>
                    <td className="text-slate-600">{c.provider ?? "—"}</td>
                    <td className="text-slate-600">{DELIVERY_MODE_FR[c.deliveryMode]}</td>
                    <td className="tabular text-slate-600">{c.validityMonths ? `${c.validityMonths} mois` : "sans expiration"}</td>
                    <td className="text-slate-600">{c.isMandatory ? "Oui" : "Non"}</td>
                    <td className="text-slate-600">{c.isActive ? "Active" : "Retirée"}</td>
                    <td className="py-2 text-right">
                      {canManage && c.isActive && (
                        <button type="button" disabled={pending}
                          onClick={() => run(() => retireTrainingCourse(c.id))}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-50">
                          Retirer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Assigner une formation</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            <select value={enrEmployee} onChange={(e) => setEnrEmployee(e.target.value)}
              aria-label="Employé" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              <option value="">— Employé —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <select value={enrCourse} onChange={(e) => setEnrCourse(e.target.value)}
              aria-label="Formation" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              <option value="">— Formation —</option>
              {courses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <input type="date" value={enrDue} onChange={(e) => setEnrDue(e.target.value)}
              aria-label="Échéance" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <button type="button" disabled={pending || !enrEmployee || !enrCourse}
              onClick={() => run(() => assignTraining({
                employeeId: enrEmployee, courseId: enrCourse, dueDate: enrDue || null,
              }))}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              Assigner
            </button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Inscriptions ({enrollments.length})</h2>
        {enrollments.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune inscription enregistrée.</p>
        ) : (
          <ul className="space-y-2">
            {enrollments.map((e) => {
              const overdue = e.dueDate !== null && e.dueDate < today
                && ["PLANNED", "ENROLLED", "IN_PROGRESS"].includes(e.status);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                  <div>
                    <p className="text-sm font-semibold text-navy-900">{employeeLabel(e.employeeId)}</p>
                    <p className="text-xs text-slate-500">
                      {courseTitle(e.courseId)} · {ENROLLMENT_STATUS_FR[e.status]}
                      {e.dueDate && (
                        <span className={overdue ? " text-red-600" : undefined}> · échéance {e.dueDate}</span>
                      )}
                      {e.expiryDate && <> · expire le {e.expiryDate}</>}
                      {e.certificateDocumentId && <> · certificat enregistré</>}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-1.5">
                      {e.status === "PLANNED" && (
                        <button type="button" disabled={pending}
                          onClick={() => run(() => advanceEnrollment(e.id, "ENROLLED"))}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                          Inscrire
                        </button>
                      )}
                      {["PLANNED", "ENROLLED"].includes(e.status) && (
                        <button type="button" disabled={pending}
                          onClick={() => run(() => advanceEnrollment(e.id, "IN_PROGRESS"))}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                          Démarrer
                        </button>
                      )}
                      {["PLANNED", "ENROLLED", "IN_PROGRESS"].includes(e.status) && (
                        <>
                          <button type="button" disabled={pending}
                            onClick={() => run(() => completeTraining({ enrollmentId: e.id, result: "RÉUSSI" }))}
                            className="rounded-md bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
                            Terminer
                          </button>
                          <button type="button" disabled={pending}
                            onClick={() => run(() => closeEnrollment(e.id, "FAILED"))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-50">
                            Échec
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
