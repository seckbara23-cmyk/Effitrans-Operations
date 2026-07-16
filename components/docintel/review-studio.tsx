"use client";

/**
 * Document Intelligence — human review studio (Phase 7.4A). Client component. Drives the
 * whole flow: create job → run extraction (operator-provided text) → review each candidate →
 * apply approved fields. NOTHING applies automatically; low-confidence/conflicting fields need
 * explicit review; edits are recorded as human edits; apply asks for confirmation.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIntelligenceJob, runExtraction, extractSearchablePdf, reviewField, applyFields } from "@/lib/docintel/actions";
import { fieldSchema } from "@/lib/docintel/schemas";
import { isBatchApprovable, confidenceLabel } from "@/lib/docintel/confidence";
import { jobStatusLabel } from "@/lib/docintel/lifecycle";
import { docClassLabel, type DocClass } from "@/lib/docintel/types";
import type { JobView, CandidateView } from "@/lib/docintel/service";

const CONF: Record<string, string> = { HIGH: "bg-teal-50 text-teal-700", MEDIUM: "bg-amber-50 text-amber-700", LOW: "bg-slate-100 text-slate-500", UNKNOWN: "bg-slate-100 text-slate-400" };
const VAL: Record<string, string> = { VALID: "text-teal-700", CONFLICT: "text-red-600", INVALID_FORMAT: "text-red-600" };
const ERR: Record<string, string> = { forbidden: "Non autorisé.", not_found: "Introuvable.", not_queued: "Extraction déjà lancée.", document_changed: "Le fichier a changé — un nouveau job est requis.", UNSUPPORTED_FILE: "Fichier non pris en charge (PDF requis) ou aucun texte.", NOT_CONFIGURED: "Fournisseur non configuré.", UNSUPPORTED_DOCUMENT: "Type de document non pris en charge.", OCR_REQUIRED: "PDF scanné / image — aucune couche texte. L'OCR n'est pas connecté ; utilisez la saisie manuelle.", TOO_LARGE: "Fichier trop volumineux ou trop de pages.", TIMEOUT: "Délai d'extraction dépassé.", PROVIDER_ERROR: "Lecture du PDF impossible.", INVALID_RESPONSE: "Réponse d'extraction invalide.", invalid_decision: "Décision invalide.", invalid_value: "Valeur invalide.", stale_job: "Le job a changé — rechargez.", generic: "Erreur." };

export function ReviewStudio({ documentId, job, candidates, docClass, canParsePdf = false }: { documentId: string; job: JobView | null; candidates: CandidateView[]; docClass: DocClass; canParsePdf?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setMsg(null);
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[r.error ?? "generic"] ?? r.error ?? ERR.generic }); if (r.ok) router.refresh(); });
  }

  if (!job) {
    return (
      <section className="surface space-y-3 p-4">
        <h2 className="text-sm font-semibold text-navy-900">Extraction intelligente</h2>
        <p className="text-xs text-slate-500">Aucun job d&apos;extraction. Les suggestions IA/OCR ne modifient jamais un enregistrement sans revue et application explicites.</p>
        <button onClick={() => run(() => createIntelligenceJob(documentId))} disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Créer un job d&apos;extraction</button>
        {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
      </section>
    );
  }

  const approvable = candidates.filter((c) => c.reviewDecision === "PENDING" && isBatchApprovable({ confidence: c.confidence, validationStatus: c.validationStatus, reconciliationStatus: c.reconciliationStatus }));
  const applyable = candidates.filter((c) => (c.reviewDecision === "APPROVED" || c.reviewDecision === "EDITED") && c.applicationTarget && c.applicationResult !== "APPLIED");

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-navy-900">Extraction intelligente</h2>
        <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">{jobStatusLabel(job.status)}</span>
        <span className="text-xs text-slate-500">Classe : {docClassLabel(docClass)}</span>
        <span className="text-xs text-slate-400">Fournisseur : {job.providerCode} · v{job.jobVersion}</span>
      </div>

      {job.status === "QUEUED" && (
        <div className="space-y-3">
          {canParsePdf && (
            <div className="space-y-1 rounded-md border border-teal-100 bg-teal-50/50 p-3">
              <p className="text-xs text-teal-800">PDF avec couche texte : extraction locale (aucun OCR, aucun envoi externe). Un PDF scanné/image renverra <span className="font-medium">OCR requis</span>.</p>
              <button onClick={() => run(() => extractSearchablePdf(job.id))} disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Extraire le texte du PDF</button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); run(() => runExtraction(job.id, text)); }} className="space-y-2">
            <p className="text-xs text-amber-700">Sinon, collez le texte du document (saisie manuelle) pour l&apos;extraction déterministe. Aucun OCR/IA n&apos;est connecté.</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Texte du document…" className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" />
            <button type="submit" disabled={pending || !text.trim()} className="rounded-lg border border-navy-200 px-3 py-2 text-sm font-medium text-navy-800 disabled:opacity-50">Lancer l&apos;extraction déterministe (texte)</button>
          </form>
        </div>
      )}

      {job.status === "FAILED" && (
        <p className="text-xs text-red-600">{job.failureCategory === "OCR_REQUIRED" ? ERR.OCR_REQUIRED : `Extraction échouée (${job.failureCategory ?? "erreur"}). Un nouveau job est requis.`}</p>
      )}

      {job.predictedClass && job.declaredClass && job.predictedClass !== job.declaredClass && (
        <p className="text-xs text-amber-700">Conflit de classification : déclaré <span className="font-medium">{docClassLabel(job.declaredClass)}</span>, détecté <span className="font-medium">{docClassLabel(job.predictedClass)}</span>. La classe déclarée reste retenue — confirmez si besoin.</p>
      )}

      {["READY_FOR_REVIEW", "PARTIALLY_APPROVED", "APPROVED", "APPLIED"].includes(job.status) && (
        <>
          {candidates.length === 0 ? <p className="text-xs text-slate-500">Aucun champ candidat.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Champ</th><th className="px-3 py-2">Valeur candidate</th><th className="px-3 py-2">Confiance</th><th className="px-3 py-2">Validation</th><th className="px-3 py-2">Cohérence</th><th className="px-3 py-2">Décision</th><th className="px-3 py-2">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map((c) => {
                    const label = fieldSchema(docClass, c.fieldKey)?.labelFr ?? c.fieldKey;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60 align-top">
                        <td className="px-3 py-2 font-medium text-navy-800">{label}{c.applicationTarget && <span className="ml-1 text-[10px] text-slate-400">→ {c.applicationTarget}</span>}</td>
                        <td className="px-3 py-2 text-slate-700"><input defaultValue={c.editedValue ?? c.displayedValue ?? ""} onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value }))} className="w-40 rounded border border-slate-200 px-1.5 py-0.5 text-xs" />{c.evidence && <div className="mt-0.5 max-w-[200px] truncate text-[10px] text-slate-400">« {c.evidence} »</div>}</td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${CONF[c.confidence]}`}>{confidenceLabel(c.confidence)}</span></td>
                        <td className={`px-3 py-2 text-xs ${VAL[c.validationStatus] ?? "text-slate-500"}`}>{c.validationStatus}</td>
                        <td className={`px-3 py-2 text-xs ${c.reconciliationStatus === "CONFLICT" ? "text-red-600" : c.reconciliationStatus === "AGREEMENT" ? "text-teal-700" : "text-slate-400"}`}>{c.reconciliationStatus ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{c.reviewDecision}{c.applicationResult ? ` · ${c.applicationResult}` : ""}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button onClick={() => run(() => reviewField(c.id, "APPROVED"))} disabled={pending} className="rounded border border-teal-200 px-1.5 py-0.5 text-[11px] text-teal-700 hover:bg-teal-50">Approuver</button>
                            <button onClick={() => run(() => reviewField(c.id, "EDITED", edits[c.id] ?? c.displayedValue ?? ""))} disabled={pending} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-navy-700 hover:bg-slate-50">Éditer</button>
                            <button onClick={() => run(() => reviewField(c.id, "REJECTED"))} disabled={pending} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50">Rejeter</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button onClick={() => run(async () => { for (const c of approvable) { await reviewField(c.id, "APPROVED"); } return { ok: true }; })} disabled={pending || approvable.length === 0} className="rounded-md border border-teal-200 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">Approuver {approvable.length} champ(s) sûr(s)</button>
            <button onClick={() => { if (applyable.length && confirm(`Appliquer ${applyable.length} champ(s) approuvé(s) aux enregistrements ?`)) run(() => applyFields(job.id, applyable.map((c) => c.id))); }} disabled={pending || applyable.length === 0} className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Appliquer {applyable.length} champ(s) approuvé(s)</button>
            <span className="text-xs text-slate-400">Seuls les champs à confiance élevée, valides et sans conflit sont éligibles à l&apos;approbation groupée.</span>
          </div>
        </>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
