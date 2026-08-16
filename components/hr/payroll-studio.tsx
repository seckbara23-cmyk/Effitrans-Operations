"use client";

/**
 * HR-7B — Préparation de paie (client). FACTS ONLY, French only.
 * ---------------------------------------------------------------------------
 * No monetary field exists on this surface and none may be added (Q1/DEC-B63).
 * The operator prepares, verifies and — once Effitrans ratifies the seats —
 * approves and locks a period of FACTS. Exceptions are surfaced, never
 * normalized: « À vérifier» is a statement about the data, not a judgment the
 * platform is qualified to make. Export is deliberately absent: its columns
 * and recipients are unratified (Q5/Q6/Q7), and pretending otherwise would
 * present an artifact nobody has approved.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPayrollPeriod, preparePayrollPeriod, verifyPayrollPeriod, reopenPayrollPeriod,
  approvePayrollPeriod, lockPayrollPeriod, cancelPayrollPeriod,
  proposePayrollAdjustment, decidePayrollAdjustment, upsertAdjustmentKind,
} from "@/lib/hr/payroll-actions";
import {
  PAYROLL_STATUS_FR, PAYROLL_EXCEPTION_FR,
  type PayrollPeriod, type PayrollLine, type PayrollAdjustment, type PayrollAdjustmentKind,
} from "@/lib/hr/payroll/model";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700", PREPARED: "bg-sky-100 text-sky-800",
  VERIFIED: "bg-amber-100 text-amber-800", APPROVED: "bg-emerald-100 text-emerald-800",
  LOCKED: "bg-navy-900 text-white", CANCELLED: "bg-slate-100 text-slate-500",
};

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  forbidden_config: "Action non autorisée (hr:config:manage requis).",
  forbidden_payroll: "L'approbation et le verrouillage sont réservés au siège « hr:payroll:approve » — non attribué tant qu'Effitrans n'a pas ratifié les titulaires (Q7).",
  actor_invalid: "Votre compte n'est pas actif.",
  period_immutable: "Cette préparation est immuable.",
  period_not_found: "Préparation introuvable.",
  duplicate_period: "Une préparation active existe déjà pour ce code — verrouillez-la ou annulez-la d'abord.",
  invalid_period: "Code, libellé et dates valides obligatoires.",
  lines_frozen: "Les lignes de cette préparation sont figées.",
  wrong_status: "La préparation n'est pas dans l'état requis pour cette action.",
  same_actor_approve: "Quatre yeux : l'approbateur doit différer du préparateur.",
  kind_invalid: "Catégorie d'ajustement introuvable ou désactivée.",
  invalid_quantity: "Quantité entière non nulle obligatoire.",
  adjustment_not_found: "Ajustement introuvable.",
  same_actor_decide: "Quatre yeux : le décideur doit différer du proposant.",
  adjustment_immutable: "Cet ajustement ne peut plus être modifié — proposez un remplacement.",
  employee_not_in_period: "Employé absent de cette préparation — collectez d'abord les faits.",
  empty_period: "Une préparation vide ne peut pas être vérifiée.",
  reason_required: "Le motif est obligatoire.",
  missing_field: "Code et libellé obligatoires.",
  save_failed: "Échec de l'enregistrement.",
};

const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const fmtTenths = (t: number) => `${Math.trunc(t / 10)}${t % 10 !== 0 ? `,${t % 10}` : ""} j`;

export function PayrollStudio({
  periods, lines, adjustments, kinds, selectedId, canReadFacts, canConfigure,
}: {
  periods: PayrollPeriod[];
  lines: PayrollLine[];
  adjustments: PayrollAdjustment[];
  kinds: PayrollAdjustmentKind[];
  selectedId: string | null;
  canReadFacts: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [adjEmployee, setAdjEmployee] = useState("");
  const [adjKind, setAdjKind] = useState("");
  const [adjQuantity, setAdjQuantity] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [kindCode, setKindCode] = useState("");
  const [kindLabel, setKindLabel] = useState("");
  const [kindUnit, setKindUnit] = useState<"HOURS" | "DAYS" | "OCCURRENCES" | "UNITS">("DAYS");

  const selected = periods.find((p) => p.id === selectedId) ?? null;
  const editable = selected && (selected.status === "DRAFT" || selected.status === "PREPARED" || selected.status === "VERIFIED");
  const activeKinds = kinds.filter((k) => k.isActive);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setError(null); setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else { setNotice(done); router.refresh(); }
    });
  };

  const open = (id: string) => router.push(`/departments/hr/paie?periode=${id}`);

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Nouvelle période de préparation</h2>
        <p className="text-xs text-slate-500">
          Les dates sont saisies explicitement — aucun calendrier de paie n&apos;est configuré tant
          qu&apos;Effitrans ne l&apos;a pas ratifié (Q5).
        </p>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1"><span className="block text-xs text-slate-500">Code (ex. 2026-09)</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5" /></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">Libellé</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Paie septembre 2026" className="rounded-lg border border-slate-300 px-3 py-1.5" /></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">Du</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5" /></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">Au</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5" /></label>
          <button disabled={pending || !code.trim() || !label.trim() || !startDate || !endDate}
            onClick={() => run(() => createPayrollPeriod({ code, labelFr: label, periodStart: startDate, periodEnd: endDate }), "Période créée.")}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
            Créer
          </button>
        </div>
      </section>

      <section className="surface space-y-2 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Périodes</h2>
        {periods.length === 0 && <p className="text-sm text-slate-500">Aucune période pour le moment.</p>}
        <ul className="space-y-1">
          {periods.map((p) => (
            <li key={p.id}>
              <button onClick={() => open(p.id)}
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${p.id === selectedId ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="font-medium text-navy-900">
                  {p.labelFr} <span className="font-normal text-slate-500">({p.code}{p.version > 1 ? ` · v${p.version}` : ""} · {p.periodStart} → {p.periodEnd})</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{p.lineCount} employé(s)</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status] ?? ""}`}>{PAYROLL_STATUS_FR[p.status]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section className="surface space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">{selected.labelFr}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[selected.status] ?? ""}`}>{PAYROLL_STATUS_FR[selected.status]}</span>
          </div>
          <p className="text-xs text-slate-500">
            {selected.cutoffAt ? `Faits collectés le ${new Date(selected.cutoffAt).toLocaleString("fr-FR")} · ` : ""}
            {selected.lineCount} employé(s) inclus · {selected.draftExcludedCount} brouillon(s) exclu(s)
            {selected.cancelledReason ? ` · Annulée : ${selected.cancelledReason}` : ""}
          </p>

          <div className="flex flex-wrap gap-2">
            {(selected.status === "DRAFT" || selected.status === "PREPARED") && (
              <button disabled={pending} onClick={() => run(() => preparePayrollPeriod(selected.id), "Faits collectés.")}
                className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                {selected.status === "DRAFT" ? "Collecter les faits" : "Recollecter les faits"}
              </button>
            )}
            {selected.status === "PREPARED" && (
              <button disabled={pending} onClick={() => run(() => verifyPayrollPeriod(selected.id), "Préparation vérifiée.")}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                Vérifier
              </button>
            )}
            {selected.status === "VERIFIED" && (
              <>
                <button disabled={pending} onClick={() => run(() => reopenPayrollPeriod(selected.id), "Préparation rouverte.")}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Rouvrir
                </button>
                <button disabled={pending} onClick={() => run(() => approvePayrollPeriod(selected.id), "Préparation approuvée.")}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  Approuver (Direction)
                </button>
              </>
            )}
            {selected.status === "APPROVED" && (
              <button disabled={pending} onClick={() => run(() => lockPayrollPeriod(selected.id), "Préparation verrouillée.")}
                className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                Verrouiller
              </button>
            )}
            {selected.status !== "LOCKED" && selected.status !== "CANCELLED" && (
              <button disabled={pending}
                onClick={() => { const why = window.prompt("Motif d'annulation ?"); if (why?.trim()) run(() => cancelPayrollPeriod(selected.id, why.trim()), "Préparation annulée."); }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                Annuler
              </button>
            )}
          </div>

          {selected.status === "LOCKED" && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Préparation verrouillée — immuable. L&apos;export vers le processus de paie externe sera
              activé lorsque Effitrans aura ratifié le format et les destinataires (Q5/Q6/Q7) ;
              une correction passe par une nouvelle version de la période.
            </p>
          )}

          {!canReadFacts && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Contenu réservé — la lecture du détail par employé requiert le pupitre de préparation
              ou le siège de lecture paie.
            </p>
          )}

          {canReadFacts && lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3">Employé</th>
                    <th className="py-2 pr-3">Département</th>
                    <th className="py-2 pr-3">Contrat</th>
                    <th className="py-2 pr-3">Présence</th>
                    <th className="py-2 pr-3">Congés approuvés</th>
                    <th className="py-2">État</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-navy-900">{l.firstName} {l.lastName}</span>
                        <span className="block text-xs text-slate-500">{l.employeeNumber} · {l.employmentStatus}</span>
                      </td>
                      <td className="py-2 pr-3">{l.department}{l.orgUnitLabel ? ` · ${l.orgUnitLabel}` : ""}{l.positionLabel ? ` · ${l.positionLabel}` : ""}</td>
                      <td className="py-2 pr-3">{l.contractKind ?? "—"}</td>
                      <td className="py-2 pr-3">{l.attendanceDays} j · {fmtMinutes(l.workedMinutes)}</td>
                      <td className="py-2 pr-3">
                        {l.leaveBreakdown.length === 0 ? "—" : l.leaveBreakdown.map((b) => (
                          <span key={b.code} className="block text-xs">{b.label_fr} : {fmtTenths(b.tenths)}</span>
                        ))}
                      </td>
                      <td className="py-2">
                        {l.exceptions.length === 0
                          ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Prêt</span>
                          : (
                            <div className="space-y-0.5">
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">À vérifier</span>
                              {l.exceptions.map((x) => (
                                <span key={x} className="block text-xs text-slate-500">{PAYROLL_EXCEPTION_FR[x] ?? x}</span>
                              ))}
                            </div>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canReadFacts && editable && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-navy-900">Ajustements (quantités — jamais de montants)</h3>
              {activeKinds.length === 0 && (
                <p className="text-sm text-slate-500">
                  Aucune catégorie d&apos;ajustement n&apos;est configurée — le vocabulaire appartient à
                  Effitrans et se définit dans la configuration ci-dessous.
                </p>
              )}
              {activeKinds.length > 0 && (
                <div className="flex flex-wrap items-end gap-2 text-sm">
                  <select value={adjEmployee} onChange={(e) => setAdjEmployee(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5">
                    <option value="">— employé —</option>
                    {lines.map((l) => <option key={l.employeeId} value={l.employeeId}>{l.firstName} {l.lastName} ({l.employeeNumber})</option>)}
                  </select>
                  <select value={adjKind} onChange={(e) => setAdjKind(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5">
                    <option value="">— catégorie —</option>
                    {activeKinds.map((k) => <option key={k.id} value={k.id}>{k.labelFr} ({k.unit})</option>)}
                  </select>
                  <input value={adjQuantity} onChange={(e) => setAdjQuantity(e.target.value)} placeholder="Quantité (±)" className="w-28 rounded-lg border border-slate-300 px-3 py-1.5" />
                  <input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Motif" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5" />
                  <button disabled={pending || !adjEmployee || !adjKind || !adjQuantity.trim()}
                    onClick={() => run(() => proposePayrollAdjustment({
                      periodId: selected.id, employeeId: adjEmployee, kindId: adjKind,
                      quantity: Number(adjQuantity), reason: adjReason || null,
                    }), "Ajustement proposé — un second responsable doit le décider.")}
                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                    Proposer
                  </button>
                </div>
              )}
              {adjustments.length > 0 && (
                <ul className="space-y-1">
                  {adjustments.map((a) => {
                    const line = lines.find((l) => l.employeeId === a.employeeId);
                    const kind = kinds.find((k) => k.id === a.kindId);
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <span>
                          <span className="font-medium text-navy-900">{line ? `${line.firstName} ${line.lastName}` : "—"}</span>{" "}
                          · {kind?.labelFr ?? "—"} · <strong>{a.quantity > 0 ? `+${a.quantity}` : a.quantity}</strong> {kind?.unit === "HOURS" ? "h" : kind?.unit === "DAYS" ? "j" : ""}
                          {a.reason ? <span className="text-slate-500"> — {a.reason}</span> : null}
                          {a.version > 1 ? <span className="text-xs text-slate-400"> (v{a.version})</span> : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{a.status === "PROPOSED" ? "Proposé" : a.status === "APPROVED" ? "Approuvé" : a.status === "REJECTED" ? "Rejeté" : "Remplacé"}</span>
                          {a.status === "PROPOSED" && (
                            <>
                              <button disabled={pending} onClick={() => run(() => decidePayrollAdjustment({ adjustmentId: a.id, decision: "APPROVED" }), "Ajustement approuvé.")}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Approuver</button>
                              <button disabled={pending}
                                onClick={() => { const why = window.prompt("Motif du rejet ?"); if (why?.trim()) run(() => decidePayrollAdjustment({ adjustmentId: a.id, decision: "REJECTED", note: why.trim() }), "Ajustement rejeté."); }}
                                className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">Rejeter</button>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {canConfigure && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Catégories d&apos;ajustement (configuration)</h2>
          <p className="text-xs text-slate-500">
            Le vocabulaire est celui d&apos;Effitrans — la plateforme n&apos;en invente aucun. Quantités
            uniquement : les montants restent hors périmètre (Q1).
          </p>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <input value={kindCode} onChange={(e) => setKindCode(e.target.value)} placeholder="CODE" className="w-36 rounded-lg border border-slate-300 px-3 py-1.5" />
            <input value={kindLabel} onChange={(e) => setKindLabel(e.target.value)} placeholder="Libellé français" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5" />
            <select value={kindUnit} onChange={(e) => setKindUnit(e.target.value as typeof kindUnit)} className="rounded-lg border border-slate-300 px-3 py-1.5">
              <option value="DAYS">Jours</option><option value="HOURS">Heures</option>
              <option value="OCCURRENCES">Occurrences</option><option value="UNITS">Unités</option>
            </select>
            <button disabled={pending || !kindCode.trim() || !kindLabel.trim()}
              onClick={() => run(() => upsertAdjustmentKind({ code: kindCode, labelFr: kindLabel, unit: kindUnit }), "Catégorie enregistrée.")}
              className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Ajouter
            </button>
          </div>
          {kinds.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {kinds.map((k) => (
                <li key={k.id} className={`rounded-full border px-3 py-1 ${k.isActive ? "border-slate-300 text-slate-700" : "border-slate-200 text-slate-400 line-through"}`}>
                  {k.labelFr} ({k.unit})
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
