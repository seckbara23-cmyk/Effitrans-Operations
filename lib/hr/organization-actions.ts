"use server";

/**
 * HR-1 — Organization Foundation + Import staging. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Every action: permission gate → tenant scope → service-role write → audit.
 *
 * GATES
 *   configuration & org catalogs   hr:config:manage — a catalog row GRANTED TO
 *                                  NOBODY until HRQ-D2 is ratified, so every
 *                                  action below denies everyone in production.
 *                                  That is the B1 pause, enforced structurally.
 *   import staging                 hr:manage (stage/submit) — approval requires
 *                                  a DIFFERENT actor (structural CHECK). The
 *                                  dedicated hr:import:* codes belong to the
 *                                  ratified 11-permission family; until that
 *                                  family lands, no code is invented here.
 *
 * THE PIPELINE STOPS AT READY. There is deliberately NO apply/activate action
 * in this module — HR-1 stages; a later phase (behind HRQ-A4) applies.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { createHash } from "node:crypto";
import { UNIT_KINDS, type UnitKind } from "./organization";

export type HrActionResult = { ok: true; id?: string } | { ok: false; error: string };

const HR_PATH = "/departments/hr";

// ---------------------------------------------------------------- configuration

/** Create-or-update the tenant's single configuration row (wizard save). */
export async function saveHrConfiguration(input: {
  employeeNumberKeepExisting: boolean;
  employeeNumberPrefix?: string | null;
  employmentKinds: string[];
  terminationReasons: string[];
}): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const kinds = input.employmentKinds.map((k) => k.trim()).filter(Boolean);
  if (kinds.length === 0) return { ok: false, error: "employment_kinds_required" };

  const supabase = getAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("hr_configuration")
    .select("id, status")
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();

  const payload = {
    employee_number_keep_existing: input.employeeNumberKeepExisting,
    employee_number_prefix: input.employeeNumberPrefix?.trim() || null,
    employment_kinds: kinds,
    termination_reasons: input.terminationReasons.map((r) => r.trim()).filter(Boolean),
  };

  let id = existing?.id;
  if (existing) {
    const { error } = await supabase
      .from("hr_configuration")
      .update(payload)
      .eq("id", existing.id)
      .eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed" };
  } else {
    const { data, error } = await supabase
      .from("hr_configuration")
      .insert({ tenant_id: admin.tenantId, ...payload })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "save_failed" };
    id = data.id;
  }

  await writeAudit({
    action: "hr.configuration_saved",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_configuration",
    entityId: id!,
    after: payload,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
}

/** DRAFT → ACTIVE. One-way in HR-1 (deactivation would be a governed act). */
export async function activateHrConfiguration(): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: cfg } = await supabase
    .from("hr_configuration")
    .select("id, status")
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!cfg) return { ok: false, error: "not_found" };
  if (cfg.status === "ACTIVE") return { ok: true, id: cfg.id };

  const { error } = await supabase
    .from("hr_configuration")
    .update({ status: "ACTIVE", activated_by: admin.id, activated_at: new Date().toISOString() })
    .eq("id", cfg.id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };

  await writeAudit({
    action: "hr.configuration_activated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_configuration",
    entityId: cfg.id,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id: cfg.id };
}

// ---------------------------------------------------------------- org catalogs

export async function createOrgUnit(input: {
  name: string;
  unitKind: UnitKind;
  parentId?: string | null;
  code?: string | null;
  canonicalDepartment?: string | null;
}): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (!UNIT_KINDS.includes(input.unitKind)) return { ok: false, error: "invalid_kind" };

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_org_unit")
    .insert({
      tenant_id: admin.tenantId,
      name,
      unit_kind: input.unitKind,
      parent_id: input.parentId || null,
      code: input.code?.trim() || null,
      canonical_department: input.canonicalDepartment || null,
    })
    .select("id")
    .single();
  // The kind-order trigger raises in French; surface a stable code instead.
  if (error || !data) return { ok: false, error: error?.message.includes("hiérarchie") ? "invalid_parent" : "save_failed" };

  await writeAudit({
    action: "hr.org_unit_created",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_org_unit",
    entityId: data.id,
    after: { name, unit_kind: input.unitKind, parent_id: input.parentId ?? null },
  });
  revalidatePath(`${HR_PATH}/organisation`);
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id: data.id };
}

