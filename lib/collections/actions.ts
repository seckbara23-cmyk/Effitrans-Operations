"use server";
/**
 * Collections — server actions (Phase 5.0D-4). SERVER-ONLY. Official step 26.
 * ---------------------------------------------------------------------------
 * COLLECTIONS IS NOT PAYMENT PROCESSING. Nothing here inserts, verifies, reverses
 * or otherwise touches a payment: payments stay entirely in lib/finance. Collections
 * READS the balance that already drives invoice.status and chases it.
 *
 * PAYMENT IS NOT CLOSURE. The close action is separate, explicit, permissioned and
 * idempotent, and it refuses with the COMPLETE blocker list.
 *
 * REUSE: invoice (the receivable — there is no `collection_case` entity),
 * collection_follow_up (append-only), payment (read-only), the process engine,
 * notifications, audit_log, and the existing operational_file lifecycle seam.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { submitStep } from "@/lib/process/engine/actions";
import { transitionFile } from "@/lib/files/actions";
import { evaluateClosure, type ClosureEvaluation } from "@/lib/process/engine/closure";
import { loadClosureInput } from "./closure-input";
import {
  isChannel,
  isDisputeCategory,
  isOutcome,
  sanitizeNote,
  MAX_NOTE,
} from "./model";

export type CollectionsError =
  | "feature_disabled"
  | "forbidden"
  | "cross_tenant_forbidden"
  | "invoice_missing"
  | "invoice_not_issued"
  | "collections_not_ready"
  | "collections_handoff_missing"
  | "deposit_proof_required"
  | "invalid_collector"
  | "invalid_channel"
  | "invalid_outcome"
  | "invalid_category"
  | "reason_required"
  | "note_too_long"
  | "dispute_not_open"
  | "closure_blocked"
  | "not_found";

export type CollectionsResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: CollectionsError; blockers?: string[] };

const fail = <T,>(error: CollectionsError, blockers?: string[]): CollectionsResult<T> => ({
  ok: false,
  error,
  ...(blockers ? { blockers } : {}),
});

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function revalidate(fileId: string) {
  revalidatePath("/collections");
  revalidatePath(`/files/${fileId}/process`);
  revalidatePath("/queues/collections");
  revalidatePath("/my-work");
}

type Ctx = { userId: string; tenantId: string; permissions: string[] };

/** Collections requires BOTH the engine flag and the collections flag. */
async function guard(permission: string, fileId: string): Promise<Ctx | CollectionsError> {
  // Kill switch (no query) -> identity -> TENANT gate (5.0E-2A).
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.collections) return "feature_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  const flags = await getTenantProcessFlags(user.tenantId);
  if (!flags.collections) return "feature_disabled";
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "cross_tenant_forbidden";
  return { userId: user.id, tenantId: user.tenantId, permissions: await getEffectivePermissions(user.id) };
}

const isErr = (v: Ctx | CollectionsError): v is CollectionsError => typeof v === "string";

/** TENANT-SCOPED bootstrap: a foreign invoiceId simply finds nothing. */
async function resolveInvoice(
  invoiceId: string,
): Promise<{ tenantId: string; fileId: string; row: Row } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await getAdminSupabaseClient()
    .from("invoice")
    .select(
      "id, file_id, client_id, status, due_date, validated_at, collections_received_at, collections_assignee_id, collections_completed_at, disputed_at, dispute_category, dispute_reason",
    )
    .eq("id", invoiceId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return { tenantId: user.tenantId, fileId: r.file_id as string, row: r };
}

// --------------------------------------------------- 26. eligibility + intake ----

/**
 * Collections ELIGIBILITY. A dossier does NOT enter Collections merely because an
 * invoice exists: the official handoff must have happened, and the physical deposit
 * proof must be accepted where the client is configured for one.
 */
