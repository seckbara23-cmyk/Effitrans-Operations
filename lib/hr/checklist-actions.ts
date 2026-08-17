"use server";

/**
 * HR-4/HR-8 — checklist TEMPLATE authoring. Gate: hr:config:manage.
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES (HR-8C UAT finding): the template engine has existed
 * since HR-4 and both workspaces consume it, but no surface ever wrote it —
 * so « Aucun modèle » was permanent and unfixable from inside the platform.
 * These actions are the missing authoring path. They add NO model and NO
 * policy: the same two tables, the same permission, the same audit idiom.
 *
 * WHAT IS DELIBERATELY NOT OFFERED:
 *   * a template's `kind` and `code` are immutable — cases already
 *     instantiated from it were opened under that identity;
 *   * templates are RETIRED by deactivation, never deleted — instantiated
 *     cases keep pointing at them;
 *   * an item already used by a case cannot be deleted (the FK refuses, and
 *     the refusal is translated instead of being swallowed).
 * Item labels are SNAPSHOT at instantiation, so editing a template here never
 * rewrites what a person was actually asked to do (I-8.4).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { isChecklistKind, type ChecklistKind } from "./checklists/model";
import type { Database } from "@/lib/db/types";

type ItemUpdate = Database["public"]["Tables"]["hr_checklist_item_template"]["Update"];

export type ChecklistActionResult = { ok: true; id?: string } | { ok: false; error: string };

const CONFIG_PATHS = ["/departments/hr/configuration", "/departments/hr/onboarding", "/departments/hr/departs"];
function revalidateAll() {
  for (const p of CONFIG_PATHS) revalidatePath(p);
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Create a template of the given kind. Code is the tenant's own short name. */
export async function createChecklistTemplate(input: {
  code: string; labelFr: string; kind: ChecklistKind;
}): Promise<ChecklistActionResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const code = clean(input.code).toUpperCase();
  const labelFr = clean(input.labelFr);
  if (!code) return { ok: false, error: "code_required" };
  if (!labelFr) return { ok: false, error: "label_required" };
  if (!isChecklistKind(input.kind)) return { ok: false, error: "invalid_kind" };

  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_checklist_template")
    .insert({ tenant_id: admin.tenantId, code, label_fr: labelFr, kind: input.kind })
    .select("id").single();
  if (error || !data) {
    return { ok: false, error: error?.code === "23505" ? "already_exists" : "save_failed" };
  }
  await writeAudit({ action: "hr.checklist.template.created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_checklist_template", entityId: data.id, after: { code, kind: input.kind } });
  revalidateAll();
  return { ok: true, id: data.id };
}

/** Rename or retire/restore a template. Kind and code stay immutable. */
export async function updateChecklistTemplate(
  id: string,
  patch: { labelFr?: string; isActive?: boolean },
): Promise<ChecklistActionResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: existing } = await s.from("hr_checklist_template").select("id, label_fr, is_active")
    .eq("tenant_id", admin.tenantId).eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const next: { label_fr?: string; is_active?: boolean } = {};
  if (patch.labelFr !== undefined) {
    const labelFr = clean(patch.labelFr);
    if (!labelFr) return { ok: false, error: "label_required" };
    next.label_fr = labelFr;
  }
  if (patch.isActive !== undefined) next.is_active = patch.isActive;
  if (Object.keys(next).length === 0) return { ok: true, id };

  const { error } = await s.from("hr_checklist_template").update(next)
    .eq("tenant_id", admin.tenantId).eq("id", id);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.checklist.template.updated", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_checklist_template", entityId: id,
    before: { label_fr: existing.label_fr, is_active: existing.is_active }, after: next });
  revalidateAll();
  return { ok: true, id };
}

