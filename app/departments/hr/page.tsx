/**
 * HR-5A — the HR Operations Center. The department hub, at the same standard as
 * Opérations / Transit / Finance. (Supersedes the HR-1 dashboard shell; same
 * ratified route, no competing dashboard was created.)
 *
 * COMPOSITION ONLY. Every figure comes from a read service HR-1..HR-5 already
 * owns; this page computes nothing of its own. In particular « en congé » is
 * HR-5's projection over APPROVED windows — no ON_LEAVE is stored anywhere.
 *
 * Honest states: a figure that could not be read renders « indisponible », which
 * is a different thing from zero and is never rendered as zero.
 *
 * Gate: hr:read (SYSTEM_ADMIN holds no hr:* — DEC-B25). Restricted surfaces stay
 * gated on their own permissions and say what they are waiting for.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { DeptAttentionCard } from "@/components/departments/dept-attention-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { employeeStats, countHrOfficers } from "@/lib/hr/read";
import { hrDashboardCounts, getHrConfiguration } from "@/lib/hr/organization";
import { hrOperationsCounts } from "@/lib/hr/onboarding";
import { offboardingCounts } from "@/lib/hr/offboarding";
import { leaveCounts } from "@/lib/hr/leave";
import { getHrCenterData, EXPIRY_WINDOW_DAYS } from "@/lib/hr/workspace";
import { CERTIFICATE_EXPIRY_WINDOW_DAYS } from "@/lib/hr/training";
import { HR_EVENT_LABEL_FR, type HrEventKind } from "@/lib/hr/ledger";

export const metadata: Metadata = { title: "Ressources humaines" };
export const dynamic = "force-dynamic";

/** A live capability: links to its canonical route. */
function WorkspaceTile({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className="surface block p-5 transition hover:border-teal-300 hover:shadow-sm">
      <p className="text-sm font-semibold text-navy-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </Link>
  );
}

/** A roadmap capability: disabled, and honest about which phase owns it. */
function SoonTile({ title, note }: { title: string; note: string }) {
  return (
    <div aria-disabled="true" className="surface p-5 opacity-60">
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  );
}

/** Built, but waiting on an authority nobody holds yet. Named, not hidden. */
function GatedTile({ title, gate }: { title: string; gate: string }) {
  return (
    <div aria-disabled="true" className="surface p-5 opacity-60">
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-1 text-xs text-slate-400">Autorisation requise — {gate}</p>
    </div>
  );
}