/** Flag-inactive — units are never deleted once created (frozen rule). */
export async function setOrgUnitActive(id: string, active: boolean): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("hr_org_unit")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({
    action: active ? "hr.org_unit_reactivated" : "hr.org_unit_deactivated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_org_unit",
    entityId: id,
  });
  revalidatePath(`${HR_PATH}/organisation`);
  return { ok: true, id };
}

export async function createPosition(input: { title: string; code?: string | null; description?: string | null }): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, error: "title_required" };
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_position")
    .insert({ tenant_id: admin.tenantId, title, code: input.code?.trim() || null, description: input.description?.trim() || null })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message.includes("duplicate") ? "already_exists" : "save_failed" };
  await writeAudit({
    action: "hr.position_created",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_position",
    entityId: data.id,
    after: { title },
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id: data.id };
}

export async function createWorkLocation(input: { name: string; city?: string | null }): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_required" };
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_work_location")
    .insert({ tenant_id: admin.tenantId, name, city: input.city?.trim() || null })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message.includes("duplicate") ? "already_exists" : "save_failed" };
  await writeAudit({
    action: "hr.work_location_created",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_work_location",
    entityId: data.id,
    after: { name },
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------- import staging

/** Tiny CSV parser — no dependency; comma-separated, double-quote escaping. */
export async function parseCsv(text: string): Promise<string[][]> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** Upload → Stage: create the batch and its verbatim staging rows. */
export async function stageHrImport(input: {
  importKind: "ORG_UNITS" | "POSITIONS" | "WORK_LOCATIONS";
  filename: string;
  csvText: string;
}): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const rows = await parseCsv(input.csvText);
  if (rows.length < 2) return { ok: false, error: "empty_file" };
  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1);

  const supabase = getAdminSupabaseClient();
  const batchNumber = `HR-IMP-${Date.now().toString(36).toUpperCase()}`;
  const sha = createHash("sha256").update(input.csvText).digest("hex");

  const { data: batch, error } = await supabase
    .from("hr_import_batch")
    .insert({
      tenant_id: admin.tenantId,
      batch_number: batchNumber,
      import_kind: input.importKind,
      source_filename: input.filename,
      source_file_sha256: sha,
      row_count: body.length,
      prepared_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !batch) return { ok: false, error: "stage_failed" };

  const staging = body.map((cells, i) => ({
    tenant_id: admin.tenantId,
    batch_id: batch.id,
    source_row_number: i + 2, // 1-based, after the header line
    raw: Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""])),
  }));
  const { error: rowsErr } = await supabase.from("hr_import_staging_row").insert(staging);
  if (rowsErr) return { ok: false, error: "stage_failed" };

  await writeAudit({
    action: "hr.import_staged",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batch.id,
    after: { batch_number: batchNumber, import_kind: input.importKind, rows: body.length },
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batch.id };
}

/** Expected columns per kind — Mapping maps source headers onto these. */
const KIND_FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  ORG_UNITS: { required: ["name", "unit_kind"], optional: ["code", "parent_code", "canonical_department"] },
  POSITIONS: { required: ["title"], optional: ["code", "description"] },
  WORK_LOCATIONS: { required: ["name"], optional: ["city"] },
};

