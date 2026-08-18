/**
 * Operational File reads (Phase 1.2 + 1.4 search/filters). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * getFile uses the user-context client (RLS: tenant + file:read). The list +
 * KPI reads use the service-role admin client (privileged read, gated by
 * assertPermission + explicit tenant scope) — same pattern as tasks/users —
 * because the search embeds client.name and shipment.* which carry their own
 * RLS (client:read / file:read) a user-context embed can't always satisfy.
 * The operational_file RLS SELECT policy + grant remain the CI-tested boundary.
 * Reads are not audited. Search/filter/sort live in ./filter (pure, tested).
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { deriveMayaLabelFromRow } from "./taxonomy";
import { resolveTimezone } from "@/lib/operations/kpi/windows";
import { resolveFileScope } from "@/lib/authz/visibility";
import { staffDisplayName } from "@/lib/users/lifecycle";
import { applyFileFilters, sortFiles, type FileSearchRow } from "./filter";
import { aggregateFiles, type FileOverview } from "./aggregate";
import type {
  CarriageUnit,
  DossierCarriage,
  FileDetail,
  FileFilterCriteria,
  FileListItem,
  FileStatus,
  FileType,
  Priority,
  RecentDossier,
  StaffOption,
  TransportMode,
} from "./types";

type FileListRow = {
  id: string;
  file_number: string;
  type: string;
  status: string;
  priority: string;
  created_at: string;
  account_manager_id: string | null;
  client_id: string | null;
  client: { name: string } | null;
  client_reference: string | null;
  provenance: string;
  legacy_reference: string | null;
  shipment:
    | {
        id: string;
        transport_mode: string | null;
        vessel_or_flight: string | null;
        origin: string | null;
        destination: string | null;
        bl_awb_ref: string | null;
        container_ref: string | null;
        eta: string | null;
        cargo_form: string | null;
      }[]
    | null;
};

export async function listFiles(criteria: FileFilterCriteria = {}): Promise<FileListItem[]> {
  const user = await assertPermission("file:read");

  // Phase 1.7: scope to readable files (the admin client bypasses RLS).
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return [];

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("operational_file")
    .select(
      "id, file_number, type, status, priority, created_at, account_manager_id, client_id, client_reference, provenance, legacy_reference, client:client_id(name), shipment(id, transport_mode, vessel_or_flight, origin, destination, bl_awb_ref, container_ref, eta, cargo_form)",
    )
    .eq("tenant_id", user.tenantId);
  if (!scope.all) query = query.in("id", scope.ids);

  const { data, error } = await query.limit(2000).returns<FileListRow[]>();
  if (error) throw new Error(`[files] list failed: ${error.message}`);

  const listRows = (data ?? []) as FileListRow[];
  const searching = Boolean(criteria.search?.trim());
  const permissions = await getEffectivePermissions(user.id);
  const canReadCustoms = hasPermission(permissions, "customs:read");

  // ---- BATCHED SIDE READS (MAYA-P0.6-B regime, MAYA-P0.6-C retrieval) ------
  //
  // PERMISSION IS STRUCTURAL, NOT COSMETIC. Without `customs:read` this block
  // does not execute, so no customs value is fetched — nothing is read and
  // then discarded, and an ungated viewer's result set is byte-identical to
  // what it was before customs data was searchable.
  //
  // `declaration_number` is fetched ONLY when a search term exists: it is
  // restricted, and reading it to render a list that never shows it would be
  // exactly the "fetch then discard" this phase forbids. `regime` is read
  // whenever permitted because the derived NAME depends on it (P0.6-B).
  //
  // PERFORMANCE: at most three queries per call, whatever the row count —
  // one dossier read plus two batched child reads. Never one per row.
  const regimes = new Map<string, string>();
  const declarations = new Map<string, string>();
  if (canReadCustoms) {
    // Two literal selects rather than one interpolated string: PostgREST types
    // the result from the literal, and a computed select collapses it.
    const customsQuery = searching
      ? supabase.from("customs_record").select("file_id, regime, declaration_number").eq("tenant_id", user.tenantId)
      : supabase.from("customs_record").select("file_id, regime").eq("tenant_id", user.tenantId);
    const { data: customs } = await customsQuery
      .returns<{ file_id: string; regime: string | null; declaration_number?: string | null }[]>();
    for (const c of customs ?? []) {
      if (c.regime) regimes.set(c.file_id, c.regime);
      if (c.declaration_number) declarations.set(c.file_id, c.declaration_number);
    }
  }

  // Container numbers live in a CHILD table (ocean_container), keyed by
  // shipment. Read once, and only when someone is actually searching — the
  // list itself does not display them.
  const containersByShipment = new Map<string, string[]>();
  if (searching) {
    const { data: containers } = await supabase
      .from("ocean_container")
      .select("shipment_id, container_number")
      .eq("tenant_id", user.tenantId);
    for (const c of (containers ?? []) as { shipment_id: string; container_number: string }[]) {
      const list = containersByShipment.get(c.shipment_id);
      if (list) list.push(c.container_number);
      else containersByShipment.set(c.shipment_id, [c.container_number]);
    }
  }

  // ---- projection -----------------------------------------------------------
  // The derived name is computed HERE, before filtering, so a user can search
  // by « IMPORT MARITIME TC ». It inherits the customs gate for free: an
  // ungated viewer has no regime, so no full name, so no match — which is the
  // correct outcome rather than a special case.
  const rows: FileSearchRow[] = listRows.map((f) => {
    const s = f.shipment?.[0] ?? null;
    return {
      id: f.id,
      fileNumber: f.file_number,
      type: f.type,
      status: f.status,
      priority: f.priority,
      createdAt: f.created_at,
      accountManagerId: f.account_manager_id,
      clientId: f.client_id,
      clientName: f.client?.name ?? null,
      origin: s?.origin ?? null,
      destination: s?.destination ?? null,
      blAwbRef: s?.bl_awb_ref ?? null,
      containerRef: s?.container_ref ?? null,
      transportMode: s?.transport_mode ?? null,
      eta: s?.eta ?? null,
      legacyReference: f.legacy_reference,
      clientReference: f.client_reference,
      vesselOrFlight: s?.vessel_or_flight ?? null,
      containerNumbers: s?.id ? containersByShipment.get(s.id) ?? [] : [],
      declarationNumber: declarations.get(f.id) ?? null,
      mayaLabel: deriveMayaLabelFromRow({
        type: f.type as FileType,
        transportMode: (s?.transport_mode ?? null) as TransportMode | null,
        cargoForm: s?.cargo_form ?? null,
        regime: regimes.get(f.id) ?? null,
      })?.labelFr ?? null,
    };
  });

  const filtered = applyFileFilters(rows, { ...criteria, currentUserId: user.id }, new Date());
  const sorted = sortFiles(filtered, criteria.sort);

  const byId = new Map(listRows.map((f) => [f.id, f]));

  return sorted.map((f) => ({
    id: f.id,
    fileNumber: f.fileNumber,
    type: f.type as FileType,
    clientName: f.clientName,
    transportMode: f.transportMode as TransportMode | null,
    status: f.status as FileStatus,
    priority: f.priority as Priority,
    // Already derived above; never recomputed, and NEVER re-derived from a
    // different regime source.
    mayaLabel: f.mayaLabel,
    clientReference: f.clientReference,
    provenance: byId.get(f.id)?.provenance ?? "PLATFORM_NATIVE",
    legacyReference: f.legacyReference,
    // The declaration number is DELIBERATELY absent from the result: it was
    // matched against, it is not disclosed by having matched.
  }));
}

/**
 * Real dashboard overview over the tenant's operational files (Phase 1.5):
 * KPI counts + status / mode breakdowns. Aggregation is pure (./aggregate).
 */