export default async function HrOperationsCenterPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Management" title="Ressources humaines" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canConfigure = hasPermission(permissions, "hr:config:manage");
  const canManage = hasPermission(permissions, "hr:manage");

  const [stats, counts, config, ops, leave, center, hrOfficers, departures] = await Promise.all([
    employeeStats(user.tenantId),
    hrDashboardCounts(user.tenantId),
    getHrConfiguration(user.tenantId),
    hrOperationsCounts(user.tenantId),
    leaveCounts(user.tenantId),
    getHrCenterData(user.tenantId),
    countHrOfficers(user.tenantId),
    offboardingCounts(user.tenantId),
  ]);

  const UNAVAILABLE = "indisponible";
  const contractsSoon = center.expiringContracts?.length ?? null;
  const documentsSoon = center.expiringDocuments?.length ?? null;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Management"
        title="Ressources humaines"
        subtitle="Centre d'opérations RH — effectifs, intégration, équipements, congés et organisation."
      />

      {/* Effectifs — the headline row (HR-8B added « Départs en cours ») */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Employés actifs" value={stats.active} tone="teal" href="/departments/hr/registre" />
        <StatCard label="En congé aujourd'hui" value={leave.onLeaveToday} tone="navy" href="/departments/hr/conges" />
        <StatCard label="Intégrations en cours" value={ops.activeCases} tone="navy" href="/departments/hr/onboarding" />
        <StatCard label="Départs en cours" value={departures.activeCases} tone="amber" href="/departments/hr/departs" />
        <StatCard label="Équipements attribués" value={ops.assetsAssigned} tone="slate" href="/departments/hr/equipement" />
      </div>

      {/* Attention — zero and « indisponible » read differently, deliberately */}
      <DeptAttentionCard
        items={[
          { label: "Congés à décider", value: leave.pending, tone: "amber" },
          { label: `Contrats expirant (${EXPIRY_WINDOW_DAYS} j)`, value: contractsSoon ?? UNAVAILABLE, tone: "amber" },
          { label: `Documents expirant (${EXPIRY_WINDOW_DAYS} j)`, value: documentsSoon ?? UNAVAILABLE, tone: "amber" },
          { label: "Restitutions attendues", value: ops.assetsAwaitingReturn, tone: "red" },
          { label: "Tâches d'intégration en retard", value: ops.overdueItems, tone: "red" },
          // HR-8B. Departures only: the tenant-wide custody figures are above.
          { label: "Matériel à restituer (départs)", value: departures.equipmentOutstanding, tone: "red" },
          { label: "Étapes de clôture à terminer", value: departures.stepsPending, tone: "amber" },
          // HR-6. Live signals, computed on load — no scheduler exists, and none
          // was invented to produce them (see the HR-5A deferral).
          { label: "Revues à finaliser", value: center.performance?.awaitingFinalization ?? UNAVAILABLE, tone: "amber" },
          { label: "Objectifs en retard", value: center.performance?.objectivesOverdue ?? UNAVAILABLE, tone: "amber" },
          { label: "Formations obligatoires en retard", value: center.training?.mandatoryOverdue ?? UNAVAILABLE, tone: "red" },
          { label: `Certificats expirant (${CERTIFICATE_EXPIRY_WINDOW_DAYS} j)`, value: center.training?.expiringSoon ?? UNAVAILABLE, tone: "amber" },
        ]}
      />

      {config === null && (
        <div className="surface p-4 text-sm text-slate-600">
          La structure RH n&apos;est pas encore configurée{canConfigure
            ? " — le centre de configuration est accessible ci-dessous."
            : " ; le centre de configuration requiert « hr:config:manage », autorisation en attente de ratification (HRQ-D2)."}
        </div>
      )}

      {/* HR-A2 — governance fact (F2): four-eyes flows need TWO distinct
          officers. Counted from production, fail-closed to 0 — never assumed.
          The second seat is granted through Administration (a role assignment),
          never from here. */}
      {hrOfficers < 2 && (
        <div className="surface p-4 text-sm text-slate-600">
          <span className="font-medium text-navy-900">Chargés RH actifs : {hrOfficers}.</span>{" "}
          Les visas à quatre yeux (vérification de contrat, approbation d&apos;import) exigent
          deux personnes distinctes — un second Chargé RH doit être désigné via
          Administration → Utilisateurs avant ces étapes. Rien n&apos;est assoupli en attendant.
        </div>
      )}

      {/* Canonical entry points — exactly one per completed capability */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Espaces de travail</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <WorkspaceTile href="/departments/hr/registre" title="Employés" subtitle="Registre — identité, statut, compte lié" />
          <WorkspaceTile href="/departments/hr/organisation" title="Organisation" subtitle="Arbre des unités — lecture seule" />
          <WorkspaceTile href="/departments/hr/onboarding" title="Intégration" subtitle="Dossiers, check-lists, accès" />
          <WorkspaceTile href="/departments/hr/equipement" title="Équipements" subtitle="Parc, attribution, restitution" />
          <WorkspaceTile href="/departments/hr/conges" title="Congés & présence" subtitle="Demandes, droits, saisie de présence" />
          {canConfigure
            ? <WorkspaceTile href="/departments/hr/configuration" title="Configuration" subtitle="Structure, postes, numérotation" />
            : <GatedTile title="Configuration" gate="hr:config:manage (HRQ-D2)" />}
          {canManage
            ? <WorkspaceTile href="/departments/hr/imports" title="Imports" subtitle="Préparation — application non activée" />
            : <GatedTile title="Imports" gate="hr:manage" />}
          <WorkspaceTile href="/departments/hr/performance" title="Performance" subtitle="Cycles, objectifs, compétences" />
          <WorkspaceTile href="/departments/hr/formation" title="Formation" subtitle="Catalogue, inscriptions, certificats" />
          {/* HR-7B — activated: facts-only preparation (DEC-B63; amounts stay out — Q1). */}
          <WorkspaceTile href="/departments/hr/paie" title="Préparation de paie" subtitle="Périodes, faits collectés, ajustements — sans montants" />
          {/* HR-8B — activated: clearance only. The employment lifecycle stays
              in the registry and the account step stays in Administration. */}
          <WorkspaceTile href="/departments/hr/departs" title="Départs" subtitle="Sorties, restitution, clôture" />
          <SoonTile title="Reporting RH" note="À venir — HR-9" />
        </div>
      </div>

      {/* Structure — what the organisation actually contains today */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Unités d'organisation" value={counts.units} tone="slate" href="/departments/hr/organisation" />
        <StatCard label="Départements RH" value={counts.departments} tone="slate" />
        <StatCard label="Postes" value={counts.positions} tone="slate" />
        <StatCard label="Sites de travail" value={counts.locations} tone="slate" />
      </div>

      {/* Activité récente — a projection of the append-only ledger */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Activité RH récente</h2>
        {center.recentActivity === null ? (
          <p className="text-sm text-slate-500">Activité indisponible pour le moment.</p>
        ) : center.recentActivity.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune activité enregistrée.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {center.recentActivity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-slate-600">
                <span className="tabular text-xs text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</span>
                <strong className="text-navy-800">{HR_EVENT_LABEL_FR[e.kind as HrEventKind] ?? e.kind}</strong>
                <Link href={`/departments/hr/${e.employeeId}`} className="text-xs text-teal-700 hover:underline">
                  voir l&apos;employé
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
