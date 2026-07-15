"use client";

/**
 * Tenant lifecycle controls (Phase 6.0D). CLIENT.
 * ---------------------------------------------------------------------------
 * Suspend / Reactivate / Archive buttons for the Company Detail header. Shows ONLY
 * the actions valid from the current status (canTransition) — an archived tenant
 * offers nothing, a suspended tenant offers Reactivate + Archive, an active one offers
 * Suspend + Archive. Each action opens a confirmation dialog (never a browser alert)
 * that spells out what happens, whether users lose access, whether data remains, and
 * whether it can be undone.
 *
 * Holds no authority: it calls the platform-gated server actions, which re-check
 * platform:status:update. A refresh reflects the new status because the actions
 * revalidate the page.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { suspendTenant, reactivateTenant, archiveTenant } from "@/lib/platform/lifecycle-actions";
import { canTransition, type LifecycleAction, type LifecycleStatus } from "@/lib/platform/company-metadata";

type Meta = {
  label: string;
  tone: string;
  title: string;
  body: string;
  reversible: string;
  needsReason: boolean;
  run: (tenantId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
};

const META: Record<LifecycleAction, Meta> = {
  suspend: {
    label: "Suspendre",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20",
    title: "Suspendre l'entreprise",
    body: "Les utilisateurs de ce tenant ne pourront plus se connecter ni accéder à l'application, et le processus officiel sera bloqué. Les données sont conservées et restent lisibles par les administrateurs plateforme.",
    reversible: "Réversible — vous pourrez réactiver l'entreprise à tout moment.",
    needsReason: true,
    run: suspendTenant,
  },
  reactivate: {
    label: "Réactiver",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
    title: "Réactiver l'entreprise",
    body: "L'accès des utilisateurs, l'API et le processus officiel sont rétablis. Aucune donnée n'est migrée.",
    reversible: "Réversible.",
    needsReason: false,
    run: reactivateTenant,
  },
  archive: {
    label: "Archiver",
    tone: "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20",
    title: "Archiver l'entreprise",
    // Accurate to the enforced contract (5.0E validation): archiving BLOCKS all tenant
    // access — it is not a tenant-side "read-only" mode. The data is preserved and stays
    // readable ONLY by platform administrators (their reads use the service role, not the
    // tenant session that archiving denies).
    body: "L'accès au tenant est définitivement désactivé : connexion, provisionnement et déploiement bloqués. Aucune donnée n'est supprimée ; elle reste consultable uniquement par les administrateurs plateforme.",
    reversible: "IRRÉVERSIBLE — un tenant archivé ne peut pas être réactivé.",
    needsReason: true,
    run: archiveTenant,
  },
};

export function LifecycleActions({ tenantId, status }: { tenantId: string; status: LifecycleStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const available = (["suspend", "reactivate", "archive"] as LifecycleAction[]).filter((a) =>
    canTransition(a, status),
  );
  if (available.length === 0) return null;

  function confirm(action: LifecycleAction) {
    const meta = META[action];
    setError(null);
    startTransition(async () => {
      const res = await meta.run(tenantId, meta.needsReason ? reason : undefined);
      if (res.ok) {
        setOpen(null);
        setReason("");
        router.refresh();
      } else {
        setError(res.error ?? "échec");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {available.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              setOpen(a);
              setReason("");
              setError(null);
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${META[a].tone}`}
          >
            {META[a].label}
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-navy-950 p-6">
            <h3 className="text-lg font-semibold text-white">{META[open].title}</h3>
            <p className="mt-2 text-sm text-slate-300">{META[open].body}</p>
            <p className="mt-2 text-sm font-medium text-slate-200">{META[open].reversible}</p>

            {META[open].needsReason && (
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Motif (interne, optionnel)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none"
                  placeholder="Ex. impayé, demande client…"
                />
              </label>
            )}

            {error && <p className="mt-3 text-xs font-medium text-red-400">Échec : {error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(null)}
                disabled={pending}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => confirm(open)}
                disabled={pending}
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:opacity-40"
              >
                {pending ? "…" : `Confirmer — ${META[open].label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
