"use client";

/**
 * HR-9B — Reporting RH (client). A small management dashboard, not a BI suite:
 * authoritative indicators, two filters, and the breakdowns the registry can
 * honestly produce.
 *
 * WHAT IS DELIBERATELY ABSENT, and must not be added without a ratification:
 * any turnover RATE (RQ-9.3), any absence rate (no schedule model exists), any
 * monetary figure (DEC-B63), any grouping of the free-text departure motive
 * (RQ-8.1), and any chart of reconstructed history (RQ-9.4 — v1 is current
 * state plus movements between two dates).
 */
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  applyPrivacyFloor, maskedCount, MASKED_LABEL_FR, EMPLOYEE_STATUS_FR,
  K_ANONYMITY_FLOOR, type BreakdownRow, type ReportViewerTier,
} from "@/lib/hr/reporting/model";

type Headline = {
  employeesTotal: number; employeesActive: number; employeesSuspended: number;
  withoutAccount: number; entriesInPeriod: number; departuresInPeriod: number;
  leaveApprovedInPeriod: number; leavePendingNow: number; onLeaveToday: number;
  onboardingActive: number; offboardingActive: number; offboardingStepsPending: number;
  equipmentOutstanding: number; equipmentAwaitingReturn: number;
  contractsExpiringSoon: number | null; documentsExpiringSoon: number | null;
};

const UNAVAILABLE = "indisponible";

function Figure({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular text-navy-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Breakdown({
  title, rows, tier, translate,
}: {
  title: string; rows: BreakdownRow[]; tier: ReportViewerTier;
  translate?: Record<string, string>;
}) {
  const presented = applyPrivacyFloor(rows, tier);
  const hidden = maskedCount(rows, tier);
  return (
    <section className="surface p-5">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{title}</h2>
      {presented.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune donnée sur ce périmètre.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {presented.map((r) => (
            <li key={r.label} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700">{translate?.[r.label] ?? r.label}</span>
              <span className={r.masked ? "text-xs italic text-slate-400" : "tabular font-medium text-navy-900"}>
                {r.masked ? MASKED_LABEL_FR : r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          {hidden} groupe(s) de moins de {K_ANONYMITY_FLOOR} personnes sont masqués pour éviter
          d&apos;identifier un employé.
        </p>
      )}
    </section>
  );
}

export function ReportingStudio({
  period, headline, byStatus, byDepartment, byOrgUnit, departments, department, tier,
}: {
  period: { from: string; to: string };
  headline: Headline;
  byStatus: BreakdownRow[];
  byDepartment: BreakdownRow[];
  byOrgUnit: BreakdownRow[];
  departments: string[];
  department: string | null;
  tier: ReportViewerTier;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [dept, setDept] = useState(department ?? "");

  const apply = () => {
    const qs = new URLSearchParams(params?.toString() ?? "");
    qs.set("du", from); qs.set("au", to);
    if (dept) qs.set("departement", dept); else qs.delete("departement");
    start(() => router.push(`/departments/hr/rapports?${qs.toString()}`));
  };
  const exportHref = () => {
    const qs = new URLSearchParams({ du: period.from, au: period.to });
    if (department) qs.set("departement", department);
    return `/departments/hr/rapports/export?${qs.toString()}`;
  };

  return (
    <div className="space-y-6">
      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Période et périmètre</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Du" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Au" />
          <select value={dept} onChange={(e) => setDept(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Département">
            <option value="">Tous les départements</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={apply}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800">
            Appliquer
          </button>
          <a href={exportHref()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm hover:border-teal-300">
            Exporter (CSV)
          </a>
        </div>
        <p className="text-xs text-slate-400">
          Les effectifs et les charges décrivent la situation actuelle ; les entrées, sorties et congés
          sont comptés sur la période choisie. Aucun taux n&apos;est calculé : la méthode de calcul du
          taux de rotation n&apos;est pas encore arrêtée.
        </p>
      </section>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Effectifs (situation actuelle)</p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Figure label="Employés au registre" value={headline.employeesTotal} />
          <Figure label="Actifs" value={headline.employeesActive} />
          <Figure label="Suspendus" value={headline.employeesSuspended} />
          <Figure label="Sans compte de connexion" value={headline.withoutAccount} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Mouvements du {period.from} au {period.to}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Figure label="Entrées" value={headline.entriesInPeriod} hint="Date d'embauche dans la période" />
          <Figure label="Sorties" value={headline.departuresInPeriod} hint="Date de départ dans la période" />
          <Figure label="Congés approuvés" value={headline.leaveApprovedInPeriod} hint="Demandes chevauchant la période" />
          <Figure label="Congés à décider" value={headline.leavePendingNow} hint="Situation actuelle" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Charge opérationnelle (situation actuelle)</p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Figure label="En congé aujourd'hui" value={headline.onLeaveToday} />
          <Figure label="Intégrations en cours" value={headline.onboardingActive} />
          <Figure label="Départs en cours" value={headline.offboardingActive} />
          <Figure label="Étapes de clôture à terminer" value={headline.offboardingStepsPending} />
          <Figure label="Matériel à restituer (départs)" value={headline.equipmentOutstanding} />
          <Figure label="Restitutions attendues" value={headline.equipmentAwaitingReturn} />
          <Figure label="Contrats expirant bientôt"
            value={headline.contractsExpiringSoon ?? UNAVAILABLE} />
          <Figure label="Documents expirant bientôt"
            value={headline.documentsExpiringSoon ?? UNAVAILABLE} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title="Par statut" rows={byStatus} tier={tier} translate={EMPLOYEE_STATUS_FR} />
        <Breakdown title="Par département" rows={byDepartment} tier={tier} />
        <Breakdown title="Par unité d'organisation" rows={byOrgUnit} tier={tier} />
      </div>

      <p className="text-xs text-slate-400">
        Ces chiffres proviennent directement du registre RH et des modules congés, intégration, départs
        et équipements — rien n&apos;est recalculé ni stocké ailleurs. Les motifs de départ ne sont pas
        regroupés tant que leur vocabulaire n&apos;est pas arrêté.{" "}
        <Link href="/departments/hr" className="text-teal-700 hover:underline">Tableau de bord RH</Link>
      </p>
    </div>
  );
}
