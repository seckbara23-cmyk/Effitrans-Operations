"use client";
/**
 * Generated-artifact panel (Phase WES-4H). Client component.
 * ---------------------------------------------------------------------------
 * The operator surface for Category-B artifacts: what exists, whether it can be
 * produced, and what is missing when it cannot.
 *
 * It calls `generateArtifact` and nothing else — no generation logic lives
 * here. The server re-checks authority, re-reads the source and refuses on its
 * own terms; these controls are convenience, and their visibility is never the
 * authorization.
 *
 * The missing-field list is the part that earns its place. Before it, an
 * operator facing a refusal had no way to learn WHICH fact was absent, and the
 * only recourse was to guess at the transport record until the button worked.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateArtifact } from "@/lib/documents/artifacts/actions";
import { createDocumentDownloadUrl } from "@/lib/documents/actions";
import type { ArtifactPanelItem } from "@/lib/documents/artifacts/service";

const ERRORS_FR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de générer ce document.",
  not_found: "Dossier introuvable.",
  artifact_not_generatable: "Ce document n'est pas généré par la plateforme.",
  incomplete_source: "Données insuffisantes — complétez le dossier puis régénérez.",
  render_failed: "La génération a échoué.",
  storage_failed: "L'enregistrement du fichier a échoué.",
  finalize_failed: "La génération a échoué et n'a rien enregistré.",
};

const frDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function ArtifactPanel({
  fileId,
  items,
  canGenerate,
}: {
  fileId: string;
  items: ArtifactPanelItem[];
  /** Mirrors the server's `transport:manage` gate. Never the authorization. */
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<Record<string, string>>({});
  const [openVersions, setOpenVersions] = useState<string | null>(null);

  if (items.length === 0) return null;

  function generate(artifactCode: string) {
    setError((e) => ({ ...e, [artifactCode]: "" }));
    startTransition(async () => {
      const res = await generateArtifact({ fileId, artifactCode });
      if (!res.ok) {
        setError((e) => ({ ...e, [artifactCode]: ERRORS_FR[res.error] ?? ERRORS_FR.render_failed }));
        return;
      }
      router.refresh();
    });
  }

  function download(documentId: string) {
    startTransition(async () => {
      const res = await createDocumentDownloadUrl(documentId);
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener");
    });
  }

  return (
    <section className="surface overflow-hidden">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
        Documents générés
      </h2>

      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.artifactCode} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-navy-900">{item.labelFr}</p>
              {item.current ? (
                <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                  Version {item.current.version} · courante
                </span>
              ) : (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  Aucune version
                </span>
              )}
            </div>

            {/* Provenance of the CURRENT version. */}
            {item.current && (
              <p className="mt-1 text-xs text-slate-500">
                Généré par {item.current.generatedByName ?? "—"} le{" "}
                {frDateTime(item.current.generatedAt)}
                {item.current.rendererVersion && (
                  <span className="text-slate-400"> · moteur {item.current.rendererVersion}</span>
                )}
              </p>
            )}

            {/* WHY generation is unavailable — the exact fields, not a vague refusal. */}
            {!item.sourceComplete && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs font-medium text-amber-900">
                  Données insuffisantes pour générer ce document.
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {item.missing.map((m) => (
                    <li
                      key={m.field}
                      className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-amber-800"
                    >
                      {m.labelFr}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-amber-700">
                  Corrigez le dossier, puis générez — ce document ne peut pas être téléversé
                  manuellement.
                </p>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canGenerate && (
                <button
                  onClick={() => generate(item.artifactCode)}
                  disabled={pending || !item.sourceComplete}
                  className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
                >
                  {pending ? "…" : item.current ? "Régénérer" : "Générer"}
                </button>
              )}

              {item.current && (
                <button
                  onClick={() => download(item.current!.id)}
                  disabled={pending}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Télécharger la version courante
                </button>
              )}

              {item.previous.length > 0 && (
                <button
                  onClick={() =>
                    setOpenVersions(openVersions === item.artifactCode ? null : item.artifactCode)
                  }
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Voir les versions précédentes ({item.previous.length})
                </button>
              )}
            </div>

            {/* Superseded versions stay readable — history is not deleted. */}
            {openVersions === item.artifactCode && (
              <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                {item.previous.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="tabular text-slate-400">v{v.version}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                      Remplacée
                    </span>
                    <span className="text-slate-500">
                      {v.generatedByName ?? "—"} · {frDateTime(v.generatedAt)}
                    </span>
                    <button
                      onClick={() => download(v.id)}
                      disabled={pending}
                      className="ml-auto text-teal-700 hover:underline disabled:opacity-50"
                    >
                      Télécharger
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error[item.artifactCode] && (
              <p className="mt-2 text-xs text-red-700">{error[item.artifactCode]}</p>
            )}
          </li>
        ))}
      </ul>

      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        Ces documents sont produits à partir des données structurées du dossier. Une correction se
        fait sur le dossier, puis par régénération : le téléversement manuel est refusé. Chaque
        régénération crée une nouvelle version ; les précédentes restent consultables.
      </p>
    </section>
  );
}
