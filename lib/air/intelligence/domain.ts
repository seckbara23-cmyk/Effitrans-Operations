/**
 * Air Cargo — provider-neutral domain (Phase 7.3A). PURE. The AirShipment REUSES the
 * shipment root (transport_mode='AIR'); it is not a new shipment identity.
 */
import type { AirMilestone } from "./milestones";
import type { TrackingConfidence } from "@/lib/shipping/intelligence/events";

export type Airline = { id: string; name: string; iata: string | null; icao: string | null; website: string | null; active: boolean; notes: string | null };
export type Airport = { id: string; iata: string | null; icao: string | null; name: string; city: string | null; country: string | null; latitude: number | null; longitude: number | null; timezone: string | null; active: boolean };

export type FlightStatus = "SCHEDULED" | "DEPARTED" | "ARRIVED" | "CANCELLED";
export type Flight = {
  id: string; flightNumber: string | null; airlineId: string | null;
  originAirportId: string | null; destinationAirportId: string | null;
  scheduledDeparture: string | null; scheduledArrival: string | null;
  actualDeparture: string | null; actualArrival: string | null; status: FlightStatus;
};

export type FlightLegStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type FlightLeg = {
  sequence: number; originAirportId: string | null; destinationAirportId: string | null; connectionAirportId: string | null;
  std: string | null; sta: string | null; atd: string | null; ata: string | null; status: FlightLegStatus;
};

export type AwbStatus = "DRAFT" | "ISSUED" | "CONFIRMED" | "CANCELLED";
export type AirWaybill = { shipmentId: string; flightId: string | null; mawb: string | null; hawb: string | null; status: AwbStatus };

export type UldStatus = "EMPTY" | "BUILT" | "LOADED" | "IN_TRANSIT" | "ARRIVED" | "BROKEN_DOWN" | "RETURNED";
export type ULD = { id: string; shipmentId: string; flightId: string | null; number: string; type: string | null; owner: string | null; status: UldStatus };

export type CargoPiece = {
  id: string; shipmentId: string; uldId: string | null; pieceCount: number; weightKg: number | null; volumeM3: number | null;
  dimensions: string | null; specialHandling: string | null; dangerousGoods: boolean; temperatureControlled: boolean;
};

/** A normalized aircraft position (no live ADS-B/airline feed is called in 7.3A). */
export type FlightPosition = { flightNumber?: string | null; latitude: number; longitude: number; occurredAt: string; receivedAt: string; sourceProvider: string };

export type AirProviderReference = { provider: string; externalReference: string | null; syncedAt: string | null };

export type AirShipment = {
  id: string; fileId: string; fileNumber: string | null; clientName: string | null;
  origin: string | null; destination: string | null; airlineId: string | null;
  mawb: string | null; hawb: string | null; milestone: AirMilestone; providerCode: string;
  scheduledDeparture: string | null; actualDeparture: string | null;
  estimatedArrival: string | null; actualArrival: string | null;
  positionConfidence: TrackingConfidence | null; trackingSyncedAt: string | null;
};
