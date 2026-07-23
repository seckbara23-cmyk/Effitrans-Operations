/**
 * Opérations department hub (department realignment).
 * ---------------------------------------------------------------------------
 * Operations owns the customer dossier: clients, dossiers, documentation,
 * assignments and operational communications. This hub is a NAVIGATION entry
 * point — it links to the EXISTING routes (their URLs are unchanged), each shown
 * only when the user can read it. Server-side gated on the same any-of set the
 * sidebar uses (file/client/document read); every linked route re-checks itself.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const metadata: Metadata = { title: "Opérations" };
export const dynamic = "force-dynamic";

/** Any of these grants access to the hub — mirrors the sidebar's permissionsAnyOf. */
const HUB_ANY_OF = ["file:read", "client:read", "document:read"];

const WORKSPACES = [
  { label: "Dossiers", href: "/files", permission: "file:read", desc: "Dossiers d'importation, d'exportation et de transit." },
  { label: "Clients", href: "/clients", permission: "client:read", desc: "Sociétés clientes, contacts et historique des opérations." },
  { label: "Documentation", href: "/departments/documentation", permission: "document:read", desc: "Pièces des dossiers : commerciales, transport, douane, certificats." },
  { label: "Tâches & affectations", href: "/tasks", permission: "task:read", desc: "Actions à mener, échéances et dossiers bloqués." },
  { label: "Communications", href: "/communications", permission: "communication:read", desc: "Communications opérationnelles avec les clients." },
];

export default async function OperationsHubPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!HUB_ANY_OF.some((p) => hasPermission(permissions, p))) notFound();

  const visible = WORKSPACES.filter((w) => hasPermission(permissions, w.permission));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Départements"
        title="Opérations"
        subtitle="Gestion des dossiers clients : dossiers, clients, documentation, affectations et communications."
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
