/**
 * Operational File + Shipment shared types (Phase 1.2). Client + server safe.
 */
export type FileType = "IMP" | "EXP" | "TRP" | "HND";
export type FileStatus = "DRAFT" | "OPENED" | "IN_PROGRESS" | "DELIVERED" | "CLOSED" | "CANCELLED";
export type TransportMode = "SEA" | "AIR" | "ROAD" | "MULTIMODAL";
export type Priority = "low" | "normal" | "high" | "critical";

/** An assignable staff member for the dossier assignee picker (Phase 3.2A). */
export type StaffOption = { id: string; label: string };

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
  /**
   * MAYA-P0.5-B — the cargo declaration every dossier type can carry. Before
   * this, weight and volume existed only inside ocean_container /
   * air_cargo_piece, so a bulk or road-only dossier could not describe its
   * cargo at all. All optional; none is a workflow prerequisite.
   */
  cargoForm?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  netWeightKg?: number | null;
  grossWeightKg?: number | null;
  volumeM3?: number | null;
  packageCount?: number | null;
  goodsDescription?: string | null;
  supplierName?: string | null;
  warehouseEntryDate?: string | null;
};

export type FileInput = {
  type: FileType;
  clientId: string;
  priority?: Priority | null;
  shipment?: ShipmentInput;
  /** MAYA-P0.5-B — dossier facts. Optional, never a prerequisite. */
  parentFileId?: string | null;
  clientReference?: string | null;
  onBehalfOf?: string | null;
  processingDueDate?: string | null;
};

export type FileListItem = {
  id: string;
  fileNumber: string;
  type: FileType;
  clientName: string | null;
  transportMode: TransportMode | null;
  status: FileStatus;
  priority: Priority;
};

/** Sort keys for the dossier work queue (Phase 1.4). */
export type FileSortKey = "newest" | "oldest" | "number" | "client" | "priority" | "status";

/**
 * Search / filter / sort criteria for listFiles (Phase 1.4). All optional —
 * an empty object lists every dossier in the tenant (newest first).
 */
export type FileFilterCriteria = {
  search?: string;
  status?: FileStatus;
  type?: FileType;
  priority?: Priority;
  clientId?: string;
  transportMode?: TransportMode;
  mine?: boolean;
  overdue?: boolean;
  sort?: FileSortKey;
  /** Injected by the service for the `mine` filter; never comes from the URL. */
  currentUserId?: string;
};

/** A row in the dashboard "recent dossiers" table (Phase 1.5). */
export type RecentDossier = {
  id: string;
  fileNumber: string;
  clientName: string | null;
  type: FileType;
  origin: string | null;
  destination: string | null;
  status: FileStatus;
  priority: Priority;
  ownerEmail: string | null; // account manager, else coordinator
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
  /** Assigned staff member (Phase 3.2A) — null when unassigned. */
  assignedToUserId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  /** MAYA-P0.5-B — dossier facts (display only; no workflow meaning). */
  parentFileId: string | null;
  parentFileNumber: string | null;
  clientReference: string | null;
  onBehalfOf: string | null;
  processingDueDate: string | null;
  provenance: string;
  legacyReference: string | null;
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
    cargoForm: string | null;
    quantity: number | null;
    quantityUnit: string | null;
    netWeightKg: number | null;
    grossWeightKg: number | null;
    volumeM3: number | null;
    packageCount: number | null;
    goodsDescription: string | null;
    supplierName: string | null;
    warehouseEntryDate: string | null;
  } | null;
  history: FileTransition[];
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
