import { redirect } from "next/navigation";

/**
 * Legacy prototype route (Phase 1.17B). The "Customers" page rendered hard-coded
 * mock data; the real client directory is /clients. Removed from the sidebar and
 * redirected here so old links/bookmarks land on the real module.
 */
export default function CustomersPage() {
  redirect("/clients");
}
