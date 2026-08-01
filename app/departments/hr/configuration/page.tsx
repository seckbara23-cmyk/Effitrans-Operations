/**
 * HR-1 — the permanent configuration workspace (the "setup wizard", ratified
 * as a configuration CENTER, never one-time — addendum §1–2).
 * ---------------------------------------------------------------------------
 * Gate: hr:config:manage. That permission is a catalog row GRANTED TO NOBODY
 * until HRQ-D2 is ratified — so in production this page currently shows the
 * named dependency to hr:read holders and 404s to everyone else. The B1 pause,
 * visible instead of silent.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  getHrConfiguration,
  listOrgUnits,
  listPositions,
  listWorkLocations,
} from "@/lib/hr/organization";
import { HrConfigurationStudio } from "@/components/hr/configuration-studio";

export const metadata: Metadata = { title: "Configuration RH" };
export const dynamic = "force-dynamic";

export default async function HrConfigurationPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Configuration" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();

  if (!hasPermission(permissions, "hr:config:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Centre de configuration" subtitle="Structure, postes, numérotation et vocabulaires RH." />
        <div className="surface p-6 text-sm text-slate-600">
          Ce centre requiert l'autorisation « hr:config:manage ». Cette autorisation existe
          au catalogue mais n'est attribuée à aucun rôle : la ratification HRQ-D2
          (plafond 9 → 11) est en attente. Aucune configuration n'est possible avant elle.
        </div>
        <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      </div>
    );
  }

  const [config, units, positions, locations] = await Promise.all([
    getHrConfiguration(user.tenantId),
    listOrgUnits(user.tenantId),
    listPositions(user.tenantId),
    listWorkLocations(user.tenantId),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Centre de configuration"
        subtitle="Permanent — la structure, les postes, la numérotation et les vocabulaires se gèrent ici, aujourd'hui comme demain."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <HrConfigurationStudio config={config} units={units} positions={positions} locations={locations} />
    </div>
  );
}
