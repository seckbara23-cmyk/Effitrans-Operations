import Link from "next/link";
import { listCompanies } from "@/lib/platform/companies";

export const dynamic = "force-dynamic";

export default async function PlatformCompanies() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Entreprises</h1>
          <p className="mt-1 text-sm text-slate-400">{companies.length} entreprise(s) sur la plateforme.</p>
        </div>
        <Link
          href="/platform/companies/new"
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400"
        >
          Nouvelle entreprise
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-slate-400">
          Aucune entreprise pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/5 text-left text-[12px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Entreprise</th>
                <th className="px-4 py-3 font-semibold">Statut</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Utilisateurs</th>
                <th className="px-4 py-3 font-semibold">Dossiers actifs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link href={`/platform/companies/${c.id}`} className="font-semibold text-white hover:text-teal-300">
                      {c.displayName}
                    </Link>
                    <span className="ml-2 text-slate-500">{c.slug ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{c.lifecycleStatus}</td>
                  <td className="px-4 py-3 text-slate-300">{c.planKey ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{c.userCount}</td>
                  <td className="px-4 py-3 text-slate-300">{c.activeDossierCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
