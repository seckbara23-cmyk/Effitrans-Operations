/**
 * Transport readiness panel (Phase 5.0D-5, Deliverable 2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * BOUNDED — 6 queries, regardless of row count.
 *
 * DRIVER CONTACT PRIVACY (the rule this panel exists to enforce):
 * a driver's PERSONAL phone number is never the customer-safe contact. By default
 * the customer-safe contact is the tenant's BUSINESS number. A tenant may opt in
 * to sharing the driver's number, but that seam is deliberately OFF and there is
 * no way to turn it on by accident — see resolveDriverContact().
 *
 * The panel reuses the existing transport, tracking and process read models. It
 * does not re-derive the pickup gate; it calls the engine's.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "../config";
import { evaluatePickupGate, type GateResult } from "../engine/gates";
import type { EvidenceSnapshot } from "../engine/evidence";
import { evaluateBranch, type ExecutionView } from "../engine/state";
import {
  resolveDriverContact,
  trackingFreshness,
  type DriverContact,
  type DriverContactPolicy,
  type TrackingFreshness,
} from "./driver-contact";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type { DriverContact, DriverContactPolicy, TrackingFreshness };
export { resolveDriverContact, trackingFreshness };

export type TransportRow = {
  fileId: string;
  fileNumber: string;
  clientName: string;
  transportStatus: string | null;
  vehiclePlate: string | null;
  vehicleAssigned: boolean;
  driverName: string | null;
  driverAssigned: boolean;
  /** Customer-safe only. A personal number never appears here by default. */
  driverContact: DriverContact;
  /** Whether a customer tracking link could be offered at all. */
  trackingLinkReady: boolean;
  trackingSessionActive: boolean;
  freshness: TrackingFreshness;
  customsReady: boolean;
  transportReady: boolean;
  pickupGate: GateResult;
  podApproved: boolean;
  podHandedOff: boolean;
  blockers: string[];
  nextAction: string;
};

export type TransportPanel = {
  rows: TransportRow[];
  total: number;
  telemetry: { panel: "transport"; count: number; durationMs: number; queries: number };
};

