"use client";

/**
 * HR-4 — Onboarding workspace (client). Every action re-checks server-side;
 * the completion gate is enforced in the database RPC, and its refusal is
 * surfaced verbatim so the blocking items are named, not hinted at.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createOnboardingCase, advanceOnboardingCase, completeOnboardingItem,
  completeOnboardingCase, cancelOnboardingCase, requestProvisioning, resolveProvisioning,
} from "@/lib/hr/onboarding-actions";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
type Case = Tbl["hr_onboarding_case"]["Row"];
type Item = Tbl["hr_onboarding_item"]["Row"];
type Prov = Tbl["hr_provisioning_request"]["Row"];
type Template = Tbl["hr_checklist_template"]["Row"];

const STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", READY: "Prêt", IN_PROGRESS: "En cours", COMPLETED: "Terminé", CANCELLED: "Annulé",
};
const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  employee_not_found: "Employé introuvable.",
  case_not_found: "Dossier introuvable.",
  case_already_open: "Cet employé a déjà un dossier d'intégration en cours.",
  wrong_status: "Action impossible dans l'état actuel du dossier.",
  item_not_found: "Élément introuvable.",
  evidence_required: "Une pièce justificative est requise pour cet élément.",
  blocking_items_pending: "Clôture refusée : des éléments bloquants restent à compléter.",
  reason_required: "Le motif d'annulation est obligatoire.",
  event_failed: "L'événement de journal n'a pas pu être écrit — l'action a été annulée.",
  save_failed: "Échec de l'enregistrement.",
};
const PROV_KINDS = [
  ["EMAIL", "Compte e-mail"], ["PLATFORM_ACCOUNT", "Compte plateforme"],
  ["ROLE_ASSIGNMENT", "Attribution de rôle"], ["BADGE", "Badge / accès"],
  ["SHARED_DRIVE", "Lecteur partagé"], ["PHONE_SIM", "Téléphone / SIM"], ["OTHER", "Autre"],
] as const;

export function OnboardingStudio({
  cases, employees, templates, itemsByCase, provByCase, canManage,
}: {
  cases: Case[];
  employees: { id: string; label: string }[];
  templates: Template[];
  itemsByCase: Record<string, Item[]>;
  provByCase: Record<string, Prov[]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; detail?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        // The RPC names the blocking items; show them rather than a generic refusal.
        const named = res.error === "blocking_items_pending" && res.detail
          ? res.detail.replace(/^.*?:\s*/, "Clôture refusée — éléments bloquants : ")
          : null;
        setError(named ?? ERR[res.error ?? ""] ?? ERR.save_failed);
      } else router.refresh();
    });
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouveau dossier d'intégration</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Employé">
              <option value="">— Employé —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Modèle de check-list">
              <option value="">— Modèle de check-list —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.label_fr}</option>)}
            </select>
            <input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Date d'entrée prévue" />
            <button disabled={pending || !employeeId}
              onClick={() => run(() => createOnboardingCase({
                employeeId, templateId: templateId || null, plannedStartDate: plannedStart || null,
              }).then((r) => { if (r.ok) { setEmployeeId(""); setPlannedStart(""); } return r; }))}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Créer le dossier
            </button>
          </div>
          {templates.length === 0 && (
            <p className="text-xs text-slate-400">
              Aucun modèle de check-list configuré : le dossier sera créé sans éléments. Les modèles se configurent dans le centre de configuration.
            </p>
          )}
        </section>
      )}

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Dossiers</h2>
        {cases.length === 0 ? <p className="text-sm text-slate-500">Aucun dossier d'intégration.</p> : (
          <ul className="divide-y divide-slate-100">
            {cases.map((c) => {
              const items = itemsByCase[c.id] ?? [];
              const done = items.filter((i) => i.status !== "PENDING").length;
              const blockers = items.filter((i) => i.is_required && i.is_blocking && i.status === "PENDING");
              const expanded = open === c.id;
              return (
                <li key={c.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setOpen(expanded ? null : c.id)}
                      className="font-medium text-teal-700 hover:underline" aria-expanded={expanded}>
                      {employees.find((e) => e.id === c.employee_id)?.label ?? c.employee_id}
                    </button>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      c.status === "COMPLETED" ? "bg-teal-50 text-teal-700"
                      : c.status === "CANCELLED" ? "bg-slate-200 text-slate-600"
                      : "bg-amber-50 text-amber-800"}`}>{STATUS_FR[c.status] ?? c.status}</span>
                    <span className="text-xs text-slate-400">{done}/{items.length} éléments</span>
                    {c.planned_start_date && <span className="tabular text-xs text-slate-400">entrée {c.planned_start_date}</span>}
                    {blockers.length > 0 && <span className="text-xs text-amber-700">{blockers.length} bloquant(s)</span>}
                  </div>

                  {canManage && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {c.status === "DRAFT" && (
                        <button disabled={pending} onClick={() => run(() => advanceOnboardingCase(c.id, "READY"))}
                          className="text-xs text-teal-700 hover:underline">Marquer prêt</button>
                      )}
                      {c.status === "READY" && (
                        <button disabled={pending} onClick={() => run(() => advanceOnboardingCase(c.id, "IN_PROGRESS"))}
                          className="text-xs text-teal-700 hover:underline">Démarrer</button>
                      )}
                      {["READY", "IN_PROGRESS"].includes(c.status) && (
                        <button disabled={pending} onClick={() => run(() => completeOnboardingCase(c.id))}
                          className="text-xs text-teal-700 hover:underline">Clôturer</button>
                      )}
                      {!["COMPLETED", "CANCELLED"].includes(c.status) && (
                        <button disabled={pending}
                          onClick={() => { const r = window.prompt("Motif d'annulation :"); if (r) run(() => cancelOnboardingCase(c.id, r)); }}
                          className="text-xs text-red-600 hover:underline">Annuler</button>
                      )}
                    </div>
                  )}

                  {expanded && (
                    <div className="mt-3 space-y-3 border-l-2 border-slate-100 pl-4">
                      <ul className="space-y-1">
                        {items.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-center gap-2">
                            <span className={i.status === "DONE" ? "text-slate-400 line-through" : "text-navy-900"}>{i.label_fr}</span>
                            {i.is_blocking && i.is_required && <span className="text-[11px] text-amber-700">bloquant</span>}
                            {i.due_date && (
                              <span className={`tabular text-[11px] ${i.status === "PENDING" && i.due_date < today ? "text-red-600" : "text-slate-400"}`}>
                                {i.due_date}
                              </span>
                            )}
                            {i.evidence_required && <span className="text-[11px] text-slate-400">preuve requise</span>}
                            {canManage && i.status === "PENDING" && !i.evidence_required && (
                              <button disabled={pending}
                                onClick={() => run(() => completeOnboardingItem({ itemId: i.id, status: "DONE" }))}
                                className="text-xs text-teal-700 hover:underline">Marquer fait</button>
                            )}
                            {canManage && i.status === "PENDING" && (
                              <button disabled={pending}
                                onClick={() => run(() => completeOnboardingItem({ itemId: i.id, status: "NOT_APPLICABLE" }))}
                                className="text-xs text-slate-500 hover:underline">Sans objet</button>
                            )}
                            {canManage && i.status !== "PENDING" && (
                              <button disabled={pending}
                                onClick={() => run(() => completeOnboardingItem({ itemId: i.id, status: "PENDING" }))}
                                className="text-xs text-slate-400 hover:underline">Rouvrir</button>
                            )}
                          </li>
                        ))}
                        {items.length === 0 && <li className="text-xs text-slate-400">Aucun élément (dossier sans modèle).</li>}
                      </ul>

                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Accès & comptes</p>
                        <ul className="mt-1 space-y-1">
                          {(provByCase[c.id] ?? []).map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-navy-900">{PROV_KINDS.find((k) => k[0] === p.kind)?.[1] ?? p.kind}</span>
                              <span className="text-slate-400">{p.status}</span>
                              {canManage && p.status === "REQUESTED" && (
                                <>
                                  <button disabled={pending} onClick={() => run(() => resolveProvisioning({ requestId: p.id, status: "COMPLETED" }))}
                                    className="text-teal-700 hover:underline">Fait</button>
                                  <button disabled={pending} onClick={() => run(() => resolveProvisioning({ requestId: p.id, status: "REJECTED" }))}
                                    className="text-red-600 hover:underline">Refusé</button>
                                </>
                              )}
                            </li>
                          ))}
                          {(provByCase[c.id] ?? []).length === 0 && <li className="text-xs text-slate-400">Aucune demande.</li>}
                        </ul>
                        {canManage && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {PROV_KINDS.map(([k, label]) => (
                              <button key={k} disabled={pending}
                                onClick={() => run(() => requestProvisioning({ caseId: c.id, kind: k }))}
                                className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                                + {label}
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="mt-1 text-[11px] text-slate-400">
                          Suivi uniquement : les comptes se créent dans Administration, jamais ici.
                        </p>
                      </div>
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
