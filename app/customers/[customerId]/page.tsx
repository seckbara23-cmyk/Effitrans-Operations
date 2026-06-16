import { redirect } from "next/navigation";

/**
 * Legacy prototype detail route (Phase 1.17B). Rendered mock customer data.
 * The real client directory is /clients — redirect any old per-record link there.
 */
export default function CustomerDetailPage() {
  redirect("/clients");
}
