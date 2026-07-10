import Link from "next/link";
import { getPortalTracking } from "@/lib/portal/tracking";
import { listPortalInvoices } from "@/lib/portal/docs-service";
import { stageToMapPhase } from "@/lib/portal/shipment-view";
import { SummaryCard } from "@/components/portal/summary-card";
import { NextStepCard } from "@/components/portal/next-step-card";
import { EtaWidget } from "@/components/portal/eta-widget";
import { OfficerCard } from "@/components/portal/officer-card";
import { ShipmentMap } from "@/components/portal/shipment-map";
import { DocumentCenter } from "@/components/portal/document-center";
import { InvoiceCenter } from "@/components/portal/invoice-center";
import { DossierTimeline } from "@/components/portal/dossier-timeline";
import { QuickActions } from "@/components/portal/quick-actions";
import { ActionsRequired, ContactCard, RequestUpdateButton } from "@/components/portal/self-service";
import { CopilotSuggestions } from "@/components/portal/copilot-suggestions";
import { Satisfaction } from "@/components/portal/satisfaction";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalFileDetailPage({ params }: { params: { id: string } }) {
  const f = t.portal.files;
  const [tracking, invoices] = await Promise.all([
    getPortalTracking(params.id),
    listPortalInvoices(params.id),
  ]);

  if (!tracking) {
    return (
      <div className="animate-fade-in space-y-4">
        <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>
        <div className="surface p-6 text-sm text-slate-600">{f.notFound}</div>
      </div>
    );
  }

  const delivered = tracking.timeline.stages.find((s) => s.key === "delivered")?.status === "completed";
  const mapPhase = stageToMapPhase(tracking.currentStageKey);

  return (
    <div className="animate-fade-in space-y-5">
      <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>

      <SummaryCard tracking={tracking} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ShipmentMap points={tracking.mapPoints.points} hasGeo={tracking.mapPoints.hasGeo} phase={mapPhase} />
          <ActionsRequired fileId={tracking.fileId} selfService={tracking.selfService} />
          <DossierTimeline entries={tracking.activity} />
          <DocumentCenter documents={tracking.documents.available} requirements={tracking.documents.requirements} />
          <div id="invoices" className="scroll-mt-20">
            <InvoiceCenter invoices={invoices} />
          </div>
          <div id="contact" className="scroll-mt-20">
            <ContactCard fileId={tracking.fileId} />
          </div>
        </div>
        <aside className="space-y-5">
          <NextStepCard nextStep={tracking.nextStep} />
          <RequestUpdateButton fileId={tracking.fileId} />
          <EtaWidget eta={tracking.eta} />
          <OfficerCard officer={tracking.officer} />
          <QuickActions fileId={tracking.fileId} contactEmail={tracking.officer.businessEmail} />
          <CopilotSuggestions />
          {delivered && <Satisfaction />}
        </aside>
      </div>
    </div>
  );
}
