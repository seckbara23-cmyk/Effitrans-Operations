/**
 * Copilot context builder (Phase 3.1A) — SERVER-ONLY for the async fetch path.
 * ---------------------------------------------------------------------------
 * Assembles a READ-ONLY, factual snapshot of a single dossier for the AI
 * Copilot. It reuses the EXISTING read services and the EXISTING pure lifecycle
 * tracker — single source of truth, no new queries, no mutation, no SQL from AI.
 *
 * Tenant isolation + per-feature visibility are inherited, not re-implemented:
 *   - `getFile` is RLS/visibility-scoped, so a dossier the caller cannot access
 *     resolves to `null` (→ the route returns 404). The AI never sees it.
 *   - Each embedded section (documents, customs, transport, finance, tasks) is
 *     gated by the SAME `*:read` permission the dossier page uses. A section the
 *     caller may not read is marked `included: false` and carries no data, so
 *     the model is told explicitly that it has no visibility there.
 *
 * `assembleCopilotContext` is PURE (no I/O) and unit-tested; `buildCopilotContext`
 * is the thin async wrapper that fetches via the shared services and delegates.
 */
// NOTE: runtime service imports are loaded dynamically inside buildCopilotContext
// (below) so that the PURE `assembleCopilotContext` — and its unit tests — never
// pull in server-only modules (e.g. the RSC `cache()` in lib/rbac/permissions).
import { assessRisk, riskInputFromContext, type RiskAssessment } from "@/lib/copilot/risk-engine";
import { capItems, isCriticalEventType, COMPRESS_LIMITS } from "@/lib/copilot/compress";
import { deriveRealtimeEta } from "@/lib/tracking/eta";
import { classifyFreshness, DEFAULT_FRESHNESS_THRESHOLDS } from "@/lib/tracking/position";
import type { DossierLifecycle } from "@/lib/files/lifecycle";
import type { FileDetail } from "@/lib/files/types";
import type { DocumentItem, MissingDocument } from "@/lib/documents/types";
import type { CustomsRecord, MissingCustomsDoc } from "@/lib/customs/types";
import type { TransportRecord } from "@/lib/transport/types";
import type { FinanceForFile } from "@/lib/finance/types";
import type { TaskListItem } from "@/lib/tasks/types";
import type { DossierSla } from "@/lib/sla/service";
import type { TrackingEventEntry, FreshnessState } from "@/lib/tracking/types";

/** A section the caller is not permitted to read carries no data. */
type Section<T> = { included: true; data: T } | { included: false };

export type CopilotDossier = {
  fileNumber: string;
  type: string;
  status: string;
  priority: string;
  clientName: string | null;
  openedAt: string | null;
  createdAt: string;
  transportMode: string | null;
  incoterm: string | null;
  origin: string | null;
  destination: string | null;
  cargoType: string | null;
  carrierName: string | null;
  vesselOrFlight: string | null;
  blAwbRef: string | null;
  containerRef: string | null;
};

export type CopilotLifecycle = {
  completedPercent: number;
  currentStep: string | null;
  currentDepartment: string | null;
  nextDepartment: string | null;
  nextAction: { department: string; action: string; blocker?: string } | null;
  blockers: { label: string; reason: string }[];
  steps: { label: string; department: string; status: string; description: string }[];
  openHandoff: string | null;
};

export type CopilotDocuments = {
  total: number;
  approved: number;
  pendingReview: number;
  missingRequired: string[];
  items: { type: string; status: string; expiry: string | null; sharedWithClient: boolean }[];
};

export type CopilotCustoms = {
  present: boolean;
  status: string | null;
  required: boolean | null;
  declarationNumber: string | null;
  customsOffice: string | null;
  regime: string | null;
  baeReference: string | null;
  inspectionStatus: string | null;
  missingDocuments: string[];
};

export type CopilotTransport = {
  present: boolean;
  status: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupPlanned: string | null;
  deliveryPlanned: string | null;
  deliveryActual: string | null;
  driverName: string | null;
  transportCompany: string | null;
};

export type CopilotFinance = {
  hasIssued: boolean;
  outstanding: number;
  invoices: {
    invoiceNumber: string | null;
    status: string;
    currency: string;
    total: number;
    paid: number;
    balance: number;
    overdue: boolean;
    dueDate: string | null;
  }[];
};

export type CopilotSla = {
  status: string;
  department: string | null;
  stage: string | null;
  ageDays: number;
  warningHours: number | null;
  criticalHours: number | null;
};

export type CopilotTasks = {
  total: number;
  open: number;
  items: { title: string; status: string; priority: string; dueAt: string | null; assignedTo: string | null }[];
};

