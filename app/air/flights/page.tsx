import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listFlights, listAirlineOptions, listAirportOptions } from "@/lib/air/intelligence/manage-service";
import { FlightForm } from "@/components/air/air-management-forms";

export const metadata: Metadata = { title: "Vols" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function FlightsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Aérien" title="Vols" subtitle="Vols (compagnie, aéroports, horaires). L'arrivée ne peut précéder le départ." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canManage = hasPermission(permissions, "transport:manage");
  const page = Math.max(0, Number.parseInt(one((searchParams ?? {}).page) ?? "0", 10) || 0);
  const [list, airlines, airports] = await Promise.all([listFlights(page), canManage ? listAirlineOptions() : Promise.resolve([]), canManage ? listAirportOptions() : Promise.resolve([])]);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {canManage && <FlightForm airlines={airlines} airports={airports} />}
      {list.items.length === 0 ? <Notice>Aucun vol.</Notice> : (
        <div className="surface overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Vol</th><th className="px-4 py-3">Compagnie</th><th className="px-4 py-3">Trajet</th><th className="px-4 py-3">Départ prévu</th><th className="px-4 py-3">Statut</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{list.items.map((f) => (<tr key={f.id} className="hover:bg-slate-50/60"><td className="px-4 py-3 tabular font-medium text-navy-800">{f.flightNumber ?? "—"}</td><td className="px-4 py-3 text-slate-600">{f.airlineName ?? "—"}</td><td className="px-4 py-3 tabular text-slate-600">{(f.origin ?? "—") + " → " + (f.destination ?? "—")}</td><td className="px-4 py-3 tabular text-slate-500">{f.scheduledDeparture?.slice(0, 16).replace("T", " ") ?? "—"}</td><td className="px-4 py-3 text-slate-600">{f.status}</td></tr>))}</tbody>
        </table></div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/air/flights?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/air/flights?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/air" className="text-teal-700 hover:underline">← Tableau aérien</Link></p>
    </div>
  );
}
