import Link from "next/link";
import { getPortalFileSummary } from "@/lib/portal/service";
import { getPortalProgress } from "@/lib/portal/progress";
import { getPortalOfficer } from "@/lib/portal/officer";
import { listPortalDocuments, listPortalInvoices } from "@/lib/portal/docs-service";
import { listClientNotifications } from "@/lib/customer-notify/service";
import { stageToMapPhase } from "@/lib/portal/shipment-view";
import { SummaryCard } from "@/components/portal/summary-card";
import { EtaWidget } from "@/components/portal/eta-widget";
import { OfficerCard } from "@/components/portal/officer-card";
import { ShipmentMap } from "@/components/portal/shipment-map";
import { DocumentCenter } from "@/components/portal/document-center";
import { InvoiceCenter } from "@/components/portal/invoice-center";
import { DossierTimeline } from "@/components/portal/dossier-timeline";
import { CopilotSuggestions } from "@/components/portal/copilot-suggestions";
import { Satisfaction } from "@/components/portal/satisfaction";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalFileDetailPage({ params }: { params: { id: string } }) {
  const f = t.portal.files;
  const file = await getPortalFileSummary(params.id);

  if (!file) {
    return (
      <div className="animate-fade-in space-y-4">
        <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>
        <div className="surface p-6 text-sm text-slate-600">{f.notFound}</div>
      </div>
    );
  }

  const [progress, officer, documents, invoices, notifications] = await Promise.all([
    getPortalProgress(file.id),
    getPortalOfficer(file.id),
    listPortalDocuments(file.id),
    listPortalInvoices(file.id),
    listClientNotifications(50),
  ]);

  const timelineEntries = notifications
    .filter((n) => n.fileId === file.id)
    .map((n) => ({ id: n.id, title: n.title, date: n.createdAt, category: n.category }));

  const delivered = progress
    ? progress.timeline.stages.find((s) => s.key === "delivered")?.status === "completed"
    : file.status === "DELIVERED" || file.status === "CLOSED";
  const mapPhase = stageToMapPhase(progress?.timeline.currentKey ?? null);
  const officerName = officer?.name ?? officer?.email ?? null;

  return (
    <div className="animate-fade-in space-y-5">
      <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>

      {progress ? (
        <SummaryCard file={file} progress={progress} officerName={officerName} />
      ) : (
        <h1 className="tabular text-2xl font-bold text-navy-900">{file.fileNumber}</h1>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ShipmentMap phase={mapPhase} />
          <DossierTimeline entries={timelineEntries} />
          <DocumentCenter documents={documents} />
          <InvoiceCenter invoices={invoices} />
        </div>
        <aside className="space-y-5">
          {progress && <EtaWidget eta={progress.eta} />}
          <OfficerCard officer={officer} />
          <CopilotSuggestions />
          {delivered && <Satisfaction />}
        </aside>
      </div>
    </div>
  );
}
