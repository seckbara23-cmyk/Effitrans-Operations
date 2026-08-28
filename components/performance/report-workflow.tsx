"use client";

/**
 * The report's lifecycle controls.
 *
 * Every flag decides what is DRAWN. Each action re-asserts its own permission
 * server-side, and publication additionally re-proves the actor's authority in
 * the database (INV-7) before writing anything — so a user who somehow reached
 * a publish button they should not see is still refused by two layers below it.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateReportNarrative,
  submitReportForReview,
  returnReportToDraft,
  publishReport,
} from "@/lib/performance/report-actions";
import { sayReport } from "@/lib/performance/report-types";
import type { ReportStatus } from "@/lib/performance/report";

export function ReportWorkflow({
  id,
  status,
  executiveSummary,
  managementCommentary,
  canEdit,
  canPublish,
}: {
  id: string;
  status: ReportStatus;
  executiveSummary: string | null;
  managementCommentary: string | null;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState(executiveSummary ?? "");
  const [commentary, setCommentary] = useState(managementCommentary ?? "");

  const frozen = status === "PUBLIE";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(sayReport(res.error));
      else router.refresh();
    });
  }

  if (frozen) {
    return (
      <div className="surface border-l-4 border-teal-500 p-4">
        <p className="text-sm font-medium text-navy-900">Rapport publié — figé</p>
        <p className="mt-1 text-xs text-slate-600">
          Son contenu ne peut plus changer, y compris par un administrateur : la base refuse toute
          modification et toute suppression. Pour une nouvelle analyse de la période, préparez un
          nouveau rapport.
        </p>
      </div>
    );
  }

  return (
    <div className="surface space-y-3 p-4">
      {canEdit ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Synthèse exécutive
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Commentaire de direction
            <textarea
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              rows={3}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                updateReportNarrative(id, {
                  executiveSummary: summary,
                  managementCommentary: commentary,
                }),
              )
            }
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "Enregistrement…" : "Enregistrer le texte"}
          </button>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Lecture seule — la rédaction demande l&apos;autorisation « Gestion de la Performance ».
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {canEdit && status === "BROUILLON" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => submitReportForReview(id))}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Soumettre à la revue
          </button>
        ) : null}

        {canEdit && status === "PRET_POUR_REVUE" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => returnReportToDraft(id))}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Renvoyer en brouillon
          </button>
        ) : null}

        {status === "PRET_POUR_REVUE" && canPublish ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => publishReport(id))}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {pending ? "Publication…" : "Publier et figer"}
          </button>
        ) : null}

        {status === "PRET_POUR_REVUE" && !canPublish ? (
          <p className="text-xs text-slate-500">
            Prêt pour revue. La publication demande le rôle « Publication des rapports de
            performance ».
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
