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
 * HR-1 froze the pipeline at READY behind HRQ-A4. Effitrans answered YES, so
 * HR-B3 completed it: applyHrImport turns a visa'd batch into employees through
 * the EXACT createEmployee path — same matricule engine, same target
 * validation, same duplicate policy, same ledger event — never a parallel
 * insert. Everything before the visa is unchanged.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { createHash } from "node:crypto";
import { UNIT_KINDS, type UnitKind } from "./organization";
// HR-B3 — mass employee registration: the template contract, xlsx support and
// the SAME creation path an individual registration uses.
import {
  EMPLOYEE_TEMPLATE_REQUIRED,
  EMPLOYEE_TEMPLATE_OPTIONAL,
  EMPLOYEE_IMPORT_ALLOWED_STATUSES,
  autoMapEmployeeHeaders,
  canonicalizeEmployeeVocab,
  excelSerialToIsoDate,
} from "./import-template";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { parseXlsx, looksLikeZip } from "./xlsx";
import { EMPLOYMENT_TYPES } from "./validate";
import { createEmployee, transitionEmployee } from "./actions";

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

/** Flag-inactive — units are never deleted once created (frozen rule).
 *
 * HR-C1 — deactivation now inspects real dependencies first, and the three
 * outcomes the audit required are distinct:
 *   * ACTIVE CHILD UNITS  → REFUSED (`active_children`): an active child under
 *     an inactive parent is an incoherent tree — deactivate bottom-up.
 *   * OPEN ASSIGNMENTS    → WARNING (`unit_in_use`) unless acknowledged: the
 *     placements survive untouched (history is never rewritten; only NEW
 *     assignments are refused by validateAssignmentTargets), but the operator
 *     must say so knowingly.
 *   * NEITHER             → safe, as before.
 */
export async function setOrgUnitActive(
  id: string,
  active: boolean,
  opts?: { acknowledgeInUse?: boolean },
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();

  if (!active) {
    const [children, assignments] = await Promise.all([
      supabase
        .from("hr_org_unit")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", admin.tenantId)
        .eq("parent_id", id)
        .eq("is_active", true),
      supabase
        .from("employee_assignment")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", admin.tenantId)
        .eq("org_unit_id", id)
        .is("effective_to", null),
    ]);
    if ((children.count ?? 0) > 0) return { ok: false, error: "active_children" };
    if ((assignments.count ?? 0) > 0 && !opts?.acknowledgeInUse) {
      return { ok: false, error: "unit_in_use" };
    }
  }

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
    after: active ? undefined : { acknowledged_in_use: opts?.acknowledgeInUse === true },
  });
  revalidatePath(`${HR_PATH}/organisation`);
  revalidatePath(`${HR_PATH}/configuration`);
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

// ------------------------------------------------- master-data corrections ----
// HR-C1 -- the missing half of the CRUD. HR-2 found the master data CREATE-ONLY:
// a typo in a unit name meant a second record and an abandoned first. These are
// the corrections, under the same authority (hr:config:manage), the same audit
// contract, and the same frozen rule: deactivation, never deletion.

