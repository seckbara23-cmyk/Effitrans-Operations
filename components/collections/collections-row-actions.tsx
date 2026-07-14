"use client";
/**
 * Collections row actions (Phase 5.0D-4). Mutates nothing itself.
 * ---------------------------------------------------------------------------
 * Every button calls a server action. The CLOSE action is separate and
 * permissioned (process:close) — a collector can finish the recovery, but only a
 * supervisor closes the dossier, and the engine refuses with the COMPLETE list of
 * blockers rather than a single opaque "not ready".
 */
import { useState, useTransition } from "react";
import type { CollectionsRow } from "@/lib/collections/service";
import {
  closeDossier,
  completeCollections,
  openDispute,
  recordFollowUp,
  resolveDispute,
} from "@/lib/collections/actions";

const ERROR_FR: Record<string, string> = {
  feature_disabled: "Recouvrement désactivé.",
  forbidden: "Action non autorisée.",
  invoice_missing: "Facture introuvable.",
  collections_not_ready: "Le recouvrement n'est pas terminé.",
  reason_required: "Un motif est obligatoire.",
  invalid_category: "Catégorie de litige invalide.",
  dispute_not_open: "Aucun litige ouvert.",
  closure_blocked: "Clôture bloquée.",
  cross_tenant_forbidden: "Action non autorisée.",
};

const BLOCKER_FR: Record<string, string> = {
  delivery_complete: "Livraison non effectuée",
  pod_received: "Bordereau signé manquant",
  coordinator_completeness: "Complétude Coordinateur non validée",
  am_completeness: "Complétude Account Manager non validée",
  invoice_validated: "Facture non validée par la Finance",
  invoice_emailed: "Facture non envoyée au client",
  balance_zero: "Solde non nul",
  no_open_dispute: "Litige ouvert",
  deposit_proof_accepted: "Preuve de dépôt non validée",
  handed_to_collections: "Non remis au recouvrement",
  collections_complete: "Recouvrement non terminé",
  process_complete: "Étapes officielles incomplètes",
  no_unresolved_corrections: "Correction en suspens",
};

const btn = "rounded border px-2 py-1 text-xs font-medium transition disabled:opacity-50";

export function CollectionsRowActions({ row, canClose }: { row: CollectionsRow; canClose: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; blockers?: string[] }>) => {
    setError(null);
    setBlockers([]);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
        setBlockers(r.blockers ?? []);
      }
    });
  };

  const followUp = () => {
    const outcome = window.prompt(
      "Résultat (CLIENT_CONTACTED, NO_RESPONSE, PAYMENT_PROMISED, DISPUTED, ESCALATED, WRONG_CONTACT, RESCHEDULED) :",
    )?.trim();
    if (!outcome) return;
    const promised =
      outcome === "PAYMENT_PROMISED"
        ? window.prompt("Date promise (AAAA-MM-JJ) :")?.trim() || undefined
        : undefined;
    const note = window.prompt("Note opérationnelle (facultatif) :")?.trim() || undefined;
    run(() =>
      recordFollowUp(row.invoiceId, {
        channel: "PHONE",
        outcome,
        note,
        promisedPaymentDate: promised,
      }),
    );
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        <button
          className={`${btn} border-slate-300 bg-white text-slate-700`}
          disabled={pending}
          onClick={followUp}
        >
          Relance
        </button>

        {row.dispute.open ? (
          <button
            className={`${btn} border-purple-300 bg-purple-50 text-purple-800`}
            disabled={pending}
            onClick={() => {
              const res = window.prompt("Résolution du litige :")?.trim();
              if (!res) {
                setError("Un motif est obligatoire.");
                return;
              }
              run(() => resolveDispute(row.invoiceId, res));
            }}
          >
            Clore le litige
          </button>
        ) : (
          <button
            className={`${btn} border-slate-300 bg-white text-slate-700`}
            disabled={pending}
            onClick={() => {
              const cat = window.prompt(
                "Catégorie (AMOUNT, SERVICE, MISSING_DOCUMENT, DELIVERY, TAX, DUPLICATE_INVOICE, PAYMENT_ALREADY_MADE, OTHER) :",
              )?.trim();
              if (!cat) return;
              const reason = window.prompt("Motif du litige (obligatoire) :")?.trim();
              if (!reason) {
                setError("Un motif est obligatoire.");
                return;
              }
              run(() => openDispute(row.invoiceId, cat, reason));
            }}
          >
            Litige
          </button>
        )}

        {!row.collectionsCompleted && row.outstanding <= 0 && !row.dispute.open && (
          <button
            className={`${btn} border-teal-300 bg-teal-50 text-teal-800`}
            disabled={pending}
            onClick={() => run(() => completeCollections(row.invoiceId))}
          >
            Recouvrement terminé
          </button>
        )}

        {/* Closure is SEPARATE from completing the recovery, and permissioned. */}
        {canClose && row.collectionsCompleted && (
          <button
            className={`${btn} border-navy-300 bg-navy-50 text-navy-800`}
            disabled={pending}
            onClick={() => run(() => closeDossier(row.fileId))}
          >
            Clôturer le dossier
          </button>
        )}
      </div>

      {error && <p className="text-right text-[11px] text-red-600">{error}</p>}
      {blockers.length > 0 && (
        <ul className="max-w-[18rem] text-right text-[10px] text-red-600">
          {blockers.map((b) => (
            <li key={b}>· {BLOCKER_FR[b] ?? b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
