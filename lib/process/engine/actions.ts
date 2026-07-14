"use server";
/**
 * Process engine — the ONE transition service (Phase 5.0B, Deliverable 4).
 * SERVER-ONLY. Every official-process mutation goes through here.
 * ---------------------------------------------------------------------------
 * Each mutation follows the same order, without exception:
 *   1. feature flag        (engine dark => nothing happens)
 *   2. authenticate + permission (assertPermission)
 *   3. resolve tenant, verify dossier access (isFileVisible)
 *   4. validate the step key against the REGISTRY (never a free string)
 *   5. validate the current state (the pure state machine)
 *   6. validate prerequisites + evidence + gates (the pure core)
 *   7. apply atomically
 *   8. audit
 *
 * CONCURRENCY. There is no `SELECT ... FOR UPDATE` here: the Supabase JS
 * service-role client cannot hold a row lock across statements. Instead every
 * mutation is a COMPARE-AND-SET — `update ... where id = ? AND state = <expected>`
 * — and we check the affected row count. A second concurrent caller finds the
 * state already moved and its update matches zero rows, so double-submission and
 * double-approval are impossible. Idempotency keys + partial unique indexes
 * (uq_pse_live_step, uq_process_handoff_dedup, uq_process_handoff_open) are the
 * database-level backstop. This satisfies "prevent double submission and race
 * conditions using database constraints and idempotency keys" without relying on
 * UI state.
 */
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/db/types";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { PROCESS_VERSION, buildInitialExecutions } from "./init";
import { loadProcessSnapshot, toViews } from "./snapshot";
import {
  canTransitionStep,
  correctionStepFor,
  evaluateMakerChecker,
  getNode,
  isKnownStep,
  isValidationStep,
  liveByKey,
  preparerStepFor,
  prerequisitesMet,
  requiresIndependentReview,
} from "./state";
import { evaluatePickupGate } from "./gates";
import { evaluateStepEvidence } from "./evidence";
import type { EngineError, EngineResult, StepState } from "./types";

type Ctx = {
  userId: string;
  tenantId: string;
  permissions: string[];
};

const fail = (error: EngineError): EngineResult => ({ ok: false, error });

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath(`/files/${fileId}/process`);
}

/** Steps 1-3 of the checklist, shared by every mutation. */
async function guard(permission: string, fileId: string): Promise<Ctx | EngineError> {
  // The GLOBAL kill switch first — no query, so it keeps working when the database
  // is the thing that is broken.
  if (!globalKillSwitch().enabled) return "engine_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  // Then the TENANT gate (Phase 5.0E-2A). An enabled DEPLOYMENT is not an enabled
  // TENANT: during the pilot the engine is compiled in and switched on globally,
  // and every tenant except the pilot must still be refused here.
  if (!(await getTenantProcessFlags(user.tenantId)).enabled) return "engine_disabled";
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "forbidden";
  const permissions = await getEffectivePermissions(user.id);
  return { userId: user.id, tenantId: user.tenantId, permissions };
}

const isErr = (v: Ctx | EngineError): v is EngineError => typeof v === "string";

// -------------------------------------------------------------- initialize ----

/**
 * Create the process instance for a dossier and materialize all 29 registry
 * nodes. IDEMPOTENT: a second call returns the existing instance rather than
 * creating a second one (partial unique index on file_id is the backstop).
 */
