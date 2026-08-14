/**
 * HR-B1 — « Mes congés »: employee self-service + the manager's decision queue.
 * ---------------------------------------------------------------------------
 * Deliberately UNGATED by permission (any authenticated staff member may open
 * it — the front-door doctrine): what each visitor can DO here is decided by
 * identity and by the database. An unlinked account sees an explanation, not
 * an error; a linked employee sees their own leave; a manager additionally
 * sees their direct reports' pending requests; a Direction seat
 * (hr:leave:approve) sees the org-wide queue. Approval authority lives in
 * hr_decide_leave_request — nothing on this page can widen it.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getMyLeaveWorkspace } from "@/lib/hr/my-leave";
import { MyLeaveStudio } from "@/components/hr/my-leave-studio";

export const metadata: Metadata = { title: "Mes congés" };
export const dynamic = "force-dynamic";

export default async function MyLeavePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6"><PageHeader meta="Mon espace" title="Mes congés" subtitle="Configuration requise." /></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canApprove = hasPermission(permissions, "hr:leave:approve");
  const workspace = await getMyLeaveWorkspace({ id: user.id, tenantId: user.tenantId }, canApprove);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Mon espace" title="Mes congés"
        subtitle="Vos demandes et vos soldes ; l'approbation revient à votre responsable hiérarchique ou à la Direction." />
      <MyLeaveStudio workspace={workspace} canApprove={canApprove} />
    </div>
  );
}
