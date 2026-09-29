"use server";
/**
 * Official billing workflow — server actions (Phase 5.0D-2). SERVER-ONLY.
 * Official steps 20-22.
 * ---------------------------------------------------------------------------
 * REUSE, NOT REBUILD. There is no second invoice, approval, email or workflow
 * system here:
 *   invoice / invoice_line       the existing rows (Phase 1.11)
 *   communication_message        the existing email queue, with its own
 *                                status/retry_count/last_error/sent_at fields
 *   process engine               the existing maker-checker + handoffs (5.0B)
 *   tenant branding              resolved inside queueAndSend, unchanged
 *   audit_log                    the existing writeAudit
 *
 * Every mutation runs: flag -> permission -> tenant -> dossier access -> billing
 * gate -> invoice state -> apply -> sync the process step -> audit.
 *
 * Concurrency is COMPARE-AND-SET (`update ... where id = ? and <expected state>`,
 * then check the affected row count), exactly like the process engine. A second
 * concurrent submit/approve matches zero rows and is rejected deterministically.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { queueAndSend } from "@/lib/comms/queue";
import { isProviderConfigured } from "@/lib/comms/provider";
import { ensureOfficialInvoiceArtifact } from "@/lib/finance/invoice-artifact";
import { invoiceTotals } from "@/lib/finance/calc";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { activateStep, approveStep, rejectStep, submitStep } from "../engine/actions";
import { loadProcessSnapshot, toViews } from "../engine/snapshot";
import { authoritativeBillingReady } from "../engine/gate-authority";
import {
  canEmailInvoice,
  canSubmitInvoice,
  canValidateInvoice,
  draftStepPlan,
  validateRejectionReason,
  type BillingError,
  type InvoiceView,
} from "./state";

export type BillingResult<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: BillingError };

const fail = <T,>(error: BillingError): BillingResult<T> => ({ ok: false, error });

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath(`/files/${fileId}/process`);
  revalidatePath("/queues/billing");
  revalidatePath("/queues/finance");
  revalidatePath("/my-work");
}

type Ctx = { userId: string; tenantId: string; permissions: string[] };

async function guard(permission: string, fileId: string): Promise<Ctx | BillingError> {
  if (!globalKillSwitch().enabled) return "feature_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  // Tenant gate (5.0E-2A): a globally-enabled deployment is not a globally-enabled
  // fleet of tenants.
  if (!(await getTenantProcessFlags(user.tenantId)).enabled) return "feature_disabled";
  // Cross-tenant / invisible dossier => the same opaque refusal.
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "cross_tenant_forbidden";
  return { userId: user.id, tenantId: user.tenantId, permissions: await getEffectivePermissions(user.id) };
}

const isErr = (v: Ctx | BillingError): v is BillingError => typeof v === "string";

/**
 * What became of a compensating write (STEP20-BILLING-ATOMICITY-01).
 *
 *   applied               the exact row this invocation wrote was reverted;
 *   declined_row_changed  the row no longer matches — somebody else moved it,
 *                         so it is not ours to undo and we leave it alone;
 *   failed                the revert itself errored and nothing is proven.
 */
type CompensationOutcome = "applied" | "declined_row_changed" | "failed";

/**
 * Run a FENCED compensating update and say what happened.
 *
 * WHY COMPENSATION AND NOT A TRANSACTION. The invoice write and the process
 * transition cannot share one. Everything here speaks PostgREST, where each
 * request is its own transaction and the client exposes no session to join;
 * there is no raw Postgres client in this project, and not one SQL function in
 * the repository writes the engine's own step-execution table. Making the pair
 * atomic would
 * mean porting `submitStep`'s guards — permission, custody, assignment, service
 * scope, evidence, and the BILLING-BYPASS-01 domain guard — into SQL, creating a
 * second writer of the engine's tables and a second statement of workflow
 * authority. The shape used instead is the one this codebase already ratified
 * for the same problem in `lib/comms/dispatch.ts`: acquire by compare-and-set,
 * attempt the fallible act, compensate on failure, return the original error.
 *
 * WHAT IS NEVER COMPENSATED. Only writes that stayed INSIDE the database. An
 * email that left the building and an official invoice number that was consumed
 * are facts about the world, and `emailValidatedInvoice` deliberately keeps
 * both — rolling them back "would be a lie of a different kind". Undo what is
 * only internal; never undo what escaped.
 *
 * FAILS CLOSED. The caller passes a fence naming the exact row-version this
 * invocation produced — status, actor, the exact timestamp, and the revision.
 * Anything else matches zero rows and is reported as `declined_row_changed`
 * rather than forced, so a concurrent legitimate change can never be erased.
 * Both non-applied outcomes leave precisely the behaviour that shipped before
 * this, so the worst case of compensating is no worse than not compensating.
 */
