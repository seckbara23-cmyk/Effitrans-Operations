"use client";

/**
 * HR-1 — import staging studio (client). The last transition is READY —
 * there is no "apply" control anywhere, and the approve button is honest
 * about maker-checker: the submitter cannot approve their own batch.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  stageHrImport,
  validateHrImport,
  submitHrImport,
  approveHrImport,
  rejectHrImport,
} from "@/lib/hr/organization-actions";
import type { Database } from "@/lib/db/types";

type HrImportBatch = Database["public"]["Tables"]["hr_import_batch"]["Row"];

const KINDS = [
  { value: "ORG_UNITS", label: "Unités d'organisation", fields: "name, unit_kind, code?, parent_code?, canonical_department?" },
  { value: "POSITIONS", label: "Postes", fields: "title, code?, description?" },
  { value: "WORK_LOCATIONS", label: "Sites de travail", fields: "name, city?" },
] as const;

const STATUS_FR: Record<string, string> = {
  STAGED: "Préparé",
  VALIDATED: "Validé",
  SUBMITTED: "Soumis (visa en attente)",
  READY: "PRÊT — en attente d'activation",
  REJECTED: "Rejeté",
  CANCELLED: "Annulé",
};

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  empty_file: "Le fichier est vide ou ne contient pas d'en-tête.",
  stage_failed: "Échec de la préparation.",
  wrong_status: "Le lot n'est pas dans l'état requis pour cette action.",
  has_errors: "Le lot contient des erreurs de validation — corrigez le fichier et re-préparez.",
  same_actor: "Visa à quatre yeux : l'approbateur doit être différent du soumetteur.",
  not_found: "Lot introuvable.",
  reason_required: "Le motif de rejet est obligatoire.",
  save_failed: "Échec de l'enregistrement.",
};

export function HrImportStudio({ batches, currentUserId }: { batches: HrImportBatch[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("ORG_UNITS");
  const [mappingText, setMappingText] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  const onUpload = (file: File) => {
    setError(null);
    void file.text().then((text) => {
      run(() => stageHrImport({ importKind: kind, filename: file.name, csvText: text }));
    });
  };

  /** "champ=EnTête" pairs → mapping object; identity mapping when left empty. */
  const parseMapping = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const pair of mappingText.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [field, header] = pair.split("=").map((s) => s.trim());
      if (field && header) map[field] = header;
    }
    if (Object.keys(map).length === 0) {
      for (const f of KINDS.find((k) => k.value === kind)!.fields.split(",").map((s) => s.trim().replace("?", ""))) {
        map[f] = f;
      }
    }
    return map;
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold text-navy-900">Nouveau lot (CSV)</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <span className="text-xs text-slate-400">Colonnes attendues : {KINDS.find((k) => k.value === kind)!.fields}</span>
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800"
        />
        <label className="block text-xs text-slate-500">
          Correspondance des colonnes (optionnel, « champ=EnTête » séparés par des virgules ; vide = identité)
          <input value={mappingText} onChange={(e) => setMappingText(e.target.value)} placeholder="name=Nom, unit_kind=Type"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
      </section>

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Lots</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun lot préparé.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {batches.map((b) => (
              <li key={b.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-teal-700">{b.batch_number}</span>
                  <span className="text-slate-600">{KINDS.find((k) => k.value === b.import_kind)?.label ?? b.import_kind}</span>
                  <span className="text-xs text-slate-400">{b.source_filename ?? "—"} · {b.row_count} ligne(s) · {b.error_count} erreur(s)</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    b.status === "READY" ? "bg-teal-50 text-teal-700"
                    : b.status === "REJECTED" || b.status === "CANCELLED" ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600"}`}>
                    {STATUS_FR[b.status] ?? b.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(b.status === "STAGED" || b.status === "VALIDATED") && (
                    <button disabled={pending} onClick={() => run(() => validateHrImport(b.id, parseMapping()))}
                      className="text-xs text-teal-700 hover:underline">Valider (correspondance + contrôles)</button>
                  )}
                  {b.status === "VALIDATED" && b.error_count === 0 && (
                    <button disabled={pending} onClick={() => run(() => submitHrImport(b.id))}
                      className="text-xs text-teal-700 hover:underline">Soumettre au visa</button>
                  )}
                  {b.status === "SUBMITTED" && (
                    b.submitted_by === currentUserId ? (
                      <span className="text-xs text-slate-400" title="Visa à quatre yeux">Approbation par un autre titulaire de hr:manage</span>
                    ) : (
                      <button disabled={pending} onClick={() => run(() => approveHrImport(b.id))}
                        className="text-xs text-teal-700 hover:underline">Approuver → PRÊT</button>
                    )
                  )}
                  {["STAGED", "VALIDATED", "SUBMITTED"].includes(b.status) && (
                    <button disabled={pending}
                      onClick={() => { const r = window.prompt("Motif du rejet :"); if (r) run(() => rejectHrImport(b.id, r)); }}
                      className="text-xs text-red-600 hover:underline">Rejeter</button>
                  )}
                  {b.status === "READY" && (
                    <span className="text-xs text-slate-400">L'application de ce lot sera activée dans une phase ultérieure.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
