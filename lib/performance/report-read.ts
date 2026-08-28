/**
 * Reading performance reports.
 *
 * The admin client bypasses RLS, so every query here rebuilds the tenant filter
 * the policy would have applied — a missing `.eq("tenant_id", …)` would be a
 * cross-tenant leak no database policy is positioned to catch.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ReportSnapshot, ReportStatus } from "./report";

export type ReportListItem = {
  id: string;
  title: string;
  periodLabel: string;
  status: ReportStatus;
  createdAt: string;
  publishedAt: string | null;
};

export type ReportDetail = ReportListItem & {
  periodKind: string;
  periodStart: string;
  periodEnd: string;
  executiveSummary: string | null;
  managementCommentary: string | null;
  /** Present only once published — a draft has no frozen facts by design. */
  snapshot: ReportSnapshot | null;
  parameterSetVersion: string | null;
  engineVersion: string | null;
  artifactStoragePath: string | null;
  artifactSha256: string | null;
  createdByEmail: string | null;
  publishedByEmail: string | null;
};

const COLS =
  "id, title, period_kind, period_start, period_end, period_label, status, executive_summary, management_commentary, snapshot, parameter_set_version, engine_version, artifact_storage_path, artifact_sha256, created_by, created_at, published_by, published_at";

export async function listReports(tenantId: string, limit = 20): Promise<ReportListItem[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("performance_report")
    .select("id, title, period_label, status, created_at, published_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    periodLabel: r.period_label as string,
    status: r.status as ReportStatus,
    createdAt: r.created_at as string,
    publishedAt: (r.published_at as string | null) ?? null,
  }));
}

export async function getReport(tenantId: string, id: string): Promise<ReportDetail | null> {
  const admin = getAdminSupabaseClient();
  const { data: r } = await admin
    .from("performance_report")
    .select(COLS)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!r) return null;

  const userIds = [r.created_by as string, r.published_by as string | null].filter(
    (v): v is string => !!v,
  );
  const { data: users } = await admin
    .from("app_user")
    .select("id, email")
    .eq("tenant_id", tenantId)
    .in("id", userIds);
  const emailOf = new Map((users ?? []).map((u) => [u.id as string, u.email as string | null]));

  return {
    id: r.id as string,
    title: r.title as string,
    periodKind: r.period_kind as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    periodLabel: r.period_label as string,
    status: r.status as ReportStatus,
    executiveSummary: (r.executive_summary as string | null) ?? null,
    managementCommentary: (r.management_commentary as string | null) ?? null,
    snapshot: (r.snapshot as ReportSnapshot | null) ?? null,
    parameterSetVersion: (r.parameter_set_version as string | null) ?? null,
    engineVersion: (r.engine_version as string | null) ?? null,
    artifactStoragePath: (r.artifact_storage_path as string | null) ?? null,
    artifactSha256: (r.artifact_sha256 as string | null) ?? null,
    createdAt: r.created_at as string,
    publishedAt: (r.published_at as string | null) ?? null,
    createdByEmail: emailOf.get(r.created_by as string) ?? null,
    publishedByEmail: r.published_by ? emailOf.get(r.published_by as string) ?? null : null,
  };
}