export async function getFileOverview(): Promise<FileOverview> {
  const user = await assertPermission("file:read");

  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return aggregateFiles([], new Date());

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("operational_file")
    .select("status, priority, shipment(transport_mode, eta)")
    .eq("tenant_id", user.tenantId);
  if (!scope.all) query = query.in("id", scope.ids);

  const { data, error } = await query
    .limit(10000)
    .returns<
      { status: string; priority: string; shipment: { transport_mode: string | null; eta: string | null }[] | null }[]
    >();
  if (error) throw new Error(`[files] overview failed: ${error.message}`);

  const rows = (data ?? []).map((r) => {
    const s = r.shipment?.[0] ?? null;
    return {
      status: r.status,
      priority: r.priority,
      transportMode: s?.transport_mode ?? null,
      eta: s?.eta ?? null,
    };
  });
  return aggregateFiles(rows, new Date());
}

/** Newest dossiers for the dashboard table (Phase 1.5). */
export async function getRecentFiles(limit = 8): Promise<RecentDossier[]> {
  const user = await assertPermission("file:read");

  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return [];

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("operational_file")
    .select(
      "id, file_number, type, status, priority, client:client_id(name), shipment(origin, destination), account_manager:account_manager_id(email), coordinator:coordinator_id(email)",
    )
    .eq("tenant_id", user.tenantId);
  if (!scope.all) query = query.in("id", scope.ids);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<
      {
        id: string;
        file_number: string;
        type: string;
        status: string;
        priority: string;
        client: { name: string } | null;
        shipment: { origin: string | null; destination: string | null }[] | null;
        account_manager: { email: string | null } | null;
        coordinator: { email: string | null } | null;
      }[]
    >();
  if (error) throw new Error(`[files] recent failed: ${error.message}`);

  return (data ?? []).map((f) => {
    const s = f.shipment?.[0] ?? null;
    return {
      id: f.id,
      fileNumber: f.file_number,
      clientName: f.client?.name ?? null,
      type: f.type as FileType,
      origin: s?.origin ?? null,
      destination: s?.destination ?? null,
      status: f.status as FileStatus,
      priority: f.priority as Priority,
      ownerEmail: f.account_manager?.email ?? f.coordinator?.email ?? null,
    };
  });
}

