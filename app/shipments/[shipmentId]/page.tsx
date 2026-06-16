import { redirect } from "next/navigation";

/**
 * Legacy prototype detail route (Phase 1.17B). Rendered mock shipment data.
 * The real operational-file directory is /files — redirect any old per-record
 * link there.
 */
export default function ShipmentDetailPage() {
  redirect("/files");
}
