import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFile } from "@/lib/files/service";
import { listClients } from "@/lib/clients/service";
import { FileForm } from "@/components/files/file-form";
import { FileWorkflow } from "@/components/files/file-workflow";
import { TaskPanel } from "@/components/tasks/task-panel";
import { listTasks, listAssignees } from "@/lib/tasks/service";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { listDocuments, listDocumentTypes, getMissingRequiredDocuments } from "@/lib/documents/service";
import { CustomsPanel } from "@/components/customs/customs-panel";
import { getCustomsRecord, getMissingCustomsDocuments } from "@/lib/customs/service";
import { TransportPanel } from "@/components/transport/transport-panel";
import { getTransportRecord } from "@/lib/transport/service";
import { FinancePanel } from "@/components/finance/finance-panel";
import { getFinanceForFile } from "@/lib/finance/service";
import { CommunicationsTimeline } from "@/components/communications/communications-timeline";
import { listCommunicationsForFile } from "@/lib/comms/service";
import { LifecycleTracker } from "@/components/files/lifecycle-tracker";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
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

  return (
    <div className="animate-fade-in space-y-6">
      {header(`${file.fileNumber}`)}
      <Link href="/files" className="text-sm text-teal-700 hover:underline">
        ← {t.files.backToList}
      </Link>
      <FileWorkflow file={file} canUpdate={canUpdate} />
      <LifecycleTracker lifecycle={lifecycle} />
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
    </div>
  );
}
