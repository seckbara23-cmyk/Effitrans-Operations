import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listContainers, type ContainerFilters } from "@/lib/shipping/intelligence/service";
import { milestoneLabel } from "@/lib/shipping/intelligence/milestones";
import { ContainerReassign } from "@/components/shipping/management-forms";

export const metadata: Metadata = { title: "Conteneurs" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }
const STATUSES = ["EMPTY", "GATE_IN", "LOADED", "ON_VESSEL", "DISCHARGED", "AVAILABLE", "GATED_OUT", "RETURNED"];

export default async function ContainersPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Conteneurs" subtitle="Conteneurs océaniques. La création s'effectue sur l'expédition ; la réaffectation préserve l'historique immuable." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canWrite = hasPermission(permissions, "transport:update");

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const filters: ContainerFilters = { search: one(sp.q), status: one(sp.status), isoType: one(sp.type) };
  const list = await listContainers(filters, page);
  const qs = (over: Record<string, string | undefined>) => { const n = new URLSearchParams(); const m = { q: filters.search, status: filters.status, type: filters.isoType, ...over }; for (const [k, v] of Object.entries(m)) if (v) n.set(k, v); const s = n.toString(); return s ? `/shipping/containers?${s}` : "/shipping/containers"; };

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      <form action="/shipping/containers" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={filters.search ?? ""} placeholder="N° conteneur…" className="w-48 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="">Tous statuts</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input name="type" defaultValue={filters.isoType ?? ""} placeholder="Type ISO" className="w-28 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white">Filtrer</button>
      </form>
      {list.items.length === 0 ? <Notice>Aucun conteneur.</Notice> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Conteneur</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Dossier</th><th className="px-4 py-3">Jalon</th>{canWrite && <th className="px-4 py-3"></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><Link href={`/shipping/shipments/${c.shipmentId}`} className="tabular font-medium text-teal-700 hover:underline">{c.number}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{c.isoType ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{c.status}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{c.fileNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{milestoneLabel(c.milestone)}</td>
                  {canWrite && <td className="px-4 py-3"><ContainerReassign containerId={c.id} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={qs({ page: String(page - 1) })} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={qs({ page: String(page + 1) })} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