/** Fields an org-unit correction may touch. `parentId: null` means "make root". */
export async function updateOrgUnit(
  id: string,
  input: {
    name?: string;
    unitKind?: UnitKind;
    parentId?: string | null;
    code?: string | null;
    canonicalDepartment?: string | null;
  },
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: current } = await supabase
    .from("hr_org_unit")
    .select("id, name, unit_kind, parent_id, code, canonical_department")
    .eq("id", id)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_found" };

  const patch: { name?: string; unit_kind?: UnitKind; parent_id?: string | null; code?: string | null; canonical_department?: string | null } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "name_required" };
    patch.name = name;
  }
  if (input.unitKind !== undefined && input.unitKind !== current.unit_kind) {
    if (!UNIT_KINDS.includes(input.unitKind)) return { ok: false, error: "invalid_kind" };
    // THE CHILD-COMPATIBILITY CHECK. The DB trigger revalidates only the row
    // being written against ITS parent -- it never looks down. Retyping a
    // Departement that carries Sections into an Equipe would leave every child
    // violating the order the trigger enforces on their next write. The action
    // is the boundary (the HR-A2 rule), so the check lives here.
    const { data: children } = await supabase
      .from("hr_org_unit")
      .select("unit_kind")
      .eq("tenant_id", admin.tenantId)
      .eq("parent_id", id);
    const newRank = UNIT_KINDS.indexOf(input.unitKind);
    const broken = (children ?? []).some((c) => UNIT_KINDS.indexOf(c.unit_kind as UnitKind) <= newRank);
    if (broken) return { ok: false, error: "invalid_kind_children" };
    // THE CHILD-COMPATIBILITY CHECK. The DB trigger revalidates only the row
    // being written against ITS parent -- it never looks down. Retyping a
    // Departement that carries Sections into an Equipe would leave every child
    // violating the order the trigger enforces on their next write. The action
    // is the boundary (the HR-A2 rule), so the check lives here.
    patch.unit_kind = input.unitKind;
  }
  if (input.parentId !== undefined) patch.parent_id = input.parentId || null;
  if (input.code !== undefined) patch.code = input.code?.trim() || null;
  if (input.canonicalDepartment !== undefined) patch.canonical_department = input.canonicalDepartment || null;
  if (Object.keys(patch).length === 0) return { ok: true, id };

  // Re-parenting is revalidated by the SAME database trigger that guards
  // creation (before insert OR update): self-parent, cross-tenant parent and
  // the strict kind order are all re-checked there. The strict order is also
  // what makes cycles structurally impossible -- every ancestor has a strictly
  // lower rank, so a descendant can never be accepted as a parent.
  const { error } = await supabase
    .from("hr_org_unit")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    const m = error.message;
    if (m.includes("hiérarchie") || m.includes("propre parent") || m.includes("introuvable") || m.includes("autre organisation")) {
      return { ok: false, error: "invalid_parent" };
    }
    return { ok: false, error: "save_failed" };
  }

  await writeAudit({
    action: "hr.org_unit_updated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_org_unit",
    entityId: id,
    before: {
      name: current.name, unit_kind: current.unit_kind,
      parent_id: current.parent_id, canonical_department: current.canonical_department,
    },
    after: patch,
  });
  revalidatePath(`${HR_PATH}/organisation`);
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
}

