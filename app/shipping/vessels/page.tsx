import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listVessels } from "@/lib/shipping/intelligence/service";

export const metadata: Metadata = { title: "Navires" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function VesselsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Navires" subtitle="Navires référencés (IMO / MMSI)." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;

  const page = Math.max(0, Number.parseInt(one(searchParams?.page) ?? "0", 10) || 0);
  const list = await listVessels(page);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {list.items.length === 0 ? (
        <Notice>Aucun navire référencé. Les positions AIS ne sont pas connectées (licence requise).</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Navire</th>
                  <th className="px-4 py-3 font-semibold">IMO</th>
                  <th className="px-4 py-3 font-semibold">MMSI</th>
                  <th className="px-4 py-3 font-semibold">Pavillon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-navy-800">{v.name}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{v.imo ?? "—"}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{v.mmsi ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{v.flag ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Page {page + 1}</span>
        <div className="flex gap-2">
          {page > 0 && <Link href={`/shipping/vessels?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">← Précédent</Link>}
          {list.hasMore && <Link href={`/shipping/vessels?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">Suivant →</Link>}
        </div>
      </div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
