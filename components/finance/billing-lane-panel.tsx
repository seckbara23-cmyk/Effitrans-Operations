"use client";

/**
 * The operator's door to the governed billing lane (STEP20-BILLING-UI-01).
 * ---------------------------------------------------------------------------
 * Steps 20 -> 21 -> 22 — draft, Finance validation, issue-and-send — had five
 * working server actions and no control anywhere in the product that called
 * them. This is that control, and nothing more.
 *
 * IT DECIDES NOTHING. Every button's visibility comes from `view.can.*`, which
 * the server resolved in `lib/process/billing/lane.ts` by running the SAME pure
 * predicates the action re-runs under its own `guard()`. This component holds no
 * rule about lines, maker-checker, invoice state or step state, and must never
 * acquire one: a second opinion here is how the screen and the server come to
 * disagree. Hiding a control removes a door from the screen and nothing from the
 * server — `lib/process/engine/actions.ts` and `lib/process/billing/actions.ts`
 * both carry "use server", so both stay reachable and both stay authoritative.
 *
 * IT INVENTS NO SENTENCE. Every refusal — the server's and the read model's
 * `blockedReason` alike — is a `BillingError` resolved through the one shared
 * `BILLING_ERROR_FR`. A private map here would be the seventh, and the sixth was
 * already a defect.
 *
 * THE TWO IRREVERSIBLE ACTS ASK FIRST. A rejection returns the draft to Billing
 * with a motif the maker will read, and issuing consumes an official invoice
 * number and writes to the client. Neither is a one-click affordance.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveInvoice,
  emailValidatedInvoice,
  prepareInvoiceDraft,
  rejectInvoice,
  submitInvoiceToFinance,
} from "@/lib/process/billing/actions";
import { BILLING_ERROR_FR, MAX_REJECTION_REASON, type BillingError } from "@/lib/process/billing/state";
import type { BillingLaneView } from "@/lib/process/billing/lane";
import type { StepState } from "@/lib/process/engine/types";

/** One sentence per lane situation — what is true now, in the product's words. */
const QUEUE_STATE_FR: Record<BillingLaneView["queueState"], string> = {
  billing_ready: "Le dossier n'est pas encore prêt pour la facturation.",
  draft_missing: "Le dossier est prêt à être facturé : établissez le brouillon de facture.",
  draft_in_progress: "Brouillon en cours de préparation par la Facturation.",
  submitted_for_validation: "Facture soumise — en attente du contrôle de la Finance.",
  correction_required: "Facture rejetée par la Finance : à corriger puis soumettre à nouveau.",
  approved_ready_to_email: "Facture validée par la Finance : prête à être émise et envoyée au client.",
  emailed: "Facture officielle émise et envoyée au client.",
  email_failed_retry: "L'envoi de la facture a échoué : relancez l'émission.",
};

const STEP_STATE_FR: Partial<Record<StepState, string>> = {
  PENDING: "à venir",
  AVAILABLE: "à faire",
  ACTIVE: "en cours",
  BLOCKED: "bloquée",
  SUBMITTED: "en attente de contrôle",
  APPROVED: "validée",
  COMPLETED: "terminée",
  REJECTED: "rejetée",
  SKIPPED: "sans objet",
};

function StepChip({ n, label, state }: { n: number; label: string; state: StepState | null }) {
  const done = state === "COMPLETED" || state === "APPROVED" || state === "SKIPPED";
  const open = state === "AVAILABLE" || state === "ACTIVE" || state === "SUBMITTED" || state === "BLOCKED";
  return (
    <div
      className={`flex-1 rounded-lg border px-2 py-1.5 ${
        done
          ? "border-teal-200 bg-teal-50"
          : open
            ? "border-navy-200 bg-white"
            : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="text-[11px] font-medium text-navy-900">
        {n}. {label}
      </div>
      <div className={`text-[11px] ${done ? "text-teal-700" : open ? "text-navy-600" : "text-slate-400"}`}>
        {state ? (STEP_STATE_FR[state] ?? state) : "—"}
      </div>
    </div>
  );
}

export function BillingLanePanel({ view }: { view: BillingLaneView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "reject" | "issue">(null);
  const [reason, setReason] = useState("");

  const inv = view.invoice;
  const anyAction =
    view.can.prepare || view.can.submit || view.can.approve || view.can.reject || view.can.issue;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: BillingError }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        // The action stays authoritative: a refusal here is the SERVER's, even
        // where the panel believed the act was available. Shown verbatim from
        // the shared vocabulary rather than reworded.
        setError(BILLING_ERROR_FR[res.error] ?? "L'action a échoué. Veuillez réessayer.");
        return;
      }
      setDialog(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-navy-900">Facturation — circuit officiel</h3>
        {inv && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            Révision {inv.revision}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <StepChip n={20} label="Établir la facture" state={view.steps.draft} />
        <StepChip n={21} label="Contrôle Finance" state={view.steps.validation} />
        <StepChip n={22} label="Émission et envoi" state={view.steps.dispatch} />
      </div>

      <p className="text-xs text-slate-600">{QUEUE_STATE_FR[view.queueState]}</p>

      {/* Finance's motif, verbatim — it is what the maker must act on. */}
      {inv?.rejectionReason && inv.editableDraft && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span className="font-medium">Motif du rejet par la Finance :</span> {inv.rejectionReason}
        </div>
      )}

      {/* The maker may not validate their own invoice — said plainly rather than
          left as a control that silently is not there. */}
      {inv?.awaitingValidation && inv.viewerIsMaker && (
        <p className="text-xs text-slate-500">
          Vous avez soumis cette facture : son contrôle revient à une autre personne de la Finance.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {dialog === "reject" && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <label className="block text-xs font-medium text-amber-900" htmlFor="billing-reject-reason">
            Motif du rejet (obligatoire) — la Facturation le lira pour corriger.
          </label>
          <textarea
            id="billing-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REJECTION_REASON}
            rows={3}
            className="w-full rounded-md border border-amber-200 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length === 0 || !inv}
              onClick={() => inv && run(() => rejectInvoice(inv.id, reason))}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              Confirmer le rejet
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDialog(null);
                setReason("");
              }}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {dialog === "issue" && (
        <div className="space-y-2 rounded-lg border border-navy-200 bg-slate-50 p-2">
          <p className="text-xs text-navy-900">
            L&apos;émission attribue le numéro de facture officiel et envoie la facture au client. Cette
            opération est définitive.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !inv}
              onClick={() => inv && run(() => emailValidatedInvoice(inv.id))}
              className="rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              Émettre et envoyer
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog(null)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!dialog && (
        <div className="flex flex-wrap items-center gap-2">
          {view.can.prepare && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => prepareInvoiceDraft(view.fileId))}
              className="rounded-md border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Établir le brouillon de facture
            </button>
          )}
          {view.can.submit && inv && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => submitInvoiceToFinance(inv.id))}
              className="rounded-md border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Soumettre à la Finance
            </button>
          )}
          {view.can.approve && inv && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveInvoice(inv.id))}
              className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              Valider la facture
            </button>
          )}
          {view.can.reject && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog("reject")}
              className="rounded-md border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Rejeter avec motif
            </button>
          )}
          {view.can.issue && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog("issue")}
              className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              Émettre et envoyer au client
            </button>
          )}
          {/* Nothing to offer THIS reader — say why, from the shared vocabulary. */}
          {!anyAction && view.blockedReason && (
            <p className="text-xs text-slate-500">{BILLING_ERROR_FR[view.blockedReason]}</p>
          )}
        </div>
      )}
    </div>
  );
}
