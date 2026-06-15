/**
 * Transport reads (Phase 1.10). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client gated by assertPermission('transport:read') +
 * dossier visibility (isFileVisible / resolveFileScope). The transport_record
 * RLS policy (tenant + transport:read + can_read_file + not deleted) is the
 * CI-tested boundary. Soft-deleted rows excluded.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible, resolveFileScope } from "@/lib/authz/visibility";
import type { TransportQueueItem, TransportRecord, TransportStatus } from "./types";

type RecordRow = {
  id: string;
  file_id: string;
  status: string;
  pickup_location: string | null;
  delivery_location: string | null;
  pickup_planned: string | null;
  pickup_actual: string | null;
  delivery_planned: string | null;
  delivery_actual: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  trailer_or_container: string | null;
  transport_company: string | null;
  delivery_reference: string | null;
  customs_override: boolean;
  notes: string | null;
};

const RECORD_COLS =
  "id, file_id, status, pickup_location, delivery_location, pickup_planned, pickup_actual, delivery_planned, delivery_actual, driver_name, driver_phone, vehicle_plate, trailer_or_container, transport_company, delivery_reference, customs_override, notes";

function toRecord(r: RecordRow): TransportRecord {
  return {
    id: r.id,
    fileId: r.file_id,
    status: r.status as TransportStatus,
    pickupLocation: r.pickup_location,
    deliveryLocation: r.delivery_location,
    pickupPlanned: r.pickup_planned,
    pickupActual: r.pickup_actual,
    deliveryPlanned: r.delivery_planned,
    deliveryActual: r.delivery_actual,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    vehiclePlate: r.vehicle_plate,
    trailerOrContainer: r.trailer_or_container,
    transportCompany: r.transport_company,
    deliveryReference: r.delivery_reference,
    customsOverride: r.customs_override,
    notes: r.notes,
  };
}

export async function getTransportRecord(fileId: string): Promise<TransportRecord | null> {
  const user = await assertPermission("transport:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("transport_record")
    .select(RECORD_COLS)
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle<RecordRow>();
  if (error) throw new Error(`[transport] read failed: ${error.message}`);
  return data ? toRecord(data) : null;
}

export async function getTransportQueue(opts?: { status?: string }): Promise<TransportQueueItem[]> {
  const user = await assertPermission("transport:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return [];

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("transport_record")
    .select(
      "id, file_id, status, driver_name, vehicle_plate, delivery_planned, file:file_id(file_number, type, client:client_id(name))",
    )
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null);
  if (!scope.all) query = query.in("file_id", scope.ids);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("delivery_planned", { ascending: true, nullsFirst: false })
    .returns<
      {
        id: string;
        file_id: string;
        status: string;
        driver_name: string | null;
        vehicle_plate: string | null;
        delivery_planned: string | null;
        file: { file_number: string; type: string; client: { name: string } | null } | null;
      }[]
    >();
  if (error) throw new Error(`[transport] queue failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    fileId: r.file_id,
    fileNumber: r.file?.file_number ?? null,
    fileType: r.file?.type ?? null,
    clientName: r.file?.client?.name ?? null,
    status: r.status as TransportStatus,
    driverName: r.driver_name,
    vehiclePlate: r.vehicle_plate,
    deliveryPlanned: r.delivery_planned,
  }));
}
