"use server";
/**
 * Transit execution — server actions (Phase 9.0D). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The activation slice that runs the dossier through the Transit chain, from
 * the Phase 9.0C handoff to BAE and field dispatch. Like intake-actions.ts,
 * this module ORCHESTRATES existing, individually-audited actions — it builds
 * no second engine and re-implements none of them, so every sub-step keeps its
 * own permission gate, CAS concurrency and audit trail:
 *
 *   reception          → receiveHandoff        (engine)
 *   declarant assign   → assigned_user_id CAS   (this file — column already exists)
 *   team dispatch      → assignStepTeam         (9.0B structures)
 *   finance gate       → request/finalizeProcessDecision (9.0B) + PAYMENT_PENDING blocker
 *   BAE + « dédouanée »→ releaseCustoms          (existing customs action)
 *   observations       → openProcessBlocker      (9.0B)
 *
 * Gated on kill.transitExecution (master AND structures AND intake AND transit
 * env flags) + the tenant rollout — same dark-by-default discipline as
 * everything else. When the 9.0B migration is absent, the structures
 * sub-actions fail closed and the read-side degrades to null (panel hidden).
 * Operations NEVER loses ownership here — no action touches owner columns.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { roleCanonicalDepartment, departmentLabelFr } from "@/lib/organization/departments";
import { roleLabel, ROLE_DISPLAY_PRIORITY } from "@/lib/navigation/roles";
import { createNotification } from "@/lib/notifications/create";
import { receiveHandoff } from "./actions";
import { assignStepTeam, requestProcessDecision, finalizeProcessDecision, openProcessBlocker } from "./structures-actions";
import { releaseCustoms } from "@/lib/customs/actions";
import { isKnownStep } from "./state";
import {
  deriveTransitStages,
  dispatchTeamForMode,
  TRANSIT_STAGE_STEP_KEYS,
  type TransitStageView,
} from "../transit";
import type { EngineError, EngineResult } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { userId: string; tenantId: string; permissions: string[] };

const fail = (error: EngineError): EngineResult => ({ ok: false, error });
const isErr = (v: Ctx | EngineError): v is EngineError => typeof v === "string";

/** Steps a specific Transit user may be assigned to (declarant / chef work). */
const ASSIGNABLE_STEP_KEYS = new Set([
  "transit_declarant_assignment",
  "customs_preparation",
  "gainde_document_submission",
  "customs_followup",
  "customs_field_clearance",
]);

const TEAM_CODES = ["AIBD", "MARITIME"] as const;

async function transitGuard(permission: string, fileId: string): Promise<Ctx | EngineError> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.transitExecution) return "engine_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  const tenantFlags = await getTenantProcessFlags(user.tenantId);
  if (!tenantFlags.enabled || !tenantFlags.transitExecution) return "engine_disabled";
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "forbidden";
  const permissions = await getEffectivePermissions(user.id);
  return { userId: user.id, tenantId: user.tenantId, permissions };
}