export async function getFile(id: string): Promise<FileDetail | null> {
  await assertPermission("file:read");
  const supabase = getServerSupabaseClient();

  const { data: file } = await supabase
    .from("operational_file")
    .select(
      "id, tenant_id, file_number, type, client_id, status, priority, opened_at, created_at, assigned_to_user_id, parent_file_id, client_reference, on_behalf_of, processing_due_date, provenance, legacy_reference, client:client_id(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!file) return null;

  // MAYA-P0.5-B — the parent's HUMAN key for display. Same RLS-enforced client:
  // a parent in another tenant is unreadable here exactly as it is unlinkable
  // in the database.
  let parentFileNumber: string | null = null;
  if (file.parent_file_id) {
    const { data: parent } = await supabase
      .from("operational_file")
      .select("file_number")
      .eq("id", file.parent_file_id)
      .maybeSingle();
    parentFileNumber = parent?.file_number ?? null;
  }

  // Assignee display name (Phase 3.2A). app_user is self-only under RLS, so a
  // user-context embed can't read another staff member's row — resolve the label
  // via the admin client (a privileged display-name read, already behind
  // file:read + the tenant scope of the file we just loaded).
  let assigneeName: string | null = null;
  let assigneeEmail: string | null = null;
  if (file.assigned_to_user_id) {
    const admin = getAdminSupabaseClient();
    const { data: a } = await admin
      .from("app_user")
      .select("name, email, status")
      .eq("id", file.assigned_to_user_id)
      .eq("tenant_id", file.tenant_id)
      .maybeSingle();
    // 8.1A — historical attribution is permanent: a departed (archived) assignee stays on the
    // dossier, labeled "(Archivé)" — never "Unknown user", never removed.
    assigneeName = a?.name ? staffDisplayName(a.name, a.status) : null;
    assigneeEmail = a?.email ?? null;
  }

  const { data: shipment } = await supabase
    .from("shipment")
    .select(
      "id, transport_mode, incoterm, origin, destination, cargo_type, carrier_name, vessel_or_flight, bl_awb_ref, container_ref, cargo_form, quantity, quantity_unit, net_weight_kg, gross_weight_kg, volume_m3, package_count, goods_description, supplier_name, warehouse_entry_date",
    )
    .eq("file_id", id)
    .maybeSingle();

  const { data: history } = await supabase
    .from("file_state_transition")
    .select("from_status, to_status, note, occurred_at, actor:actor_id(email)")
    .eq("file_id", id)
    .order("occurred_at", { ascending: false })
    .returns<
      {
        from_status: string | null;
        to_status: string;
        note: string | null;
        occurred_at: string;
        actor: { email: string | null } | null;
      }[]
    >();

  const clientName = (file as { client: { name: string } | null }).client?.name ?? null;

  return {
    id: file.id,
    tenantId: file.tenant_id,
    fileNumber: file.file_number,
    type: file.type as FileType,
    clientId: file.client_id,
    clientName,
    status: file.status as FileStatus,
    priority: file.priority as FileDetail["priority"],
    openedAt: file.opened_at,
    createdAt: file.created_at,
    assignedToUserId: file.assigned_to_user_id,
    assigneeName,
    assigneeEmail,
    parentFileId: file.parent_file_id,
    parentFileNumber,
    clientReference: file.client_reference,
    onBehalfOf: file.on_behalf_of,
    processingDueDate: file.processing_due_date,
    provenance: file.provenance,
    legacyReference: file.legacy_reference,
    shipment: shipment
      ? {
          id: shipment.id,
          transportMode: shipment.transport_mode as TransportMode | null,
          incoterm: shipment.incoterm,
          origin: shipment.origin,
          destination: shipment.destination,
          cargoType: shipment.cargo_type,
          carrierName: shipment.carrier_name,
          vesselOrFlight: shipment.vessel_or_flight,
          blAwbRef: shipment.bl_awb_ref,
          containerRef: shipment.container_ref,
          cargoForm: shipment.cargo_form,
          quantity: shipment.quantity,
          quantityUnit: shipment.quantity_unit,
          netWeightKg: shipment.net_weight_kg,
          grossWeightKg: shipment.gross_weight_kg,
          volumeM3: shipment.volume_m3,
          packageCount: shipment.package_count,
          goodsDescription: shipment.goods_description,
          supplierName: shipment.supplier_name,
          warehouseEntryDate: shipment.warehouse_entry_date,
        }
      : null,
    history: (history ?? []).map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      actorEmail: h.actor?.email ?? null,
      note: h.note,
      occurredAt: h.occurred_at,
    })),
  };
}

