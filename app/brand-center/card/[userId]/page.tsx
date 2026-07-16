import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCardAdminView } from "@/lib/brand/server/card-service";
import { CardStudio } from "@/components/brand/card-studio";

export const metadata: Metadata = { title: "Carte numérique" };
export const dynamic = "force-dynamic";

export default async function CardAdminPage({ params }: { params: { userId: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:users:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const view = await getCardAdminView(params.userId);
  if (!view) return <div className="surface p-6 text-sm text-slate-600">Collaborateur introuvable.</div>;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque · Identité collaborateurs" title={`Carte numérique — ${view.name}`} subtitle="Carte de visite publique, opt-in et révocable. Aucune donnée du tenant n'est exposée." />
      <p className="text-sm"><Link href="/brand-center/people" className="text-teal-700 hover:underline">← Retour aux collaborateurs</Link></p>
      <CardStudio userId={params.userId} view={view} />
    </div>
  );
}
