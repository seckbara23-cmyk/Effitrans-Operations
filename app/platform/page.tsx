import { getPlatformCompanyStats } from "@/lib/platform/companies";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="text-[13px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

export default async function PlatformDashboard() {
  const stats = await getPlatformCompanyStats();

  const cards = [
    { label: "Entreprises", value: stats.total },
    { label: "Actives", value: stats.active },
    { label: "Essai", value: stats.trial },
    { label: "Suspendues", value: stats.suspended },
    { label: "Archivées", value: stats.archived },
    { label: "Utilisateurs (tenant)", value: stats.totalUsers },
    { label: "IA activée", value: stats.aiEnabled },
    { label: "Tracking activé", value: stats.trackingEnabled },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tableau de bord</h1>
        <p className="mt-1 text-sm text-slate-400">Vue d&apos;ensemble des entreprises de la plateforme.</p>
      </div>

      {stats.total === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-slate-400">
          Aucune entreprise pour le moment.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <StatCard key={c.label} label={c.label} value={c.value} />
          ))}
        </div>
      )}
    </div>
  );
}
