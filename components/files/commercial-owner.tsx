"use client";

/**
 * TMS-1 — « Responsable client » (Account Manager). Client component, sibling
 * of file-assignment.tsx — a DIFFERENT concept from the working assignee, and
 * the ratified workflow invariant on one screen:
 *
 *   dossier créé → « À affecter » → le Responsable des opérations désigne le
 *   Responsable client → celui-ci coordonne le dossier → remplacement possible
 *   tant que le dossier est ouvert, avec motif et historique immuable.
 *
 * The picker renders only for holders of the assignment authority; every rule
 * (target active, terminal refusal, reason requirement, owner never vacated)
 * is re-checked server-side and again in the database. No code, no SQLSTATE
 * on screen — refusals arrive as French sentences.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignCommercialOwner } from "@/lib/files/actions";
import type { StaffOption } from "@/lib/files/types";
import type { CommercialOwnerHistoryRow } from "@/lib/files/service";
import { SELECTABLE_REASON_CODES, ASSIGNMENT_REASON_LABELS_FR } from "@/lib/workflow/access/vocabulary";

const ERR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorité pour désigner le Responsable client.",
  actor_invalid: "Votre compte n'est plus actif dans cette organisation.",
  not_found: "Dossier introuvable.",
  owner_required: "Le Responsable client ne peut pas être retiré sans remplaçant.",
  owner_unchanged: "Ce Responsable client est déjà désigné.",
  invalid_assignee: "La personne choisie n'est pas un compte actif de l'organisation.",
  file_terminal: "Le dossier est clôturé ou annulé : le Responsable client ne peut plus changer.",
  reason_required: "Un remplacement exige un motif détaillé.",
  assign_failed: "La désignation a échoué.",
};

export function CommercialOwner({
  fileId, ownerId, ownerLabel, history, staff, canAssign, isTerminal,
}: {
  fileId: string;
  ownerId: string | null;
  ownerLabel: string | null;
  history: CommercialOwnerHistoryRow[];
  staff: StaffOption[];
  canAssign: boolean;
  isTerminal: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [reasonCode, setReasonCode] = useState("REASSIGNMENT");
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const initial = ownerId === null;
  const needsReason = !initial;
  const ready = selected !== "" && selected !== (ownerId ?? "") && (!needsReason || reason.trim() !== "");

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await assignCommercialOwner({
        fileId,
        userId: selected,
        reasonCode: initial ? "INITIAL" : reasonCode,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        setError(ERR[res.error ?? ""] ?? ERR.assign_failed);
        return;
      }
      setSelected("");
      setReason("");
      router.refresh();
    });
  };

  return (
    <div className="surface space-y-3 p-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Responsable client</p>
        <p className="text-xs text-slate-500">
          Désigné par le Responsable des opérations ; coordonne le dossier avec les Opérations.
          Le créateur du dossier n&apos;est pas automatiquement Responsable client.
        </p>
      </div>

      <p className="text-sm">
        <span className="text-slate-500">Responsable client : </span>
        {ownerLabel
          ? <strong className="text-navy-900">{ownerLabel}</strong>
          : <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">À affecter</span>}
      </p>

      {canAssign && !isTerminal && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              disabled={pending || staff.length === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-navy-900 focus:border-teal-500 focus:outline-none disabled:opacity-50"
              aria-label="Responsable client à désigner">
              <option value="">— Choisir la personne —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {needsReason && (
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}
                disabled={pending}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-navy-900 disabled:opacity-50"
                aria-label="Motif du remplacement">
                {SELECTABLE_REASON_CODES.map((r) => (
                  <option key={r.value} value={r.value}>{r.labelFr}</option>
                ))}
              </select>
            )}
          </div>
          {needsReason && (
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Motif détaillé du remplacement (obligatoire)"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              aria-label="Motif détaillé" />
          )}
          <button onClick={submit} disabled={pending || !ready}
            className="rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {pending ? "Enregistrement…" : initial ? "Désigner" : "Remplacer"}
          </button>
        </div>
      )}
      {canAssign && isTerminal && (
        <p className="text-xs text-slate-400">
          Dossier clôturé ou annulé : le Responsable client ne peut plus changer.
        </p>
      )}

      {history.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-teal-700 hover:underline">
            {showHistory ? "Masquer l'historique" : `Historique des désignations (${history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {history.map((h, i) => (
                <li key={i}>
                  <span className="tabular text-slate-400">{new Date(h.at).toLocaleDateString("fr-FR")}</span>{" "}
                  — <strong>{h.newUserLabel}</strong>
                  {h.previousUserLabel && <> (remplace {h.previousUserLabel})</>}
                  {" · "}{ASSIGNMENT_REASON_LABELS_FR[h.reasonCode as keyof typeof ASSIGNMENT_REASON_LABELS_FR] ?? h.reasonCode}
                  {h.actorLabel && <> · par {h.actorLabel}</>}
                  {h.provenance === "LEGACY_IMPORT" && <> · <em>reprise d&apos;historique</em></>}
                  {h.reason && <span className="text-slate-400"> — {h.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
