/**
 * Portal reads (Phase 1.12A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Uses the USER-CONTEXT client so the additive portal RLS policies are the hard
 * boundary — a portal user only ever sees their own client's dossier spine.
 * SAFE column projection: only public-facing fields are selected (file number,
 * type, status, shipment route, customs/transport STATUS) — never internal
 * notes, refs, tasks, finance, or audit.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import type { PortalDashboard, PortalFileSummary } from "./types";

type FileRow = {
  id: string;
  file_number: string;
  type: string;
  status: string;
  shipment: { origin: string | null; destination: string | null; transport_mode: string | null }[] | null;
  customs: { status: string }[] | null;
  transport: { status: string }[] | null;
};

const LIST_SELECT =
  "id, file_number, type, status, shipment(origin, destination, transport_mode), transport:transport_record(status)";
const DETAIL_SELECT =
  "id, file_number, type, status, shipment(origin, destination, transport_mode), customs:customs_record(status), transport:transport_record(status)";

function toSummary(r: FileRow): PortalFileSummary {
  const s = r.shipment?.[0] ?? null;
  return {
    id: r.id,
    fileNumber: r.file_number,
    type: r.type,
    status: r.status,
    origin: s?.origin ?? null,
    destination: s?.destination ?? null,
    transportMode: s?.transport_mode ?? null,
    customsStatus: r.customs?.[0]?.status ?? null,
    transportStatus: r.transport?.[0]?.status ?? null,
  };
}

/** Client name + dossier counts by status (own client only). */
export async function getPortalDashboard(clientName: string | null): Promise<PortalDashboard> {
  const supabase = getServerSupabaseClient();
  const { data } = await supabase.from("operational_file").select("status");
  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { clientName, total: rows.length, byStatus };
}

export async function listPortalFiles(): Promise<PortalFileSummary[]> {
  const supabase = getServerSupabaseClient();
  const { data } = await supabase
    .from("operational_file")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false })
    .returns<FileRow[]>();
  return (data ?? []).map(toSummary);
}

export async function getPortalFileSummary(id: string): Promise<PortalFileSummary | null> {
  const supabase = getServerSupabaseClient();
  const { data } = await supabase
    .from("operational_file")
    .select(DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle<FileRow>();
  return data ? toSummary(data) : null;
}
