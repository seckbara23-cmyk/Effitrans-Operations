/**
 * "Mon travail" (Phase 5.0C, Deliverable 3) — the role-aware staff homepage.
 * ---------------------------------------------------------------------------
 * What the current user must act on, across every queue their roles staff. A
 * courier sees only deposit work; a Chief Transit sees validations; a supervisor
 * sees the cross-department view. Nobody sees a department they do not staff.
 *
 * Flag-gated. Reads the same queue service the department queues use, so there is
 * ONE definition of "work" and it cannot drift.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { visibleQueues } from "@/lib/process/queues/registry";
import { getDepartmentQueue, type QueueItem } from "@/lib/process/queues/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mon travail" };

function Section({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: (QueueItem & { queueKey: string })[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Rien à traiter.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((i) => (
            <li key={i.executionId} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0">
              <div className="min-w-0">
                <Link href={`/files/${i.fileId}`} className="tabular text-sm font-medium text-navy-900 hover:text-teal-700">
                  {i.fileNumber}
                </Link>
                <span className="ml-2 text-xs text-slate-500">{i.clientName}</span>
                <div className="truncate text-xs text-slate-500">
                  {i.stepNumber ? `${i.stepNumber}. ` : ""}
                  {i.stepLabel}
                  {i.blockerSummary && <span className="ml-1 text-red-600">· {i.blockerSummary}</span>}
                </div>
              </div>
              <Link
                href={`/queues/${i.queueKey}`}
                className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Traiter
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function MyWorkPage() {
  if (!getProcessFlags().workspaces) notFound();

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read")) notFound();

  const queues = visibleQueues(user.roles, permissions);

  // One queue read per queue the user actually staffs — bounded by their roles,
  // not by the number of dossiers. A courier does exactly one read.
  const results = await Promise.all(
    queues.map(async (q) => {
      const r = await getDepartmentQueue({
        tenantId: user.tenantId,
        userId: user.id,
        queueKey: q.key,
        permissions,
        pageSize: 50,
      });
      return r.items.map((i) => ({ ...i, queueKey: q.key }));
    }),
  );
  const all = results.flat();

  const mine = all.filter((i) => i.assigneeId === user.id);
  const awaitingRole = all.filter((i) => !i.assigneeId && i.received);
  const awaitingReception = all.filter((i) => !i.received);
  const corrections = all.filter((i) => i.isCorrection);
  const blocked = all.filter((i) => i.blockerSummary !== null);
  const otherBranch = all.filter((i) => i.branches.waitingOnOtherBranch);

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Mon travail</h1>
        <p className="text-sm text-slate-600">
          Processus officiel Effitrans · {queues.length} file(s) selon vos rôles ·{" "}
          {all.length} dossier(s) au total
        </p>
      </header>

      {queues.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune file d&apos;attente n&apos;est associée à vos rôles.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Qui m'est affecté"
          hint="Étapes officielles dont vous êtes le responsable désigné."
          items={mine}
        />
        <Section
          title="Transferts à réceptionner"
          hint="Rien ne progresse tant que la réception n'est pas confirmée."
          items={awaitingReception}
        />
        <Section
          title="Corrections à reprendre"
          hint="Travail rejeté par un contrôleur indépendant, avec motif."
          items={corrections}
        />
        <Section
          title="En attente de mon rôle"
          hint="Disponible, non encore pris en charge."
          items={awaitingRole}
        />
        <Section
          title="Étapes bloquées"
          hint="Un prérequis ou une preuve manque."
          items={blocked}
        />
        <Section
          title="En attente de l'autre branche"
          hint="La branche douane ou la préparation transport n'a pas encore convergé."
          items={otherBranch}
        />
      </div>
    </main>
  );
}
