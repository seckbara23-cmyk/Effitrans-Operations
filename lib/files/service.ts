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
import { resolveFileScope } from "@/lib/authz/visibility";
import { applyFileFilters, sortFiles, type FileSearchRow } from "./filter";
import { aggregateFiles, type FileOverview } from "./aggregate";
import type {
  FileDetail,
  FileFilterCriteria,
  FileListItem,
  FileStatus,
  FileType,
  Priority,
  RecentDossier,
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
  shipment:
    | {
        transport_mode: string | null;
        origin: string | null;
        destination: string | null;
        bl_awb_ref: string | null;
        container_ref: string | null;
        eta: string | null;
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
      "id, file_number, type, status, priority, created_at, account_manager_id, client_id, client:client_id(name), shipment(transport_mode, origin, destination, bl_awb_ref, container_ref, eta)",
    )
    .eq("tenant_id", user.tenantId);
  if (!scope.all) query = query.in("id", scope.ids);

  const { data, error } = await query.limit(2000).returns<FileListRow[]>();
  if (error) throw new Error(`[files] list failed: ${error.message}`);

  const rows: FileSearchRow[] = (data ?? []).map((f) => {
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
    };
  });

  const filtered = applyFileFilters(rows, { ...criteria, currentUserId: user.id }, new Date());
  const sorted = sortFiles(filtered, criteria.sort);

  return sorted.map((f) => ({
    id: f.id,
    fileNumber: f.fileNumber,
    type: f.type as FileType,
    clientName: f.clientName,
    transportMode: f.transportMode as TransportMode | null,
    status: f.status as FileStatus,
    priority: f.priority as Priority,
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
      "id, tenant_id, file_number, type, client_id, status, priority, opened_at, created_at, client:client_id(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!file) return null;

  const { data: shipment } = await supabase
    .from("shipment")
    .select(
      "transport_mode, incoterm, origin, destination, cargo_type, carrier_name, vessel_or_flight, bl_awb_ref, container_ref",
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
    shipment: shipment
      ? {
          transportMode: shipment.transport_mode as TransportMode | null,
          incoterm: shipment.incoterm,
          origin: shipment.origin,
          destination: shipment.destination,
          cargoType: shipment.cargo_type,
          carrierName: shipment.carrier_name,
          vesselOrFlight: shipment.vessel_or_flight,
          blAwbRef: shipment.bl_awb_ref,
          containerRef: shipment.container_ref,
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
