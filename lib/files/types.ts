/**
 * Operational File + Shipment shared types (Phase 1.2). Client + server safe.
 */
export type FileType = "IMP" | "EXP" | "TRP" | "HND";
export type FileStatus = "DRAFT" | "OPENED" | "IN_PROGRESS" | "DELIVERED" | "CLOSED";
export type TransportMode = "SEA" | "AIR" | "ROAD" | "MULTIMODAL";
export type Priority = "low" | "normal" | "high" | "critical";

export type ShipmentInput = {
  transportMode?: TransportMode | null;
  incoterm?: string | null;
  origin?: string | null;
  destination?: string | null;
  cargoType?: string | null;
  carrierName?: string | null;
  vesselOrFlight?: string | null;
  blAwbRef?: string | null;
  containerRef?: string | null;
};

export type FileInput = {
  type: FileType;
  clientId: string;
  priority?: Priority | null;
  shipment?: ShipmentInput;
};

export type FileListItem = {
  id: string;
  fileNumber: string;
  type: FileType;
  clientName: string | null;
  transportMode: TransportMode | null;
  status: FileStatus;
};

export type FileTransition = {
  fromStatus: string | null;
  toStatus: string;
  actorEmail: string | null;
  note: string | null;
  occurredAt: string;
};

export type FileDetail = {
  id: string;
  tenantId: string;
  fileNumber: string;
  type: FileType;
  clientId: string;
  clientName: string | null;
  status: FileStatus;
  priority: Priority;
  openedAt: string | null;
  createdAt: string;
  shipment: {
    transportMode: TransportMode | null;
    incoterm: string | null;
    origin: string | null;
    destination: string | null;
    cargoType: string | null;
    carrierName: string | null;
    vesselOrFlight: string | null;
    blAwbRef: string | null;
    containerRef: string | null;
  } | null;
  history: FileTransition[];
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
