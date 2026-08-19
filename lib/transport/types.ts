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

/**
 * Editable planning metadata. PARTIAL PATCH since WES-1A: an omitted or empty
 * field is PRESERVED. Erasing a value requires naming it in `clearFields` —
 * an empty browser form is never consent to erase (lib/transport/patch.ts).
 */
export type TransportInput = {
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  pickupPlanned?: string | null;
  deliveryPlanned?: string | null;
  transportCompany?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
  customsOverride?: boolean;
  /** Planning fields to explicitly clear. The only way to write null. */
  clearFields?: readonly string[];
};

/**
 * Driver/vehicle DISPLAY fields. Same partial-patch contract. The authoritative
 * chauffeur link is `driverUserId` (assignDriverUser), never `driverName`.
 */
export type TransportAssignment = {
  driverName?: string | null;
  driverPhone?: string | null;
  vehiclePlate?: string | null;
  /** TMS-5 — internal fleet vehicle id (uuid) or null. */
  vehicleId?: string | null;
  /** TMS-6 — external subcontractor id (uuid) or null. Exclusive with vehicleId. */
  providerId?: string | null;
  trailerOrContainer?: string | null;
  /** Assignment fields to explicitly clear. The only way to write null. */
  clearFields?: readonly string[];
};

export type TransportRecord = {
  id: string;
  fileId: string;
  status: TransportStatus;
  /** TMS-5 — bound internal fleet vehicle (null for external/hired). */
  vehicleId?: string | null;
  vehicleLabel?: string | null;
  /** TMS-6 — bound external subcontractor (null for fleet execution). */
  providerId?: string | null;
  providerLabel?: string | null;
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
  /**
   * Optimistic-concurrency token (WES-1B). Passed back VERBATIM as
   * `expectedUpdatedAt`; never re-format it or the comparison stops matching.
   */
  updatedAt: string;
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
