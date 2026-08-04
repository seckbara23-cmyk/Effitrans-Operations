import "server-only";

/**
 * UT-2 — the Observation Plane reader. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reads the EXISTING ocean and air tracking stores. It creates no table, writes
 * nothing, and copies nothing into `business_event`.
 *
 * WHY AN APPLICATION GATE RATHER THAN RLS. The observation stores' policies read
 * `tenant_id = auth_tenant_id() AND has_permission('transport:read')` — they are
 * NOT dossier-derived. Relying on them for a dossier timeline would be wrong in
 * both directions: someone holding `transport:read` but unable to read a
 * particular dossier would see its observations, and someone who may read the
 * dossier but lacks `transport:read` would see none of them. So visibility here
 * is the DOSSIER'S, established by `isFileVisible` — the same predicate
 * `can_read_file` encodes — BEFORE the admin client is touched. This is the
 * EC-3C pattern, and the deliberate difference from UT-1's decision reader
 * (which can lean on RLS because the ledger's policy already says exactly the
 * right thing).
 *
 * THREE SOURCES, ONE PLANE (UT3-ROAD, Option C). Ocean and air share a shape;
 * `public.tracking_event` (road) does not — it has no `confidence` column and a
 * different `source` vocabulary. It is admitted with `confidence: null`, which
 * `UnifiedEntry` already means "the source did not state one", rather than by
 * adding a column (retrofitting a judgement nobody made) or deriving a grade
 * (fabricating one). Road entries reach the timeline ONLY through this adapter.
 *
 * MILESTONE-ONLY, per DEC-B88 §4 (RATIFY-UT-1). `POSITION_UPDATE` and
 * `ETA_UPDATE` are permanently ineligible for the timeline: they are continuous
 * telemetry, and the current position is a COMPUTED read-time value belonging to
 * the map, not a historical entry.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isFileVisible } from "@/lib/authz/visibility";
import { classifyFreshness } from "@/lib/shipping/intelligence/freshness";
import type { TrackingSource } from "@/lib/shipping/intelligence/events";
import { CONFIDENCE, CLIENT_SAFE_OBSERVATIONS, type Confidence, type UnifiedEntry } from "./merged";

/** Telemetry that never becomes a timeline entry. */
const TELEMETRY = new Set(["POSITION_UPDATE", "ETA_UPDATE"]);

/** Cap per store. A timeline page is for reading, not bulk export. */
const SCAN_CAP = 400;

/**
 * ROAD milestones admitted to the timeline (UT-3A §8). An ALLOW-LIST: a new
 * road type appears nowhere until someone classifies it, which is the failure
 * mode we want. Excluded and why:
 *   ARRIVED_NEAR_*        proximity telemetry — the road POSITION_UPDATE
 *   TRACKING_STARTED/STOPPED   session plumbing, not shipment history
 *   CHECKPOINT_REACHED    repeatable and high-frequency
 *   DELAY_/INCIDENT_REPORTED   carry prose; admitting them admits free text
 */
const ROAD_MILESTONES = new Set([
  "PICKUP_CONFIRMED", "DEPARTED", "BORDER_REACHED", "WAREHOUSE_REACHED",
  "CUSTOMS_STOP", "DELIVERY_ATTEMPTED", "DELIVERED",
]);

/** Road milestones a customer may see — intersected with the row's own flag. */
const ROAD_CLIENT_SAFE = new Set(["PICKUP_CONFIRMED", "DEPARTED", "DELIVERED"]);

/**
 * Road `source` → the freshness vocabulary, for STALENESS THRESHOLDS ONLY.
 *
 * This maps how quickly a source goes stale. It is emphatically NOT a
 * confidence mapping: freshness is a computed read-time classification, while
 * confidence is a claim the source either made or did not. Road sources made
 * none, so `confidence` stays null no matter what this table says.
 */
const ROAD_FRESHNESS_SOURCE: Record<string, TrackingSource> = {
  manual: "MANUAL",
  driver_mobile: "ROAD",
  vehicle_gps: "ROAD",
  carrier_api: "CARRIER",
  vessel_api: "CARRIER",
  flight_api: "CARRIER",
};

/** Road `source` → the frozen origin axis. */
function roadOrigin(source: string): "human" | "system" | "external" {
  if (source === "manual" || source === "driver_mobile") return "human";
  if (source === "vehicle_gps") return "system";
  return "external";
}

type ObsRow = {
  id: string;
  tenant_id: string;
  shipment_id: string;
  event_type: string;
  occurred_at: string;
  source: string;
  confidence: string;
  location_name: string | null;
  provider_code: string | null;
};

export type ObservationQuery = {
  tenantId: string;
  dossierId: string;
  /** Caller identity, for the dossier-visibility gate. */
  userId: string;
};

/**
 * Every milestone observation attributable to ONE dossier.
 *
 * Attribution is structural, never heuristic. Ocean and air resolve through
 * `shipment` (whose `file_id` is NOT NULL UNIQUE); road carries `file_id`
 * directly. No tenant guessing, no client-name matching, no sender matching —
 * an observation with no structural link reaches no timeline.
 */
