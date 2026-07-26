"use client";
/**
 * Workflow policy administration (Phase WES-7F). Client component.
 * ---------------------------------------------------------------------------
 * The MINIMUM safe surface: see the active version, inspect history, create a
 * draft from the active version, validate it, activate it, and read validation
 * failures.
 *
 * Deliberately NOT a workflow designer. There is no free-form editor, no
 * expression language, no place to type a permission name, a role code or SQL:
 * a draft is created FROM the current active version and activation is the only
 * write. Anything richer would let an operator author a policy the fail-closed
 * validator was built to reject — and would be the "drag-and-drop workflow
 * builder" WES-7 explicitly forbids.
 *
 * Every action re-asserts its permission server-side; these buttons are
 * convenience, never authorization.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activatePolicyVersion,
  createPolicyDraft,
  validatePolicyDraft,
} from "@/lib/workflow/policy/actions";
import type { PolicyVersionView } from "@/lib/workflow/policy/readers";

const ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de gérer la politique de workflow.",
  not_found: "Version introuvable.",
  invalid_state: "Cette version n'est pas dans un état permettant cette action.",
  invalid_input: "Enregistrement impossible.",
  validation_failed: "La validation a échoué — corrigez les erreurs listées.",
  duplicate_content: "Une version identique existe déjà : aucun changement à publier.",
  reason_required: "Un motif est obligatoire pour activer une version.",
  activation_failed: "L'activation a été refusée par le contrôle de sécurité.",
};

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  VALIDATED: "bg-sky-50 text-sky-700",
  ACTIVE: "bg-teal-50 text-teal-700",
  RETIRED: "bg-slate-100 text-slate-400",
};

const frDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR") : "—");

export function PolicyAdmin({
  versions,
  active,
  builtInHash,
}: {
  versions: PolicyVersionView[];
  active: PolicyVersionView | null;
  builtInHash: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<unknown[]>([]);
  const [activating, setActivating] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string; errors?: unknown }>, okMsg: string) {
    setError(null);
    setNotice(null);
    setFailures([]);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(ERRORS[res.error ?? ""] ?? "L'opération a échoué.");
        if (Array.isArray(res.errors)) setFailures(res.errors);
        return;
      }
      setNotice(okMsg);
      setActivating(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {notice && <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800">{notice}</p>}

      {/* Validation failures — the operator must see WHY, precisely. */}
      {failures.length > 0 && (
        <section className="surface space-y-2 p-4">
          <h2 className="text-sm font-semibold text-red-700">Échecs de validation ({failures.length})</h2>
          <ul className="space-y-1">
            {failures.map((f, i) => {
              const e = f as { code?: string; path?: string; detail?: string };
              return (
                <li key={i} className="rounded bg-red-50 p-2 text-xs text-red-800">
                  <span className="font-mono font-medium">{e.path || "—"}</span> · {e.code} — {e.detail}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* What governs dossiers right now. */}
      <section className="surface space-y-3 p-4">
        <h2 className="text-sm font-semibold text-navy-900">Politique active</h2>
        {active ? (
          <dl className="grid gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-400">Version</dt>
              <dd className="text-sm font-medium text-navy-900">
                v{active.version} · {active.scope === "platform" ? "Plateforme" : "Tenant"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Activée le</dt>
              <dd className="text-sm text-navy-900">{frDate(active.activatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Motif</dt>
              <dd className="text-sm text-navy-900">{active.activationReason ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Empreinte</dt>
              <dd className="tabular text-xs text-slate-500">{active.contentSha256.slice(0, 16)}…</dd>
            </div>
          </dl>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Aucune version publiée. Les dossiers suivent la politique par défaut intégrée, dérivée du
            registre officiel des étapes — le comportement actuel est inchangé.
            {builtInHash && (
              <span className="ml-1 tabular text-amber-700">Empreinte : {builtInHash.slice(0, 16)}…</span>
            )}
          </div>
        )}

        <button
          onClick={() =>
            run(() => createPolicyDraft({}), "Brouillon créé à partir de la politique en vigueur.")
          }
          disabled={pending}
          className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {pending ? "…" : "Créer un brouillon"}
        </button>
      </section>

      {/* History — every version stays queryable forever. */}
      <section className="surface overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Historique des versions
        </h2>
        {versions.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Aucune version enregistrée.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Version</th>
                  <th className="px-4 py-2 font-semibold">Portée</th>
                  <th className="px-4 py-2 font-semibold">Statut</th>
                  <th className="px-4 py-2 font-semibold">Validation</th>
                  <th className="px-4 py-2 font-semibold">Créée</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 tabular font-medium text-navy-900">v{v.version}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {v.scope === "platform" ? "Plateforme" : "Tenant"}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[v.status]}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {v.validationStatus}
                      {v.validationErrorCount > 0 && ` (${v.validationErrorCount})`}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{frDate(v.createdAt)}</td>
                    <td className="px-4 py-2">
                      {v.status === "DRAFT" && (
                        <button
                          onClick={() => run(() => validatePolicyDraft(v.id), "Validation réussie.")}
                          disabled={pending}
                          className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
                        >
                          Valider
                        </button>
                      )}
                      {v.status === "VALIDATED" && activating !== v.id && (
                        <button
                          onClick={() => setActivating(v.id)}
                          disabled={pending}
                          className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
                        >
                          Activer
                        </button>
                      )}
                      {v.status === "VALIDATED" && activating === v.id && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Motif (obligatoire)"
                            className="rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() =>
                              run(() => activatePolicyVersion(v.id, reason), `Version v${v.version} activée.`)
                            }
                            disabled={pending || reason.trim().length === 0}
                            className="rounded bg-navy-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Confirmer
                          </button>
                          <button
                            onClick={() => { setActivating(null); setReason(""); }}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            Annuler
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        L&apos;activation attribue une nouvelle version immuable et retire la précédente en une seule
        opération. Les dossiers déjà en cours restent régis par la version à laquelle ils sont
        rattachés : une activation ne modifie jamais un dossier en cours.
      </p>
    </div>
  );
}
