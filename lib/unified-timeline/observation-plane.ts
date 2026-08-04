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
 * Attribution is structural, never heuristic: an observation belongs to a
 * `shipment`, and `shipment.file_id` is NOT NULL UNIQUE, so the dossier is
 * resolved by key. No tenant guessing, no client-name matching, no
 * sender-based matching — an observation with no shipment reaches no timeline.
 */
export async function readObservationPlane(q: ObservationQuery): Promise<UnifiedEntry[]> {
  // GATE FIRST. The admin client below bypasses RLS entirely.
  if (!(await isFileVisible(q.userId, q.tenantId, q.dossierId))) return [];

  const admin = getAdminSupabaseClient();

  // dossier → shipment, by key. Tenant-scoped explicitly.
  const { data: shipment } = await admin
    .from("shipment")
    .select("id")
    .eq("tenant_id", q.tenantId)
    .eq("file_id", q.dossierId)
    .maybeSingle();
  if (!shipment?.id) return [];

  const cols =
    "id, tenant_id, shipment_id, event_type, occurred_at, source, confidence, location_name, provider_code";

  const [ocean, air] = await Promise.all([
    admin.from("ocean_tracking_event").select(cols)
      .eq("tenant_id", q.tenantId).eq("shipment_id", shipment.id)
      .order("occurred_at", { ascending: false }).limit(SCAN_CAP),
    admin.from("air_tracking_event").select(cols)
      .eq("tenant_id", q.tenantId).eq("shipment_id", shipment.id)
      .order("occurred_at", { ascending: false }).limit(SCAN_CAP),
  ]);

  const nowIso = new Date().toISOString();
  const rows = [
    ...((ocean.data ?? []) as unknown as ObsRow[]),
    ...((air.data ?? []) as unknown as ObsRow[]),
  ];

  return rows
    .filter((r) => !TELEMETRY.has(r.event_type))
    .map((r) => toUnified(r, q.dossierId, nowIso));
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
