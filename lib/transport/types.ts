/**
 * Transport shared types (Phase 1.10). Client + server safe.
 */
export type TransportStatus =
  | "NOT_STARTED"
  | "PLANNED"
  | "DRIVER_ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "POD_RECEIVED"
  | "BLOCKED"
  | "CANCELLED";

/** Editable metadata (manual fields — drivers/vehicles are free-text for MVP). */
export type TransportInput = {
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  pickupPlanned?: string | null;
  deliveryPlanned?: string | null;
  transportCompany?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
  customsOverride?: boolean;
};

export type TransportAssignment = {
  driverName?: string | null;
  driverPhone?: string | null;
  vehiclePlate?: string | null;
  trailerOrContainer?: string | null;
};

export type TransportRecord = {
  id: string;
  fileId: string;
  status: TransportStatus;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupPlanned: string | null;
  pickupActual: string | null;
  deliveryPlanned: string | null;
  deliveryActual: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  trailerOrContainer: string | null;
  transportCompany: string | null;
  deliveryReference: string | null;
  customsOverride: boolean;
  notes: string | null;
  /** Assigned DRIVER app_user (Phase 3.4C) — the driver-mobile / tracking link. */
  driverUserId: string | null;
};

export type TransportQueueItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  fileType: string | null;
  clientName: string | null;
  status: TransportStatus;
  driverName: string | null;
  vehiclePlate: string | null;
  deliveryPlanned: string | null;
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
