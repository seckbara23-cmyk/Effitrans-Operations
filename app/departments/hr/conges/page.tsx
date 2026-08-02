/** HR-5 — Leave workspace. Gate hr:read; approval needs hr:leave:approve. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import { listLeaveCategories, listLeaveRequests } from "@/lib/hr/leave";
import { LeaveStudio } from "@/components/hr/leave-studio";

export const metadata: Metadata = { title: "Congés — RH" };
export const dynamic = "force-dynamic";

export default async function HrLeavePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6"><PageHeader meta="Ressources humaines" title="Congés" subtitle="Configuration requise." /></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");
  const canApprove = hasPermission(permissions, "hr:leave:approve");

  const [requests, categories, directory] = await Promise.all([
    listLeaveRequests(user.tenantId),
    listLeaveCategories(user.tenantId),
    listEmployees(user.tenantId),
  ]);
  const employees = directory.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Congés & présence"
        subtitle="Demandes, droits saisis et présence — le statut « en congé » est toujours déduit, jamais saisi." />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <LeaveStudio requests={requests} categories={categories} employees={employees}
        canManage={canManage} canApprove={canApprove} currentUserId={user.id} />
    </div>
  );
}
