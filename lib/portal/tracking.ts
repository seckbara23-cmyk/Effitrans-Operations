/**
 * Unified customer-safe tracking model (Phase 3.3A — Deliverable 1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The SINGLE derived tracking object for a portal dossier. Ownership is enforced
 * by the RLS user-context client; the full inputs for that ONE owned dossier are
 * then read with the admin client in a FIXED, parallel set of queries (no N+1)
 * PURELY to derive customer-safe views. Reuses the EXISTING engines
 * (getDossierLifecycle → toPortalTimeline, the Risk Engine, the ETA engine) and
 * the pure derivers — no second lifecycle/SLA/risk engine, no persisted customer
 * status. Never exposes internal risk scores, SLA thresholds, staff identities,
 * tasks, audit payloads or internal blockers.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import { assessRisk, overdueDays, type RiskInput } from "@/lib/copilot/risk-engine";
import { toPortalTimeline, type PortalTimeline, type PortalStageKey } from "./progress-map";
import { derivePortalEta, type PortalEta } from "./eta";
import { classifyAvailability, stageToMapPhase } from "./shipment-view";
import {
  resolveRoute,
  deriveDelay,
  deriveNextStep,
  documentRequirements,
  buildTimeline,
  departmentLabel,
  type PortalRoute,
  type PortalDelay,
  type PortalNextStep,
  type DocRequirement,
  type CustomerTimelineEntry,
} from "./tracking-derive";
import { customerSafeRoleLabel, isGenericStaffIdentity, TEAM_FALLBACK_NAME } from "./officer-view";
import { buildMapPoints, type MapPoint } from "./map-points";
import { listPortalDocuments } from "./docs-service";
import { listClientNotifications } from "@/lib/customer-notify/service";
import type { PortalDocument, PortalOfficer } from "./types";

const MAP_PHASE_LABEL: Record<string, string> = {
  port: "Port",
  customs: "Bureau des douanes",
  warehouse: "Entrepôt",
  transport: "En transit",
  client: "Destination client",
};

const TRANSPORT_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "En préparation",
  PLANNED: "Planifié",
  DRIVER_ASSIGNED: "Transporteur assigné",
  PICKED_UP: "Enlèvement effectué",
  IN_TRANSIT: "En transit",
  DELIVERED: "Livré",
  POD_RECEIVED: "Livré",
  BLOCKED: "En attente",
  CANCELLED: "Annulé",
};

export type PortalTracking = {
  fileId: string;
  fileNumber: string;
  shipmentType: string;
  route: PortalRoute;
  currentStageKey: PortalStageKey | null;
  timeline: PortalTimeline;
  progressPercent: number;
  currentLocation: string;
  currentDepartment: string;
  nextStep: PortalNextStep;
  lastActivityAt: string | null;
  eta: PortalEta;
  delay: PortalDelay;
  officer: PortalOfficer;
  activity: CustomerTimelineEntry[];
  documents: { available: PortalDocument[]; requirements: DocRequirement[] };
  transport: { statusLabel: string | null } | null;
  mapPoints: { points: MapPoint[]; hasGeo: boolean };
  podAvailable: boolean;
};

type FileRow = {
  id: string;
  file_number: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to_user_id: string | null;
  account_manager_id: string | null;
  coordinator_id: string | null;
  shipment: { origin: string | null; destination: string | null; eta: string | null }[] | null;
};

export async function getPortalTracking(fileId: string): Promise<PortalTracking | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;

  // Ownership boundary: RLS restricts this to the caller's own client's dossier.
  const ctx = getServerSupabaseClient();
  const { data: own } = await ctx
    .from("operational_file")
    .select("id, file_number, type, status, created_at, updated_at, assigned_to_user_id, account_manager_id, coordinator_id, shipment(origin, destination, eta)")
    .eq("id", fileId)
    .maybeSingle<FileRow>();
  if (!own) return null;

  const tenant = user.tenantId;
  const admin = getAdminSupabaseClient();
  const officerId = own.assigned_to_user_id ?? own.account_manager_id ?? own.coordinator_id;
  const now = new Date();

  // Fixed parallel read set — never per-item (no N+1). RLS-safe (own dossier) via
  // listPortalDocuments/listClientNotifications; admin reads derive the timeline.
  const [docsRes, typesRes, customsRes, transportRes, invRes, officerRes, roleRes, availableDocs, notifications] = await Promise.all([
    admin.from("document").select("type_code, status").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).returns<{ type_code: string; status: string }[]>(),
    admin.from("document_type").select("code, required_for, label_fr").eq("active", true).returns<{ code: string; required_for: string[] | null; label_fr: string | null }[]>(),
    admin.from("customs_record").select("status, required").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; required: boolean }>(),
    admin.from("transport_record").select("status, pickup_location, delivery_location, pickup_actual, delivery_planned, delivery_actual").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; pickup_location: string | null; delivery_location: string | null; pickup_actual: string | null; delivery_planned: string | null; delivery_actual: string | null }>(),
    admin.from("invoice").select("id, status").eq("tenant_id", tenant).eq("file_id", fileId).returns<{ id: string; status: string }[]>(),
    officerId
      ? admin.from("app_user").select("name, email, is_system_admin, last_seen_at").eq("id", officerId).eq("tenant_id", tenant).maybeSingle<{ name: string | null; email: string; is_system_admin: boolean; last_seen_at: string | null }>()
      : Promise.resolve({ data: null }),
    officerId
      ? admin.from("user_role").select("role:role_id(code)").eq("user_id", officerId).eq("tenant_id", tenant).returns<{ role: { code: string } | null }[]>()
      : Promise.resolve({ data: [] as { role: { code: string } | null }[] }),
    listPortalDocuments(fileId),
    listClientNotifications(50),
  ]);

  const docs = docsRes.data ?? [];
  const docTypes = typesRes.data ?? [];
  const cust = customsRes.data ?? null;
  const tr = transportRes.data ?? null;

  // Required doc codes + best status per type (for customer-safe requirement states).
  const requiredCodes = docTypes.filter((t) => (t.required_for ?? []).includes(own.type)).map((t) => t.code);
  const labelByCode = new Map(docTypes.map((t) => [t.code, t.label_fr ?? t.code] as const));
  const STATUS_RANK: Record<string, number> = { UPLOADED: 1, PENDING_REVIEW: 2, REJECTED: 2, APPROVED: 3 };
  const bestStatusByCode = new Map<string, string>();
  for (const d of docs) {
    const cur = bestStatusByCode.get(d.type_code);
    if (!cur || (STATUS_RANK[d.status] ?? 0) >= (STATUS_RANK[cur] ?? 0)) bestStatusByCode.set(d.type_code, d.status);
  }
  const approved = new Set(docs.filter((d) => d.status === "APPROVED").map((d) => d.type_code));
  const missingRequired = requiredCodes.filter((code) => !approved.has(code));
  const missingLabels = missingRequired.map((code) => labelByCode.get(code) ?? code);
  const podApproved = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

  // Invoice balances feed the lifecycle only (no amounts exposed here).
  const invoices: { status: string; balance: number }[] = [];
  const invIds = (invRes.data ?? []).map((i) => i.id);
  if (invIds.length) {
    const [lineRes, payRes] = await Promise.all([
      admin.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      admin.from("payment").select("invoice_id, amount, reversed_at").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; amount: number; reversed_at: string | null }[]>(),
    ]);
    for (const inv of invRes.data ?? []) {
      const lines = (lineRes.data ?? []).filter((l) => l.invoice_id === inv.id).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) }));
      const pays = (payRes.data ?? []).filter((p) => p.invoice_id === inv.id).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null }));
      invoices.push({ status: inv.status, balance: balanceDue(invoiceTotals(lines).total, paidAmount(pays)) });
    }
  }

  // Reuse the lifecycle engine → customer timeline (single source of truth).
  const lifecycle = getDossierLifecycle({
    fileId,
    file: { status: own.status, type: own.type },
    documents: docs.map((d) => ({ status: d.status })),
    missingRequired: missingRequired.map((code) => ({ label: labelByCode.get(code) ?? code })),
    customs: cust ? { status: cust.status, required: cust.required } : null,
    transport: tr ? { status: tr.status } : null,
    invoices,
    podApproved,
  });
  const timeline = toPortalTimeline(lifecycle.steps);

  // Reuse the Risk Engine → customer-safe delay (4 levels + plain explanation).
  const awaitingPod = tr?.status === "DELIVERED" && !podApproved;
  const overdue = invoices.filter((i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.balance > 0);
  const riskInput: RiskInput = {
    lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
    sla: null,
    documents: { missingRequiredCount: missingRequired.length },
    customs: cust ? { underInspection: cust.status === "INSPECTION", inspectionDays: null } : null,
    transport: tr ? { awaitingPod, transitExceedsSla: false } : null,
    finance: invoices.length ? { overdueCount: overdue.length, maxOverdueDays: null } : null,
  };
  void overdueDays; // (overdue-days detail intentionally not surfaced to customers)
  const delay = deriveDelay(assessRisk(riskInput).level, {
    missingDocs: missingRequired.length,
    customsInspection: cust?.status === "INSPECTION",
    awaitingPod,
  });

  // Route with fallbacks + ETA engine + next step + timeline + map points.
  const ship = own.shipment?.[0] ?? null;
  const route = resolveRoute({
    shipmentOrigin: ship?.origin ?? null,
    shipmentDestination: ship?.destination ?? null,
    pickupLocation: tr?.pickup_location ?? null,
    deliveryLocation: tr?.delivery_location ?? null,
  });
  const eta = derivePortalEta({
    deliveredActual: tr?.delivery_actual ?? null,
    scheduledDelivery: tr?.delivery_planned ?? null,
    transportEta: ship?.eta ?? null,
    pickupActual: tr?.pickup_actual ?? null,
    currentStageKey: timeline.currentKey,
    now,
  });
  const nextStep = deriveNextStep(timeline.currentKey, { missingDocLabels: missingLabels });
  const activity = buildTimeline({
    createdAt: own.created_at,
    createdLabel: "Dossier créé",
    notifications: notifications
      .filter((n) => n.fileId === fileId)
      .map((n) => ({ id: n.id, title: n.title, category: n.category, createdAt: n.createdAt })),
  });
  const mapPoints = buildMapPoints({ origin: route.origin || ship?.origin || null, destination: route.destination || ship?.destination || null, progressPercent: timeline.percent });
  const requirements = documentRequirements({ requiredCodes, bestStatusByCode, labelByCode });

  // Customer-safe officer (never a generic/admin identity or personal email).
  const staff = officerRes.data;
  const isTeam = !staff || isGenericStaffIdentity(staff.name, staff.is_system_admin);
  const roleCode = roleRes.data?.[0]?.role?.code ?? null;
  const officer: PortalOfficer = isTeam
    ? {
        name: TEAM_FALLBACK_NAME,
        title: "Service des opérations",
        department: null,
        businessEmail: process.env.PORTAL_CONTACT_EMAIL ?? null,
        businessPhone: process.env.PORTAL_CONTACT_PHONE ?? null,
        availability: "offline",
        isTeam: true,
      }
    : {
        name: staff!.name!,
        title: customerSafeRoleLabel(roleCode),
        department: customerSafeRoleLabel(roleCode),
        businessEmail: process.env.PORTAL_CONTACT_EMAIL ?? null,
        businessPhone: process.env.PORTAL_CONTACT_PHONE ?? null,
        availability: classifyAvailability(staff!.last_seen_at, now),
        isTeam: false,
      };

  const lastActivityAt = activity[0]?.date ?? own.updated_at ?? null;
  const podAvailable = availableDocs.some((d) => d.typeCode === "DELIVERY_NOTE");

  return {
    fileId,
    fileNumber: own.file_number,
    shipmentType: own.type,
    route,
    currentStageKey: timeline.currentKey,
    timeline,
    progressPercent: timeline.percent,
    currentLocation: MAP_PHASE_LABEL[stageToMapPhase(timeline.currentKey)] ?? "En cours",
    currentDepartment: departmentLabel(lifecycle.currentDepartment),
    nextStep,
    lastActivityAt,
    eta,
    delay,
    officer,
    activity,
    documents: { available: availableDocs, requirements },
    transport: tr ? { statusLabel: TRANSPORT_STATUS_LABEL[tr.status] ?? null } : null,
    mapPoints,
    podAvailable,
  };
}