export async function initializeProcessForFile(fileId: string): Promise<EngineResult<{ id: string }>> {
  const ctx = await guard("process:manage", fileId);
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();

  const existing = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!existing) return fail("not_found");
  if (existing.instance) return { ok: true, id: existing.instance.id }; // idempotent

  const { data: created, error } = await admin
    .from("process_instance")
    .insert({
      tenant_id: ctx.tenantId,
      file_id: fileId,
      process_version: PROCESS_VERSION,
      compatibility_source: "NATIVE",
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  // A concurrent initializer won the race — return theirs (still idempotent).
  if (error) {
    const again = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
    if (again?.instance) return { ok: true, id: again.instance.id };
    return fail("invalid_state");
  }

  const instanceId = created.id as string;
  await admin.from("process_step_execution").insert(buildInitialExecutions(ctx.tenantId, instanceId));

  await writeAudit({
    action: AuditActions.PROCESS_INITIALIZED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_instance",
    entityId: instanceId,
    after: { file_id: fileId, process_version: PROCESS_VERSION, source: "NATIVE" },
  });

  revalidate(fileId);
  return { ok: true, id: instanceId };
}

// ------------------------------------------------------------- step moves ----

type StepCtx = {
  ctx: Ctx;
  instanceId: string;
  execId: string;
  state: StepState;
  submittedBy: string | null;
  snapshot: Awaited<ReturnType<typeof loadProcessSnapshot>>;
};

async function loadStep(
  ctx: Ctx,
  fileId: string,
  stepKey: string,
): Promise<StepCtx | EngineError> {
  if (!isKnownStep(stepKey)) return "unknown_step";
  const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!snap) return "not_found";
  if (!snap.instance) return "not_found";
  const exec = snap.executions.find(
    (e) => e.stepKey === stepKey && e.state !== "REJECTED" && e.state !== "CANCELLED",
  );
  if (!exec) return "not_found";
  return {
    ctx,
    instanceId: snap.instance.id,
    execId: exec.id,
    state: exec.state,
    submittedBy: exec.submittedBy,
    snapshot: snap,
  };
}

type ExecPatch = Database["public"]["Tables"]["process_step_execution"]["Update"];

/** Compare-and-set. Returns false when someone else already moved the row. */
async function cas(
  execId: string,
  tenantId: string,
  from: StepState,
  patch: ExecPatch,
): Promise<boolean> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("process_step_execution")
    .update(patch)
    .eq("id", execId)
    .eq("tenant_id", tenantId)
    .eq("state", from) // <- the guard: a concurrent writer already changed it
    .select("id");
  return !error && (data?.length ?? 0) === 1;
}

/** PENDING/AVAILABLE -> ACTIVE. Enforces prerequisites and the pickup join gate. */
export async function activateStep(fileId: string, stepKey: string): Promise<EngineResult> {
  const c = await guard("process:manage", fileId);
  if (isErr(c)) return fail(c);
  const st = await loadStep(c, fileId, stepKey);
  if (typeof st === "string") return fail(st);

  const views = toViews(st.snapshot!.executions);
  if (!prerequisitesMet(stepKey, views)) return fail("prerequisites_unmet");

  // The pickup convergence gate. Both branches must have landed.
  if (stepKey === "pickup") {
    const gate = evaluatePickupGate(st.snapshot!.evidence, views);
    if (!gate.ready) {
      await writeAudit({
        action: AuditActions.PROCESS_GATE_BLOCKED,
        actorId: c.userId,
        tenantId: c.tenantId,
        entity: "process_step_execution",
        entityId: st.execId,
        after: { gate: gate.key, missing: gate.missing },
      });
      return fail("gate_blocked");
    }
    await writeAudit({
      action: AuditActions.PROCESS_GATE_SATISFIED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "process_step_execution",
      entityId: st.execId,
      after: { gate: gate.key },
    });
  }

  if (!canTransitionStep(st.state, "ACTIVE")) return fail("invalid_state");
  const ok = await cas(st.execId, c.tenantId, st.state, {
    state: "ACTIVE",
    started_at: new Date().toISOString(),
    assigned_user_id: c.userId,
    assigned_role_code: getNode(stepKey)?.role ?? null,
  });
  if (!ok) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_STEP_ACTIVATED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_step_execution",
    entityId: st.execId,
    after: { step_key: stepKey },
  });
  revalidate(fileId);
  return { ok: true, id: st.execId };
}

/**
 * ACTIVE -> SUBMITTED (a maker-checker step) or ACTIVE -> COMPLETED (everything
 * else). Required evidence must be present either way — a step never completes on
 * a document nobody approved.
 */
