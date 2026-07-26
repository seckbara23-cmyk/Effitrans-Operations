"use server";
/**
 * Finance Expense Documents — server actions (Phase 11.0B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The FOUNDATION write path for the two documents: create draft → submit →
 * create new (immutable) version → open approval attempt, plus the 1:1 voucher
 * creation seam. Every lifecycle DECISION is delegated to ./types (pure); every
 * mutation is permission-gated, tenant-scoped, compare-and-set guarded, and
 * audited with SAFE metadata only (ids/type/status/version — never amounts,
 * beneficiary, account/registration values, or PDF content).
 *
 * DELIBERATELY ABSENT (later phases): approvals, signatures/visas (11.0C/D),
 * payment execution (11.0E), treasury (11.0F), PDF rendering. No expense_visa
 * row is ever written here. A voucher may be created ONLY from an APPROVED
 * authorization (DEC-C06) and there is AT MOST ONE per authorization (DEC-C07,
 * the authorization_id UNIQUE backstop).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { expenseContentSha256 } from "./hash";
import { amountInWordsFr } from "./amount-in-words";
import { activeTemplateVersion } from "./templates";
import {
  canTransitionAuthorization,
  canTransitionVoucher,
  AUTHORIZATION_EDITABLE_STATUSES,
  VOUCHER_EDITABLE_STATUSES,
  isExpensePaymentMethod,
  type AuthorizationStatus,
  type VoucherStatus,
} from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { userId: string; tenantId: string };

export type ExpenseActionError =
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "invalid_state"
  | "already_exists"
  | "not_approved"
  /** A « N° dossier » was typed that no dossier in this tenant carries. */
  | "unknown_file";

export type ExpenseActionResult<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: ExpenseActionError };

const fail = (error: ExpenseActionError): ExpenseActionResult => ({ ok: false, error });
const isErr = (v: Ctx | ExpenseActionError): v is ExpenseActionError => typeof v === "string";

