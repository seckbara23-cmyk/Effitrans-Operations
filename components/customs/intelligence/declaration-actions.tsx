"use client";

/**
 * Customs Intelligence — declaration action bar (Phase 7.1B). Client component.
 * ---------------------------------------------------------------------------
 * Renders ONLY the transitions the server said are valid (nextStatuses) and gated by the
 * caller's permissions. It invokes the server-action proxies — the server re-validates
 * every transition and rejects a forced-invalid one. The version last seen is passed for
 * compare-and-set; a stale click is refused by the server, not silently applied.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionDeclaration, refreshDeclaration, type IntelActionResult } from "@/lib/customs/intelligence/actions";
import { declarationLabel, type DeclarationStatus } from "@/lib/customs/intelligence/state-machine";

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée.",
  not_found: "Déclaration introuvable.",
  invalid_status: "Statut inconnu.",
  invalid_transition: "Transition non permise depuis ce statut.",
  terminal: "Cette déclaration est dans un état final.",
  stale_transition: "La déclaration a changé entre-temps — rechargez la page.",
  not_configured: "Aucun fournisseur externe à interroger.",
  unmapped_status: "Statut fournisseur non reconnu — aucune transition appliquée.",
  timeout: "Le fournisseur n'a pas répondu à temps.",
  generic: "Une erreur est survenue.",
};

export function DeclarationActions({
  id,
  version,
  nextStatuses,
  canUpdate,
  canRelease,
  refreshEnabled,
  refreshHint,
}: {
  id: string;
  version: number;
  nextStatuses: DeclarationStatus[];
  canUpdate: boolean;
  canRelease: boolean;
  refreshEnabled: boolean;
  refreshHint: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(fn: () => Promise<IntelActionResult>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(ERRORS[res.error] ?? ERRORS.generic);
        return;
      }
      router.refresh();
    });
  }

  const targets = nextStatuses.filter((s) => (s === "RELEASED" ? canRelease : canUpdate));

  return (
    <section className="surface space-y-3 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Actions</h2>

      {targets.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune transition disponible pour votre rôle depuis ce statut.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {targets.map((s) => (
            <button
              key={s}
              onClick={() => run(() => transitionDeclaration(id, s, version))}
              disabled={pending}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              → {declarationLabel(s)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          onClick={() => run(() => refreshDeclaration(id))}
          disabled={pending || !refreshEnabled}
          title={refreshEnabled ? undefined : refreshHint}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Actualiser depuis le fournisseur
        </button>
        {!refreshEnabled && <span className="text-xs text-slate-400">{refreshHint}</span>}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-teal-700">{notice}</p>}
      <p className="text-xs text-slate-400">
        Les transitions sont validées côté serveur (machine à états canonique) et protégées contre les écritures concurrentes.
      </p>
    </section>
  );
}
