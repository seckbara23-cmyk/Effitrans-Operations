import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";
import { taskStatus } from "@/lib/status";
import { docStatusMeta, type ShipmentRecord } from "@/lib/shipments";
import {
  IconDocument,
  IconShip,
  IconStamp,
  IconList,
  IconTask,
  IconBlock,
} from "@/lib/icons";

const docIcon = {
  invoice: IconDocument,
  packing: IconList,
  transport: IconShip,
  customs: IconStamp,
} as const;

export function DocumentsPanel({ shipment }: { shipment: ShipmentRecord }) {
  return (
    <ul className="divide-y divide-slate-50">
      {shipment.documents.map((doc) => {
        const Icon = docIcon[doc.type];
        const meta = docStatusMeta[doc.status];
        return (
          <li
            key={doc.type}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sand-50"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                doc.status === "received"
                  ? "bg-teal-50 text-teal-700"
                  : doc.status === "missing"
                    ? "bg-red-50 text-red-600"
                    : "bg-amber-50 text-amber-600",
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-navy-900">{doc.label}</p>
              <p className="tabular text-xs text-slate-500">
                {doc.ref ? `${doc.ref}` : "Référence à fournir"}
                {doc.date ? ` · ${doc.date}` : ""}
              </p>
            </div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function TasksPanel({ shipment }: { shipment: ShipmentRecord }) {
  return (
    <ul className="divide-y divide-slate-50">
      {shipment.tasks.map((task, i) => {
        const st = taskStatus[task.status];
        const Icon = task.status === "overdue" ? IconBlock : IconTask;
        return (
          <li
            key={i}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 transition-colors hover:bg-sand-50"
          >
            <Icon
              className={cn(
                "h-5 w-5 shrink-0",
                task.status === "done"
                  ? "text-emerald-500"
                  : task.status === "overdue"
                    ? "text-red-500"
                    : "text-slate-400",
              )}
            />
            <span
              className={cn(
                "flex-1 text-sm font-medium",
                task.status === "done"
                  ? "text-slate-400 line-through"
                  : "text-navy-900",
              )}
            >
              {task.label}
            </span>
            <AgentChip name={task.assignee} className="hidden sm:inline-flex" />
            <span className="tabular text-xs text-slate-500">{task.due}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function NotesPanel({ shipment }: { shipment: ShipmentRecord }) {
  return (
    <ul className="space-y-4 px-5 py-5">
      {shipment.notes.map((note, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-teal-300">
            {initials(note.author)}
          </span>
          <div className="min-w-0 flex-1 rounded-lg rounded-tl-none bg-sand-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-100">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-navy-900">
                {note.author}
              </p>
              <p className="tabular text-[11px] text-slate-400">{note.time}</p>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {note.text}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