/** One event on the operational timeline (classified for the model). */
export type CopilotTrackingEvent = {
  type: string;
  occurredAt: string;
  kind: "incident" | "delay" | "delivery" | "operational";
  customerVisible: boolean;
  customerMessage: string | null;
  internalNote: string | null;
};

/**
 * Tracking / driver / ETA / incidents / delays / POD / operational timeline —
 * one permission-gated section (tracking:read). Reuses the tracking timeline +
 * latest-position readers and the PURE realtime-ETA + freshness engines; the raw
 * GPS trail is never exposed (only the last-known freshness + a compressed
 * event timeline). This section IS the "what changed / chronology" source (D6).
 */
export type CopilotTracking = {
  /** The tracking feature surfaced any data for this dossier. */
  present: boolean;
  driverName: string | null;
  latestPositionAt: string | null;
  freshness: FreshnessState;
  eta: {
    estimatedArrival: string | null;
    basis: string;
    confidence: string;
    confidencePercent: number;
    delayMinutes: number | null;
  };
  deliveredAt: string | null;
  incidents: number;
  delays: number;
  /** Compressed operational timeline (most recent first). */
  events: CopilotTrackingEvent[];
  omittedEvents: number;
  /** What the client has seen on the portal (customer-visible events). */
  customerVisibleCount: number;
  lastCustomerMessage: string | null;
};

export type CopilotContext = {
  dossier: CopilotDossier;
  lifecycle: CopilotLifecycle;
  documents: Section<CopilotDocuments>;
  customs: Section<CopilotCustoms>;
  transport: Section<CopilotTransport>;
  finance: Section<CopilotFinance>;
  sla: Section<CopilotSla>;
  tasks: Section<CopilotTasks>;
  tracking: Section<CopilotTracking>;
  /** Derived AI risk assessment (Phase 3.1B) — single source of truth for risk. */
  risk: RiskAssessment;
};

/** Permission gates for each embedded section — mirrors the dossier page. */
export type CopilotAccess = {
  documents: boolean;
  customs: boolean;
  transport: boolean;
  finance: boolean;
  tasks: boolean;
  tracking: boolean;
};

export type AssembleInput = {
  file: FileDetail;
  access: CopilotAccess;
  /** Reference time for derived risk (overdue-days). Injected for determinism. */
  now: Date;
  lifecycle: DossierLifecycle;
  openHandoff: { title: string } | null;
  documents: DocumentItem[];
  missingDocuments: MissingDocument[];
  customs: CustomsRecord | null;
  missingCustomsDocuments: MissingCustomsDoc[];
  transport: TransportRecord | null;
  finance: FinanceForFile | null;
  tasks: TaskListItem[];
  sla: DossierSla | null;
  /** Raw tracking events (newest first) — empty when tracking is dark/inaccessible. */
  trackingEvents: TrackingEventEntry[];
  /** recorded_at of the latest known position, or null. */
  latestPositionAt: string | null;
};

const OPEN_TASK_STATUSES = new Set(["TODO", "IN_PROGRESS", "BLOCKED"]);

/** Classify a tracking event for the model (drives incident/delay counting). */
function eventKind(type: string): CopilotTrackingEvent["kind"] {
  if (type === "INCIDENT_REPORTED") return "incident";
  if (type === "DELAY_REPORTED") return "delay";
  if (type === "DELIVERED" || type === "DELIVERY_ATTEMPTED" || type === "POD_RECEIVED") return "delivery";
  return "operational";
}

