"use client";

/**
 * HR-5 — Leave workspace (client). Approval controls render only for holders of
 * `hr:leave:approve`; while that authority is unratified nobody holds it, and
 * the panel says so plainly rather than showing a button the server refuses.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createLeaveRequest, submitLeaveRequest, decideLeaveRequest, cancelLeaveRequest,
  upsertEntitlement, recordAttendance,
} from "@/lib/hr/leave-actions";
import { formatTenths, DAY } from "@/lib/hr/leave/balance";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
type Category = Tbl["hr_leave_category"]["Row"];
type Request = Tbl["hr_leave_request"]["Row"];

const STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", SUBMITTED: "Soumise", APPROVED: "Approuvée", REFUSED: "Refusée", CANCELLED: "Annulée",
};
const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  forbidden_approval: "Autorisation d'approbation requise (hr:leave:approve) — en attente de ratification.",
  employee_not_found: "Employé introuvable.",
  request_not_found: "Demande introuvable.",
  not_submitted: "Seule une demande soumise peut être décidée.",
  already_decided: "Cette demande est déjà décidée — une correction se fait par une nouvelle demande.",
  same_actor: "Séparation des tâches : le décideur doit différer du demandeur.",
  not_cancellable: "Cette demande ne peut plus être annulée.",
  reason_required: "Le motif est obligatoire.",
  invalid_date: "Date invalide (AAAA-MM-JJ).",
  invalid_minutes: "Minutes invalides (0 à 1440).",
  invalid_quantity: "Quantité invalide (en dixièmes de jour, entier positif).",
  event_failed: "L'événement de journal n'a pas pu être écrit — l'action a été annulée.",
  save_failed: "Échec de l'enregistrement.",
};

export function LeaveStudio({
  requests, categories, employees, canManage, canApprove, currentUserId,
}: {
  requests: Request[]; categories: Category[];
  employees: { id: string; label: string }[];
  canManage: boolean; canApprove: boolean; currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {!canApprove && (
        <p className="surface p-4 text-sm text-slate-600">
          Les demandes peuvent être créées et soumises. <strong className="text-navy-800">L'approbation
          est une autorité distincte</strong> (« hr:leave:approve ») qui n'est attribuée à aucun rôle
          tant que la ratification n'a pas eu lieu — aucune demande ne peut donc être décidée aujourd'hui.
        </p>
      )}

      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouvelle demande</h2>
          <div className="grid gap-2 sm:grid-cols-5">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Employé">
              <option value="">— Employé —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type de congé">
              <option value="">— Type —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label_fr}{c.is_provisional ? " (provisoire)" : ""}</option>
              ))}
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Début" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Fin" />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
              Demi-journée
            </label>
          </div>
          <button disabled={pending || !employeeId || !categoryId || !startDate || !endDate}
            onClick={() => run(() => createLeaveRequest({
              employeeId, categoryId, startDate, endDate,
              dayTenths: halfDay ? DAY / 2 : null,
            }).then((r) => { if (r.ok) { setStartDate(""); setEndDate(""); setHalfDay(false); } return r; }))}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Créer la demande
          </button>
          {categories.some((c) => c.is_provisional) && (
            <p className="text-[11px] text-slate-400">
              Les types marqués « provisoire » attendent confirmation par un conseil en droit du travail sénégalais.
              Aucune durée légale n'est préremplie par la plateforme.
            </p>
          )}
        </section>
      )}

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Demandes</h2>
        {requests.length === 0 ? <p className="text-sm text-slate-500">Aucune demande.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-navy-900">{employees.find((e) => e.id === r.employee_id)?.label ?? r.employee_id}</span>
                <span className="text-xs text-slate-500">{categories.find((c) => c.id === r.category_id)?.label_fr ?? "—"}</span>
                <span className="tabular text-xs text-slate-400">{r.start_date} → {r.end_date}</span>
                <span className="tabular text-xs text-navy-800">{formatTenths(r.day_tenths)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  r.status === "APPROVED" ? "bg-teal-50 text-teal-700"
                  : r.status === "REFUSED" || r.status === "CANCELLED" ? "bg-slate-200 text-slate-600"
                  : "bg-amber-50 text-amber-800"}`}>{STATUS_FR[r.status] ?? r.status}</span>

                {canManage && r.status === "DRAFT" && (
                  <button disabled={pending} onClick={() => run(() => submitLeaveRequest(r.id))}
                    className="text-xs text-teal-700 hover:underline">Soumettre</button>
                )}
                {r.status === "SUBMITTED" && canApprove && (
                  r.requested_by === currentUserId ? (
                    <span className="text-xs text-slate-400" title="Séparation des tâches">décision par une autre personne</span>
                  ) : (
                    <>
                      <button disabled={pending} onClick={() => run(() => decideLeaveRequest({ requestId: r.id, decision: "APPROVED" }))}
                        className="text-xs text-teal-700 hover:underline">Approuver</button>
                      <button disabled={pending} onClick={() => run(() => decideLeaveRequest({ requestId: r.id, decision: "REFUSED" }))}
                        className="text-xs text-red-600 hover:underline">Refuser</button>
                    </>
                  )
                )}
                {canManage && ["DRAFT", "SUBMITTED", "APPROVED"].includes(r.status) && (
                  <button disabled={pending}
                    onClick={() => { const x = window.prompt("Motif d'annulation :"); if (x) run(() => cancelLeaveRequest(r.id, x)); }}
                    className="text-xs text-slate-500 hover:underline">Annuler</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && <EntitlementAndAttendance employees={employees} categories={categories} run={run} pending={pending} />}
    </div>
  );
}

function EntitlementAndAttendance({
  employees, categories, run, pending,
}: {
  employees: { id: string; label: string }[]; categories: Category[];
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void; pending: boolean;
}) {
  const [eId, setEId] = useState("");
  const [cId, setCId] = useState("");
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [opening, setOpening] = useState("0");
  const [accrued, setAccrued] = useState("0");
  const [aDate, setADate] = useState("");
  const [aMinutes, setAMinutes] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="surface space-y-2 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Droits à congé (saisis, jamais calculés)</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={eId} onChange={(e) => setEId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Employé">
            <option value="">— Employé —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <select value={cId} onChange={(e) => setCId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type">
            <option value="">— Type —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label_fr}</option>)}
          </select>
          <input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Début de période" />
          <input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Fin de période" />
          <input value={opening} onChange={(e) => setOpening(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Solde d'ouverture (dixièmes)" placeholder="Ouverture (dixièmes)" />
          <input value={accrued} onChange={(e) => setAccrued(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Acquis (dixièmes)" placeholder="Acquis (dixièmes)" />
        </div>
        <button disabled={pending || !eId || !cId || !pStart || !pEnd}
          onClick={() => run(() => upsertEntitlement({
            employeeId: eId, categoryId: cId, periodStart: pStart, periodEnd: pEnd,
            openingTenths: Number.parseInt(opening, 10) || 0, accruedTenths: Number.parseInt(accrued, 10) || 0,
          }))}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
          Enregistrer les droits
        </button>
        <p className="text-[11px] text-slate-400">
          En dixièmes de jour (10 = 1 jour, 5 = ½ journée). Aucune règle d'acquisition n'est appliquée par la plateforme.
        </p>
      </section>

      <section className="surface space-y-2 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Présence (contrat d'entrée)</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={eId} onChange={(e) => setEId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Employé (présence)">
            <option value="">— Employé —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <input type="date" value={aDate} onChange={(e) => setADate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Jour" />
          <input value={aMinutes} onChange={(e) => setAMinutes(e.target.value)} placeholder="Minutes travaillées"
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Minutes travaillées" />
        </div>
        <button disabled={pending || !eId || !aDate || !aMinutes}
          onClick={() => run(() => recordAttendance({
            employeeId: eId, workDate: aDate, workedMinutes: Number.parseInt(aMinutes, 10) || 0,
          }))}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
          Enregistrer la journée
        </button>
        <p className="text-[11px] text-slate-400">
          Saisie uniquement — aucune heure n'est déduite ni estimée, et aucun dispositif de pointage n'est intégré.
        </p>
      </section>
    </div>
  );
}