export async function readObservationPlane(q: ObservationQuery): Promise<UnifiedEntry[]> {
  // GATE FIRST. The admin client below bypasses RLS entirely.
  if (!(await isFileVisible(q.userId, q.tenantId, q.dossierId))) return [];

  const admin = getAdminSupabaseClient();

  // dossier → shipment, by key. Tenant-scoped explicitly. A dossier may have NO
  // shipment and still have road legs, so a missing shipment silences ocean and
  // air only — it must not silence the whole plane.
  const { data: shipment } = await admin
    .from("shipment")
    .select("id")
    .eq("tenant_id", q.tenantId)
    .eq("file_id", q.dossierId)
    .maybeSingle();

  const cols =
    "id, tenant_id, shipment_id, event_type, occurred_at, source, confidence, location_name, provider_code";

  const [ocean, air] = shipment?.id
    ? await Promise.all([
        admin.from("ocean_tracking_event").select(cols)
          .eq("tenant_id", q.tenantId).eq("shipment_id", shipment.id)
          .order("occurred_at", { ascending: false }).limit(SCAN_CAP),
        admin.from("air_tracking_event").select(cols)
          .eq("tenant_id", q.tenantId).eq("shipment_id", shipment.id)
          .order("occurred_at", { ascending: false }).limit(SCAN_CAP),
      ])
    : [{ data: null }, { data: null }];

  // ROAD — attributed DIRECTLY by `file_id`, with no shipment hop, because the
  // road store carries the dossier itself. Read even when no shipment exists:
  // a dossier can have road legs without an ocean/air booking.
  const road = await admin
    .from("tracking_event")
    .select("id, tenant_id, file_id, type, source, occurred_at, customer_visible")
    .eq("tenant_id", q.tenantId)
    .eq("file_id", q.dossierId)
    .order("occurred_at", { ascending: false })
    .limit(SCAN_CAP);

  const nowIso = new Date().toISOString();
  const rows = [
    ...((ocean.data ?? []) as unknown as ObsRow[]),
    ...((air.data ?? []) as unknown as ObsRow[]),
  ];

  return [
    ...rows.filter((r) => !TELEMETRY.has(r.event_type)).map((r) => toUnified(r, q.dossierId, nowIso)),
    ...((road.data ?? []) as unknown as RoadRow[])
      .filter((r) => ROAD_MILESTONES.has(r.type))
      .map((r) => roadToUnified(r, nowIso)),
  ];
}

type RoadRow = {
  id: string;
  tenant_id: string;
  file_id: string;
  type: string;
  source: string;
  occurred_at: string;
  customer_visible: boolean;
};

/**
 * UT3-ROAD Option C. `confidence` is **null, always** — the road store records
 * no grade, and inventing one would make a driver's tap indistinguishable from
 * a carrier's confirmation. `customer_message` and `internal_note` are free text
 * and are never selected, let alone projected; coordinates belong to the map.
 */
function roadToUnified(r: RoadRow, nowIso: string): UnifiedEntry {
  return {
    entryId: `B:${r.id}`,
    tenantId: r.tenant_id,
    dossierId: r.file_id,
    subjectType: "operational_file",
    subjectId: r.file_id,
    plane: "observation",
    nature: "observation",
    origin: roadOrigin(r.source),
    eventType: r.type,
    occurredAt: r.occurred_at,
    ordinal: null,
    observationSource: r.source,
    confidence: null,
    freshness: classifyFreshness(ROAD_FRESHNESS_SOURCE[r.source] ?? "SYSTEM", r.occurred_at, nowIso),
    label: r.type,
    summary: {},
    locationName: null,
    domain: null,
    actorId: null,
    actorName: null,
    chronologyGroup: "",
    chronologyProvable: false,
    // Both must agree: our allow-list AND the row's own customer_visible flag.
    // The store already made a per-row judgement; we narrow it, never widen it.
    clientSafe: ROAD_CLIENT_SAFE.has(r.type) && r.customer_visible === true,
    paginationToken: "",
  };
}

function toUnified(r: ObsRow, dossierId: string, nowIso: string): UnifiedEntry {
  // Verbatim, or null. An unrecognised grade is NOT coerced into a plausible
  // one: a fabricated CONFIRMED is worse than an admitted unknown.
  const confidence = (CONFIDENCE as readonly string[]).includes(r.confidence)
    ? (r.confidence as Confidence)
    : null;

  return {
    entryId: `B:${r.id}`,
    tenantId: r.tenant_id,
    dossierId,
    subjectType: "shipment",
    subjectId: r.shipment_id,
    plane: "observation",
    // An observation is not a decision, and its origin is the world outside.
    nature: "observation",
    origin: r.source === "MANUAL" ? "human" : r.source === "SYSTEM" ? "system" : "external",
    eventType: r.event_type,
    occurredAt: r.occurred_at,
    // Plane B never carries an ordinal: an observation's position is its world
    // time, and a sequence would record OUR ingest order instead.
    ordinal: null,
    observationSource: r.source,
    confidence,
    freshness: classifyFreshness(r.source as TrackingSource, r.occurred_at, nowIso),
    label: r.event_type,
    // Identifiers and codes only. `description` is free text and never travels;
    // latitude/longitude belong to the map, not to history.
    summary: r.provider_code ? { provider_code: r.provider_code } : {},
    locationName: r.location_name,
    domain: null,
    actorId: null,
    actorName: null,
    chronologyGroup: "",
    chronologyProvable: false,
    clientSafe: (CLIENT_SAFE_OBSERVATIONS as readonly string[]).includes(r.event_type),
    paginationToken: "",
  };
}
