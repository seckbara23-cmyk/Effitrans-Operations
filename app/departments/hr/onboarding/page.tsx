/** HR-4 — Onboarding workspace. Gate hr:read (actions gate hr:manage). */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import { listEmployeeDocuments } from "@/lib/hr/employee-file";
import {
  listOnboardingCases, listOnboardingItems, listProvisioningRequests, listChecklistTemplates,
} from "@/lib/hr/onboarding";
import { OnboardingStudio } from "@/components/hr/onboarding-studio";

export const metadata: Metadata = { title: "Intégration — RH" };
export const dynamic = "force-dynamic";

export default async function HrOnboardingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6"><PageHeader meta="Ressources humaines" title="Intégration" subtitle="Configuration requise." /></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");
  const canSeeSensitive = hasPermission(permissions, "hr:sensitive:read");

  const [cases, templates, directory] = await Promise.all([
    listOnboardingCases(user.tenantId),
    listChecklistTemplates(user.tenantId),
    listEmployees(user.tenantId),
  ]);
  const itemsByCase: Record<string, Awaited<ReturnType<typeof listOnboardingItems>>> = {};
  const provByCase: Record<string, Awaited<ReturnType<typeof listProvisioningRequests>>> = {};
  // Evidence parity with Départs (D-4): a step that requires a document is
  // completed by citing one of the case employee's OWN documents. C3 stays
  // behind the sensitive tier — the employee-file rule, reused not restated.
  const documentsByCase: Record<string, { id: string; label: string }[]> = {};
  await Promise.all(cases.map(async (c) => {
    const [items, prov, docs] = await Promise.all([
      listOnboardingItems(user.tenantId, c.id),
      listProvisioningRequests(user.tenantId, c.id),
      listEmployeeDocuments(user.tenantId, c.employee_id, canSeeSensitive),
    ]);
    itemsByCase[c.id] = items;
    provByCase[c.id] = prov;
    documentsByCase[c.id] = docs.map((d) => ({
      id: d.id,
      label: d.type?.label_fr ? `${d.type.label_fr} — ${d.title}` : d.title,
    }));
  }));
  const employees = directory.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Intégration" subtitle="Dossiers d'intégration, check-lists et suivi des accès." />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <OnboardingStudio cases={cases} employees={employees} templates={templates}
        itemsByCase={itemsByCase} provByCase={provByCase} documentsByCase={documentsByCase}
        canManage={canManage} />
    </div>
  );
}