async function compensationOutcome(
  query: PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<CompensationOutcome> {
  const { data, error } = await query;
  if (error) return "failed";
  return (data?.length ?? 0) === 1 ? "applied" : "declined_row_changed";
}

/** Load the invoice with its official maker-checker fields + line count. */
async function loadInvoiceView(
  tenantId: string,
  invoiceId: string,
): Promise<{
  view: InvoiceView;
  fileId: string;
  clientId: string | null;
  /**
   * The OFFICIAL number, when one is already persisted
   * (STEP22-ISSUANCE-INTEGRITY-01). Carried beside the pure view rather than
   * inside it: `InvoiceView` is the shape every maker-checker predicate is
   * written against, and none of them has an opinion about numbering.
   */
  invoiceNumber: string | null;
} | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("invoice")
    .select(
      "id, file_id, client_id, status, submitted_by, submitted_at, validated_by, validated_at, rejection_reason, revision, invoice_number",
    )
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;

  const { count } = await admin
    .from("invoice_line")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId);

  return {
    view: {
      id: r.id as string,
      status: r.status as InvoiceView["status"],
      submittedBy: str(r.submitted_by),
      submittedAt: str(r.submitted_at),
      validatedBy: str(r.validated_by),
      validatedAt: str(r.validated_at),
      rejectionReason: str(r.rejection_reason),
      revision: Number(r.revision ?? 1),
      lineCount: count ?? 0,
    },
    fileId: r.file_id as string,
    clientId: str(r.client_id),
    invoiceNumber: str(r.invoice_number),
  };
}

/** The dossier has passed BOTH completeness checkpoints (official steps 18 + 19). */
async function billingReady(ctx: Ctx, fileId: string): Promise<boolean> {
  // AUTHORITATIVE, not the caller's view. This used to build the snapshot from
  // `ctx.permissions`, and the billing gate reads podReceived(snap.documents)
  // directly — so a caller without document:read got an empty array and the
  // gate read that silence as "no POD". BILLING_OFFICER holds no document:read,
  // which meant the role that OWNS step 20 could never open its own gate.
  //
  // The verdict is a fact about the DOSSIER. Whether this caller may act on it
  // was already decided by guard() before we got here.
  return authoritativeBillingReady(ctx.tenantId, fileId);
}

/**
 * C-4 — make step 22 able to COMPLETE, or refuse before anything irreversible.
 *
 * `emailValidatedInvoice` ends by completing step 22, and `submitStep` requires
 * the step to be ACTIVE: AVAILABLE -> COMPLETED is not a legal transition. The
 * lane had no check at all, so an invoice could be emailed and issued while the
 * step sat AVAILABLE — the customer written to, an official number consumed, and
 * the dossier stalled with the caller told "ok".
 *
 * `assertControlStep` does NOT solve this and is deliberately not used here:
 * its ACTIONABLE set includes AVAILABLE, so it passes in exactly the state that
 * produces the stall.
 *
 * Claiming an AVAILABLE step for this actor confers NO authority. The caller
 * has already passed `guard("finance:issue")`, and `finance:issue` IS step 22's
 * canonical execution permission, so this is the same act the operator performs
 * with « Démarrer » — done at the moment it becomes required rather than left as
 * a precondition nobody stated.
 */
