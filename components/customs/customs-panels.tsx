import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import {
  docStatusMeta,
  dutiesTotal,
  formatFCFA,
  blockingIssueMeta,
  type CustomsRecord,
  type CustomsDocType,
  type BlockingIssueType,
} from "@/lib/customs";
import {
  IconDocument,
  IconList,
  IconShip,
  IconStamp,
  IconCertificate,
  IconShield,
  IconScale,
  IconCoins,
  IconCard,
  IconBuilding,
  IconContact,
} from "@/lib/icons";

const docIcon: Record<CustomsDocType, React.ComponentType<{ className?: string }>> =
  {
    invoice: IconDocument,
    packing: IconList,
    transport: IconShip,
    origin: IconCertificate,
    authorization: IconShield,
    declaration: IconStamp,
  };

export function DocumentsChecklist({ file }: { file: CustomsRecord }) {
  return (
    <ul className="divide-y divide-slate-50">
      {file.documents.map((doc) => {
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
              <p className="flex items-center gap-2 text-sm font-medium text-navy-900">
                {doc.label}
                {doc.optional && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Si requis
                  </span>
                )}
              </p>
              <p className="tabular text-xs text-slate-500">
                {doc.ref ? doc.ref : "Référence à fournir"}
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

function DutyRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2.5 text-sm text-slate-600">
        <Icon className="h-4 w-4 text-slate-400" />
        {label}
      </span>
      <span className="tabular text-sm font-medium text-navy-900">
        {formatFCFA(value)}
      </span>
    </div>
  );
}

export function DutiesPanel({ file }: { file: CustomsRecord }) {
  const d = file.duties;
  const total = dutiesTotal(d);
  return (
    <div className="px-5 py-2">
      <div className="divide-y divide-slate-50">
        <DutyRow icon={IconScale} label="Droits de douane" value={d.droitsDouane} />
        <DutyRow icon={IconCoins} label="TVA (18 %)" value={d.tva} />
        <DutyRow
          icon={IconCard}
          label="Redevances (COSEC, statistique…)"
          value={d.redevances}
        />
        <DutyRow
          icon={IconBuilding}
          label="Frais portuaires / magasinage"
          value={d.fraisPortuaires}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-navy-900">Total estimé</span>
        <span className="tabular text-base font-bold text-navy-900">
          {formatFCFA(total)}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Estimation indicative — montants définitifs établis à la liquidation par
        le bureau de douane.
      </p>
    </div>
  );
}

const issueIcon: Record<
  BlockingIssueType,
  React.ComponentType<{ className?: string }>
> = {
  missing_docs: IconDocument,
  inspection: IconStamp,
  payment_pending: IconCoins,
  client_validation: IconContact,
};

export function BlockingIssuesPanel({ file }: { file: CustomsRecord }) {
  if (file.blockingIssues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none">
            <path
              d="m3.5 8.5 3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-navy-800">Aucun blocage signalé</p>
        <p className="mt-1 text-xs text-slate-500">
          Le dossier suit le circuit normal de dédouanement.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-50">
      {file.blockingIssues.map((issue, i) => {
        const Icon = issueIcon[issue.type];
        return (
          <li key={i} className="flex gap-3 px-5 py-3.5">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                issue.severity === "red"
                  ? "bg-red-50 text-red-600"
                  : "bg-amber-50 text-amber-600",
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-semibold text-navy-900">
                  {issue.label}
                </p>
                <Badge tone={issue.severity}>
                  {blockingIssueMeta[issue.type].label}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {issue.detail}
              </p>
            </div>
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

export function NotesPanel({ file }: { file: CustomsRecord }) {
  return (
    <ul className="space-y-4 px-5 py-5">
      {file.notes.map((note, i) => (
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
