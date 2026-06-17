/**
 * Department workspace reads (Phase 2.0). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Thin aggregates that compose EXISTING gated services + the same RLS scope as
 * the module pages. No new business tables. Documentation has no per-tenant
 * "document queue" service yet, so getDocumentationQueue builds one from three
 * scoped reads (files / documents / document_type) and the pure summarizer.
 * Customs/Transport/Finance department pages reuse their module services
 * directly (getCustomsQueue / getTransportQueue / getFinanceQueue, etc.).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { resolveFileScope } from "@/lib/authz/visibility";
import { summarizeDossierDocs } from "./classify";
import type { DocDossierRow } from "./types";

/** Documentation queue: visible, non-closed dossiers with their document state. */
export async function getDocumentationQueue(): Promise<DocDossierRow[]> {
  const user = await assertPermission("document:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return [];

  const supabase = getAdminSupabaseClient();

  let fq = supabase
    .from("operational_file")
    .select("id, file_number, type, priority, opened_at, client:client_id(name)")
    .eq("tenant_id", user.tenantId)
    .neq("status", "CLOSED");
  if (!scope.all) fq = fq.in("id", scope.ids);
  const { data: files, error: fErr } = await fq.returns<
    { id: string; file_number: string; type: string; priority: string; opened_at: string | null; client: { name: string } | null }[]
  >();
  if (fErr) throw new Error(`[departments] documentation files failed: ${fErr.message}`);
  const fileRows = files ?? [];
  if (fileRows.length === 0) return [];
  const ids = fileRows.map((f) => f.id);

  const [{ data: docs }, { data: types }] = await Promise.all([
    supabase
      .from("document")
      .select("file_id, type_code, status")
      .eq("tenant_id", user.tenantId)
      .in("file_id", ids)
      .is("deleted_at", null)
      .returns<{ file_id: string; type_code: string; status: string }[]>(),
    supabase
      .from("document_type")
      .select("code, required_for")
      .eq("active", true)
      .returns<{ code: string; required_for: string[] | null }[]>(),
  ]);

  const typeRows = types ?? [];
  const requiredFor = (fileType: string) =>
    typeRows.filter((t) => (t.required_for ?? []).includes(fileType)).map((t) => t.code);

  const byFile = new Map<string, { typeCode: string; status: string }[]>();
  for (const d of docs ?? []) {
    const list = byFile.get(d.file_id) ?? [];
    list.push({ typeCode: d.type_code, status: d.status });
    byFile.set(d.file_id, list);
  }

  return fileRows.map((f) => {
    const s = summarizeDossierDocs(byFile.get(f.id) ?? [], requiredFor(f.type));
    return {
      fileId: f.id,
      fileNumber: f.file_number,
      clientName: f.client?.name ?? null,
      fileType: f.type,
      priority: f.priority,
      openedAt: f.opened_at,
      pending: s.pending,
      verified: s.verified,
      missing: s.missing,
    };
  });
}

/** Sum of non-reversed payments recorded in the current calendar month (XOF). */
export async function getFinanceMonthRevenue(): Promise<number> {
  const user = await assertPermission("finance:read");
  const supabase = getAdminSupabaseClient();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("payment")
    .select("amount, reversed_at")
    .eq("tenant_id", user.tenantId)
    .gte("paid_at", start)
    .returns<{ amount: number; reversed_at: string | null }[]>();
  return (data ?? [])
    .filter((p) => p.reversed_at == null)
    .reduce((sum, p) => sum + Number(p.amount), 0);
}
