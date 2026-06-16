import { redirect } from "next/navigation";

/**
 * Legacy prototype detail route (Phase 1.17B). Rendered mock document data.
 * Documents now live inside their dossier — redirect any old per-record link to
 * the dossier directory.
 */
export default function DocumentDetailPage() {
  redirect("/files");
}
