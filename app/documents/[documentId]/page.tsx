import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  documents,
  getDocument,
  docTypeMeta,
  docSourceLabel,
} from "@/lib/documents";
import { documentStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { AgentChip } from "@/components/ui/agent-chip";
import { DocTypeIcon } from "@/components/documents/doc-type-icon";
import {
  CompletenessPanel,
  RelatedFilesPanel,
  ValidationHistoryPanel,
  NotesPanel,
} from "@/components/documents/document-panels";
import { IconChevronRight } from "@/lib/icons";

export function generateStaticParams() {
  return documents.map((d) => ({ documentId: d.id }));
}

export function generateMetadata({
  params,
}: {
  params: { documentId: string };
}): Metadata {
  const d = getDocument(params.documentId);
  return { title: d ? `${d.reference} · Document` : "Document introuvable" };
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

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="tabular text-right text-sm font-medium text-navy-900">
        {value}
      </span>
    </div>
  );
}

export default function DocumentDetailPage({
  params,
}: {
  params: { documentId: string };
}) {
  const d = getDocument(params.documentId);
  if (!d) notFound();

  const st = documentStatus[d.status];

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/documents" className="hover:text-teal-700">
          Documents
        </Link>
        <IconChevronRight className="h-4 w-4 text-slate-300" />
        <span className="tabular font-medium text-navy-800">{d.reference}</span>
      </nav>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:26px_26px] opacity-50" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-200 ring-1 ring-inset ring-white/15">
              <DocTypeIcon type={d.type} className="h-6 w-6" />
            </span>
            <div>
              <p className="eyebrow text-teal-300">{docTypeMeta[d.type].label}</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
                {d.name}
              </h1>
              <p className="tabular mt-1 text-sm text-slate-300">
                {d.reference} · {d.customer}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={st.tone} className="bg-white/10 text-white ring-white/20">
              {st.label}
            </Badge>
            <p className="text-xs text-slate-300">
              Source : {docSourceLabel[d.source]} · {d.format}
            </p>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <SummaryCard label="Type de document">
          {docTypeMeta[d.type].label}
        </SummaryCard>
        <SummaryCard label="Client">{d.customer}</SummaryCard>
        <SummaryCard label="Statut">
          <Badge tone={st.tone}>{st.label}</Badge>
        </SummaryCard>
        <SummaryCard label="Expédition liée">
          {d.relatedShipment ? (
            <Link
              href={`/shipments/${d.relatedShipment}`}
              className="tabular text-teal-700 hover:text-teal-800"
            >
              {d.relatedShipment}
            </Link>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </SummaryCard>
        <SummaryCard label="Dossier douane lié">
          {d.relatedCustomsFile ? (
            <Link
              href={`/customs/${d.relatedCustomsFile}`}
              className="tabular text-teal-700 hover:text-teal-800"
            >
              {d.relatedCustomsFile}
            </Link>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </SummaryCard>
        <SummaryCard label="Responsable">
          <AgentChip name={d.owner} />
        </SummaryCard>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel eyebrow="Complétude du dossier" title="Pièces du dossier lié">
            <CompletenessPanel document={d} />
          </Panel>

          <Panel eyebrow="Validation" title="Historique de validation">
            <ValidationHistoryPanel document={d} />
          </Panel>

          <Panel eyebrow="Échanges internes" title="Notes internes">
            <NotesPanel document={d} />
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel eyebrow="Métadonnées" title="Informations du document">
            <div className="divide-y divide-slate-50 px-5 py-2">
              <MetaRow label="Référence" value={d.reference} />
              <MetaRow label="Type" value={docTypeMeta[d.type].label} />
              <MetaRow label="Date d'émission" value={d.issueDate ?? "—"} />
              <MetaRow label="Date de réception" value={d.receivedDate ?? "—"} />
              <MetaRow label="Date d'expiration" value={d.expiryDate ?? "—"} />
              <MetaRow label="Format" value={d.format} />
              <MetaRow label="Source" value={docSourceLabel[d.source]} />
            </div>
          </Panel>

          <Panel eyebrow="Rattachements" title="Fichiers liés">
            <RelatedFilesPanel document={d} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
