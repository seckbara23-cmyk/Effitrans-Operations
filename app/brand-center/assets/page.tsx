import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { BrandAssetManager } from "@/components/brand/asset-manager";

export const metadata: Metadata = { title: "Ressources visuelles" };
export const dynamic = "force-dynamic";

export default async function BrandAssetsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const { assets } = await getBrandCenterOverview();
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Ressources visuelles" subtitle="Logos et images approuvés au format PNG (max 100 Ko). Le SVG n'est pas accepté ; les logos partenaires nécessitent l'accord d'usage." />
      <BrandAssetManager assets={assets} />
    </div>
  );
}
