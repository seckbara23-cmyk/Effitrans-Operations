/**
 * Air Cargo — persistence mapping (Phase 7.3A). PURE. Maps the shipment (air columns) into
 * the AirShipment domain type. Reuses the shipment identity; MAWB/HAWB come from air_awb.
 */
import { isAirMilestone, type AirMilestone } from "./milestones";
import type { AirShipment } from "./domain";
import type { TrackingConfidence } from "@/lib/shipping/intelligence/events";

export const AIR_SHIPMENT_COLS =
  "id, file_id, origin, destination, airline_id, air_milestone, air_provider_code, etd, atd, eta, ata, eta_previous, tracking_synced_at, air_tracking_version";

export type AirShipmentRow = {
  id: string; file_id: string; origin: string | null; destination: string | null; airline_id: string | null;
  air_milestone: string; air_provider_code: string; etd: string | null; atd: string | null; eta: string | null;
  ata: string | null; eta_previous: string | null; tracking_synced_at: string | null; air_tracking_version: number;
};

export function coerceAirMilestone(raw: string): AirMilestone {
  return isAirMilestone(raw) ? (raw as AirMilestone) : "BOOKED";
}

export function rowToAirShipment(row: AirShipmentRow, ctx: { fileNumber: string | null; clientName: string | null; mawb: string | null; hawb: string | null; positionConfidence?: TrackingConfidence | null }): AirShipment {
  return {
    id: row.id, fileId: row.file_id, fileNumber: ctx.fileNumber, clientName: ctx.clientName,
    origin: row.origin, destination: row.destination, airlineId: row.airline_id,
    mawb: ctx.mawb, hawb: ctx.hawb, milestone: coerceAirMilestone(row.air_milestone), providerCode: row.air_provider_code,
    scheduledDeparture: row.etd, actualDeparture: row.atd, estimatedArrival: row.eta, actualArrival: row.ata,
    positionConfidence: ctx.positionConfidence ?? null, trackingSyncedAt: row.tracking_synced_at,
  };
}
