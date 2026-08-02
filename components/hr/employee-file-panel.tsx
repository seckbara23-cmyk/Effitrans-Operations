"use client";

/**
 * HR-3 — the Employee File: Documents + Contrats panels. Server actions
 * re-check everything; this hides only what the server would refuse.
 * Downloads go through server-minted 60s signed URLs — never a stored URL.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadEmployeeDocument, getEmployeeDocumentUrl, deleteEmployeeDocument,
  createEmployeeContract, verifyEmployeeContract, endEmployeeContract,
} from "@/lib/hr/employee-file-actions";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
type DocType = Tbl["hr_document_type"]["Row"];
type Doc = Tbl["hr_document"]["Row"] & { type: DocType | null };
type Contract = Tbl["employment_contract"]["Row"];

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée.",
  invalid_input: "Fichier ou type manquant.",
  too_large: "Fichier trop volumineux (15 Mo max).",
  invalid_type: "Type de document invalide.",
  invalid_kind: "Type de contrat hors du vocabulaire configuré (CDI/CDD/STAGE par défaut).",
  invalid_date: "Date invalide (AAAA-MM-JJ).",
  wrong_status: "État du contrat incompatible avec cette action.",
  same_actor: "Visa à quatre yeux : le vérificateur doit être différent du préparateur.",
  not_found: "Introuvable.",
  event_failed: "L'événement de journal n'a pas pu être écrit — l'action a été annulée.",
  upload_failed: "Échec du téléversement.",
  url_failed: "Lien de téléchargement indisponible.",
  save_failed: "Échec de l'enregistrement.",
};

const CONTRACT_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon (à vérifier)", VERIFIED: "Vérifié", ENDED: "Terminé",
};

export function EmployeeFilePanel({
  employeeId, documents, contracts, docTypes, canManage, currentUserId,
}: {
  employeeId: string; documents: Doc[]; contracts: Contract[];
  docTypes: DocType[]; canManage: boolean; currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState("");
  const [expiry, setExpiry] = useState("");
  const [kind, setKind] = useState("CDI");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; url?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else if (res.url) window.open(res.url, "_blank", "noopener");
      else router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 lg:col-span-2" role="alert">{error}</p>}

      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Documents</h2>
        {documents.length === 0 ? <p className="text-sm text-slate-500">Aucun document.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-navy-900">{d.type?.label_fr ?? "—"}</span>
                <span className="text-xs text-slate-400">{d.title}</span>
                {d.expiry_date && <span className="text-xs text-amber-700">exp. {d.expiry_date}</span>}
                <button disabled={pending} onClick={() => run(() => getEmployeeDocumentUrl(d.id))}
                  className="text-xs text-teal-700 hover:underline">Télécharger</button>
                {canManage && (
                  <button disabled={pending} onClick={() => run(() => deleteEmployeeDocument(d.id))}
                    className="text-xs text-red-600 hover:underline">Retirer</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form className="mt-3 space-y-2 border-t border-slate-100 pt-3"
            action={(fd) => { fd.set("employeeId", employeeId); fd.set("documentTypeId", typeId); fd.set("expiryDate", expiry); run(() => uploadEmployeeDocument(fd)); }}>
            <div className="flex flex-wrap gap-2">
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type de document">
                <option value="">— Type —</option>
                {docTypes.map((t) => <option key={t.id} value={t.id}>{t.label_fr}</option>)}
              </select>
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Date d'expiration (optionnelle)" />
              <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png"
                className="text-sm text-slate-600" aria-label="Fichier" />
            </div>
            <button disabled={pending || !typeId} type="submit"
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Ajouter le document
            </button>
          </form>
        )}
      </section>

      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Contrats</h2>
        {contracts.length === 0 ? <p className="text-sm text-slate-500">Aucun contrat enregistré.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium text-navy-900">{c.contract_kind}</span>
                <span className="tabular text-xs text-slate-400">{c.start_date}{c.end_date ? ` → ${c.end_date}` : ""}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  c.status === "VERIFIED" ? "bg-teal-50 text-teal-700" : c.status === "ENDED" ? "bg-slate-200 text-slate-600" : "bg-amber-50 text-amber-800"}`}>
                  {CONTRACT_STATUS_FR[c.status] ?? c.status}
                </span>
                {canManage && c.status === "DRAFT" && (
                  c.prepared_by === currentUserId
                    ? <span className="text-xs text-slate-400" title="Visa à quatre yeux">vérification par un autre titulaire</span>
                    : <button disabled={pending} onClick={() => run(() => verifyEmployeeContract(c.id))}
                        className="text-xs text-teal-700 hover:underline">Vérifier</button>
                )}
                {canManage && c.status !== "ENDED" && (
                  <button disabled={pending} onClick={() => run(() => endEmployeeContract(c.id))}
                    className="text-xs text-red-600 hover:underline">Terminer</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap gap-2">
              <input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="CDI / CDD / STAGE"
                className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type de contrat" />
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Début" />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Fin (CDD)" />
            </div>
            <button disabled={pending || !startDate}
              onClick={() => run(() => createEmployeeContract({ employeeId, contractKind: kind, startDate, endDate: endDate || null }))}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Enregistrer le contrat
            </button>
            <p className="text-[11px] text-slate-400">Un contrat est préparé puis vérifié par un autre titulaire (visa à quatre yeux).</p>
          </div>
        )}
      </section>
    </div>
  );
}
