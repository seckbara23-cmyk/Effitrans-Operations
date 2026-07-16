/**
 * Customs Intelligence — console reads (Phase 7.1B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client, gated by assertPermission('customs:read') and scoped by
 * dossier visibility (resolveFileScope / isFileVisible) — the SAME tested boundary the
 * existing customs queue uses. Every customs_record read is tenant-filtered. Dashboard
 * aggregates reuse the pure 7.1A contracts over a BOUNDED working set (cap disclosed).
 * Pagination is done in SQL. No provider network call happens on any read path.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible, resolveFileScope } from "@/lib/authz/visibility";
import { buildCustomsDashboard, type CustomsDashboard } from "./dashboard";
import { projectTimeline, type AuditTimelineRow, type TimelineEvent } from "./timeline";
import { rowToDeclaration, rowToView, INTEL_RECORD_COLS, type DeclarationView, type IntelRecordRow } from "./persistence";
import { nextStatuses, type DeclarationStatus } from "./state-machine";
import { resolveProviderConfig, type ProviderConfig } from "./config";
import { CUSTOMS_PROVIDERS } from "./provider";
import type { Declaration } from "./domain";

/** The dashboard working set is bounded; a larger tenant discloses the cap (never truncates silently). */
export const DASHBOARD_WORKING_SET_CAP = 2000;
export const DECLARATION_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const TIMELINE_ACTIVITY_CAP = 1000;

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/** Resolve the caller's file scope once; returns null when they can see nothing. */
async function scopeOrNull(): Promise<{ admin: Admin; tenantId: string; userId: string; all: boolean; ids: string[] } | null> {
  const user = await assertPermission("customs:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return null;
  const ids = scope.all ? [] : scope.ids;
  return { admin: getAdminSupabaseClient(), tenantId: user.tenantId, userId: user.id, all: scope.all, ids };
}

export type CustomsDashboardResult = {
  dashboard: CustomsDashboard;
  providers: ProviderConfig[];
  capped: boolean;
  cap: number;
};

/** Tenant-/visibility-scoped Customs Intelligence dashboard (pure 7.1A contracts). */
export async function getIntelligenceDashboard(): Promise<CustomsDashboardResult> {
  const providers = CUSTOMS_PROVIDERS.map((p) => resolveProviderConfig(p));
  const scope = await scopeOrNull();
  if (!scope) {
    return { dashboard: buildCustomsDashboard([], []), providers, capped: false, cap: DASHBOARD_WORKING_SET_CAP };
  }
  const { admin, tenantId, all, ids } = scope;

  let q = admin
    .from("customs_record")
    .select(INTEL_RECORD_COLS)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (!all) q = q.in("file_id", ids);

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .range(0, DASHBOARD_WORKING_SET_CAP) // cap+1 rows to detect an over-cap tenant
    .returns<IntelRecordRow[]>();
  if (error) throw new Error(`[customs-intel] dashboard read failed: ${error.message}`);

  const rows = data ?? [];
  const capped = rows.length > DASHBOARD_WORKING_SET_CAP;
  const working = capped ? rows.slice(0, DASHBOARD_WORKING_SET_CAP) : rows;
  const decls: Declaration[] = working.map(rowToDeclaration);

  const events = await activityTimeline(admin, tenantId, all, ids, working.map((r) => r.id));
  return { dashboard: buildCustomsDashboard(decls, events), providers, capped, cap: DASHBOARD_WORKING_SET_CAP };
}

/** A bounded projection of recent customs_declaration audit rows → timeline events (for daily activity). */
async function activityTimeline(
  admin: Admin,
  tenantId: string,
  all: boolean,
  scopeIds: string[],
  declIds: string[],
): Promise<TimelineEvent[]> {
  if (!all && declIds.length === 0) return [];
  let q = admin
    .from("audit_log")
    .select("occurred_at, entity_id, after, actor:actor_id(email)")
    .eq("tenant_id", tenantId)
    .eq("entity", "customs_declaration");
  if (!all) q = q.in("entity_id", declIds);
  const { data, error } = await q
    .order("occurred_at", { ascending: false })
    .limit(TIMELINE_ACTIVITY_CAP)
    .returns<{ occurred_at: string; entity_id: string; after: unknown; actor: { email: string | null } | null }[]>();
  if (error) throw new Error(`[customs-intel] activity read failed: ${error.message}`);
  const auditRows: AuditTimelineRow[] = (data ?? []).map((r) => ({
    occurredAt: r.occurred_at,
    actorLabel: r.actor?.email ?? null,
    after: (r.after ?? null) as AuditTimelineRow["after"],
  }));
  return projectTimeline(auditRows);
}

export type DeclarationFilters = {
  search?: string; // matches declaration reference / provider reference
  status?: string; // canonical intel status
  provider?: string;
  office?: string;
  from?: string; // declaration_date >=
  to?: string; // declaration_date <=
};

export type DeclarationListItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  fileType: string | null;
  clientName: string | null;
  reference: string | null;
  provider: string;
  status: DeclarationStatus;
  operationalStatus: string;
  submittedAt: string | null;
  updatedAt: string;
  office: string | null;
  releasedAt: string | null;
};