/** Mapping + Validation + Preview: parse every row, record errors, set VALIDATED. */
export async function validateHrImport(batchId: string, mapping: Record<string, string>): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: batch } = await supabase
    .from("hr_import_batch")
    .select("id, status, import_kind")
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "not_found" };
  if (batch.status !== "STAGED" && batch.status !== "VALIDATED") return { ok: false, error: "wrong_status" };

  const fields = KIND_FIELDS[batch.import_kind];
  const { data: rows } = await supabase
    .from("hr_import_staging_row")
    .select("id, source_row_number, raw")
    .eq("batch_id", batchId)
    .eq("tenant_id", admin.tenantId)
    .order("source_row_number");

  // Reset previous validation artifacts (idempotent re-validate).
  await supabase.from("hr_import_error").delete().eq("batch_id", batchId).eq("tenant_id", admin.tenantId);

  let errorCount = 0;
  for (const r of rows ?? []) {
    const raw = r.raw as Record<string, string>;
    const parsed: Record<string, string> = {};
    const problems: { field: string; code: string; message_fr: string }[] = [];
    for (const f of [...fields.required, ...fields.optional]) {
      const source = mapping[f];
      parsed[f] = source ? (raw[source] ?? "").trim() : "";
    }
    for (const f of fields.required) {
      if (!parsed[f]) problems.push({ field: f, code: "required", message_fr: `Champ obligatoire manquant : ${f}` });
    }
    if (batch.import_kind === "ORG_UNITS" && parsed.unit_kind && !UNIT_KINDS.includes(parsed.unit_kind as UnitKind)) {
      problems.push({ field: "unit_kind", code: "invalid_kind", message_fr: `Type d'unité inconnu : ${parsed.unit_kind}` });
    }
    const status = problems.length > 0 ? "REJECTED" : "VALID";
    if (problems.length > 0) {
      errorCount++;
      await supabase.from("hr_import_error").insert(
        problems.map((p) => ({ tenant_id: admin.tenantId, batch_id: batchId, staging_row_id: r.id, ...p })),
      );
    }
    await supabase
      .from("hr_import_staging_row")
      .update({ parsed, status })
      .eq("id", r.id)
      .eq("tenant_id", admin.tenantId);
  }

  const { error } = await supabase
    .from("hr_import_batch")
    .update({ status: "VALIDATED", mapping, error_count: errorCount })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };

  await writeAudit({
    action: "hr.import_validated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batchId,
    after: { mapping, error_count: errorCount },
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batchId };
}

/** Maker: submit a validated batch for approval. */
export async function submitHrImport(batchId: string): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: batch } = await supabase
    .from("hr_import_batch")
    .select("id, status, error_count")
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "not_found" };
  if (batch.status !== "VALIDATED") return { ok: false, error: "wrong_status" };
  if (batch.error_count > 0) return { ok: false, error: "has_errors" };

  const { error } = await supabase
    .from("hr_import_batch")
    .update({ status: "SUBMITTED", submitted_by: admin.id, submitted_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({
    action: "hr.import_submitted",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batchId,
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batchId };
}

/**
 * Checker: approve → READY. The approver must differ from the submitter — the
 * database CHECK is the enforcement; this pre-check only names the refusal.
 * READY is TERMINAL in HR-1: nothing applies the batch (see module header).
 */
export async function approveHrImport(batchId: string): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: batch } = await supabase
    .from("hr_import_batch")
    .select("id, status, submitted_by")
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "not_found" };
  if (batch.status !== "SUBMITTED") return { ok: false, error: "wrong_status" };
  if (batch.submitted_by === admin.id) return { ok: false, error: "same_actor" };

  const { error } = await supabase
    .from("hr_import_batch")
    .update({ status: "READY", approved_by: admin.id, approved_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message.includes("hr_batch_approver_differs") ? "same_actor" : "save_failed" };
  await writeAudit({
    action: "hr.import_approved",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batchId,
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batchId };
}

/** Either seat may reject a staged/validated/submitted batch, with a reason. */
export async function rejectHrImport(batchId: string, reason: string): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const supabase = getAdminSupabaseClient();
  const { data: batch } = await supabase
    .from("hr_import_batch")
    .select("id, status")
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "not_found" };
  if (!["STAGED", "VALIDATED", "SUBMITTED"].includes(batch.status)) return { ok: false, error: "wrong_status" };

  const { error } = await supabase
    .from("hr_import_batch")
    .update({ status: "REJECTED", rejection_reason: reason.trim() })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({
    action: "hr.import_rejected",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batchId,
    after: { reason: reason.trim() },
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batchId };
}
