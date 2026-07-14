"use client";
/**
 * Administration deposit row (Phase 5.0D-3). Mutates nothing itself.
 * ---------------------------------------------------------------------------
 * Shows the immutable CUSTODY TIMELINE — who held the package, when, and why it
 * moved — rather than inferring the history from the current status.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import type { DepositView } from "@/lib/deposit/service";
import { acceptProof, handToCollections, rejectProof } from "@/lib/deposit/actions";

const ERROR_FR: Record<string, string> = {
  feature_disabled: "Fonctionnalité désactivée.",
  forbidden: "Action non autorisée.",
  invalid_state: "Le circuit a changé d'état. Rafraîchissez la page.",
  reason_required: "Un motif est obligatoire.",
  proof_required: "Aucune preuve de dépôt.",
  self_review_forbidden:
    "Vous avez effectué ce dépôt : vous ne pouvez pas contrôler votre propre preuve.",
  not_found: "Circuit introuvable.",
};

const btn = "rounded border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";

export function DepositRow({ deposit: d, canAdmin }: { deposit: DepositView; canAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/files/${d.fileId}`} className="tabular text-sm font-medium text-navy-900 hover:text-teal-700">
            {d.fileNumber}
          </Link>
          <span className="ml-2 text-xs text-slate-500">{d.clientName}</span>
          <div className="text-xs text-slate-500">
            {d.invoiceNumber ?? "—"} · {d.statusLabel}
            {d.courierName && <> · coursier : {d.courierName}</>}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Détenteur actuel : <strong>{d.currentCustodian ?? "—"}</strong> · {d.pendingAction}
          </div>
          {d.blocker && <p className="mt-1 text-xs text-red-600">{d.blocker}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          {canAdmin && d.status === "PROOF_SUBMITTED" && (
            <>
              <button
                className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800`}
                disabled={pending}
                onClick={() => run(() => acceptProof(d.id))}
              >
                Valider la preuve
              </button>
              <button
                className={`${btn} border-red-300 bg-red-50 text-red-800`}
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt("Motif du rejet (obligatoire) :")?.trim();
                  if (!reason) {
                    setError("Un motif est obligatoire.");
                    return;
                  }
                  run(() => rejectProof(d.id, reason));
                }}
              >
                Rejeter
              </button>
            </>
          )}

          {canAdmin && d.status === "PROOF_ACCEPTED" && (
            <button
              className={`${btn} border-navy-300 bg-navy-50 text-navy-800`}
              disabled={pending}
              onClick={() => run(() => handToCollections(d.id))}
            >
              Remettre au recouvrement
            </button>
          )}

          <button
            className={`${btn} border-slate-200 bg-white text-slate-500`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Masquer" : "Traçabilité"}
          </button>
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      {open && (
        <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {d.custody.length === 0 && <li className="text-xs text-slate-400">Aucun événement.</li>}
          {d.custody.map((e) => (
            <li key={e.id} className="text-xs text-slate-600">
              <span className="tabular text-slate-400">
                {new Date(e.occurredAt).toLocaleString("fr-FR")}
              </span>{" "}
              — <strong className="text-slate-800">{e.labelFr}</strong>
              {e.fromDepartment && e.toDepartment && (
                <span className="text-slate-400">
                  {" "}
                  ({e.fromDepartment} → {e.toDepartment})
                </span>
              )}
              {e.actorRoleCode && <span className="text-slate-400"> · {e.actorRoleCode}</span>}
              {e.reason && <span className="text-red-600"> · {e.reason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
