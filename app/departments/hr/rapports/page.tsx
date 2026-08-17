/**
 * HR-9B — Reporting RH. Gate: `hr:reports:read` (RQ-9.1 ratified: the HR desk
 * and the executive seat, never the broad analytics:read population).
 *
 * COMPOSITION ONLY. Every figure comes from a read service HR-1…HR-8 already
 * owns; this page computes nothing of its own and stores nothing.
 *
 * The privacy floor (RQ-9.2) is decided by ROW ACCESS, not by seniority: a
 * reader holding `hr:read` sees actual totals — hiding a number they could
 * obtain by counting the registry protects nobody — while a reader with
 * aggregates only has small-group BREAKDOWNS masked.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GuideLink } from "@/components/hr/guide-link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { buildHrReport, resolvePeriod, reportViewerTier } from "@/lib/hr/reporting";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { ReportingStudio } from "@/components/hr/reporting-studio";

export const metadata: Metadata = { title: "Reporting RH" };
export const dynamic = "force-dynamic";

export default async function HrReportsPage({
  searchParams,
}: { searchParams: { du?: string; au?: string; departement?: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Reporting RH" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:reports:read")) notFound();
  const tier = reportViewerTier(permissions);

  const today = new Date().toISOString().slice(0, 10);
  const period = resolvePeriod(searchParams.du, searchParams.au, today);
  const departments: string[] = CANONICAL_DEPARTMENTS.map((d) => d.code);
  const department = searchParams.departement && departments.includes(searchParams.departement)
    ? searchParams.departement
    : null;

  const report = await buildHrReport(user.tenantId, period, department);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Reporting RH"
        subtitle="Indicateurs agrégés — effectifs, mouvements, congés et charge opérationnelle." />
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
        <GuideLink route="/departments/hr/rapports" />
      </div>
      <ReportingStudio period={report.period} headline={report.headline}
        byStatus={report.byStatus} byDepartment={report.byDepartment} byOrgUnit={report.byOrgUnit}
        departments={departments} department={department} tier={tier} />
    </div>
  );
}
