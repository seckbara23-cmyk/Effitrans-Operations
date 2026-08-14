"use client";

/**
 * HR imports studio (client). HR-1 built the pipeline to READY; HR-B3 gives it
 * the whole employee journey: downloadable .xlsx template, Excel/CSV upload,
 * readable per-row errors, the honest waiting state when only one HR Officer
 * exists, the APPLY control after the visa, and the import report mapping each
 * spreadsheet row to its generated matricule.
 *
 * The four-eyes rule is unchanged and stated: the submitter cannot approve
 * their own batch. Every action re-checks server-side.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  stageHrImportFile,
  validateHrImport,
  submitHrImport,
  approveHrImport,
  rejectHrImport,
  applyHrImport,
} from "@/lib/hr/organization-actions";
import type { Database } from "@/lib/db/types";

type HrImportBatch = Database["public"]["Tables"]["hr_import_batch"]["Row"];
export type ImportErrorLine = { batch_id: string; row: number; message_fr: string };
export type ImportOutcomeLine = {
  batch_id: string; row: number; outcome: string | null; reason: string | null;
  employee_number: string | null; employee_name: string | null;
};

const KINDS = [
  { value: "EMPLOYEES", label: "Employés", fields: "modèle Excel fourni — correspondance automatique" },
  { value: "ORG_UNITS", label: "Unités d'organisation", fields: "name, unit_kind, code?, parent_code?, canonical_department?" },
  { value: "POSITIONS", label: "Postes", fields: "title, code?, description?" },
  { value: "WORK_LOCATIONS", label: "Sites de travail", fields: "name, city?" },
] as const;

const STATUS_FR: Record<string, string> = {
  STAGED: "Préparé",
  VALIDATED: "Validé",
  SUBMITTED: "Soumis (visa en attente)",
  READY: "PRÊT — visa obtenu",
  REJECTED: "Rejeté",
  CANCELLED: "Annulé",
  APPLYING: "Application en cours…",
  APPLIED: "Appliqué",
  APPLIED_WITH_ERRORS: "Appliqué avec erreurs",
};

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  empty_file: "Le fichier est vide ou ne contient pas d'en-tête.",
  file_too_large: "Fichier trop volumineux (max 2 Mo).",
  too_many_rows: "Trop de lignes (max 2 000 par lot).",
  unreadable_file: "Fichier illisible — utilisez le modèle Excel fourni ou un CSV.",
  stage_failed: "Échec de la préparation.",
  wrong_status: "Le lot n'est pas dans l'état requis pour cette action.",
  wrong_kind: "L'application ne concerne que les lots d'employés.",
  has_errors: "Le lot contient des erreurs de validation — corrigez le fichier et re-préparez.",
  same_actor: "Visa à quatre yeux : l'approbateur doit être différent du soumetteur.",
  not_found: "Lot introuvable.",
  reason_required: "Le motif de rejet est obligatoire.",
  save_failed: "Échec de l'enregistrement.",
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function HrImportStudio({
  batches,
  currentUserId,
  hrOfficerCount,
  errors,
  outcomes,
}: {
  batches: HrImportBatch[];
  currentUserId: string;
  hrOfficerCount: number;
  errors: ImportErrorLine[];
  outcomes: ImportOutcomeLine[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("EMPLOYEES");
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
    void file.arrayBuffer().then((buf) => {
      run(() => stageHrImportFile({ importKind: kind, filename: file.name, base64: toBase64(buf) }));
    });
  };

  /** "champ=EnTête" pairs → mapping object. Empty = auto (template headers for
   *  EMPLOYEES; identity for the master-data kinds). */
  const parseMapping = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const pair of mappingText.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [field, header] = pair.split("=").map((s) => s.trim());
      if (field && header) map[field] = header;
    }
    if (Object.keys(map).length === 0 && kind !== "EMPLOYEES") {
      for (const f of KINDS.find((k) => k.value === kind)!.fields.split(",").map((s) => s.trim().replace("?", ""))) {
        map[f] = f;
      }
    }
    return map;
  };

  const errorsFor = (batchId: string) => errors.filter((e) => e.batch_id === batchId);
  const outcomesFor = (batchId: string) => outcomes.filter((o) => o.batch_id === batchId);

  const exportReportCsv = (b: HrImportBatch) => {
    const lines = [
      "ligne;matricule;employe;resultat;detail",
      ...outcomesFor(b.id).map((o) =>
        [o.row, o.employee_number ?? "", o.employee_name ?? "", o.outcome ?? "", o.reason ?? ""].join(";"),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-import-${b.batch_number}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="surface space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-navy-900">Nouveau lot (Excel ou CSV)</h2>
          <a href="/departments/hr/imports/template"
            className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-100">
            Télécharger le modèle Excel
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <span className="text-xs text-slate-400">Colonnes : {KINDS.find((k) => k.value === kind)!.fields}</span>
        </div>
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={pending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800"
        />
        {kind !== "EMPLOYEES" && (
          <label className="block text-xs text-slate-500">
            Correspondance des colonnes (optionnel, « champ=EnTête » séparés par des virgules ; vide = identité)
            <input value={mappingText} onChange={(e) => setMappingText(e.target.value)} placeholder="name=Nom, unit_kind=Type"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
        )}
        {kind === "EMPLOYEES" && (
          <p className="text-xs text-slate-500">
            Les matricules (EMP-0001, …) sont attribués par la plateforme à l&apos;application — jamais fournis
            par le fichier. La création d&apos;un employé n&apos;ouvre aucun compte applicatif et n&apos;accorde aucun droit.
          </p>
        )}
      </section>

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Lots</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun lot préparé.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {batches.map((b) => {
              const batchErrors = errorsFor(b.id);
              const batchOutcomes = outcomesFor(b.id);
              const readyRows = b.row_count - b.error_count;
              return (
                <li key={b.id} className="space-y-1.5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-teal-700">{b.batch_number}</span>
                    <span className="text-slate-600">{KINDS.find((k) => k.value === b.import_kind)?.label ?? b.import_kind}</span>
                    <span className="text-xs text-slate-400">{b.source_filename ?? "—"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      b.status === "READY" || b.status === "APPLIED" ? "bg-teal-50 text-teal-700"
                      : b.status === "REJECTED" || b.status === "CANCELLED" || b.status === "APPLIED_WITH_ERRORS" ? "bg-red-50 text-red-700"
                      : "bg-slate-100 text-slate-600"}`}>
                      {STATUS_FR[b.status] ?? b.status}
                    </span>
                  </div>

                  {/* HR-B3 — the preview summary, in the required shape. */}
                  {["VALIDATED", "SUBMITTED", "READY"].includes(b.status) && (
                    <p className="text-xs text-slate-600">
                      {b.row_count} ligne(s) détectée(s) · <span className="text-teal-700">{readyRows} prête(s) à importer</span>
                      {b.error_count > 0 && <> · <span className="text-red-600">{b.error_count} à corriger</span></>}
                    </p>
                  )}
                  {b.status === "STAGED" && (
                    <p className="text-xs text-slate-500">{b.row_count} ligne(s) détectée(s) — lancez la validation.</p>
                  )}

                  {batchErrors.length > 0 && ["VALIDATED", "STAGED"].includes(b.status) && (
                    <ul className="space-y-0.5 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                      {batchErrors.slice(0, 20).map((e, i) => (
                        <li key={i}>Ligne {e.row} — {e.message_fr}</li>
                      ))}
                      {batchErrors.length > 20 && <li>… et {batchErrors.length - 20} autre(s).</li>}
                    </ul>
                  )}

                  {/* The honest waiting state instead of a mysterious failure. */}
                  {b.status === "SUBMITTED" && b.submitted_by === currentUserId && hrOfficerCount < 2 && (
                    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                      En attente du visa d&apos;un second responsable RH — désignez le second titulaire via
                      l&apos;Administration pour débloquer l&apos;approbation.
                    </p>
                  )}

                  {/* The import report: which row became which employee. */}
                  {(b.status === "APPLIED" || b.status === "APPLIED_WITH_ERRORS") && (
                    <div className="space-y-1 rounded-lg bg-slate-50 p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-navy-900">
                          {b.applied_count} employé(s) importé(s){b.failed_count > 0 && <span className="text-red-600"> · {b.failed_count} en échec</span>}
                        </p>
                        {batchOutcomes.length > 0 && (
                          <button type="button" onClick={() => exportReportCsv(b)} className="text-xs text-teal-700 hover:underline">
                            Exporter le rapport (CSV)
                          </button>
                        )}
                      </div>
                      {batchOutcomes.length > 0 && (
                        <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                          {batchOutcomes.map((o, i) => (
                            <li key={i}>
                              Ligne {o.row} — {o.outcome === "CREATED"
                                ? <><span className="font-mono text-teal-700">{o.employee_number}</span> {o.employee_name}{o.reason ? ` (${o.reason})` : ""}</>
                                : <span className="text-red-600">échec : {o.reason ?? "—"}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

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
                    {(b.status === "READY" || b.status === "APPLIED_WITH_ERRORS") && b.import_kind === "EMPLOYEES" && (
                      <button disabled={pending} onClick={() => run(() => applyHrImport(b.id))}
                        className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                        {b.status === "READY" ? "Appliquer l'import" : "Réessayer les lignes en échec"}
                      </button>
                    )}
                    {b.status === "READY" && b.import_kind !== "EMPLOYEES" && (
                      <span className="text-xs text-slate-400">L&apos;application de ce type de lot sera activée dans une phase ultérieure.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
