import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getIntelligenceDashboard, listDeclarations, type DeclarationFilters } from "@/lib/customs/intelligence/service";
import { DECLARATION_STATUSES, declarationLabel } from "@/lib/customs/intelligence/state-machine";
import { CUSTOMS_PROVIDERS } from "@/lib/customs/intelligence/provider";

export const metadata: Metadata = { title: "Intelligence douanière" };
export const dynamic = "force-dynamic";

const CANON_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SUBMITTED: "bg-sky-50 text-sky-700",
  ACCEPTED: "bg-sky-50 text-sky-700",
  UNDER_REVIEW: "bg-amber-50 text-amber-700",
  INSPECTION: "bg-amber-50 text-amber-700",
  AWAITING_PAYMENT: "bg-amber-50 text-amber-700",
  RELEASED: "bg-teal-50 text-teal-700",
  COMPLETED: "bg-teal-50 text-teal-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomsIntelligencePage({ searchParams }: { searchParams?: SP }) {
  const header = (
    <PageHeader
      meta="Douane"
      title="Intelligence douanière"
      subtitle="Cycle de vie canonique des déclarations, pilotage et journal — au-dessus des dossiers douane existants."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé à la douane.</Notice></div>;
  }

  const sp = searchParams ?? {};
  const page = Math.max(0, Number.parseInt(one(sp.page) ?? "0", 10) || 0);
  const filters: DeclarationFilters = {
    search: one(sp.q),
    status: one(sp.status),
    provider: one(sp.provider),
    office: one(sp.office),
    from: one(sp.from),
    to: one(sp.to),
  };

  const [{ dashboard, providers, capped, cap }, list] = await Promise.all([
    getIntelligenceDashboard(),
    listDeclarations(filters, page),
  ]);

  const sb = dashboard.statusBreakdown;
  const buildQs = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: filters.search, status: filters.status, provider: filters.provider,
      office: filters.office, from: filters.from, to: filters.to, ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/customs/intelligence?${qs}` : "/customs/intelligence";
  };

  const statusPill = (label: string, value: string | undefined) => {
    const active = filters.status === value;
    return (
      <Link
        key={label}
        href={buildQs({ status: value, page: undefined })}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          active ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      {/* Dashboard — pure 7.1A aggregate contracts over real persisted declarations. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="En cours" value={dashboard.pending} tone="navy" />
        <StatCard label="Mainlevées" value={dashboard.released} tone="teal" />
        <StatCard label="File d'inspection" value={dashboard.inspectionQueueSize} tone="amber" />
        <StatCard label="En attente de paiement" value={sb.AWAITING_PAYMENT ?? 0} tone="amber" />
        <StatCard label="Rejetées" value={sb.REJECTED ?? 0} tone="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Indicateurs</h2>
          <dl className="space-y-1 text-slate-600">
            <div className="flex justify-between"><dt>Total déclarations</dt><dd className="tabular font-medium">{dashboard.total}</dd></div>
            <div className="flex justify-between">
              <dt>Délai moyen de dédouanement</dt>
              <dd className="tabular font-medium">{dashboard.averageClearanceDays == null ? "—" : `${dashboard.averageClearanceDays} j`}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Droits assessés</dt>
              <dd className="tabular font-medium">
                {dashboard.dutyTotals.length === 0 ? "—" : dashboard.dutyTotals.map((d) => `${d.total} ${d.currency}`).join(" · ")}
              </dd>
            </div>
          </dl>
        </div>

        {/* Provider readiness — GAINDE is reported honestly, never as a live integration. */}
        <div className="surface p-4 text-sm lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseurs douane</h2>
          <div className="space-y-2">
            {providers.map((p) => (
              <div key={p.providerCode} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-navy-800">{p.providerCode === "manual" ? "Manuel" : p.providerCode}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.live ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                  {p.status === "configured" ? "Actif" : p.status === "unsupported" ? "Non connecté" : p.status === "missing" ? "Configuration manquante" : "Configuration invalide"}
                </span>
                {p.providerCode === "GAINDE" && (
                  <span className="text-xs text-slate-500">
                    Intégration par référence — l&apos;API officielle n&apos;est pas disponible (voir la fiche de préparation).
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Canonical-status filter pills. */}
      <div className="flex flex-wrap items-center gap-2">
        {statusPill("Toutes", undefined)}
        {DECLARATION_STATUSES.map((s) => statusPill(declarationLabel(s), s))}
      </div>

      {/* Provider filter. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Fournisseur :</span>
        <Link href={buildQs({ provider: undefined, page: undefined })} className={`rounded-full border px-3 py-1 ${!filters.provider ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600"}`}>Tous</Link>
        {CUSTOMS_PROVIDERS.map((p) => (
          <Link key={p} href={buildQs({ provider: p, page: undefined })} className={`rounded-full border px-3 py-1 ${filters.provider === p ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600"}`}>
            {p === "manual" ? "Manuel" : p}
          </Link>
        ))}
      </div>

      {capped && (
        <p className="text-xs text-amber-700">
          Les indicateurs portent sur les {cap} déclarations les plus récentes (jeu de travail borné).
        </p>
      )}

      {list.items.length === 0 ? (
        <Notice>Aucune déclaration ne correspond à ces critères.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Référence</th>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Fournisseur</th>
                  <th className="px-4 py-3 font-semibold">Statut canonique</th>
                  <th className="px-4 py-3 font-semibold">Bureau</th>
                  <th className="px-4 py-3 font-semibold">Mise à jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/customs/intelligence/${d.id}`} className="tabular font-medium text-teal-700 hover:underline">
                        {d.reference ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${d.fileId}`} className="tabular text-navy-700 hover:text-teal-700">{d.fileNumber ?? "—"}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.clientName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{d.provider === "manual" ? "Manuel" : d.provider}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CANON_STYLE[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {declarationLabel(d.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.office ?? "—"}</td>
                    <td className="px-4 py-3 tabular text-slate-500">{d.updatedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SQL pagination — prev/next only, no full-set load. */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Page {page + 1}</span>
        <div className="flex gap-2">
          {page > 0 && (
            <Link href={buildQs({ page: String(page - 1) })} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">← Précédent</Link>
          )}
          {list.hasMore && (
            <Link href={buildQs({ page: String(page + 1) })} className="rounded-md border border-slate-200 px-3 py-1.5 hover:border-teal-300">Suivant →</Link>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Vue au-dessus des dossiers douane · <Link href="/departments/customs" className="text-teal-700 hover:underline">File douane</Link>.
        La création/déclaration/mainlevée opérationnelle reste dans le dossier (volet Douane).
      </p>
    </div>
  );
}
