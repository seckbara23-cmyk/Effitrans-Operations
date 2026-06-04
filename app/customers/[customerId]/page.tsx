import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  customers,
  getCustomer,
  primaryContact,
  openShipmentsFor,
  openCustomsFor,
} from "@/lib/customers";
import { customerStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { AgentChip } from "@/components/ui/agent-chip";
import {
  ContactsPanel,
  OpenShipmentsPanel,
  OpenCustomsPanel,
  DocumentsPanel,
  NotesPanel,
} from "@/components/customers/customer-panels";
import { IconChevronRight, IconPin } from "@/lib/icons";

export function generateStaticParams() {
  return customers.map((c) => ({ customerId: c.id }));
}

export function generateMetadata({
  params,
}: {
  params: { customerId: string };
}): Metadata {
  const c = getCustomer(params.customerId);
  return { title: c ? `${c.name} · Client` : "Client introuvable" };
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
      <span className="text-right text-sm font-medium text-navy-900">
        {value}
      </span>
    </div>
  );
}

export default function CustomerDetailPage({
  params,
}: {
  params: { customerId: string };
}) {
  const c = getCustomer(params.customerId);
  if (!c) notFound();

  const cs = customerStatus[c.status];
  const contact = primaryContact(c);
  const openFiles =
    openShipmentsFor(c.name).length + openCustomsFor(c.name).length;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/customers" className="hover:text-teal-700">
          Clients
        </Link>
        <IconChevronRight className="h-4 w-4 text-slate-300" />
        <span className="font-medium text-navy-800">{c.name}</span>
      </nav>

      {/* Header band */}
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-5 py-6 text-white shadow-card sm:px-7">
        <div className="absolute inset-0 bg-chart-grid bg-[size:26px_26px] opacity-50" />
        <div className="absolute inset-0 bg-container-hatch" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-teal-300">
              {c.sector} · {c.type}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {c.name}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-300">
              <IconPin className="h-4 w-4 text-teal-300" />
              {c.city} · {c.since}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={cs.tone} className="bg-white/10 text-white ring-white/20">
              {cs.label}
            </Badge>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur">
              <span className="text-xs text-slate-300">Chargé de compte</span>
              <span className="text-sm font-semibold text-white">
                {c.accountManager}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <SummaryCard label="NINEA">
          <span className="tabular">{c.ninea}</span>
        </SummaryCard>
        <SummaryCard label="Secteur">{c.sector}</SummaryCard>
        <SummaryCard label="Contact principal">
          {contact.name}
          <span className="block text-xs font-normal text-slate-500">
            {contact.role}
          </span>
        </SummaryCard>
        <SummaryCard label="Téléphone / Email">
          <span className="tabular block">{c.phone}</span>
          <span className="block truncate text-xs font-normal text-slate-500">
            {c.email}
          </span>
        </SummaryCard>
        <SummaryCard label="Chargé de compte">
          <AgentChip name={c.accountManager} />
        </SummaryCard>
        <SummaryCard label="Dossiers ouverts">
          <span className="tabular text-lg">{openFiles}</span>
        </SummaryCard>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel eyebrow="Suivi opérationnel" title="Expéditions ouvertes">
            <OpenShipmentsPanel customer={c} />
          </Panel>

          <Panel
            eyebrow="Dédouanement"
            title="Dossiers de dédouanement ouverts"
          >
            <OpenCustomsPanel customer={c} />
          </Panel>

          <Panel eyebrow="Interlocuteurs" title="Contacts">
            <ContactsPanel customer={c} />
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel eyebrow="Identité" title="Profil société">
            <div className="divide-y divide-slate-50 px-5 py-2">
              <MetaRow label="Raison sociale" value={c.legalName} />
              <MetaRow label="Nom commercial" value={c.tradeName} />
              <MetaRow label="Adresse" value={c.address} />
              <MetaRow label="Ville" value={c.city} />
              <MetaRow label="Type de client" value={c.type} />
              <MetaRow label="RCCM" value={c.rccm} />
            </div>
          </Panel>

          <Panel eyebrow="Conformité" title="Documents administratifs">
            <DocumentsPanel customer={c} />
          </Panel>

          <Panel eyebrow="Échanges internes" title="Notes internes">
            <NotesPanel customer={c} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
