import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getGovernanceDashboard } from "@/lib/brand/server/governance-service";
import { GovernanceDashboard } from "@/components/brand/governance-dashboard";

export const metadata: Metadata = { title: "Gouvernance de la marque" };
export const dynamic = "force-dynamic";

export default async function GovernancePage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const { rows, readiness } = await getGovernanceDashboard();
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Gouvernance de la marque" subtitle="Cycle de vie des modèles (Brouillon → Approuvé → Publié → Retiré). Un modèle ne peut être publié que si la marque est complète." />
      <GovernanceDashboard rows={rows} ready={readiness.ready} missing={readiness.missing} />
    </div>
  );
}
