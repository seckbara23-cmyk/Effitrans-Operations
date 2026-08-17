import "server-only";

/**
 * HR-4/HR-8 — checklist TEMPLATE reads for the configuration center.
 * ---------------------------------------------------------------------------
 * The template engine shipped with HR-4 (migration 76) and gained its
 * ONBOARDING/OFFBOARDING discriminator with HR-8A (migration 111). Both
 * consumers read it; until now NOTHING wrote it — the tables had no authoring
 * surface at all, which is what this module and its actions close.
 *
 * These reads deliberately include INACTIVE templates: the configuration
 * center manages the vocabulary, so it must see what it can reactivate. The
 * workspace pickers keep their own is_active + kind filters.
 *
 * The pure vocabulary lives in ./checklists/model.ts — the client panel cannot
 * import a server-only module (the payroll/model.ts idiom).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ChecklistTemplate, ChecklistItemTemplate } from "./checklists/model";

export {
  CHECKLIST_KINDS, CHECKLIST_KIND_LABEL_FR, isChecklistKind,
} from "./checklists/model";
export type { ChecklistKind, ChecklistTemplate, ChecklistItemTemplate } from "./checklists/model";

/** Every template of the tenant, both kinds, active and inactive. */
export async function listAllChecklistTemplates(tenantId: string): Promise<ChecklistTemplate[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_checklist_template").select("*")
    .eq("tenant_id", tenantId).order("kind").order("label_fr");
  if (error) throw new Error(`[hr] checklist templates read failed: ${error.message}`);
  return data ?? [];
}

/** Every item of the tenant's templates, grouped by template, in position order. */
export async function listChecklistItemsByTemplate(
  tenantId: string,
): Promise<Record<string, ChecklistItemTemplate[]>> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_checklist_item_template").select("*")
    .eq("tenant_id", tenantId).order("position");
  if (error) throw new Error(`[hr] checklist items read failed: ${error.message}`);
  const grouped: Record<string, ChecklistItemTemplate[]> = {};
  for (const row of data ?? []) {
    (grouped[row.template_id] ??= []).push(row);
  }
  return grouped;
}
