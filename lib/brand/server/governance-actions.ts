"use server";

/**
 * Brand governance actions (DBC-6). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Transition a template's lifecycle (DRAFT→APPROVED→PUBLISHED→RETIRED). Gated by
 * admin:config:manage (reused), tenant-scoped. Validates the category/key against the
 * unified registry + the transition against the state machine; PUBLISH additionally requires
 * brand readiness (no publishing incomplete branding). Audits safe metadata only — never
 * generated content.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { documentReadiness } from "@/lib/brand/document/model";
import { findTemplate } from "@/lib/brand/governance/registry";
import { canTransition, isLifecycleState, isPublishable, type LifecycleState } from "@/lib/brand/governance/lifecycle";

export type GovResult = { ok: true } | { ok: false; error: "forbidden" | "invalid" | "bad_transition" | "brand_incomplete"; missing?: string[] };

export async function setTemplateLifecycle(category: string, key: string, to: string): Promise<GovResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }

  if (!findTemplate(category, key) || !isLifecycleState(to)) return { ok: false, error: "invalid" };
  const target = to as LifecycleState;

  const supabase = getAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("brand_template")
    .select("id, lifecycle_status, version")
    .eq("tenant_id", admin.tenantId).eq("category", category).eq("template_key", key)
    .maybeSingle();
  const from: LifecycleState = (existing?.lifecycle_status as LifecycleState) ?? "DRAFT";

  if (from === target || !canTransition(from, target)) return { ok: false, error: "bad_transition" };

  if (isPublishable(target)) {
    const core = await readBrandCore(admin.tenantId);
    const readiness = documentReadiness(core.profile);
    if (!readiness.ready) return { ok: false, error: "brand_incomplete", missing: readiness.missing };
  }

  const isNew = !existing;
  const { error } = await supabase.from("brand_template").upsert(
    {
      tenant_id: admin.tenantId, category, template_key: key,
      lifecycle_status: target, version: (existing?.version ?? 0) + 1, updated_by: admin.id,
    } as never,
    { onConflict: "tenant_id,category,template_key" },
  );
  if (error) return { ok: false, error: "invalid" };

  if (isNew) {
    await writeAudit({ action: AuditActions.BRAND_TEMPLATE_CREATED, actorId: admin.id, tenantId: admin.tenantId, entity: "brand_template", entityId: key, after: { category, key, status: target } });
  }
  await writeAudit({
    action: AuditActions.BRAND_TEMPLATE_LIFECYCLE_CHANGED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "brand_template", entityId: key,
    before: { status: from }, after: { category, key, status: target },
  });
  revalidatePath("/brand-center/governance");
  return { ok: true };
}