/** The ACTIVE instance for a dossier, tenant-verified. */
async function loadInstance(admin: Admin, tenantId: string, fileId: string) {
  const { data } = await admin
    .from("process_instance")
    .select("id, tenant_id, owner_user_id, owner_assigned_at")
    .eq("file_id", fileId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  if (!data || data.tenant_id !== tenantId) return null;
  return data;
}

/** Resolve a user id to a display card (name / primary role / department) — never a UUID. */
async function resolveUserCard(admin: Admin, tenantId: string, userId: string) {
  const { data: u } = await admin
    .from("app_user")
    .select("name, email")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const { data: roles } = await admin
    .from("user_role")
    .select("role:role_id(code)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .returns<{ role: { code: string } | { code: string }[] | null }[]>();
  const codes = (roles ?? [])
    .map((r) => (Array.isArray(r.role) ? r.role[0] : r.role))
    .filter((r): r is { code: string } => Boolean(r))
    .map((r) => r.code);
  const primary = ROLE_DISPLAY_PRIORITY.find((c) => codes.includes(c)) ?? null;
  const dept = primary ? roleCanonicalDepartment(primary) : null;
  return {
    name: u?.name?.trim() || u?.email || "—",
    roleLabel: primary ? roleLabel(primary) : null,
    departmentLabel: dept ? departmentLabelFr(dept) : null,
  };
}

// ============================================================ assignee dir ====

export type TransitAssignee = {
  id: string;
  name: string;
  roleLabel: string | null;
  departmentLabel: string | null;
};

/**
 * Active same-tenant staff whose roles map to canonical TRANSIT — the eligible
 * declarant / chef directory. Bounded, gated on the same permission the
 * assignment requires, so it can never become a general enumeration path.
 * Optional roleCode narrows to one role (e.g. CUSTOMS_DECLARANT).
 */
export async function listEligibleTransitAssignees(roleCode?: string): Promise<TransitAssignee[]> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.transitExecution) return [];
  let user;
  try {
    user = await assertPermission("customs:assign");
  } catch {
    return [];
  }
  if (!(await getTenantProcessFlags(user.tenantId)).transitExecution) return [];

  const admin = getAdminSupabaseClient();
  const { data: staff } = await admin
    .from("app_user")
    .select("id, name, email")
    .eq("tenant_id", user.tenantId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(200)
    .returns<{ id: string; name: string | null; email: string }[]>();
  if (!staff || staff.length === 0) return [];

  const ids = staff.map((s) => s.id);
  const { data: roleRows } = await admin
    .from("user_role")
    .select("user_id, role:role_id(code)")
    .eq("tenant_id", user.tenantId)
    .in("user_id", ids)
    .returns<{ user_id: string; role: { code: string } | { code: string }[] | null }[]>();

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const role = Array.isArray(r.role) ? r.role[0] : r.role;
    if (!role) continue;
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(role.code);
    rolesByUser.set(r.user_id, list);
  }

  return staff
    .filter((s) => {
      const held = rolesByUser.get(s.id) ?? [];
      if (roleCode) return held.includes(roleCode);
      return held.some((code) => roleCanonicalDepartment(code) === "TRANSIT");
    })
    .map((s) => {
      const held = new Set(rolesByUser.get(s.id) ?? []);
      const primary = ROLE_DISPLAY_PRIORITY.find((code) => held.has(code)) ?? null;
      const dept = primary ? roleCanonicalDepartment(primary) : "TRANSIT";
      return {
        id: s.id,
        name: s.name?.trim() || s.email,
        roleLabel: primary ? roleLabel(primary) : null,
        departmentLabel: dept ? departmentLabelFr(dept) : departmentLabelFr("TRANSIT"),
      };
    });
}

// ============================================================ transit state ====

export type TransitState = {
  fileNumber: string;
  fileType: string;
  transportMode: string | null;
  hasInstance: boolean;
  /** Operations remains the owner throughout — shown for reassurance, never editable here. */
  owner: { name: string; roleLabel: string | null; departmentLabel: string | null } | null;
  /** T1–T10 with derived rollup status. */
  stages: TransitStageView[];
  reception: { pending: boolean; received: boolean; handoffId: string | null };
  declarant: { name: string; roleLabel: string | null; departmentLabel: string | null } | null;
  dispatch: { teamCode: string | null; deterministic: boolean; suggestion: string | null };
  bae: { obtained: boolean; reference: string | null; customsStatus: string | null; customsRecordId: string | null };
  paymentGate: { decisionId: string | null; status: string | null; outcome: string | null } | null;
  openBlockers: { id: string; title: string; category: string; status: string; customerVisible: boolean }[];
};