/** Append a step to a template. Position is assigned, never typed by hand. */
export async function createChecklistItem(input: {
  templateId: string; labelFr: string; responsibleFunction?: string | null;
  isRequired?: boolean; isBlocking?: boolean; evidenceRequired?: boolean; dueOffsetDays?: number;
}): Promise<ChecklistActionResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const labelFr = clean(input.labelFr);
  if (!labelFr) return { ok: false, error: "label_required" };
  const offset = Number.isFinite(input.dueOffsetDays) ? Math.trunc(input.dueOffsetDays as number) : 0;

  const s = getAdminSupabaseClient();
  const { data: template } = await s.from("hr_checklist_template").select("id")
    .eq("tenant_id", admin.tenantId).eq("id", input.templateId).maybeSingle();
  if (!template) return { ok: false, error: "not_found" };

  const { data: last } = await s.from("hr_checklist_item_template").select("position")
    .eq("tenant_id", admin.tenantId).eq("template_id", input.templateId)
    .order("position", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await s.from("hr_checklist_item_template").insert({
    tenant_id: admin.tenantId, template_id: input.templateId,
    position: (last?.position ?? 0) + 1,
    label_fr: labelFr,
    responsible_function: clean(input.responsibleFunction) || null,
    is_required: input.isRequired ?? true,
    is_blocking: input.isBlocking ?? true,
    evidence_required: input.evidenceRequired ?? false,
    due_offset_days: offset,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };

  await writeAudit({ action: "hr.checklist.item.created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_checklist_item_template", entityId: data.id, after: { template_id: input.templateId } });
  revalidateAll();
  return { ok: true, id: data.id };
}

/** Correct a step. Existing cases keep the label they were opened with. */
export async function updateChecklistItem(
  id: string,
  patch: {
    labelFr?: string; responsibleFunction?: string | null;
    isRequired?: boolean; isBlocking?: boolean; evidenceRequired?: boolean; dueOffsetDays?: number;
  },
): Promise<ChecklistActionResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: existing } = await s.from("hr_checklist_item_template").select("id, label_fr")
    .eq("tenant_id", admin.tenantId).eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const next: ItemUpdate = {};
  if (patch.labelFr !== undefined) {
    const labelFr = clean(patch.labelFr);
    if (!labelFr) return { ok: false, error: "label_required" };
    next.label_fr = labelFr;
  }
  if (patch.responsibleFunction !== undefined) next.responsible_function = clean(patch.responsibleFunction) || null;
  if (patch.isRequired !== undefined) next.is_required = patch.isRequired;
  if (patch.isBlocking !== undefined) next.is_blocking = patch.isBlocking;
  if (patch.evidenceRequired !== undefined) next.evidence_required = patch.evidenceRequired;
  if (patch.dueOffsetDays !== undefined && Number.isFinite(patch.dueOffsetDays)) {
    next.due_offset_days = Math.trunc(patch.dueOffsetDays);
  }
  if (Object.keys(next).length === 0) return { ok: true, id };

  const { error } = await s.from("hr_checklist_item_template").update(next)
    .eq("tenant_id", admin.tenantId).eq("id", id);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.checklist.item.updated", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_checklist_item_template", entityId: id, before: { label_fr: existing.label_fr }, after: next });
  revalidateAll();
  return { ok: true, id };
}

/**
 * Remove a step from a template. A step already used by a case is protected by
 * the foreign key — the refusal is surfaced, never worked around.
 */
export async function deleteChecklistItem(id: string): Promise<ChecklistActionResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: existing } = await s.from("hr_checklist_item_template").select("id, label_fr, template_id")
    .eq("tenant_id", admin.tenantId).eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const { error } = await s.from("hr_checklist_item_template").delete()
    .eq("tenant_id", admin.tenantId).eq("id", id);
  if (error) return { ok: false, error: error.code === "23503" ? "item_in_use" : "save_failed" };

  await writeAudit({ action: "hr.checklist.item.deleted", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_checklist_item_template", entityId: id, before: { label_fr: existing.label_fr } });
  revalidateAll();
  return { ok: true, id };
}
