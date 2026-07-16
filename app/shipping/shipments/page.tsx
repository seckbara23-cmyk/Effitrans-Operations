import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listOceanShipments, type ShipmentFilters } from "@/lib/shipping/intelligence/service";
import { SHIPPING_MILESTONES, milestoneLabel } from "@/lib/shipping/intelligence/milestones";
import { SHIPPING_PROVIDERS, CARRIER_DISPLAY_NAMES } from "@/lib/shipping/intelligence/provider";

export const metadata: Metadata = { title: "Expéditions maritimes" };
export const dynamic = "force-dynamic";

const STYLE: Record<string, string> = {
  IN_TRANSIT: "bg-sky-50 text-sky-700", VESSEL_DEPARTED: "bg-sky-50 text-sky-700", VESSEL_ARRIVED: "bg-teal-50 text-teal-700",
  DELIVERED: "bg-teal-50 text-teal-700", COMPLETED: "bg-teal-50 text-teal-700", EXCEPTION: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ShipmentsPage({ searchParams }: { searchParams?: SP }) {
  const header = <PageHeader meta="Maritime" title="Expéditions" subtitle="Expéditions océaniques (SEA / multimodal)." />;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé.</Notice></div>;

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const filters: ShipmentFilters = { search: one(sp.q), milestone: one(sp.milestone), provider: one(sp.provider) };
  const list = await listOceanShipments(filters, page);

  const qs = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: filters.search, milestone: filters.milestone, provider: filters.provider, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/shipping/shipments?${s}` : "/shipping/shipments";
  };

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      <form className="flex flex-wrap items-center gap-2" action="/shipping/shipments">
        <input name="q" defaultValue={filters.search ?? ""} placeholder="Réservation, BL, origine, destination…" className="w-64 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
        <select name="milestone" defaultValue={filters.milestone ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">Tous les jalons</option>
          {SHIPPING_MILESTONES.map((m) => <option key={m} value={m}>{milestoneLabel(m)}</option>)}
        </select>
        <select name="provider" defaultValue={filters.provider ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">Tous fournisseurs</option>
          {SHIPPING_PROVIDERS.map((p) => <option key={p} value={p}>{CARRIER_DISPLAY_NAMES[p] ?? p}</option>)}
        </select>
        <button className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800">Filtrer</button>
      </form>

      {list.items.length === 0 ? (
        <Notice>Aucune expédition maritime ne correspond.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Transporteur</th>
                  <th className="px-4 py-3 font-semibold">Réservation / BL</th>
                  <th className="px-4 py-3 font-semibold">Trajet</th>
                  <th className="px-4 py-3 font-semibold">Conteneurs</th>
                  <th className="px-4 py-3 font-semibold">Jalon</th>
                  <th className="px-4 py-3 font-semibold">ETA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/shipping/shipments/${s.id}`} className="tabular font-medium text-teal-700 hover:underline">{s.fileNumber ?? "—"}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.clientName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{s.carrierName ?? "—"}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{s.bookingReference ?? s.masterBl ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{(s.origin ?? "—") + " → " + (s.destination ?? "—")}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{s.containerCount}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[s.milestone] ?? "bg-slate-100 text-slate-600"}`}>{s.milestoneLabel}</span></td>
                    <td className="px-4 py-3 tabular text-slate-500">{s.estimatedArrival?.slice(0, 10) ?? "—"}</td>
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
          {page > 0 && <Link href={qs({ page: String(page - 1) })} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">← Précédent</Link>}
          {list.hasMore && <Link href={qs({ page: String(page + 1) })} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">Suivant →</Link>}
        </div>
      </div>

      <p className="text-xs text-slate-400"><Link href="/shipping" className="text-teal-700 hover:underline">← Tableau maritime</Link></p>
    </div>
  );
}
