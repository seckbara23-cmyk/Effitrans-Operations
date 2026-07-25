/**
 * Finance Expense Documents — read side (Phase 11.0B). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * Bounded readers over the expense bounded context. Every reader is gated on
 * finance:expense:read, tenant-scoped on the service-role client (RLS does not
 * backstop the service role — the tenant filter is mandatory, enforced by
 * tests/tenant-scope.test.ts), and degrades to null/[] when the migration is
 * absent. NO mutations, NO amounts leaked as UUIDs, NO PDF rendering.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import type { AuthorizationStatus, VoucherStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { userId: string; tenantId: string };

/** Resolve the caller + assert finance:expense:read. Returns null when unauthorized. */
async function readGuard(): Promise<Ctx | null> {
  try {
    const user = await assertPermission("finance:expense:read");
    return { userId: user.id, tenantId: user.tenantId };
  } catch {
    return null;
  }
}

export type ExpenseAuthorizationView = {
  id: string;
  authorizationNumber: string | null;
  status: AuthorizationStatus;
  fileId: string | null;
  beneficiary: string;
  currency: string;
  currentVersionId: string | null;
  createdAt: string;
};

export type ExpenseVoucherView = {
  id: string;
  voucherNumber: string | null;
  authorizationId: string;
  sourceAuthorizationVersion: number;
  status: VoucherStatus;
  beneficiary: string;
  currency: string;
  paymentMethod: string | null;
  currentVersionId: string | null;
  createdAt: string;
};

export type ExpenseVersionView = {
  id: string;
  versionNumber: number;
  contentSha256: string;
  templateCode: string | null;
  templateVersion: number | null;
  createdAt: string;
};

export type ExpenseApprovalAttemptView = {
  id: string;
  documentType: string;
  attemptNumber: number;
  status: string;
  versionId: string;
  openedAt: string;
  closedAt: string | null;
};

export type ExpenseVisaView = {
  id: string;
  stepCode: string;
  stepOrdinal: number;
  decision: string;
  signerDisplayName: string;
  signerRoleCode: string;
  decidedAt: string;
};

/** One authorization, tenant-verified. */
export async function getExpenseAuthorization(id: string): Promise<ExpenseAuthorizationView | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_authorization")
      .select("id, authorization_number, status, file_id, beneficiary, currency, current_version_id, created_at")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return mapAuthorization(data);
  } catch {
    return null; // migration absent
  }
}

/** All authorizations for the tenant, newest first. */
export async function listExpenseAuthorizations(): Promise<ExpenseAuthorizationView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_authorization")
      .select("id, authorization_number, status, file_id, beneficiary, currency, current_version_id, created_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map(mapAuthorization);
  } catch {
    return [];
  }
}

export async function getExpenseVoucher(id: string): Promise<ExpenseVoucherView | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_voucher")
      .select(
        "id, voucher_number, authorization_id, source_authorization_version, status, beneficiary, currency, payment_method, current_version_id, created_at",
      )
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return mapVoucher(data);
  } catch {
    return null;
  }
}

export async function listExpenseVouchers(): Promise<ExpenseVoucherView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_voucher")
      .select(
        "id, voucher_number, authorization_id, source_authorization_version, status, beneficiary, currency, payment_method, current_version_id, created_at",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map(mapVoucher);
  } catch {
    return [];
  }
}

/** Immutable version history of an authorization, oldest first. */
export async function getExpenseAuthorizationVersions(authorizationId: string): Promise<ExpenseVersionView[]> {
  return getVersions("expense_authorization_version", "authorization_id", authorizationId);
}

/** Immutable version history of a voucher, oldest first. */
export async function getExpenseVoucherVersions(voucherId: string): Promise<ExpenseVersionView[]> {
  return getVersions("expense_voucher_version", "voucher_id", voucherId);
}

type VersionRow = {
  id: string;
  version_number: number;
  content_sha256: string;
  template_code: string | null;
  template_version: number | null;
  created_at: string;
};

