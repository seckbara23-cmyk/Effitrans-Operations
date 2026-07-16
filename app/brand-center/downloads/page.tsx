import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const metadata: Metadata = { title: "Centre de téléchargement" };
export const dynamic = "force-dynamic";

// The single hub. Each generator lives on its own page; future assets add a row here.
const GROUPS: { title: string; items: { label: string; href: string; formats: string }[] }[] = [
  { title: "Identité collaborateurs", items: [
    { label: "Signature e-mail", href: "/brand-center/people", formats: "HTML · Texte" },
    { label: "Carte numérique (vCard · QR)", href: "/brand-center/people", formats: "vCard · QR PNG" },
  ] },
  { title: "Documents & présentations", items: [
    { label: "Documents d'entreprise", href: "/brand-center/documents", formats: "PDF · DOCX" },
    { label: "Présentations", href: "/brand-center/presentations", formats: "PPTX" },
  ] },
  { title: "Communication", items: [
    { label: "Réseaux sociaux (bannières, annonces)", href: "/brand-center/social", formats: "SVG" },
    { label: "E-mailing marketing", href: "/brand-center/marketing", formats: "HTML" },
  ] },
  { title: "Aide", items: [
    { label: "Guides d'installation", href: "/brand-center/guides", formats: "Pages d'aide" },
  ] },
];

export default async function DownloadsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage") && !hasPermission(permissions, "admin:users:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Centre de téléchargement" subtitle="Point d'accès unique à tous les livrables de marque. Chaque livrable est généré à partir du Centre de marque." />
      {GROUPS.map((g) => (
        <section key={g.title} className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{g.title}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.items.map((it) => (
              <Link key={it.label} href={it.href} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50">
                <span className="text-sm font-medium text-navy-800">{it.label}</span>
                <span className="text-xs text-slate-400">{it.formats}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
