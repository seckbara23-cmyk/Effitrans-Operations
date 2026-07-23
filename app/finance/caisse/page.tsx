/**
 * Caisse & Trésorerie workspace — FOUNDATION SHELL (Phase 9.3A).
 * ---------------------------------------------------------------------------
 * A FINANCE workspace (not a department). The employee title (Caissier/
 * Caissière) is a ROLE label only — this workspace is named "Caisse".
 *
 * Server-side gated on `caisse:manage` — the dedicated treasury-operations
 * permission, deliberately distinct from finance authorization
 * (validate/issue/void/delete/payment). Uses the standard session resolution;
 * NO service-role client, no new bypass.
 *
 * This is the FOUNDATION only: it describes the multi-channel treasury capability
 * (cash, checks, Mobile Money, bank movements) and states plainly that the
 * operational engine arrives in a later phase. It renders NO balances, NO
 * transactions, NO accounts, NO reconciliation — there are no treasury tables yet
 * and nothing fabricated is shown.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const metadata: Metadata = { title: "Caisse" };
export const dynamic = "force-dynamic";

/** Capability groups — clearly labelled as the FUTURE functional boundary. */
const GROUPS: { title: string; items: string[] }[] = [
  {
    title: "Moyens de paiement",
    items: ["Espèces", "Chèques", "Mobile Money (Wave, Orange Money)", "Comptes bancaires"],
  },
  {
    title: "Opérations",
    items: ["Encaissements", "Décaissements", "Dépôts", "Retraits", "Virements approuvés", "Remboursements"],
  },
  {
    title: "Contrôle",
    items: ["Pièces justificatives", "Cahier de caisse", "Rapprochement journalier", "Clôture par moyen de paiement"],
  },
];

export default async function CaissePage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  // The dedicated treasury-operations permission — finance:read alone is NOT enough.
  if (!hasPermission(permissions, "caisse:manage")) notFound();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance"
        title="Caisse"
        subtitle="Gestion des opérations de caisse et de trésorerie"
      />

      <div className="surface space-y-2 p-6">
        <p className="text-sm text-slate-600">
          Le poste de caisse centralisera les opérations en espèces, par chèque, Mobile Money
          et via les comptes bancaires autorisés.
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">Fonctionnalité à venir</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Le poste de caisse et de trésorerie est configuré. La gestion opérationnelle des
            encaissements, décaissements, chèques, opérations Mobile Money et mouvements bancaires
            sera activée dans la prochaine phase.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <section key={g.title} className="surface p-4">
            <h2 className="text-sm font-semibold text-navy-900">{g.title}</h2>
            <ul className="mt-2 space-y-1">
              {g.items.map((it) => (
                <li key={it} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden />
                  {it}
                  <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">à venir</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Caisse est un espace de travail du département Finance. Les opérations de trésorerie
        (multi-canal) seront disponibles dans une prochaine étape.
      </p>
    </div>
  );
}
