import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getShippingDashboard } from "@/lib/shipping/intelligence/service";

export const metadata: Metadata = { title: "Lignes maritimes" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function ShippingDashboardPage() {
  const header = (
    <PageHeader
      meta="Transport · Maritime"
      title="Lignes maritimes"
      subtitle="Suivi océanique : escales, jalons canoniques, position et ETA — au-dessus des dossiers et expéditions existants."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé au suivi maritime.</Notice></div>;
  }

  const { dashboard, providers, ais, capped, cap } = await getShippingDashboard();

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="En transit" value={dashboard.inTransit} tone="navy" href="/shipping/shipments?milestone=IN_TRANSIT" />
        <StatCard label="Réservations à confirmer" value={dashboard.bookingsAwaitingConfirmation} tone="amber" />
        <StatCard label="Conteneurs chargés" value={dashboard.containersLoaded} tone="teal" href="/shipping/containers" />
        <StatCard label="Arrivées sous 7 j" value={dashboard.vesselsArrivingWithin7Days} tone="navy" />
        <StatCard label="Retards" value={dashboard.delayed} tone="amber" />
        <StatCard label="Changements d'ETA" value={dashboard.etaChanges} tone="amber" />
        <StatCard label="Suivi ancien" value={dashboard.staleTracking} tone="slate" />
        <StatCard label="Exceptions" value={dashboard.exceptions} tone="amber" />
        <StatCard label="Transbordement" value={dashboard.containersAtTransshipment} tone="slate" />
        <StatCard label="Attente douane" value={dashboard.containersAwaitingCustoms} tone="amber" />
        <StatCard label="Livrées" value={dashboard.delivered} tone="teal" />
        <StatCard label="Total expéditions" value={dashboard.total} tone="slate" href="/shipping/shipments" />
      </div>

      {capped && (
        <p className="text-xs text-amber-700">Indicateurs bornés aux {cap} expéditions les plus récentes.</p>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/shipping/shipments" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Expéditions</Link>
        <Link href="/shipping/containers" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Conteneurs</Link>
        <Link href="/shipping/alerts" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 hover:border-amber-300">File d&apos;attention</Link>
        <span className="mx-1 text-slate-300">·</span>
        <Link href="/shipping/carriers" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Transporteurs</Link>
        <Link href="/shipping/ports" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Ports</Link>
        <Link href="/shipping/vessels" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Navires</Link>
        <Link href="/shipping/voyages" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Voyages</Link>
      </div>

      {/* Provider readiness — carriers and AIS reported honestly, never as live integrations. */}
      <div className="surface p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseurs de suivi</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <div key={p.providerCode} className="flex items-center gap-2">
              <span className="font-medium text-navy-800">{p.displayName}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.live ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                {p.status === "configured" ? "Actif" : "Non connecté"}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="font-medium text-navy-800">{ais.displayName}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Non connecté (licence AIS requise)</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Aucune API transporteur ni AIS n&apos;est connectée (intégration par contrat officiel — voir la fiche de préparation). Suivi manuel disponible.
        </p>
      </div>
    </div>
  );
}
