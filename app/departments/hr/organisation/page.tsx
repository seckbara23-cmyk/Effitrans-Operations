/**
 * HR-1 — the read-only organization tree. Gate: hr:read.
 * ---------------------------------------------------------------------------
 * Visualization ONLY (frozen scope): no drag, no inline edit — structure is
 * edited in the configuration workspace (hr:config:manage), and even that
 * stays dark until HRQ-D2 grants the permission. Server-rendered nested
 * lists; no client component is needed for a read-only tree.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  buildOrgTree,
  listOrgUnits,
  UNIT_KIND_LABEL_FR,
  type OrgTreeNode,
  type UnitKind,
} from "@/lib/hr/organization";

export const metadata: Metadata = { title: "Organisation — RH" };
export const dynamic = "force-dynamic";

const KIND_BADGE: Record<string, string> = {
  BUSINESS_UNIT: "bg-navy-900 text-white",
  DEPARTMENT: "bg-teal-50 text-teal-700",
  SECTION: "bg-slate-100 text-slate-600",
  TEAM: "bg-sand-50 text-slate-600",
};

function UnitNode({ node }: { node: OrgTreeNode }) {
  return (
    <li className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_BADGE[node.unit_kind] ?? "bg-slate-100 text-slate-600"}`}>
          {UNIT_KIND_LABEL_FR[node.unit_kind as UnitKind] ?? node.unit_kind}
        </span>
        <span className={`text-sm font-medium ${node.is_active ? "text-navy-900" : "text-slate-400 line-through"}`}>
          {node.name}
        </span>
        {node.code && <span className="font-mono text-xs text-slate-400">{node.code}</span>}
        {node.canonical_department && (
          <span className="text-[11px] text-slate-400" title="Correspondance plateforme">
            ↔ {node.canonical_department}
          </span>
        )}
        {!node.is_active && <span className="text-[11px] text-slate-400">(inactive)</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-5 border-l border-slate-200 pl-4">
          {node.children.map((c) => (
            <UnitNode key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function HrOrganisationPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Organisation" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();

  const units = await listOrgUnits(user.tenantId);
  const tree = buildOrgTree(units);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Organisation"
        subtitle="Structure de l'employeur — lecture seule. L'édition passe par le centre de configuration."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">
        ← Tableau de bord RH
      </Link>

      {tree.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">
          Aucune unité d'organisation n'est encore définie. La structure est créée dans le
          centre de configuration — accessible aux titulaires de « hr:config:manage »
          (ratification HRQ-D2 en attente).
        </div>
      ) : (
        <div className="surface p-5">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            Société : l'organisation elle-même — les unités ci-dessous en descendent
          </p>
          <ul className="text-sm">
            {tree.map((n) => (
              <UnitNode key={n.id} node={n} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
