/**
 * BCG-A — Guide Centre de Marque — mode opératoire. Gate: `admin:config:manage`
 * (RQ-BC.3 ratified), mirroring the Brand Center hub.
 *
 * DOCUMENTATION ONLY: no capability, no permission, no migration. Distinct from
 * « Guides d'installation des signatures » (`/brand-center/guides`), which
 * covers mail-client installation and is LINKED, never duplicated (RQ-BC.2).
 *
 * Readiness is computed from BRAND COMPLETENESS (RQ-BC.1) — the product's own
 * gate — and reported the product's own way: « N éléments sur 11 complétés »,
 * never a percentage, with the model's evidence for each missing item.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBrandGuideData } from "@/lib/brand/guide";
import { writeAudit } from "@/lib/audit/log";

export const metadata: Metadata = { title: "Guide Centre de marque" };
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

export default async function BrandGuidePage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Centre de marque" title="Guide Centre de marque" />
        <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>
      </div>
    );
  }

  const { readiness, sections } = await getBrandGuideData();
  // Safe view audit — reader and tenant only. `entity_id` is a uuid column and
  // this guide has no row, so it carries none (the UAT-HR10-01 rule).
  await writeAudit({
    action: "brand.guide.viewed", actorId: user.id, tenantId: user.tenantId,
    entity: "brand_guide", after: { guide: "mode_operatoire" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Guide Centre de marque — mode opératoire"
        subtitle="Qui fait quoi, dans quel ordre — et la différence entre modifier la marque, produire un livrable et gouverner un modèle." />
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/brand-center" className="inline-block text-sm text-teal-700 hover:underline">← Centre de marque</Link>
        <Link href="/brand-center/guides" className="inline-block text-sm text-slate-500 hover:text-teal-700 hover:underline">
          Guides d&apos;installation des signatures →
        </Link>
      </div>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Sommaire</h2>
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm sm:grid-cols-2">
          {sections.map(({ section, affectedByIncompleteness }) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-teal-700 hover:underline">{section.title}</a>
              {affectedByIncompleteness && (
                <span className="ml-2 text-xs text-amber-700">marque incomplète</span>
              )}
            </li>
          ))}
        </ol>

        <div className={readiness.complete
          ? "mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-800"
          : "mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"}>
          <p className="font-medium">Complétude de la marque : {readiness.summary}.</p>
          {readiness.complete ? (
            <p className="mt-1">
              Tous les éléments sont fournis : les livrables se génèrent sans avertissement et un
              modèle peut être publié.
            </p>
          ) : (
            <>
              <p className="mt-1">
                Tant que ces éléments manquent, les livrables signalent « Marque incomplète » et
                aucun modèle ne peut être publié :
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {readiness.missing.map((m) => (
                  <li key={m.label}><span className="font-medium">{m.label}</span> — {m.evidence}</li>
                ))}
              </ul>
              <p className="mt-1">
                Disposer de l&apos;autorisation ne rend pas la marque complète : ces éléments doivent
                être fournis puis saisis.
              </p>
            </>
          )}
        </div>
      </section>

      {sections.map(({ section, affectedByIncompleteness }) => (
        <section key={section.id} id={section.id} className="surface scroll-mt-6 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">{section.title}</h2>
            {affectedByIncompleteness && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                Dépend de la complétude de la marque
              </span>
            )}
          </div>

          {affectedByIncompleteness && (
            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              La marque n&apos;est pas complète ({readiness.summary}) : cette activité reste possible,
              mais elle signalera « Marque incomplète », et la publication d&apos;un modèle est refusée
              tant que les éléments manquants ne sont pas fournis.
            </p>
          )}

          <p className="mt-2 text-sm text-slate-600"><span className="font-medium text-navy-900">Qui :</span> {section.audience}</p>
          <p className="text-sm text-slate-600"><span className="font-medium text-navy-900">Quand :</span> {section.when}</p>
          {section.route && (
            <p className="mt-1 text-sm">
              <Link href={section.route} className="text-teal-700 hover:underline">Ouvrir l&apos;espace de travail →</Link>
            </p>
          )}

          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Étapes</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              {section.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>

          <Block title="Éléments nécessaires" items={section.needs} />
          <Block title="Ce que la plateforme fait toute seule" items={section.automatic} />
          <Block title="Ce qui se fait ailleurs" items={section.elsewhere} />
          <Block title="À définir par Effitrans" items={section.toSupply} />
        </section>
      ))}

      <p className="text-xs text-slate-400">
        Ce guide décrit le Centre de marque tel qu&apos;il fonctionne aujourd&apos;hui. La complétude
        affichée est recalculée à chaque ouverture, à partir des informations réellement saisies et
        des ressources réellement publiées.
      </p>
    </div>
  );
}
