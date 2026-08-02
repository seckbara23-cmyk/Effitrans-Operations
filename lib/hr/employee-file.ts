import "server-only";

/**
 * HR-3 — Employee File: documents + contracts. SERVER-ONLY reads and actions
 * live together (small module; the split idiom applies when it grows).
 *
 * BOUNDED CONTEXT: dedicated tables + the PRIVATE 'hr-documents' bucket —
 * never public.document, never a public URL. Files are streamed up through the
 * service role and read back via short-TTL signed URLs minted server-side.
 * C3-classed documents additionally require hr:sensitive:read (RLS + app gate).
 * Ledger emission is mandatory with compensation (ADR-HR2-01).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
export type HrDocumentType = Tbl["hr_document_type"]["Row"];
export type HrDocument = Tbl["hr_document"]["Row"];
export type EmploymentContract = Tbl["employment_contract"]["Row"];

export async function listDocumentTypes(tenantId: string): Promise<HrDocumentType[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_document_type").select("*")
    .eq("tenant_id", tenantId).eq("is_active", true).order("label_fr");
  if (error) throw new Error(`[hr] doc types read failed: ${error.message}`);
  return data ?? [];
}

/** Non-deleted documents; C3-classed rows are stripped unless the caller may see them. */
export async function listEmployeeDocuments(
  tenantId: string, employeeId: string, canSeeSensitive: boolean,
): Promise<(HrDocument & { type: HrDocumentType | null })[]> {
  const s = getAdminSupabaseClient();
  const [docs, types] = await Promise.all([
    s.from("hr_document").select("*").eq("tenant_id", tenantId).eq("employee_id", employeeId)
      .is("deleted_at", null).order("uploaded_at", { ascending: false }),
    s.from("hr_document_type").select("*").eq("tenant_id", tenantId),
  ]);
  if (docs.error) throw new Error(`[hr] documents read failed: ${docs.error.message}`);
  const byId = new Map((types.data ?? []).map((t) => [t.id, t]));
  return (docs.data ?? [])
    .map((d) => ({ ...d, type: byId.get(d.document_type_id) ?? null }))
    .filter((d) => canSeeSensitive || d.type?.data_class !== "C3");
}

export async function listEmployeeContracts(tenantId: string, employeeId: string): Promise<EmploymentContract[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("employment_contract").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(`[hr] contracts read failed: ${error.message}`);
  return data ?? [];
}

/** The ratified transition rule: TERMINATED requires every required_for_termination
 *  type to have a live document. Returns the missing labels (empty = pass). */
export async function missingTerminationDocuments(tenantId: string, employeeId: string): Promise<string[]> {
  const s = getAdminSupabaseClient();
  const { data: required } = await s.from("hr_document_type").select("id, label_fr")
    .eq("tenant_id", tenantId).eq("is_active", true).eq("required_for_termination", true);
  if (!required?.length) return [];
  const { data: docs } = await s.from("hr_document").select("document_type_id")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId).is("deleted_at", null);
  const have = new Set((docs ?? []).map((d) => d.document_type_id));
  return required.filter((t) => !have.has(t.id)).map((t) => t.label_fr);
}
