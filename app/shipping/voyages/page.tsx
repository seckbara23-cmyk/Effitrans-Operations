import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listVoyages, listVesselOptions, listPortOptions } from "@/lib/shipping/intelligence/manage-service";
import { VoyageForm } from "@/components/shipping/management-forms";

export const metadata: Metadata = { title: "Voyages" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
function Notice({ children }: { children: React.ReactNode }) { return <div className="surface p-6 text-sm text-slate-600">{children}</div>; }

export default async function VoyagesPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Voyages" subtitle="Voyages (navire, ports, dates). L'arrivée ne peut précéder le départ." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;
  const canManage = hasPermission(permissions, "transport:manage");

  const page = Math.max(0, Number.parseInt(one((searchParams ?? {}).page) ?? "0", 10) || 0);
  const [list, vessels, ports] = await Promise.all([listVoyages(page), canManage ? listVesselOptions() : Promise.resolve([]), canManage ? listPortOptions() : Promise.resolve([])]);

  return (
    <div className="animate-fade-in space-y-5">
      {header}
      {canManage && <VoyageForm vessels={vessels} ports={ports} />}
      {list.items.length === 0 ? <Notice>Aucun voyage.</Notice> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Référence</th><th className="px-4 py-3">Navire</th><th className="px-4 py-3">Trajet</th><th className="px-4 py-3">Départ prévu</th><th className="px-4 py-3">Arrivée prévue</th><th className="px-4 py-3">Statut</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 tabular font-medium text-navy-800">{v.ref ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.vesselName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{(v.originPort ?? "—") + " → " + (v.destinationPort ?? "—")}</td>
                  <td className="px-4 py-3 tabular text-slate-500">{v.plannedDeparture?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-500">{v.plannedArrival?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page + 1}</span><div className="flex gap-2">{page > 0 && <Link href={`/shipping/voyages?page=${page - 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">← Précédent</Link>}{list.hasMore && <Link href={`/shipping/voyages?page=${page + 1}`} className="rounded-md border border-slate-200 px-3 py-1.5">Suivant →</Link>}</div></div>
      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
