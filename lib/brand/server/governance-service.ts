import "server-only";

/**
 * Brand governance reads (DBC-6). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The governance dashboard: the UNIFIED template registry × each template's lifecycle state
 * (brand_template row, defaulting to DRAFT). Tenant-scoped admin read (service role gated by
 * admin:config:manage), bounded, no N+1. Also exposes brand readiness so the UI can show
 * why PUBLISH is blocked.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { readBrandCore } from "./service";
import { documentReadiness } from "@/lib/brand/document/model";
import { UNIFIED_TEMPLATES } from "@/lib/brand/governance/registry";
import type { LifecycleState, TemplateCategory } from "@/lib/brand/governance/lifecycle";

export type GovernanceRow = {
  category: TemplateCategory; key: string; label: string;
  status: LifecycleState; version: number; updatedAt: string | null; updatedBy: string | null;
};

export type GovernanceDashboard = {
  rows: GovernanceRow[];
  readiness: { ready: boolean; missing: string[] };
};

export async function getGovernanceDashboard(): Promise<GovernanceDashboard> {
  const admin = await assertPermission("admin:config:manage");
  const supabase = getAdminSupabaseClient();

  const [{ data: templates }, core] = await Promise.all([
    supabase.from("brand_template").select("category, template_key, lifecycle_status, version, updated_at, updated_by").eq("tenant_id", admin.tenantId),
    readBrandCore(admin.tenantId),
  ]);

  // Resolve updated_by ids → emails in one batched lookup (safe metadata).
  const byId = new Map<string, string>();
  const ids = [...new Set((templates ?? []).map((t) => t.updated_by).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: users } = await supabase.from("app_user").select("id, email").eq("tenant_id", admin.tenantId).in("id", ids);
    for (const u of users ?? []) byId.set(u.id, u.email);
  }

  const stateByKey = new Map((templates ?? []).map((t) => [`${t.category}:${t.template_key}`, t]));
  const rows: GovernanceRow[] = UNIFIED_TEMPLATES.map((t) => {
    const s = stateByKey.get(`${t.category}:${t.key}`);
    return {
      category: t.category, key: t.key, label: t.label,
      status: (s?.lifecycle_status as LifecycleState) ?? "DRAFT",
      version: s?.version ?? 1,
      updatedAt: s?.updated_at ?? null,
      updatedBy: s?.updated_by ? (byId.get(s.updated_by) ?? "administrateur") : null,
    };
  });

  return { rows, readiness: documentReadiness(core.profile) };
}
