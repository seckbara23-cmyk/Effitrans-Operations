import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { PresentationStudio } from "@/components/brand/presentation-studio";

export const metadata: Metadata = { title: "Présentations" };
export const dynamic = "force-dynamic";

export default async function PresentationsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Présentations" subtitle="Deck d'entreprise éditable (PPTX) piloté par le Centre de marque. Prévisualisez les diapositives, puis téléchargez le PowerPoint." />
      <PresentationStudio />
    </div>
  );
}
