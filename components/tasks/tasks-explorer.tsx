"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  taskWorkflowStatus,
  taskWorkflowStatusOrder,
  taskWorkflowPriority,
  taskWorkflowPriorityOrder,
  type TaskWorkflowStatus,
  type TaskWorkflowPriority,
} from "@/lib/status";
import {
  tasks,
  taskModuleMeta,
  taskModuleOrder,
  type TaskModule,
} from "@/lib/tasks";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";
import { IconSearch, IconTask, IconChevronRight } from "@/lib/icons";

type StatusFilter = TaskWorkflowStatus | "all";
type PriorityFilter = TaskWorkflowPriority | "all";
type AssigneeFilter = string | "all";
type ModuleFilter = TaskModule | "all";

const assignees = Array.from(new Set(tasks.map((t) => t.assignee))).sort();

function KpiStrip() {
  const open = tasks.filter((t) => t.status !== "done").length;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && t.dueFlag === "overdue",
  ).length;
  const dueToday = tasks.filter(
    (t) => t.status !== "done" && t.dueFlag === "today",
  ).length;
  const completed = tasks.filter((t) => t.status === "done").length;

  const kpis = [
    { label: "Tâches ouvertes", value: open, tone: "navy" as const },
    { label: "Tâches en retard", value: overdue, tone: "red" as const },
    { label: "Dues aujourd'hui", value: dueToday, tone: "amber" as const },
    { label: "Terminées cette semaine", value: completed, tone: "teal" as const },
  ];
  const accent: Record<string, string> = {
    navy: "text-navy-700",
    red: "text-red-600",
    amber: "text-amber-600",
    teal: "text-teal-600",
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="surface p-4">
          <p className="text-xs font-medium text-slate-500">{k.label}</p>
          <p className={`tabular mt-1.5 text-2xl font-bold ${accent[k.tone]}`}>
            {k.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const selectClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-navy-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

const dueClass: Record<string, string> = {
  overdue: "text-red-600 font-medium",
  today: "text-amber-600 font-medium",
  soon: "text-slate-500",
};

export function TasksExplorer() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [prio, setPrio] = useState<PriorityFilter>("all");
  const [assignee, setAssignee] = useState<AssigneeFilter>("all");
  const [mod, setMod] = useState<ModuleFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (prio !== "all" && t.priority !== prio) return false;
      if (assignee !== "all" && t.assignee !== assignee) return false;
      if (mod !== "all" && t.module !== mod) return false;
      if (q) {
        const haystack = [
          t.id,
          t.title,
          t.customer ?? "",
          t.relatedShipment ?? "",
          t.relatedCustomsFile ?? "",
          t.assignee,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query, status, prio, assignee, mod]);

  const hasFilters =
    query !== "" ||
    status !== "all" ||
    prio !== "all" ||
    assignee !== "all" ||
    mod !== "all";

  function reset() {
    setQuery("");
    setStatus("all");
    setPrio("all");
    setAssignee("all");
    setMod("all");
  }

  return (
    <div className="space-y-5">
      <KpiStrip />

      {/* Filter bar */}
      <div className="surface p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par tâche, client, dossier ou agent…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Statut"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className={selectClass}
            >
              <option value="all">Tous les statuts</option>
              {taskWorkflowStatusOrder.map((s) => (
                <option key={s} value={s}>
                  {taskWorkflowStatus[s].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Priorité"
              value={prio}
              onChange={(e) => setPrio(e.target.value as PriorityFilter)}
              className={selectClass}
            >
              <option value="all">Toutes priorités</option>
              {taskWorkflowPriorityOrder.map((p) => (
                <option key={p} value={p}>
                  {taskWorkflowPriority[p].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Agent assigné"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value as AssigneeFilter)}
              className={selectClass}
            >
              <option value="all">Tous les agents</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <select
              aria-label="Module lié"
              value={mod}
              onChange={(e) => setMod(e.target.value as ModuleFilter)}
              className={selectClass}
            >
              <option value="all">Tous les modules</option>
              {taskModuleOrder.map((m) => (
                <option key={m} value={m}>
                  {taskModuleMeta[m].label}
                </option>
              ))}
            </select>

            {hasFilters && (
              <button
                onClick={reset}
                className="h-9 rounded-lg px-3 text-sm font-medium text-teal-700 hover:bg-teal-50"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
        <p className="mt-2.5 px-1 text-xs text-slate-500">
          <span className="tabular font-semibold text-navy-800">
            {filtered.length}
          </span>{" "}
          tâche{filtered.length > 1 ? "s" : ""} sur {tasks.length}
        </p>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Tâche</th>
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-5 py-2.5 font-semibold">Expédition</th>
                <th className="px-5 py-2.5 font-semibold">Dossier douane</th>
                <th className="px-5 py-2.5 font-semibold">Assigné à</th>
                <th className="px-5 py-2.5 font-semibold">Priorité</th>
                <th className="px-5 py-2.5 font-semibold">Échéance</th>
                <th className="px-5 py-2.5 font-semibold">Statut</th>
                <th className="px-5 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((t) => {
                const st = taskWorkflowStatus[t.status];
                const pr = taskWorkflowPriority[t.priority];
                return (
                  <tr
                    key={t.id}
                    className="group transition-colors hover:bg-sand-50"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="text-sm font-semibold text-navy-900 hover:text-teal-700"
                      >
                        {t.title}
                      </Link>
                      <div className="tabular text-[11px] text-slate-400">
                        {t.id} · {taskModuleMeta[t.module].label}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-navy-800">
                      {t.customer ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      {t.relatedShipment ? (
                        <Link
                          href={`/shipments/${t.relatedShipment}`}
                          className="tabular text-sm text-navy-700 hover:text-teal-700"
                        >
                          {t.relatedShipment}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {t.relatedCustomsFile ? (
                        <Link
                          href={`/customs/${t.relatedCustomsFile}`}
                          className="tabular text-sm text-navy-700 hover:text-teal-700"
                        >
                          {t.relatedCustomsFile}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <AgentChip name={t.assignee} />
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={pr.tone} dot={false}>
                        {pr.label}
                      </Badge>
                    </td>
                    <td className={`px-5 py-3 text-xs ${dueClass[t.dueFlag]}`}>
                      {t.dueDate}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-navy-800 hover:bg-slate-50"
                      >
                        Voir
                        <IconChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sand-100 text-slate-400">
              <IconTask className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-navy-800">
              Aucune tâche ne correspond aux filtres
            </p>
            <button
              onClick={reset}
              className="mt-3 text-sm font-medium text-teal-700 hover:text-teal-800"
            >
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
