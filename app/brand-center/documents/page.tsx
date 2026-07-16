import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { documentReadiness } from "@/lib/brand/document/model";
import { TEMPLATE_LIST } from "@/lib/brand/document/registry";

export const metadata: Metadata = { title: "Modèles de documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const { profile } = await getBrandCenterOverview();
  const readiness = documentReadiness(profile);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Modèles de documents" subtitle="Documents d'entreprise pilotés par le Centre de marque (PDF + DOCX). L'en-tête, les couleurs, le pied de page et la conformité sont injectés automatiquement." />
      {!readiness.ready && (
        <div className="surface border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Marque incomplète : {readiness.missing.join(", ")}. <Link href="/brand-center" className="font-medium underline">Compléter le Centre de marque</Link>.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEMPLATE_LIST.map((t) => (
          <Link key={t.type} href={`/brand-center/documents/${t.type.toLowerCase()}`} className="surface block p-5 transition-shadow hover:shadow-md">
            <p className="text-[15px] font-semibold text-navy-900">{t.label}</p>
            <p className="mt-1 text-sm text-slate-500">{t.shape === "line_items" ? "Lignes + totaux" : t.shape === "sections" ? "Sections" : "Texte libre"}{t.allowsSignature ? " · signature" : ""}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