async function prepareDispatchStep(
  ctx: Ctx,
  fileId: string,
): Promise<{ ready: true } | { ready: false; error: BillingError }> {
  // Read through the ENGINE's own reader. The billing lane never touches
  // process tables directly — not to write them, and not to read them either,
  // so the boundary stays one-directional and obvious.
  const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!snap?.instance) return { ready: false, error: "dispatch_step_not_reached" };

  const exec = snap.executions.find(
    (e) => e.stepKey === "billing_dispatch" && e.state !== "REJECTED" && e.state !== "CANCELLED",
  );
  if (!exec) return { ready: false, error: "dispatch_step_not_reached" };

  // Someone else is doing this. Never take a claimed step from its owner.
  if (exec.assignedUserId && exec.assignedUserId !== ctx.userId) {
    return { ready: false, error: "dispatch_step_claimed_by_another" };
  }
  // Already open and ours — nothing to prepare.
  if (exec.state === "ACTIVE") return { ready: true };
  // Not reached yet, or already closed. Either way the completion cannot land.
  if (exec.state !== "AVAILABLE") return { ready: false, error: "dispatch_step_not_reached" };

  const opened = await activateStep(fileId, "billing_dispatch");
  if (!opened.ok) return { ready: false, error: "dispatch_step_not_claimable" };
  return { ready: true };
}

/**
 * STEP20-BILLING-UI-01 — make step 20 able to REACH SUBMITTED, or refuse before
 * the invoice is marked.
 *
 * `AVAILABLE -> SUBMITTED` is not in ALLOWED_STEP_TRANSITIONS. Promotion from
 * step 19 leaves `billing_draft` AVAILABLE, so `submitInvoiceToFinance` stamped
 * `submitted_by`/`submitted_at` on the invoice, then `submitStep` refused with
 * `invalid_state` — leaving the invoice permanently unsubmittable
 * (`canSubmitInvoice` now answers `duplicate_submission`) while the official
 * step said nobody had submitted anything. The audit written on that path
 * records the split; it does not undo it.
 *
 * Nothing about it was visible before this task because no control called the
 * action. It is the SAME defect `prepareDispatchStep` already fixes for step 22,
 * and it gets the same fix for the same reason.
 *
 * NO AUTHORITY IS CONFERRED. The caller has already passed
 * `guard("finance:create")`, and `stepPermission("billing_draft")` IS
 * `finance:create` — so this is precisely the act the operator performs with
 * « Démarrer », done at the moment it becomes required rather than left as an
 * unstated precondition.
 *
 * AND NO AUTHORITY IS WITHHELD EITHER (CI-STEP20-01). The assignee check guards
 * the CLAIM and only the claim: it refuses to TAKE an AVAILABLE step from whoever
 * holds it, and says nothing about who may submit an ACTIVE one. That is the
 * engine's decision, and `submitStep` makes it — `assignmentRefusal` applies the
 * assignee rule only to the customs chain Transit assigns, not to `billing_draft`.
 * Restating it here made this helper stricter than the engine and broke the
 * ratified C-4 path where Billing starts step 20 and OPS_SUPERVISOR submits it.
 * See `draftStepPlan`.
 */
async function prepareDraftStep(
  ctx: Ctx,
  fileId: string,
): Promise<{ ready: true } | { ready: false; error: BillingError }> {
  const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!snap?.instance) return { ready: false, error: "step_completion_failed" };

  const exec = snap.executions.find(
    (e) => e.stepKey === "billing_draft" && e.state !== "REJECTED" && e.state !== "CANCELLED",
  );

  // THE RULE IS PURE AND LIVES IN ./state. This function loads rows and acts on
  // the answer; it decides nothing, so the decision can be exercised by a test.
  switch (draftStepPlan(exec ?? null, ctx.userId)) {
    case "ready":
      return { ready: true };
    case "refuse":
      return { ready: false, error: "step_completion_failed" };
    case "claim": {
      const opened = await activateStep(fileId, "billing_draft");
      if (!opened.ok) return { ready: false, error: "step_completion_failed" };
      return { ready: true };
    }
  }
}

// ------------------------------------------------- 20. draft preparation ----

/**
 * Billing Officer prepares the invoice draft (official step 20, maker half).
 *
 * A draft may NOT be created on a dossier that is not billing-ready: both the
 * Coordinator's and the Account Manager's completeness reviews must have passed.
 * This is the gate the platform never had — an invoice used to be creatable on
 * any dossier at any time, with no evidence at all.
 */
