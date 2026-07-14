"use server";
/**
 * Physical invoice deposit — server actions (Phase 5.0D-3). SERVER-ONLY.
 * Official steps 22-25.
 * ---------------------------------------------------------------------------
 * REUSE, NOT REBUILD:
 *   invoice / invoice_deposit    the existing rows (5.0D-1)
 *   document + private bucket    the existing upload/review pipeline — the proof
 *                                is a normal document, reviewed the normal way
 *   process engine               the existing handoffs + steps 23-25
 *   notification                 the existing in-app notification table
 *   audit_log                    the existing governance log
 *   invoice_deposit_event        the immutable CUSTODY chain (5.0D-3)
 *
 * EVERY transition writes a custody event: who, when, from which department, to
 * which, with what evidence, and why. Custody is never inferred from the current
 * status alone, and a custody event is never rewritten (append-only, trigger).
 *
 * Concurrency is COMPARE-AND-SET throughout (`update ... where id = ? and
 * <expected state>`, then check the affected row count) plus the partial unique
 * index on invoice_deposit. Nothing here relies on a disabled button.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFileVisible } from "@/lib/authz/visibility";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import { buildStoragePath, fileExtension, removeObject, uploadObject } from "@/lib/documents/storage";
import { validateDocumentInput } from "@/lib/documents/validate";
import { getProcessFlags } from "@/lib/process/config";
import { sendHandoff, submitStep } from "@/lib/process/engine/actions";
import {
  CUSTODY_ROUTE,
  sanitizeReason,
  validateCustodyEvent,
  type CustodyEvent,
} from "./custody";
import {
  canAccept,
  canStartDeposit,
  canTransitionDeposit,
  evaluateEligibility,
  isAssignedCourier,
  proofComplete,
  reassignmentNeedsReason,
  type AssignmentView,
  type DepositStatus,
} from "./status";

export type DepositError =
  | "feature_disabled"
  | "forbidden"
  | "cross_tenant_forbidden"
  | "not_found"
  | "invoice_not_validated"
  | "invoice_not_issued"
  | "deposit_not_required"
  | "active_deposit_exists"
  | "invalid_state"
  | "not_assigned_courier"
  | "not_accepted"
  | "reason_required"
  | "recipient_required"
  | "proof_required"
  | "self_review_forbidden"
  | "invalid_courier"
  | "upload_failed"
  | "invalid_mime";

export type DepositResult<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: DepositError };

const fail = <T,>(error: DepositError): DepositResult<T> => ({ ok: false, error });

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}/process`);
  revalidatePath("/deposits");
  revalidatePath("/courier");
  revalidatePath("/queues/administration");
  revalidatePath("/queues/courier");
  revalidatePath("/my-work");
}

type Ctx = { userId: string; tenantId: string; roles: string[]; permissions: string[] };

/** The deposit chain requires BOTH the engine flag and the deposit flag. */
async function guard(permission: string, fileId: string): Promise<Ctx | DepositError> {
  const flags = getProcessFlags();
  if (!flags.enabled || !flags.physicalDeposit) return "feature_disabled";

  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "cross_tenant_forbidden";
  return {
    userId: user.id,
    tenantId: user.tenantId,
    roles: user.roles,
    permissions: await getEffectivePermissions(user.id),
  };
}

/**
 * The COURIER guard. A courier has no file:read scope on the dossier (they are a
 * narrow identity), so dossier visibility is NOT the test — ASSIGNMENT is. The
 * courier may act only on a deposit whose courier_user_id is them, which the RLS
 * policy also enforces independently.
 */
async function courierGuard(): Promise<Ctx | DepositError> {
  const flags = getProcessFlags();
  if (!flags.enabled || !flags.physicalDeposit) return "feature_disabled";
  let user;
  try {
    user = await assertPermission("courier:deposit");
  } catch {
    return "forbidden";
  }
  return {
    userId: user.id,
    tenantId: user.tenantId,
    roles: user.roles,
    permissions: await getEffectivePermissions(user.id),
  };
}

const isErr = (v: Ctx | DepositError): v is DepositError => typeof v === "string";

