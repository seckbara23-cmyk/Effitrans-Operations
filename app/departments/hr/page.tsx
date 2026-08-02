/**
 * HR-1 — the HR Dashboard, the hub's first page (ratified addendum §10).
 * ---------------------------------------------------------------------------
 * Eight cards. Cards whose module is not yet implemented render DARK
 * (disabled, « À venir — HR-n ») — never a broken link, never a hidden
 * surprise. The shipped Employee Registry is a WORKSPACE reached from here
 * (/departments/hr/registre), exactly as Douane/Transport/Caisse hang off
 * their department hubs.
 *
 * Gate: hr:read (SYSTEM_ADMIN holds no hr:* — DEC-B25). Route re-checks;
 * the sidebar entry under MANAGEMENT filters on the same permission.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { employeeStats } from "@/lib/hr/read";
import { hrDashboardCounts, getHrConfiguration } from "@/lib/hr/organization";
import { hrOperationsCounts } from "@/lib/hr/onboarding";

export const metadata: Metadata = { title: "Ressources humaines" };
export const dynamic = "force-dynamic";

/** A live module tile: links to its workspace. */
function WorkspaceTile({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className="surface block p-5 transition hover:border-teal-300 hover:shadow-sm">
      <p className="text-sm font-semibold text-navy-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </Link>
  );
}

/** A dark tile: the module exists in the roadmap, not in the product yet. */
function DarkTile({ title, phase }: { title: string; phase: string }) {
  return (
    <div aria-disabled="true" className="surface p-5 opacity-60">
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-1 text-xs text-slate-400">À venir — {phase}</p>
    </div>
  );
}

export default async function HrDashboardPage() {
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

  const [stats, counts, config, ops] = await Promise.all([
    employeeStats(user.tenantId),
    hrDashboardCounts(user.tenantId),
    getHrConfiguration(user.tenantId),
    hrOperationsCounts(user.tenantId),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Management"
        title="Ressources humaines"
        subtitle="Tableau de bord RH — effectifs, organisation et espaces de travail."
      />

      {/* Headcount + structure at a glance */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Employés actifs" value={stats.active} tone="teal" />
        <StatCard label="Départements RH" value={counts.departments} tone="navy" />
        <StatCard label="Postes" value={counts.positions} tone="slate" />
        <StatCard label="Unités d'organisation" value={counts.units} tone="slate" />
      </div>

      {/* HR-4 — live operational counters */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Intégrations en cours" value={ops.activeCases} tone="navy" />
        <StatCard label="Tâches d'intégration en retard" value={ops.overdueItems} tone={ops.overdueItems > 0 ? "amber" : "slate"} />
        <StatCard label="Équipements attribués" value={ops.assetsAssigned} tone="teal" />
        <StatCard label="Restitutions attendues" value={ops.assetsAwaitingReturn} tone={ops.assetsAwaitingReturn > 0 ? "amber" : "slate"} />
      </div>

      {config === null && (
        <div className="surface p-4 text-sm text-slate-600">
          La structure RH n'est pas encore configurée. Le centre de configuration
          {canConfigure ? " est accessible ci-dessous." : " sera accessible une fois l'autorisation « hr:config:manage » attribuée (ratification HRQ-D2 en attente)."}
        </div>
      )}

      {/* The eight cards — live modules link, unbuilt modules are dark */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <WorkspaceTile href="/departments/hr/registre" title="Employés" subtitle="Registre du personnel — identité, statut, compte" />
        <WorkspaceTile href="/departments/hr/organisation" title="Organisation" subtitle="Arbre des unités — lecture seule" />
        {canConfigure ? (
          <WorkspaceTile href="/departments/hr/configuration" title="Départements & Postes" subtitle="Centre de configuration (permanent)" />
        ) : (
          <div aria-disabled="true" className="surface p-5 opacity-60">
            <p className="text-sm font-semibold text-slate-500">Départements & Postes</p>
            <p className="mt-1 text-xs text-slate-400">Configuration — autorisation en attente (HRQ-D2)</p>
          </div>
        )}
        {canManage ? (
          <WorkspaceTile href="/departments/hr/imports" title="Imports" subtitle="Préparation des données — pipeline en attente d'activation" />
        ) : (
          <DarkTile title="Imports" phase="hr:manage requis" />
        )}
        <WorkspaceTile href="/departments/hr/onboarding" title="Intégration" subtitle="Dossiers, check-lists et suivi des accès" />
        <WorkspaceTile href="/departments/hr/equipement" title="Équipements" subtitle="Parc, attribution et restitution" />
        <DarkTile title="Congés" phase="HR-5" />
        <DarkTile title="Performance" phase="HR-6" />
      </div>
    </div>
  );
}
