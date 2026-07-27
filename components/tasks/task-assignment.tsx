"use client";
/**
 * Task assignment control (Phase WES-3A.1). Client component.
 * ---------------------------------------------------------------------------
 * Replaces the single unlabelled `<select>` that called the legacy `assignTask`
 * with every guarantee bypassed. It distinguishes the three operations the
 * ledger distinguishes — ASSIGN, REASSIGN, UNASSIGN — because they are
 * different facts, not one dropdown with different values.
 *
 * The reason field appears only for the codes that require one, and the button
 * stays disabled until it is filled. That is convenience: the server re-checks
 * the requirement, and so does a database trigger. Three layers, because a
 * missing reason on a supervisor override is exactly the thing nobody can
 * reconstruct afterwards.
 *
 * Eligible users are supplied by the server from the PINNED policy. If policy
 * cannot be resolved the control says so rather than presenting an empty list
 * as "nobody is available" — an empty picker and a broken picker look
 * identical, and only one of them is safe to retry.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignTaskToUser } from "@/lib/workflow/access/actions";
import { SELECTABLE_REASON_CODES, reasonRequired } from "@/lib/workflow/access/vocabulary";

export type AssignmentOption = { id: string; label: string };

/** Errors the server can return, in French. Never a raw database message. */
const ERRORS_FR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de modifier cette affectation.",
  not_found: "Tâche introuvable.",
  invalid_reason_code: "Motif d'affectation invalide.",
  reason_required: "Un motif est obligatoire pour cette action.",
  policy_unresolved:
    "La politique applicable à ce dossier n'a pas pu être déterminée. Affectation impossible.",
  not_eligible: "Cette personne n'a pas le rôle requis pour cette étape.",
  invalid_assignee: "Cette personne ne fait pas partie de votre organisation.",
  assignee_inactive: "Ce compte n'est pas actif.",
  invalid_state: "Une tâche terminée ou annulée ne peut pas être réaffectée.",
  unchanged: "Cette personne est déjà affectée à cette tâche.",
  owner_required: "Le responsable ne peut pas être retiré.",
  assignment_failed: "L'affectation a échoué.",
};

export function TaskAssignment({
  taskId,
  currentAssigneeId,
  currentAssigneeLabel,
  options,
  policyResolved,
  canAssign,
}: {
  taskId: string;
  currentAssigneeId: string | null;
  currentAssigneeLabel: string | null;
  options: AssignmentOption[];
  policyResolved: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [reasonCode, setReasonCode] = useState("REASSIGNMENT");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!canAssign) {
    return (
      <span className="text-xs text-slate-500">
        {currentAssigneeLabel ?? "Non affectée"}
      </span>
    );
  }

  const isInitial = currentAssigneeId === null;
  const needsReason = reasonRequired(reasonCode);
  const blocked = pending || !target || (needsReason && reason.trim().length === 0);

  function submit(userId: string | null, code: string) {
    setError(null);
    startTransition(async () => {
      const res = await assignTaskToUser({
        taskId,
        userId,
        reasonCode: code,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        setError(ERRORS_FR[res.error] ?? ERRORS_FR.assignment_failed);
        return;
      }
      setOpen(false);
      setTarget("");
      setReason("");
      // Refreshes the task list only. Reassignment changes NO lifecycle stage
      // and NO department responsibility — that separation is the point of
      // WES-3, and this control must not imply otherwise.
      router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">
        {currentAssigneeLabel ?? "Non affectée"}
      </span>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          disabled={pending}
          className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
        >
          {isInitial ? "Affecter" : "Réaffecter"}
        </button>
      )}

      {!open && !isInitial && (
        <button
          onClick={() => submit(null, "UNASSIGNMENT")}
          disabled={pending}
          className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          Retirer
        </button>
      )}

      {open && (
        <span className="flex flex-wrap items-center gap-2">
          {!policyResolved ? (
            <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Politique applicable indéterminée — affectation indisponible.
            </span>
          ) : options.length === 0 ? (
            <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Aucune personne éligible pour cette étape.
            </span>
          ) : (
            <>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="">Choisir une personne…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.id === currentAssigneeId}>
                    {o.label}
                  </option>
                ))}
              </select>

              {!isInitial && (
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                >
                  {SELECTABLE_REASON_CODES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.labelFr}
                    </option>
                  ))}
                </select>
              )}

              {needsReason && (
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motif (obligatoire)"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                />
              )}

              <button
                onClick={() => submit(target, isInitial ? "INITIAL" : reasonCode)}
                disabled={blocked}
                className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {pending ? "…" : "Confirmer"}
              </button>
            </>
          )}

          <button
            onClick={() => { setOpen(false); setError(null); setTarget(""); setReason(""); }}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Annuler
          </button>
        </span>
      )}

      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