/**
 * MAYA-P0.8-C — candidate parents for the « Dossier mère » selector.
 * ---------------------------------------------------------------------------
 * The dossier page used to call `listFiles()` for this, and kept two fields out
 * of it. Since P0.6-B/C that call maps up to 2000 dossiers through the full
 * search projection, issues a batched customs read whenever the viewer holds
 * `customs:read`, and derives a MAYA-compatible label per row — all discarded
 * except `{ id, fileNumber }`. It ran on every dossier page load for anyone who
 * could edit.
 *
 * This reads the two columns the selector actually renders, and nothing else.
 *
 * VISIBILITY IS UNCHANGED, and is now enforced one layer lower. `listFiles`
 * runs on the admin client and therefore has to REBUILD the row filter in
 * application code via `resolveFileScope` — that helper exists precisely
 * because the admin client bypasses RLS, and its own comment says it "mirrors
 * can_read_file for admin reads". This reader selects only `operational_file`
 * columns, with no embed that would need another table's policy, so it can run
 * on the USER-CONTEXT client and let the real policy decide:
 *   tenant_id = auth_tenant_id() AND has_permission('file:read')
 *                                AND can_read_file(id)
 * Same rows, decided by the database rather than by a mirror of it.
 *
 * Behaviour is otherwise preserved deliberately: no status, archived or type
 * filter is introduced, because the selector never had one and narrowing it
 * here would silently change which dossiers may be chosen as a parent. The
 * same 2000-row bound and the same newest-first ordering are kept.
 *
 * Parent INTEGRITY is not this function's job and is not duplicated here: the
 * `enforce_file_parent()` trigger already refuses a cross-tenant parent, a
 * self-parent and any cycle, in the database, whatever the UI offers.
 */