async function getVersions(table: string, fk: string, docId: string): Promise<ExpenseVersionView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from(table)
      .select("id, version_number, content_sha256, template_code, template_version, created_at")
      .eq(fk, docId)
      .eq("tenant_id", ctx.tenantId)
      .order("version_number", { ascending: true })
      .returns<VersionRow[]>();
    if (error || !data) return [];
    return data.map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      contentSha256: v.content_sha256,
      templateCode: v.template_code,
      templateVersion: v.template_version,
      createdAt: v.created_at,
    }));
  } catch {
    return [];
  }
}

/** Approval attempts for a document (authorization or voucher), oldest first. */
export async function getExpenseApprovalAttempts(
  docType: "EXPENSE_AUTHORIZATION" | "EXPENSE_VOUCHER",
  docId: string,
): Promise<ExpenseApprovalAttemptView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  const fk = docType === "EXPENSE_AUTHORIZATION" ? "authorization_id" : "voucher_id";
  try {
    const { data, error } = await admin
      .from("expense_approval_attempt")
      .select("id, document_type, attempt_number, status, version_id, opened_at, closed_at")
      .eq(fk, docId)
      .eq("tenant_id", ctx.tenantId)
      .order("attempt_number", { ascending: true });
    if (error || !data) return [];
    return data.map((a) => ({
      id: a.id,
      documentType: a.document_type,
      attemptNumber: a.attempt_number,
      status: a.status,
      versionId: a.version_id,
      openedAt: a.opened_at,
      closedAt: a.closed_at,
    }));
  } catch {
    return [];
  }
}

/** Append-only visa history for a document, chain order. Empty in 11.0B. */
export async function getExpenseVisaHistory(
  docType: "EXPENSE_AUTHORIZATION" | "EXPENSE_VOUCHER",
  docId: string,
): Promise<ExpenseVisaView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  const fk = docType === "EXPENSE_AUTHORIZATION" ? "authorization_id" : "voucher_id";
  try {
    const { data, error } = await admin
      .from("expense_visa")
      .select("id, step_code, step_ordinal, decision, signer_display_name, signer_role_code, decided_at")
      .eq(fk, docId)
      .eq("tenant_id", ctx.tenantId)
      .order("decided_at", { ascending: true });
    if (error || !data) return [];
    return data.map((v) => ({
      id: v.id,
      stepCode: v.step_code,
      stepOrdinal: v.step_ordinal,
      decision: v.decision,
      signerDisplayName: v.signer_display_name,
      signerRoleCode: v.signer_role_code,
      decidedAt: v.decided_at,
    }));
  } catch {
    return [];
  }
}

/** Template metadata registered in the global catalog (empty until 11.0C). */
export async function getExpenseTemplateMetadata(): Promise<
  { templateCode: string; version: number; status: string; checksum: string | null; pageCount: number | null }[]
> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_template")
      .select("template_code, version, status, checksum, page_count")
      .order("template_code", { ascending: true });
    if (error || !data) return [];
    return data.map((t) => ({
      templateCode: t.template_code,
      version: t.version,
      status: t.status,
      checksum: t.checksum,
      pageCount: t.page_count,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- mappers ----

function mapAuthorization(d: Record<string, unknown>): ExpenseAuthorizationView {
  return {
    id: d.id as string,
    authorizationNumber: (d.authorization_number as string | null) ?? null,
    status: d.status as AuthorizationStatus,
    fileId: (d.file_id as string | null) ?? null,
    beneficiary: d.beneficiary as string,
    currency: d.currency as string,
    currentVersionId: (d.current_version_id as string | null) ?? null,
    createdAt: d.created_at as string,
  };
}

function mapVoucher(d: Record<string, unknown>): ExpenseVoucherView {
  return {
    id: d.id as string,
    voucherNumber: (d.voucher_number as string | null) ?? null,
    authorizationId: d.authorization_id as string,
    sourceAuthorizationVersion: d.source_authorization_version as number,
    status: d.status as VoucherStatus,
    beneficiary: d.beneficiary as string,
    currency: d.currency as string,
    paymentMethod: (d.payment_method as string | null) ?? null,
    currentVersionId: (d.current_version_id as string | null) ?? null,
    createdAt: d.created_at as string,
  };
}
