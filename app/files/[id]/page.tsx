import { getCanonicalDossierState } from "@/lib/workflow/dossier-state";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ProcessJourneyPanel } from "@/components/process/process-journey";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getDossierCarriage, getFile, getTenantTimezone, listAssignableStaff, listFiles } from "@/lib/files/service";
import { CarriagePanel } from "@/components/files/carriage-panel";
import { QC2Panel } from "@/components/files/qc2-panel";
import { deriveQC2 } from "@/lib/files/qc2";
import { deriveMayaLabelFromRow, isCargoForm, CARGO_FORM_LABELS_FR } from "@/lib/files/taxonomy";
import { canCancel } from "@/lib/files/status";
import { listClients } from "@/lib/clients/service";
import { FileForm } from "@/components/files/file-form";
import { FileWorkflow } from "@/components/files/file-workflow";
import { FileAssignment } from "@/components/files/file-assignment";
import { FileDangerZone } from "@/components/files/file-danger-zone";
import { TaskPanel } from "@/components/tasks/task-panel";
import { listTasks } from "@/lib/tasks/service";
import { listEligibleAssigneesForFile } from "@/lib/workflow/access/assignees";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { listDocuments, listDocumentTypes, getMissingRequiredDocuments } from "@/lib/documents/service";
import { CustomsPanel } from "@/components/customs/customs-panel";
import { getCustomsRecord, getMissingCustomsDocuments } from "@/lib/customs/service";
import { isVerified } from "@/lib/documents/doctrine";
import { TransportPanel } from "@/components/transport/transport-panel";
import { DeliveryProofPanel } from "@/components/transport/delivery-proof-panel";
import { getTransportRecord } from "@/lib/transport/service";
import { TrackingTimeline } from "@/components/transport/tracking-timeline";
import { getTrackingTimeline } from "@/lib/tracking/service";
import { trackingEnabled } from "@/lib/tracking/config";
import { DriverAssign } from "@/components/transport/driver-assign";
import { listAssignableDrivers } from "@/lib/transport/drivers";
import { FinancePanel } from "@/components/finance/finance-panel";
import { getFinanceForFile } from "@/lib/finance/service";
import { MailTimeline } from "@/components/mail/mail-timeline";
import { listCommunicationsForFile } from "@/lib/comms/service";
import { LifecycleTracker } from "@/components/files/lifecycle-tracker";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import { getOpenHandoffForFile } from "@/lib/handoffs/service";
import { getDossierStage } from "@/lib/sla/service";
import { SlaPanel } from "@/components/files/sla-panel";
import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { RiskPanel } from "@/components/copilot/risk-panel";
import { assessRisk, overdueDays, type RiskInput } from "@/lib/copilot/risk-engine";
import { EventTimeline } from "@/components/files/event-timeline";
import { OwnershipPanel } from "@/components/files/ownership-panel";
import { ArtifactPanel } from "@/components/documents/artifact-panel";
import { getArtifactPanel } from "@/lib/documents/artifacts/service";
import { getDossierAccess } from "@/lib/workflow/access/service";
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
  // Editing master data and advancing the status ladder are INDEPENDENT
  // authorities. A supervisor may close a dossier without being able to
  // rewrite it.
  const canTransitionStatus = hasPermission(permissions, "file:transition");
  const clients = hasPermission(permissions, "client:read")
    ? (await listClients()).map((c) => ({ id: c.id, name: c.name }))
    : file.clientId
      ? [{ id: file.clientId, name: file.clientName ?? file.clientId }]
      : [];

  // MAYA-P0.5-B — candidate parents for « Dossier mère » and the derived MAYA
  // compatibility label. listFiles is already scoped by file:read + visibility,
  // so a dossier the user cannot see can never be offered as a parent — and the
  // database refuses a cross-tenant parent regardless.
  const parentOptions = canUpdate
    ? (await listFiles()).filter((f) => f.id !== file.id).map((f) => ({ id: f.id, fileNumber: f.fileNumber }))
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
  // WES-3A.1 — only people the PINNED policy permits for this dossier's
  // current step. `listAssignees()` returned every staff member, and the
  // server had no eligibility check, so any name in the list "worked".
  const eligible = canUpdateTasks
    ? await listEligibleAssigneesForFile(file.id)
    : { assignees: [], resolved: true };
  const taskAssignees = eligible.assignees;

  // Embedded documents (only if the user can read documents).
  const canReadDocs = hasPermission(permissions, "document:read");
  const [documents, docTypes, missingDocs] = canReadDocs
    ? await Promise.all([
        listDocuments(file.id),
        listDocumentTypes(),
        getMissingRequiredDocuments(file.id, file.type),
      ])
    : [[], [], []];

  // MAYA-P0.7-C — Contrôle Qualité N°2. Derived from facts this page already
  // loaded; the only added read is the tenant zone, so an instant is never
  // rendered against the SERVER's clock. `canReadDocs` is passed through
  // deliberately: a viewer without document:read must read "non visible", never
  // "0 documents".
  const qc2 = deriveQC2({
    fileNumber: file.fileNumber,
    createdAt: file.createdAt,
    clientName: file.clientName,
    canReadDocuments: canReadDocs,
    documents,
    missingRequiredCount: missingDocs.length,
    timeZone: await getTenantTimezone(),
  });

  // Embedded customs (only if the user can read customs).
  const canReadCustoms = hasPermission(permissions, "customs:read");
  const [customsRecord, missingCustomsDocs] = canReadCustoms
    ? await Promise.all([getCustomsRecord(file.id), getMissingCustomsDocuments(file.id)])
    : [null, []];

  // MAYA-P0.5-B — the derived compatibility label. Only computed when the
  // customs regime is READABLE by this user: deriving « TC » for someone who
  // cannot see that the regime is suspensive would state a half-truth as a
  // fact. Without customs:read the dossier simply has no MAYA label here.
  const mayaLabel = canReadCustoms
    ? deriveMayaLabelFromRow({
        type: file.type,
        transportMode: file.shipment?.transportMode ?? null,
        cargoForm: file.shipment?.cargoForm ?? null,
        regime: customsRecord?.regime ?? null,
      })
    : null;

  // Embedded transport (only if the user can read transport).
  const canReadTransport = hasPermission(permissions, "transport:read");
  const transportRecord = canReadTransport ? await getTransportRecord(file.id) : null;
  // MAYA-P0.6-D — the dossier's own carriage units. Gated on the SAME
  // transport:read the panels below use, so an ungated viewer issues no query at
  // all: the rows are never retrieved, not retrieved and then hidden. Returns
  // null for a road-only dossier, which has no carriage units by construction.
  const carriage =
    canReadTransport && file.shipment
      ? await getDossierCarriage(file.shipment.id, file.shipment.transportMode)
      : null;
  // UAT-1 — the canonical predicate, not the pre-WES-4 literal. A POD is proof
  // when it is VERIFIED, when it is a legacy APPROVED row, or once WES-5 has
  // consumed it as evidence.
  const podDocument = documents.find((d) => d.typeCode === "DELIVERY_NOTE") ?? null;
  const podApproved = documents.some((d) => d.typeCode === "DELIVERY_NOTE" && isVerified(d.status));

  // Phase 3.4 — real-time tracking timeline. DARK BY DEFAULT: only when
  // TRACKING_ENABLED and the user holds tracking:read; otherwise nothing changes.
  const trackingOn = trackingEnabled();
  const canReadTracking = hasPermission(permissions, "tracking:read");
  const trackingEvents = trackingOn && canReadTracking ? await getTrackingTimeline(file.id) : [];
  // Phase 3.4C — dispatcher driver assignment (assign a DRIVER user).
  // WES-1E: chauffeur IDENTITY assignment is NOT a tracking feature. Gating it
  // behind TRACKING_ENABLED meant a planner could fill in a driver's name, see no
  // error, and leave the chauffeur with no mission — GPS configuration silently
  // controlled who was authenticated. Identity is gated on transport:assign only;
  // TRACKING_ENABLED still gates GPS sessions, positions and the live map.
  const canAssignDriver = hasPermission(permissions, "transport:assign");
  const assignableDrivers = canAssignDriver && transportRecord ? await listAssignableDrivers() : [];

  // Embedded finance (finance-role based — NOT inherited from file visibility).
  const canReadFinance = hasPermission(permissions, "finance:read");
  const finance = canReadFinance ? await getFinanceForFile(file.id) : null;

  // Communications (staff-role based) — timeline + manual email triggers.
  const canEmail = hasPermission(permissions, "communication:send");
  const canReadComms = hasPermission(permissions, "communication:read");
  const communications = canReadComms ? await listCommunicationsForFile(file.id) : [];

  // ===========================================================================
  // CANONICAL STATE — viewer-independent, by construction.
  //
  // This block used to assemble the workflow input from PERMISSION-GATED reads
  // (`canReadCustoms ? customsRecord : null`), so a Finance user without
  // customs:read was told to "prepare the customs declaration" on a dossier
  // that was delivered, invoiced and paid: absence of permission was read as
  // absence of progress.
  //
  // The state now comes from the ONE resolver, which reads everything on the
  // admin client and does not know who is asking. The `canRead*` flags below
  // still decide which PANELS render and which ACTIONS appear — never what the
  // operational truth is.
  // ===========================================================================
  const canonical = await getCanonicalDossierState(file.id, user.tenantId);
  // The dossier was loaded above, so the resolver cannot miss it; notFound()
  // rather than render half a page against a dossier that vanished mid-request.
  if (!canonical) return null;
  const { lifecycle, projection } = canonical;

  // WES-3D — the ONE access contract. Everything the ownership panel shows, and
  // the reason it is visible at all, comes from here.
  const dossierAccess = await getDossierAccess(file.id);
  // WES-4H — Category-B artifacts. `transport:manage` mirrors the server's
  // own gate in generateArtifact; the server re-checks it regardless.
  const canGenerateArtifacts = hasPermission(permissions, "transport:manage");
  const artifactItems = canReadDocs ? await getArtifactPanel(file.id) : [];
  const currentTask = tasks.find((t) => t.status === "TODO" || t.status === "IN_PROGRESS") ?? null;

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
      {/* MAYA-P0.6-B — naming consistency: the header carries the same derived
          business name the list shows, so a dossier does not change identity
          between the two surfaces. Falls back to the generic label when the
          name cannot be derived in full (including for a viewer without
          customs:read). */}
      <PageHeader
        meta="Opérations"
        title={file.fileNumber}
        subtitle={[
          mayaLabel?.labelFr ?? t.files.types[file.type],
          file.legacyReference ? `Réf. MAYA ${file.legacyReference}` : null,
          file.clientReference ? `Réf. client ${file.clientReference}` : null,
        ].filter(Boolean).join(" · ")}
      />
      <Link href="/files" className="text-sm text-teal-700 hover:underline">
        ← {t.files.backToList}
      </Link>
      {/* Phase 5.0E-1 (D10) — renders nothing when the engine is dark or this
          dossier has no process instance. Not a 26-step checklist: it answers
          "where is this, who has it, what next". */}
      <ProcessJourneyPanel fileId={file.id} />
      <FileWorkflow file={file} canTransitionStatus={canTransitionStatus} />
      <FileAssignment
        fileId={file.id}
        currentAssigneeId={file.assignedToUserId}
        currentAssigneeLabel={assigneeLabel}
        staff={assignableStaff}
        canAssign={canAssign}
      />
      <LifecycleTracker lifecycle={lifecycle} projection={projection} openHandoff={openHandoff ? { title: openHandoff.title } : null} />
      {/* WES-3K — the four ownership concepts, shown SEPARATELY. Replaces the
          ambiguous single « responsable » the 9.0A audit flagged. */}
      {dossierAccess && (
        <OwnershipPanel
          fileId={file.id}
          access={dossierAccess}
          responsibleDepartment={projection.responsibleDepartment}
          currentTaskTitle={currentTask?.title ?? null}
          currentTaskAssigneeLabel={currentTask?.assignedToEmail ?? null}
        />
      )}
      <RiskPanel risk={risk} />
      {sla && <SlaPanel sla={sla} department={lifecycle.currentDepartment} />}
      {/* MAYA-P0.5-B — the dossier's own facts, and the MAYA-compatibility
          label DERIVED from them. The label is computed on read and stored
          nowhere; when the four dimensions match no MAYA type it is simply
          absent, never guessed. */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Identification du dossier</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Référence client" value={file.clientReference} />
          <Fact label="Pour le compte de" value={file.onBehalfOf} />
          <Fact label="Dossier mère" value={file.parentFileNumber} />
          <Fact label="Échéance de traitement" value={file.processingDueDate} />
          <Fact label="Entrée en magasin" value={file.shipment?.warehouseEntryDate ?? null} />
          <Fact
            label="Marchandise"
            value={[
              file.shipment?.goodsDescription,
              file.shipment?.cargoForm && isCargoForm(file.shipment.cargoForm)
                ? CARGO_FORM_LABELS_FR[file.shipment.cargoForm]
                : null,
            ].filter(Boolean).join(" · ") || null}
          />
          <Fact
            label="Quantité"
            value={file.shipment?.quantity != null
              ? `${file.shipment.quantity}${file.shipment.quantityUnit ? ` ${file.shipment.quantityUnit}` : ""}`
              : null}
          />
          <Fact
            label="Poids / volume"
            value={[
              file.shipment?.netWeightKg != null ? `${file.shipment.netWeightKg} kg net` : null,
              file.shipment?.grossWeightKg != null ? `${file.shipment.grossWeightKg} kg brut` : null,
              file.shipment?.volumeM3 != null ? `${file.shipment.volumeM3} m³` : null,
            ].filter(Boolean).join(" · ") || null}
          />
        </dl>
        {mayaLabel && (
          <p className="mt-3 text-[11px] text-slate-500">
            Correspondance MAYA : <strong className="text-navy-800">{mayaLabel.labelFr}</strong> — libellé
            déduit du sens, du mode, de la forme et du régime. Il n&apos;est pas enregistré et ne
            détermine aucun traitement.
          </p>
        )}
        {file.provenance !== "PLATFORM_NATIVE" && (
          <p className="mt-2 text-[11px] text-amber-800">
            Dossier repris de MAYA — référence d&apos;origine {file.legacyReference}.
          </p>
        )}
      </section>
      <QC2Panel evidence={qc2} />
      <FileForm mode="edit" fileId={file.id} initial={file} clients={clients} parents={parentOptions} canUpdate={canUpdate} />
      {canReadTasks && (
        <TaskPanel
          currentUserId={user.id}
          fileId={file.id}
          tasks={tasks}
          assignees={taskAssignees}
          policyResolved={eligible.resolved}
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
      {/* UAT-1 — Operations owns the delivery proof once transport is DELIVERED.
          Hidden before delivery and rendered above Transport, because after
          delivery it is the outstanding work. */}
      {canReadDocs && transportRecord && (
        <DeliveryProofPanel
          fileId={file.id}
          state={{
            transportStatus: transportRecord.status,
            document: podDocument ? { status: podDocument.status, version: podDocument.version } : null,
            podReceived: transportRecord.status === "POD_RECEIVED",
            canUpload: hasPermission(permissions, "document:create"),
            canVerify: hasPermission(permissions, "document:approve"),
          }}
        />
      )}
      {/* MAYA-P0.6-D — what this dossier is carrying, immediately above how it
          is being moved. Renders nothing for a road-only dossier. */}
      {carriage && (
        <div id="carriage" className="scroll-mt-24">
          <CarriagePanel carriage={carriage} />
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
      {canReadTransport && transportRecord && (
        <DriverAssign
          transportId={transportRecord.id}
          currentDriverUserId={transportRecord.driverUserId}
          displayDriverName={transportRecord.driverName}
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
            podVerified={transportRecord ? podApproved : null}
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
      {canReadDocs && artifactItems.length > 0 && (
        <ArtifactPanel
          fileId={file.id}
          items={artifactItems}
          canGenerate={canGenerateArtifacts}
        />
      )}
      {canReadComms && <MailTimeline messages={communications} />}
      {/* WES-9: canonical operational history. No permission gate here — the
          RLS policy on business_event is the boundary, and it defers to the
          dossier's own visibility rule rather than inventing a second one. */}
      <EventTimeline fileId={file.id} />
      <FileDangerZone
        fileId={file.id}
        canManage={canManageLifecycle}
        cancellable={canCancel(file.status)}
      />
      <CopilotPanel fileId={file.id} />
    </div>
  );
}

/** MAYA-P0.5-B — one dossier fact. Absent facts read as « — », never as 0. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-navy-900">{value?.toString().trim() ? value : "—"}</dd>
    </div>
  );
}
