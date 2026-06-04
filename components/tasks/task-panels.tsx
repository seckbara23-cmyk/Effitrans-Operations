import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ModeTag } from "@/components/ui/mode-tag";
import { DocTypeIcon } from "@/components/documents/doc-type-icon";
import {
  shipmentStatus,
  customsStatus,
  documentStatus,
} from "@/lib/status";
import { missingDocsCount } from "@/lib/customs";
import {
  getShipment,
  getCustomsFile,
  relatedDocumentsForTask,
  type TaskRecord,
} from "@/lib/tasks";
import { IconChevronRight, IconPin } from "@/lib/icons";

/* ---- Activity history ---------------------------------------------------- */

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function ActivityHistoryPanel({ task }: { task: TaskRecord }) {
  if (task.activity.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucune activité enregistrée.</p>
      </div>
    );
  }
  return (
    <ol className="relative px-5 py-5">
      {task.activity.map((ev, i) => {
        const isLast = i === task.activity.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5 bg-slate-200"
                aria-hidden
              />
            )}
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-teal-300">
              {initials(ev.actor)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">
                  {ev.actor}
                </p>
                <p className="tabular text-[11px] text-slate-400">{ev.time}</p>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                {ev.text}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---- Related documents --------------------------------------------------- */

export function RelatedDocumentsPanel({ task }: { task: TaskRecord }) {
  const docs = relatedDocumentsForTask(task);
  if (docs.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucun document rattaché.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-50">
      {docs.map((d) => {
        const st = documentStatus[d.status];
        const isPrimary = d.id === task.relatedDocument;
        return (
          <li
            key={d.id}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sand-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sand-100 text-navy-600">
              <DocTypeIcon type={d.type} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/documents/${d.id}`}
                className="flex items-center gap-2 text-sm font-medium text-navy-900 hover:text-teal-700"
              >
                {d.name}
                {isPrimary && (
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                    Pièce clé
                  </span>
                )}
              </Link>
              <p className="tabular text-[11px] text-slate-400">{d.reference}</p>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Related shipment ---------------------------------------------------- */

export function RelatedShipmentPanel({ task }: { task: TaskRecord }) {
  const s = task.relatedShipment ? getShipment(task.relatedShipment) : undefined;
  if (!s) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucune expédition liée.</p>
      </div>
    );
  }
  const st = shipmentStatus[s.status];
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/shipments/${s.reference}`}
          className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
        >
          {s.reference}
        </Link>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
        <ModeTag mode={s.mode} />
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
        <IconPin className="h-4 w-4 text-teal-600" />
        {s.origin}
        <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
        {s.destination}
      </p>
      <p className="tabular mt-1 text-xs text-slate-500">ETA : {s.eta}</p>
    </div>
  );
}

/* ---- Related customs file ------------------------------------------------ */

export function RelatedCustomsPanel({ task }: { task: TaskRecord }) {
  const f = task.relatedCustomsFile
    ? getCustomsFile(task.relatedCustomsFile)
    : undefined;
  if (!f) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucun dossier douane lié.</p>
      </div>
    );
  }
  const st = customsStatus[f.status];
  const missing = missingDocsCount(f);
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/customs/${f.reference}`}
          className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
        >
          {f.reference}
        </Link>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">{f.office}</p>
      <p className="tabular mt-1 text-xs text-slate-500">
        Déclaration : {f.declarationNumber}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Documents manquants :{" "}
        {missing > 0 ? (
          <span className="font-semibold text-red-600">{missing}</span>
        ) : (
          <span className="font-medium text-emerald-600">aucun</span>
        )}
      </p>
    </div>
  );
}

/* ---- Notes --------------------------------------------------------------- */

export function NotesPanel({ task }: { task: TaskRecord }) {
  if (task.notes.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucune note interne.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-4 px-5 py-5">
      {task.notes.map((note, i) => (
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
