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
