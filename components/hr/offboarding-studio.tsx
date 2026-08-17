"use client";

/**
 * HR-8B — Départs (client). The workspace over the HR-8A foundation.
 *
 * PLAIN FRENCH ONLY: the database refusals (HR813/HR814/HR815 and friends)
 * are translated into business sentences here. No SQLSTATE, no permission
 * code, and no engineering vocabulary reaches the screen.
 *
 * WHAT THIS SCREEN NEVER DOES: it does not terminate anyone (the registry
 * owns the employment lifecycle), it does not record equipment returns (the
 * Équipements workspace owns custody), and it does not archive or disable a
 * login account — after clôture it PROMPTS the operator toward
 * Administration → Utilisateurs, which is a different authority entirely.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  openOffboardingCase, completeOffboardingItem, completeOffboardingCase, cancelOffboardingCase,
} from "@/lib/hr/offboarding-actions";
import type { Database } from "@/lib/db/types";
// The account-status vocabulary belongs to the platform's user lifecycle; HR
// reads it, never redefines it (and never writes it).
import { STAFF_STATUS_LABEL } from "@/lib/users/lifecycle";

type Tbl = Database["public"]["Tables"];
type Case = Tbl["hr_offboarding_case"]["Row"];
type Item = Tbl["hr_offboarding_item"]["Row"];
type Template = Tbl["hr_checklist_template"]["Row"];

export type CaseGates = {
  equipment: { id: string; label: string; assignedOn: string }[];
  missingDocuments: string[];
  contractsNotEnded: number;
  account: { linked: boolean; status: string | null };
  /** The employee's own documents — the only evidence a step may cite (HR816). */
  documents: { id: string; label: string }[];
};

const STATUS_FR: Record<string, string> = {
  OPEN: "Ouvert", IN_PROGRESS: "En cours", COMPLETED: "Clôturé", CANCELLED: "Annulé",
};
const ITEM_STATUS_FR: Record<string, string> = {
  PENDING: "À faire", DONE: "Fait", NOT_APPLICABLE: "Sans objet",
};

/** Governed refusals → business sentences. The user never sees a code. */
const ERR: Record<string, string> = {
  forbidden: "Vous n'avez pas les droits nécessaires pour cette action.",
  forbidden_offboarding: "Vous n'avez pas les droits nécessaires pour cette action.",
  actor_invalid: "Votre compte n'est plus actif dans cette organisation.",
  employee_not_found: "Employé introuvable.",
  reason_required: "Le motif est obligatoire.",
  employee_not_offboardable: "Seul un employé actif ou suspendu peut entrer en procédure de départ.",
  template_invalid: "Le modèle de clôture sélectionné n'est pas valable.",
  manager_invalid: "Le responsable sélectionné est introuvable.",
  case_already_open: "Un départ est déjà en cours pour cet employé.",
  invalid_status: "Action impossible dans l'état actuel.",
  item_not_found: "Étape introuvable.",
  evidence_required: "Une pièce justificative est requise pour cette étape.",
  evidence_not_eligible: "La pièce choisie n'appartient pas au dossier de cet employé.",
  case_not_open: "Ce dossier de départ n'est plus modifiable.",
  case_not_found: "Dossier de départ introuvable.",
  wrong_status: "Action impossible dans l'état actuel du dossier.",
  employee_not_terminated: "L'employé doit d'abord être marqué comme ayant quitté l'entreprise, dans sa fiche du registre.",
  equipment_outstanding: "Du matériel est encore attribué à cet employé. Enregistrez la restitution dans Équipements.",
  blocking_items_pending: "Certaines étapes obligatoires ne sont pas terminées.",
  event_failed: "L'événement d'historique n'a pas pu être écrit — l'action a été annulée.",
  save_failed: "L'enregistrement a échoué.",
};

function Progress({ items }: { items: Item[] }) {
  if (items.length === 0) return <span className="text-xs text-slate-400">Aucune étape</span>;
  const done = items.filter((i) => i.status !== "PENDING").length;
  return <span className="text-xs text-slate-500">{done}/{items.length} étapes</span>;
}