export type DeclarationListPage = {
  items: DeclarationListItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/** A page of declarations (SQL-paginated, tenant-/visibility-scoped). */
export async function listDeclarations(
  filters: DeclarationFilters = {},
  page = 0,
  pageSize = DECLARATION_PAGE_SIZE,
): Promise<DeclarationListPage> {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const from = Math.max(0, page) * size;
  const scope = await scopeOrNull();
  if (!scope) return { items: [], page: Math.max(0, page), pageSize: size, hasMore: false };
  const { admin, tenantId, all, ids } = scope;

  let q = admin
    .from("customs_record")
    .select(
      "id, file_id, intel_status, provider_code, provider_reference, declaration_number, customs_office, " +
        "status, submitted_at, released_at, updated_at, " +
        "file:file_id(file_number, type, client:client_id(name))",
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (!all) q = q.in("file_id", ids);
  if (filters.status) q = q.eq("intel_status", filters.status);
  if (filters.provider) q = q.eq("provider_code", filters.provider);
  if (filters.office) q = q.eq("customs_office", filters.office);
  if (filters.from) q = q.gte("declaration_date", filters.from);
  if (filters.to) q = q.lte("declaration_date", filters.to);
  if (filters.search && filters.search.trim()) {
    // Sanitize to alphanumerics/space/dash so the value cannot alter the PostgREST filter
    // grammar. PostgREST ilike uses `*` (not `%`) as the wildcard inside an .or() string.
    const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim();
    if (s) q = q.or(`declaration_number.ilike.*${s}*,provider_reference.ilike.*${s}*`);
  }

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + size) // size+1 rows to detect hasMore
    .returns<
      {
        id: string;
        file_id: string;
        intel_status: string;
        provider_code: string;
        provider_reference: string | null;
        declaration_number: string | null;
        customs_office: string | null;
        status: string;
        submitted_at: string | null;
        released_at: string | null;
        updated_at: string;
        file: { file_number: string; type: string; client: { name: string } | null } | null;
      }[]
    >();
  if (error) throw new Error(`[customs-intel] list failed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > size;
  const items: DeclarationListItem[] = rows.slice(0, size).map((r) => ({
    id: r.id,
    fileId: r.file_id,
    fileNumber: r.file?.file_number ?? null,
    fileType: r.file?.type ?? null,
    clientName: r.file?.client?.name ?? null,
    reference: r.declaration_number,
    provider: r.provider_code,
    status: r.intel_status as DeclarationStatus,
    operationalStatus: r.status,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
    office: r.customs_office,
    releasedAt: r.released_at,
  }));
  return { items, page: Math.max(0, page), pageSize: size, hasMore };
}

export type DeclarationDetail = {
  view: DeclarationView;
  timeline: TimelineEvent[];
  fileNumber: string | null;
  clientName: string | null;
  providerConfig: ProviderConfig;
  /** Canonical statuses this declaration may transition to next (for action visibility). */
  nextStatuses: DeclarationStatus[];
};

/** Full declaration detail (visibility-checked). Returns null when not visible / not found. */
export async function getDeclarationDetail(id: string): Promise<DeclarationDetail | null> {
  const user = await assertPermission("customs:read");
  const admin = getAdminSupabaseClient();

  const { data, error } = await admin
    .from("customs_record")
    .select(`${INTEL_RECORD_COLS}, file:file_id(file_number, client:client_id(name))`)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle<IntelRecordRow & { file: { file_number: string; client: { name: string } | null } | null }>();
  if (error) throw new Error(`[customs-intel] detail read failed: ${error.message}`);
  if (!data) return null;
  if (!(await isFileVisible(user.id, user.tenantId, data.file_id))) return null;

  const view = rowToView(data);
  const timeline = await declarationTimeline(admin, user.tenantId, id);
  return {
    view,
    timeline,
    fileNumber: data.file?.file_number ?? null,
    clientName: data.file?.client?.name ?? null,
    providerConfig: resolveProviderConfig(view.declaration.provider.provider),
    nextStatuses: nextStatuses(view.declaration.status),
  };
}

/** Immutable, chronological timeline for one declaration (reused audit rows). */
async function declarationTimeline(admin: Admin, tenantId: string, declarationId: string): Promise<TimelineEvent[]> {
  const { data, error } = await admin
    .from("audit_log")
    .select("occurred_at, after, actor:actor_id(email)")
    .eq("tenant_id", tenantId)
    .eq("entity", "customs_declaration")
    .eq("entity_id", declarationId)
    .order("occurred_at", { ascending: true })
    .limit(500)
    .returns<{ occurred_at: string; after: unknown; actor: { email: string | null } | null }[]>();
  if (error) throw new Error(`[customs-intel] timeline read failed: ${error.message}`);
  const rows: AuditTimelineRow[] = (data ?? []).map((r) => ({
    occurredAt: r.occurred_at,
    actorLabel: r.actor?.email ?? null,
    after: (r.after ?? null) as AuditTimelineRow["after"],
  }));
  return projectTimeline(rows);
}
