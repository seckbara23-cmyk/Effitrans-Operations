import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { MarketingStudio } from "@/components/brand/marketing-studio";

export const metadata: Metadata = { title: "E-mailing marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="E-mailing marketing" subtitle="Modèles HTML portables (Mailchimp, HubSpot, Dynamics), pilotés par le Centre de marque. Aucun envoi, aucune programmation, aucun suivi." />
      <MarketingStudio />
    </div>
  );
}
