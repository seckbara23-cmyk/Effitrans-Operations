"use client";

/**
 * Operations intake panel (Phase 9.0C) — lives on the flag-gated process
 * inspector page, so with the intake flag off nothing anywhere changes. Drives
 * the opening slice: validation display, canonical owner selection (eligible
 * Operations staff only, names/roles — never a raw UUID), « Ouvrir le
 * dossier », intake blockers, and « Transmettre au Transit ».
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openDossierWorkflow, handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { openProcessBlocker, resolveProcessBlocker } from "@/lib/process/engine/structures-actions";
import type { IntakeState, EligibleOwner } from "@/lib/process/engine/intake-actions";

const ERROR_FR: Record<string, string> = {
  engine_disabled: "Le flux d'ouverture n'est pas activé.",
  forbidden: "Action non autorisée.",
  not_found: "Dossier introuvable.",
  intake_incomplete: "Informations obligatoires manquantes — corrigez les points bloquants.",
  transition_failed: "Le statut du dossier n'a pas pu être mis à jour. Réessayez.",
  blocked_by_intake_blockers: "Transmission refusée : des points bloquants sont ouverts sur ce dossier.",
  owner_forbidden: "Le responsable choisi n'est pas un membre Opérations actif.",
  owner_not_found: "Le responsable choisi n'est pas un membre Opérations actif.",
};

const frError = (code: string) => ERROR_FR[code] ?? ERROR_FR[code.replace(/^owner_/, "")] ?? "L'action a échoué. Réessayez.";

export function IntakePanel({
  fileId,
  state,
  eligibleOwners,
  canOpen,
  canHandoff,
  canManageBlockers,
}: {
  fileId: string;
  state: IntakeState;
  eligibleOwners: EligibleOwner[];
  canOpen: boolean;
  canHandoff: boolean;
  canManageBlockers: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ownerUserId, setOwnerUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockerTitle, setBlockerTitle] = useState("");
  const [blockerCustomerMessage, setBlockerCustomerMessage] = useState("");
  const [showBlockerForm, setShowBlockerForm] = useState(false);

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, successNotice: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(frError(String((res as { error?: string }).error ?? "generic")));
      else {
        setNotice(successNotice);
        router.refresh();
      }
    });
  }

  const opened = state.hasInstance && state.owner !== null;
  // Pre-opening, the read-side validation always lists owner_missing (the owner is
  // chosen right here) — the button cares about every OTHER blocking issue.
  const nonOwnerBlocking = state.validation.blocking.filter((i) => i.code !== "owner_missing");

  return (
    <section className="rounded-lg border border-teal-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Ouverture du dossier (Opérations)</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Statut dossier : <strong>{state.fileStatus}</strong>
        {state.handoffSent && <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-700">Transmis au Transit</span>}
      </p>

      {/* Validation — blocking first, then warnings. */}
      {state.validation.blocking.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-2.5">
          {state.validation.blocking.map((i) => (
            <li key={i.code} className="text-xs text-red-700">✖ {i.labelFr}</li>
          ))}
        </ul>
      )}
      {state.validation.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          {state.validation.warnings.map((i) => (
            <li key={i.code} className="text-xs text-amber-700">⚠ {i.labelFr}</li>
          ))}
        </ul>
      )}

      {/* Responsable opérationnel — card when assigned, picker when opening. */}
      <div className="mt-3">
        <p className="text-xs font-medium text-slate-600">Responsable opérationnel</p>
        {state.owner ? (
          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="text-sm font-semibold text-slate-900">{state.owner.name}</p>
            <p className="text-xs text-slate-500">
              {[state.owner.roleLabel, state.owner.departmentLabel].filter(Boolean).join(" · ")}
            </p>
            <p className="text-[11px] text-slate-400">
              {state.owner.email}
              {state.owner.assignedAt && ` · assigné le ${new Date(state.owner.assignedAt).toLocaleDateString("fr-FR")}`}
            </p>
          </div>
        ) : canOpen ? (
          <>
            <label htmlFor="intake-owner" className="sr-only">Choisir le responsable opérationnel</label>
            <select
              id="intake-owner"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              disabled={pending}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            >
              <option value="">— Choisir un responsable Opérations —</option>
              {eligibleOwners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}{o.roleLabel ? ` — ${o.roleLabel}` : ""}
                </option>
              ))}
            </select>
            {eligibleOwners.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Aucun membre Opérations actif éligible.</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Non assigné.</p>
        )}
      </div>

      {/* Blockers — the intake-level « document manquant » state. */}
      {state.openBlockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white p-2.5">
          <p className="text-xs font-semibold text-red-700">Points bloquants ouverts</p>
          <ul className="mt-1 space-y-1.5">
            {state.openBlockers.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                <span>
                  {b.title} <span className="text-slate-400">({b.category})</span>
                  {b.customerVisible && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">visible client</span>}
                </span>
                {canManageBlockers && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => resolveProcessBlocker(fileId, b.id, "Résolu depuis le panneau d'ouverture."), "Point bloquant résolu.")
                    }
                    className="shrink-0 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Résoudre
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!opened && canOpen && (
          <button
            type="button"
            disabled={pending || !ownerUserId || nonOwnerBlocking.length > 0}
            onClick={() => run(() => openDossierWorkflow(fileId, { ownerUserId }), "Dossier ouvert — le client voit « Dossier reçu ».")}
            className="min-h-[36px] rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Ouvrir le dossier
          </button>
        )}
        {opened && canHandoff && !state.handoffSent && (
          <button
            type="button"
            disabled={pending || state.openBlockers.some((b) => b.category === "MISSING_DOCUMENT" || b.category === "CUSTOMER_RESPONSE_REQUIRED")}
            onClick={() => run(() => handDossierToTransit(fileId), "Dossier transmis au Transit — réception à confirmer.")}
            className="min-h-[36px] rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Transmettre au Transit
          </button>
        )}
        {opened && canManageBlockers && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowBlockerForm((v) => !v)}
            className="min-h-[36px] rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Signaler un document manquant
          </button>
        )}
      </div>

      {showBlockerForm && (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="blocker-title" className="block text-xs font-medium text-slate-600">Description interne (jamais visible du client)</label>
          <input
            id="blocker-title"
            value={blockerTitle}
            onChange={(e) => setBlockerTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
            placeholder="Ex. : facture commerciale manquante"
          />
          <label htmlFor="blocker-customer" className="block text-xs font-medium text-slate-600">
            Message client (optionnel — affiché uniquement si renseigné)
          </label>
          <input
            id="blocker-customer"
            value={blockerCustomerMessage}
            onChange={(e) => setBlockerCustomerMessage(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
            placeholder="Ex. : Action requise : un document est attendu de votre part."
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowBlockerForm(false)} className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100">
              Annuler
            </button>
            <button
              type="button"
              disabled={pending || !blockerTitle.trim()}
              onClick={() =>
                run(
                  () =>
                    openProcessBlocker(fileId, {
                      category: "MISSING_DOCUMENT",
                      title: blockerTitle.trim(),
                      customerVisible: Boolean(blockerCustomerMessage.trim()),
                      customerMessage: blockerCustomerMessage.trim() || undefined,
                    }),
                  "Point bloquant créé — la transmission au Transit est suspendue.",
                )
              }
              className="rounded-lg bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Créer
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
