/**
 * Department work queue (Phase WES-3H). Server component, read-only.
 * ---------------------------------------------------------------------------
 * Closes the gap WES-3 left: before this, `Mon Travail` was the only place work
 * existed, so anything UNASSIGNED was invisible to everyone and a dossier could
 * sit in a department with nobody aware of it.
 *
 * `Mon Travail` stays what it is — the authenticated user's own actionable
 * work. This is deliberately a SEPARATE surface: merging them would put a
 * colleague's work in your personal list, which is the confusion WES-3 exists
 * to remove.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getDepartmentWorkQueue } from "@/lib/workflow/access/queue";
import {
  QUEUE_CATEGORIES,
  QUEUE_CATEGORY_LABELS_FR,
  isQueueCategory,
  type QueueCategory,
} from "@/lib/workflow/access/vocabulary";
import { departmentLabelFr } from "@/lib/organization/departments";
import type { CanonicalDepartmentCode } from "@/lib/organization/departments";

export const metadata: Metadata = { title: "File du département" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-500",
  normal: "bg-sky-50 text-sky-700",
  high: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

export default async function DepartmentQueuePage({
  searchParams,
}: {
  searchParams?: { c?: string };
}) {
  const header = (
    <PageHeader
      meta="Départements"
      title="File du département"
      subtitle="Le travail dont votre département est actuellement responsable."
    />
  );

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  // The queue shows dossiers, so it requires the ordinary dossier-read
  // permission. Row-level visibility is then re-decided per dossier by the
  // WES-3 resolver — this gate never widens it.
  if (!hasPermission(permissions, "file:read")) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>Vous n&apos;avez pas accès aux dossiers.</Notice>
      </div>
    );
  }

  const queue = await getDepartmentWorkQueue();

  if (queue.departments.length === 0) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>
          Vos rôles ne vous rattachent à aucun département traitant des dossiers. Consultez
          « Mon Travail » pour les tâches qui vous sont affectées.
        </Notice>
      </div>
    );
  }

  const selected: QueueCategory | null = isQueueCategory(searchParams?.c) ? searchParams.c : null;
  const rows = selected ? queue.rows.filter((r) => r.categories.includes(selected)) : queue.rows;

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      <p className="text-xs text-slate-500">
        Département
        {queue.departments.length > 1 ? "s" : ""} :{" "}
        {queue.departments
          .map((d) => departmentLabelFr(d as CanonicalDepartmentCode))
          .join(" · ")}
      </p>

      {/* Categories as filters. A dossier can sit in several at once — blocked
          AND assigned to a colleague is one situation, not two. */}
      <nav className="flex flex-wrap gap-2">
        <Link
          href="/departments/queue"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            selected === null ? "bg-navy-900 text-white" : "bg-sand-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          Tout ({queue.rows.length})
        </Link>
        {QUEUE_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/departments/queue?c=${c}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              selected === c ? "bg-navy-900 text-white" : "bg-sand-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {QUEUE_CATEGORY_LABELS_FR[c]} ({queue.counts[c]})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Notice>Aucun dossier dans cette catégorie.</Notice>
      ) : (
        <section className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Dossier</th>
                  <th className="px-4 py-2 font-semibold">Client</th>
                  <th className="px-4 py-2 font-semibold">Étape</th>
                  <th className="px-4 py-2 font-semibold">Travail en cours</th>
                  <th className="px-4 py-2 font-semibold">Affecté à</th>
                  <th className="px-4 py-2 font-semibold">État</th>
                  <th className="px-4 py-2 font-semibold">Dernière activité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.fileId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2">
                      <Link
                        href={`/files/${r.fileId}`}
                        className="font-medium text-teal-700 hover:underline"
                      >
                        {r.fileNumber ?? "—"}
                      </Link>
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                          PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.normal
                        }`}
                      >
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{r.clientName ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{r.stageLabelFr}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {/* Withheld when the WES-3 matrix withholds current detail. */}
                      {r.canOpenDetail ? (r.workTitle ?? "—") : <span className="text-slate-400">Résumé seulement</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.assigneeLabel ?? (r.canOpenDetail ? "Non affecté" : "—")}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.blocked && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
                            Bloqué
                          </span>
                        )}
                        {r.awaitingReception && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                            Réception attendue
                          </span>
                        )}
                        {!r.blocked && !r.awaitingReception && (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </span>
                    </td>
                    <td className="tabular px-4 py-2 text-xs text-slate-500">
                      {new Date(r.lastActivityAt).toLocaleDateString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-400">
        Les dossiers listés sont ceux dont votre département est actuellement responsable, d&apos;après
        la projection canonique du dossier — jamais d&apos;après une affectation individuelle.
        Réaffecter une tâche ne retire donc jamais un dossier de cette file. Aucun délai contractuel
        n&apos;est affiché : les SLA arrivent avec WES-8.
      </p>
    </div>
  );
}