/** Build the tracking section from raw events + latest-position time (PURE). */
function assembleTracking(input: AssembleInput): Section<CopilotTracking> {
  if (!input.access.tracking) return { included: false };

  const evs = input.trackingEvents;
  const transport = input.access.transport ? input.transport : null;
  const present = evs.length > 0 || input.latestPositionAt !== null || transport !== null;

  const freshness: FreshnessState = input.latestPositionAt
    ? classifyFreshness(input.latestPositionAt, input.now, DEFAULT_FRESHNESS_THRESHOLDS)
    : "none";

  const deliveredEvent = evs.find((e) => e.type === "DELIVERED");
  const deliveredAt = transport?.deliveryActual ?? deliveredEvent?.occurredAt ?? null;

  const eta = deriveRealtimeEta({
    deliveredActual: deliveredAt,
    scheduledDelivery: transport?.deliveryPlanned ?? null,
    transportEta: null,
    pickupActual: null,
    currentStageKey: null,
    livePositionAt: input.latestPositionAt,
    now: input.now,
  });

  const mapped: CopilotTrackingEvent[] = evs.map((e) => ({
    type: e.type,
    occurredAt: e.occurredAt,
    kind: eventKind(e.type),
    customerVisible: e.customerVisible,
    customerMessage: e.customerMessage,
    internalNote: e.internalNote,
  }));
  // Compress: keep every incident/delay/delivery event + most-recent routine ones.
  const capped = capItems(mapped, COMPRESS_LIMITS.events, (e) => isCriticalEventType(e.type));
  const customerVisible = mapped.filter((e) => e.customerVisible);

  return {
    included: true,
    data: {
      present,
      driverName: transport?.driverName ?? null,
      latestPositionAt: input.latestPositionAt,
      freshness,
      eta: {
        estimatedArrival: eta.estimatedArrival,
        basis: eta.basis,
        confidence: eta.confidence,
        confidencePercent: eta.confidencePercent,
        delayMinutes: eta.delayMinutes ?? null,
      },
      deliveredAt,
      incidents: mapped.filter((e) => e.kind === "incident").length,
      delays: mapped.filter((e) => e.kind === "delay").length,
      events: capped.items,
      omittedEvents: capped.omitted,
      customerVisibleCount: customerVisible.length,
      lastCustomerMessage: customerVisible.find((e) => e.customerMessage)?.customerMessage ?? null,
    },
  };
}

/**
 * Pure packaging of already-fetched records into the Copilot snapshot.
 * No I/O; safe to unit-test. Sections the caller may not read are omitted
 * (`included: false`) rather than fabricated.
 */
export function assembleCopilotContext(input: AssembleInput): CopilotContext {
  const { file, access, lifecycle } = input;
  const s = file.shipment;

  const dossier: CopilotDossier = {
    fileNumber: file.fileNumber,
    type: file.type,
    status: file.status,
    priority: file.priority,
    clientName: file.clientName,
    openedAt: file.openedAt,
    createdAt: file.createdAt,
    transportMode: s?.transportMode ?? null,
    incoterm: s?.incoterm ?? null,
    origin: s?.origin ?? null,
    destination: s?.destination ?? null,
    cargoType: s?.cargoType ?? null,
    carrierName: s?.carrierName ?? null,
    vesselOrFlight: s?.vesselOrFlight ?? null,
    blAwbRef: s?.blAwbRef ?? null,
    containerRef: s?.containerRef ?? null,
  };

  const lc: CopilotLifecycle = {
    completedPercent: lifecycle.completedPercent,
    currentStep: lifecycle.currentStep,
    currentDepartment: lifecycle.currentDepartment,
    nextDepartment: lifecycle.nextDepartment,
    nextAction: lifecycle.nextAction
      ? {
          department: lifecycle.nextAction.department,
          action: lifecycle.nextAction.action,
          blocker: lifecycle.nextAction.blocker,
        }
      : null,
    blockers: lifecycle.blockers.map((b) => ({ label: b.label, reason: b.reason })),
    steps: lifecycle.steps.map((st) => ({
      label: st.label,
      department: st.department,
      status: st.status,
      description: st.description,
    })),
    openHandoff: input.openHandoff?.title ?? null,
  };

  const documents: Section<CopilotDocuments> = access.documents
    ? {
        included: true,
        data: {
          total: input.documents.length,
          approved: input.documents.filter((d) => d.status === "APPROVED").length,
          pendingReview: input.documents.filter(
            (d) => d.status === "UPLOADED" || d.status === "PENDING_REVIEW",
          ).length,
          missingRequired: input.missingDocuments.map((m) => m.label),
          items: input.documents.map((d) => ({
            type: d.typeLabel,
            status: d.status,
            expiry: d.expiryDate,
            sharedWithClient: d.sharedWithClient,
          })),
        },
      }
    : { included: false };

  const customs: Section<CopilotCustoms> = access.customs
    ? {
        included: true,
        data: {
          present: input.customs !== null,
          status: input.customs?.status ?? null,
          required: input.customs?.required ?? null,
          declarationNumber: input.customs?.declarationNumber ?? null,
          customsOffice: input.customs?.customsOffice ?? null,
          regime: input.customs?.regime ?? null,
          baeReference: input.customs?.baeReference ?? null,
          inspectionStatus: input.customs?.inspectionStatus ?? null,
          missingDocuments: input.missingCustomsDocuments.map((m) => m.label),
        },
      }
    : { included: false };

  const transport: Section<CopilotTransport> = access.transport
    ? {
        included: true,
        data: {
          present: input.transport !== null,
          status: input.transport?.status ?? null,
          pickupLocation: input.transport?.pickupLocation ?? null,
          deliveryLocation: input.transport?.deliveryLocation ?? null,
          pickupPlanned: input.transport?.pickupPlanned ?? null,
          deliveryPlanned: input.transport?.deliveryPlanned ?? null,
          deliveryActual: input.transport?.deliveryActual ?? null,
          driverName: input.transport?.driverName ?? null,
          transportCompany: input.transport?.transportCompany ?? null,
        },
      }
    : { included: false };

  const finance: Section<CopilotFinance> = access.finance
    ? {
        included: true,
        data: {
          hasIssued: input.finance?.hasIssued ?? false,
          outstanding: input.finance?.outstanding ?? 0,
          invoices: (input.finance?.invoices ?? []).map((i) => ({
            invoiceNumber: i.invoiceNumber,
            status: i.status,
            currency: i.currency,
            total: i.total,
            paid: i.paid,
            balance: i.balance,
            overdue: i.overdue,
            dueDate: i.dueDate,
          })),
        },
      }
    : { included: false };

  const tasks: Section<CopilotTasks> = access.tasks
    ? {
        included: true,
        data: {
          total: input.tasks.length,
          open: input.tasks.filter((tk) => OPEN_TASK_STATUSES.has(tk.status)).length,
          items: input.tasks.map((tk) => ({
            title: tk.title,
            status: tk.status,
            priority: tk.priority,
            dueAt: tk.dueAt,
            assignedTo: tk.assignedToEmail,
          })),
        },
      }
    : { included: false };

  // SLA is derived (not permission-gated); it is only absent when the dossier
  // has no active stage or the stage lookup failed (best-effort, like the page).
  const sla: Section<CopilotSla> = input.sla
    ? {
        included: true,
        data: {
          status: input.sla.status,
          department: input.sla.stage.currentDepartment,
          stage: input.sla.stage.currentStage,
          ageDays: input.sla.stage.ageDays,
          warningHours: input.sla.threshold?.warningHours ?? null,
          criticalHours: input.sla.threshold?.criticalHours ?? null,
        },
      }
    : { included: false };

  const tracking = assembleTracking(input);

  // Derived risk (Phase 3.1B) — computed from the assembled snapshot so the
  // Copilot consumes the Risk Engine output instead of reasoning from scratch.
  const view = { lifecycle: lc, sla, documents, customs, transport, finance };
  const risk = assessRisk(riskInputFromContext(view, input.now));

  return { dossier, lifecycle: lc, documents, customs, transport, finance, sla, tasks, tracking, risk };
}