async function guard(permission: string): Promise<Ctx | ExpenseActionError> {
  try {
    const user = await assertPermission(permission);
    return { userId: user.id, tenantId: user.tenantId };
  } catch {
    return "forbidden";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Resolve the typed « N° dossier » into a tenant-scoped file_id, returning the
 * input with `fileId` set. Undefined `fileNumber` leaves the link untouched; ""
 * clears it (DEC-C15 general administrative expense); an unknown number fails
 * loudly so an operator is never told a dossier was linked when it was not.
 */
async function resolveFileLink<T extends Partial<AuthorizationDraftInput>>(
  admin: Admin,
  tenantId: string,
  input: T,
): Promise<T | "unknown_file"> {
  if (input.fileNumber === undefined) return input;
  const wanted = input.fileNumber.trim();
  if (wanted === "") return { ...input, fileId: null };

  const { data } = await admin
    .from("operational_file")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("file_number", wanted)
    .maybeSingle();
  if (!data) return "unknown_file";
  return { ...input, fileId: data.id };
}

// ===================================================== authorization: create ==

/**
 * The user-entered fields of the Autorisation. `amountInWords` is deliberately
 * ABSENT: « Montant en lettres » is a DERIVED field (11.0A §11, classification
 * D) — the platform spells it from (amount, currency) via ./amount-in-words, so
 * the printed words can never disagree with the printed figures.
 */
export type AuthorizationDraftInput = {
  amount: number;
  currency?: string;
  beneficiary: string;
  reason: string;
  accountNumber?: string;
  registrationNumber?: string;
  expenseType?: string;
  weightKg?: number | null;
  /** Resolved dossier link. `null` clears it (a general administrative expense). */
  fileId?: string | null;
  /**
   * The HUMAN dossier key the form collects — « N° dossier », exactly as it is
   * written on paper. Resolved to `fileId` server-side against this tenant's
   * dossiers; "" clears the link, and an unknown number is rejected rather than
   * silently dropped.
   */
  fileNumber?: string;
  financeRequestId?: string;
};

/** Create a DRAFT authorization (no number, no version — DEC-C14). */
export async function createExpenseAuthorizationDraft(
  input: AuthorizationDraftInput,
): Promise<ExpenseActionResult> {
  const ctx = await guard("finance:expense:create");
  if (isErr(ctx)) return fail(ctx);
  if (!positive(input.amount)) return fail("invalid_input");
  if (!nonEmpty(input.beneficiary) || !nonEmpty(input.reason)) return fail("invalid_input");
  if (input.weightKg != null && (!Number.isFinite(input.weightKg) || input.weightKg < 0)) return fail("invalid_input");

  const admin = getAdminSupabaseClient();
  const linked = await resolveFileLink(admin, ctx.tenantId, input);
  if (linked === "unknown_file") return fail("unknown_file");

  const currency = input.currency?.trim() || "XOF";
  const { data, error } = await admin
    .from("expense_authorization")
    .insert({
      tenant_id: ctx.tenantId,
      file_id: linked.fileId ?? null,
      finance_request_id: input.financeRequestId ?? null,
      account_number: input.accountNumber?.trim() || null,
      registration_number: input.registrationNumber?.trim() || null,
      expense_type: input.expenseType?.trim() || null,
      weight_kg: input.weightKg ?? null,
      amount: input.amount,
      currency,
      amount_in_words: amountInWordsFr(input.amount, currency) || null,
      beneficiary: input.beneficiary.trim(),
      reason: input.reason.trim(),
      status: "DRAFT",
      requested_by: ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return fail("invalid_input");

  await writeAudit({
    action: AuditActions.EXPENSE_AUTHORIZATION_CREATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: data.id,
    after: { status: "DRAFT", has_file: Boolean(linked.fileId) },
  });
  return { ok: true, id: data.id };
}

export type SaveAuthorizationResult = { id: string; versioned: boolean; versionNumber: number | null };

/**
 * Save an edit to an editable authorization (Phase 11.0C) — the ONE entry point
 * the draft form calls, so the versioning rule lives here and not in the UI:
 *
 *   * BEFORE the first submission (no frozen version yet) the working head is
 *     updated IN PLACE. A draft carries no number and no version — the invoice
 *     precedent this bounded context follows (DEC-C14): nothing is frozen until
 *     the document is issued, so an author's typing does not mint history.
 *   * ONCE a version exists (i.e. after submission — the RETURNED correction
 *     path) every material edit is routed to createExpenseAuthorizationVersion,
 *     which freezes a NEW immutable version and supersedes any open approval
 *     attempt (DEC-C13). History is never bypassed and never overwritten.
 *
 * Delegating rather than duplicating keeps a single freeze implementation.
 */
export async function saveExpenseAuthorization(
  id: string,
  input: Partial<AuthorizationDraftInput>,
): Promise<ExpenseActionResult<SaveAuthorizationResult>> {
  const ctx = await guard("finance:expense:create");
  if (isErr(ctx)) return fail(ctx) as ExpenseActionResult<SaveAuthorizationResult>;
  const admin = getAdminSupabaseClient();

  const row = await loadAuthorization(admin, ctx.tenantId, id);
  if (!row) return fail("not_found") as ExpenseActionResult<SaveAuthorizationResult>;
  if (!AUTHORIZATION_EDITABLE_STATUSES.includes(row.status as AuthorizationStatus)) {
    return fail("invalid_state") as ExpenseActionResult<SaveAuthorizationResult>;
  }

  // A frozen version exists ⇒ this is a correction, which must version.
  if (row.current_version_id) {
    const versioned = await createExpenseAuthorizationVersion(id, input);
    if (!versioned.ok) return versioned as ExpenseActionResult<SaveAuthorizationResult>;
    return { ok: true, id, versioned: true, versionNumber: versioned.versionNumber };
  }

  const linked = await resolveFileLink(admin, ctx.tenantId, input);
  if (linked === "unknown_file") return fail("unknown_file") as ExpenseActionResult<SaveAuthorizationResult>;

  const patched = applyAuthorizationPatch(row, linked);
  if (!positive(patched.amount) || !nonEmpty(patched.beneficiary) || !nonEmpty(patched.reason)) {
    return fail("invalid_input") as ExpenseActionResult<SaveAuthorizationResult>;
  }
  if (patched.weight_kg != null && (!Number.isFinite(patched.weight_kg) || patched.weight_kg < 0)) {
    return fail("invalid_input") as ExpenseActionResult<SaveAuthorizationResult>;
  }

  const { data: updated, error } = await admin
    .from("expense_authorization")
    .update({
      account_number: patched.account_number,
      registration_number: patched.registration_number,
      expense_type: patched.expense_type,
      weight_kg: patched.weight_kg,
      amount: patched.amount,
      currency: patched.currency,
      amount_in_words: patched.amount_in_words,
      beneficiary: patched.beneficiary,
      reason: patched.reason,
      file_id: patched.file_id,
      finance_request_id: patched.finance_request_id,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", row.status) // CAS — a concurrent submit matches zero rows
    .select("id");
  if (error || !updated || updated.length === 0) {
    return fail("invalid_state") as ExpenseActionResult<SaveAuthorizationResult>;
  }

  await writeAudit({
    action: AuditActions.EXPENSE_AUTHORIZATION_UPDATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: id,
    before: { status: row.status },
    after: { status: row.status, versioned: false },
  });
  return { ok: true, id, versioned: false, versionNumber: null };
}

/**
 * Submit a DRAFT/RETURNED authorization: mint the number (once), freeze the
 * first immutable version if none exists, CAS → SUBMITTED. Mirrors invoice
 * number-at-issuance + freeze-on-submit.
 */
export async function submitExpenseAuthorization(id: string): Promise<ExpenseActionResult> {
  const ctx = await guard("finance:expense:submit");
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const row = await loadAuthorization(admin, ctx.tenantId, id);
  if (!row) return fail("not_found");
  if (!canTransitionAuthorization(row.status as AuthorizationStatus, "SUBMITTED")) return fail("invalid_state");

  // Mint the number once (at first submission), via the atomic per-tenant RPC.
  let authorizationNumber = row.authorization_number as string | null;
  if (!authorizationNumber) {
    const { data: minted, error: rpcErr } = await admin.rpc("next_expense_authorization_number", {
      p_tenant: ctx.tenantId,
    });
    if (rpcErr || !minted) return fail("invalid_state");
    authorizationNumber = minted as string;
  }

  // Freeze the first version if the document has none yet.
  let currentVersionId = row.current_version_id as string | null;
  if (!currentVersionId) {
    const frozen = await freezeAuthorizationVersion(admin, ctx, row, 1);
    if (!frozen) return fail("invalid_state");
    currentVersionId = frozen;
  }

  const { data: updated, error } = await admin
    .from("expense_authorization")
    .update({ status: "SUBMITTED", authorization_number: authorizationNumber, current_version_id: currentVersionId })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", row.status) // CAS — a concurrent transition matches zero rows
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.EXPENSE_AUTHORIZATION_SUBMITTED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: id,
    before: { status: row.status },
    after: { status: "SUBMITTED", number_prefix: "EFT-AUT" },
  });
  return { ok: true, id };
}

/**
 * Material edit → a NEW immutable version (DEC-C13). Allowed only while the head
 * is editable (DRAFT/RETURNED). Freezes the next version, updates the head
 * fields + current_version_id, and — when an approval attempt was open —
 * supersedes it and opens a fresh one bound to the new version (attempt ≠
 * version). Prior versions are never mutated.
 */
export async function createExpenseAuthorizationVersion(
  id: string,
  input: Partial<AuthorizationDraftInput>,
): Promise<ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>> {
  const ctx = await guard("finance:expense:create");
  if (isErr(ctx)) return fail(ctx) as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  const admin = getAdminSupabaseClient();

  const row = await loadAuthorization(admin, ctx.tenantId, id);
  if (!row) return fail("not_found") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  if (!AUTHORIZATION_EDITABLE_STATUSES.includes(row.status as AuthorizationStatus)) {
    return fail("invalid_state") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  const linked = await resolveFileLink(admin, ctx.tenantId, input);
  if (linked === "unknown_file") {
    return fail("unknown_file") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  // Apply the edit to the working head first.
  const patched = applyAuthorizationPatch(row, linked);
  if (!positive(patched.amount) || !nonEmpty(patched.beneficiary) || !nonEmpty(patched.reason)) {
    return fail("invalid_input") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  const nextNumber = await nextVersionNumber(admin, "expense_authorization_version", "authorization_id", id, ctx.tenantId);
  const versionId = await freezeAuthorizationVersion(admin, ctx, patched, nextNumber);
  if (!versionId) {
    return fail("invalid_state") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  await admin
    .from("expense_authorization")
    .update({
      account_number: patched.account_number,
      registration_number: patched.registration_number,
      expense_type: patched.expense_type,
      weight_kg: patched.weight_kg,
      amount: patched.amount,
      currency: patched.currency,
      amount_in_words: patched.amount_in_words,
      beneficiary: patched.beneficiary,
      reason: patched.reason,
      file_id: patched.file_id,
      finance_request_id: patched.finance_request_id,
      current_version_id: versionId,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);

  // A material edit invalidates any open attempt; open a fresh one on the new version.
  await supersedeAndReopenAttempt(admin, ctx, "EXPENSE_AUTHORIZATION", { authorizationId: id }, versionId);

  await writeAudit({
    action: AuditActions.EXPENSE_AUTHORIZATION_VERSION_CREATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: id,
    after: { version_number: nextNumber },
  });
  return { ok: true, id, versionId, versionNumber: nextNumber };
}

/**
 * Open an approval attempt: SUBMITTED → IN_APPROVAL, creating the attempt row
 * bound to the current version. NO visa is written (approvals are 11.0C/D).
 */
export async function openExpenseApprovalAttempt(id: string): Promise<ExpenseActionResult> {
  const ctx = await guard("finance:expense:submit");
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const row = await loadAuthorization(admin, ctx.tenantId, id);
  if (!row) return fail("not_found");
  if (!canTransitionAuthorization(row.status as AuthorizationStatus, "IN_APPROVAL")) return fail("invalid_state");
  const versionId = row.current_version_id as string | null;
  if (!versionId) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("expense_authorization")
    .update({ status: "IN_APPROVAL" })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "SUBMITTED") // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  const attemptNumber = await nextVersionNumber(admin, "expense_approval_attempt", "authorization_id", id, ctx.tenantId, "attempt_number");
  await admin.from("expense_approval_attempt").insert({
    tenant_id: ctx.tenantId,
    document_type: "EXPENSE_AUTHORIZATION",
    authorization_id: id,
    version_id: versionId,
    attempt_number: attemptNumber,
    status: "IN_PROGRESS",
    opened_by: ctx.userId,
  });

  await writeAudit({
    action: AuditActions.EXPENSE_APPROVAL_ATTEMPT_OPENED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: id,
    after: { attempt_number: attemptNumber, document_type: "EXPENSE_AUTHORIZATION" },
  });
  return { ok: true, id };
}

// =========================================================== voucher: create ==

/**
 * Create the ONE voucher for an APPROVED authorization (DEC-C06/C07). CAS on the
 * authorization's APPROVED status; the authorization_id UNIQUE constraint is the
 * hard 1:1 backstop (a second attempt returns already_exists). Fields are
 * snapshot-copied from the authorization's current version, with the source
 * version number recorded as provenance. In 11.0B no authorization can reach
 * APPROVED, so this is a foundation seam consumed by 11.0D.
 */
export async function createExpenseVoucherFromAuthorization(authorizationId: string): Promise<ExpenseActionResult> {
  const ctx = await guard("finance:expense:create");
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const auth = await loadAuthorization(admin, ctx.tenantId, authorizationId);
  if (!auth) return fail("not_found");
  if (auth.status !== "APPROVED") return fail("not_approved"); // DEC-C06 gate
  if (!auth.current_version_id) return fail("invalid_state");

  // Existing voucher? The UNIQUE constraint is the backstop; check first for a
  // clean error.
  const { data: existing } = await admin
    .from("expense_voucher")
    .select("id")
    .eq("authorization_id", authorizationId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (existing) return fail("already_exists");

  const version = await loadAuthorizationVersion(admin, ctx.tenantId, auth.current_version_id as string);
  if (!version) return fail("invalid_state");

  const { data: created, error } = await admin
    .from("expense_voucher")
    .insert({
      tenant_id: ctx.tenantId,
      authorization_id: authorizationId,
      source_authorization_version: version.version_number,
      account_number: version.account_number,
      registration_number: version.registration_number,
      amount: version.amount,
      currency: version.currency,
      amount_in_words: version.amount_in_words,
      beneficiary: version.beneficiary,
      reason: version.reason,
      status: "DRAFT",
      entered_by: ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !created) return fail("already_exists"); // UNIQUE violation ⇒ 1:1 backstop

  await writeAudit({
    action: AuditActions.EXPENSE_VOUCHER_CREATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_voucher",
    entityId: created.id,
    after: { status: "DRAFT", source_authorization_version: version.version_number },
  });
  return { ok: true, id: created.id };
}

/** Submit a DRAFT/RETURNED voucher: mint number, freeze v1, CAS → IN_SIGNATURE. */
export async function submitExpenseVoucher(id: string): Promise<ExpenseActionResult> {
  const ctx = await guard("finance:expense:submit");
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const row = await loadVoucher(admin, ctx.tenantId, id);
  if (!row) return fail("not_found");
  if (!canTransitionVoucher(row.status as VoucherStatus, "IN_SIGNATURE")) return fail("invalid_state");
  if (row.payment_method != null && !isExpensePaymentMethod(row.payment_method as string)) return fail("invalid_input");

  let voucherNumber = row.voucher_number as string | null;
  if (!voucherNumber) {
    const { data: minted, error: rpcErr } = await admin.rpc("next_expense_voucher_number", { p_tenant: ctx.tenantId });
    if (rpcErr || !minted) return fail("invalid_state");
    voucherNumber = minted as string;
  }

  let currentVersionId = row.current_version_id as string | null;
  if (!currentVersionId) {
    const frozen = await freezeVoucherVersion(admin, ctx, row, 1);
    if (!frozen) return fail("invalid_state");
    currentVersionId = frozen;
  }

  const { data: updated, error } = await admin
    .from("expense_voucher")
    .update({ status: "IN_SIGNATURE", voucher_number: voucherNumber, current_version_id: currentVersionId })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", row.status)
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.EXPENSE_VOUCHER_SUBMITTED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_voucher",
    entityId: id,
    before: { status: row.status },
    after: { status: "IN_SIGNATURE", number_prefix: "EFT-BON" },
  });
  return { ok: true, id };
}

/** Material edit of a voucher → a NEW immutable version (DEC-C13). */
export async function createExpenseVoucherVersion(
  id: string,
  input: { accountNumber?: string; registrationNumber?: string; amount?: number; currency?: string; amountInWords?: string; beneficiary?: string; reason?: string; paymentMethod?: string | null },
): Promise<ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>> {
  const ctx = await guard("finance:expense:create");
  if (isErr(ctx)) return fail(ctx) as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  const admin = getAdminSupabaseClient();

  const row = await loadVoucher(admin, ctx.tenantId, id);
  if (!row) return fail("not_found") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  if (!VOUCHER_EDITABLE_STATUSES.includes(row.status as VoucherStatus)) {
    return fail("invalid_state") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }
  if (input.paymentMethod != null && !isExpensePaymentMethod(input.paymentMethod)) {
    return fail("invalid_input") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  const patched = {
    ...row,
    account_number: input.accountNumber?.trim() ?? row.account_number,
    registration_number: input.registrationNumber?.trim() ?? row.registration_number,
    amount: input.amount ?? row.amount,
    currency: input.currency?.trim() || row.currency,
    amount_in_words: input.amountInWords?.trim() ?? row.amount_in_words,
    beneficiary: input.beneficiary?.trim() || row.beneficiary,
    reason: input.reason?.trim() || row.reason,
    payment_method: input.paymentMethod ?? row.payment_method,
  };
  if (!positive(patched.amount) || !nonEmpty(patched.beneficiary) || !nonEmpty(patched.reason)) {
    return fail("invalid_input") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  const nextNumber = await nextVersionNumber(admin, "expense_voucher_version", "voucher_id", id, ctx.tenantId);
  const versionId = await freezeVoucherVersion(admin, ctx, patched, nextNumber);
  if (!versionId) {
    return fail("invalid_state") as ExpenseActionResult<{ id: string; versionId: string; versionNumber: number }>;
  }

  await admin
    .from("expense_voucher")
    .update({
      account_number: patched.account_number,
      registration_number: patched.registration_number,
      amount: patched.amount,
      currency: patched.currency,
      amount_in_words: patched.amount_in_words,
      beneficiary: patched.beneficiary,
      reason: patched.reason,
      payment_method: patched.payment_method,
      current_version_id: versionId,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);

  await supersedeAndReopenAttempt(admin, ctx, "EXPENSE_VOUCHER", { voucherId: id }, versionId);

  await writeAudit({
    action: AuditActions.EXPENSE_VOUCHER_VERSION_CREATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "expense_voucher",
    entityId: id,
    after: { version_number: nextNumber },
  });
  return { ok: true, id, versionId, versionNumber: nextNumber };
}

// ================================================================ internals ==

async function loadAuthorization(admin: Admin, tenantId: string, id: string) {
  const { data } = await admin
    .from("expense_authorization")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ?? null;
}

async function loadAuthorizationVersion(admin: Admin, tenantId: string, versionId: string) {
  const { data } = await admin
    .from("expense_authorization_version")
    .select("*")
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ?? null;
}

async function loadVoucher(admin: Admin, tenantId: string, id: string) {
  const { data } = await admin
    .from("expense_voucher")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ?? null;
}

type AuthorizationFields = {
  id: string;
  account_number: string | null;
  registration_number: string | null;
  expense_type: string | null;
  weight_kg: number | null;
  amount: number;
  currency: string;
  amount_in_words: string | null;
  beneficiary: string;
  reason: string;
  file_id: string | null;
  finance_request_id: string | null;
};

type VoucherFields = {
  id: string;
  account_number: string | null;
  registration_number: string | null;
  amount: number;
  currency: string;
  amount_in_words: string | null;
  beneficiary: string;
  reason: string;
  payment_method: string | null;
};

function applyAuthorizationPatch(
  row: AuthorizationFields,
  input: Partial<AuthorizationDraftInput>,
): AuthorizationFields {
  const amount = input.amount ?? row.amount;
  const currency = input.currency?.trim() || row.currency;
  return {
    id: row.id,
    account_number: input.accountNumber?.trim() ?? row.account_number,
    registration_number: input.registrationNumber?.trim() ?? row.registration_number,
    expense_type: input.expenseType?.trim() ?? row.expense_type,
    weight_kg: input.weightKg ?? row.weight_kg,
    amount,
    currency,
    // Always re-derived — a changed amount can never leave stale words behind.
    amount_in_words: amountInWordsFr(amount, currency) || null,
    beneficiary: input.beneficiary?.trim() || row.beneficiary,
    reason: input.reason?.trim() || row.reason,
    // `undefined` leaves the link alone; an explicit `null` CLEARS it (a general
    // administrative expense, DEC-C15) — `??` alone could never un-link.
    file_id: input.fileId !== undefined ? input.fileId : row.file_id,
    finance_request_id: input.financeRequestId ?? row.finance_request_id,
  };
}

/** The next version/attempt number for a document (max + 1). */
async function nextVersionNumber(
  admin: Admin,
  table: string,
  fk: string,
  docId: string,
  tenantId: string,
  column: "version_number" | "attempt_number" = "version_number",
): Promise<number> {
  const { data } = await admin
    .from(table)
    .select(column)
    .eq(fk, docId)
    .eq("tenant_id", tenantId)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = (data as Record<string, number> | null)?.[column] ?? 0;
  return current + 1;
}

/** Freeze an immutable authorization version snapshot. Returns the version id. */
async function freezeAuthorizationVersion(
  admin: Admin,
  ctx: Ctx,
  fields: AuthorizationFields,
  versionNumber: number,
): Promise<string | null> {
  const snapshot = {
    account_number: fields.account_number ?? null,
    registration_number: fields.registration_number ?? null,
    expense_type: fields.expense_type ?? null,
    weight_kg: fields.weight_kg ?? null,
    amount: fields.amount,
    currency: fields.currency,
    amount_in_words: fields.amount_in_words ?? null,
    beneficiary: fields.beneficiary,
    reason: fields.reason,
  };
  const content_sha256 = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: versionNumber, snapshot });
  // Template provenance (DEC-C16): record WHICH template version this snapshot
  // was frozen against, so a later re-render is reproducible even after the
  // template is revised. The columns exist since 11.0B.
  const template = activeTemplateVersion("EXPENSE_AUTHORIZATION");
  const { data, error } = await admin
    .from("expense_authorization_version")
    .insert({
      tenant_id: ctx.tenantId,
      authorization_id: fields.id,
      version_number: versionNumber,
      template_code: template ? "EXPENSE_AUTHORIZATION" : null,
      template_version: template?.version ?? null,
      account_number: snapshot.account_number,
      registration_number: snapshot.registration_number,
      expense_type: snapshot.expense_type,
      weight_kg: snapshot.weight_kg,
      amount: snapshot.amount,
      currency: snapshot.currency,
      amount_in_words: snapshot.amount_in_words,
      beneficiary: snapshot.beneficiary,
      reason: snapshot.reason,
      snapshot,
      content_sha256,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id;
}

/** Freeze an immutable voucher version snapshot. Returns the version id. */
async function freezeVoucherVersion(
  admin: Admin,
  ctx: Ctx,
  fields: VoucherFields,
  versionNumber: number,
): Promise<string | null> {
  const snapshot = {
    account_number: fields.account_number ?? null,
    registration_number: fields.registration_number ?? null,
    amount: fields.amount,
    currency: fields.currency,
    amount_in_words: fields.amount_in_words ?? null,
    beneficiary: fields.beneficiary,
    reason: fields.reason,
    payment_method: fields.payment_method ?? null,
  };
  const content_sha256 = expenseContentSha256({ docType: "EXPENSE_VOUCHER", version: versionNumber, snapshot });
  const { data, error } = await admin
    .from("expense_voucher_version")
    .insert({
      tenant_id: ctx.tenantId,
      voucher_id: fields.id,
      version_number: versionNumber,
      account_number: snapshot.account_number,
      registration_number: snapshot.registration_number,
      amount: snapshot.amount,
      currency: snapshot.currency,
      amount_in_words: snapshot.amount_in_words,
      beneficiary: snapshot.beneficiary,
      reason: snapshot.reason,
      payment_method: snapshot.payment_method,
      snapshot,
      content_sha256,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id;
}

/**
 * A material edit supersedes any OPEN approval attempt and opens a fresh one on
 * the new version — attempt ≠ version. No-op when no attempt is open (DRAFT).
 */
async function supersedeAndReopenAttempt(
  admin: Admin,
  ctx: Ctx,
  docType: "EXPENSE_AUTHORIZATION" | "EXPENSE_VOUCHER",
  parent: { authorizationId?: string; voucherId?: string },
  versionId: string,
): Promise<void> {
  const fk = docType === "EXPENSE_AUTHORIZATION" ? "authorization_id" : "voucher_id";
  const docId = parent.authorizationId ?? parent.voucherId!;
  const { data: open } = await admin
    .from("expense_approval_attempt")
    .select("id, attempt_number")
    .eq(fk, docId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "IN_PROGRESS")
    .maybeSingle();
  if (!open) return;

  await admin
    .from("expense_approval_attempt")
    .update({ status: "SUPERSEDED", closed_at: new Date().toISOString() })
    .eq("id", open.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "IN_PROGRESS");

  await admin.from("expense_approval_attempt").insert({
    tenant_id: ctx.tenantId,
    document_type: docType,
    authorization_id: parent.authorizationId ?? null,
    voucher_id: parent.voucherId ?? null,
    version_id: versionId,
    attempt_number: (open.attempt_number as number) + 1,
    status: "IN_PROGRESS",
    opened_by: ctx.userId,
  });
}
