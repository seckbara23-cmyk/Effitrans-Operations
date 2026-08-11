"use server";

/**
 * MAYA migration staging — server actions (MAYA-P0.5-C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Three actions, and deliberately only three: stage a batch, validate it,
 * cancel it. THERE IS NO APPLY ACTION, and none may be added in this phase.
 *
 * WHAT THIS MODULE MAY NEVER TOUCH — asserted by tests against this file:
 *   operational_file · shipment · process_* · next_file_number · invoice ·
 *   expense_* · finance_request · client_notification · user_role
 * Staging writes to maya_import_* and nothing else.
 *
 * Authority: `admin:config:manage`, which already exists and is already held
 * by SYSTEM_ADMIN. No MAYA-specific role or permission was created. Actor and
 * tenant come from assertPermission (the session), never from `input` — the
 * browser cannot nominate either.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { artifactHash } from "./identity";
import { normalizeRow, type MayaColumnMap } from "./normalize";
import { validateRow, type ValidationContext } from "./validate";
import { batchOutcome, reconcileBatch } from "./reconcile";
import type { MayaRowStatus } from "./types";

const PATH = "/admin/maya-migration";

export type MayaStagingResult = { ok: true; id: string } | { ok: false; error: string };

const key = (v: string) => v.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Stage a MAYA export VERBATIM. Rows are parsed but not judged — validation is
 * a separate, re-runnable act, so a staging failure can never be confused with
 * a data verdict.
 */
export async function stageMayaBatch(input: {
  sourceTable: string;
  sourceArtifact: string;
  rows: Record<string, string>[];
  mapping: MayaColumnMap;
  /** Only when the export itself carries one; never the clock. */
  sourceExtractedAt?: string | null;
}): Promise<MayaStagingResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!input.sourceTable.trim()) return { ok: false, error: "source_table_required" };
  if (input.rows.length === 0) return { ok: false, error: "empty_export" };

  const supabase = getAdminSupabaseClient();
  const batchNumber = `MAYA-${Date.now().toString(36).toUpperCase()}`;

  const { data: batch, error } = await supabase
    .from("maya_import_batch")
    .insert({
      tenant_id: admin.tenantId,
      batch_number: batchNumber,
      source_artifact: input.sourceArtifact.trim() || null,
      source_artifact_sha256: artifactHash(JSON.stringify(input.rows)),
      source_extracted_at: input.sourceExtractedAt?.trim() || null,
      row_count: input.rows.length,
      prepared_by: admin.id,
      status: "STAGED",
    })
    .select("id")
    .single();
  if (error || !batch) return { ok: false, error: "stage_failed" };

  const staged = input.rows.map((raw, i) => {
    const n = normalizeRow({ sourceTable: input.sourceTable.trim(), raw, mapping: input.mapping });
    return {
      tenant_id: admin.tenantId,
      batch_id: batch.id,
      source_row_number: i + 1,
      source_table: n.sourceTable,
      source_record_id: n.sourceRecordId,
      source_dossier_reference: n.sourceDossierReference,
      source_parent_reference: n.sourceParentReference,
      source_row_hash: n.sourceRowHash,
      raw,
      source_type_label: n.sourceTypeLabel,
      normalized_direction: n.normalizedDirection,
      normalized_mode: n.normalizedMode,
      normalized_cargo_form: n.normalizedCargoForm,
      normalized_regime: n.normalizedRegime,
      taxonomy_resolution: n.taxonomyResolution,
      client_reference_raw: n.clientReferenceRaw,
      client_name_raw: n.clientNameRaw,
      opening_date: n.openingDate,
      vessel_or_flight: n.vesselOrFlight,
      bl_awb_ref: n.blAwbRef,
      origin_raw: n.originRaw,
      destination_raw: n.destinationRaw,
      goods_description: n.goodsDescription,
      goods_nature: n.goodsNature,
      supplier_name: n.supplierName,
      cargo_quantity: n.cargoQuantity,
      cargo_quantity_unit: n.cargoQuantityUnit,
      net_weight_kg: n.netWeightKg,
      gross_weight_kg: n.grossWeightKg,
      volume_m3: n.volumeM3,
      package_count: n.packageCount,
      container_count: n.containerCount,
      container_numbers: n.containerNumbers,
      declaration_reference: n.declarationReference,
      warehouse_entry_date: n.warehouseEntryDate,
      processing_due_date: n.processingDueDate,
      delivery_reference: n.deliveryReference,
      status: "PENDING" as MayaRowStatus,
    };
  });

  const { error: rowsErr } = await supabase.from("maya_import_row").insert(staged);
  if (rowsErr) return { ok: false, error: "stage_failed" };

  await writeAudit({
    action: "maya.migration.batch_staged",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "maya_import_batch",
    entityId: batch.id,
    // Counts and identities only — never the staged business payload.
    after: { batch_number: batchNumber, source_table: input.sourceTable, rows: input.rows.length },
  });
  revalidatePath(PATH);
  return { ok: true, id: batch.id };
}