export async function collectionsEligibility(
  invoiceId: string,
): Promise<CollectionsResult<{ eligible: boolean; reason?: CollectionsError }>> {
  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  const inv = resolved.row;
  const status = inv.status as string;
  if (status !== "ISSUED" && status !== "PARTIALLY_PAID") {
    return { ok: true, eligible: false, reason: "invoice_not_issued" };
  }

  const admin = getAdminSupabaseClient();
  const { data: client } = await admin
    .from("client")
    .select("requires_physical_invoice_deposit")
    .eq("id", (inv.client_id as string) ?? "")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const depositRequired = Boolean((client as Row | null)?.requires_physical_invoice_deposit);

  if (depositRequired) {
    const { data: dep } = await admin
      .from("invoice_deposit")
      .select("status")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", c.tenantId)
      .neq("status", "CANCELLED")
      .limit(1);
    const d = ((dep ?? []) as Row[])[0];
    if (!d) return { ok: true, eligible: false, reason: "collections_handoff_missing" };
    if (d.status !== "HANDED_TO_COLLECTIONS") {
      return {
        ok: true,
        eligible: false,
        reason: d.status === "PROOF_ACCEPTED" ? "collections_handoff_missing" : "deposit_proof_required",
      };
    }
  }

  return { ok: true, eligible: true };
}

