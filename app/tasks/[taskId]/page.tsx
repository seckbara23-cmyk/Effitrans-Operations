import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tasks, getTask, taskModuleMeta } from "@/lib/tasks";
import { customerHref } from "@/lib/customers";
import { taskWorkflowStatus, taskWorkflowPriority } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { AgentChip } from "@/components/ui/agent-chip";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import {
  ActivityHistoryPanel,
  RelatedDocumentsPanel,
  RelatedShipmentPanel,
  RelatedCustomsPanel,
  NotesPanel,
} from "@/components/tasks/task-panels";
import { IconChevronRight } from "@/lib/icons";

export function generateStaticParams() {
  return tasks.map((t) => ({ taskId: t.id }));
}

export function generateMetadata({
  params,
}: {
  params: { taskId: string };
}): Metadata {
  const t = getTask(params.taskId);
  return { title: t ? `${t.id} · Tâche` : "Tâche introuvable" };
}

function SummaryCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1.5 text-sm font-semibold text-navy-900">
        {children}
      </div>
    </div>
  );
}

export default function TaskDetailPage({
  params,
}: {
  params: { taskId: string };
}) {
  const t = getTask(params.taskId);
  if (!t) notFound();

  const st = taskWorkflowStatus[t.status];
  const pr = taskWorkflowPriority[t.priority];
  const custLink = t.customer ? customerHref(t.customer) : undefined;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/tasks" className="hover:text-teal-700">
          Tâches
        </Link>
        <IconChevronRight className="h-4 w-4 text-slate-300" />
        <span className="tabular font-medium text-navy-800">{t.id}</span>
      </nav>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:26px_26px] opacity-50" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">
              {t.id} · {taskModuleMeta[t.module].label}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
              {t.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <Badge tone={st.tone} className="bg-white/10 text-white ring-white/20">
              {st.label}
            </Badge>
            <Badge
              tone={pr.tone}
              dot={false}
              className="bg-white/10 text-white ring-white/20"
            >
              Priorité : {pr.label}
            </Badge>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <SummaryCard label="Assigné à">
          <AgentChip name={t.assignee} />
        </SummaryCard>
        <SummaryCard label="Client">
          {t.customer ? (
            custLink ? (
              <Link
                href={custLink}
                className="text-teal-700 hover:text-teal-800"
              >
                {t.customer}
              </Link>
            ) : (
              t.customer
            )
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </SummaryCard>
        <SummaryCard label="Échéance">
          <span className="tabular">{t.dueDate}</span>
        </SummaryCard>
        <SummaryCard label="Expédition liée">
          {t.relatedShipment ? (
            <Link
              href={`/shipments/${t.relatedShipment}`}
              className="tabular text-teal-700 hover:text-teal-800"
            >
              {t.relatedShipment}
            </Link>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </SummaryCard>
        <SummaryCard label="Dossier douane lié">
          {t.relatedCustomsFile ? (
            <Link
              href={`/customs/${t.relatedCustomsFile}`}
              className="tabular text-teal-700 hover:text-teal-800"
            >
              {t.relatedCustomsFile}
            </Link>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </SummaryCard>
        <SummaryCard label="Créée le">
          <span className="tabular">{t.createdDate}</span>
        </SummaryCard>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel eyebrow="Tâche" title="Description">
            <p className="px-5 py-4 text-sm leading-relaxed text-slate-600">
              {t.description}
            </p>
          </Panel>

          <Panel eyebrow="Workflow" title="Étapes de la tâche">
            <TaskTimeline task={t} />
          </Panel>

          <Panel eyebrow="Suivi" title="Historique d'activité">
            <ActivityHistoryPanel task={t} />
          </Panel>

          <Panel eyebrow="Échanges internes" title="Notes internes">
            <NotesPanel task={t} />
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel eyebrow="Pièces" title="Documents liés">
            <RelatedDocumentsPanel task={t} />
          </Panel>

          <Panel eyebrow="Expédition" title="Expédition liée">
            <RelatedShipmentPanel task={t} />
          </Panel>

          <Panel eyebrow="Dédouanement" title="Dossier douane lié">
            <RelatedCustomsPanel task={t} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
