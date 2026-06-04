import Link from "next/link";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { ModeTag } from "@/components/ui/mode-tag";
import { shipmentStatus, customsStatus } from "@/lib/status";
import { docStatusMeta } from "@/lib/shipments";
import {
  customsMissingDocs,
  noteCategoryMeta,
  openShipmentsFor,
  openCustomsFor,
  type CustomerRecord,
  type CustomerDocType,
} from "@/lib/customers";
import {
  IconDocument,
  IconStamp,
  IconCertificate,
  IconShield,
  IconCard,
  IconContainer,
} from "@/lib/icons";

/* ---- Contacts ------------------------------------------------------------ */

function initials(name: string) {
  return name
    .replace(/^Dr\.\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const channelTone = {
  Téléphone: "navy",
  Email: "blue",
  WhatsApp: "green",
} as const;

export function ContactsPanel({ customer }: { customer: CustomerRecord }) {
  return (
    <ul className="divide-y divide-slate-50">
      {customer.contacts.map((ct) => (
        <li key={ct.email} className="flex gap-3 px-5 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-teal-300">
            {initials(ct.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-navy-900">{ct.name}</p>
              {ct.primary && (
                <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                  Principal
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">{ct.role}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="tabular">{ct.phone}</span>
              <span className="truncate">{ct.email}</span>
            </div>
          </div>
          <Badge tone={channelTone[ct.channel]} dot={false} className="self-start">
            {ct.channel}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/* ---- Open shipments ------------------------------------------------------ */

export function OpenShipmentsPanel({ customer }: { customer: CustomerRecord }) {
  const open = openShipmentsFor(customer.name);
  if (open.length === 0) return <EmptyRow label="Aucune expédition ouverte" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2 font-semibold">Référence</th>
            <th className="px-5 py-2 font-semibold">Mode</th>
            <th className="px-5 py-2 font-semibold">Origine</th>
            <th className="px-5 py-2 font-semibold">Destination</th>
            <th className="px-5 py-2 font-semibold">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {open.map((s) => {
            const st = shipmentStatus[s.status];
            return (
              <tr key={s.reference} className="hover:bg-sand-50">
                <td className="px-5 py-2.5">
                  <Link
                    href={`/shipments/${s.reference}`}
                    className="tabular text-sm font-medium text-navy-900 hover:text-teal-700"
                  >
                    {s.reference}
                  </Link>
                </td>
                <td className="px-5 py-2.5">
                  <ModeTag mode={s.mode} />
                </td>
                <td className="px-5 py-2.5 text-sm text-slate-600">{s.origin}</td>
                <td className="px-5 py-2.5 text-sm text-slate-600">
                  {s.destination}
                </td>
                <td className="px-5 py-2.5">
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

/* ---- Open customs files -------------------------------------------------- */

export function OpenCustomsPanel({ customer }: { customer: CustomerRecord }) {
  const open = openCustomsFor(customer.name);
  if (open.length === 0) return <EmptyRow label="Aucun dossier douane ouvert" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2 font-semibold">Réf. dossier</th>
            <th className="px-5 py-2 font-semibold">Déclaration</th>
            <th className="px-5 py-2 font-semibold">Statut</th>
            <th className="px-5 py-2 text-center font-semibold">Docs manq.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {open.map((f) => {
            const st = customsStatus[f.status];
            const missing = customsMissingDocs(f);
            return (
              <tr key={f.reference} className="hover:bg-sand-50">
                <td className="px-5 py-2.5">
                  <Link
                    href={`/customs/${f.reference}`}
                    className="tabular text-sm font-medium text-navy-900 hover:text-teal-700"
                  >
                    {f.reference}
                  </Link>
                </td>
                <td className="px-5 py-2.5">
                  <span className="tabular text-sm text-slate-600">
                    {f.declarationNumber}
                  </span>
                </td>
                <td className="px-5 py-2.5">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td className="px-5 py-2.5 text-center">
                  {missing > 0 ? (
                    <span className="tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-50 px-2 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-200">
                      {missing}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Documents ----------------------------------------------------------- */

const docIcon: Record<
  CustomerDocType,
  React.ComponentType<{ className?: string }>
> = {
  ninea: IconCard,
  rccm: IconDocument,
  tax: IconStamp,
  authorization: IconShield,
  trade: IconCertificate,
};

export function DocumentsPanel({ customer }: { customer: CustomerRecord }) {
  return (
    <ul className="divide-y divide-slate-50">
      {customer.documents.map((doc) => {
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
                {doc.ref ?? doc.date ?? "Référence à fournir"}
                {doc.ref && doc.date ? ` · ${doc.date}` : ""}
              </p>
            </div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Notes --------------------------------------------------------------- */

export function NotesPanel({ customer }: { customer: CustomerRecord }) {
  return (
    <ul className="space-y-4 px-5 py-5">
      {customer.notes.map((note, i) => {
        const meta = noteCategoryMeta[note.category];
        return (
          <li key={i} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-teal-300">
              {initials(note.author)}
            </span>
            <div className="min-w-0 flex-1 rounded-lg rounded-tl-none bg-sand-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-100">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-navy-900">
                    {note.author}
                  </p>
                  <Badge tone={meta.tone} dot={false}>
                    {meta.label}
                  </Badge>
                </div>
                <p className="tabular text-[11px] text-slate-400">{note.time}</p>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {note.text}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Shared -------------------------------------------------------------- */

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sand-100 text-slate-400">
        <IconContainer className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
