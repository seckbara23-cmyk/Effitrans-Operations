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
  /**
   * MAYA-P0.6-B — the MAYA-compatible business name, DERIVED server-side from
   * direction × mode × cargo form × regime and stored nowhere.
   *
   * `null` means "no MAYA name applies here", and it means that for two
   * different reasons the surface must treat identically: the four dimensions
   * match no MAYA type, OR the viewer lacks `customs:read` and the regime
   * dimension is therefore unreadable. Both fall back to the generic label —
   * never to a partial name, which would silently assert a non-suspensive
   * regime the viewer is not entitled to know.
   */
  mayaLabel: string | null;
  /** The customer's own reference (« Réf. Client »). */
  clientReference: string | null;
  /** PLATFORM_NATIVE | MAYA_IMPORT — the dossier's origin. */
  provenance: string;
  /** The original MAYA dossier number. OPAQUE: displayed, never parsed. */
  legacyReference: string | null;
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

/**
 * MAYA-P0.6-D — one physical carriage unit belonging to this dossier's shipment.
 *
 * A read-only projection of a row that ALREADY EXISTS in the transport model
 * (`ocean_container` for sea, `air_cargo_piece` for air). Two rules hold:
 *
 *   * every value is carried through EXACTLY AS STORED. `type` in particular is
 *     the raw `iso_type` / `uld_type` text — it is never parsed, mapped or
 *     bucketed. No size class is derived from it (see `DossierCarriage.total`).
 *   * this type classifies nothing. It renames nothing. `/shipping` remains the
 *     authority that MANAGES these rows; the dossier only shows them.
 */
export type CarriageUnit = {
  id: string;
  /** Container number (sea), or the ULD this line is built into (air). */
  label: string | null;
  /** `iso_type` (sea) or `uld_type` (air), verbatim. NEVER parsed. */
  type: string | null;
  /** Lifecycle status as the transport model records it. */
  status: string | null;
  /** Air only — pieces on this line. Null for a container. */
  pieceCount: number | null;
  weightKg: number | null;
  volumeM3: number | null;
  /** Air only — free text the air model already stores. */
  dimensions: string | null;
  specialHandling: string | null;
  dangerousGoods: boolean;
  temperatureControlled: boolean;
};

/**
 * The dossier's carriage, as read under `transport:read`.
 *
 * `total` is the plain number of AUTHORIZED rows returned — nothing more. It is
 * deliberately NOT broken down by size class: `iso_type` is unvalidated free
 * text (`normalizeReference(input.isoType, 8)`) with no vocabulary, CHECK or
 * parser behind it, so a TC20/TC40 split would be manufactured rather than
 * read. That remains unresolved pending a vocabulary decision.
 */
export type DossierCarriage = {
  mode: "SEA" | "AIR";
  total: number;
  units: CarriageUnit[];
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
    /**
     * MAYA-P0.6-D — the shipment's own key, so the dossier's carriage units can
     * be read with ONE query instead of re-resolving the shipment first.
     */
    id: string;
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
