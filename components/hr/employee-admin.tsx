"use client";
/**
 * Employee lifecycle + account-link admin (Phase HR-1). Client component.
 * ---------------------------------------------------------------------------
 * Invokes the server actions (all permission-gated + audited server-side).
 * Imports NO server-only code. Enforces the ratified rules at the UI edge too:
 *   * termination requires a reason (also enforced server-side);
 *   * terminating a LINKED employee shows a PROMPT to revoke access via the
 *     existing /users flow — it never revokes automatically (DEC-B26).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  transitionEmployee,
  linkEmployeeAccount,
  unlinkEmployeeAccount,
} from "@/lib/hr/actions";
import { employeeStatusLabelFr } from "@/lib/hr/lifecycle";

type Account = { id: string; name: string | null; email: string };

const ERROR_FR: Record<string, string> = {
  forbidden: "Action non autorisée.",
  not_found: "Employé introuvable.",
  invalid_state: "Transition de statut non permise.",
  reason_required: "Un motif est requis pour enregistrer un départ.",
  account_not_eligible: "Le compte sélectionné n'est pas un compte actif de cette organisation.",
  account_already_linked: "Ce compte est déjà lié à un autre employé.",
  write_failed: "L'enregistrement a échoué.",
  invalid_input: "Données invalides.",
};

export function EmployeeAdmin({
  employeeId,
  status,
  statusLabel,
  allowedTransitions,
  hasLinkedAccount,
  accounts,
}: {
  employeeId: string;
  status: string;
  statusLabel: string;
  allowedTransitions: string[];
  hasLinkedAccount: boolean;
  accounts: Account[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [terminateReason, setTerminateReason] = useState("");
  const [showTerminate, setShowTerminate] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [revokePrompt, setRevokePrompt] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string; promptRevocation?: boolean }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.promptRevocation) setRevokePrompt(true);
        setShowTerminate(false);
        setTerminateReason("");
        router.refresh();
      } else {
        setError(ERROR_FR[res.error ?? "write_failed"] ?? ERROR_FR.write_failed);
      }
    });
  }

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Cycle de vie & compte</h2>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {revokePrompt && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">Départ enregistré. L'accès à la plateforme n'a PAS été révoqué.</p>
          <p className="mt-1">
            La révocation de l'accès est une action distincte. Pour désactiver ou archiver le compte de connexion,
            utilisez la gestion des comptes dans <a href="/users" className="underline">Administration → Utilisateurs</a>.
          </p>
        </div>
      )}

      {/* Lifecycle transitions */}
      <div>
        <p className="mb-2 text-xs text-slate-400">Statut actuel : <span className="font-medium text-navy-900">{statusLabel}</span></p>
        {allowedTransitions.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune transition disponible.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map((to) =>
              to === "TERMINATED" ? (
                <button key={to} onClick={() => setShowTerminate((v) => !v)} disabled={pending} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {employeeStatusLabelFr(to)}…
                </button>
              ) : (
                <button key={to} onClick={() => run(() => transitionEmployee(employeeId, to))} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-navy-800 hover:bg-slate-50 disabled:opacity-50">
                  → {employeeStatusLabelFr(to)}
                </button>
              ),
            )}
          </div>
        )}

        {showTerminate && (
          <div className="mt-3 space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
            <label className="block text-xs font-medium text-slate-600">Motif du départ *</label>
            <input value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" placeholder="Ex. fin de contrat, démission…" />
            <button onClick={() => run(() => transitionEmployee(employeeId, "TERMINATED", terminateReason))} disabled={pending || !terminateReason.trim()} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              Confirmer le départ
            </button>
          </div>
        )}
      </div>

      {/* Account link */}
      <div className="border-t border-slate-100 pt-4">
        {hasLinkedAccount ? (
          <button onClick={() => run(() => unlinkEmployeeAccount(employeeId))} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-navy-800 hover:bg-slate-50 disabled:opacity-50">
            Dissocier le compte
          </button>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-slate-400">Aucun compte actif disponible à lier (les comptes déjà liés ne sont pas listés).</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
              <option value="">Lier un compte de connexion…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name ? `${a.name} — ${a.email}` : a.email}</option>)}
            </select>
            <button onClick={() => run(() => linkEmployeeAccount(employeeId, selectedAccount))} disabled={pending || !selectedAccount} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
              Lier
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">La liaison d'un compte n'accorde aucune permission. Les rôles se gèrent dans Administration.</p>
      </div>
    </section>
  );
}
