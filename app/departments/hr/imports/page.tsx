/**
 * HR-1 — Import staging workspace. Gate: hr:manage.
 * ---------------------------------------------------------------------------
 * HR-1 froze the pipeline at READY behind HRQ-A4. Effitrans answered YES, so
 * HR-B3 completed it: template → upload (xlsx/csv) → validation → preview →
 * four-eyes visa → APPLY → report. Application creates employees through the
 * exact createEmployee path — never a parallel insert.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listImportBatches, listImportErrors, listImportOutcomes } from "@/lib/hr/organization";
import { countHrOfficers } from "@/lib/hr/read";
import { HrImportStudio } from "@/components/hr/import-studio";

export const metadata: Metadata = { title: "Imports RH" };
export const dynamic = "force-dynamic";

export default async function HrImportsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Imports" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  if (!hasPermission(permissions, "hr:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Imports" subtitle="Préparation des données d'organisation." />
        <div className="surface p-6 text-sm text-slate-600">La préparation des imports requiert « hr:manage ».</div>
      </div>
    );
  }

  const batches = await listImportBatches(user.tenantId);
  const batchIds = batches.map((b) => b.id);
  const [errors, outcomes, hrOfficerCount] = await Promise.all([
    listImportErrors(user.tenantId, batchIds),
    listImportOutcomes(user.tenantId, batchIds),
    countHrOfficers(user.tenantId),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Imports — préparation"
        subtitle="Modèle Excel → téléversement → validation → aperçu → visa à quatre yeux → application → rapport. Les employés apparaissent dans le Registre à l'application du lot."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <HrImportStudio batches={batches} currentUserId={user.id} hrOfficerCount={hrOfficerCount} errors={errors} outcomes={outcomes} />
    </div>
  );
}
