"use client";

/**
 * CEO-ALIGNMENT WP1-E — « Modifier l'échéance » on a document row.
 * ---------------------------------------------------------------------------
 * Draws what the server would accept, decides nothing itself:
 *   * unverified document + `document:update` → « Modifier l'échéance »
 *   * verified document   + `document:update` → « Proposer une nouvelle échéance »
 *   * an open proposal    + `document:approve`, and NOT its author
 *                                               → « Confirmer » / « Refuser »
 * Both actions re-check everything; the database re-checks it again.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestDocumentExpiryChange,
  decideDocumentExpiryChange,
} from "@/lib/documents/expiry-actions";
import { expiryHistoryLineFr, expiryMessageFr, expiryTierFor } from "@/lib/documents/expiry-change";
import type { DocumentItem } from "@/lib/documents/types";

const btn =
  "rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50";

export function ExpiryControl({
  doc,
  canUpdate,
  canApprove,
  currentUserId,
}: {
  doc: DocumentItem;
  canUpdate: boolean;
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(doc.expiryDate ?? "");
  const [reason, setReason] = useState("");
  const [refuseReason, setRefuseReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const tier = expiryTierFor(doc.status);
  const proposal = doc.pendingExpiryProposal ?? null;
  const history = doc.expiryHistory ?? [];
  const mayDecide = !!proposal && canApprove && proposal.proposerId !== currentUserId;

  function run(fn: () => Promise<{ ok: true; outcome: string } | { ok: false; error: string }>) {
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setMessage({ tone: "error", text: expiryMessageFr(res.error) });
        return;
      }
      setMessage({ tone: "ok", text: expiryMessageFr(res.outcome) });
      setEditing(false);
      setReason("");
      setRefuseReason("");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1 text-xs">
      {proposal && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
          Échéance proposée : {proposal.newExpiry ?? "aucune"} (actuelle : {proposal.oldExpiry ?? "aucune"}) —
          par {proposal.proposerEmail ?? "—"}. Motif : {proposal.reason ?? "—"}.{" "}
          {mayDecide ? null : (
            <span className="text-amber-800">En attente de confirmation par un autre vérificateur.</span>
          )}
          {mayDecide && (
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => decideDocumentExpiryChange(proposal.id, { decision: "CONFIRMED" }))}
                className={`${btn} border-teal-200 bg-white text-teal-700 hover:bg-teal-50`}
              >
                Confirmer
              </button>
              <input
                value={refuseReason}
                onChange={(e) => setRefuseReason(e.target.value)}
                placeholder="Motif du refus (obligatoire)"
                maxLength={500}
                className="min-w-[14rem] flex-1 rounded-md border border-slate-200 px-2 py-1"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => decideDocumentExpiryChange(proposal.id, { decision: "REJECTED", reason: refuseReason }))
                }
                className={`${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
              >
                Refuser
              </button>
            </span>
          )}
        </div>
      )}

      {!proposal && canUpdate && tier !== "CLOSED" && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`${btn} border-slate-200 text-navy-700 hover:bg-slate-50`}
        >
          {tier === "PROPOSAL" ? "Proposer une nouvelle échéance" : "Modifier l'échéance"}
        </button>
      )}

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <label className="flex items-center gap-1">
            <span className="text-slate-600">Nouvelle échéance</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1"
            />
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif (obligatoire)"
            maxLength={500}
            className="min-w-[14rem] flex-1 rounded-md border border-slate-200 px-2 py-1"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => requestDocumentExpiryChange(doc.id, { expiryDate: date || null, reason }))}
            className={`${btn} border-teal-200 bg-white text-teal-700 hover:bg-teal-50`}
          >
            Enregistrer
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setDate(doc.expiryDate ?? "");
              setReason("");
            }}
            className={`${btn} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Annuler
          </button>
          {tier === "PROPOSAL" && (
            <p className="w-full text-[11px] text-slate-500">
              Document vérifié : la nouvelle échéance sera proposée, puis appliquée seulement après confirmation par un
              autre vérificateur. Le statut du document ne change pas.
            </p>
          )}
        </div>
      )}

      {message && (
        <p className={message.tone === "ok" ? "text-teal-700" : "text-red-600"}>{message.text}</p>
      )}

      {history.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-slate-500">
          {history.map((h) => (
            <li key={h.id}>{expiryHistoryLineFr(h)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