/** Read-side Transit state for the panel. Returns null when dark/absent/error. */
export async function getTransitState(fileId: string): Promise<TransitState | null> {
  const ctx = await transitGuard("process:read", fileId);
  if (isErr(ctx)) return null;
  const admin = getAdminSupabaseClient();

  try {
    const { data: file } = await admin
      .from("operational_file")
      .select("id, tenant_id, type, file_number")
      .eq("id", fileId)
      .maybeSingle();
    if (!file || file.tenant_id !== ctx.tenantId) return null;

    const { data: shipment } = await admin
      .from("shipment")
      .select("transport_mode")
      .eq("file_id", fileId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    const transportMode = shipment?.transport_mode ?? null;

    const instance = await loadInstance(admin, ctx.tenantId, fileId);
    if (!instance) {
      // Instance not yet initialized — the Transit surface has nothing to drive.
      return null;
    }

    const { data: execRows } = await admin
      .from("process_step_execution")
      .select("step_key, state, assigned_user_id, assigned_team_code")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .not("state", "in", "(REJECTED,CANCELLED)")
      .returns<{ step_key: string; state: string; assigned_user_id: string | null; assigned_team_code: string | null }[]>();
    const execs = execRows ?? [];

    const stages = deriveTransitStages(execs.map((e) => ({ stepKey: e.step_key, state: e.state as never })));

    // Reception: the open/received handoff into coordinator_reception.
    const { data: handoffs } = await admin
      .from("process_handoff")
      .select("id, to_step_key, status")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .eq("to_step_key", "coordinator_reception")
      .returns<{ id: string; to_step_key: string; status: string }[]>();
    const sent = (handoffs ?? []).find((h) => h.status === "SENT") ?? null;
    const received = (handoffs ?? []).some((h) => h.status === "RECEIVED");

    // Declarant: whoever owns the preparation step.
    const prep = execs.find((e) => e.step_key === "customs_preparation");
    const declarant = prep?.assigned_user_id
      ? await resolveUserCard(admin, ctx.tenantId, prep.assigned_user_id)
      : null;

    // Dispatch team on the transport_assignment step.
    const dispatchExec = execs.find((e) => e.step_key === "transport_assignment");
    const suggestion = dispatchTeamForMode(transportMode, file.type);

    // BAE + customs status.
    const { data: customs } = await admin
      .from("customs_record")
      .select("id, status, bae_reference")
      .eq("tenant_id", ctx.tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null)
      .maybeSingle();

    // Finance payment-gate decision (latest for this type).
    const { data: decisions } = await admin
      .from("process_decision")
      .select("id, status, outcome, requested_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .eq("decision_type", "CONTINUE_BEFORE_PAYMENT")
      .order("requested_at", { ascending: false })
      .limit(1)
      .returns<{ id: string; status: string; outcome: string | null; requested_at: string }[]>();
    const decision = (decisions ?? [])[0] ?? null;

    // Open blockers.
    const { data: blockers } = await admin
      .from("process_blocker")
      .select("id, title, category, status, customer_visible")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .returns<{ id: string; title: string; category: string; status: string; customer_visible: boolean }[]>();

    const owner = instance.owner_user_id
      ? await resolveUserCard(admin, ctx.tenantId, instance.owner_user_id)
      : null;

    return {
      fileNumber: file.file_number,
      fileType: file.type,
      transportMode,
      hasInstance: true,
      owner,
      stages,
      reception: { pending: Boolean(sent), received, handoffId: sent?.id ?? null },
      declarant,
      dispatch: {
        teamCode: dispatchExec?.assigned_team_code ?? null,
        deterministic: suggestion !== null,
        suggestion,
      },
      bae: {
        obtained: customs?.status === "RELEASED",
        reference: customs?.bae_reference ?? null,
        customsStatus: customs?.status ?? null,
        customsRecordId: customs?.id ?? null,
      },
      paymentGate: decision
        ? { decisionId: decision.id, status: decision.status, outcome: decision.outcome }
        : null,
      openBlockers: (blockers ?? []).map((b) => ({
        id: b.id, title: b.title, category: b.category, status: b.status, customerVisible: b.customer_visible,
      })),
    };
  } catch {
    return null; // structures tables absent / transient failure — the panel hides
  }
}

// ================================================================ reception ====

/**
 * Transit acknowledges receipt of the dossier Operations handed over — the
 * EXISTING explicit-reception machinery (receiveHandoff), which opens
 * coordinator_reception. Idempotent (no open handoff → nothing to receive).
 * Operations ownership is untouched. Notifies the Operations owner.
 */
export async function receiveDossierAtTransit(fileId: string): Promise<EngineResult> {
  const ctx = await transitGuard("process:handoff:receive", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const { data: handoff } = await admin
    .from("process_handoff")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", instance.id)
    .eq("to_step_key", "coordinator_reception")
    .eq("status", "SENT")
    .maybeSingle();
  if (!handoff) return fail("handoff_not_open");

  const res = await receiveHandoff(fileId, handoff.id);
  if (!res.ok) return res;

  await writeAudit({
    action: AuditActions.PROCESS_TRANSIT_RECEIVED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_handoff",
    entityId: handoff.id,
    after: { to: "coordinator_reception" },
  });

  if (instance.owner_user_id && instance.owner_user_id !== ctx.userId) {
    const { data: fileRow } = await admin
      .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
    await createNotification({
      tenantId: ctx.tenantId,
      userId: instance.owner_user_id,
      type: "FILE_ASSIGNED",
      fileId,
      title: `Dossier réceptionné par le Transit — ${fileRow?.file_number ?? ""}`.trim(),
      body: "Le Transit a confirmé la réception du dossier et démarre les formalités.",
    });
  }
  return { ok: true, id: handoff.id };
}

// =============================================================== assignment ====

/**
 * Assign a Transit step (declarant preparation, field follow-up…) to a specific
 * eligible Transit user. Writes only assigned_user_id (the column already
 * exists) — it grants NOTHING and never touches ownership or team targeting.
 * The assignee must be an ACTIVE same-tenant TRANSIT-mapped staff user.
 */
export async function assignTransitStep(
  fileId: string,
  stepKey: string,
  userId: string,
): Promise<EngineResult> {
  const ctx = await transitGuard("customs:assign", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isKnownStep(stepKey) || !ASSIGNABLE_STEP_KEYS.has(stepKey)) return fail("unknown_step");
  const admin = getAdminSupabaseClient();

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  // Eligibility: active, same tenant, TRANSIT-mapped.
  const { data: staff } = await admin
    .from("app_user").select("id, tenant_id, status").eq("id", userId).maybeSingle();
  if (!staff || staff.tenant_id !== ctx.tenantId || staff.status !== "active") return fail("not_found");
  const { data: staffRoles } = await admin
    .from("user_role").select("role:role_id(code)").eq("tenant_id", ctx.tenantId).eq("user_id", userId)
    .returns<{ role: { code: string } | { code: string }[] | null }[]>();
  const isTransit = (staffRoles ?? [])
    .map((r) => (Array.isArray(r.role) ? r.role[0] : r.role))
    .some((r) => r && roleCanonicalDepartment(r.code) === "TRANSIT");
  if (!isTransit) return fail("forbidden");

  const { data: exec } = await admin
    .from("process_step_execution")
    .select("id, state")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", instance.id)
    .eq("step_key", stepKey)
    .not("state", "in", "(REJECTED,CANCELLED,COMPLETED,SKIPPED)")
    .maybeSingle();
  if (!exec) return fail("not_found");

  const { data: updated, error } = await admin
    .from("process_step_execution")
    .update({ assigned_user_id: userId })
    .eq("id", exec.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("state", exec.state) // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_STEP_ASSIGNED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_step_execution",
    entityId: exec.id,
    after: { step_key: stepKey, assigned_user_id: userId },
  });

  if (userId !== ctx.userId) {
    const { data: fileRow } = await admin
      .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
    await createNotification({
      tenantId: ctx.tenantId,
      userId,
      type: "FILE_ASSIGNED",
      fileId,
      title: `Étape Transit qui vous est affectée — ${fileRow?.file_number ?? ""}`.trim(),
      body: "Une étape du dossier vous a été affectée par le Transit.",
    });
  }
  return { ok: true, id: exec.id };
}

// ============================================================= finance gate ====

/**
 * Request the « continuer avant paiement » decision at the Finance seam
 * (T6) — the EXISTING recorded-decision contract (CONTINUE_BEFORE_PAYMENT).
 * Reason mandatory (enforced by requestProcessDecision). Notifies the deciders
 * (supervisors) and Finance. Records NOTHING financial — Finance stays the only
 * financial truth.
 */
export async function requestPaymentGateDecision(fileId: string, reason: string): Promise<EngineResult> {
  const ctx = await transitGuard("process:decision:create", fileId);
  if (isErr(ctx)) return fail(ctx);

  const res = await requestProcessDecision(fileId, {
    decisionType: "CONTINUE_BEFORE_PAYMENT",
    reason,
    stepKey: "coordinator_to_finance",
  });
  if (!res.ok) return res;

  await notifyRoles(ctx, fileId, ["OPS_SUPERVISOR", "FINANCE_OFFICER", "CUSTOMS_FINANCE_OFFICER"],
    "Décision « continuer avant paiement » demandée", "Une décision de paiement est en attente sur un dossier.");
  return res;
}

/**
 * Finalize the payment-gate decision. Reuses finalizeProcessDecision (immutable
 * once finalized, gated on process:decision:approve). BLOCK_UNTIL_PAYMENT also
 * opens a PAYMENT_PENDING blocker so downstream work is visibly stopped. The
 * decision NEVER marks payment paid.
 */
export async function finalizePaymentGateDecision(
  fileId: string,
  decisionId: string,
  outcome: string,
  conditions?: string,
): Promise<EngineResult> {
  const ctx = await transitGuard("process:decision:approve", fileId);
  if (isErr(ctx)) return fail(ctx);

  const res = await finalizeProcessDecision(fileId, decisionId, { outcome, conditions });
  if (!res.ok) return res;

  if (outcome === "BLOCK_UNTIL_PAYMENT") {
    // Best-effort: a visible stop-marker. Never overwrites financial truth.
    await openProcessBlocker(fileId, {
      category: "PAYMENT_PENDING",
      title: "Paiement en attente — travail suspendu jusqu'au règlement",
      severity: "HIGH",
      stepKey: "coordinator_to_finance",
    });
  }
  return res;
}

// ==================================================================== BAE ====

/**
 * Record the BAE (Bon À Enlever) — the EXISTING customs release action, which
 * writes bae_reference, fires the customer « Marchandise dédouanée »
 * (« Autorisation obtenue ») milestone and the customs → transport handoff. The
 * engine's customs_field_clearance step then completes through its own action
 * once this evidence is present. Notifies the Operations owner. « Autorisation
 * obtenue » is therefore published only when a real BAE reference is recorded.
 */
export async function recordBae(fileId: string, baeReference: string): Promise<EngineResult> {
  const ctx = await transitGuard("customs:release", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!baeReference || baeReference.trim().length === 0) return fail("reason_required");
  const admin = getAdminSupabaseClient();

  const { data: customs } = await admin
    .from("customs_record")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customs) return fail("not_found");

  const res = await releaseCustoms(customs.id, baeReference.trim());
  if (!res.ok) return fail(res.error === "bae_required" ? "reason_required" : "invalid_state");

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (instance?.owner_user_id && instance.owner_user_id !== ctx.userId) {
    const { data: fileRow } = await admin
      .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
    await createNotification({
      tenantId: ctx.tenantId,
      userId: instance.owner_user_id,
      type: "FILE_ASSIGNED",
      fileId,
      title: `BAE obtenu — ${fileRow?.file_number ?? ""}`.trim(),
      body: "Le Bon À Enlever a été obtenu ; la marchandise peut être enlevée.",
    });
  }
  return { ok: true, id: customs.id };
}

// =============================================================== dispatch ====

/**
 * Dispatch the dossier to a field team (AIBD / Maritime) — the T9 shape over the
 * EXISTING assignStepTeam (targets the team on transport_assignment, grants
 * nothing). Air → AIBD and sea → Maritime are deterministic; road/handling/
 * multimodal require an explicit teamCode + reason (authorized override). The
 * team members are notified; Operations ownership is untouched.
 */
export async function dispatchToField(
  fileId: string,
  input?: { teamCode?: string; reason?: string },
): Promise<EngineResult> {
  const ctx = await transitGuard("process:team:manage", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const { data: file } = await admin
    .from("operational_file").select("id, tenant_id, type").eq("id", fileId).maybeSingle();
  if (!file || file.tenant_id !== ctx.tenantId) return fail("not_found");
  const { data: shipment } = await admin
    .from("shipment").select("transport_mode").eq("file_id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();

  const deterministic = dispatchTeamForMode(shipment?.transport_mode ?? null, file.type);
  let team = deterministic;
  if (!team) {
    // Ambiguous mode — an explicit, reasoned override is required.
    if (!input?.teamCode || !(TEAM_CODES as readonly string[]).includes(input.teamCode)) return fail("invalid_state");
    if (!input.reason || input.reason.trim().length === 0) return fail("reason_required");
    team = input.teamCode as (typeof TEAM_CODES)[number];
  } else if (input?.teamCode && input.teamCode !== deterministic) {
    // Overriding the deterministic team also needs a reason.
    if (!(TEAM_CODES as readonly string[]).includes(input.teamCode)) return fail("invalid_state");
    if (!input.reason || input.reason.trim().length === 0) return fail("reason_required");
    team = input.teamCode as (typeof TEAM_CODES)[number];
  }

  const res = await assignStepTeam(fileId, "transport_assignment", team);
  if (!res.ok) return res;

  // Notify active members of the target team (best-effort; the team, not everyone).
  const { data: members } = await admin
    .from("organization_team_member")
    .select("app_user_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("team_code", team)
    .eq("active", true)
    .returns<{ app_user_id: string }[]>();
  const memberIds = [...new Set((members ?? []).map((m) => m.app_user_id))].filter((id) => id !== ctx.userId);
  if (memberIds.length > 0) {
    const { data: active } = await admin
      .from("app_user").select("id").in("id", memberIds).eq("tenant_id", ctx.tenantId).eq("status", "active")
      .returns<{ id: string }[]>();
    const { data: fileRow } = await admin
      .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
    for (const m of active ?? []) {
      await createNotification({
        tenantId: ctx.tenantId,
        userId: m.id,
        type: "FILE_ASSIGNED",
        fileId,
        title: `Dossier à traiter — équipe ${team} — ${fileRow?.file_number ?? ""}`.trim(),
        body: "Un dossier a été dispatché à votre équipe pour l'exécution terrain.",
      });
    }
  }
  return res;
}

// ================================================================ helpers ====

/** Notify active holders of any of the given roles (best-effort, never the actor). */
async function notifyRoles(ctx: Ctx, fileId: string, roleCodes: string[], title: string, body: string) {
  const admin = getAdminSupabaseClient();
  const { data: roleRows } = await admin
    .from("role").select("id").eq("tenant_id", ctx.tenantId).in("code", roleCodes)
    .returns<{ id: string }[]>();
  const roleIds = (roleRows ?? []).map((r) => r.id);
  if (roleIds.length === 0) return;
  const { data: userRoles } = await admin
    .from("user_role").select("user_id").eq("tenant_id", ctx.tenantId).in("role_id", roleIds)
    .returns<{ user_id: string }[]>();
  const recipientIds = [...new Set((userRoles ?? []).map((u) => u.user_id))].filter((id) => id !== ctx.userId);
  if (recipientIds.length === 0) return;
  const { data: active } = await admin
    .from("app_user").select("id").in("id", recipientIds).eq("tenant_id", ctx.tenantId).eq("status", "active")
    .returns<{ id: string }[]>();
  const { data: fileRow } = await admin
    .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
  for (const r of active ?? []) {
    await createNotification({
      tenantId: ctx.tenantId,
      userId: r.id,
      type: "FILE_ASSIGNED",
      fileId,
      title: `${title} — ${fileRow?.file_number ?? ""}`.trim(),
      body,
    });
  }
}
