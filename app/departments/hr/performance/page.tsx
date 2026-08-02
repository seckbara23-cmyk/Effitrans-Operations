/**
 * HR-6 — Performance workspace. Gate hr:read; finalization needs
 * hr:performance:finalize (unratified, held by nobody). C3 evaluation prose is
 * withheld from readers without hr:sensitive:read — withheld, never zeroed.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import {
  listCycles, listEvaluations, listObjectives, listCompetencies, performanceCounts,
} from "@/lib/hr/performance";
import { PerformanceStudio } from "@/components/hr/performance-studio";

export const metadata: Metadata = { title: "Performance — RH" };
export const dynamic = "force-dynamic";

export default async function HrPerformancePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Performance" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");
  const canFinalize = hasPermission(permissions, "hr:performance:finalize");
  const canConfigure = hasPermission(permissions, "hr:config:manage");
  const canReadSensitive = hasPermission(permissions, "hr:sensitive:read");

  const [cycles, evaluations, objectives, competencies, counts, directory] = await Promise.all([
    listCycles(user.tenantId),
    listEvaluations(user.tenantId, { canReadSensitive }),
    listObjectives(user.tenantId),
    listCompetencies(user.tenantId),
    performanceCounts(user.tenantId),
    listEmployees(user.tenantId),
  ]);
  const employees = directory.map((e) => ({
    id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})`,
  }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Performance"
        subtitle="Cycles d'évaluation, objectifs et compétences — les pondérations sont vérifiées à la finalisation, jamais supposées."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">
        ← Centre d&apos;opérations RH
      </Link>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Cycles en cours" value={counts.cyclesInProgress} tone="teal" />
        <StatCard label="Auto-évaluations attendues" value={counts.awaitingSelf} tone="navy" />
        <StatCard label="Revues manager attendues" value={counts.awaitingManager} tone="navy" />
        <StatCard label="Objectifs en retard" value={counts.objectivesOverdue} tone="slate" />
      </div>

      <PerformanceStudio
        cycles={cycles}
        evaluations={evaluations}
        objectives={objectives}
        competencies={competencies}
        employees={employees}
        canManage={canManage}
        canFinalize={canFinalize}
        canConfigure={canConfigure}
        canReadSensitive={canReadSensitive}
      />
    </div>
  );
}
