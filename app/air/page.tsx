import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAirDashboard } from "@/lib/air/intelligence/service";

export const metadata: Metadata = { title: "Fret aérien" };
export const dynamic = "force-dynamic";
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function AirDashboardPage() {
  const header = <PageHeader meta="Transport · Aérien" title="Fret aérien" subtitle="Suivi aérien : vols, ULD, jalons canoniques, position et ETA — au-dessus des dossiers et expéditions existants." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé au suivi aérien.</Notice></div>;

  const { dashboard: d, providers, capped, cap } = await getAirDashboard();
  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Vols aujourd'hui" value={d.flightsToday} tone="navy" />
        <StatCard label="Attente chargement" value={d.awaitingLoading} tone="amber" />
        <StatCard label="En vol" value={d.inFlight} tone="navy" href="/air/shipments?milestone=DEPARTED" />
        <StatCard label="Transfert" value={d.transferred} tone="slate" />
        <StatCard label="Arrivées sous 7 j" value={d.arriving} tone="navy" />
        <StatCard label="Retards" value={d.delayed} tone="amber" />
        <StatCard label="Douane" value={d.customs} tone="amber" href="/air/shipments?milestone=CUSTOMS" />
        <StatCard label="Mainlevées" value={d.released} tone="teal" />
        <StatCard label="Exceptions" value={d.exceptions} tone="amber" />
        <StatCard label="Suivi ancien" value={d.staleTracking} tone="slate" />
        <StatCard label="Livrées" value={d.delivered} tone="teal" />
        <StatCard label="Total" value={d.total} tone="slate" href="/air/shipments" />
      </div>
      <div className="surface p-3 text-sm"><span className="text-slate-500">Délai de transit moyen : </span><span className="tabular font-medium">{d.averageTransitDays == null ? "—" : `${d.averageTransitDays} j`}</span></div>
      {capped && <p className="text-xs text-amber-700">Indicateurs bornés aux {cap} expéditions les plus récentes.</p>}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/air/shipments" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Expéditions</Link>
        <Link href="/air/ulds" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">ULD</Link>
        <Link href="/air/alerts" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 hover:border-amber-300">File d&apos;attention</Link>
        <span className="mx-1 text-slate-300">·</span>
        <Link href="/air/airlines" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Compagnies</Link>
        <Link href="/air/airports" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Aéroports</Link>
        <Link href="/air/flights" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Vols</Link>
      </div>
      <div className="surface p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseurs de suivi</h2>
        <div className="flex flex-wrap gap-3">{providers.map((p) => <span key={p.providerCode} className="flex items-center gap-2"><span className="font-medium text-navy-800">{p.displayName}</span><span className={`rounded-full px-2 py-0.5 text-xs ${p.live ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>{p.status === "configured" ? "Actif" : "Non connecté"}</span></span>)}</div>
        <p className="mt-2 text-xs text-slate-400">Aucune API compagnie/IATA/FlightRadar connectée (intégration par contrat officiel — 7.3B). Suivi manuel disponible.</p>
      </div>
    </div>
  );
}
