/**
 * Paramètres — the tenant settings hub (Phase 5.0E-3, Deliverable 12).
 * ---------------------------------------------------------------------------
 * This route used to render `ModulePage` — a Phase-2 placeholder that, in its own
 * words, was "a credible preview of what the module will handle": no data, no CRUD.
 * The final sidebar puts "Paramètres" in ADMINISTRATION, so leaving it as a stub
 * would have meant shipping a mock as a permanent navigation entry, which is exactly
 * what BLOCKER-3 removed everywhere else.
 *
 * It is now an index over the settings pages that actually EXIST. It creates nothing
 * and configures nothing itself — it is information architecture, which is what let
 * the AI settings stop being a fourth top-level sidebar item.
 *
 * Each card is permission-gated and each destination re-checks server-side.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Paramètres" };

type Card = {
  href: string;
  title: string;
  description: string;
  permission: string;
};

const CARDS: Card[] = [
  {
    href: "/settings/ai",
    title: "Assistant IA",
    description: "Modèle, garde-fous et journal des appels de l'assistant.",
    permission: "admin:config:manage",
  },
  {
    href: "/settings/audit",
    title: "Journal d'audit",
    description: "Trace append-only de chaque action sensible : qui, quoi, quand.",
    permission: "audit:read:all",
  },
  {
    href: "/users",
    title: "Utilisateurs et rôles",
    description: "Comptes du tenant, rôles officiels et permissions effectives.",
    permission: "admin:users:manage",
  },
  {
    href: "/settings/pilot",
    title: "Console pilote",
    description:
      "État effectif du déploiement, matrice des rôles, parcours guidé des 26 étapes, observabilité et inventaire des dossiers.",
    permission: "admin:config:manage",
    // NOT gated on the process being enabled — deliberately. The console now prints WHY
    // the process is off (which of the two gates is closed). Hiding it when the engine
    // is disabled would hide the diagnostic exactly when someone needs it.
  },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  // The sidebar gates this on admin:config:manage; the route re-checks. A hidden link
  // has never been the authorization.
  if (!hasPermission(permissions, "admin:config:manage")) notFound();

  const cards = CARDS.filter((c) => hasPermission(permissions, c.permission));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Administration"
        title="Paramètres"
        subtitle="Configuration du tenant. Chaque page re-vérifie vos droits côté serveur."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-lg border border-slate-200 bg-white p-5 transition-colors hover:border-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <p className="text-sm font-semibold text-navy-900 group-hover:text-teal-700">{c.title}</p>
            <p className="mt-1 text-sm text-slate-600">{c.description}</p>
          </Link>
        ))}
      </div>

      {cards.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucun paramètre accessible avec vos droits.
        </div>
      )}
    </div>
  );
}
