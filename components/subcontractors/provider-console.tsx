"use client";

/**
 * TMS-6 — sous-traitants console. Client component.
 * ---------------------------------------------------------------------------
 * Register an external transport provider, edit its contact details, approve or
 * suspend it, retire it. Rendered only for `transport:manage`; the server
 * asserts the same authority again. Usage counts are read-only — they are
 * derived from transport execution, never entered here.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createProvider,
  setProviderActive,
  setProviderStatus,
  type ProviderResult,
} from "@/lib/subcontractors/actions";
import type { TransportProvider } from "@/lib/subcontractors/service";

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée.",
  name_required: "La raison sociale est obligatoire.",
  duplicate_name: "Ce sous-traitant existe déjà dans le répertoire.",
  invalid_status: "Statut invalide.",
  not_found: "Sous-traitant introuvable.",
  generic: "L'action a échoué. Réessayez.",
};

const inp = "rounded-md border border-slate-200 px-2 py-1 text-sm";
const lab = "flex flex-col gap-1 text-xs text-slate-600";

export function ProviderConsole({ providers }: { providers: TransportProvider[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<string>(providers[0]?.id ?? "");
  // TMS-5C lesson, applied at birth: a useState initializer runs ONCE, so the
  // selection is derived from the current list and self-heals after a create.
  const target = providers.some((p) => p.id === picked) ? picked : (providers[0]?.id ?? "");
  const selected = providers.find((p) => p.id === target) ?? null;

  function run(fn: () => Promise<ProviderResult>, form?: HTMLFormElement) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[r.error] ?? ERR.generic });
      if (r.ok) { form?.reset(); router.refresh(); }
    });
  }

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Gestion des sous-traitants</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const d = new FormData(f);
          run(() => createProvider({
            name: String(d.get("name") ?? ""),
            ninea: String(d.get("ninea") ?? "") || null,
            contactName: String(d.get("contactName") ?? "") || null,
            phone: String(d.get("phone") ?? "") || null,
            email: String(d.get("email") ?? "") || null,
            address: String(d.get("address") ?? "") || null,
          }), f);
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        <p className="sm:col-span-3 text-xs font-medium text-slate-500">Ajouter un sous-traitant</p>
        <label className={lab}>Raison sociale<input name="name" required className={inp} /></label>
        <label className={lab}>NINEA<input name="ninea" className={inp} /></label>
        <label className={lab}>Contact<input name="contactName" className={inp} /></label>
        <label className={lab}>Téléphone<input name="phone" className={inp} /></label>
        <label className={lab}>E-mail<input name="email" type="email" className={inp} /></label>
        <label className={lab}>Adresse<input name="address" className={inp} /></label>
        <div className="sm:col-span-3">
          <button disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Ajouter au répertoire
          </button>
        </div>
      </form>

      {providers.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <label className={lab}>Sous-traitant concerné
            <select value={target} onChange={(e) => setPicked(e.target.value)} className={inp}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {selected && (
            <p className="text-xs text-slate-500">
              {selected.transportCount === 0
                ? "Aucun transport confié à ce jour."
                : `${selected.transportCount} transport${selected.transportCount > 1 ? "s" : ""} confié${selected.transportCount > 1 ? "s" : ""}.`}
              {selected.engagedFileNumbers.length > 0 && ` En cours : ${selected.engagedFileNumbers.join(", ")}.`}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Agrément :</span>
            {(["APPROVED", "SUSPENDED"] as const).map((s) => {
              const already = selected?.status === s;
              return (
                <button
                  key={s}
                  disabled={pending || !target || already}
                  title={already ? "Le sous-traitant est déjà dans cet état." : undefined}
                  onClick={() => run(() => setProviderStatus(target, s))}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-navy-700 disabled:opacity-40"
                >
                  {s === "APPROVED" ? "Agréer" : "Suspendre"}
                </button>
              );
            })}
            {selected && (
              <button
                disabled={pending}
                onClick={() => run(() => setProviderActive(target, !selected.isActive))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-navy-700 disabled:opacity-40"
              >
                {selected.isActive ? "Retirer du répertoire" : "Réintégrer"}
              </button>
            )}
            {selected && (
              <span className="text-xs text-slate-400">
                État : {selected.status === "APPROVED" ? "Agréé" : "Suspendu"}
                {!selected.isActive && " · retiré"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Un sous-traitant suspendu ou retiré ne peut plus être affecté à un nouveau transport ;
            les transports déjà confiés ne sont pas modifiés.
          </p>
        </div>
      )}

      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
