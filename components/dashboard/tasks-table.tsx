import { tasksToday } from "@/lib/mock-data";
import { taskStatus } from "@/lib/status";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";

const c = t.dashboard.columns;

export function TasksTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 font-semibold">{c.task}</th>
            <th className="px-5 py-2.5 font-semibold">{c.file}</th>
            <th className="px-5 py-2.5 font-semibold">{c.assignedTo}</th>
            <th className="px-5 py-2.5 font-semibold">{c.deadline}</th>
            <th className="px-5 py-2.5 font-semibold">{c.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {tasksToday.map((task, i) => {
            const st = taskStatus[task.status];
            return (
              <tr key={i} className="transition-colors hover:bg-sand-50">
                <td className="px-5 py-3 text-sm font-medium text-navy-800">
                  {task.task}
                </td>
                <td className="tabular px-5 py-3 text-sm text-teal-700">
                  {task.file}
                </td>
                <td className="px-5 py-3">
                  <AgentChip name={task.assignedTo} />
                </td>
                <td className="tabular px-5 py-3 text-sm font-medium text-navy-900">
                  {task.deadline}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
