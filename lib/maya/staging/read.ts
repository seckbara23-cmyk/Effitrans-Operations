import "server-only";

/**
 * MAYA migration staging — reads (MAYA-P0.5-C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Tenant-scoped reads for the review console. Every query filters tenant_id
 * explicitly: the admin client bypasses RLS, so this filter IS the boundary
 * (the tenant-scope guard test enforces it).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { reconcileBatch } from "./reconcile";
import type { BatchReconciliation, MayaBatchStatus, MayaRowStatus } from "./types";

export type MayaBatchSummary = {
  id: string;
  batchNumber: string;
  sourceArtifact: string | null;
  sourceExtractedAt: string | null;
  status: MayaBatchStatus;
  preparedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reconciliation: BatchReconciliation;
};

export async function listMayaBatches(tenantId: string): Promise<MayaBatchSummary[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("maya_import_batch")
    .select("id, batch_number, source_artifact, source_extracted_at, status, prepared_at, reviewed_at, review_note, row_count, valid_count, warning_count, rejected_count, duplicate_count, unresolved_count")
    .eq("tenant_id", tenantId)
    .order("prepared_at", { ascending: false });

  return (data ?? []).map((b) => ({
    id: b.id,
    batchNumber: b.batch_number,
    sourceArtifact: b.source_artifact,
    sourceExtractedAt: b.source_extracted_at,
    status: b.status as MayaBatchStatus,
    preparedAt: b.prepared_at,
    reviewedAt: b.reviewed_at,
    reviewNote: b.review_note,
    reconciliation: {
      sourceRows: b.row_count,
      valid: b.valid_count,
      warning: b.warning_count,
      rejected: b.rejected_count,
      duplicate: b.duplicate_count,
      unresolved: b.unresolved_count,
      balanced: b.status === "STAGED" || b.status === "CANCELLED"
        ? false
        : b.row_count === b.valid_count + b.warning_count + b.rejected_count + b.duplicate_count,
    },
  }));
}

export type MayaIssueRow = {
  id: string;
  rowId: string | null;
  sourceRowNumber: number | null;
  sourceDossierReference: string | null;
  severity: "WARNING" | "ERROR";
  code: string;
  field: string | null;
  messageFr: string;
};

/** Validation findings for one batch, newest severity first (errors above warnings). */
export async function listMayaIssues(tenantId: string, batchId: string): Promise<MayaIssueRow[]> {
  const admin = getAdminSupabaseClient();
  const [{ data: issues }, { data: rows }] = await Promise.all([
    admin.from("maya_import_issue")
      .select("id, row_id, severity, code, field, message_fr")
      .eq("tenant_id", tenantId).eq("batch_id", batchId)
      .order("severity", { ascending: true }).limit(500),
    admin.from("maya_import_row")
      .select("id, source_row_number, source_dossier_reference")
      .eq("tenant_id", tenantId).eq("batch_id", batchId),
  ]);

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  return (issues ?? []).map((i) => {
    const row = i.row_id ? byId.get(i.row_id as string) : undefined;
    return {
      id: i.id,
      rowId: i.row_id,
      sourceRowNumber: (row?.source_row_number as number | undefined) ?? null,
      sourceDossierReference: (row?.source_dossier_reference as string | undefined) ?? null,
      severity: i.severity as "WARNING" | "ERROR",
      code: i.code,
      field: i.field,
      messageFr: i.message_fr,
    };
  });
}

/**
 * Recompute reconciliation FROM THE ROWS rather than the stored counters —
 * the check that catches a batch whose totals drifted from its own rows.
 */
export async function recomputeReconciliation(
  tenantId: string,
  batchId: string,
): Promise<BatchReconciliation> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("maya_import_row")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("batch_id", batchId);
  return reconcileBatch(((data ?? []).map((r) => r.status) as MayaRowStatus[]) ?? []);
}
