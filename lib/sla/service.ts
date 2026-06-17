/**
 * SLA reads (Phase 2.3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Derived-only: no new tables, no stored values. getDossierStage powers the
 * dossier SLA panel (gated file:read). getDepartmentSlaSummary powers each
 * department workspace's own SLA summary (gated by that department's read
 * permission), reusing the SLA classifier + the scoped queue reads — no
 * duplicate lifecycle logic.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { resolveFileScope } from "@/lib/authz/visibility";
import type { Department } from "@/lib/files/lifecycle";
import { stageDuration, type StageDuration } from "./stage-duration";
import { classifySla, toSlaDept, type SlaStatus } from "./classify";
import { SLA_THRESHOLDS, type SlaThreshold, type SlaDept } from "./config";
import { slaSummary, type SlaCounts } from "./aggregate";
import { getDocumentationQueue } from "@/lib/departments/service";

export type DossierSla = { stage: StageDuration; status: SlaStatus; threshold: SlaThreshold };

/** SLA for a single dossier (its current lifecycle department + time in stage). */
export async function getDossierStage(
  fileId: string,
  currentDepartment: Department | null,
  currentStage: string | null,
): Promise<DossierSla | null> {
  const user = await assertPermission("file:read");
  const supabase = getAdminSupabaseClient();
  const now = new Date();

  const { data: file } = await supabase
    .from("operational_file")
    .select("created_at, opened_at, updated_at")
    .eq("id", fileId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ created_at: string; opened_at: string | null; updated_at: string }>();
  if (!file) return null;

  const [cust, tr, inv] = await Promise.all([
    supabase.from("customs_record").select("updated_at").eq("tenant_id", user.tenantId).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ updated_at: string }>(),
    supabase.from("transport_record").select("updated_at").eq("tenant_id", user.tenantId).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ updated_at: string }>(),
    supabase.from("invoice").select("updated_at").eq("tenant_id", user.tenantId).eq("file_id", fileId).order("updated_at", { ascending: false }).limit(1).maybeSingle<{ updated_at: string }>(),
  ]);

  const sd = stageDuration({
    now,
    currentDepartment,
    currentStage,
    fileCreatedAt: file.created_at,
    fileOpenedAt: file.opened_at,
    fileUpdatedAt: file.updated_at,
    customsUpdatedAt: cust.data?.updated_at ?? null,
    transportUpdatedAt: tr.data?.updated_at ?? null,
    invoiceUpdatedAt: inv.data?.updated_at ?? null,
  });
  const dept = toSlaDept(currentDepartment);
  return { stage: sd, status: classifySla(currentDepartment, sd.ageHours), threshold: dept ? SLA_THRESHOLDS[dept] : null };
}

const PERM: Record<SlaDept, string> = {
  documentation: "document:read",
  customs: "customs:read",
  transport: "transport:read",
  finance: "finance:read",
  archive: "analytics:read",
};

/** A department workspace's own SLA summary (within / warning / critical). */
export async function getDepartmentSlaSummary(dept: Exclude<SlaDept, "archive">): Promise<SlaCounts> {
  const user = await assertPermission(PERM[dept]);
  const supabase = getAdminSupabaseClient();
  const now = new Date();
  const ageHours = (ts: string | null) => (ts ? Math.max(0, (now.getTime() - new Date(ts).getTime()) / 3_600_000) : 0);

  if (dept === "documentation") {
    const rows = await getDocumentationQueue();
    return slaSummary(
      rows
        .filter((r) => r.missing > 0 || r.pending > 0)
        .map((r) => ({ sla: classifySla("documentation", ageHours(r.openedAt)) })),
    );
  }

  if (dept === "customs") {
    const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
    if (!scope.all && scope.ids.length === 0) return slaSummary([]);
    let q = supabase.from("customs_record").select("status, updated_at").eq("tenant_id", user.tenantId).is("deleted_at", null);
    if (!scope.all) q = q.in("file_id", scope.ids);
    const { data } = await q.returns<{ status: string; updated_at: string }[]>();
    return slaSummary(
      (data ?? [])
        .filter((r) => r.status !== "RELEASED" && r.status !== "CANCELLED")
        .map((r) => ({ sla: classifySla("customs", ageHours(r.updated_at)) })),
    );
  }

  if (dept === "transport") {
    const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
    if (!scope.all && scope.ids.length === 0) return slaSummary([]);
    let q = supabase.from("transport_record").select("status, updated_at").eq("tenant_id", user.tenantId).is("deleted_at", null);
    if (!scope.all) q = q.in("file_id", scope.ids);
    const { data } = await q.returns<{ status: string; updated_at: string }[]>();
    return slaSummary(
      (data ?? [])
        .filter((r) => r.status !== "POD_RECEIVED" && r.status !== "CANCELLED")
        .map((r) => ({ sla: classifySla("transport", ageHours(r.updated_at)) })),
    );
  }

  // finance (finance-role based; no file scope)
  const { data } = await supabase
    .from("invoice")
    .select("status, updated_at")
    .eq("tenant_id", user.tenantId)
    .returns<{ status: string; updated_at: string }[]>();
  return slaSummary(
    (data ?? [])
      .filter((r) => r.status === "ISSUED" || r.status === "PARTIALLY_PAID")
      .map((r) => ({ sla: classifySla("finance", ageHours(r.updated_at)) })),
  );
}