export async function prepareInvoiceDraft(fileId: string): Promise<BillingResult<{ id: string }>> {
  const c = await guard("finance:create", fileId);
  if (isErr(c)) return fail(c);

  if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready");

  const admin = getAdminSupabaseClient();

  // One active draft per dossier — a second call returns the existing one.
  const { data: existing } = await admin
    .from("invoice")
    .select("id")
    .eq("file_id", fileId)
    .eq("tenant_id", c.tenantId)
    .in("status", ["DRAFT", "VALIDATED"])
    .limit(1);
  const found = ((existing ?? []) as Row[])[0];
  if (found) return { ok: true, id: found.id as string };

  const { data: file } = await admin
    .from("operational_file")
    .select("client_id")
    .eq("id", fileId)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();

  const { data: created, error } = await admin
    .from("invoice")
    .insert({
      tenant_id: c.tenantId,
      file_id: fileId,
      client_id: (file as Row | null)?.client_id as string | null,
      status: "DRAFT",
      created_by: c.userId,
    })
    .select("id")
    .single();
  if (error || !created) return fail("invoice_missing");

  await writeAudit({
    action: AuditActions.INVOICE_CREATED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: created.id as string,
    after: { file_id: fileId, official_step: "billing_draft" },
  });
  revalidate(fileId);
  return { ok: true, id: created.id as string };
}

// --------------------------------------------- 20. submit to Finance ----

/**
 * Billing submits the draft for independent validation.
 *
 * The invoice is FROZEN from here (lib/finance/actions.ts updateInvoice refuses a
 * submitted invoice), so the checker approves exactly what they reviewed.
 * The process step is advanced ONLY after a real invoice submission exists.
 */
