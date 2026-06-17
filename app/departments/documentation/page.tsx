import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getDocumentationQueue } from "@/lib/departments/service";
import { readyForCustomsCount } from "@/lib/handoffs/service";
import { documentationCards, documentationNextAction } from "@/lib/departments/classify";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Documentation" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const PRIORITY = (p: string) =>
  (t.files.priorities as Record<string, string>)[p] ?? p;

export default async function DocumentationDepartmentPage() {
  const header = (
    <PageHeader
      meta="Départements"
      title="Documentation"
      subtitle="File documentaire : pièces en attente, documents manquants et dossiers prêts pour la douane."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "document:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé à la documentation.</Notice></div>;
  }

  const [rows, readyForCustoms] = await Promise.all([getDocumentationQueue(), readyForCustomsCount()]);
  const cards = documentationCards(rows);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Documents en attente" value={cards.pending} tone="amber" />
        <StatCard label="Documents manquants" value={cards.missing} tone="red" />
        <StatCard label="Dossiers vérifiés" value={cards.verified} tone="teal" />
        <StatCard label="Dossiers urgents" value={cards.urgent} tone="red" />
        <StatCard label={t.handoffs.cards.readyForCustoms} value={readyForCustoms} tone="teal" href="/departments/customs" />
      </div>

      {rows.length === 0 ? (
        <Notice>Aucun dossier ouvert à traiter.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Manquants</th>
                  <th className="px-4 py-3 font-semibold">Statut documents</th>
                  <th className="px-4 py-3 font-semibold">Priorité</th>
                  <th className="px-4 py-3 font-semibold">Prochaine action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const next = documentationNextAction(r);
                  return (
                    <tr key={r.fileId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/files/${r.fileId}`} className="tabular font-medium text-teal-700 hover:underline">
                          {r.fileNumber ?? "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.clientName ?? t.common.none}</td>
                      <td className="px-4 py-3 text-slate-600">{r.fileType}</td>
                      <td className="px-4 py-3">
                        {r.missing > 0 ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{r.missing}</span>
                        ) : (
                          <span className="text-xs text-slate-400">{t.common.none}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {r.verified} validés · {r.pending} en attente
                      </td>
                      <td className="px-4 py-3 text-slate-600">{PRIORITY(r.priority)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/files/${r.fileId}`} className="text-xs font-medium text-navy-700 hover:text-teal-700">
                          {next.label} →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Les actions (téléversement, validation, demande de pièces) s&apos;effectuent dans le dossier.
      </p>
    </div>
  );
}
