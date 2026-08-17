/**
 * HR-7B — Préparation de paie. Gate hr:read (register); the per-employee
 * FACTS require the preparing desk (hr:manage) or the parked hr:payroll:read
 * — never hr:sensitive:read (audit §9). Approval/lock assert the parked
 * hr:payroll:approve in the database (Q7). FACTS ONLY: no monetary field
 * exists on this page or anywhere beneath it (Q1/DEC-B63).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GuideLink } from "@/components/hr/guide-link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  listPayrollPeriods, listPayrollLines, listPayrollAdjustments, listAdjustmentKinds,
  canReadPayrollFacts,
} from "@/lib/hr/payroll";
import { PayrollStudio } from "@/components/hr/payroll-studio";

export const metadata: Metadata = { title: "Préparation de paie — RH" };
export const dynamic = "force-dynamic";

export default async function HrPayrollPage({
  searchParams,
}: { searchParams: { periode?: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6"><PageHeader meta="Ressources humaines" title="Préparation de paie" subtitle="Configuration requise." /></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canReadFacts = canReadPayrollFacts(permissions);
  const canConfigure = hasPermission(permissions, "hr:config:manage");

  const periods = await listPayrollPeriods(user.tenantId);
  const selectedId = searchParams.periode && periods.some((p) => p.id === searchParams.periode)
    ? searchParams.periode
    : periods[0]?.id ?? null;
  const [lines, adjustments, kinds] = selectedId
    ? await Promise.all([
        listPayrollLines(user.tenantId, selectedId, canReadFacts),
        listPayrollAdjustments(user.tenantId, selectedId, canReadFacts),
        listAdjustmentKinds(user.tenantId),
      ])
    : [[], [], await listAdjustmentKinds(user.tenantId)];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Préparation de paie"
        subtitle="Faits et quantités uniquement — identités, mouvements, présence, congés approuvés, ajustements. Aucun montant : le calcul de paie reste externe (DEC-B63)."
      />
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">
        ← Centre d&apos;opérations RH
      </Link>
        <GuideLink route="/departments/hr/paie" />
      </div>
      <PayrollStudio
        periods={periods}
        lines={lines}
        adjustments={adjustments}
        kinds={kinds}
        selectedId={selectedId}
        canReadFacts={canReadFacts}
        canConfigure={canConfigure}
      />
    </div>
  );
}
