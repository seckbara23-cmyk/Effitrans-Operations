import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { BrandIdentityForm } from "@/components/brand/identity-form";

export const metadata: Metadata = { title: "Identité de marque" };
export const dynamic = "force-dynamic";

export default async function BrandIdentityPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const { profile } = await getBrandCenterOverview();
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Identité de marque" subtitle="Valeurs officielles de la marque. Les couleurs restent vides tant que la Direction ne les a pas fournies." />
      <BrandIdentityForm profile={profile} />
    </div>
  );
}
