"use client";

import { useState, useTransition } from "react";
import { previewBulkAssignmentAction, executeBulkAssignment } from "@/lib/ec/mailboxes/bulk-actions";
import { OUTCOME_FR, type BulkDecision } from "@/lib/ec/mailboxes/bulk";
import type { MailboxSummary } from "@/lib/ec/mailboxes/membership";
import { cn } from "@/lib/cn";

/**
 * EMP-4A — bulk assignment, preview first.
 *
 * The confirm button does not exist until a preview has been produced, and the
 * execute action carries that preview's fingerprint. If anything changed in
 * between, the server refuses — so "no direct execute without preview" is
 * enforced where it matters rather than by hiding a button.
 *
 * Every candidate appears in the preview, including the ones nothing will
 * happen to: skipped, rejected, unchanged. A user who silently vanished from
 * the list is a user whose fate the administrator did not actually approve.
 */
const TONE: Record<string, string> = {
  GRANT_NEW: "text-teal-700",
  REACTIVATE: "text-teal-700",
  UPDATE: "text-navy-900",
  UNCHANGED: "text-slate-400",
  SKIPPED_NO_DEPARTMENT: "text-slate-500",
  SKIPPED_NOT_ELIGIBLE: "text-slate-500",
  REJECTED_CROSS_TENANT: "text-red-700",
  CONFLICT_DEFAULT_SENDER: "text-amber-700",
};

export function BulkAssignPanel({ mailboxes }: { mailboxes: MailboxSummary[] }) {
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [requireEligibility, setRequireEligibility] = useState(true);
  const [caps, setCaps] = useState({
    canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false,
  });
  const [decisions, setDecisions] = useState<BulkDecision[] | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = () => {
    setError(null); setResult(null);
    start(async () => {
      const res = await previewBulkAssignmentAction({
        mailboxId, capabilities: caps, requireEligibility,
      });
      if (!res.ok) { setError(res.error); return; }
      setDecisions(res.decisions);
      setFingerprint(res.fingerprint);
      setAddress(res.mailboxAddress);
    });
  };

  const confirm = () => {
    if (!fingerprint) return;
    setError(null);
    start(async () => {
      const res = await executeBulkAssignment({
        mailboxId, capabilities: caps, requireEligibility, fingerprint,
      });
      if (!res.ok) {
        setError(res.error === "preview_stale"
          ? "Les données ont changé depuis l'aperçu. Relancez l'aperçu avant de confirmer."
          : `Échec : ${res.error}`);
        return;
      }
      setResult(`${res.applied.length} appartenance(s) modifiée(s). Lot ${res.batchId.slice(0, 8)}.`);
      // Force a fresh preview before any further execution.
      setDecisions(null); setFingerprint(null);
    });
  };

  const willWrite = decisions?.filter((d) => d.writes).length ?? 0;

  return (
    <div className="space-y-4">
      <section className="surface space-y-3 p-4" aria-labelledby="bulk-setup">
        <h2 id="bulk-setup" className="text-sm font-semibold text-navy-900">Paramètres</h2>

        <label className="block text-xs text-slate-600">
          Boîte cible
          <select
            value={mailboxId}
            onChange={(e) => { setMailboxId(e.target.value); setDecisions(null); setFingerprint(null); }}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          >
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>{m.address} ({m.purpose})</option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Capacités</legend>
          {([
            ["canRead", "Lecture"], ["canSend", "Envoi"],
            ["canManageMembers", "Gestion des membres"], ["isDefaultSender", "Expéditeur par défaut"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox" checked={caps[key]} disabled={pending}
                onChange={(e) => { setCaps({ ...caps, [key]: e.target.checked }); setDecisions(null); setFingerprint(null); }}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox" checked={requireEligibility} disabled={pending}
            onChange={(e) => { setRequireEligibility(e.target.checked); setDecisions(null); setFingerprint(null); }}
          />
          Limiter aux utilisateurs dont le département dérivé propose cette boîte
        </label>

        <button
          type="button" onClick={preview} disabled={pending || !mailboxId}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50"
        >
          {pending ? "…" : "Aperçu"}
        </button>
      </section>

      {decisions ? (
        <section className="surface overflow-hidden" aria-labelledby="bulk-preview">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 id="bulk-preview" className="text-sm font-semibold text-navy-900">
              Aperçu — {address}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {decisions.length} utilisateur(s) examiné(s) · <strong>{willWrite}</strong> modification(s)
              à appliquer. Rien n&apos;a encore été écrit.
            </p>
          </div>

          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {decisions.map((d) => (
              <li key={d.userId} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2">
                <span className="text-sm text-navy-900">{d.name ?? d.email}</span>
                <span className="min-w-0 text-right">
                  <span className={cn("text-[11px] font-medium", TONE[d.outcome])}>
                    {OUTCOME_FR[d.outcome]}
                  </span>
                  <span className="block text-[11px] text-slate-500">{d.reason}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-100 px-4 py-3">
            <button
              type="button" onClick={confirm} disabled={pending || willWrite === 0}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "…" : `Confirmer ${willWrite} modification(s)`}
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              L&apos;exécution rejoue exactement cet aperçu. Si les données changent entre-temps,
              elle est refusée plutôt que d&apos;appliquer des changements non prévisualisés.
            </p>
          </div>
        </section>
      ) : null}

      {result ? <p className="text-xs text-teal-700" role="status">{result}</p> : null}
      {error ? <p className="text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
