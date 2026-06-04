import Link from "next/link";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { docStatusMeta } from "@/lib/shipments";
import { customerHref } from "@/lib/customers";
import {
  relatedChecklist,
  buildHistory,
  validationStageMeta,
  type DocumentRecord,
} from "@/lib/documents";
import type { Tone } from "@/lib/status";
import {
  IconContainer,
  IconStamp,
  IconUsers,
  IconChevronRight,
} from "@/lib/icons";

/* ---- Completeness -------------------------------------------------------- */

export function CompletenessPanel({ document }: { document: DocumentRecord }) {
  const checklist = relatedChecklist(document);

  if (!checklist) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">
          Document administratif — aucune liste de complétude de dossier
          associée.
        </p>
      </div>
    );
  }

  const { items, percent, source } = checklist;
  const barTone =
    percent >= 100
      ? "bg-teal-500"
      : percent >= 50
        ? "bg-navy-600"
        : "bg-amber-500";

  return (
    <div className="px-5 py-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-xs text-slate-500">{source}</p>
        <p className="tabular text-sm font-bold text-navy-900">{percent}%</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all", barTone)}
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-4 divide-y divide-slate-50">
        {items.map((item) => {
          const meta = docStatusMeta[item.status];
          return (
            <li
              key={item.label}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-navy-800">
                <StatusDot status={item.status} />
                {item.label}
              </span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: "received" | "pending" | "missing" }) {
  const cls =
    status === "received"
      ? "bg-teal-500"
      : status === "missing"
        ? "bg-red-500"
        : "bg-amber-500";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", cls)} />;
}

/* ---- Related files ------------------------------------------------------- */

export function RelatedFilesPanel({ document }: { document: DocumentRecord }) {
  const custLink = customerHref(document.customer);

  const rows: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    href?: string;
  }[] = [
    {
      icon: IconUsers,
      label: "Client",
      value: document.customer,
      href: custLink,
    },
    {
      icon: IconContainer,
      label: "Expédition",
      value: document.relatedShipment ?? "—",
      href: document.relatedShipment
        ? `/shipments/${document.relatedShipment}`
        : undefined,
    },
    {
      icon: IconStamp,
      label: "Dossier douane",
      value: document.relatedCustomsFile ?? "—",
      href: document.relatedCustomsFile
        ? `/customs/${document.relatedCustomsFile}`
        : undefined,
    },
  ];

  return (
    <ul className="divide-y divide-slate-50">
      {rows.map((r) => (
        <li
          key={r.label}
          className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sand-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sand-100 text-navy-600">
            <r.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {r.label}
            </p>
            {r.href ? (
              <Link
                href={r.href}
                className="text-sm font-semibold text-teal-700 hover:text-teal-800"
              >
                {r.value}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-navy-900">{r.value}</p>
            )}
          </div>
          {r.href && <IconChevronRight className="h-4 w-4 text-slate-300" />}
        </li>
      ))}
    </ul>
  );
}

/* ---- Validation history -------------------------------------------------- */

const dotTone: Record<Tone, string> = {
  navy: "border-navy-600 bg-navy-600",
  teal: "border-teal-600 bg-teal-600",
  amber: "border-amber-500 bg-amber-500",
  red: "border-red-500 bg-red-500",
  green: "border-emerald-500 bg-emerald-500",
  slate: "border-slate-300 bg-slate-300",
  blue: "border-sky-500 bg-sky-500",
};

export function ValidationHistoryPanel({
  document,
}: {
  document: DocumentRecord;
}) {
  const events = buildHistory(document);

  return (
    <ol className="relative px-5 py-5">
      {events.map((ev, i) => {
        const meta = validationStageMeta[ev.stage];
        const isLast = i === events.length - 1;
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-0.5 bg-slate-200"
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                dotTone[meta.tone],
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <p className="text-sm font-semibold text-navy-900">
                  {meta.label}
                </p>
                <p className="tabular text-[11px] text-slate-400">{ev.time}</p>
              </div>
              <p className="text-xs text-slate-500">{ev.actor}</p>
              {ev.note && (
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {ev.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---- Notes --------------------------------------------------------------- */

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function NotesPanel({ document }: { document: DocumentRecord }) {
  if (document.notes.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-500">Aucune note interne.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-4 px-5 py-5">
      {document.notes.map((note, i) => (
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