export async function updatePosition(
  id: string,
  input: { title?: string; code?: string | null; description?: string | null },
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: current } = await supabase
    .from("hr_position")
    .select("id, title")
    .eq("id", id)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_found" };

  const patch: { title?: string; code?: string | null; description?: string | null } = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "title_required" };
    patch.title = title;
  }
  if (input.code !== undefined) patch.code = input.code?.trim() || null;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true, id };

  const { error } = await supabase
    .from("hr_position")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "already_exists" : "save_failed" };

  await writeAudit({
    action: "hr.position_updated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_position",
    entityId: id,
    before: { title: current.title },
    after: patch,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
}

/** Flag-inactive -- a referenced position stays readable forever; only NEW
 *  assignments are refused (validateAssignmentTargets requires active). */
export async function setPositionActive(id: string, active: boolean): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("hr_position")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({
    action: active ? "hr.position_reactivated" : "hr.position_deactivated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_position",
    entityId: id,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
}

export async function updateWorkLocation(
  id: string,
  input: { name?: string; city?: string | null },
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: current } = await supabase
    .from("hr_work_location")
    .select("id, name, city")
    .eq("id", id)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_found" };

  const patch: { name?: string; city?: string | null } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "name_required" };
    patch.name = name;
  }
  if (input.city !== undefined) patch.city = input.city?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true, id };

  const { error } = await supabase
    .from("hr_work_location")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "already_exists" : "save_failed" };

  await writeAudit({
    action: "hr.work_location_updated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_work_location",
    entityId: id,
    before: { name: current.name, city: current.city },
    after: patch,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
}

export async function setWorkLocationActive(id: string, active: boolean): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("hr_work_location")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({
    action: active ? "hr.work_location_reactivated" : "hr.work_location_deactivated",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_work_location",
    entityId: id,
  });
  revalidatePath(`${HR_PATH}/configuration`);
  return { ok: true, id };
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
export type HrImportKind = "ORG_UNITS" | "POSITIONS" | "WORK_LOCATIONS" | "EMPLOYEES";

/** Server-side upload limits — a spreadsheet, not an archive dump. */
const MAX_IMPORT_BYTES = 2_000_000;
const MAX_IMPORT_ROWS = 2_000;

export async function stageHrImport(input: {
  importKind: HrImportKind;
  filename: string;
  csvText: string;
}): Promise<HrActionResult> {
  const rows = await parseCsv(input.csvText);
  const sha = createHash("sha256").update(input.csvText).digest("hex");
  return stageParsedRows(input.importKind, input.filename, rows, sha);
}

/**
 * HR-B3 — file upload entry: .xlsx (the operator format — parsed by the
 * hand-rolled reader) or .csv, over ONE staging path. Size and row limits are
 * enforced HERE, server-side; the client's accept= attribute is convenience,
 * never the control.
 */
export async function stageHrImportFile(input: {
  importKind: HrImportKind;
  filename: string;
  base64: string;
}): Promise<HrActionResult> {
  let buf: Buffer;
  try {
    buf = Buffer.from(input.base64, "base64");
  } catch {
    return { ok: false, error: "unreadable_file" };
  }
  if (buf.length === 0) return { ok: false, error: "empty_file" };
  if (buf.length > MAX_IMPORT_BYTES) return { ok: false, error: "file_too_large" };

  const bytes = new Uint8Array(buf);
  let rows: string[][];
  if (looksLikeZip(bytes) || /\.xlsx$/i.test(input.filename)) {
    try {
      rows = parseXlsx(bytes);
    } catch {
      return { ok: false, error: "unreadable_file" };
    }
  } else {
    rows = await parseCsv(buf.toString("utf-8"));
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  return stageParsedRows(input.importKind, input.filename, rows, sha);
}

async function stageParsedRows(
  importKind: HrImportKind,
  filename: string,
  rows: string[][],
  sha: string,
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (rows.length < 2) return { ok: false, error: "empty_file" };
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: "too_many_rows" };
  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1).filter((cells) => cells.some((c) => c.trim() !== ""));
  if (body.length === 0) return { ok: false, error: "empty_file" };

  const supabase = getAdminSupabaseClient();
  const batchNumber = `HR-IMP-${Date.now().toString(36).toUpperCase()}`;

  const { data: batch, error } = await supabase
    .from("hr_import_batch")
    .insert({
      tenant_id: admin.tenantId,
      batch_number: batchNumber,
      import_kind: importKind,
      source_filename: filename,
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
    after: { batch_number: batchNumber, import_kind: importKind, rows: body.length },
  });
  revalidatePath(`${HR_PATH}/imports`);
  return { ok: true, id: batch.id };
}

/** Expected columns per kind — Mapping maps source headers onto these. */
const KIND_FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  ORG_UNITS: { required: ["name", "unit_kind"], optional: ["code", "parent_code", "canonical_department"] },
  POSITIONS: { required: ["title"], optional: ["code", "description"] },
  WORK_LOCATIONS: { required: ["name"], optional: ["city"] },
  // HR-B3 — the employee template contract lives in ./import-template (ONE
  // definition shared by the xlsx builder, the auto-mapper, this validator and
  // the tests). The matricule is deliberately NOT a column: numbers are minted
  // by next_employee_number at application, never supplied by a spreadsheet.
  EMPLOYEES: {
    required: [...EMPLOYEE_TEMPLATE_REQUIRED],
    optional: [...EMPLOYEE_TEMPLATE_OPTIONAL],
  },
};

// HR-B3A: derived from THE canonical registry — never a second hard-coded list.
const DEPARTMENT_CODES: readonly string[] = CANONICAL_DEPARTMENTS.map((d) => d.code);



// ------------------------------------------------------- HR-B3 validation ----
// Reference data loaded ONCE per validation run, then applied per row. Every
// lookup is tenant-scoped; nothing is ever created from a spreadsheet value —
// an unknown « Comptble » is an error with a readable reason, never a new row.

type EmployeeImportRefs = {
  units: { id: string; name: string; code: string | null; is_active: boolean }[];
  positions: { title: string; is_active: boolean }[];
  locations: { name: string; is_active: boolean }[];
  employees: {
    id: string; employee_number: string; professional_email: string | null;
    first_name: string; last_name: string; status: string;
  }[];
};