/**
 * Resolve a deposit's dossier — TENANT-SCOPED.
 *
 * The lookup happens inside the CALLER'S tenant, so passing another tenant's
 * depositId simply finds nothing. Reading by primary key alone would leak the
 * dossier id of a foreign deposit before any guard could run.
 */
async function resolveDepositFile(depositId: string): Promise<{ tenantId: string; fileId: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await getAdminSupabaseClient()
    .from("invoice_deposit")
    .select("file_id")
    .eq("id", depositId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const fileId = (data as Row | null)?.file_id as string | undefined;
  return fileId ? { tenantId: user.tenantId, fileId } : null;
}


type DepositRow = {
  id: string;
  fileId: string;
  invoiceId: string;
  status: DepositStatus;
  courierUserId: string | null;
  acceptedAt: string | null;
  recipientName: string | null;
  depositedAt: string | null;
  proofDocumentId: string | null;
};

async function loadDeposit(tenantId: string, depositId: string): Promise<DepositRow | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("invoice_deposit")
    .select("id, file_id, invoice_id, status, courier_user_id, accepted_at, recipient_name, deposited_at, proof_document_id")
    .eq("id", depositId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return {
    id: r.id as string,
    fileId: r.file_id as string,
    invoiceId: r.invoice_id as string,
    status: r.status as DepositStatus,
    courierUserId: str(r.courier_user_id),
    acceptedAt: str(r.accepted_at),
    recipientName: str(r.recipient_name),
    depositedAt: str(r.deposited_at),
    proofDocumentId: str(r.proof_document_id),
  };
}

const assignmentOf = (d: DepositRow): AssignmentView => ({
  status: d.status,
  courierUserId: d.courierUserId,
  acceptedAt: d.acceptedAt,
});

/**
 * Record ONE immutable custody event. Every state change goes through here — a
 * transition without a custody event is not a transition.
 */
async function recordCustody(
  ctx: Ctx,
  d: DepositRow,
  event: CustodyEvent,
  fromStatus: DepositStatus | null,
  toStatus: DepositStatus,
  opts: { reason?: string | null; evidenceDocumentId?: string | null; handoffId?: string | null } = {},
): Promise<{ ok: boolean; error?: DepositError }> {
  const reason = sanitizeReason(opts.reason);
  const check = validateCustodyEvent({
    event,
    fromStatus,
    toStatus,
    actorId: ctx.userId,
    actorRoleCode: ctx.roles[0] ?? null,
    reason,
    evidenceDocumentId: opts.evidenceDocumentId ?? null,
  });
  if (!check.ok) {
    return {
      ok: false,
      error: check.error === "custody_reason_required" ? "reason_required" : "proof_required",
    };
  }

  const route = CUSTODY_ROUTE[event];
  await getAdminSupabaseClient().from("invoice_deposit_event").insert({
    tenant_id: ctx.tenantId,
    file_id: d.fileId,
    invoice_id: d.invoiceId,
    deposit_id: d.id,
    event,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: ctx.userId,
    actor_role_code: ctx.roles[0] ?? null,
    from_department: route.from,
    to_department: route.to,
    handoff_id: opts.handoffId ?? null,
    evidence_document_id: opts.evidenceDocumentId ?? null,
    reason,
  });
  return { ok: true };
}

/** CAS on the deposit. A concurrent writer already moved it => zero rows. */
async function cas(
  tenantId: string,
  depositId: string,
  from: DepositStatus,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data } = await getAdminSupabaseClient()
    .from("invoice_deposit")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as never)
    .eq("id", depositId)
    .eq("tenant_id", tenantId)
    .eq("status", from)
    .select("id");
  return (data?.length ?? 0) === 1;
}

// =========================================================== 22 -> 23 ==========

/**
 * Billing hands the emailed invoice to Administration (official step 22 -> 23).
 *
 * Creates the deposit workflow and sends a controlled handoff. Administration must
 * EXPLICITLY receive it — nothing progresses silently.
 * IDEMPOTENT: a second send returns the existing workflow.
 */
