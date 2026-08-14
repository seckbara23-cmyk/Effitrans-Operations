"use client";

/**
 * HR-B1 — « Mes congés » (client). Two audiences on one page, both scoped by
 * the server: the employee acting on their OWN requests, and the decision
 * queues — « Mon équipe » for the caller's direct reports (identity lane) and
 * the org-wide list for Direction seats. Every status and error is a French
 * sentence; no permission code or SQLSTATE reaches the screen.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMyLeaveRequest, submitMyLeaveRequest, cancelMyLeaveRequest, decideLeaveRequest,
} from "@/lib/hr/leave-actions";
import { formatTenths, spanTenths, DAY } from "@/lib/hr/leave/balance";
import type { MyLeaveWorkspace, PendingDecision } from "@/lib/hr/my-leave";

const STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", SUBMITTED: "Soumise", APPROVED: "Approuvée", REFUSED: "Refusée", CANCELLED: "Annulée",
};
const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700", SUBMITTED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800", REFUSED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};
const ERR: Record<string, string> = {
  forbidden: "Vous devez être connecté.",
  no_employee_link: "Votre compte n'est pas encore lié à votre dossier employé — contactez les Ressources humaines.",
  employee_not_active: "Votre dossier employé n'est pas actif — contactez les Ressources humaines.",
  invalid_date: "Dates invalides (la fin ne peut pas précéder le début).",
  reason_required: "Le motif est obligatoire.",
  refusal_note_required: "Un refus doit être motivé — ajoutez un commentaire pour l'employé.",
  forbidden_approval: "Vous n'êtes pas autorisé à décider de cette demande : seul le responsable hiérarchique de l'employé ou un siège Direction peut le faire.",
  own_leave: "Vous ne pouvez pas décider de votre propre congé.",
  same_actor: "Séparation des tâches : le décideur doit différer du demandeur.",
  not_submitted: "Seule une demande soumise peut être décidée.",
  already_decided: "Cette demande est déjà décidée — une correction se fait par une nouvelle demande.",
  not_own_request: "Cette demande n'est pas la vôtre ou n'est plus modifiable.",
  not_cancellable: "Cette demande ne peut plus être retirée — adressez-vous aux Ressources humaines.",
  request_not_found: "Demande introuvable.",
  actor_invalid: "Votre compte n'est pas actif.",
  save_failed: "Échec de l'enregistrement.",
  event_failed: "Le journal n'a pas pu être écrit — l'action a été annulée.",
};

function DecisionCard({ item, onDecide, busy }: {
  item: PendingDecision;
  onDecide: (id: string, decision: "APPROVED" | "REFUSED", note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const r = item.request;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-navy-900">
          {item.employeeName} <span className="font-normal text-slate-500">({item.employeeNumber} · {item.departmentFr})</span>
        </p>
        <span className="text-xs text-slate-500">{item.categoryFr}</span>
      </div>
      <p className="text-sm text-slate-700">
        Du <strong>{r.start_date}</strong> au <strong>{r.end_date}</strong> — {formatTenths(r.day_tenths)}
        {item.remainingTenths !== null && (
          <span className="text-slate-500"> · solde restant : {formatTenths(item.remainingTenths)}</span>
        )}
        {item.remainingTenths === null && (
          <span className="text-slate-400"> · aucun droit saisi pour cette période</span>
        )}
      </p>
      {r.reason && <p className="text-sm text-slate-500">Motif : {r.reason}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Commentaire (obligatoire en cas de refus)"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <button disabled={busy} onClick={() => onDecide(r.id, "APPROVED", note)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          Approuver
        </button>
        <button disabled={busy} onClick={() => onDecide(r.id, "REFUSED", note)}
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">
          Refuser
        </button>
      </div>
    </div>
  );
}

export function MyLeaveStudio({ workspace, canApprove }: { workspace: MyLeaveWorkspace; canApprove: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");

  const { employee, categories, balances, myRequests, teamPending, orgPending } = workspace;

  const singleDay = startDate !== "" && startDate === endDate;
  let durationFr: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate) {
    try { durationFr = formatTenths(singleDay && halfDay ? DAY / 2 : spanTenths(startDate, endDate)); } catch { /* shown on submit */ }
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setError(null); setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else { if (done) setNotice(done); router.refresh(); }
    });
  };

  const create = (submit: boolean) => {
    if (!categoryId || !startDate || !endDate) { setError("Choisissez un type de congé et les deux dates."); return; }
    run(async () => {
      const res = await createMyLeaveRequest({
        categoryId, startDate, endDate,
        dayTenths: singleDay && halfDay ? DAY / 2 : null,
        reason: reason || null,
      });
      if (!res.ok || !submit) return res;
      return submitMyLeaveRequest(res.id!);
    }, submit ? "Demande soumise — votre responsable en est informé sur cette page." : "Brouillon enregistré.");
  };

  const decide = (id: string, decision: "APPROVED" | "REFUSED", note: string) =>
    run(() => decideLeaveRequest({ requestId: id, decision, note: note || null }),
      decision === "APPROVED" ? "Demande approuvée." : "Demande refusée.");

  const queues: { title: string; items: PendingDecision[] }[] = [
    { title: "Demandes de mon équipe", items: teamPending },
    ...(canApprove ? [{ title: "Toutes les demandes en attente (Direction)", items: orgPending }] : []),
  ];

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {!employee && (
        <p className="surface p-4 text-sm text-slate-600">
          Votre compte n&apos;est pas encore lié à un dossier employé — les demandes de congé personnelles
          ne sont pas disponibles. Contactez les Ressources humaines pour établir le lien.
        </p>
      )}

      {employee && balances.length > 0 && (
        <section className="surface space-y-2 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Mes soldes</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <li key={b.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="text-slate-500">{categories.find((c) => c.id === b.category_id)?.label_fr ?? "Congé"}</p>
                <p className={`font-semibold ${b.balance.overdrawn ? "text-red-700" : "text-navy-900"}`}>
                  {formatTenths(b.balance.remainingTenths)} restants
                </p>
                <p className="text-xs text-slate-400">
                  période {b.period_start} → {b.period_end} · pris : {formatTenths(b.taken_tenths)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {employee && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouvelle demande de congé</h2>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1">
              <span className="block text-xs text-slate-500">Type de congé</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5">
                <option value="">— choisir —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label_fr}{c.is_provisional ? " (provisoire)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-500">Du</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-500">Au</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5" />
            </label>
            {singleDay && (
              <label className="flex items-center gap-2 pb-1.5">
                <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
                <span>Demi-journée</span>
              </label>
            )}
            {durationFr && <span className="pb-2 text-slate-500">Durée : <strong>{durationFr}</strong></span>}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (facultatif)"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <div className="flex gap-2">
            <button disabled={pending} onClick={() => create(true)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
              Soumettre la demande
            </button>
            <button disabled={pending} onClick={() => create(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Enregistrer comme brouillon
            </button>
          </div>
        </section>
      )}

      {employee && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Mes demandes</h2>
          {myRequests.length === 0 && <p className="text-sm text-slate-500">Aucune demande pour le moment.</p>}
          <ul className="space-y-2">
            {myRequests.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-slate-700">
                    <span className="font-medium text-navy-900">{r.categoryFr}</span>{" "}
                    du {r.start_date} au {r.end_date} — {formatTenths(r.day_tenths)}
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                    {STATUS_FR[r.status] ?? r.status}
                  </span>
                </div>
                {r.decision_note && (
                  <p className="mt-1 text-xs text-slate-500">
                    {r.status === "REFUSED" ? "Motif du refus" : r.status === "CANCELLED" ? "Motif d'annulation" : "Commentaire"} : {r.decision_note}
                  </p>
                )}
                {(r.status === "DRAFT" || r.status === "SUBMITTED") && (
                  <div className="mt-2 flex gap-2">
                    {r.status === "DRAFT" && (
                      <button disabled={pending} onClick={() => run(() => submitMyLeaveRequest(r.id), "Demande soumise.")}
                        className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                        Soumettre
                      </button>
                    )}
                    <button disabled={pending}
                      onClick={() => {
                        const why = window.prompt("Motif du retrait ?");
                        if (why?.trim()) run(() => cancelMyLeaveRequest(r.id, why.trim()), "Demande retirée.");
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      Retirer
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {queues.map(({ title, items }) => (
        (items.length > 0 || title.startsWith("Toutes")) && (
          <section key={title} className="surface space-y-3 p-5">
            <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
            {items.length === 0 && <p className="text-sm text-slate-500">Aucune demande en attente.</p>}
            <div className="space-y-2">
              {items.map((item) => (
                <DecisionCard key={item.request.id} item={item} onDecide={decide} busy={pending} />
              ))}
            </div>
          </section>
        )
      ))}
    </div>
  );
}