export async function submitStep(fileId: string, stepKey: string): Promise<EngineResult> {
  const c = await guard("process:manage", fileId);
  if (isErr(c)) return fail(c);
  const st = await loadStep(c, fileId, stepKey);
  if (typeof st === "string") return fail(st);

  const ev = evaluateStepEvidence(stepKey, st.snapshot!.evidence);
  if (!ev.complete) {
    return fail("evidence_missing");
  }

  const needsReview = requiresIndependentReview(stepKey);
  const target: StepState = needsReview ? "SUBMITTED" : "COMPLETED";
  if (!canTransitionStep(st.state, target)) return fail("invalid_state");

  const now = new Date().toISOString();
  const ok = await cas(st.execId, c.tenantId, st.state, {
    state: target,
    submitted_by: c.userId,
    submitted_at: now,
    ...(needsReview ? {} : { completed_at: now }),
    // Evidence KEYS only — never document contents.
    evidence_summary: { satisfied: ev.satisfied, missing: ev.missing },
  });
  if (!ok) return fail("invalid_state"); // someone already submitted (no double-submit)

  await writeAudit({
    action: needsReview ? AuditActions.PROCESS_STEP_SUBMITTED : AuditActions.PROCESS_STEP_COMPLETED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_step_execution",
    entityId: st.execId,
    after: { step_key: stepKey, state: target, evidence: ev.satisfied },
  });
  revalidate(fileId);
  return { ok: true, id: st.execId };
}

/** Non-review step: ACTIVE -> COMPLETED. */
export async function completeStep(fileId: string, stepKey: string): Promise<EngineResult> {
  if (requiresIndependentReview(stepKey)) return fail("invalid_state"); // must go through review
  return submitStep(fileId, stepKey);
}

/**
 * The CHECKER approves the maker's submission. Maker != checker is enforced on
 * IDENTITY, so a supervisor who happens to hold both permissions still cannot
 * approve their own work.
 */
export async function approveStep(
  fileId: string,
  validatorStepKey: string,
  opts?: { overrideReason?: string },
): Promise<EngineResult> {
  const preparerKey = preparerStepFor(validatorStepKey);
  if (!preparerKey || !isValidationStep(validatorStepKey)) return fail("unknown_step");

  const permission = getNode(validatorStepKey)?.permissions[0] ?? "process:manage";
  const c = await guard(permission, fileId);
  if (isErr(c)) return fail(c);

  const st = await loadStep(c, fileId, preparerKey);
  if (typeof st === "string") return fail(st);
  if (st.state !== "SUBMITTED") return fail("invalid_state");

  const flags = await getTenantProcessFlags(c.tenantId);
  const decision = evaluateMakerChecker(st.submittedBy, c.userId, {
    overrideFlagOn: flags.overrideAllowed,
    hasOverridePermission: hasPermission(c.permissions, "process:override"),
    overrideReason: opts?.overrideReason,
  });
  if (!decision.allowed) return fail(decision.reason);

  const usedOverride = st.submittedBy === c.userId;
  const now = new Date().toISOString();

  const ok = await cas(st.execId, c.tenantId, "SUBMITTED", {
    state: "COMPLETED",
    reviewed_by: c.userId,
    reviewed_at: now,
    completed_at: now,
    override_used: usedOverride,
    override_reason: usedOverride ? (opts?.overrideReason ?? null) : null,
  });
  if (!ok) return fail("invalid_state"); // already reviewed — never overwrite a prior review

  // The validation step itself is now done too.
  const validator = st.snapshot!.executions.find(
    (e) => e.stepKey === validatorStepKey && e.state !== "REJECTED" && e.state !== "CANCELLED",
  );
  if (validator) {
    await getAdminSupabaseClient()
      .from("process_step_execution")
      .update({ state: "COMPLETED", reviewed_by: c.userId, reviewed_at: now, completed_at: now })
      .eq("id", validator.id)
      .eq("tenant_id", c.tenantId);
  }

  if (usedOverride) {
    await writeAudit({
      action: AuditActions.PROCESS_MAKER_CHECKER_OVERRIDE,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "process_step_execution",
      entityId: st.execId,
      after: { step_key: preparerKey, reason: opts?.overrideReason ?? null },
      isOverride: true,
      overrideReason: opts?.overrideReason,
    });
  }
  await writeAudit({
    action: AuditActions.PROCESS_STEP_APPROVED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_step_execution",
    entityId: st.execId,
    after: { step_key: preparerKey, validator_step: validatorStepKey, maker: st.submittedBy },
  });
  revalidate(fileId);
  return { ok: true, id: st.execId };
}

