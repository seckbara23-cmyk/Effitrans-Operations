/**
 * "Mon travail" — THE staff workbench (Phase 5.0C → redesigned in 5.0E-1).
 * ---------------------------------------------------------------------------
 * The primary entry point for every operational role. It answers the only question
 * an operator opens the app to ask: "what is waiting on me, and what do I do next?"
 *
 * 5.0E-1 replaces the six overlapping sections with eight tabs that PARTITION the
 * work (lib/navigation/workbench.ts), so every count on this page is a real count.
 * The tab is a URL parameter, so a supervisor can send someone a link to exactly
 * the pile they mean.
 *
 * Reads the same queue service the department queues use, so there is ONE
 * definition of "work" and it cannot drift.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { visibleQueues } from "@/lib/process/queues/registry";
import { workspacesFor } from "@/lib/navigation/build";
import { getNavigationContext } from "@/lib/navigation/server";
import { getDepartmentQueue } from "@/lib/process/queues/service";
import {
  buildWorkbench,
  actionableCount,
  WORKBENCH_TAB_ORDER,
  type WorkbenchItem,
  type WorkbenchTabKey,
} from "@/lib/navigation/workbench";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mon travail" };

function isTabKey(v: string | undefined): v is WorkbenchTabKey {
  return v !== undefined && (WORKBENCH_TAB_ORDER as string[]).includes(v);
}

function WorkRow({ item }: { item: WorkbenchItem }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <Link
            href={`/files/${item.fileId}`}
            className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
          >
            {item.fileNumber}
          </Link>
          <span className="truncate text-xs text-slate-500">{item.clientName}</span>
          {item.priority.level === "critical" && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">
              Critique
            </span>
          )}
        </div>
        <p className="truncate text-xs text-slate-600">
          {item.stepNumber ? `Étape ${item.stepNumber} · ` : ""}
          {item.stepLabel}
        </p>
        <p className="truncate text-xs text-slate-500">
          {item.nextAction}
          {item.blockerSummary && <span className="ml-1 text-red-600">· {item.blockerSummary}</span>}
        </p>
      </div>
      <Link
        href={`/queues/${item.queueKey}`}
        className="shrink-0 rounded border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Traiter
      </Link>
    </li>
  );
}

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  if (!globalKillSwitch().workspaces) notFound();

  const user = await requireUser();
  if (!(await getTenantProcessFlags(user.tenantId)).workspaces) notFound();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read")) notFound();

  const queues = visibleQueues(user.roles, permissions);

  // One read per queue the user actually staffs — bounded by their ROLES, not by
  // the number of dossiers. A coursier does exactly one read.
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

  const tabs = buildWorkbench(results.flat(), user.id);
  const waiting = actionableCount(tabs);

  // Phase 5.0E-3 — the workspaces that used to live in the sidebar. They are this
  // user's own work, not navigation, so they belong here rather than as twenty
  // permanent links every other operator also has to carry. Same authorization rules,
  // same guarded routes; only the placement changed.
  const navCtx = await getNavigationContext();
  const workspaces = navCtx ? workspacesFor(navCtx) : [];
  const panels = workspaces.filter((w) => w.kind === "panel");
  const queueLinks = workspaces.filter((w) => w.kind === "queue");

  // Default to the first tab that actually has something in it, so a user landing
  // here never opens on an empty pile while real work sits one click away.
  const requested = isTabKey(searchParams?.tab) ? searchParams.tab : undefined;
  const activeKey = requested ?? tabs.find((t) => t.items.length > 0)?.key ?? "todo";
  const active = tabs.find((t) => t.key === activeKey)!;

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Mon travail</h1>
        <p className="text-sm text-slate-600">
          {waiting === 0
            ? "Rien n'attend après vous."
            : `${waiting} dossier(s) attendent une action de votre part.`}
          <span className="text-slate-400">
            {" "}
            · {queues.length} file(s) selon vos rôles
          </span>
        </p>
      </header>

      {workspaces.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-navy-900">Mes espaces</h2>
          <p className="mb-3 text-xs text-slate-500">
            Vos espaces de travail et vos files officielles, selon vos rôles.
          </p>
          <div className="flex flex-wrap gap-2">
            {[...panels, ...queueLinks].map((w) => (
              <Link
                key={w.key}
                href={w.href}
                title={w.hint}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
                  w.kind === "panel"
                    ? "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {w.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {queues.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune file d&apos;attente n&apos;est associée à vos rôles.
        </div>
      ) : (
        <>
          <nav
            className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2"
            aria-label="Catégories de travail"
          >
            {tabs.map((tab) => {
              const on = tab.key === activeKey;
              return (
                <Link
                  key={tab.key}
                  href={`/my-work?tab=${tab.key}`}
                  aria-current={on ? "page" : undefined}
                  title={tab.hint}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
                    on
                      ? "bg-navy-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-navy-900",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none tabular",
                      on ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700",
                    )}
                  >
                    {tab.items.length}
                  </span>
                </Link>
              );
            })}
          </nav>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs text-slate-500">{active.hint}</p>
            {active.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">{active.emptyLabel}</p>
            ) : (
              <ul>
                {active.items.map((item) => (
                  <WorkRow key={item.executionId} item={item} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
