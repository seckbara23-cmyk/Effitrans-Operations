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
  /** Amount + type: the list view's columns (Phase 11.0C, additive). */
  amount: number;
  currency: string;
  expenseType: string | null;
  currentVersionId: string | null;
  createdAt: string;
};

/**
 * Every field the paper form prints, for ONE authorization (Phase 11.0C) — the
 * read model behind the edit form and the PDF renderer. Resolved names (agent,
 * requester) and the dossier number are joined here so neither the form nor the
 * renderer performs lookups of its own.
 */
export type ExpenseAuthorizationDetail = {
  id: string;
  authorizationNumber: string | null;
  status: AuthorizationStatus;
  accountNumber: string | null;
  registrationNumber: string | null;
  expenseType: string | null;
  weightKg: number | null;
  amount: number;
  currency: string;
  amountInWords: string | null;
  beneficiary: string;
  reason: string;
  fileId: string | null;
  fileNumber: string | null;
  financeRequestId: string | null;
  /** « Nom de l'agent » / « Demandé par » — the authenticated requester. */
  requesterName: string | null;
  currentVersionId: string | null;
  /** The ONE voucher, when 11.0D has created it (DEC-C07). */
  voucherId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseAttachmentView = {
  id: string;
  fileName: string;
  kind: string | null;
  mimeType: string | null;
  byteSize: number | null;
  retiredAt: string | null;
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
      .select(
        "id, authorization_number, status, file_id, beneficiary, amount, currency, expense_type, current_version_id, created_at",
      )
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
      .select(
        "id, authorization_number, status, file_id, beneficiary, amount, currency, expense_type, current_version_id, created_at",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map(mapAuthorization);
  } catch {
    return [];
  }
}

/**
 * The FULL paper-field view of one authorization (Phase 11.0C). Tenant-verified,
 * and every joined lookup (requester name, dossier number, the 1:1 voucher) is
 * tenant-scoped in its own right — a joined row can never come from another
 * tenant even if a parent id were forged.
 */
export async function getExpenseAuthorizationDetail(id: string): Promise<ExpenseAuthorizationDetail | null> {
  const ctx = await readGuard();
  if (!ctx) return null;
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_authorization")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (error || !data) return null;
    const d = data as Record<string, unknown>;

    const [requester, file, voucher] = await Promise.all([
      d.requested_by
        ? admin
            .from("app_user")
            .select("name, email")
            .eq("id", d.requested_by as string)
            .eq("tenant_id", ctx.tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      d.file_id
        ? admin
            .from("operational_file")
            .select("file_number")
            .eq("id", d.file_id as string)
            .eq("tenant_id", ctx.tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("expense_voucher")
        .select("id")
        .eq("authorization_id", id)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle(),
    ]);

    const person = requester.data as { name: string | null; email: string } | null;
    return {
      id: d.id as string,
      authorizationNumber: (d.authorization_number as string | null) ?? null,
      status: d.status as AuthorizationStatus,
      accountNumber: (d.account_number as string | null) ?? null,
      registrationNumber: (d.registration_number as string | null) ?? null,
      expenseType: (d.expense_type as string | null) ?? null,
      weightKg: d.weight_kg == null ? null : Number(d.weight_kg),
      amount: Number(d.amount ?? 0),
      currency: d.currency as string,
      amountInWords: (d.amount_in_words as string | null) ?? null,
      beneficiary: d.beneficiary as string,
      reason: d.reason as string,
      fileId: (d.file_id as string | null) ?? null,
      fileNumber: ((file.data as { file_number: string | null } | null)?.file_number as string | null) ?? null,
      financeRequestId: (d.finance_request_id as string | null) ?? null,
      requesterName: person ? (person.name ?? person.email) : null,
      currentVersionId: (d.current_version_id as string | null) ?? null,
      voucherId: ((voucher.data as { id: string } | null)?.id as string | null) ?? null,
      createdAt: d.created_at as string,
      updatedAt: d.updated_at as string,
    };
  } catch {
    return null; // migration absent
  }
}

/**
 * Supporting documents of an authorization, oldest first. Retired rows are
 * returned too (archive-not-delete — the caller decides how to show them); the
 * storage path is NEVER exposed, only the identity needed to request a
 * short-TTL signed URL through ./attachments.
 */
export async function listExpenseAttachments(authorizationId: string): Promise<ExpenseAttachmentView[]> {
  const ctx = await readGuard();
  if (!ctx) return [];
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("expense_attachment")
      .select("id, file_name, kind, mime_type, byte_size, retired_at, created_at")
      .eq("authorization_id", authorizationId)
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map((a) => ({
      id: a.id,
      fileName: a.file_name,
      kind: a.kind,
      mimeType: a.mime_type,
      byteSize: a.byte_size == null ? null : Number(a.byte_size),
      retiredAt: a.retired_at,
      createdAt: a.created_at,
    }));
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
    amount: Number(d.amount ?? 0),
    currency: d.currency as string,
    expenseType: (d.expense_type as string | null) ?? null,
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