/**
 * Async wrapper: fetches the dossier and its embedded sections through the
 * SHARED read services (same calls + same permission gating as the dossier
 * page), derives the lifecycle/SLA, then assembles the snapshot.
 *
 * Returns `null` when the caller lacks `file:read` or cannot access the dossier
 * (tenant isolation / visibility) — the route maps that to 403 / 404.
 */
export async function buildCopilotContext(
  fileId: string,
  permissions: string[],
): Promise<CopilotContext | null> {
  // Server-only modules, loaded on demand to keep the pure assembler test-safe.
  // (These targets are themselves `server-only`-guarded, so the boundary holds.)
  const [
    { hasPermission },
    { getFile },
    { listDocuments, getMissingRequiredDocuments },
    { getCustomsRecord, getMissingCustomsDocuments },
    { getTransportRecord },
    { getFinanceForFile },
    { listTasks },
    { getDossierStage },
    { getOpenHandoffForFile },
    { getDossierLifecycle },
    { getTrackingTimeline, getLatestTrackingPosition },
  ] = await Promise.all([
    import("@/lib/rbac/permissions"),
    import("@/lib/files/service"),
    import("@/lib/documents/service"),
    import("@/lib/customs/service"),
    import("@/lib/transport/service"),
    import("@/lib/finance/service"),
    import("@/lib/tasks/service"),
    import("@/lib/sla/service"),
    import("@/lib/handoffs/service"),
    import("@/lib/files/lifecycle"),
    import("@/lib/tracking/service"),
  ]);

  if (!hasPermission(permissions, "file:read")) return null;

  const file = await getFile(fileId);
  if (!file) return null;

  const access: CopilotAccess = {
    documents: hasPermission(permissions, "document:read"),
    customs: hasPermission(permissions, "customs:read"),
    transport: hasPermission(permissions, "transport:read"),
    finance: hasPermission(permissions, "finance:read"),
    tasks: hasPermission(permissions, "task:read"),
    tracking: hasPermission(permissions, "tracking:read"),
  };

  const [documents, missingDocuments, customs, missingCustomsDocuments, transport, finance, tasks, trackingEvents, latestPosition] =
    await Promise.all([
      access.documents ? listDocuments(file.id) : Promise.resolve([] as DocumentItem[]),
      access.documents
        ? getMissingRequiredDocuments(file.id, file.type)
        : Promise.resolve([] as MissingDocument[]),
      access.customs ? getCustomsRecord(file.id) : Promise.resolve(null),
      access.customs ? getMissingCustomsDocuments(file.id) : Promise.resolve([] as MissingCustomsDoc[]),
      access.transport ? getTransportRecord(file.id) : Promise.resolve(null),
      access.finance ? getFinanceForFile(file.id) : Promise.resolve(null),
      access.tasks ? listTasks({ fileId: file.id }) : Promise.resolve([] as TaskListItem[]),
      // Tracking reads are themselves tracking:read + visibility gated and return
      // [] / null when the tracking feature is dark — safe to call when permitted.
      access.tracking ? getTrackingTimeline(file.id) : Promise.resolve([] as TrackingEventEntry[]),
      access.tracking ? getLatestTrackingPosition(file.id) : Promise.resolve(null),
    ]);

  const podApproved = documents.some(
    (d) => d.typeCode === "DELIVERY_NOTE" && d.status === "APPROVED",
  );

  // Same lifecycle derivation as app/files/[id]/page.tsx — single source of truth.
  const lifecycle = getDossierLifecycle({
    fileId: file.id,
    file: { status: file.status, type: file.type },
    documents: documents.map((d) => ({ status: d.status })),
    missingRequired: missingDocuments.map((m) => ({ label: m.label })),
    customs: customs ? { status: customs.status, required: customs.required } : null,
    transport: transport ? { status: transport.status } : null,
    invoices: (finance?.invoices ?? []).map((i) => ({ status: i.status, balance: i.balance })),
    podApproved,
  });

  const [openHandoff, sla] = await Promise.all([
    getOpenHandoffForFile(file.id),
    getDossierStage(file.id, lifecycle.currentDepartment, lifecycle.currentStep).catch(() => null),
  ]);

  return assembleCopilotContext({
    file,
    access,
    now: new Date(),
    lifecycle,
    openHandoff: openHandoff ? { title: openHandoff.title } : null,
    documents,
    missingDocuments,
    customs,
    missingCustomsDocuments,
    transport,
    finance,
    tasks,
    sla,
    trackingEvents,
    latestPositionAt: latestPosition?.recordedAt ?? null,
  });
}