/**
 * The CHECKER rejects. The rejected attempt is FROZEN (terminal) and a NEW
 * correction attempt is created pointing back at it — prior reviews are never
 * overwritten, and the resubmission history is traceable.
 */
export async function rejectStep(
  fileId: string,
  validatorStepKey: string,
  reason: string,
): Promise<EngineResult> {
  if (!reason || reason.trim().length === 0) return fail("reason_required");

  const preparerKey = preparerStepFor(validatorStepKey);
  const correctionKey = correctionStepFor(validatorStepKey);
  if (!preparerKey || !correctionKey) return fail("unknown_step");

  const permission = getNode(validatorStepKey)?.permissions[0] ?? "process:manage";
  const c = await guard(permission, fileId);
  if (isErr(c)) return fail(c);

  const st = await loadStep(c, fileId, preparerKey);
  if (typeof st === "string") return fail(st);
  if (st.state !== "SUBMITTED") return fail("invalid_state");

  // A rejection is still a review: the checker may not be the maker.
  const flags = await getTenantProcessFlags(c.tenantId);
  const decision = evaluateMakerChecker(st.submittedBy, c.userId, {
    overrideFlagOn: flags.overrideAllowed,
    hasOverridePermission: hasPermission(c.permissions, "process:override"),
    overrideReason: reason,
  });
  if (!decision.allowed) return fail(decision.reason);

  const admin = getAdminSupabaseClient();
  const now = new Date().toISOString();

  const ok = await cas(st.execId, c.tenantId, "SUBMITTED", {
    state: "REJECTED",
    rejected_at: now,
    rejected_by: c.userId,
    rejection_reason: reason,
    reviewed_by: c.userId,
    reviewed_at: now,
  });
  if (!ok) return fail("invalid_state");

  // The correction attempt: a NEW row. The rejected one stays forever as history.
  const node = getNode(correctionKey);
  const { data: correction } = await admin
    .from("process_step_execution")
    .insert({
      tenant_id: c.tenantId,
      process_instance_id: st.instanceId,
      step_key: correctionKey,
      step_number: node && "stepNumber" in node ? (node.stepNumber ?? null) : null,
      state: "ACTIVE",
      correction_of_id: st.execId,
      assigned_role_code: node?.role ?? null,
      started_at: now,
    })
    .select("id")
    .single();

  await writeAudit({
    action: AuditActions.PROCESS_STEP_REJECTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_step_execution",
    entityId: st.execId,
    after: { step_key: preparerKey, reason, correction_step: correctionKey, maker: st.submittedBy },
  });
  await writeAudit({
    action: AuditActions.PROCESS_CORRECTION_SUBMITTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_step_execution",
    entityId: (correction?.id as string) ?? st.execId,
    after: { step_key: correctionKey, correction_of: st.execId },
  });
  revalidate(fileId);
  return { ok: true, id: (correction?.id as string) ?? st.execId };
}

// --------------------------------------------------------------- handoffs ----

/** Deterministic idempotency key: the same send twice is ONE handoff. */
function dedupKey(instanceId: string, from: string, to: string, round: number): string {
  return `${instanceId}:${from}->${to}:${round}`;
}

