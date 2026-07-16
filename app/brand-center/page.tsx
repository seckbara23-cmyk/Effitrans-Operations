import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Centre de marque" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/brand-center/identity", label: "Identité de marque", desc: "Couleurs, typographie, slogan, contacts, conformité." },
  { href: "/brand-center/assets", label: "Ressources visuelles", desc: "Logos et images approuvés (PNG)." },
  { href: "/brand-center/memberships", label: "Réseaux internationaux", desc: "WCA, FIATA, adhésions et affiliations." },
  { href: "/brand-center/people", label: "Identité collaborateurs", desc: "Fonction, coordonnées, variante de signature." },
  { href: "/brand-center/documents", label: "Modèles de documents", desc: "En-tête, devis, facture, proposition (PDF + DOCX)." },
];

const SOON = ["Présentations", "Réseaux sociaux", "E-mailing marketing"];

export default async function BrandCenterPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title="Centre de marque" />
        <div className="surface p-6 text-sm text-slate-600">Vous n'avez pas l'autorisation d'accéder au Centre de marque.</div>
      </div>
    );
  }

  const overview = await getBrandCenterOverview();
  const { completeness } = overview;
  const pct = Math.round((completeness.completed / completeness.total) * 100);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Administration" title="Centre de marque" subtitle="La source unique de l'identité de marque du tenant. Aucune valeur n'est inventée : les éléments manquants sont à fournir par la Direction." />

      <section className="surface p-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-navy-900">{completeness.completed}</span>
          <span className="text-sm text-slate-500">/ {completeness.total} · {completeness.summary}</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={completeness.completed} aria-valuemin={0} aria-valuemax={completeness.total} aria-label="Complétude de la marque">
          <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {completeness.items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              <span className={cn("mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full", i.complete ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />
              <span>
                <span className={i.complete ? "font-medium text-navy-800" : "font-medium text-slate-600"}>{i.label}</span>
                {!i.complete && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">À FOURNIR PAR LA DIRECTION</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="surface block p-5 transition-shadow hover:shadow-md">
            <p className="text-[15px] font-semibold text-navy-900">{s.label}</p>
            <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
          </Link>
        ))}
      </div>

      <section className="surface p-5">
        <p className="text-sm font-semibold text-navy-900">Bientôt disponible</p>
        <p className="mt-1 text-xs text-slate-500">Ces modules s'appuieront sur les valeurs et ressources définies ici. La publication de signatures nécessitera au préalable des valeurs de marque approuvées et un logo PNG approuvé.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SOON.map((s) => (
            <span key={s} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-400">{s}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
