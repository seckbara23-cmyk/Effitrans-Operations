/**
 * HR-10A — Guide utilisateur & SOP RH. Gate: `hr:read` (RQ-10.3 ratified:
 * an HR/management operational guide, not employee self-service).
 *
 * DOCUMENTATION ONLY. This page adds no capability: it describes the shipped
 * workspaces, quotes their real labels, and states — from the live authority
 * census, not from a sentence someone will forget to update — which workflows
 * Effitrans can actually run today (RQ-10.2).
 *
 * Follows the /brand-center/guides precedent: content as typed data, numbered
 * steps, and an audited view that records the reader and nothing else.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { guideWithReadiness } from "@/lib/hr/guide";
import { writeAudit } from "@/lib/audit/log";

export const metadata: Metadata = { title: "Guide RH" };
export const dynamic = "force-dynamic";

function Block({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

export default async function HrGuidePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Guide RH" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();

  const sections = await guideWithReadiness(user.tenantId);
  // Safe view audit — reader and tenant only, no content.
  await writeAudit({
    action: "hr.guide.viewed", actorId: user.id, tenantId: user.tenantId,
    entity: "hr_guide", entityId: "sop",
  });

  const blocked = sections.filter((s) => !s.available);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Guide RH — mode opératoire"
        subtitle="Qui fait quoi, dans quel ordre, avec quelles pièces — et ce que la plateforme fait toute seule." />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Sommaire</h2>
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm sm:grid-cols-2">
          {sections.map(({ section, available }) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-teal-700 hover:underline">{section.title}</a>
              {!available && <span className="ml-2 text-xs text-amber-700">non disponible aujourd&apos;hui</span>}
            </li>
          ))}
        </ol>
        {blocked.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {blocked.length} activité(s) sont bien présentes dans la plateforme mais ne peuvent pas être
            menées à bien aujourd&apos;hui, faute des personnes habilitées. Ce n&apos;est pas un défaut du
            logiciel : les contrôles fonctionnent et exigent des personnes qui ne sont pas encore
            désignées. Le détail figure dans chaque section concernée.
          </p>
        )}
      </section>

      {sections.map(({ section, available, blockedBy }) => (
        <section key={section.id} id={section.id} className="surface scroll-mt-6 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">{section.title}</h2>
            <span className={available
              ? "rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700"
              : "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800"}>
              {available ? "Disponible aujourd'hui" : "Non disponible aujourd'hui"}
            </span>
          </div>

          {!available && (
            <div className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <p className="font-medium">Cette activité est disponible dans la plateforme, mais ne peut pas être menée à bien aujourd&apos;hui.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockedBy.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <p className="mt-1">
                La désignation se fait dans Administration → Utilisateurs. Aucun contrôle n&apos;est
                assoupli en attendant.
              </p>
            </div>
          )}

          <p className="mt-2 text-sm text-slate-600"><span className="font-medium text-navy-900">Qui :</span> {section.audience}</p>
          <p className="text-sm text-slate-600"><span className="font-medium text-navy-900">Quand :</span> {section.when}</p>
          {section.route && (
            <p className="mt-1 text-sm">
              <Link href={section.route} className="text-teal-700 hover:underline">Ouvrir l&apos;espace de travail →</Link>
            </p>
          )}

          {section.steps.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Étapes</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                {section.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
          )}

          <Block title="Pièces et informations nécessaires" items={section.evidence} />
          <Block title="Ce que la plateforme fait toute seule" items={section.automatic} />
          <Block title="Ce qui se fait ailleurs" items={section.elsewhere} />
          <Block title="À définir par Effitrans" items={section.toSupply} />
        </section>
      ))}

      <p className="text-xs text-slate-400">
        Ce guide décrit la plateforme telle qu&apos;elle fonctionne aujourd&apos;hui. Les mentions
        « non disponible aujourd&apos;hui » se mettent à jour d&apos;elles-mêmes dès que les personnes
        habilitées sont désignées.
      </p>
    </div>
  );
}
