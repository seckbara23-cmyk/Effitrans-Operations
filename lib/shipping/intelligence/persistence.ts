/**
 * Shipping Line Platform — persistence mapping (Phase 7.2A). PURE (no I/O).
 * ---------------------------------------------------------------------------
 * Maps shipment + ocean satellite rows into the provider-neutral domain types. Reuses the
 * existing shipment identity; the ocean fields come from the 7.2A additive columns / tables.
 */
import type { OceanShipment, Container, BookingStatus, ContainerStatus } from "./domain";
import type { ShippingTrackingEvent, TrackingSource, TrackingConfidence, CanonicalShippingEvent } from "./events";
import { isShippingMilestone, type ShippingMilestone } from "./milestones";

export const OCEAN_SHIPMENT_COLS =
  "id, file_id, transport_mode, origin, destination, carrier_name, vessel_or_flight, bl_awb_ref, " +
  "etd, atd, eta, ata, ocean_milestone, provider_code, carrier_id, booking_reference, booking_status, " +
  "master_bl, house_bl, eta_source, eta_confidence, eta_calculated_at, eta_previous, tracking_synced_at, tracking_version";

export type ShipmentRow = {
  id: string;
  file_id: string;
  transport_mode: string | null;
  origin: string | null;
  destination: string | null;
  carrier_name: string | null;
  bl_awb_ref: string | null;
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  ocean_milestone: string;
  provider_code: string;
  carrier_id: string | null;
  booking_reference: string | null;
  booking_status: string | null;
  master_bl: string | null;
  house_bl: string | null;
  eta_previous: string | null;
  tracking_synced_at: string | null;
  tracking_version: number;
};

export function coerceMilestone(raw: string): ShippingMilestone {
  return isShippingMilestone(raw) ? (raw as ShippingMilestone) : "BOOKING_CREATED";
}

export function rowToOceanShipment(
  row: ShipmentRow,
  ctx: { fileNumber: string | null; clientName: string | null },
): OceanShipment {
  return {
    id: row.id,
    fileId: row.file_id,
    fileNumber: ctx.fileNumber,
    clientName: ctx.clientName,
    transportMode: row.transport_mode,
    origin: row.origin,
    destination: row.destination,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name,
    bookingReference: row.booking_reference,
    bookingStatus: (row.booking_status as BookingStatus | null) ?? null,
    masterBl: row.master_bl ?? row.bl_awb_ref,
    houseBl: row.house_bl,
    milestone: coerceMilestone(row.ocean_milestone),
    providerCode: row.provider_code,
    plannedDeparture: row.etd,
    actualDeparture: row.atd,
    plannedArrival: row.eta_previous, // the ETA before the latest change (delay baseline)
    estimatedArrival: row.eta,
    actualArrival: row.ata,
    trackingSyncedAt: row.tracking_synced_at,
  };
}

export type ContainerRow = {
  id: string;
  shipment_id: string;
  container_number: string;
  iso_type: string | null;
  seal_number: string | null;
  gross_weight_kg: number | null;
  status: string;
  vessel_id: string | null;
  voyage_id: string | null;
  last_event_at: string | null;
  position_confidence: string | null;
};

export function rowToContainer(row: ContainerRow): Container {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    number: row.container_number,
    isoType: row.iso_type,
    sealNumber: row.seal_number,
    grossWeightKg: row.gross_weight_kg,
    status: row.status as ContainerStatus,
    vesselId: row.vessel_id,
    voyageId: row.voyage_id,
    lastEventAt: row.last_event_at,
    positionConfidence: (row.position_confidence as TrackingConfidence | null) ?? null,
  };
}

export type EventRow = {
  id: string;
  tenant_id: string;
  shipment_id: string;
  container_id: string | null;
  event_type: string;
  occurred_at: string;
  received_at: string;
  source: string;
  provider_code: string;
  confidence: string;
  location_name: string | null;
  location_unlocode: string | null;
  latitude: number | null;
  longitude: number | null;
  vessel_imo: string | null;
  vessel_mmsi: string | null;
  vessel_name: string | null;
  voyage_reference: string | null;
  description: string | null;
  fingerprint: string;
};

export function rowToEvent(row: EventRow): ShippingTrackingEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentId: row.shipment_id,
    containerId: row.container_id,
    eventType: row.event_type as CanonicalShippingEvent,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    source: row.source as TrackingSource,
    providerCode: row.provider_code,
    confidence: row.confidence as TrackingConfidence,
    location: { name: row.location_name, unlocode: row.location_unlocode, latitude: row.latitude, longitude: row.longitude },
    vessel: { imo: row.vessel_imo, mmsi: row.vessel_mmsi, name: row.vessel_name, voyageReference: row.voyage_reference },
    description: row.description,
    fingerprint: row.fingerprint,
  };
}