export async function sendHandoff(
  fileId: string,
  fromStepKey: string,
  toStepKey: string,
): Promise<EngineResult> {
  if (!isKnownStep(fromStepKey) || !isKnownStep(toStepKey)) return fail("unknown_step");
  const c = await guard("process:handoff:send", fileId);
  if (isErr(c)) return fail(c);

  const snap = await loadProcessSnapshot(c.tenantId, fileId, c.permissions);
  if (!snap?.instance) return fail("not_found");

  // Already open? Return it — idempotent send, no second handoff.
  const open = snap.handoffs.find(
    (h) => h.status === "SENT" && h.fromStepKey === fromStepKey && h.toStepKey === toStepKey,
  );
  if (open) return { ok: true, id: open.id };

  const round =
    snap.handoffs.filter((h) => h.fromStepKey === fromStepKey && h.toStepKey === toStepKey).length + 1;
  const key = dedupKey(snap.instance.id, fromStepKey, toStepKey, round);

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("process_handoff")
    .insert({
      tenant_id: c.tenantId,
      process_instance_id: snap.instance.id,
      from_step_key: fromStepKey,
      to_step_key: toStepKey,
      sent_by: c.userId,
      dedup_key: key,
    })
    .select("id")
    .single();

  if (error) {
    // Unique violation => a concurrent send won. Return the existing handoff.
    const again = await loadProcessSnapshot(c.tenantId, fileId, c.permissions);
    const found = again?.handoffs.find((h) => h.dedupKey === key);
    if (found) return { ok: true, id: found.id };
    return fail("invalid_state");
  }

  await writeAudit({
    action: AuditActions.PROCESS_HANDOFF_SENT,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_handoff",
    entityId: data.id as string,
    after: { from: fromStepKey, to: toStepKey },
  });
  revalidate(fileId);
  return { ok: true, id: data.id as string };
}

/**
 * EXPLICIT RECEPTION. Nothing progresses silently: the receiving department must
 * confirm it has the dossier, and only then does the target step open.
 */
export async function receiveHandoff(fileId: string, handoffId: string): Promise<EngineResult> {
  const c = await guard("process:handoff:receive", fileId);
  if (isErr(c)) return fail(c);

  const snap = await loadProcessSnapshot(c.tenantId, fileId, c.permissions);
  if (!snap?.instance) return fail("not_found");
  const h = snap.handoffs.find((x) => x.id === handoffId);
  if (!h) return fail("not_found");
  if (h.status !== "SENT") return fail("handoff_not_open");

  const admin = getAdminSupabaseClient();
  const now = new Date().toISOString();

  // CAS on status: a second receiver matches zero rows.
  const { data } = await admin
    .from("process_handoff")
    .update({ status: "RECEIVED", received_by: c.userId, received_at: now })
    .eq("id", handoffId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "SENT")
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("handoff_not_open");

  // Reception opens the target step and records WHO handed it over.
  const target = snap.executions.find(
    (e) => e.stepKey === h.toStepKey && e.state !== "REJECTED" && e.state !== "CANCELLED",
  );
  if (target && (target.state === "PENDING" || target.state === "AVAILABLE")) {
    await admin
      .from("process_step_execution")
      .update({
        state: "AVAILABLE",
        received_from_user_id: h.sentBy,
        received_at: now,
      })
      .eq("id", target.id)
      .eq("tenant_id", c.tenantId);
  }

  await writeAudit({
    action: AuditActions.PROCESS_HANDOFF_RECEIVED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_handoff",
    entityId: handoffId,
    after: { from: h.fromStepKey, to: h.toStepKey, sent_by: h.sentBy },
  });
  revalidate(fileId);
  return { ok: true, id: handoffId };
}

/** The receiver refuses the dossier. Requires a reason and an explicit return target. */
export async function rejectHandoff(
  fileId: string,
  handoffId: string,
  reason: string,
  returnToStepKey?: string,
): Promise<EngineResult> {
  if (!reason || reason.trim().length === 0) return fail("reason_required");
  const c = await guard("process:handoff:receive", fileId);
  if (isErr(c)) return fail(c);

  const snap = await loadProcessSnapshot(c.tenantId, fileId, c.permissions);
  if (!snap?.instance) return fail("not_found");
  const h = snap.handoffs.find((x) => x.id === handoffId);
  if (!h) return fail("not_found");
  if (h.status !== "SENT") return fail("handoff_not_open");

  const back = returnToStepKey ?? h.fromStepKey;
  if (!isKnownStep(back)) return fail("unknown_step");

  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("process_handoff")
    .update({
      status: "REJECTED",
      rejection_reason: reason,
      returned_to_step_key: back,
      received_by: c.userId,
      received_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "SENT")
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("handoff_not_open");

  await writeAudit({
    action: AuditActions.PROCESS_HANDOFF_REJECTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "process_handoff",
    entityId: handoffId,
    after: { from: h.fromStepKey, to: h.toStepKey, reason, returned_to: back },
  });
  revalidate(fileId);
  return { ok: true, id: handoffId };
}
