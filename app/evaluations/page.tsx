/**
 * HR-B2 — « Mes évaluations »: employee self-service, the manager-of-record
 * review queue, and the Direction finalization queue.
 * ---------------------------------------------------------------------------
 * Deliberately UNGATED by permission, exactly like /conges (the front-door
 * doctrine): what each visitor can DO here is decided by identity and by the
 * database. An unlinked account sees an explanation, not an error; a linked
 * employee sees their own evaluation; the manager snapshotted on an evaluation
 * sees their team's; a holder of hr:performance:finalize additionally sees the
 * org-wide finalization queue. Authority lives in migration 20260831000001's
 * RPCs — nothing on this page can widen it, and the C3 prose shown obeys the
 * ratified Q2 lanes without touching hr:sensitive:read.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getMyPerformanceWorkspace } from "@/lib/hr/my-performance";
import { MyEvaluationsStudio } from "@/components/hr/my-evaluations-studio";

export const metadata: Metadata = { title: "Mes évaluations" };
export const dynamic = "force-dynamic";

export default async function MyEvaluationsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Mon espace" title="Mes évaluations" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canFinalize = hasPermission(permissions, "hr:performance:finalize");
  const canReadSensitive = hasPermission(permissions, "hr:sensitive:read");
  const workspace = await getMyPerformanceWorkspace(
    { id: user.id, tenantId: user.tenantId },
    { canFinalize, canReadSensitive },
  );

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Mon espace"
        title="Mes évaluations"
        subtitle="Votre auto-évaluation, la revue de votre responsable et votre accusé de réception — l'accusé atteste la prise de connaissance, jamais l'approbation."
      />
      <MyEvaluationsStudio workspace={workspace} canFinalize={canFinalize} />
    </div>
  );
}
