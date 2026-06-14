/**
 * Operational File reads (Phase 1.2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * User-context client so RLS (tenant + file:read) applies; assertPermission
 * gives a clean error. Reads are not audited.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/require-permission";
import type { FileDetail, FileListItem, FileStatus, FileType, TransportMode } from "./types";

export async function listFiles(opts?: {
  status?: FileStatus;
  type?: FileType;
}): Promise<FileListItem[]> {
  await assertPermission("file:read");
  const supabase = getServerSupabaseClient();

  let filter = supabase
    .from("operational_file")
    .select("id, file_number, type, status, client:client_id(name), shipment(transport_mode)");

  if (opts?.status) filter = filter.eq("status", opts.status);
  if (opts?.type) filter = filter.eq("type", opts.type);

  const { data, error } = await filter
    .order("file_number", { ascending: false })
    .returns<
      {
        id: string;
        file_number: string;
        type: string;
        status: string;
        client: { name: string } | null;
        shipment: { transport_mode: string | null }[] | null;
      }[]
    >();
  if (error) throw new Error(`[files] list failed: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: f.id,
    fileNumber: f.file_number,
    type: f.type as FileType,
    clientName: f.client?.name ?? null,
    transportMode: (f.shipment?.[0]?.transport_mode ?? null) as TransportMode | null,
    status: f.status as FileStatus,
  }));
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