export async function handInvoiceToAdministration(invoiceId: string): Promise<DepositResult> {
  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin
    .from("invoice")
    .select("id, tenant_id, file_id, client_id, status, validated_at")
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = pre as Row | null;
  if (!inv) return fail("not_found");

  const c = await guard("finance:issue", inv.file_id as string);
  if (isErr(c)) return fail(c);
  if (inv.tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  // Explicit client configuration — a deposit is NEVER implicitly required.
  const { data: client } = await admin
    .from("client")
    .select("requires_physical_invoice_deposit")
    .eq("id", (inv.client_id as string) ?? "")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();

  const { data: active } = await admin
    .from("invoice_deposit")
    .select("id")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .neq("status", "CANCELLED")
    .limit(1);
  const existing = ((active ?? []) as Row[])[0];

  const eligibility = evaluateEligibility({
    invoiceStatus: inv.status as string,
    invoiceValidatedAt: str(inv.validated_at),
    clientRequiresDeposit: Boolean((client as Row | null)?.requires_physical_invoice_deposit),
    activeDepositExists: !!existing,
  });

  if (!eligibility.eligible) {
    // Idempotent: the workflow already exists, so return it rather than erroring.
    if (eligibility.error === "active_deposit_exists" && existing) {
      return { ok: true, id: existing.id as string };
    }
    return fail(eligibility.error);
  }

  const { data: created, error } = await admin
    .from("invoice_deposit")
    .insert({
      tenant_id: c.tenantId,
      file_id: inv.file_id as string,
      invoice_id: invoiceId,
      status: "PREPARATION_PENDING",
    })
    .select("id")
    .single();
  if (error || !created) return fail("invalid_state");

  const d = await loadDeposit(c.tenantId, created.id as string);
  if (!d) return fail("not_found");

  await recordCustody(c, d, "WORKFLOW_CREATED", null, "PREPARATION_PENDING");

  // Controlled handoff, through the engine. Administration must receive it.
  const handoff = await sendHandoff(d.fileId, "billing_dispatch", "administration_deposit_prep");
  await recordCustody(c, d, "HANDED_TO_ADMIN", "PREPARATION_PENDING", "PREPARATION_PENDING", {
    handoffId: handoff.ok ? handoff.id : null,
  });

  await writeAudit({
    action: AuditActions.DEPOSIT_PREPARED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: d.id,
    after: { invoice_id: invoiceId, file_id: d.fileId, status: "PREPARATION_PENDING" },
  });

  revalidate(d.fileId);
  return { ok: true, id: d.id };
}

// ================================================================ 23 ===========

/**
 * Administration prepares the package (official step 23). Ready for a courier.
 * The invoice is NOT deposited at preparation time.
 */
export async function preparePackage(
  depositId: string,
  input: { clientLocation?: string; deliveryInstructions?: string; packageReference?: string },
): Promise<DepositResult> {
  const admin = getAdminSupabaseClient();
  const resolved = await resolveDepositFile(depositId);
  if (!resolved) return fail("not_found");
  const fileId = resolved.fileId;

  const c = await guard("admin_service:manage", fileId);
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!canTransitionDeposit(d.status, "READY_FOR_COURIER")) return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, d.status, {
    status: "READY_FOR_COURIER",
    prepared_by: c.userId,
    prepared_at: new Date().toISOString(),
    client_location: input.clientLocation ?? null,
    delivery_instructions: input.deliveryInstructions ?? null,
    package_reference: input.packageReference ?? null,
  });
  if (!ok) return fail("invalid_state");

  await recordCustody(c, d, "PACKAGE_PREPARED", d.status, "READY_FOR_COURIER");
  await writeAudit({
    action: AuditActions.DEPOSIT_PREPARED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    // Identifiers + state only. The client's address/instructions are NOT audited.
    after: { status: "READY_FOR_COURIER", has_instructions: !!input.deliveryInstructions },
  });
  revalidate(fileId);
  return { ok: true, id: depositId };
}

/**
 * Administration assigns a COURIER. The courier must be an ACTIVE, same-tenant
 * user holding the COURIER role — checked here AND by a DB trigger.
 *
 * Reassigning a courier who already ACCEPTED requires a reason: someone had the
 * package and is losing it, and the chain must say why.
 */