export function OffboardingStudio({
  cases, employeeById, eligible, templates, itemsByCase, gatesByCase, canManage, registrySize,
}: {
  cases: Case[];
  employeeById: Record<string, { label: string; matricule: string; status: string }>;
  eligible: { id: string; label: string }[];
  templates: Template[];
  itemsByCase: Record<string, Item[]>;
  gatesByCase: Record<string, CaseGates>;
  canManage: boolean;
  /** How many people the HR registry holds — an empty picker must say WHY. */
  registrySize: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffFor, setHandoffFor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  /** Document chosen as evidence, per checklist step. */
  const [evidenceFor, setEvidenceFor] = useState<Record<string, string>>({});

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; detail?: string; promptAccountHandoff?: boolean }>,
    onOk?: (res: { promptAccountHandoff?: boolean }) => void,
  ) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        // The database names the pending steps; show the names, not the code.
        const named = res.error === "blocking_items_pending" && res.detail
          ? `${ERR.blocking_items_pending} ${res.detail.replace(/^.*?:\s*/, "Restent à traiter : ")}`
          : null;
        setError(named ?? ERR[res.error ?? ""] ?? ERR.save_failed);
      } else {
        onOk?.(res);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800" role="status">{notice}</p>}

      {handoffFor && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="status">
          <p className="font-medium">
            {gatesByCase[handoffFor]?.account.status === "active"
              ? "Départ clôturé. L'accès à la plateforme n'a PAS été désactivé."
              : "Départ clôturé. Le compte de connexion n'est pas encore archivé."}
          </p>
          <p className="mt-1">
            La désactivation ou l&apos;archivage du compte de connexion est une action distincte, confiée à
            l&apos;administration des comptes. Pour la réaliser, utilisez{" "}
            <Link href="/users" className="underline">Administration → Utilisateurs</Link>.
          </p>
        </div>
      )}

      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouveau départ</h2>
          {/* An empty list of eligible people is a legitimate state, but never a
              silent one: it has two distinct causes and the user is told which. */}
          {eligible.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {registrySize === 0 ? (
                <>
                  Aucun employé n&apos;est enregistré dans le registre RH. Un compte de connexion n&apos;est pas
                  un employé : enregistrez d&apos;abord la personne dans{" "}
                  <Link href="/departments/hr/registre" className="text-teal-700 hover:underline">Employés</Link>,
                  puis activez sa fiche — un départ ne peut concerner qu&apos;une personne en poste.
                </>
              ) : (
                <>
                  Aucun employé ne peut entrer en procédure de départ actuellement : les personnes du registre
                  sont soit déjà en cours de départ, soit déjà sorties des effectifs. Les comptes de connexion
                  sans fiche employé n&apos;apparaissent pas ici — enregistrez la personne dans{" "}
                  <Link href="/departments/hr/registre" className="text-teal-700 hover:underline">Employés</Link>{" "}
                  si elle manque au registre.
                </>
              )}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-5">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Employé">
              <option value="">— Employé —</option>
              {eligible.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif du départ"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Motif du départ" />
            <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Date de départ prévue" />
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Modèle de clôture">
              <option value="">— Modèle de clôture —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.label_fr}</option>)}
            </select>
            <button disabled={pending || !employeeId || !reason.trim()}
              onClick={() => run(() => openOffboardingCase({
                employeeId, reason,
                plannedDepartureDate: plannedDate || null,
                templateId: templateId || null,
              }).then((r) => {
                if (r.ok) { setEmployeeId(""); setReason(""); setPlannedDate(""); setTemplateId(""); }
                return r;
              }))}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Ouvrir le dossier
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Ouvrir un dossier de départ ne met pas fin au contrat : le statut d&apos;emploi reste géré depuis la
            fiche de l&apos;employé, dans le registre.
            {templates.length === 0 && (
              <>
                {" "}Aucun modèle de clôture n&apos;est configuré : le dossier sera créé sans étapes. Les modèles se
                créent dans{" "}
                <Link href="/departments/hr/configuration" className="text-teal-700 hover:underline">
                  Configuration → Modèles de check-list
                </Link>.
              </>
            )}
          </p>
        </section>
      )}

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Départs</h2>
        {cases.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun départ enregistré.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cases.map((c) => {
              const items = itemsByCase[c.id] ?? [];
              const gates = gatesByCase[c.id];
              const emp = employeeById[c.employee_id];
              const isOpen = open === c.id;
              const live = c.status === "OPEN" || c.status === "IN_PROGRESS";
              return (
                <li key={c.id} className="py-3">
                  <button onClick={() => setOpen(isOpen ? null : c.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                    <span>
                      <span className="text-sm font-medium text-navy-900">{emp?.label ?? "Employé"}</span>
                      <span className="ml-2 text-xs text-slate-400">{emp?.matricule}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      {c.reason && <span className="text-xs text-slate-500">{c.reason}</span>}
                      {c.planned_departure_date && (
                        <span className="text-xs text-slate-500">Départ prévu : {c.planned_departure_date}</span>
                      )}
                      <Progress items={items} />
                      {gates && gates.equipment.length > 0 && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          Matériel : {gates.equipment.length} à restituer
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {STATUS_FR[c.status] ?? c.status}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-4 rounded-lg bg-slate-50 p-4">
                      {/* --- the checklist ------------------------------------ */}
                      <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Étapes de clôture</p>
                        {items.length === 0 ? (
                          <p className="text-sm text-slate-500">Aucune étape : ce dossier a été ouvert sans modèle.</p>
                        ) : (
                          <ul className="space-y-1">
                            {items.map((i) => (
                              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="text-slate-700">
                                  {i.label_fr}
                                  {i.is_blocking && <span className="ml-2 text-xs text-red-600">obligatoire</span>}
                                  {i.evidence_required && (
                                    <span className="ml-2 text-xs text-slate-400">
                                      {(gates?.documents.length ?? 0) === 0
                                        ? "pièce requise — aucun document au dossier de l'employé"
                                        : "pièce requise"}
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">{ITEM_STATUS_FR[i.status] ?? i.status}</span>
                                  {/* A step that requires a document is completed by
                                      CITING one — the model has always carried
                                      evidence_document_id. The picker offers only this
                                      employee's own documents; the database re-checks
                                      that provenance (HR816) and refuses a step marked
                                      done with no document at all (HR809). */}
                                  {canManage && live && i.status === "PENDING" && i.evidence_required && (
                                    <select value={evidenceFor[i.id] ?? ""}
                                      onChange={(e) => setEvidenceFor({ ...evidenceFor, [i.id]: e.target.value })}
                                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                                      aria-label="Pièce justificative">
                                      <option value="">— Pièce justificative —</option>
                                      {(gates?.documents ?? []).map((d) => (
                                        <option key={d.id} value={d.id}>{d.label}</option>
                                      ))}
                                    </select>
                                  )}
                                  {canManage && live && i.status === "PENDING"
                                    && (!i.evidence_required || evidenceFor[i.id]) && (
                                    <button disabled={pending}
                                      onClick={() => run(() => completeOffboardingItem({
                                        itemId: i.id, status: "DONE",
                                        evidenceDocumentId: i.evidence_required ? evidenceFor[i.id] : null,
                                      }))}
                                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-teal-300 disabled:opacity-50">
                                      Fait
                                    </button>
                                  )}
                                  {canManage && live && i.status === "PENDING" && (
                                    <button disabled={pending}
                                      onClick={() => run(() => completeOffboardingItem({ itemId: i.id, status: "NOT_APPLICABLE" }))}
                                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-teal-300 disabled:opacity-50">
                                      Sans objet
                                    </button>
                                  )}
                                  {canManage && live && i.status !== "PENDING" && (
                                    <button disabled={pending}
                                      onClick={() => run(() => completeOffboardingItem({ itemId: i.id, status: "PENDING" }))}
                                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:border-slate-300 disabled:opacity-50">
                                      Rouvrir
                                    </button>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* --- equipment: displayed here, returned THERE --------- */}
                      <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Matériel à restituer</p>
                        {!gates || gates.equipment.length === 0 ? (
                          <p className="text-sm text-slate-500">Aucun matériel en cours d&apos;attribution.</p>
                        ) : (
                          <>
                            <ul className="space-y-1">
                              {gates.equipment.map((e) => (
                                <li key={e.id} className="text-sm text-slate-700">
                                  {e.label} <span className="text-xs text-slate-400">— attribué le {e.assignedOn}</span>
                                </li>
                              ))}
                            </ul>
                            <Link href="/departments/hr/equipement" className="mt-2 inline-block text-xs text-teal-700 hover:underline">
                              Enregistrer une restitution dans Équipements →
                            </Link>
                          </>
                        )}
                      </div>

                      {/* --- required end-of-contract documents --------------- */}
                      <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Documents de fin de contrat</p>
                        {!gates || gates.missingDocuments.length === 0 ? (
                          <p className="text-sm text-slate-500">Tous les documents requis sont au dossier.</p>
                        ) : (
                          <p className="text-sm text-slate-700">
                            Manquants : {gates.missingDocuments.join(", ")}.{" "}
                            <Link href={`/departments/hr/${c.employee_id}`} className="text-teal-700 hover:underline">
                              Ajouter au dossier de l&apos;employé →
                            </Link>
                          </p>
                        )}
                        {gates && gates.contractsNotEnded > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            À vérifier : {gates.contractsNotEnded} contrat(s) ne sont pas encore marqués comme terminés.
                          </p>
                        )}
                      </div>

                      {/* --- platform access: a prompt, never an action ------- */}
                      <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Accès plateforme</p>
                        {/* The account's real state, in the platform's own words: a
                            suspended account can no longer sign in, and calling it
                            « encore actif » would be false. Only archival closes the
                            handoff — and only Administration performs it. */}
                        {!gates?.account.linked ? (
                          <p className="text-sm text-slate-500">Cet employé n&apos;a pas de compte de connexion.</p>
                        ) : gates.account.status === "archived" ? (
                          <p className="text-sm text-slate-500">Le compte de connexion est archivé.</p>
                        ) : gates.account.status === "inactive" ? (
                          <p className="text-sm text-slate-700">
                            Le compte de connexion est « {STAFF_STATUS_LABEL.inactive} » : la connexion n&apos;est plus
                            possible. Son archivage définitif relève de l&apos;administration des comptes :{" "}
                            <Link href="/users" className="text-teal-700 hover:underline">Administration → Utilisateurs</Link>.
                          </p>
                        ) : (
                          <p className="text-sm text-slate-700">
                            Le compte de connexion est encore actif. Sa désactivation relève de l&apos;administration des
                            comptes :{" "}
                            <Link href="/users" className="text-teal-700 hover:underline">Administration → Utilisateurs</Link>.
                          </p>
                        )}
                      </div>

                      {/* --- the closing acts --------------------------------- */}
                      {canManage && live && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                          <button disabled={pending}
                            onClick={() => run(
                              () => completeOffboardingCase(c.id),
                              (res) => {
                                setNotice("Départ clôturé.");
                                if (res.promptAccountHandoff) setHandoffFor(c.id);
                              })}
                            className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                            Clôturer le départ
                          </button>
                          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Motif d'annulation"
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Motif d'annulation" />
                          <button disabled={pending || !cancelReason.trim()}
                            onClick={() => run(() => cancelOffboardingCase(c.id, cancelReason)
                              .then((r) => { if (r.ok) setCancelReason(""); return r; }))}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:border-red-300 disabled:opacity-50">
                            Annuler le départ
                          </button>
                          <span className="text-xs text-slate-400">
                            La clôture exige que le départ soit enregistré au registre, que le matériel soit restitué et
                            que les étapes obligatoires soient traitées.
                          </span>
                        </div>
                      )}
                      {c.status === "CANCELLED" && c.cancellation_reason && (
                        <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">
                          Départ annulé — motif : {c.cancellation_reason}
                        </p>
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
