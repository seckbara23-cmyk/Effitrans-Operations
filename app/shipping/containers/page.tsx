import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listContainers } from "@/lib/shipping/intelligence/service";
import { milestoneLabel } from "@/lib/shipping/intelligence/milestones";

export const metadata: Metadata = { title: "Conteneurs" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ContainersPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Conteneurs" subtitle="Conteneurs océaniques suivis." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;

  const page = Math.max(0, Number.parseInt(one(searchParams?.page) ?? "0", 10) || 0);
  const list = await listContainers(page);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {list.items.length === 0 ? (
        <Notice>Aucun conteneur enregistré.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Conteneur</th>
                  <th className="px-4 py-3 font-semibold">Type ISO</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Jalon expédition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/shipping/shipments/${c.shipmentId}`} className="tabular font-medium text-teal-700 hover:underline">{c.number}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.isoType ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.status}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{c.fileNumber ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{milestoneLabel(c.milestone)}</td>
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
          {page > 0 && <Link href={`/shipping/containers?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">← Précédent</Link>}
          {list.hasMore && <Link href={`/shipping/containers?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">Suivant →</Link>}
        </div>
      </div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