/** Assign a Collections Officer. ACTIVE, same tenant, correct role. */
export async function assignCollector(
  invoiceId: string,
  collectorUserId: string,
  reason?: string,
): Promise<CollectionsResult> {
  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  const admin = getAdminSupabaseClient();
  const { data: cand } = await admin
    .from("app_user")
    .select("id, status, user_role:user_role(role:role_id(code))")
    .eq("id", collectorUserId)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const candidate = cand as Row | null;
  if (!candidate || candidate.status !== "active") return fail("invalid_collector");

  const roles = (candidate.user_role ?? []) as { role: { code: string } | null }[];
  const codes = roles.map((r) => r.role?.code);
  // A Courier, Driver, Billing Officer or portal identity can never be a collector.
  const allowed = ["COLLECTIONS_OFFICER", "FINANCE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"];
  if (!codes.some((code) => code && allowed.includes(code))) return fail("invalid_collector");

  const previous = str(resolved.row.collections_assignee_id);
  const reassigning = previous !== null && previous !== collectorUserId;
  // Reassignment after work began needs a reason.
  const { count: workDone } = await admin
    .from("collection_follow_up")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", c.tenantId);
  if (reassigning && (workDone ?? 0) > 0 && !sanitizeNote(reason)) return fail("reason_required");

  await admin
    .from("invoice")
    .update({
      collections_assignee_id: collectorUserId,
      // Stamp the Collections intake once — a reassignment does not reset it.
      collections_received_at: str(resolved.row.collections_received_at) ?? new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId);

  await createNotification({
    tenantId: c.tenantId,
    userId: collectorUserId,
    type: "TASK_ASSIGNED",
    fileId: resolved.fileId,
    title: "Dossier de recouvrement affecté",
    body: "Un dossier vous a été affecté pour recouvrement.",
  });

  await writeAudit({
    action: reassigning ? AuditActions.COLLECTOR_REASSIGNED : AuditActions.COLLECTOR_ASSIGNED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // Assignment history lives here — audit_log is append-only.
    before: { collections_assignee_id: previous },
    after: {
      collections_assignee_id: collectorUserId,
      reassigned: reassigning,
      reason: sanitizeNote(reason),
    },
  });
  revalidate(resolved.fileId);
  return { ok: true, id: invoiceId };
}

// ----------------------------------------------------------- 3. follow-ups ----

/**
 * Record a follow-up. APPEND-ONLY (the table forbids UPDATE at the DB level), so a
 * prior follow-up can never be rewritten and a later promise never erases an
 * earlier one.
 *
 * This NEVER notifies the client: an internal follow-up is internal. Client
 * communication goes through the existing communication system and an explicit
 * send action.
 */
export async function recordFollowUp(
  invoiceId: string,
  input: {
    channel: string;
    outcome: string;
    note?: string;
    promisedPaymentDate?: string;
    promisedAmount?: number;
    nextFollowUpAt?: string;
    disputeCategory?: string;
  },
): Promise<CollectionsResult> {
  if (!isChannel(input.channel)) return fail("invalid_channel");
  if (!isOutcome(input.outcome)) return fail("invalid_outcome");
  if ((input.note ?? "").length > MAX_NOTE * 4) return fail("note_too_long");
  if (input.disputeCategory && !isDisputeCategory(input.disputeCategory)) return fail("invalid_category");

  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("collection_follow_up")
    .insert({
      tenant_id: c.tenantId,
      file_id: resolved.fileId,
      invoice_id: invoiceId,
      performed_by: c.userId,
      channel: input.channel,
      outcome: input.outcome,
      note: sanitizeNote(input.note),
      promised_payment_date: input.promisedPaymentDate ?? null,
      promised_amount: input.promisedAmount ?? null,
      next_follow_up_at: input.nextFollowUpAt ?? null,
      dispute_category: input.disputeCategory ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return fail("not_found");

  if (input.outcome === "ESCALATED") {
    await admin
      .from("invoice")
      .update({ escalated_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("tenant_id", c.tenantId);
  }

  await writeAudit({
    action: input.promisedPaymentDate
      ? AuditActions.COLLECTION_PROMISE_RECORDED
      : AuditActions.COLLECTION_FOLLOW_UP,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "collection_follow_up",
    entityId: data.id as string,
    // Channel + outcome + dates. NEVER the note's content — a follow-up note is
    // operational, not a transcript, and it does not belong in the audit log.
    after: {
      invoice_id: invoiceId,
      channel: input.channel,
      outcome: input.outcome,
      promised_date: input.promisedPaymentDate ?? null,
      has_note: !!sanitizeNote(input.note),
    },
  });
  revalidate(resolved.fileId);
  return { ok: true, id: data.id as string };
}

// ------------------------------------------------------------- 5. disputes ----

/** Open a dispute. A category AND a reason are mandatory. Blocks closure. */
export async function openDispute(
  invoiceId: string,
  category: string,
  reason: string,
): Promise<CollectionsResult> {
  if (!isDisputeCategory(category)) return fail("invalid_category");
  const r = sanitizeNote(reason);
  if (!r) return fail("reason_required");

  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  const admin = getAdminSupabaseClient();
  await admin
    .from("invoice")
    .update({
      disputed_at: new Date().toISOString(),
      dispute_category: category,
      dispute_reason: r,
      dispute_opened_by: c.userId,
      dispute_resolved_at: null,
      dispute_resolution: null,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId);

  await writeAudit({
    action: AuditActions.COLLECTION_DISPUTE_RECORDED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // A dispute does NOT erase the amount due, and is NOT an overdue reclassification.
    after: { category, opened_by: c.userId, blocks_closure: true },
  });
  revalidate(resolved.fileId);
  return { ok: true, id: invoiceId };
}

/** Resolve a dispute. The history (category, reason, actor) is preserved. */
export async function resolveDispute(invoiceId: string, resolution: string): Promise<CollectionsResult> {
  const res = sanitizeNote(resolution);
  if (!res) return fail("reason_required");

  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");
  if (!resolved.row.disputed_at) return fail("dispute_not_open");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  await getAdminSupabaseClient()
    .from("invoice")
    .update({ dispute_resolved_at: new Date().toISOString(), dispute_resolution: res })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId);

  await writeAudit({
    action: AuditActions.COLLECTION_DISPUTE_RECORDED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: { resolved: true, category: str(resolved.row.dispute_category) },
  });
  revalidate(resolved.fileId);
  return { ok: true, id: invoiceId };
}

// ---------------------------------------------- 15. step 26 (NOT closure) ----

/**
 * Mark the RECOVERY complete (official step 26).
 *
 * This is deliberately NOT closure. A collector may finish the recovery; the
 * dossier is closed by a separate, explicitly authorized action. Collapsing the two
 * into one hidden transition is exactly what the official process forbids.
 */
export async function completeCollections(invoiceId: string): Promise<CollectionsResult> {
  const resolved = await resolveInvoice(invoiceId);
  if (!resolved) return fail("invoice_missing");

  const c = await guard("collections:manage", resolved.fileId);
  if (isErr(c)) return fail(c);

  const admin = getAdminSupabaseClient();

  // The recovery is only complete when the balance is settled and no dispute is open.
  const closure = await loadClosureInput(c.tenantId, resolved.fileId, c.permissions);
  if (!closure) return fail("not_found");
  if (closure.outstandingBalance > 0) return fail("collections_not_ready", ["balance_zero"]);
  if (closure.disputeOpen) return fail("collections_not_ready", ["no_open_dispute"]);

  await admin
    .from("invoice")
    .update({ collections_completed_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .is("collections_completed_at", null);

  // Official step 26 completes. The DOSSIER is still open.
  await submitStep(resolved.fileId, "collections");

  await writeAudit({
    action: AuditActions.PROCESS_OPERATIONALLY_COMPLETED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: { collections_complete: true, dossier_closed: false },
  });
  revalidate(resolved.fileId);
  return { ok: true, id: invoiceId };
}

// -------------------------------------------------- 12/13. closure readiness ----

/** The authoritative readiness evaluation. Read-only; writes an audit trail entry. */
export async function evaluateClosureReadiness(fileId: string): Promise<ClosureEvaluation | null> {
  if (!globalKillSwitch().enabled) return null;

  let user;
  try {
    user = await assertPermission("process:read");
  } catch {
    return null;
  }
  if (!(await getTenantProcessFlags(user.tenantId)).enabled) return null;
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const permissions = await getEffectivePermissions(user.id);
  const input = await loadClosureInput(user.tenantId, fileId, permissions);
  if (!input) return null;

  return evaluateClosure(input);
}

/**
 * EXPLICIT DOSSIER CLOSURE (Deliverable 13).
 *
 * Requires `process:close` — held by OPS_SUPERVISOR and SYSTEM_ADMIN only. NOT by
 * COLLECTIONS_OFFICER (who completes the recovery), NOT by BILLING_OFFICER, and
 * never by a Courier, Driver or portal identity.
 *
 * Refuses with the COMPLETE blocker list. Idempotent. Deletes nothing, hides
 * nothing: a closed dossier stays fully readable to authorized audit and
 * Collections roles.
 */
export async function closeDossier(fileId: string): Promise<CollectionsResult> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.collections) return fail("feature_disabled");

  let user;
  try {
    user = await assertPermission("process:close");
  } catch {
    return fail("forbidden");
  }
  // TENANT gate (5.0E-2A). Closure is the most consequential action in the process;
  // it must be impossible for a non-pilot tenant even with the deployment enabled.
  if (!(await getTenantProcessFlags(user.tenantId)).collections) return fail("feature_disabled");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return fail("cross_tenant_forbidden");

  const permissions = await getEffectivePermissions(user.id);
  const admin = getAdminSupabaseClient();

  const { data: inst } = await admin
    .from("process_instance")
    .select("id, status")
    .eq("file_id", fileId)
    .eq("tenant_id", user.tenantId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  const instance = inst as Row | null;
  if (!instance) return fail("not_found");

  // Idempotent: already closed => success, without a second closure.
  if (instance.status === "CLOSED") return { ok: true, id: fileId };

  const input = await loadClosureInput(user.tenantId, fileId, permissions);
  if (!input) return fail("not_found");
  const evaluation = evaluateClosure(input);

  await writeAudit({
    action: AuditActions.CLOSURE_READINESS_EVALUATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "operational_file",
    entityId: fileId,
    after: { ready: evaluation.ready, blockers: evaluation.blockers },
  });

  if (!evaluation.ready) {
    // Refuse with the COMPLETE list — never a single opaque "not ready".
    return fail("closure_blocked", [...evaluation.blockers, ...evaluation.unauthorized]);
  }

  // CAS: a concurrent close matches zero rows.
  const now = new Date().toISOString();
  const { data: closed } = await admin
    .from("process_instance")
    .update({ status: "CLOSED", closed_at: now, completed_at: now })
    .eq("id", instance.id as string)
    .eq("tenant_id", user.tenantId)
    .neq("status", "CLOSED")
    .select("id");
  if ((closed?.length ?? 0) !== 1) return { ok: true, id: fileId }; // a concurrent close won

  // The dossier's own lifecycle moves through the EXISTING seam, which re-checks
  // its own guards (DELIVERED -> CLOSED, customs released). We never write
  // operational_file.status directly.
  await transitionFile(fileId, "CLOSED");

  await writeAudit({
    action: AuditActions.PROCESS_CLOSED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "operational_file",
    entityId: fileId,
    after: { closed_at: now, satisfied: evaluation.satisfied, not_applicable: evaluation.notApplicable },
  });

  revalidate(fileId);
  return { ok: true, id: fileId };
}

export { hasPermission };
