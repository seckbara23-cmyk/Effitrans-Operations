import "server-only";

/**
 * EC-3B — Commercial reads. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Composition only. Every previous version of a quotation stays permanently
 * visible (`listVersions`), because a superseded offer is what the customer was
 * shown at the time and a commercial record that forgets that is not a record.
 *
 * Totals are computed at READ time from the lines and never stored: a stored
 * total is a second source of truth that can drift from the lines it came from
 * (the WES-9C reasoning applied to money).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { resolveTimezone } from "@/lib/operations/kpi/windows";
import { quotationTotals, type QuotationTotals } from "./money";
import type { QuotationStatus, RequestStatus, AcceptanceKind } from "./model";

export * from "./model";
export * from "./money";

/**
 * The permissions that may READ commercial data — DEC-C32, and the same pair
 * the SELECT policies name. Exported so the pages, the queues and the tests all
 * read the set from one place instead of three drifting copies.
 */
export const COMMERCIAL_READ_PERMISSIONS = ["quotation:create", "quotation:validate"] as const;

export class CommercialAccessError extends Error {
  constructor(reason: string) {
    super(`[commercial] read refused: ${reason}`);
    this.name = "CommercialAccessError";
  }
}

/**
 * EVERY read below runs on the admin client, which BYPASSES RLS. The policies
 * on `quotation*` are therefore defence in depth for direct PostgREST access —
 * they are NOT what protects these functions. This gate is.
 *
 * It checks two things, because either alone is insufficient:
 *
 *   1. the caller holds `quotation:create` OR `quotation:validate` — a
 *      supervisor who may only validate still has to SEE what they validate,
 *      and DEC-C32 refuses to solve that by granting them `create`;
 *   2. the `tenantId` the caller passed is their OWN. The admin client would
 *      happily read another tenant's rows, and "the id came from a tenant-scoped
 *      row" is exactly the reasoning that produces cross-tenant reads later.
 *
 * Returns the permissions so callers can shape a queue without re-resolving.
 */
export async function assertCommercialRead(tenantId: string): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) throw new CommercialAccessError("not authenticated");
  if (user.tenantId !== tenantId) throw new CommercialAccessError("cross-tenant read");
  const permissions = await getEffectivePermissions(user.id);
  if (!COMMERCIAL_READ_PERMISSIONS.some((c) => hasPermission(permissions, c))) {
    throw new CommercialAccessError("missing quotation:create or quotation:validate");
  }
  return permissions;
}

export type QuotationLine = {
  id: string;
  position: number;
  description: string;
  quantityMilli: number;
  unitAmountMinor: number;
  taxRateBp: number;
};

export type Quotation = {
  id: string;
  requestId: string;
  clientId: string;
  quotationNumber: string | null;
  version: number;
  supersedesId: string | null;
  status: QuotationStatus;
  currency: string;
  terms: string | null;
  validityNote: string | null;
  preparedBy: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  rejectionReasonCode: string | null;
  sentAt: string | null;
  acceptanceKind: AcceptanceKind | null;
  acceptedOn: string | null;
  acceptanceDocumentId: string | null;
  acceptanceMessageId: string | null;
  declinedOn: string | null;
  convertedFileId: string | null;
  convertedAt: string | null;
  cancellationReasonCode: string | null;
  artifactStoragePath: string | null;
  artifactSha256: string | null;
  createdAt: string;
};

export type QuotationRequest = {
  id: string;
  clientId: string;
  clientName: string | null;
  reference: string | null;
  subject: string | null;
  triageItemId: string | null;
  status: RequestStatus;
  createdAt: string;
};

