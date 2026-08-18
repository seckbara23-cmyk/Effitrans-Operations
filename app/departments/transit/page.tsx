/**
 * Transit department hub (department realignment).
 * ---------------------------------------------------------------------------
 * TMS-5B — Transit owns CUSTOMS and INTERNATIONAL shipment follow-up: Douane,
 * Intelligence douanière, Suivi maritime, Suivi aérien. Ground-transport
 * execution (Transport & Logistique, Demandes & Exécution, Parc & Flotte) moved
 * to the TRANSPORT department hub — a relocation of navigation only: every
 * route, component and permission is unchanged and still works by deep link.
 *
 * The hub stays gated on any-of customs/transport read because maritime and air
 * follow-up are themselves gated on transport:read; every linked route re-checks.
 *
 * Labels are business domains ("Douane", "Suivi maritime"), never a job title
 * (no "Chef de Transit"/"Déclarant" as a workspace label). « Transporteur
 * maritime » (ocean carrier) is a shipping line — never the Transport
 * department, never a road subcontractor.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const metadata: Metadata = { title: "Transit" };
export const dynamic = "force-dynamic";

/** Any of these grants access to the hub — mirrors the sidebar's permissionsAnyOf. */
const HUB_ANY_OF = ["customs:read", "transport:read"];

const WORKSPACES = [
  { label: "Douane", href: "/departments/customs", permission: "customs:read", desc: "Déclarations, pièces manquantes, dédouanement et Bon à Enlever (BAE)." },
  { label: "Intelligence douanière", href: "/customs/intelligence", permission: "customs:read", desc: "Suivi canonique des déclarations (GAINDE) et tableau de bord douane." },
  { label: "Suivi maritime", href: "/shipping", permission: "transport:read", desc: "Navires, escales, conteneurs et voyages." },
  { label: "Suivi aérien", href: "/air", permission: "transport:read", desc: "Vols, LTA, ULD et aéroports." },
];

export default async function TransitHubPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!HUB_ANY_OF.some((p) => hasPermission(permissions, p))) notFound();

  const visible = WORKSPACES.filter((w) => hasPermission(permissions, w.permission));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Départements"
        title="Transit"
        subtitle="Dédouanement et suivi international des expéditions."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((w) => (
          <Link key={w.href} href={w.href} className="surface block p-4 transition-colors hover:border-teal-300">
            <p className="text-sm font-semibold text-navy-900">{w.label}</p>
            <p className="mt-1 text-xs text-slate-500">{w.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
