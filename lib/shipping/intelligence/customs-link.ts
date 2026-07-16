/**
 * Shipping Line Platform — safe Customs Intelligence link (Phase 7.2A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Shipping CONSUMES a safe, read-only customs summary — it never writes customs and never
 * duplicates the declaration. Customs remains authoritative. Only non-sensitive status
 * booleans cross the boundary (no declaration number, no BAE reference, no documents), so
 * this stays available to a transport:read operator without granting customs access.
 * Avoids cyclic writes: this is a one-way projection.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type ShipmentCustomsSummary = {
  present: boolean;
  operationalStatus: string | null;
  canonicalStatus: string | null;
  released: boolean;
  blocked: boolean;
};

const NONE: ShipmentCustomsSummary = { present: false, operationalStatus: null, canonicalStatus: null, released: false, blocked: false };

/** Safe customs summary for a shipment's file. Tenant-filtered; reads only status fields. */
export async function getShipmentCustomsSummary(
  admin: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
  fileId: string,
): Promise<ShipmentCustomsSummary> {
  const { data } = await admin
    .from("customs_record")
    .select("status, intel_status")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle<{ status: string; intel_status: string }>();
  if (!data) return NONE;
  const released = data.status === "RELEASED" || data.intel_status === "RELEASED" || data.intel_status === "COMPLETED";
  return {
    present: true,
    operationalStatus: data.status,
    canonicalStatus: data.intel_status,
    released,
    blocked: data.status === "BLOCKED",
  };
}