const Q_COLS =
  "id, request_id, client_id, quotation_number, version, supersedes_id, status, currency, terms, validity_note, prepared_by, validated_by, validated_at, rejection_reason_code, sent_at, acceptance_kind, accepted_on, acceptance_document_id, acceptance_message_id, declined_on, converted_file_id, converted_at, cancellation_reason_code, artifact_storage_path, artifact_sha256, created_at";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapQuotation(r: any): Quotation {
  return {
    id: r.id, requestId: r.request_id, clientId: r.client_id,
    quotationNumber: r.quotation_number, version: r.version, supersedesId: r.supersedes_id,
    status: r.status as QuotationStatus, currency: r.currency, terms: r.terms,
    validityNote: r.validity_note, preparedBy: r.prepared_by, validatedBy: r.validated_by,
    validatedAt: r.validated_at, rejectionReasonCode: r.rejection_reason_code,
    sentAt: r.sent_at, acceptanceKind: r.acceptance_kind as AcceptanceKind | null,
    acceptedOn: r.accepted_on, acceptanceDocumentId: r.acceptance_document_id,
    acceptanceMessageId: r.acceptance_message_id, declinedOn: r.declined_on,
    convertedFileId: r.converted_file_id, convertedAt: r.converted_at,
    cancellationReasonCode: r.cancellation_reason_code,
    artifactStoragePath: r.artifact_storage_path, artifactSha256: r.artifact_sha256,
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listRequests(
  tenantId: string, status?: RequestStatus,
): Promise<QuotationRequest[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  let q = s.from("quotation_request")
    .select("id, client_id, reference, subject, triage_item_id, status, created_at, client:client_id(name)")
    .eq("tenant_id", tenantId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(`[commercial] requests read failed: ${error.message}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      id: r.id, clientId: r.client_id, clientName: c?.name ?? null,
      reference: r.reference, subject: r.subject, triageItemId: r.triage_item_id,
      status: r.status as RequestStatus, createdAt: r.created_at,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function getRequest(tenantId: string, requestId: string): Promise<QuotationRequest | null> {
  const all = await listRequests(tenantId);
  return all.find((r) => r.id === requestId) ?? null;
}

/** Every version of a request's quotation, newest first. History is permanent. */
export async function listVersions(tenantId: string, requestId: string): Promise<Quotation[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("quotation").select(Q_COLS)
    .eq("tenant_id", tenantId).eq("request_id", requestId)
    .order("version", { ascending: false });
  if (error) throw new Error(`[commercial] versions read failed: ${error.message}`);
  return (data ?? []).map(mapQuotation);
}

export async function getQuotation(tenantId: string, quotationId: string): Promise<Quotation | null> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("quotation").select(Q_COLS)
    .eq("tenant_id", tenantId).eq("id", quotationId).maybeSingle();
  if (error) throw new Error(`[commercial] quotation read failed: ${error.message}`);
  return data ? mapQuotation(data) : null;
}

export async function listLines(tenantId: string, quotationId: string): Promise<QuotationLine[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("quotation_line")
    .select("id, position, description, quantity_milli, unit_amount_minor, tax_rate_bp")
    .eq("tenant_id", tenantId).eq("quotation_id", quotationId).order("position");
  if (error) throw new Error(`[commercial] lines read failed: ${error.message}`);
  return (data ?? []).map((l) => ({
    id: l.id, position: l.position, description: l.description,
    quantityMilli: l.quantity_milli, unitAmountMinor: l.unit_amount_minor,
    taxRateBp: l.tax_rate_bp,
  }));
}

/** Totals derived at read time. Never stored, never emitted. */
export async function quotationWithTotals(
  tenantId: string, quotationId: string,
): Promise<{ quotation: Quotation; lines: QuotationLine[]; totals: QuotationTotals } | null> {
  const quotation = await getQuotation(tenantId, quotationId);
  if (!quotation) return null;
  const lines = await listLines(tenantId, quotationId);
  return { quotation, lines, totals: quotationTotals(lines) };
}

/* ========================================================================== */
/* EC-3C — workspace reads                                                    */
/* ========================================================================== */

export type QuotationListItem = Quotation & {
  clientName: string | null;
  subject: string | null;
};

/**
 * Every quotation the workspace shows, newest first, enriched with the two
 * labels a queue needs. One query with joins rather than a read-per-row: the
 * queues are partitions of THIS list (lib/commercial/queues.ts), so the page
 * loads the set once and slices it in memory.
 */
export async function listQuotations(
  tenantId: string, statuses?: readonly QuotationStatus[],
): Promise<QuotationListItem[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  let q = s.from("quotation")
    .select(`${Q_COLS}, client:client_id(name), request:request_id(subject)`)
    .eq("tenant_id", tenantId);
  if (statuses && statuses.length > 0) q = q.in("status", statuses as string[]);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(`[commercial] quotations read failed: ${error.message}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    const rq = Array.isArray(r.request) ? r.request[0] : r.request;
    return { ...mapQuotation(r), clientName: c?.name ?? null, subject: rq?.subject ?? null };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Clients for the drafting picker. Tenant-scoped; no cross-tenant client is selectable. */
export async function listCommercialClients(
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("client").select("id, name")
    .eq("tenant_id", tenantId).order("name").limit(500);
  if (error) throw new Error(`[commercial] clients read failed: ${error.message}`);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export type QuotationHandoff = {
  triageItemId: string;
  clientId: string | null;
  clientName: string | null;
  recordedAt: string | null;
  alreadyLinked: boolean;
};

/**
 * EC-2 handoffs — triage items resolved as HANDOFF_TO_QUOTATION.
 *
 * EC-2's contract is that the handoff records INTENT and mints no quotation
 * row, so these are shown as an inbox: an agent opens one DELIBERATELY, which
 * is the only thing that creates a request. Nothing here auto-creates, and
 * EC-2's quarantine semantics are untouched — a quarantined item never carries
 * an outcome, so it can never appear in this list.
 */
export async function listQuotationHandoffs(tenantId: string): Promise<QuotationHandoff[]> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const [{ data, error }, { data: linked }] = await Promise.all([
    s.from("ec_triage_item")
      .select("id, outcome_client_id, outcome_recorded_at, client:outcome_client_id(name)")
      .eq("tenant_id", tenantId).eq("outcome", "HANDOFF_TO_QUOTATION")
      .order("outcome_recorded_at", { ascending: false }).limit(100),
    s.from("quotation_request").select("triage_item_id")
      .eq("tenant_id", tenantId).not("triage_item_id", "is", null),
  ]);
  if (error) throw new Error(`[commercial] handoffs read failed: ${error.message}`);
  const used = new Set((linked ?? []).map((r) => r.triage_item_id as string));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      triageItemId: r.id, clientId: r.outcome_client_id ?? null,
      clientName: c?.name ?? null, recordedAt: r.outcome_recorded_at ?? null,
      alreadyLinked: used.has(r.id),
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * The tenant's timezone, for tenant-local day boundaries in the metrics.
 * Gated like every other read here: the admin client bypasses RLS.
 */
export async function commercialTimezone(tenantId: string): Promise<string> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const { data } = await s.from("organization").select("timezone").eq("id", tenantId).maybeSingle();
  return resolveTimezone((data as { timezone?: string | null } | null)?.timezone ?? null);
}

export type CommercialCounts = {
  openRequests: number;
  pendingValidation: number;
  awaitingCustomer: number;
  acceptedNotConverted: number;
};

/** Live counters for the workspace. No scheduler; computed on load. */
export async function commercialCounts(tenantId: string): Promise<CommercialCounts> {
  await assertCommercialRead(tenantId);
  const s = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const [open, pending, sent, accepted] = await Promise.all([
    s.from("quotation_request").select("id", head).eq("tenant_id", tenantId).eq("status", "OPEN"),
    s.from("quotation").select("id", head).eq("tenant_id", tenantId).eq("status", "PENDING_VALIDATION"),
    s.from("quotation").select("id", head).eq("tenant_id", tenantId).eq("status", "SENT"),
    s.from("quotation").select("id", head).eq("tenant_id", tenantId).eq("status", "ACCEPTED"),
  ]);
  return {
    openRequests: open.count ?? 0,
    pendingValidation: pending.count ?? 0,
    awaitingCustomer: sent.count ?? 0,
    acceptedNotConverted: accepted.count ?? 0,
  };
}
