import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listVesselsManaged, listCarrierOptions } from "@/lib/shipping/intelligence/manage-service";
import { VesselForm, RetireControl } from "@/components/shipping/management-forms";

export const metadata: Metadata = { title: "Navires" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function VesselsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Navires" subtitle="Navires (IMO / MMSI validés séparément). Aucune position AIS n'est connectée (licence requise)." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canManage = hasPermission(permissions, "transport:manage");

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const [list, carriers] = await Promise.all([listVesselsManaged({ search: one(sp.q), active: one(sp.active) }, page), canManage ? listCarrierOptions() : Promise.resolve([])]);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {canManage && <VesselForm carriers={carriers} />}
      <form action="/shipping/vessels" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={one(sp.q) ?? ""} placeholder="Nom, IMO ou MMSI…" className="w-56 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="active" defaultValue={one(sp.active) ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="">Tous</option><option value="active">Actifs</option><option value="inactive">Retirés</option></select>
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white">Filtrer</button>
      </form>
      {list.items.length === 0 ? <Notice>Aucun navire référencé.</Notice> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Navire</th><th className="px-4 py-3">IMO</th><th className="px-4 py-3">MMSI</th><th className="px-4 py-3">Transporteur</th><th className="px-4 py-3">État</th>{canManage && <th className="px-4 py-3"></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-navy-800">{v.name}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{v.imo ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{v.mmsi ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.carrierName ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${v.active ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-400"}`}>{v.active ? "Actif" : "Retiré"}</span></td>
                  {canManage && <td className="px-4 py-3"><RetireControl entity="vessel" id={v.id} active={v.active} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/shipping/vessels?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/shipping/vessels?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link> · <Link href="/shipping/voyages" className="text-teal-700 hover:underline">Voyages</Link></p>
    </div>
  );
}
