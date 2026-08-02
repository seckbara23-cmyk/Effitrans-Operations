/** HR-4 — Equipment workspace. Gate hr:read (actions gate hr:manage). */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import { listEquipment, listEquipmentTypes, listOpenCustody } from "@/lib/hr/onboarding";
import { EquipmentStudio } from "@/components/hr/equipment-studio";

export const metadata: Metadata = { title: "Équipements — RH" };
export const dynamic = "force-dynamic";

export default async function HrEquipmentPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6"><PageHeader meta="Ressources humaines" title="Équipements" subtitle="Configuration requise." /></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");

  const [equipment, types, openCustody, directory] = await Promise.all([
    listEquipment(user.tenantId), listEquipmentTypes(user.tenantId),
    listOpenCustody(user.tenantId), listEmployees(user.tenantId),
  ]);
  const employees = directory.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Équipements" subtitle="Parc, attribution et restitution — historique de garde inaltérable." />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <EquipmentStudio equipment={equipment} types={types} openCustody={openCustody}
        employees={employees} canManage={canManage} />
    </div>
  );
}
