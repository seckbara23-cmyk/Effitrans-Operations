/**
 * Historique / Traçabilité — the governed corrections behind the figures.
 *
 * A management module that publishes an indicator must be able to answer « cette
 * donnée a-t-elle changé, et pourquoi ». That answer already exists as an
 * append-only table (`customs_correction`, WORM-triggered), so this tab reads it
 * rather than keeping a second history of its own.
 *
 * Read gate: performance:read (the layout) AND customs:read for the underlying
 * rows, because a correction names a dossier and its values. A performance
 * reader without customs:read is told so instead of shown an empty list.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCustomsCorrections } from "@/lib/customs/corrections";

export const metadata: Metadata = { title: "Historique / Traçabilité" };
export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  sh_position_count: "Positions SH",
  declaration_type: "Type de déclaration",
  dpi_regime: "DPI",
  exemption_title_origin: "Titre d'exonération",
  tariff_classification_origin: "Origine du classement tarifaire",
};

export default async function HistoryPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canReadCustoms = hasPermission(permissions, "customs:read");

  const rows = canReadCustoms ? await listCustomsCorrections(user.tenantId, 100) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="Historique / Traçabilité"
        subtitle="Corrections gouvernées des données douanières validées."
      />

      {!canReadCustoms ? (
        <div className="surface p-6 text-sm text-slate-500">
          La traçabilité porte sur des données douanières nominatives. Sa consultation demande
          l&apos;autorisation <code className="text-xs">customs:read</code>, que votre profil ne
          porte pas.
        </div>
      ) : rows.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucune correction enregistrée. Une donnée douanière validée ne change que par cette voie,
          donc cette liste est exhaustive.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <article key={c.id} className="surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-xs text-navy-900">{c.fileNumber}</p>
                <p className="text-[11px] text-slate-400">
                  {new Date(c.correctedAt).toLocaleString("fr-FR")} — {c.correctedByEmail ?? "—"}
                </p>
              </div>
              <p className="mt-2 text-xs text-slate-700">
                <span className="font-medium">Motif :</span> {c.reason}
              </p>
              <ul className="mt-2 space-y-1">
                {Object.entries(c.changes).map(([field, v]) => (
                  <li key={field} className="text-xs text-slate-600">
                    {FIELD_LABEL[field] ?? field} :{" "}
                    <span className="rounded bg-red-50 px-1 font-mono text-red-700">
                      {v.old ?? "—"}
                    </span>{" "}
                    →{" "}
                    <span className="rounded bg-teal-50 px-1 font-mono text-teal-700">
                      {v.new ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">
                Certification déplacée : validée le{" "}
                {new Date(c.validatedAtBefore).toLocaleDateString("fr-FR")} par{" "}
                {c.validatedByBeforeEmail ?? "—"}
                {c.revalidated ? " — recertifiée depuis." : " — en attente de revalidation."}
              </p>
            </article>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Cet historique est en ajout seul : un déclencheur en base refuse toute modification et toute
        suppression. Les valeurs « avant » sont lues par la base au moment de la correction, jamais
        déclarées par l&apos;interface.
      </p>
    </div>
  );
}