export async function listParentCandidates(
  excludeFileId: string,
): Promise<{ id: string; fileNumber: string }[]> {
  const user = await assertPermission("file:read");
  const supabase = getServerSupabaseClient();

  const { data, error } = await supabase
    .from("operational_file")
    .select("id, file_number")
    .eq("tenant_id", user.tenantId)
    // Excluded in the QUERY rather than after the fact — a dossier can never be
    // its own parent, so it should never travel.
    .neq("id", excludeFileId)
    .order("created_at", { ascending: false })
    .limit(2000)
    .returns<{ id: string; file_number: string }[]>();
  if (error) throw new Error(`[files] parent candidates failed: ${error.message}`);

  return (data ?? []).map((f) => ({ id: f.id, fileNumber: f.file_number }));
}

/**
 * The tenant's operating timezone, for rendering instants on the dossier.
 *
 * Follows the pattern four other modules already use (collections, commercial,
 * KPI reader, receivables alerts): read `organization.timezone` and pass it
 * through `resolveTimezone`, which falls back to the platform default on
 * anything invalid. Gated by `file:read` — the same authority as the page it
 * serves — and tenant-scoped by construction, since it can only read the
 * caller's own organization row.
 */
export async function getTenantTimezone(): Promise<string> {
  const user = await assertPermission("file:read");
  const { data } = await getAdminSupabaseClient()
    .from("organization")
    .select("timezone")
    .eq("id", user.tenantId)
    .maybeSingle<{ timezone: string | null }>();
  return resolveTimezone(data?.timezone ?? null);
}

/**
 * MAYA-P0.6-D — the carriage units this dossier is actually carrying.
 * ---------------------------------------------------------------------------
 * MAYA showed per-container rows on the dossier itself. Effitrans stores them
 * (`ocean_container`, `air_cargo_piece`) and already shows them to the CLIENT
 * in the portal — but not to the operator working the dossier, who had to leave
 * for `/shipping`. This closes exactly that gap and nothing else.
 *
 * AUTHORIZATION IS STRUCTURAL. `transport:read` is re-asserted here rather than
 * inherited from the caller — a reader that trusts its caller's check is one
 * refactor away from being called without one — and the read runs on the
 * USER-CONTEXT client, whose policies (`ocean_container_select`,
 * `air_cargo_piece_select`) each require
 * `tenant_id = auth_tenant_id() AND has_permission('transport:read')`.
 * So the DATABASE refuses the rows for an unauthorized or cross-tenant reader:
 * nothing is fetched and then discarded in application code. The explicit
 * tenant filter below is a second, independent layer, not the only one.
 *
 * COST: exactly ONE query, and only for a sea or air dossier. Both tables are
 * served by their existing `(tenant_id, shipment_id)` index. No per-unit read.
 *
 * NOT DERIVED HERE: any TC20/TC40 size split. `iso_type` is unvalidated free
 * text, so a size class would be manufactured rather than read (see
 * `DossierCarriage`). `/shipping` remains the authority that MANAGES these rows.
 */
