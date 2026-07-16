import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listAirports } from "@/lib/air/intelligence/manage-service";
import { AirportForm, RetireControl } from "@/components/air/air-management-forms";

export const metadata: Metadata = { title: "Aéroports" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function AirportsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Aérien" title="Aéroports" subtitle="Aéroports (IATA/ICAO). Aucune coordonnée n'est inventée ; sans coordonnées → non cartographiable." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canManage = hasPermission(permissions, "transport:manage");
  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const list = await listAirports({ search: one(sp.q), active: one(sp.active) }, page);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {canManage && <AirportForm />}
      <form action="/air/airports" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={one(sp.q) ?? ""} placeholder="Nom, pays ou IATA…" className="w-64 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="active" defaultValue={one(sp.active) ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="">Tous</option><option value="active">Actifs</option><option value="inactive">Retirés</option></select>
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white">Filtrer</button>
      </form>
      {list.items.length === 0 ? <Notice>Aucun aéroport. Ajoutez l&apos;aéroport de Dakar, l&apos;origine et la destination.</Notice> : (
        <div className="surface overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Nom</th><th className="px-4 py-3">IATA</th><th className="px-4 py-3">Pays</th><th className="px-4 py-3">Carte</th><th className="px-4 py-3">État</th>{canManage && <th className="px-4 py-3"></th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">{list.items.map((p) => (<tr key={p.id} className="hover:bg-slate-50/60"><td className="px-4 py-3 font-medium text-navy-800">{p.name}</td><td className="px-4 py-3 tabular text-slate-600">{p.iata ?? "—"}</td><td className="px-4 py-3 text-slate-600">{p.country ?? "—"}</td><td className="px-4 py-3">{p.mappable ? <span className="text-teal-700">✓</span> : <span className="text-slate-400">indisponible</span>}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${p.active ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-400"}`}>{p.active ? "Actif" : "Retiré"}</span></td>{canManage && <td className="px-4 py-3"><RetireControl entity="airport" id={p.id} active={p.active} /></td>}</tr>))}</tbody>
        </table></div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/air/airports?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/air/airports?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/air" className="text-teal-700 hover:underline">← Tableau aérien</Link></p>
    </div>
  );
}
