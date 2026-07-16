import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { PlatformCard } from "@/components/logistics/platform-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCommandCenter } from "@/lib/logistics/reader";
import { transportNextAction } from "@/lib/departments/classify";
import type { TransportStatus } from "@/lib/transport/types";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Transport & Logistique" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}
const MODE_ICON: Record<string, string> = { road: "🚚", ocean: "🚢", air: "✈️", customs: "🛃" };
const SEV: Record<string, string> = { critical: "bg-red-50 text-red-700", warning: "bg-amber-50 text-amber-700", info: "bg-slate-100 text-slate-600" };
const RSTATUS = (s: string) => (t.transport.statuses as Record<string, string>)[s] ?? s;

export default async function LogisticsCommandCenterPage() {
  const header = (
    <PageHeader
      meta="Logistique"
      title="Transport & Logistique"
      subtitle="Pilotage consolidé des opérations routières, maritimes, aériennes et douanières."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé au transport.</Notice></div>;
  }

  const cc = await getCommandCenter();
  const card = (mode: string) => cc.cards.find((c) => c.mode === mode) ?? null;
  const h = cc.headline;

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* Cross-modal headline KPIs (sums across modes — see logistics-kpi-definitions.md). */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <StatCard label="Mouvements en cours" value={h.movementsInProgress} tone="navy" href="/shipping/shipments" />
        <StatCard label="Arrivées sous 7 j" value={h.arrivingWithin7Days} tone="navy" />
        <StatCard label="Opérations en retard" value={h.overdueOps} tone="amber" />
        <StatCard label="Alertes critiques" value={h.criticalAlerts} tone="red" />
        <StatCard label="En attente de douane" value={h.awaitingCustoms} tone="amber" href={cc.customsAuthorized ? "/customs/intelligence" : undefined} />
        <StatCard label="Exceptions" value={h.exceptions} tone="amber" />
      </div>

      {/* Operational platform cards. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformCard card={card("road")} title="Transport routier" icon={MODE_ICON.road} href="/transport" cta="Ouvrir les opérations routières" />
        <PlatformCard card={card("ocean")} title="Lignes maritimes" icon={MODE_ICON.ocean} href="/shipping" cta="Ouvrir Ocean Shipping" />
        <PlatformCard card={card("air")} title="Fret aérien" icon={MODE_ICON.air} href="/air" cta="Ouvrir Air Cargo" />
        <PlatformCard card={card("customs")} title="Intelligence douanière" icon={MODE_ICON.customs} href="/customs/intelligence" cta="Ouvrir Customs Intelligence" unauthorized={!cc.customsAuthorized} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Unified attention queue. */}
        <div className="surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-navy-900">File d&apos;attention consolidée</h2>
            <span className="text-xs text-slate-400">Toutes modalités</span>
          </div>
          {cc.attention.length === 0 ? (
            <p className="text-xs text-slate-500">Aucune alerte active.</p>
          ) : (
            <ul className="space-y-1.5">
              {cc.attention.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span aria-hidden>{MODE_ICON[a.mode]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEV[a.severity]}`}>{a.severity}</span>
                  <Link href={a.link} className="flex-1 truncate text-slate-700 hover:text-teal-700">
                    {a.reference ? <span className="tabular font-medium text-navy-800">{a.reference} · </span> : null}{a.reason}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-3 text-xs text-slate-400">
            <Link href="/shipping/alerts" className="hover:text-teal-700">Alertes maritimes →</Link>
            <Link href="/air/alerts" className="hover:text-teal-700">Alertes aériennes →</Link>
          </div>
        </div>

        {/* Upcoming movements. */}
        <div className="surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Mouvements à venir</h2>
          {cc.upcoming.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun mouvement daté à venir.</p>
          ) : (
            <ul className="space-y-1.5">
              {cc.upcoming.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span aria-hidden>{MODE_ICON[m.mode]}</span>
                  <span className="tabular w-24 shrink-0 text-xs text-slate-400">{m.at.slice(0, 10)}</span>
                  <Link href={m.link} className="flex-1 truncate text-slate-700 hover:text-teal-700">
                    <span className="tabular font-medium text-navy-800">{m.reference ?? "—"}</span>
                    <span className="ml-2 text-xs text-slate-500">{m.route}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cross-modal journey snapshot (projection over authoritative domain facts). */}
      <div className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Aperçu des parcours (dossiers récents)</h2>
        {cc.journey.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun dossier opérationnel récent.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">Dossier</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Maritime</th><th className="px-3 py-2">Aérien</th><th className="px-3 py-2">Douane</th><th className="px-3 py-2">Route</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cc.journey.map((j, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 tabular font-medium text-navy-800">{j.fileNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{j.clientName ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{j.ocean ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{j.air ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{j.customs ? ((t.customs.statuses as Record<string, string>)[j.customs] ?? j.customs) : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{j.road ? RSTATUS(j.road) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">Chaque module reste autoritatif pour son état ; ceci est une projection en lecture seule.</p>
      </div>

      {/* Road dispatch queue (the road workspace lives here). */}
      <div className="surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-900">File de dispatch routier</h2>
          <Link href="/transport" className="text-xs text-teal-700 hover:underline">Vue transport complète →</Link>
        </div>
        {!cc.roadAvailable ? (
          <p className="text-xs text-slate-500">Module routier indisponible.</p>
        ) : cc.roadRows.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun dossier transport à traiter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">Dossier</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Chauffeur</th><th className="px-3 py-2">Véhicule</th><th className="px-3 py-2">Livraison prévue</th><th className="px-3 py-2">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cc.roadRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2"><Link href={`/files/${r.fileId}`} className="tabular font-medium text-teal-700 hover:underline">{r.fileNumber ?? "—"}</Link></td>
                    <td className="px-3 py-2 text-slate-600">{r.clientName ?? t.common.none}</td>
                    <td className="px-3 py-2 text-slate-600">{RSTATUS(r.status)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.driverName ?? t.common.none}</td>
                    <td className="px-3 py-2 tabular text-slate-600">{r.vehiclePlate ?? t.common.none}</td>
                    <td className="px-3 py-2 text-slate-600">{r.deliveryPlanned ?? t.common.none}</td>
                    <td className="px-3 py-2"><Link href={`/files/${r.fileId}`} className="text-xs font-medium text-navy-700 hover:text-teal-700">{transportNextAction(r.status as TransportStatus).label} →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick navigation. */}
      <div className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Accès rapide</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/transport" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">🚚 Transport routier</Link>
          <Link href="/shipping" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">🚢 Ocean Shipping</Link>
          <Link href="/air" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">✈️ Air Cargo</Link>
          <Link href="/customs/intelligence" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">🛃 Intelligence douanière</Link>
          <Link href="/shipping/alerts" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-teal-300">Alertes</Link>
          {cc.docIntel && (cc.docIntel.readyForReview > 0 || cc.docIntel.failed > 0) && (
            <Link href="/files" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-800 hover:border-sky-300">📄 Documents à revoir ({cc.docIntel.readyForReview}{cc.docIntel.failed > 0 ? ` · ${cc.docIntel.failed} échec` : ""})</Link>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">Centre de suivi : positions, routes, escales, vols et livraisons disponibles depuis chaque plateforme.</p>
      </div>
    </div>
  );
}