export async function getDossierCarriage(
  shipmentId: string,
  transportMode: TransportMode | null,
): Promise<DossierCarriage | null> {
  const user = await assertPermission("transport:read");

  const mode: "SEA" | "AIR" | null =
    transportMode === "SEA" || transportMode === "MULTIMODAL"
      ? "SEA"
      : transportMode === "AIR"
        ? "AIR"
        : null;
  // A road-only dossier (or one with no mode yet) has no carriage units by
  // construction — that is an absence of the concept, not an empty result.
  if (!mode) return null;

  const supabase = getServerSupabaseClient();

  if (mode === "SEA") {
    const { data } = await supabase
      .from("ocean_container")
      .select("id, container_number, iso_type, status, gross_weight_kg")
      .eq("tenant_id", user.tenantId)
      .eq("shipment_id", shipmentId)
      .order("container_number", { ascending: true })
      .returns<
        {
          id: string;
          container_number: string;
          iso_type: string | null;
          status: string | null;
          gross_weight_kg: number | null;
        }[]
      >();
    const units: CarriageUnit[] = (data ?? []).map((c) => ({
      id: c.id,
      label: c.container_number,
      type: c.iso_type,
      status: c.status,
      pieceCount: null,
      weightKg: c.gross_weight_kg,
      volumeM3: null,
      dimensions: null,
      specialHandling: null,
      dangerousGoods: false,
      temperatureControlled: false,
    }));
    return { mode, total: units.length, units };
  }

  // Air: the ULD this line is built into rides along as a to-one embed, so the
  // ULD number/type/status costs no extra round trip. `air_uld_select` carries
  // the same tenant + transport:read predicate, so the embed cannot widen what
  // this reader may see.
  const { data } = await supabase
    .from("air_cargo_piece")
    .select(
      "id, piece_count, weight_kg, volume_m3, dimensions, special_handling, dangerous_goods, temperature_controlled, uld:uld_id(uld_number, uld_type, status)",
    )
    .eq("tenant_id", user.tenantId)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        piece_count: number | null;
        weight_kg: number | null;
        volume_m3: number | null;
        dimensions: string | null;
        special_handling: string | null;
        dangerous_goods: boolean | null;
        temperature_controlled: boolean | null;
        uld: { uld_number: string; uld_type: string | null; status: string | null } | null;
      }[]
    >();
  const units: CarriageUnit[] = (data ?? []).map((p) => ({
    id: p.id,
    label: p.uld?.uld_number ?? null,
    type: p.uld?.uld_type ?? null,
    status: p.uld?.status ?? null,
    pieceCount: p.piece_count,
    weightKg: p.weight_kg,
    volumeM3: p.volume_m3,
    dimensions: p.dimensions,
    specialHandling: p.special_handling,
    dangerousGoods: p.dangerous_goods === true,
    temperatureControlled: p.temperature_controlled === true,
  }));
  return { mode, total: units.length, units };
}

/**
 * Active staff in the caller's tenant, for the dossier assignee picker (Phase
 * 3.2A). Gated by file:assign. Mirrors listAssignees (tasks) but on the file
 * permission, so the assignee dropdown never depends on task:update.
 */
/**
 * TMS-1 — the « Responsable client » panel: current Account Manager and the
 * immutable assignment history (assignment_event, subject COMMERCIAL_OWNER).
 * Display data for anyone who can read the dossier; the ACT is gated
 * separately on file:assign:commercial.
 */
export type CommercialOwnerHistoryRow = {
  newUserLabel: string;
  previousUserLabel: string | null;
  actorLabel: string | null;
  reasonCode: string;
  reason: string | null;
  provenance: string;
  at: string;
};
export type CommercialOwnerPanel = {
  ownerId: string | null;
  ownerLabel: string | null;
  history: CommercialOwnerHistoryRow[];
};

