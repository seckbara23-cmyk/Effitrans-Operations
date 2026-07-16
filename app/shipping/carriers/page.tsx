import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCarriers } from "@/lib/shipping/intelligence/manage-service";
import { CarrierForm, RetireControl } from "@/components/shipping/management-forms";

export const metadata: Metadata = { title: "Transporteurs" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function CarriersPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Transporteurs" subtitle="Compagnies maritimes (référentiel tenant). Créer un transporteur n'active aucune API." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canManage = hasPermission(permissions, "transport:manage");

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const list = await listCarriers({ search: one(sp.q), active: one(sp.active) }, page);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {canManage && <CarrierForm />}
      <form action="/shipping/carriers" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={one(sp.q) ?? ""} placeholder="Nom ou code…" className="w-56 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="active" defaultValue={one(sp.active) ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="">Tous</option><option value="active">Actifs</option><option value="inactive">Retirés</option></select>
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white">Filtrer</button>
      </form>
      {list.items.length === 0 ? <Notice>Aucun transporteur.</Notice> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Nom</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">SCAC</th><th className="px-4 py-3">État</th>{canManage && <th className="px-4 py-3"></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-navy-800">{c.name}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{c.code}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{c.scac ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${c.active ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-400"}`}>{c.active ? "Actif" : "Retiré"}</span></td>
                  {canManage && <td className="px-4 py-3"><RetireControl entity="carrier" id={c.id} active={c.active} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/shipping/carriers?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/shipping/carriers?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link> · <Link href="/shipping/ports" className="text-teal-700 hover:underline">Ports</Link> · <Link href="/shipping/vessels" className="text-teal-700 hover:underline">Navires</Link> · <Link href="/shipping/voyages" className="text-teal-700 hover:underline">Voyages</Link></p>
    </div>
  );
}
