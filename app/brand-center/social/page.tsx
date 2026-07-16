import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { CommunicationStudio } from "@/components/brand/communication-studio";

export const metadata: Metadata = { title: "Réseaux sociaux" };
export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Réseaux sociaux" subtitle="Modèles approuvés (bannières LinkedIn, publications, annonces) pilotés par le Centre de marque. Pas de campagne, pas de programmation." />
      <CommunicationStudio />
    </div>
  );
}
