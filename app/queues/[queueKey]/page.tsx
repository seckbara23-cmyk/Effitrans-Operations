/**
 * Department queue (Phase 5.0C). ONE route serves all 15 official queues —
 * the queue registry drives it, so there is no per-department page to drift.
 *
 * Flag-gated: with EFFITRANS_PROCESS_WORKSPACES_ENABLED off this 404s and the
 * route may as well not exist.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getQueue, isQueueKey } from "@/lib/process/queues/registry";
import { getDepartmentQueue } from "@/lib/process/queues/service";
import { QueueTable } from "@/components/process/queue-table";
import { QueueFilters } from "@/components/process/queue-filters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "File d'attente" };

type Search = {
  q?: string;
  page?: string;
  unreceived?: string;
  blocked?: string;
  unassigned?: string;
  rejected?: string;
};

export default async function QueuePage({
  params,
  searchParams,
}: {
  params: { queueKey: string };
  searchParams: Search;
}) {
  if (!globalKillSwitch().workspaces) notFound();
  if (!isQueueKey(params.queueKey)) notFound();

  const def = getQueue(params.queueKey)!;
  const user = await requireUser();
  if (!(await getTenantProcessFlags(user.tenantId)).workspaces) notFound();
  const permissions = await getEffectivePermissions(user.id);

  // Permission AND role: an unauthorized department is never shown, not even by
  // typing its URL.
  if (!hasPermission(permissions, def.permission)) notFound();
  if (!def.roles.some((r) => user.roles.includes(r))) notFound();

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const result = await getDepartmentQueue({
    tenantId: user.tenantId,
    userId: user.id,
    queueKey: def.key,
    permissions,
    page,
    pageSize: 25,
    filters: {
      search: searchParams.q,
      unreceived: searchParams.unreceived === "1",
      blocked: searchParams.blocked === "1",
      unassigned: searchParams.unassigned === "1",
      rejected: searchParams.rejected === "1",
    },
  });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">{def.labelFr}</h1>
        <p className="text-sm text-slate-600">{def.description}</p>
        <p className="mt-1 text-xs text-slate-400">
          {result.total} dossier(s) · {def.requiresReception ? "réception explicite requise" : "sans réception"}
        </p>
      </header>

      <QueueFilters queueKey={def.key} />

      <QueueTable items={result.items} queue={def} />

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <a
            href={`/queues/${def.key}?page=${Math.max(1, page - 1)}`}
            className={`rounded border px-3 py-1.5 ${page <= 1 ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            Précédent
          </a>
          <span className="text-xs text-slate-500">
            Page {page} / {pages}
          </span>
          <a
            href={`/queues/${def.key}?page=${Math.min(pages, page + 1)}`}
            className={`rounded border px-3 py-1.5 ${page >= pages ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            Suivant
          </a>
        </nav>
      )}
    </main>
  );
}
