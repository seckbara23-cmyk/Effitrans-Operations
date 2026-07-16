import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listAirShipments, type AirFilters } from "@/lib/air/intelligence/service";
import { AIR_MILESTONES, airMilestoneLabel } from "@/lib/air/intelligence/milestones";

export const metadata: Metadata = { title: "Expéditions aériennes" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }
const STYLE: Record<string, string> = { DEPARTED: "bg-sky-50 text-sky-700", ARRIVED: "bg-teal-50 text-teal-700", DELIVERED: "bg-teal-50 text-teal-700", EXCEPTION: "bg-red-50 text-red-700", CANCELLED: "bg-slate-100 text-slate-400 line-through" };

export default async function AirShipmentsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Aérien" title="Expéditions" subtitle="Expéditions aériennes (transport_mode AIR)." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const filters: AirFilters = { search: one(sp.q), milestone: one(sp.milestone) };
  const list = await listAirShipments(filters, page);
  const qs = (o: Record<string, string | undefined>) => { const n = new URLSearchParams(); const m = { q: filters.search, milestone: filters.milestone, ...o }; for (const [k, v] of Object.entries(m)) if (v) n.set(k, v); const s = n.toString(); return s ? `/air/shipments?${s}` : "/air/shipments"; };

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <form action="/air/shipments" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={filters.search ?? ""} placeholder="Origine, destination…" className="w-56 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="milestone" defaultValue={filters.milestone ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="">Tous jalons</option>{AIR_MILESTONES.map((m) => <option key={m} value={m}>{airMilestoneLabel(m)}</option>)}</select>
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white">Filtrer</button>
      </form>
      {list.items.length === 0 ? <Notice>Aucune expédition aérienne.</Notice> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Dossier</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">MAWB</th><th className="px-4 py-3">Trajet</th><th className="px-4 py-3">Jalon</th><th className="px-4 py-3">ETA</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><Link href={`/air/shipments/${s.id}`} className="tabular font-medium text-teal-700 hover:underline">{s.fileNumber ?? "—"}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{s.clientName ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{s.mawb ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{(s.origin ?? "—") + " → " + (s.destination ?? "—")}</td>
                  <td className="px-4 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[s.milestone] ?? "bg-slate-100 text-slate-600"}`}>{s.milestoneLabel}</span></td>
                  <td className="px-4 py-3 tabular text-slate-500">{s.estimatedArrival?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={qs({ page: String(page - 1) })} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={qs({ page: String(page + 1) })} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/air" className="text-teal-700 hover:underline">← Tableau aérien</Link></p>
    </div>
  );
}