/**
 * Validate (or re-validate) a staged batch. Idempotent: previous issues are
 * cleared first, so re-running after a mapping fix produces a verdict about
 * the data as it stands, not an accumulation.
 */
export async function validateMayaBatch(batchId: string): Promise<MayaStagingResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();

  const { data: batch } = await supabase
    .from("maya_import_batch")
    .select("id, status, row_count")
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "not_found" };
  if (batch.status === "CANCELLED") return { ok: false, error: "batch_cancelled" };

  const { data: rows } = await supabase
    .from("maya_import_row")
    .select("id, source_row_hash, source_dossier_reference, source_parent_reference, source_record_id, source_table, source_type_label, taxonomy_resolution, normalized_direction, normalized_mode, normalized_cargo_form, normalized_regime, client_reference_raw, client_name_raw, opening_date, cargo_quantity, net_weight_kg, gross_weight_kg, volume_m3, package_count, container_count")
    .eq("batch_id", batchId)
    .eq("tenant_id", admin.tenantId)
    .order("source_row_number");
  if (!rows) return { ok: false, error: "not_found" };

  // ---- context, read ONCE (never per row) --------------------------------
  const [{ data: priorRows }, { data: migrated }, { data: clients }] = await Promise.all([
    supabase.from("maya_import_row").select("source_row_hash")
      .eq("tenant_id", admin.tenantId).neq("batch_id", batchId),
    supabase.from("operational_file").select("legacy_reference")
      .eq("tenant_id", admin.tenantId).not("legacy_reference", "is", null),
    supabase.from("client").select("name, ninea").eq("tenant_id", admin.tenantId),
  ]);

  const ctx: Omit<ValidationContext, "seenHashesInBatch"> = {
    hashesInPriorBatches: new Set((priorRows ?? []).map((r) => r.source_row_hash as string)),
    migratedDossierReferences: new Set(
      (migrated ?? []).map((r) => key(String(r.legacy_reference))),
    ),
    dossierReferencesInBatch: new Set(
      rows.filter((r) => r.source_dossier_reference).map((r) => key(String(r.source_dossier_reference))),
    ),
    matchableClientKeys: new Set(
      (clients ?? []).flatMap((c) => [c.name, c.ninea].filter(Boolean).map((v) => key(String(v)))),
    ),
  };

  await supabase.from("maya_import_issue").delete().eq("batch_id", batchId).eq("tenant_id", admin.tenantId);

  const seen = new Set<string>();
  const statuses: MayaRowStatus[] = [];
  const issueRows: {
    tenant_id: string; batch_id: string; row_id: string;
    severity: string; code: string; field: string | null; message_fr: string;
  }[] = [];
  let unresolved = 0;

  for (const r of rows) {
    const verdict = validateRow(
      {
        sourceTable: String(r.source_table),
        sourceRecordId: r.source_record_id as string | null,
        sourceDossierReference: r.source_dossier_reference as string | null,
        sourceParentReference: r.source_parent_reference as string | null,
        sourceRowHash: String(r.source_row_hash),
        sourceTypeLabel: r.source_type_label as string | null,
        normalizedDirection: r.normalized_direction as string | null,
        normalizedMode: r.normalized_mode as string | null,
        normalizedCargoForm: r.normalized_cargo_form as string | null,
        normalizedRegime: r.normalized_regime as string | null,
        taxonomyResolution: r.taxonomy_resolution as "RESOLVED" | "UNRESOLVED" | "UNKNOWN",
        clientReferenceRaw: r.client_reference_raw as string | null,
        clientNameRaw: r.client_name_raw as string | null,
        openingDate: r.opening_date as string | null,
        cargoQuantity: r.cargo_quantity as number | null,
        netWeightKg: r.net_weight_kg as number | null,
        grossWeightKg: r.gross_weight_kg as number | null,
        volumeM3: r.volume_m3 as number | null,
        packageCount: r.package_count as number | null,
        containerCount: r.container_count as number | null,
        // Fields validation does not read; present for the shared type.
        vesselOrFlight: null, blAwbRef: null, originRaw: null, destinationRaw: null,
        goodsDescription: null, goodsNature: null, supplierName: null,
        cargoQuantityUnit: null, containerNumbers: [], declarationReference: null,
        warehouseEntryDate: null, processingDueDate: null, deliveryReference: null,
        malformed: [],
      },
      { ...ctx, seenHashesInBatch: seen },
    );
    seen.add(String(r.source_row_hash));
    statuses.push(verdict.status);
    if (verdict.unresolved) unresolved += 1;

    await supabase.from("maya_import_row")
      .update({ status: verdict.status, parent_resolution: verdict.parentResolution })
      .eq("id", r.id).eq("tenant_id", admin.tenantId);

    for (const i of verdict.issues) {
      issueRows.push({
        tenant_id: admin.tenantId, batch_id: batchId, row_id: r.id,
        severity: i.severity, code: i.code, field: i.field, message_fr: i.messageFr,
      });
    }
  }

  if (issueRows.length > 0) await supabase.from("maya_import_issue").insert(issueRows);

  const recon = reconcileBatch(statuses, unresolved);
  const { error: updErr } = await supabase
    .from("maya_import_batch")
    .update({
      status: batchOutcome(recon),
      valid_count: recon.valid,
      warning_count: recon.warning,
      rejected_count: recon.rejected,
      duplicate_count: recon.duplicate,
      unresolved_count: recon.unresolved,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", batchId).eq("tenant_id", admin.tenantId);
  // The database's own reconciliation CHECK refuses an unbalanced batch — if
  // it fires, the totals disagree with the rows and nothing should be trusted.
  if (updErr) return { ok: false, error: "reconciliation_failed" };

  await writeAudit({
    action: "maya.migration.batch_validated",
    actorId: admin.id, tenantId: admin.tenantId,
    entity: "maya_import_batch", entityId: batchId,
    after: {
      outcome: batchOutcome(recon), source_rows: recon.sourceRows, valid: recon.valid,
      warning: recon.warning, rejected: recon.rejected, duplicate: recon.duplicate,
      unresolved: recon.unresolved,
    },
  });
  revalidatePath(PATH);
  return { ok: true, id: batchId };
}

/** Withdraw a batch from review. Rows are kept: the history of what arrived. */
export async function cancelMayaBatch(batchId: string, reason: string): Promise<MayaStagingResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!reason.trim()) return { ok: false, error: "reason_required" };

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("maya_import_batch")
    .update({ status: "CANCELLED", review_note: reason.trim(), reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
    .eq("id", batchId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "update_failed" };

  await writeAudit({
    action: "maya.migration.batch_cancelled",
    actorId: admin.id, tenantId: admin.tenantId,
    entity: "maya_import_batch", entityId: batchId,
    after: { reason: reason.trim().slice(0, 500) },
  });
  revalidatePath(PATH);
  return { ok: true, id: batchId };
}
