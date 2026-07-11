import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFile, listAssignableStaff } from "@/lib/files/service";
import { canCancel } from "@/lib/files/status";
import { listClients } from "@/lib/clients/service";
import { FileForm } from "@/components/files/file-form";
import { FileWorkflow } from "@/components/files/file-workflow";
import { FileAssignment } from "@/components/files/file-assignment";
import { FileDangerZone } from "@/components/files/file-danger-zone";
import { TaskPanel } from "@/components/tasks/task-panel";
import { listTasks, listAssignees } from "@/lib/tasks/service";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { listDocuments, listDocumentTypes, getMissingRequiredDocuments } from "@/lib/documents/service";
import { CustomsPanel } from "@/components/customs/customs-panel";
import { getCustomsRecord, getMissingCustomsDocuments } from "@/lib/customs/service";
import { TransportPanel } from "@/components/transport/transport-panel";
import { getTransportRecord } from "@/lib/transport/service";
import { TrackingTimeline } from "@/components/transport/tracking-timeline";
import { getTrackingTimeline } from "@/lib/tracking/service";
import { trackingEnabled } from "@/lib/tracking/config";
import { DriverAssign } from "@/components/transport/driver-assign";
import { listAssignableDrivers } from "@/lib/transport/drivers";
import { FinancePanel } from "@/components/finance/finance-panel";
import { getFinanceForFile } from "@/lib/finance/service";
import { CommunicationsTimeline } from "@/components/communications/communications-timeline";
import { listCommunicationsForFile } from "@/lib/comms/service";
import { LifecycleTracker } from "@/components/files/lifecycle-tracker";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { getOpenHandoffForFile } from "@/lib/handoffs/service";
import { getDossierStage } from "@/lib/sla/service";
import { SlaPanel } from "@/components/files/sla-panel";
import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { RiskPanel } from "@/components/copilot/risk-panel";
import { assessRisk, overdueDays, type RiskInput } from "@/lib/copilot/risk-engine";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.files.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function FileDetailPage({ params }: { params: { id: string } }) {
  const header = (title: string) => (
    <PageHeader meta="Opérations" title={title} subtitle={t.files.subtitle} />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.forbidden}</Notice></div>;
  }

  const file = await getFile(params.id);
  if (!file) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.errors.not_found}</Notice></div>;
  }

  const canUpdate = hasPermission(permissions, "file:update");
  const clients = hasPermission(permissions, "client:read")
    ? (await listClients()).map((c) => ({ id: c.id, name: c.name }))
    : file.clientId
      ? [{ id: file.clientId, name: file.clientName ?? file.clientId }]
      : [];

  // Phase 3.2A — assignment + delete/cancel controls (permission-gated).
  const canAssign = hasPermission(permissions, "file:assign");
  const canManageLifecycle = hasPermission(permissions, "file:delete");
  const assignableStaff = canAssign ? await listAssignableStaff() : [];
  const assigneeLabel = file.assigneeName ?? file.assigneeEmail;

  // Embedded tasks (only if the user can read tasks).
  const canReadTasks = hasPermission(permissions, "task:read");
  const canUpdateTasks = hasPermission(permissions, "task:update");
  const tasks = canReadTasks ? await listTasks({ fileId: file.id }) : [];
  const taskAssignees = canUpdateTasks ? await listAssignees() : [];

  // Embedded documents (only if the user can read documents).
  const canReadDocs = hasPermission(permissions, "document:read");
  const [documents, docTypes, missingDocs] = canReadDocs
    ? await Promise.all([
        listDocuments(file.id),
        listDocumentTypes(),
        getMissingRequiredDocuments(file.id, file.type),
      ])
    : [[], [], []];

  // Embedded customs (only if the user can read customs).
  const canReadCustoms = hasPermission(permissions, "customs:read");
  const [customsRecord, missingCustomsDocs] = canReadCustoms
    ? await Promise.all([getCustomsRecord(file.id), getMissingCustomsDocuments(file.id)])
    : [null, []];

  // Embedded transport (only if the user can read transport).
  const canReadTransport = hasPermission(permissions, "transport:read");
  const transportRecord = canReadTransport ? await getTransportRecord(file.id) : null;
  const podApproved = documents.some((d) => d.typeCode === "DELIVERY_NOTE" && d.status === "APPROVED");

  // Phase 3.4 — real-time tracking timeline. DARK BY DEFAULT: only when
  // TRACKING_ENABLED and the user holds tracking:read; otherwise nothing changes.
  const trackingOn = trackingEnabled();
  const canReadTracking = hasPermission(permissions, "tracking:read");
  const trackingEvents = trackingOn && canReadTracking ? await getTrackingTimeline(file.id) : [];
  // Phase 3.4C — dispatcher driver assignment (assign a DRIVER user for the mobile app).
  const canAssignDriver = hasPermission(permissions, "transport:assign");
  const assignableDrivers = trackingOn && canAssignDriver && transportRecord ? await listAssignableDrivers() : [];

  // Embedded finance (finance-role based — NOT inherited from file visibility).
  const canReadFinance = hasPermission(permissions, "finance:read");
  const finance = canReadFinance ? await getFinanceForFile(file.id) : null;

  // Communications (staff-role based) — timeline + manual email triggers.
  const canEmail = hasPermission(permissions, "communication:send");
  const canReadComms = hasPermission(permissions, "communication:read");
  const communications = canReadComms ? await listCommunicationsForFile(file.id) : [];

  // Read-only derived lifecycle tracker (Phase 2.0 addendum) — no mutation.
  const lifecycle = getDossierLifecycle({
    fileId: file.id,
    file: { status: file.status, type: file.type },
    documents: documents.map((d) => ({ status: d.status })),
    missingRequired: missingDocs.map((m) => ({ label: m.label })),
    customs: customsRecord ? { status: customsRecord.status, required: customsRecord.required } : null,
    transport: transportRecord ? { status: transportRecord.status } : null,
    invoices: (finance?.invoices ?? []).map((i) => ({ status: i.status, balance: i.balance })),
    podApproved,
  });
  const openHandoff = await getOpenHandoffForFile(file.id);
  const sla = await getDossierStage(file.id, lifecycle.currentDepartment, lifecycle.currentStep).catch(() => null);

  // Read-only derived risk assessment (Phase 3.1B) — same Risk Engine the
  // Copilot, Control Tower and dashboard use. No persistence, no mutation.
  const now = new Date();
  const overdueInvoices = (finance?.invoices ?? []).filter((i) => i.overdue);
  const maxOverdueDays = overdueInvoices.reduce((m, i) => Math.max(m, overdueDays(i.dueDate, now)), 0);
  const riskInput: RiskInput = {
    lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
    sla: sla ? { status: sla.status } : null,
    documents: { missingRequiredCount: canReadDocs ? missingDocs.length : 0 },
    customs: canReadCustoms
      ? {
          underInspection: customsRecord?.status === "INSPECTION",
          inspectionDays: customsRecord?.status === "INSPECTION" ? sla?.stage.ageDays ?? null : null,
        }
      : null,
    transport: canReadTransport
      ? {
          awaitingPod: lifecycle.currentStep === "invoiced" && lifecycle.nextAction?.reasonCode === "await_pod",
          transitExceedsSla:
            transportRecord?.status === "IN_TRANSIT" && (sla?.status === "warning" || sla?.status === "critical"),
        }
      : null,
    finance: canReadFinance && finance ? { overdueCount: overdueInvoices.length, maxOverdueDays: maxOverdueDays || null } : null,
  };
  const risk = assessRisk(riskInput);

  return (
    <div className="animate-fade-in space-y-6">
      {header(`${file.fileNumber}`)}
      <Link href="/files" className="text-sm text-teal-700 hover:underline">
        ← {t.files.backToList}
      </Link>
      <FileWorkflow file={file} canUpdate={canUpdate} />
      <FileAssignment
        fileId={file.id}
        currentAssigneeId={file.assignedToUserId}
        currentAssigneeLabel={assigneeLabel}
        staff={assignableStaff}
        canAssign={canAssign}
      />
      <LifecycleTracker lifecycle={lifecycle} openHandoff={openHandoff ? { title: openHandoff.title } : null} />
      <RiskPanel risk={risk} />
      {sla && <SlaPanel sla={sla} department={lifecycle.currentDepartment} />}
      <FileForm mode="edit" fileId={file.id} initial={file} clients={clients} canUpdate={canUpdate} />
      {canReadTasks && (
        <TaskPanel
          fileId={file.id}
          tasks={tasks}
          assignees={taskAssignees}
          canCreate={hasPermission(permissions, "task:create")}
          canUpdate={canUpdateTasks}
          canDelete={hasPermission(permissions, "task:delete")}
        />
      )}
      {canReadDocs && (
        <div id="documents" className="scroll-mt-24">
          <DocumentsPanel
            fileId={file.id}
            documents={documents}
            types={docTypes}
            missing={missingDocs}
            canCreate={hasPermission(permissions, "document:create")}
            canApprove={hasPermission(permissions, "document:approve")}
            canDelete={hasPermission(permissions, "document:delete")}
            canEmail={canEmail}
          />
        </div>
      )}
      {canReadCustoms && (
        <div id="customs" className="scroll-mt-24">
          <CustomsPanel
            fileId={file.id}
            record={customsRecord}
            missing={missingCustomsDocs}
            canCreate={hasPermission(permissions, "customs:create")}
            canUpdate={hasPermission(permissions, "customs:update")}
            canRelease={hasPermission(permissions, "customs:release")}
            canDelete={hasPermission(permissions, "customs:delete")}
          />
        </div>
      )}
      {canReadTransport && (
        <div id="transport" className="scroll-mt-24">
          <TransportPanel
            fileId={file.id}
            record={transportRecord}
            podApproved={podApproved}
            canCreate={hasPermission(permissions, "transport:create")}
            canUpdate={hasPermission(permissions, "transport:update")}
            canAssign={hasPermission(permissions, "transport:assign")}
            canComplete={hasPermission(permissions, "transport:complete")}
            canDelete={hasPermission(permissions, "transport:delete")}
          />
        </div>
      )}
      {trackingOn && canReadTransport && transportRecord && (
        <DriverAssign
          transportId={transportRecord.id}
          currentDriverUserId={transportRecord.driverUserId}
          drivers={assignableDrivers}
          canAssign={canAssignDriver}
        />
      )}
      {trackingOn && canReadTracking && (
        <div id="tracking" className="scroll-mt-24">
          <TrackingTimeline
            fileId={file.id}
            events={trackingEvents}
            canWrite={hasPermission(permissions, "tracking:write")}
          />
        </div>
      )}
      {canReadFinance && finance && (
        <div id="finance" className="scroll-mt-24">
          <FinancePanel
            fileId={file.id}
            finance={finance}
            canCreate={hasPermission(permissions, "finance:create")}
            canUpdate={hasPermission(permissions, "finance:update")}
            canIssueInvoice={hasPermission(permissions, "finance:issue")}
            canPayment={hasPermission(permissions, "finance:payment")}
            canVoidInvoice={hasPermission(permissions, "finance:void")}
            canDelete={hasPermission(permissions, "finance:delete")}
            canEmail={canEmail}
          />
        </div>
      )}
      {canReadComms && <CommunicationsTimeline messages={communications} />}
      <FileDangerZone
        fileId={file.id}
        canManage={canManageLifecycle}
        cancellable={canCancel(file.status)}
      />
      <CopilotPanel fileId={file.id} />
    </div>
  );
}
