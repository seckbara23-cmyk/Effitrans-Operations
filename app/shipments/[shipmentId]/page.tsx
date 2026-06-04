import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { shipments, getShipment } from "@/lib/shipments";
import { customerHref } from "@/lib/customers";
import { shipmentStatus, transportMode } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { AgentChip } from "@/components/ui/agent-chip";
import { ModeTag } from "@/components/ui/mode-tag";
import { ShipmentTimeline } from "@/components/shipments/shipment-timeline";
import {
  DocumentsPanel,
  TasksPanel,
  NotesPanel,
} from "@/components/shipments/shipment-panels";
import { IconChevronRight, IconPin, IconClock } from "@/lib/icons";

export function generateStaticParams() {
  return shipments.map((s) => ({ shipmentId: s.reference }));
}

export function generateMetadata({
  params,
}: {
  params: { shipmentId: string };
}): Metadata {
  const s = getShipment(params.shipmentId);
  return { title: s ? `${s.reference} · Expédition` : "Dossier introuvable" };
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

export default function ShipmentDetailPage({
  params,
}: {
  params: { shipmentId: string };
}) {
  const s = getShipment(params.shipmentId);
  if (!s) notFound();

  const st = shipmentStatus[s.status];
  const customerLink = customerHref(s.customer);

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/shipments" className="hover:text-teal-700">
          Dossiers d'expédition
        </Link>
        <IconChevronRight className="h-4 w-4 text-slate-300" />
        <span className="tabular font-medium text-navy-800">{s.reference}</span>
      </nav>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:26px_26px] opacity-50" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">{s.goods}</p>
            <h1 className="tabular mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {s.reference}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              {s.customer} · {s.incoterm}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={st.tone} className="bg-white/10 text-white ring-white/20">
              {st.label}
            </Badge>
            <p className="tabular text-xs text-slate-300">
              Dernière mise à jour : {s.lastUpdate}
            </p>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <SummaryCard label="Client">
          {customerLink ? (
            <Link href={customerLink} className="text-teal-700 hover:text-teal-800">
              {s.customer}
            </Link>
          ) : (
            s.customer
          )}
        </SummaryCard>
        <SummaryCard label="Mode de transport">
          <ModeTag mode={s.mode} />
        </SummaryCard>
        <SummaryCard label="Trajet">
          <span className="inline-flex items-center gap-1.5">
            <IconPin className="h-4 w-4 text-teal-600" />
            {s.origin}
            <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
            {s.destination}
          </span>
        </SummaryCard>
        <SummaryCard label="Agent assigné">
          <AgentChip name={s.agent} />
        </SummaryCard>
        <SummaryCard label="ETA">
          <span className="inline-flex items-center gap-1.5">
            <IconClock className="h-4 w-4 text-amber-600" />
            {s.eta}
          </span>
        </SummaryCard>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel eyebrow="Suivi opérationnel" title="Étapes du dossier">
            <ShipmentTimeline shipment={s} />
          </Panel>

          <Panel eyebrow="Pièces du dossier" title="Documents">
            <DocumentsPanel shipment={s} />
          </Panel>

          <Panel eyebrow="Actions" title="Tâches">
            <TasksPanel shipment={s} />
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel eyebrow="Caractéristiques" title="Détails de l'expédition">
            <div className="divide-y divide-slate-50 px-5 py-2">
              <MetaRow label="Référence transport" value={s.transportRef ?? "—"} />
              <MetaRow label="Incoterm" value={s.incoterm} />
              <MetaRow label="Poids" value={s.weight} />
              <MetaRow label="Colisage" value={s.packages} />
              <MetaRow label="ETA" value={s.eta} />
            </div>
          </Panel>

          <Panel
            eyebrow="Échanges internes"
            title="Notes internes"
            action={undefined}
          >
            <NotesPanel shipment={s} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
