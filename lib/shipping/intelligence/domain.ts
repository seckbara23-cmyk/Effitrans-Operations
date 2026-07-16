/**
 * Shipping Line Platform — provider-neutral ocean domain (Phase 7.2A). PURE (no I/O).
 * ---------------------------------------------------------------------------
 * Types for the ocean domain the platform did not previously own as structured data
 * (carrier, vessel, voyage, port, container, route leg, port call, booking, BL). The
 * OceanShipment REUSES the existing operational_file + shipment identity — it is not a new
 * root entity. No carrier SDK, no mapping library, no DB client is imported here.
 */
import type { ShippingMilestone } from "./milestones";
import type { TrackingConfidence, TrackingSource } from "./events";

export type Carrier = { id: string; code: string; name: string; scac: string | null; website: string | null };

export type Vessel = { id: string; name: string; imo: string | null; mmsi: string | null; flag: string | null; carrierId: string | null };

export type Port = {
  id: string;
  unlocode: string | null;
  name: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

export type VoyageStatus = "PLANNED" | "DEPARTED" | "ARRIVED" | "CANCELLED";
export type Voyage = {
  id: string;
  carrierVoyageRef: string | null;
  vesselId: string | null;
  originPortId: string | null;
  destinationPortId: string | null;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  plannedArrival: string | null;
  actualArrival: string | null;
  status: VoyageStatus;
};

export type ContainerStatus =
  | "EMPTY" | "GATE_IN" | "LOADED" | "ON_VESSEL" | "DISCHARGED" | "AVAILABLE" | "GATED_OUT" | "RETURNED";

export type Container = {
  id: string;
  shipmentId: string;
  number: string;
  isoType: string | null;
  sealNumber: string | null;
  grossWeightKg: number | null;
  status: ContainerStatus;
  vesselId: string | null;
  voyageId: string | null;
  lastEventAt: string | null;
  positionConfidence: TrackingConfidence | null;
};

export type LegMode = "SEA" | "ROAD" | "RAIL" | "TRANSSHIPMENT";
export type LegStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type RouteLeg = {
  sequence: number;
  originPortId: string | null;
  destinationPortId: string | null;
  mode: LegMode;
  vesselId: string | null;
  voyageId: string | null;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  plannedArrival: string | null;
  actualArrival: string | null;
  status: LegStatus;
  source: TrackingSource;
};

export type PortCall = {
  portId: string | null;
  arrival: string | null;
  berth: string | null;
  departure: string | null;
  terminal: string | null;
  source: TrackingSource;
};

export type BookingStatus = "DRAFT" | "REQUESTED" | "CONFIRMED" | "AMENDED" | "CANCELLED";
export type Booking = {
  reference: string | null;
  carrierId: string | null;
  status: BookingStatus;
  confirmationDate: string | null;
  origin: string | null;
  destination: string | null;
  plannedVoyageId: string | null;
};

export type BillOfLading = {
  number: string | null;
  type: "MASTER" | "HOUSE" | null;
  carrierId: string | null;
  issueDate: string | null;
  origin: string | null;
  destination: string | null;
};

/**
 * The canonical ocean shipment. Reuses the operational file + shipment identity; adds the
 * provider-driven canonical milestone, provider binding, and structured booking/BL refs.
 */
export type OceanShipment = {
  id: string; // shipment id
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  transportMode: string | null;
  origin: string | null;
  destination: string | null;
  carrierId: string | null;
  carrierName: string | null;
  bookingReference: string | null;
  bookingStatus: BookingStatus | null;
  masterBl: string | null;
  houseBl: string | null;
  milestone: ShippingMilestone;
  providerCode: string;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  plannedArrival: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  trackingSyncedAt: string | null;
};