export async function getCommercialOwnerPanel(fileId: string): Promise<CommercialOwnerPanel> {
  const user = await assertPermission("file:read");
  const supabase = getAdminSupabaseClient();
  const { data: f } = await supabase
    .from("operational_file")
    .select("account_manager_id")
    .eq("tenant_id", user.tenantId)
    .eq("id", fileId)
    .maybeSingle();
  const ownerId = (f?.account_manager_id as string | null) ?? null;

  const { data: events } = await supabase
    .from("assignment_event")
    .select("previous_user_id, new_user_id, actor_user_id, reason, reason_code, provenance, created_at")
    .eq("tenant_id", user.tenantId)
    .eq("subject_type", "COMMERCIAL_OWNER")
    .eq("subject_id", fileId)
    .order("created_at", { ascending: false })
    .limit(20);

  const ids = new Set<string>();
  if (ownerId) ids.add(ownerId);
  for (const e of events ?? []) {
    for (const v of [e.previous_user_id, e.new_user_id, e.actor_user_id]) if (v) ids.add(v as string);
  }
  const labels = new Map<string, string>();
  if (ids.size > 0) {
    const { data: users } = await supabase
      .from("app_user")
      .select("id, name, email")
      .eq("tenant_id", user.tenantId)
      .in("id", [...ids]);
    for (const u of users ?? []) labels.set(u.id, (u.name as string | null) ?? (u.email as string));
  }
  return {
    ownerId,
    ownerLabel: ownerId ? labels.get(ownerId) ?? null : null,
    history: (events ?? []).map((e) => ({
      newUserLabel: labels.get(e.new_user_id as string) ?? "—",
      previousUserLabel: e.previous_user_id ? labels.get(e.previous_user_id as string) ?? "—" : null,
      actorLabel: e.actor_user_id ? labels.get(e.actor_user_id as string) ?? "—" : null,
      reasonCode: e.reason_code as string,
      reason: (e.reason as string | null) ?? null,
      provenance: e.provenance as string,
      at: e.created_at as string,
    })),
  };
}

export type CommercialOrigin = {
  quotationId: string | null;
  devisNumber: string | null;
  skipReason: string | null;
};

/**
 * QO-1 — the dossier's commercial origin. A devis is OPTIONAL: a dossier
 * legitimately originates from an accepted quotation OR directly. The link
 * lives on the quotation side (`converted_file_id`, EC-3D) — the dossier
 * carries no quotation column, and this read adds no relationship. Gated by
 * the page's own authority (file:read); the quotation CONTENT stays behind
 * commercial read (DEC-C32) — only existence and number surface here.
 */
export async function getCommercialOrigin(fileId: string): Promise<CommercialOrigin> {
  const user = await assertPermission("file:read");
  const supabase = getAdminSupabaseClient();

  const { data: devis } = await supabase
    .from("quotation")
    .select("id, quotation_number")
    .eq("tenant_id", user.tenantId)
    .eq("converted_file_id", fileId)
    .maybeSingle();
  if (devis) {
    return {
      quotationId: devis.id as string,
      devisNumber: (devis.quotation_number as string | null) ?? null,
      skipReason: null,
    };
  }

  // Sans devis — the recorded reason is the cotation step's skip reason
  // (the platform's existing, audited exception mechanism — reused, not
  // duplicated). Absent until the dossier is opened.
  const { data: instance } = await supabase
    .from("process_instance")
    .select("id, tenant_id")
    .eq("file_id", fileId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  let skipReason: string | null = null;
  if (instance && instance.tenant_id === user.tenantId) {
    const { data: exec } = await supabase
      .from("process_step_execution")
      .select("state, skip_reason")
      .eq("tenant_id", user.tenantId)
      .eq("process_instance_id", instance.id)
      .eq("step_key", "cotation")
      .maybeSingle();
    if (exec?.state === "SKIPPED") skipReason = (exec.skip_reason as string | null) ?? null;
  }
  return { quotationId: null, devisNumber: null, skipReason };
}

export async function listAssignableStaff(): Promise<StaffOption[]> {
  const user = await assertPermission("file:assign");
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("id, name, email")
    .eq("tenant_id", user.tenantId)
    .eq("status", "active")
    .order("email");
  if (error) throw new Error(`[files] assignable staff failed: ${error.message}`);
  return (data ?? []).map((u) => ({ id: u.id, label: u.name || u.email }));
}