// ===========================================================================
// Performance (D12) — short-TTL, tenant+permission-scoped context memo.
// A dossier chat fires several questions in a row; rebuilding the same snapshot
// each time re-runs ~9 reads. This memo returns the already-built context for a
// few seconds. It is keyed by tenant + file + the permission fingerprint so a
// different tenant or a differently-permissioned caller NEVER reads a cache hit
// meant for someone else (the underlying reads are still the RLS boundary).
// ===========================================================================
const CONTEXT_TTL_MS = 15_000;
const CONTEXT_CACHE_MAX = 200;
const contextCache = new Map<string, { ctx: CopilotContext; expiresAt: number }>();

/** Relevant permissions only — keeps the key stable and section-accurate. */
const CACHE_PERMS = ["file:read", "document:read", "customs:read", "transport:read", "finance:read", "task:read", "tracking:read"] as const;

export function shipmentCacheKey(fileId: string, tenantId: string, permissions: string[]): string {
  const permKey = CACHE_PERMS.filter((p) => permissions.includes(p)).join(",");
  return `${tenantId}::${fileId}::${permKey}`;
}

/**
 * Cached entry point for the route (D12). Same tenant + file + permission set →
 * one build reused for CONTEXT_TTL_MS. `buildCopilotContext` stays the uncached
 * builder used by tests and the eval harness. `nowMs` is injectable for tests.
 */
export async function getShipmentContext(
  fileId: string,
  tenantId: string,
  permissions: string[],
  nowMs: number = Date.now(),
): Promise<CopilotContext | null> {
  const key = shipmentCacheKey(fileId, tenantId, permissions);
  const hit = contextCache.get(key);
  if (hit && hit.expiresAt > nowMs) return hit.ctx;

  const ctx = await buildCopilotContext(fileId, permissions);
  if (!ctx) {
    contextCache.delete(key);
    return null;
  }
  if (contextCache.size >= CONTEXT_CACHE_MAX) {
    const oldest = contextCache.keys().next().value;
    if (oldest !== undefined) contextCache.delete(oldest);
  }
  contextCache.set(key, { ctx, expiresAt: nowMs + CONTEXT_TTL_MS });
  return ctx;
}
