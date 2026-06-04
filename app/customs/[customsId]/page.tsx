import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { customsFiles, getCustomsFile } from "@/lib/customs";
import { customsStatus, priority as priorityMeta } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { AgentChip } from "@/components/ui/agent-chip";
import { CustomsTimeline } from "@/components/customs/customs-timeline";
import {
  DocumentsChecklist,
  DutiesPanel,
  BlockingIssuesPanel,
  NotesPanel,
} from "@/components/customs/customs-panels";
import { IconChevronRight, IconBuilding } from "@/lib/icons";

export function generateStaticParams() {
  return customsFiles.map((f) => ({ customsId: f.reference }));
}

export function generateMetadata({
  params,
}: {
  params: { customsId: string };
}): Metadata {
  const f = getCustomsFile(params.customsId);
  return {
    title: f ? `${f.reference} · Dédouanement` : "Dossier introuvable",
  };
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
      <span className="tabular text-sm font-medium text-navy-900">{value}</span>
    </div>
  );
}

export default function CustomsDetailPage({
  params,
}: {
  params: { customsId: string };
}) {
  const f = getCustomsFile(params.customsId);
  if (!f) notFound();

  const st = customsStatus[f.status];
  const pr = priorityMeta[f.priority];

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/customs" className="hover:text-teal-700">
          Dédouanement
        </Link>
        <IconChevronRight className="h-4 w-4 text-slate-300" />
        <span className="tabular font-medium text-navy-800">{f.reference}</span>
      </nav>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:26px_26px] opacity-50" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">{f.goods}</p>
            <h1 className="tabular mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {f.reference}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              {f.customer} · {f.office}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Expédition liée :{" "}
              {f.relatedShipmentArchived ? (
                <span className="tabular font-medium text-slate-400">
                  {f.relatedShipment} (archivée)
                </span>
              ) : (
                <Link
                  href={`/shipments/${f.relatedShipment}`}
                  className="tabular inline-flex items-center gap-1 font-medium text-teal-300 hover:text-teal-200"
                >
                  {f.relatedShipment}
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={st.tone} className="bg-white/10 text-white ring-white/20">
              {st.label}
            </Badge>
            {f.baeRef && (
              <p className="tabular text-xs text-teal-300">BAE : {f.baeRef}</p>
            )}
            <p className="tabular text-xs text-slate-300">
              Dernière mise à jour : {f.lastUpdate}
            </p>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <SummaryCard label="Client">{f.customer}</SummaryCard>
        <SummaryCard label="Expédition liée">
          {f.relatedShipmentArchived ? (
            <span className="tabular text-slate-500">{f.relatedShipment}</span>
          ) : (
            <Link
              href={`/shipments/${f.relatedShipment}`}
              className="tabular text-teal-700 hover:text-teal-800"
            >
              {f.relatedShipment}
            </Link>
          )}
        </SummaryCard>
        <SummaryCard label="Bureau de douane">
          <span className="inline-flex items-center gap-1.5">
            <IconBuilding className="h-4 w-4 text-teal-600" />
            {f.office}
          </span>
        </SummaryCard>
        <SummaryCard label="N° de déclaration">
          <span className="tabular">{f.declarationNumber}</span>
        </SummaryCard>
        <SummaryCard label="Agent douane">
          <AgentChip name={f.officer} />
        </SummaryCard>
        <SummaryCard label="Priorité">
          <Badge tone={pr.tone} dot={false}>
            {pr.label}
          </Badge>
        </SummaryCard>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel eyebrow="Workflow douanier" title="Étapes du dédouanement">
            <CustomsTimeline file={f} />
          </Panel>

          <Panel eyebrow="Pièces du dossier" title="Documents requis">
            <DocumentsChecklist file={f} />
          </Panel>

          <Panel eyebrow="Points de blocage" title="Dossiers en attente / blocages">
            <BlockingIssuesPanel file={f} />
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel eyebrow="Liquidation" title="Droits et taxes">
            <DutiesPanel file={f} />
          </Panel>

          <Panel eyebrow="Caractéristiques" title="Détails du dossier">
            <div className="divide-y divide-slate-50 px-5 py-2">
              <MetaRow label="Type de déclaration" value={f.declarationType} />
              <MetaRow label="Régime douanier" value={f.regime} />
              <MetaRow label="Site marchandise" value={f.site} />
              <MetaRow label="Bon à enlever (BAE)" value={f.baeRef ?? "—"} />
            </div>
          </Panel>

          <Panel eyebrow="Échanges internes" title="Notes internes">
            <NotesPanel file={f} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