export async function assignCourier(
  depositId: string,
  courierUserId: string,
  reason?: string,
): Promise<DepositResult> {
  const admin = getAdminSupabaseClient();
  const resolved = await resolveDepositFile(depositId);
  if (!resolved) return fail("not_found");
  const fileId = resolved.fileId;

  const c = await guard("courier:assign", fileId);
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");

  // The candidate must be an ACTIVE, same-tenant COURIER.
  const { data: cand } = await admin
    .from("app_user")
    .select("id, status, tenant_id, user_role:user_role(role:role_id(code))")
    .eq("id", courierUserId)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const candidate = cand as Row | null;
  if (!candidate || candidate.status !== "active") return fail("invalid_courier");

  const roleRows = (candidate.user_role ?? []) as { role: { code: string } | null }[];
  const isCourier = roleRows.some((r) => r.role?.code === "COURIER");
  if (!isCourier) return fail("invalid_courier");

  const reassigning = d.courierUserId !== null && d.courierUserId !== courierUserId;
  if (reassigning && reassignmentNeedsReason(assignmentOf(d)) && !sanitizeReason(reason)) {
    return fail("reason_required");
  }

  // Only a package that is ready (or already assigned, for reassignment) may move.
  const from = d.status;
  if (from !== "READY_FOR_COURIER" && from !== "ASSIGNED") return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, from, {
    status: "ASSIGNED",
    courier_user_id: courierUserId,
    assigned_at: new Date().toISOString(),
    // Reassignment resets acceptance: the NEW courier must accept for themselves.
    accepted_at: null,
    declined_at: null,
    decline_reason: null,
    reassignment_reason: reassigning ? sanitizeReason(reason) : null,
  });
  if (!ok) return fail("invalid_state");

  const event: CustodyEvent = reassigning ? "COURIER_REASSIGNED" : "COURIER_ASSIGNED";
  const rec = await recordCustody(c, d, event, from, "ASSIGNED", { reason });
  if (!rec.ok) return fail(rec.error!);

  await createNotification({
    tenantId: c.tenantId,
    userId: courierUserId,
    type: "TASK_ASSIGNED",
    fileId: d.fileId,
    title: "Nouvelle mission de dépôt",
    body: "Une facture vous a été affectée pour dépôt physique.",
  });

  await writeAudit({
    action: AuditActions.DEPOSIT_COURIER_ASSIGNED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { courier: courierUserId, reassigned: reassigning },
  });
  revalidate(fileId);
  return { ok: true, id: depositId };
}

// ================================================== 24 — the courier ==========