export async function submitInvoiceToFinance(invoiceId: string): Promise<BillingResult> {
  const admin = getAdminSupabaseClient();

  // Resolve the dossier first so the guard can check access.
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:create", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canSubmitInvoice(loaded.view);
  if (!check.ok) return fail(check.error!);

  if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready");

  // BEFORE the stamp, never after: an invoice marked submitted on a step that
  // cannot accept the submission is the one state this lane cannot recover from.
  const step = await prepareDraftStep(c, fileId);
  if (!step.ready) return fail(step.error);

  // CAS: only an unsubmitted DRAFT may be submitted. A concurrent second submit
  // matches zero rows.
  // Hoisted so the compensating fence below can name the EXACT value written
  // here, rather than "some submission".
  const stampedAt = new Date().toISOString();
  const { data } = await admin
    .from("invoice")
    .update({ submitted_by: c.userId, submitted_at: stampedAt })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .is("submitted_at", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("duplicate_submission");

  // Sync the official process: step 20 is now SUBMITTED, awaiting the checker.
  // The engine records the maker on the execution row and opens step 21.
  // The result is KEPT — the fifth site of this class, found by the generic
  // sweep rather than by a failing journey. The invoice is already marked
  // submitted; if step 20 does not move with it, Finance sees an invoice
  // awaiting validation while the workflow says nobody submitted anything.
  const advanced = await submitStep(fileId, "billing_draft");
  if (!advanced.ok) {
    // COMPENSATE. The mark used to be left behind and the audit recorded that it
    // was — which told the truth about a state nobody could get out of: an
    // invoice stamped as submitted is no longer submittable (`canSubmitInvoice`
    // answers `duplicate_submission`) while step 20 says nobody submitted
    // anything. Nothing left the database here, so the attempt is reversible,
    // and reversing it is what makes the domain guard's correct fail-closed
    // survivable rather than permanent.
    //
    // FENCED to this invocation's row-version: our actor, our exact timestamp,
    // still an unvalidated DRAFT, and the revision we read — so a
    // reject/resubmit cycle or a concurrent validation matches zero rows and is
    // left alone.
    const compensation = await compensationOutcome(
      admin
        .from("invoice")
        .update({ submitted_by: null, submitted_at: null })
        .eq("id", invoiceId)
        .eq("tenant_id", c.tenantId)
        .eq("status", "DRAFT")
        .eq("submitted_by", c.userId)
        .eq("submitted_at", stampedAt)
        .is("validated_at", null)
        .eq("revision", loaded.view.revision)
        .select("id"),
    );
    await writeAudit({
      action: AuditActions.PROCESS_DISPATCH_NOT_ADVANCED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      after: {
        file_id: fileId,
        step_key: "billing_draft",
        // The ATTEMPT is recorded whatever happened; this says whether the mark
        // it wrote still stands.
        invoice_submitted: compensation !== "applied",
        compensation,
        reason: advanced.error,
      },
    });
    return fail("step_completion_failed");
  }

  await writeAudit({
    action: AuditActions.INVOICE_DRAFT_SUBMITTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // Identifiers and state only — never the invoice contents.
    after: { file_id: fileId, revision: loaded.view.revision, official_step: "billing_draft" },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------- 21. Finance approval ----

/**
 * Finance validates the invoice (official step 21, CHECKER half).
 *
 * MAKER != CHECKER on IDENTITY. OPS_SUPERVISOR and SYSTEM_ADMIN hold both
 * finance:create and finance:validate by design — and are still refused here when
 * they are the maker. There is no override for this rule.
 */
export async function approveInvoice(invoiceId: string): Promise<BillingResult> {
  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:validate", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canValidateInvoice(loaded.view, c.userId);
  if (!check.ok) return fail(check.error!);

  const now = new Date().toISOString();
  // CAS: only a submitted, not-yet-validated DRAFT may be validated. A second
  // concurrent approval matches zero rows — deterministic, never a double review.
  const { data } = await admin
    .from("invoice")
    .update({ status: "VALIDATED", validated_by: c.userId, validated_at: now, rejection_reason: null })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .not("submitted_at", "is", null)
    .is("validated_at", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("invoice_not_awaiting_validation");

  // Sync the official process. The engine re-checks maker != checker on the
  // execution row, so the rule holds even if this action were bypassed.
  //
  // THE RESULT IS KEPT (STEP20-BILLING-ATOMICITY-01). It was discarded from the
  // day this lane was written, so a failed approval returned `ok` while the
  // invoice said VALIDATED and steps 20/21 never closed — and because the
  // invoice had left DRAFT, neither the governed lane nor the generic control
  // could get it back. Reporting success over a stalled dossier is the one
  // thing C-4 ruled out.
  const advanced = await approveStep(fileId, "finance_invoice_validation");
  if (!advanced.ok) {
    // Purely internal: no number, no email, nothing outside the database. The
    // invoice returns to AWAITING VALIDATION — an approval never touches
    // `submitted_at`, so clearing the validation alone restores it — and the
    // same checker may simply try again. `rejection_reason` is deliberately NOT
    // restored: the approval nulled a motif belonging to a superseded revision,
    // and putting it back would show Finance a stale refusal on an invoice that
    // is merely awaiting review.
    const compensation = await compensationOutcome(
      admin
        .from("invoice")
        .update({ status: "DRAFT", validated_by: null, validated_at: null })
        .eq("id", invoiceId)
        .eq("tenant_id", c.tenantId)
        .eq("status", "VALIDATED")
        .eq("validated_by", c.userId)
        .eq("validated_at", now)
        .eq("revision", loaded.view.revision)
        .select("id"),
    );
    await writeAudit({
      action: AuditActions.PROCESS_DISPATCH_NOT_ADVANCED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      after: {
        file_id: fileId,
        step_key: "finance_invoice_validation",
        invoice_validated: compensation !== "applied",
        compensation,
        reason: advanced.error,
      },
    });
    return fail("step_completion_failed");
  }

  await writeAudit({
    action: AuditActions.INVOICE_VALIDATED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: { maker: loaded.view.submittedBy, checker: c.userId, revision: loaded.view.revision },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------ 21. Finance rejection ----

/**
 * Finance rejects with a MANDATORY reason. The invoice returns to Billing for
 * correction: submitted_at is cleared (reopening the draft) and `revision` is
 * incremented, so the resubmission history is traceable. The prior review is NOT
 * overwritten — the engine keeps the rejected execution row forever and creates a
 * NEW correction row pointing at it.
 */
export async function rejectInvoice(invoiceId: string, reason: string): Promise<BillingResult> {
  const r = validateRejectionReason(reason);
  if (!r.ok) return fail(r.error!);

  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:validate", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  // A rejection is still a review: the checker may not be the maker.
  const check = canValidateInvoice(loaded.view, c.userId);
  if (!check.ok) return fail(check.error!);

  const now = new Date().toISOString();
  const { data } = await admin
    .from("invoice")
    .update({
      // Back to an editable draft: clearing submitted_at is what reopens it.
      submitted_at: null,
      rejected_by: c.userId,
      rejected_at: now,
      rejection_reason: r.value,
      revision: loaded.view.revision + 1,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .not("submitted_at", "is", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("invoice_not_awaiting_validation");

  // The engine freezes the rejected step and opens a NEW correction row.
  //
  // THE RESULT IS KEPT, for the same reason as the approval above: a discarded
  // refusal reopened the invoice for correction while step 21 still said it was
  // awaiting review, and reported that as success.
  const advanced = await rejectStep(fileId, "finance_invoice_validation", r.value!);
  if (!advanced.ok) {
    // Exact reversal of this invocation — not a resurrection. `rejection_reason`
    // goes back to whatever the row already carried before this rejection wrote
    // over it, which is the pre-invocation state by definition.
    const compensation = await compensationOutcome(
      admin
        .from("invoice")
        .update({
          submitted_at: loaded.view.submittedAt,
          rejected_by: null,
          rejected_at: null,
          rejection_reason: loaded.view.rejectionReason,
          revision: loaded.view.revision,
        })
        .eq("id", invoiceId)
        .eq("tenant_id", c.tenantId)
        .eq("status", "DRAFT")
        .is("submitted_at", null)
        .eq("rejected_by", c.userId)
        .eq("rejected_at", now)
        .eq("revision", loaded.view.revision + 1)
        .select("id"),
    );
    await writeAudit({
      action: AuditActions.PROCESS_DISPATCH_NOT_ADVANCED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      after: {
        file_id: fileId,
        step_key: "finance_invoice_validation",
        invoice_reopened: compensation !== "applied",
        compensation,
        reason: advanced.error,
      },
    });
    return fail("step_completion_failed");
  }

  await writeAudit({
    action: AuditActions.INVOICE_VALIDATION_REJECTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // The sanitized reason and identifiers only — never the invoice payload.
    after: {
      maker: loaded.view.submittedBy,
      checker: c.userId,
      reason: r.value,
      revision: loaded.view.revision + 1,
    },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------------ 22. invoice email ----

/**
 * Billing emails the VALIDATED invoice to the client (official step 22).
 *
 * REUSES communication_message end-to-end: its status/retry_count/last_error/
 * sent_at fields ARE the delivery outcome, so no email table is added.
 *
 * IDEMPOTENT: an already-SENT message for this invoice short-circuits, so a
 * double click cannot email the client twice.
 *
 * A successful send does NOT mean paid, does NOT mean deposited, and does NOT
 * close the dossier — it only advances step 22. The invoice moves
 * VALIDATED -> ISSUED here, which is also what first makes it visible in the
 * client portal (portal RLS exposes ISSUED/PARTIALLY_PAID/PAID): a client can
 * never see an invoice that was not actually sent to them.
 */
export async function emailValidatedInvoice(invoiceId: string): Promise<BillingResult<{ id: string; status: string }>> {
  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:issue", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canEmailInvoice(loaded.view);
  if (!check.ok) return fail(check.error!);

  // C-4 — BEFORE anything irreversible. An external act must not run unless the
  // workflow consequence it exists to cause is capable of landing. Refusing here
  // costs nothing; discovering it afterwards costs an email to a customer and an
  // official invoice number that cannot be returned.
  const prepared = await prepareDispatchStep(c, fileId);
  if (!prepared.ready) return fail(prepared.error);

  // Idempotency: already delivered => success, without sending a second email.
  const { data: alreadySent } = await admin
    .from("communication_message")
    .select("id")
    .eq("tenant_id", c.tenantId)
    .eq("related_entity", "invoice")
    .eq("related_entity_id", invoiceId)
    .eq("status", "SENT")
    .limit(1);
  if (((alreadySent ?? []) as Row[]).length > 0) {
    return { ok: true, id: invoiceId, status: "SENT" };
  }

  // DELIVERY MUST BE POSSIBLE BEFORE ANYTHING IS SPENT
  // (STEP22-ISSUANCE-INTEGRITY-01, ratified).
  //
  // A configured provider that fails at runtime is a retryable incident and does
  // NOT undo a legitimate issuance. No provider at all is a different fact: the
  // send cannot succeed now or later under this configuration, so completing
  // official step 22 on it would record a dispatch that can never happen. On
  // EFT-IMP-2026-00013 this is exactly what occurred — `provider_not_configured`
  // burned an official number and the step was closed by hand afterwards.
  //
  // Asked BEFORE the number is allocated, because the whole point is to spend
  // nothing when delivery is impossible. `isProviderConfigured` is the platform's
  // own check, reused; this introduces no second notion of "configured".
  if (!isProviderConfigured()) return fail("delivery_not_configured");

  // The authorized billing contact: the client's primary contact, else the client
  // record's own email. No contact => no send (we never guess a recipient).
  const { data: contacts } = await admin
    .from("client_contact")
    .select("name, email, is_primary")
    .eq("tenant_id", c.tenantId)
    .eq("client_id", loaded.clientId ?? "")
    .not("email", "is", null);
  const rows = (contacts ?? []) as Row[];
  const primary = rows.find((r) => r.is_primary === true) ?? rows[0];

  const { data: client } = await admin
    .from("client")
    .select("name, email")
    .eq("id", loaded.clientId ?? "")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const clientRow = client as Row | null;

  const recipientEmail = str(primary?.email) ?? str(clientRow?.email);
  if (!recipientEmail) return fail("billing_contact_missing");

  // Totals from the existing calculator — no second money model.
  const { data: lines } = await admin
    .from("invoice_line")
    .select("quantity, unit_amount, tax_rate")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", c.tenantId);
  const totals = invoiceTotals(
    ((lines ?? []) as Row[]).map((l) => ({
      quantity: Number(l.quantity ?? 0),
      unitAmount: Number(l.unit_amount ?? 0),
      taxRate: Number(l.tax_rate ?? 0),
    })),
  );

  // ONE official number per invoice, REUSED on any retry.
  //
  // `next_invoice_number` increments an unconditional counter, so every call
  // consumes a value that can never be returned. Whether gaps in the official
  // sequence are acceptable is an OPEN Effitrans ruling and is deliberately not
  // touched here; what this does is stop creating them needlessly. An invoice
  // that already carries a number is re-issuing, not issuing, and asks for
  // nothing new.
  let invoiceNumber = loaded.invoiceNumber;
  if (!invoiceNumber) {
    const { data: allocated } = await admin.rpc("next_invoice_number", { p_tenant: c.tenantId });
    invoiceNumber = (allocated as string | null) ?? invoiceId.slice(0, 8);
  }
  const today = new Date();
  const issueDate = today.toISOString().slice(0, 10);
  const dueDate = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  // THE AUTHORITATIVE ISSUANCE FACT, in ONE compare-and-set, BEFORE the send.
  //
  // This used to run only after a SUCCESSFUL send, which is why a provider
  // failure left the invoice VALIDATED while an official number had already been
  // consumed — and why nothing downstream could tell an issued invoice from a
  // merely validated one. Number and status are written together, so neither
  // state this slice forbids (ISSUED with no number; a number with the invoice
  // still VALIDATED) is representable.
  //
  // FENCED on `status = VALIDATED and invoice_number is null`, so a concurrent
  // second issuance matches zero rows and cannot double-issue.
  // `issue_date` + `issued_by` ARE the persisted issuance identity — the table has
  // no separate `issued_at`, and inventing one would be a schema change this slice
  // is not authorised to make and does not need.
  const { data: issuedRows } = await admin
    .from("invoice")
    .update({
      status: "ISSUED",
      invoice_number: invoiceNumber,
      issue_date: issueDate,
      due_date: dueDate,
      issued_by: c.userId,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "VALIDATED")
    .is("invoice_number", null)
    .select("id");
  if ((issuedRows?.length ?? 0) !== 1) return fail("duplicate_submission");

  await writeAudit({
    action: AuditActions.INVOICE_ISSUED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: { file_id: fileId, invoice_number: invoiceNumber, official_step: "billing_dispatch" },
  });

  // The official document, from the SAME generator the legacy path uses and
  // already idempotent — a retry returns the existing artifact rather than a
  // second, conflicting one. Produced only AFTER the invoice is genuinely
  // ISSUED, so a FINAL_INVOICE can never represent an unissued invoice.
  await ensureOfficialInvoiceArtifact({
    supabase: admin,
    tenantId: c.tenantId,
    invoiceId,
    actorId: c.userId,
  });

  // Branding and rendering are resolved INSIDE queueAndSend — unchanged.
  const sent = await queueAndSend({
    tenantId: c.tenantId,
    createdBy: c.userId,
    templateKey: "invoice_issued",
    vars: {
      clientName: (str(clientRow?.name) ?? "") as string,
      invoiceNumber,
      total: String(totals.total),
      dueDate,
      portalLink: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/portal/invoices/${invoiceId}`,
    },
    recipientEmail,
    recipientName: str(primary?.name) ?? str(clientRow?.name),
    related: "invoice",
    relatedId: invoiceId,
    fileId,
    clientId: loaded.clientId,
  });

  // DELIVERY IS NOW A SEPARATE CONCERN (ratified). The invoice is issued, its
  // number is persisted and its official document exists; a runtime failure of a
  // CONFIGURED provider leaves all of that standing and is retried through the
  // platform's existing outbox, never by re-issuing. The step still completes,
  // because a durable outbound record exists and dispatch has genuinely happened
  // as far as this service can make it happen.
  if (sent.status !== "SENT") {
    // The outbound record is durable and carries status/last_error/retry_count;
    // retrying it is the platform's existing outbox concern, NOT a re-issuance.
    // Nothing here is undone: the number is spent, the document exists, and the
    // client is owed this invoice whether or not the provider answered today.
    await writeAudit({
      action: AuditActions.INVOICE_EMAIL_FAILED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      // Classification only — never the provider error body, never the email body.
      after: {
        file_id: fileId,
        delivery_status: sent.status,
        retryable: true,
        invoice_number: invoiceNumber,
        invoice_issued: true,
      },
    });
  }

  // Step 22 advances on ISSUANCE, and the result is KEPT. It used to advance only
  // on a successful send, which made an unreachable mail provider indistinguishable
  // from an unissued invoice — and left the operator closing the step by hand.
  const advanced = await submitStep(fileId, "billing_dispatch");

  // The send is audited FIRST and unconditionally: it happened, whatever became
  // of the workflow afterwards.
  await writeAudit({
    action: AuditActions.INVOICE_EMAILED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // Recipient + outcome. NEVER the rendered email body.
    after: {
      recipient: recipientEmail,
      invoice_number: invoiceNumber,
      message_id: sent.id,
      delivery_status: sent.status,
    },
  });
  revalidate(fileId);

  // C-4 — THE THIRD STATE. Delivery happened and the invoice is genuinely
  // ISSUED, so neither is undone and no second email is ever attempted: those
  // are the factual external outcomes and rolling them back would be a lie of a
  // different kind. What must not happen is calling this ordinary success while
  // the dossier is stalled. The stall is audited, attributed, and returned as
  // its own outcome so an operator is told to CLOSE THE STEP rather than resend.
  if (!advanced.ok) {
    await writeAudit({
      action: AuditActions.PROCESS_DISPATCH_NOT_ADVANCED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      after: {
        file_id: fileId,
        step_key: "billing_dispatch",
        invoice_number: invoiceNumber,
        delivered: true,
        invoice_issued: true,
        reason: advanced.error,
      },
    });
    return fail("delivered_workflow_not_advanced");
  }

  return { ok: true, id: invoiceId, status: sent.status };
}