export async function getTransportPanel(
  tenantId: string,
  permissions: string[],
  limit = 50,
): Promise<TransportPanel> {
  const started = Date.now();
  const empty: TransportPanel = {
    rows: [],
    total: 0,
    telemetry: { panel: "transport", count: 0, durationMs: 0, queries: 0 },
  };

  const flags = getProcessFlags();
  if (!flags.workspaces) return empty;
  if (!hasPermission(permissions, "transport:read")) return empty;

  const admin = getAdminSupabaseClient();
  let queries = 0;

  // (1) live transports
  const { data: transportRows } = await scopedFrom(admin, "transport_record", tenantId)
    .select("file_id, status, vehicle_plate, driver_name, driver_phone, driver_user_id")
    .is("deleted_at", null)
    .neq("status", "CANCELLED")
    .limit(limit);
  queries++;
  const transports = (transportRows ?? []) as Row[];
  if (transports.length === 0) {
    return { ...empty, telemetry: { ...empty.telemetry, durationMs: Date.now() - started, queries } };
  }

  const fileIds = [...new Set(transports.map((t) => t.file_id as string))];

  // (2-6) batched
  const [{ data: files }, { data: customs }, { data: docs }, { data: sessions }, { data: org }] =
    await Promise.all([
      scopedFrom(admin, "operational_file", tenantId).select("id, file_number, type, client_id").in("id", fileIds),
      hasPermission(permissions, "customs:read")
        ? scopedFrom(admin, "customs_record", tenantId)
            .select("file_id, required, status, bae_reference")
            .in("file_id", fileIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Row[] }),
      hasPermission(permissions, "document:read")
        ? scopedFrom(admin, "document", tenantId)
            .select("file_id, type_code, status")
            .in("file_id", fileIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Row[] }),
      hasPermission(permissions, "tracking:read")
        ? scopedFrom(admin, "tracking_session", tenantId)
            .select("file_id, status, last_position_at")
            .in("file_id", fileIds)
        : Promise.resolve({ data: [] as Row[] }),
      admin.from("organization").select("id").eq("id", tenantId).maybeSingle(),
    ]);
  queries += 5;

  const fileRows = (files ?? []) as Row[];
  const clientIds = [...new Set(fileRows.map((f) => f.client_id as string).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await scopedFrom(admin, "client", tenantId).select("id, name").in("id", clientIds)
    : { data: [] as Row[] };
  queries++;

  // The tenant's business contact. NOT a driver's personal number.
  const businessPhone = process.env.PORTAL_CONTACT_PHONE ?? null;
  // The opt-in seam. Deliberately not wired to any UI: management must enable it.
  const tenantAllowsDriverDirect = process.env.EFFITRANS_SHARE_DRIVER_PHONE === "true";

  const fileById = new Map(fileRows.map((f) => [f.id as string, f]));
  const clientById = new Map(((clients ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));
  const customsByFile = new Map(((customs ?? []) as Row[]).map((c) => [c.file_id as string, c]));
  const sessionByFile = new Map(((sessions ?? []) as Row[]).map((s) => [s.file_id as string, s]));

  const docsByFile = new Map<string, Row[]>();
  for (const d of (docs ?? []) as Row[]) {
    const k = d.file_id as string;
    const l = docsByFile.get(k);
    if (l) l.push(d);
    else docsByFile.set(k, [d]);
  }

  const now = Date.now();

  const rows: TransportRow[] = transports.map((t) => {
    const fileId = t.file_id as string;
    const file = fileById.get(fileId);
    const cus = customsByFile.get(fileId);
    const fileDocs = docsByFile.get(fileId) ?? [];
    const session = sessionByFile.get(fileId);

    const snap: EvidenceSnapshot = {
      fileType: (file?.type as string) ?? "IMP",
      access: { documents: true, customs: true, transport: true, finance: false },
      documents: fileDocs.map((d) => ({ typeCode: d.type_code as string, status: d.status as string })),
      customs: cus
        ? {
            required: Boolean(cus.required),
            status: cus.status as string,
            baeReference: str(cus.bae_reference),
            declarationNumber: null,
            externalRef: null,
          }
        : null,
      transport: {
        status: t.status as string,
        vehiclePlate: str(t.vehicle_plate),
        driverName: str(t.driver_name),
        driverUserId: str(t.driver_user_id),
      },
      invoices: [],
    };

    // The engine's gate — not a reimplementation of it.
    const gate = evaluatePickupGate(snap, [] as ExecutionView[]);

    const vehicleAssigned = !!str(t.vehicle_plate)?.trim();
    const driverAssigned = !!(str(t.driver_user_id) || str(t.driver_name)?.trim());
    const podApproved = fileDocs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

    const driverContact = resolveDriverContact({
      businessPhone,
      driverPhone: str(t.driver_phone),
      tenantAllowsDriverDirect,
    });

    const lastPositionAt = str(session?.last_position_at);
    const sessionActive = session?.status === "ACTIVE";

    const blockers = gate.missing.map((m) => m);
    if (t.status === "DELIVERED" && !podApproved) blockers.push("pod_missing");

    return {
      fileId,
      fileNumber: (file?.file_number as string) ?? "—",
      clientName: clientById.get((file?.client_id as string) ?? "") ?? "—",
      transportStatus: str(t.status),
      vehiclePlate: str(t.vehicle_plate),
      vehicleAssigned,
      driverName: str(t.driver_name),
      driverAssigned,
      driverContact,
      // A tracking link is only meaningful once a driver is on the mission.
      trackingLinkReady: driverAssigned && sessionActive,
      trackingSessionActive: sessionActive,
      freshness: trackingFreshness(lastPositionAt, now),
      customsReady: !cus?.required || cus?.status === "RELEASED",
      transportReady: vehicleAssigned && driverAssigned,
      pickupGate: gate,
      podApproved,
      podHandedOff: t.status === "POD_RECEIVED",
      blockers,
      nextAction: !gate.ready
        ? "Compléter la porte d'enlèvement"
        : t.status === "DELIVERED" && !podApproved
          ? "Obtenir le bordereau signé"
          : t.status === "POD_RECEIVED"
            ? "Remis au Coordinateur"
            : "Poursuivre le transport",
    };
  });

  return {
    rows,
    total: rows.length,
    telemetry: { panel: "transport", count: rows.length, durationMs: Date.now() - started, queries },
  };
}

export { evaluateBranch };