/** The courier explicitly ACCEPTS. Assignment alone starts nothing. Idempotent. */
export async function acceptAssignment(depositId: string): Promise<DepositResult> {
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");

  // Already accepted => harmless no-op, not an error.
  if (d.acceptedAt !== null) return { ok: true, id: depositId };
  if (!canAccept(assignmentOf(d), c.userId)) return fail("invalid_state");

  const { data } = await getAdminSupabaseClient()
    .from("invoice_deposit")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", depositId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "ASSIGNED")
    .is("accepted_at", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return { ok: true, id: depositId }; // a concurrent accept won

  await recordCustody(c, d, "COURIER_ACCEPTED", "ASSIGNED", "ASSIGNED");
  await writeAudit({
    action: AuditActions.DEPOSIT_STARTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { accepted: true },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

/** The courier DECLINES. A reason is mandatory; the package returns to Admin. */
export async function declineAssignment(depositId: string, reason: string): Promise<DepositResult> {
  if (!sanitizeReason(reason)) return fail("reason_required");
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");
  if (!canTransitionDeposit(d.status, "READY_FOR_COURIER")) return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, d.status, {
    status: "READY_FOR_COURIER",
    courier_user_id: null,
    accepted_at: null,
    declined_at: new Date().toISOString(),
    decline_reason: sanitizeReason(reason),
  });
  if (!ok) return fail("invalid_state");

  const rec = await recordCustody(c, d, "COURIER_DECLINED", d.status, "READY_FOR_COURIER", { reason });
  if (!rec.ok) return fail(rec.error!);

  await writeAudit({
    action: AuditActions.DEPOSIT_FAILED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { declined: true, reason: sanitizeReason(reason) },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

/** The courier departs. Only on a mission they were assigned AND accepted. */
export async function startDeposit(depositId: string): Promise<DepositResult> {
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");
  if (d.status === "IN_TRANSIT") return { ok: true, id: depositId }; // idempotent
  if (!canStartDeposit(assignmentOf(d), c.userId)) return fail("not_accepted");

  const ok = await cas(c.tenantId, depositId, "ASSIGNED", {
    status: "IN_TRANSIT",
    departed_at: new Date().toISOString(),
  });
  if (!ok) return fail("invalid_state");

  await recordCustody(c, d, "DEPOSIT_STARTED", "ASSIGNED", "IN_TRANSIT");
  await writeAudit({
    action: AuditActions.DEPOSIT_STARTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { status: "IN_TRANSIT" },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

/**
 * The courier records the deposit. A recipient NAME and a DATE are mandatory —
 * there is no "delivered" checkbox without them.
 *
 * This does NOT accept the proof, does NOT mark the invoice paid, and does NOT
 * hand anything to Collections.
 */
export async function recordDeposit(
  depositId: string,
  input: { recipientName: string; recipientRole?: string; recipientOrg?: string; depositedAt?: string },
): Promise<DepositResult> {
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");

  const recipient = input.recipientName?.trim() ?? "";
  if (recipient.length === 0) return fail("recipient_required");

  if (!canTransitionDeposit(d.status, "DEPOSITED")) return fail("invalid_state");

  const depositedAt = input.depositedAt ?? new Date().toISOString();
  const ok = await cas(c.tenantId, depositId, d.status, {
    status: "DEPOSITED",
    deposited_at: depositedAt,
    recipient_name: recipient,
    recipient_role: input.recipientRole ?? null,
    recipient_org: input.recipientOrg ?? null,
  });
  if (!ok) return fail("invalid_state");

  await recordCustody(c, d, "INVOICE_DEPOSITED", d.status, "DEPOSITED");
  await writeAudit({
    action: AuditActions.DEPOSIT_COMPLETED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    // Recipient NAME is operational evidence and is recorded. No address, no notes.
    after: { deposited_at: depositedAt, recipient_recorded: true },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

/** The deposit FAILED. A reason is mandatory; the package returns to Admin. */
export async function failDeposit(depositId: string, reason: string): Promise<DepositResult> {
  if (!sanitizeReason(reason)) return fail("reason_required");
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");
  if (!canTransitionDeposit(d.status, "READY_FOR_COURIER")) return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, d.status, {
    status: "READY_FOR_COURIER",
    courier_user_id: null,
    accepted_at: null,
    failure_reason: sanitizeReason(reason),
  });
  if (!ok) return fail("invalid_state");

  const rec = await recordCustody(c, d, "DEPOSIT_FAILED", d.status, "READY_FOR_COURIER", { reason });
  if (!rec.ok) return fail(rec.error!);

  await writeAudit({
    action: AuditActions.DEPOSIT_FAILED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { reason: sanitizeReason(reason) },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

/**
 * Proof upload. REUSES the existing private-bucket document pipeline — the proof
 * is a normal PROOF_OF_DEPOSIT document, reviewed the normal way. The storage path
 * is built SERVER-side; a client can never choose it.
 */
export async function uploadProofOfDeposit(depositId: string, formData: FormData): Promise<DepositResult> {
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");
  if (d.status !== "DEPOSITED" && d.status !== "PROOF_REJECTED") return fail("invalid_state");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("proof_required");

  const allowed = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowed.includes(file.type)) return fail("invalid_mime");

  const sizeInvalid = validateDocumentInput({
    typeHasValidity: false,
    expiryDate: null,
    sizeBytes: file.size,
    mimeType: file.type,
  });
  if (sizeInvalid) return fail("upload_failed");

  const admin = getAdminSupabaseClient();
  const id = crypto.randomUUID();
  // SERVER-generated path — never a client-supplied one.
  const path = buildStoragePath(c.tenantId, d.fileId, id, fileExtension(file.name, file.type));

  const up = await uploadObject(path, file, file.type);
  if (!up.ok) return fail("upload_failed");

  const { error } = await admin.from("document").insert({
    id,
    tenant_id: c.tenantId,
    file_id: d.fileId,
    type_code: "PROOF_OF_DEPOSIT",
    title: file.name,
    // Enters the normal staff review queue. Administration validates it.
    status: "PENDING_REVIEW",
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: c.userId,
    shared_with_client: false,
  });
  if (error) {
    await removeObject(path); // don't orphan the object
    return fail("upload_failed");
  }

  await admin
    .from("invoice_deposit")
    .update({ proof_document_id: id })
    .eq("id", depositId)
    .eq("tenant_id", c.tenantId);

  await recordCustody(c, d, "PROOF_UPLOADED", d.status, d.status, { evidenceDocumentId: id });
  await writeAudit({
    action: AuditActions.DEPOSIT_PROOF_SUBMITTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "document",
    entityId: id,
    // The document id, never its contents.
    after: { deposit_id: depositId, type: "PROOF_OF_DEPOSIT" },
  });
  revalidate(d.fileId);
  return { ok: true, id };
}

/**
 * The courier returns the proof to Administration (completes official step 24).
 * Requires the deposit details AND the proof document — no silent acceptance.
 */
export async function submitProof(depositId: string): Promise<DepositResult> {
  const c = await courierGuard();
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier");

  const complete = proofComplete({
    proofDocumentId: d.proofDocumentId,
    recipientName: d.recipientName,
    depositedAt: d.depositedAt,
  });
  if (!complete.ok) {
    return fail(complete.missing.includes("proof_document") ? "proof_required" : "recipient_required");
  }
  if (!canTransitionDeposit(d.status, "PROOF_SUBMITTED")) return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, d.status, {
    status: "PROOF_SUBMITTED",
    proof_submitted_at: new Date().toISOString(),
    returned_to_admin_at: new Date().toISOString(),
  });
  if (!ok) return fail("invalid_state");

  const rec = await recordCustody(c, d, "PROOF_SUBMITTED", d.status, "PROOF_SUBMITTED", {
    evidenceDocumentId: d.proofDocumentId,
  });
  if (!rec.ok) return fail(rec.error!);

  // Official step 24 completes only now — proof returned, not merely deposited.
  await submitStep(d.fileId, "courier_deposit");

  await writeAudit({
    action: AuditActions.DEPOSIT_PROOF_SUBMITTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { status: "PROOF_SUBMITTED", proof_document_id: d.proofDocumentId },
  });
  revalidate(d.fileId);
  return { ok: true, id: depositId };
}

// ================================================== 25 — Administration ========

/**
 * Administration ACCEPTS the proof. The reviewer may NOT be the courier who
 * deposited it — a courier can never validate their own proof.
 */
export async function acceptProof(depositId: string): Promise<DepositResult> {
  const admin = getAdminSupabaseClient();
  const resolved = await resolveDepositFile(depositId);
  if (!resolved) return fail("not_found");
  const fileId = resolved.fileId;

  const c = await guard("admin_service:manage", fileId);
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (d.status !== "PROOF_SUBMITTED") return fail("invalid_state");
  // The courier can never review their own proof.
  if (d.courierUserId === c.userId) return fail("self_review_forbidden");
  if (!d.proofDocumentId) return fail("proof_required");

  const now = new Date().toISOString();
  const ok = await cas(c.tenantId, depositId, "PROOF_SUBMITTED", {
    status: "PROOF_ACCEPTED",
    validated_by_admin: c.userId,
    validated_at: now,
    rejection_reason: null,
  });
  if (!ok) return fail("invalid_state");

  // The proof becomes an APPROVED document through the EXISTING document workflow.
  await admin
    .from("document")
    .update({ status: "APPROVED", reviewed_by: c.userId })
    .eq("id", d.proofDocumentId)
    .eq("tenant_id", c.tenantId);

  await recordCustody(c, d, "PROOF_ACCEPTED", "PROOF_SUBMITTED", "PROOF_ACCEPTED", {
    evidenceDocumentId: d.proofDocumentId,
  });
  await writeAudit({
    action: AuditActions.DEPOSIT_PROOF_ACCEPTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { courier: d.courierUserId, reviewer: c.userId },
  });
  revalidate(fileId);
  return { ok: true, id: depositId };
}

/**
 * Administration REJECTS the proof. A reason is mandatory. The prior proof and
 * review stay immutable in the custody chain; the workflow returns to the courier.
 * The invoice stays ISSUED and unpaid; NOTHING goes to Collections.
 */
export async function rejectProof(depositId: string, reason: string): Promise<DepositResult> {
  if (!sanitizeReason(reason)) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const resolved = await resolveDepositFile(depositId);
  if (!resolved) return fail("not_found");
  const fileId = resolved.fileId;

  const c = await guard("admin_service:manage", fileId);
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (d.status !== "PROOF_SUBMITTED") return fail("invalid_state");
  if (d.courierUserId === c.userId) return fail("self_review_forbidden");

  const ok = await cas(c.tenantId, depositId, "PROOF_SUBMITTED", {
    status: "PROOF_REJECTED",
    validated_by_admin: c.userId,
    validated_at: new Date().toISOString(),
    rejection_reason: sanitizeReason(reason),
  });
  if (!ok) return fail("invalid_state");

  // The rejected proof document is marked REJECTED — the row is NOT deleted, and
  // a corrected proof is a NEW document. Prior evidence is never overwritten.
  if (d.proofDocumentId) {
    await admin
      .from("document")
      .update({ status: "REJECTED", reviewed_by: c.userId, review_note: sanitizeReason(reason) })
      .eq("id", d.proofDocumentId)
      .eq("tenant_id", c.tenantId);
  }

  const rec = await recordCustody(c, d, "PROOF_REJECTED", "PROOF_SUBMITTED", "PROOF_REJECTED", {
    reason,
    evidenceDocumentId: d.proofDocumentId,
  });
  if (!rec.ok) return fail(rec.error!);

  if (d.courierUserId) {
    await createNotification({
      tenantId: c.tenantId,
      userId: d.courierUserId,
      type: "TASK_ASSIGNED",
      fileId: d.fileId,
      title: "Preuve de dépôt rejetée",
      body: sanitizeReason(reason) ?? "",
    });
  }

  await writeAudit({
    action: AuditActions.DEPOSIT_PROOF_REJECTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { reviewer: c.userId, reason: sanitizeReason(reason) },
  });
  revalidate(fileId);
  return { ok: true, id: depositId };
}

/**
 * Administration hands the accepted proof to Collections (official step 25).
 *
 * Requires an ACCEPTED proof. IDEMPOTENT. Does NOT mark paid, does NOT close the
 * dossier, and does NOT create a collection follow-up.
 */
export async function handToCollections(depositId: string): Promise<DepositResult> {
  const admin = getAdminSupabaseClient();
  const resolved = await resolveDepositFile(depositId);
  if (!resolved) return fail("not_found");
  const fileId = resolved.fileId;

  const c = await guard("admin_service:manage", fileId);
  if (isErr(c)) return fail(c);

  const d = await loadDeposit(c.tenantId, depositId);
  if (!d) return fail("not_found");
  if (d.status === "HANDED_TO_COLLECTIONS") return { ok: true, id: depositId }; // idempotent
  if (d.status !== "PROOF_ACCEPTED") return fail("invalid_state");

  const ok = await cas(c.tenantId, depositId, "PROOF_ACCEPTED", {
    status: "HANDED_TO_COLLECTIONS",
  });
  if (!ok) return fail("invalid_state");

  const handoff = await sendHandoff(d.fileId, "administration_proof_handoff", "collections");
  await recordCustody(c, d, "HANDED_TO_COLLECTIONS", "PROOF_ACCEPTED", "HANDED_TO_COLLECTIONS", {
    handoffId: handoff.ok ? handoff.id : null,
    evidenceDocumentId: d.proofDocumentId,
  });

  // Official step 25 completes. Step 26 (Collections) becomes available.
  await submitStep(d.fileId, "administration_proof_handoff");

  await writeAudit({
    action: AuditActions.DEPOSIT_HANDED_TO_COLLECTIONS,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice_deposit",
    entityId: depositId,
    after: { invoice_id: d.invoiceId, file_id: d.fileId },
  });
  revalidate(fileId);
  return { ok: true, id: depositId };
}

export { getCurrentUser };
