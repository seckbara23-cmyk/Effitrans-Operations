import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listUldsAll } from "@/lib/air/intelligence/service";

export const metadata: Metadata = { title: "ULD" };
export const dynamic = "force-dynamic";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function UldsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const header = <PageHeader meta="Aérien" title="ULD" subtitle="Unités de chargement. La création s'effectue sur l'expédition." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const page = Math.max(0, Number.parseInt(one(searchParams?.page) ?? "0", 10) || 0);
  const list = await listUldsAll(page);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {list.items.length === 0 ? <Notice>Aucun ULD.</Notice> : (
        <div className="surface overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">ULD</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Dossier</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{list.items.map((u) => (<tr key={u.id} className="hover:bg-slate-50/60"><td className="px-4 py-3"><Link href={`/air/shipments/${u.shipmentId}`} className="tabular font-medium text-teal-700 hover:underline">{u.number}</Link></td><td className="px-4 py-3 text-slate-600">{u.type ?? "—"}</td><td className="px-4 py-3 text-slate-600">{u.status}</td><td className="px-4 py-3 tabular text-slate-600">{u.fileNumber ?? "—"}</td></tr>))}</tbody>
        </table></div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/air/ulds?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/air/ulds?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/air" className="text-teal-700 hover:underline">← Tableau aérien</Link></p>
    </div>
  );
}
