import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { MembershipManager } from "@/components/brand/membership-manager";

export const metadata: Metadata = { title: "Réseaux internationaux" };
export const dynamic = "force-dynamic";

export default async function BrandMembershipsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const { memberships } = await getBrandCenterOverview();
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Réseaux internationaux" subtitle="Adhésions et affiliations (WCA, FIATA…). Saisissez uniquement des informations approuvées ; les logos partenaires ne peuvent être ni modifiés ni recolorés." />
      <MembershipManager memberships={memberships} />
    </div>
  );
}