async function loadEmployeeImportRefs(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
): Promise<EmployeeImportRefs> {
  const [units, positions, locations, employees] = await Promise.all([
    supabase.from("hr_org_unit").select("id, name, code, is_active").eq("tenant_id", tenantId),
    supabase.from("hr_position").select("title, is_active").eq("tenant_id", tenantId),
    supabase.from("hr_work_location").select("name, is_active").eq("tenant_id", tenantId),
    supabase.from("employee")
      .select("id, employee_number, professional_email, first_name, last_name, status")
      .eq("tenant_id", tenantId),
  ]);
  return {
    units: units.data ?? [],
    positions: positions.data ?? [],
    locations: locations.data ?? [],
    employees: employees.data ?? [],
  };
}

const ciEq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PHONE_RE = /^[+0-9 ().\-]{6,}$/;

/** Validate + resolve ONE employee row. Mutates `parsed` with resolved ids and
 *  canonical catalog values; pushes readable French problems. */
function validateEmployeeRow(
  parsed: Record<string, string>,
  rowNumber: number,
  refs: EmployeeImportRefs,
  seenEmails: Map<string, number>,
  seenNames: Map<string, number>,
  problems: { field: string; code: string; message_fr: string }[],
): void {
  const push = (field: string, code: string, message_fr: string) =>
    problems.push({ field, code, message_fr });

  // HR-B3A: accept the registries' own French labels (« Finance » → FINANCE,
  // « Brouillon » → DRAFT) — exact, accent/case-insensitive, then validate the
  // canonical code. The server stays authoritative; Excel dropdowns are UX.
  for (const f of ["department", "employment_type", "status"] as const) {
    if (parsed[f]) parsed[f] = canonicalizeEmployeeVocab(f, parsed[f]);
  }

  if (parsed.department && !DEPARTMENT_CODES.includes(parsed.department)) {
    push("department", "invalid_department",
      `Département inconnu : « ${parsed.department} » (attendu : ${DEPARTMENT_CODES.join(", ")})`);
  }
  if (parsed.employment_type && !(EMPLOYMENT_TYPES as readonly string[]).includes(parsed.employment_type)) {
    push("employment_type", "invalid_employment_type",
      `Type d'emploi inconnu : « ${parsed.employment_type} » (attendu : ${EMPLOYMENT_TYPES.join(", ")})`);
  }
  if (parsed.status && !(EMPLOYEE_IMPORT_ALLOWED_STATUSES as readonly string[]).includes(parsed.status)) {
    push("status", "invalid_status",
      `Statut initial invalide : « ${parsed.status} » (un import ne crée que DRAFT ou ACTIVE)`);
  }
  if (parsed.hire_date) {
    parsed.hire_date = excelSerialToIsoDate(parsed.hire_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.hire_date) || Number.isNaN(Date.parse(parsed.hire_date))) {
      push("hire_date", "invalid_date", `Date d'entrée invalide : « ${parsed.hire_date} » (AAAA-MM-JJ attendu)`);
    }
  }
  if (parsed.professional_email) {
    const email = parsed.professional_email.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      push("professional_email", "invalid_email", `Adresse e-mail invalide : « ${parsed.professional_email} »`);
    } else {
      const prior = seenEmails.get(email);
      if (prior !== undefined) {
        push("professional_email", "duplicate_in_file",
          `Adresse e-mail en double dans le fichier (déjà ligne ${prior})`);
      } else {
        seenEmails.set(email, rowNumber);
        const existing = refs.employees.find(
          (e) => e.professional_email && ciEq(e.professional_email, email),
        );
        if (existing) {
          push("professional_email", "email_exists",
            `Adresse e-mail déjà utilisée (${existing.employee_number})`);
        }
      }
    }
  }
  if (parsed.professional_phone && !PHONE_RE.test(parsed.professional_phone)) {
    const numerified = /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(parsed.professional_phone);
    push("professional_phone", "invalid_phone", numerified
      ? `Téléphone converti en nombre par Excel : « ${parsed.professional_phone} » — utilisez la colonne Texte du modèle fourni et ressaisissez le numéro avec son +`
      : `Téléphone invalide : « ${parsed.professional_phone} »`);
  }
  if (parsed.first_name && parsed.last_name) {
    const key = `${parsed.first_name.trim().toLowerCase()}|${parsed.last_name.trim().toLowerCase()}`;
    const prior = seenNames.get(key);
    if (prior !== undefined) {
      push("last_name", "duplicate_name_in_file",
        `Nom en double dans le fichier (déjà ligne ${prior}) — importez l'un des deux manuellement (confirmation d'homonymie)`);
    } else {
      seenNames.set(key, rowNumber);
      const existing = refs.employees.find(
        (e) => ciEq(e.first_name, parsed.first_name) && ciEq(e.last_name, parsed.last_name)
          && e.status !== "TERMINATED" && e.status !== "ARCHIVED",
      );
      if (existing) {
        push("last_name", "employee_exists",
          `Un employé en cours porte déjà ce nom (${existing.employee_number}) — créez-le manuellement pour confirmer l'homonymie`);
      }
    }
  }
  if (parsed.org_unit) {
    const byCode = refs.units.filter((u) => u.code && ciEq(u.code, parsed.org_unit));
    const matches = byCode.length > 0 ? byCode : refs.units.filter((u) => ciEq(u.name, parsed.org_unit));
    if (matches.length === 0) {
      push("org_unit", "unknown_unit", `Unité « ${parsed.org_unit} » introuvable`);
    } else if (matches.length > 1) {
      push("org_unit", "ambiguous_unit", `Plusieurs unités nommées « ${parsed.org_unit} » — utilisez le code`);
    } else if (!matches[0].is_active) {
      push("org_unit", "inactive_unit", `Unité « ${parsed.org_unit} » inactive`);
    } else {
      parsed.org_unit_id = matches[0].id;
    }
  }
  if (parsed.position) {
    const match = refs.positions.find((x) => ciEq(x.title, parsed.position));
    if (!match) push("position", "unknown_position", `Poste « ${parsed.position} » introuvable au catalogue`);
    else if (!match.is_active) push("position", "inactive_position", `Poste « ${parsed.position} » inactif`);
    else parsed.position = match.title; // canonical casing → applied as job_title
  }
  if (parsed.work_location) {
    const match = refs.locations.find((x) => ciEq(x.name, parsed.work_location));
    if (!match) push("work_location", "unknown_site", `Site de travail « ${parsed.work_location} » introuvable`);
    else if (!match.is_active) push("work_location", "inactive_site", `Site de travail « ${parsed.work_location} » inactif`);
    else parsed.work_location = match.name;
  }
  if (parsed.manager) {
    const m = refs.employees.find(
      (e) => ciEq(e.employee_number, parsed.manager)
        || (e.professional_email !== null && ciEq(e.professional_email, parsed.manager)),
    );
    if (!m) push("manager", "unknown_manager", `Responsable « ${parsed.manager} » introuvable (matricule ou email professionnel d'un employé existant)`);
    else if (m.status === "TERMINATED" || m.status === "ARCHIVED") {
      push("manager", "inactive_manager", `Responsable « ${parsed.manager} » n'est plus en activité`);
    } else {
      parsed.manager_employee_id = m.id;
    }
  }
}

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

  // HR-B3 — template auto-mapping: a file made from the downloaded modèle
  // needs no manual correspondance at all; its French headers ARE the mapping.
  if (batch.import_kind === "EMPLOYEES" && Object.keys(mapping).length === 0 && (rows ?? []).length > 0) {
    mapping = autoMapEmployeeHeaders(Object.keys((rows![0].raw as Record<string, string>) ?? {}));
  }
  const employeeRefs = batch.import_kind === "EMPLOYEES"
    ? await loadEmployeeImportRefs(supabase, admin.tenantId)
    : null;
  const seenEmails = new Map<string, number>();
  const seenNames = new Map<string, number>();

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
    if (batch.import_kind === "EMPLOYEES" && employeeRefs) {
      validateEmployeeRow(parsed, r.source_row_number, employeeRefs, seenEmails, seenNames, problems);
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

// ------------------------------------------------------------ HR-B3 apply ----

/** French reasons for per-row application failures — never a raw code. */
const APPLY_FAIL_FR: Record<string, string> = {
  invalid_input: "Données refusées par le registre",
  duplicate_name: "Homonyme détecté au moment de l'application",
  write_failed: "Échec d'écriture",
  forbidden: "Autorisation insuffisante",
};

/**
 * Apply a READY batch: create the employees, one by one, through the EXACT
 * path an individual registration uses — createEmployee (same matricule
 * engine, same target validation, same duplicate policy, same ledger event,
 * same audit), then the existing lifecycle transition when the row asked for
 * ACTIVE. There is deliberately NO direct insert into `employee` here: this
 * function orchestrates the batch; it creates nothing itself.
 *
 * Concurrency + retry:
 *   * the CAS (READY | APPLIED_WITH_ERRORS → APPLYING) makes a double submit
 *     find the state already taken — refused by state, not by hope;
 *   * every applied row records its employee_id, so a retry after a partial
 *     failure SKIPS what already exists — no duplicates on re-run;
 *   * a batch with any failed row finishes APPLIED_WITH_ERRORS, never a
 *     false "fully successful".
 *
 * `allowDuplicateName` is passed deliberately: validation already refused
 * files colliding with existing non-terminal employees and in-file homonyms,
 * so the interactive warning would only re-block what the visa approved.
 */
export async function applyHrImport(batchId: string): Promise<HrActionResult> {
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
  if (batch.import_kind !== "EMPLOYEES") return { ok: false, error: "wrong_kind" };

  // CAS — only READY (first application) or APPLIED_WITH_ERRORS (retry of the
  // failed remainder) may enter APPLYING; a concurrent apply matches zero rows.
  const { data: taken } = await supabase
    .from("hr_import_batch")
    .update({ status: "APPLYING", applied_by: admin.id, applied_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId)
    .in("status", ["READY", "APPLIED_WITH_ERRORS"])
    .select("id");
  if ((taken?.length ?? 0) !== 1) return { ok: false, error: "wrong_status" };

  const { data: rows } = await supabase
    .from("hr_import_staging_row")
    .select("id, source_row_number, parsed, employee_id")
    .eq("batch_id", batchId)
    .eq("tenant_id", admin.tenantId)
    .eq("status", "VALID")
    .order("source_row_number");

  let applied = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    if (r.employee_id) {
      applied++; // created by a previous run — retry must not duplicate
      continue;
    }
    const p = (r.parsed ?? {}) as Record<string, string>;
    const res = await createEmployee({
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? "",
      department: p.department ?? "",
      professionalEmail: p.professional_email || null,
      professionalPhone: p.professional_phone || null,
      employmentType: p.employment_type || null,
      hireDate: p.hire_date || null,
      jobTitle: p.position || null,
      workLocation: p.work_location || null,
      managerEmployeeId: p.manager_employee_id || null,
      orgUnitId: p.org_unit_id || null,
      allowDuplicateName: true,
    });
    if (!res.ok) {
      failed++;
      const reason = "messages" in res && res.messages?.length
        ? res.messages.join(" ")
        : (APPLY_FAIL_FR[res.error] ?? "Échec");
      await supabase
        .from("hr_import_staging_row")
        .update({ outcome: "FAILED", outcome_reason: reason })
        .eq("id", r.id)
        .eq("tenant_id", admin.tenantId);
      continue;
    }
    applied++;
    let reason: string | null = null;
    if (p.status === "ACTIVE") {
      const tr = await transitionEmployee(res.id!, "ACTIVE");
      if (!tr.ok) reason = "Créé en Brouillon — activation à faire manuellement";
    }
    await supabase
      .from("hr_import_staging_row")
      .update({ outcome: "CREATED", outcome_reason: reason, employee_id: res.id })
      .eq("id", r.id)
      .eq("tenant_id", admin.tenantId);
  }

  const finalStatus = failed > 0 ? "APPLIED_WITH_ERRORS" : "APPLIED";
  await supabase
    .from("hr_import_batch")
    .update({ status: finalStatus, applied_count: applied, failed_count: failed })
    .eq("id", batchId)
    .eq("tenant_id", admin.tenantId);

  await writeAudit({
    action: "hr.import_applied",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "hr_import_batch",
    entityId: batchId,
    after: { status: finalStatus, applied, failed },
  });
  revalidatePath(`${HR_PATH}/imports`);
  revalidatePath(`${HR_PATH}/registre`);
  return { ok: true, id: batchId };
}

