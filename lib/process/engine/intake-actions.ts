"use server";
/**
 * Operations intake — server actions (Phase 9.0C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The first ACTIVATION slice of the approved lifecycle: open a dossier's
 * official workflow (instance + canonical Operations owner + initial step +
 * legacy DRAFT→OPENED + « Dossier reçu » milestone) and formally hand the work
 * to Transit. This module ORCHESTRATES existing, individually-audited actions —
 * initializeProcessForFile, assignProcessOwner, skipStep, activateEntryStep,
 * sendHandoff, transitionFile, notifyCustomer — it re-implements none of them,
 * so every sub-step keeps its own permission gate, CAS concurrency and audit
 * trail. Idempotent by composition: every constituent is idempotent or
 * dedup-guarded, so a retry converges on the same state and the milestone's
 * dedup key guarantees « Dossier reçu » is published at most once per dossier.
 *
 * Gated on kill.intake (master AND structures AND intake env flags) + the
 * tenant process rollout — identical dark-by-default discipline as everything
 * else. When the 9.0B migration is absent, the structures sub-actions fail
 * closed and this action reports the failure instead of half-opening.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { roleCanonicalDepartment, departmentLabelFr } from "@/lib/organization/departments";
import { roleLabel, ROLE_DISPLAY_PRIORITY } from "@/lib/navigation/roles";
import { createNotification } from "@/lib/notifications/create";
import { notifyCustomer } from "@/lib/customer-notify/service";
import { validateIntake, HANDOFF_BLOCKING_CATEGORIES, type IntakeValidation } from "../intake";
import { initializeProcessForFile, activateEntryStep, sendHandoff } from "./actions";
import { assignProcessOwner, skipStep } from "./structures-actions";
import { transitionFile } from "@/lib/files/actions";
import { loadProcessSnapshot } from "./snapshot";
import { isDone } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { userId: string; tenantId: string; permissions: string[] };

export type IntakeActionResult =
  | { ok: true; instanceId: string; warnings: IntakeValidation["warnings"]; milestonePublished: boolean }
  | { ok: false; error: string; blocking?: IntakeValidation["blocking"] };

export type HandoffActionResult =
  | { ok: true; handoffId: string }
  | { ok: false; error: string; blockers?: { id: string; title: string; category: string }[] };

async function intakeGuard(permission: string, fileId: string): Promise<Ctx | string> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.intake) return "engine_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  const tenantFlags = await getTenantProcessFlags(user.tenantId);
  if (!tenantFlags.enabled || !tenantFlags.intake) return "engine_disabled";
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "forbidden";
  const permissions = await getEffectivePermissions(user.id);
  return { userId: user.id, tenantId: user.tenantId, permissions };
}

const isErr = (v: Ctx | string): v is string => typeof v === "string";

/** The dossier + shipment projection intake validation needs. Tenant-verified. */
/**
 * TEMPORARY UAT-1 INSTRUMENTATION — remove with the diagnostics route.
 * A mutable sink the read path writes stage markers into. Passing it is the
 * ONLY difference between a diagnostic call and a production call, so the two
 * cannot diverge.
 */
export type IntakeDiag = {
  guardPassed: boolean;
  guardError: string | null;
  fileFound: boolean;
  fileInTenant: boolean;
  shipmentQueryOk: boolean;
  shipmentFound: boolean;
  projectionLoaded: boolean;
  snapshotLoaded: boolean;
  processInstanceFound: boolean;
  ownerLoaded: boolean;
  blockersLoaded: boolean;
  validationBuilt: boolean;
  returnedState: boolean;
  caughtException: boolean;
  error: string | null;
  failedAt: string | null;
};

/** async because this is a "use server" module — every export must be async. */
export async function newIntakeDiag(): Promise<IntakeDiag> {
  return {
    guardPassed: false, guardError: null,
    fileFound: false, fileInTenant: false,
    shipmentQueryOk: false, shipmentFound: false,
    projectionLoaded: false, snapshotLoaded: false,
    processInstanceFound: false, ownerLoaded: false, blockersLoaded: false,
    validationBuilt: false, returnedState: false,
    caughtException: false, error: null, failedAt: null,
  };
}

async function loadIntakeProjection(admin: Admin, tenantId: string, fileId: string, diag?: IntakeDiag) {
  const { data: file, error: fileErr } = await admin
    .from("operational_file")
    .select("id, tenant_id, client_id, type, status, file_number")
    .eq("id", fileId)
    .maybeSingle();
  if (diag) {
    diag.fileFound = Boolean(file);
    diag.fileInTenant = Boolean(file && file.tenant_id === tenantId);
    if (fileErr) { diag.error = `operational_file: ${fileErr.message}`; diag.failedAt = "loadIntakeProjection.file"; }
  }
  if (!file || file.tenant_id !== tenantId) return null;
  // NOTE: maybeSingle() THROWS when more than one shipment row exists for the
  // dossier — that throw is caught by getIntakeState and becomes a silent null.
  const { data: shipment, error: shipErr } = await admin
    .from("shipment")
    .select("transport_mode, origin, destination, bl_awb_ref, container_ref, eta")
    .eq("file_id", fileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (diag) {
    diag.shipmentQueryOk = !shipErr;
    diag.shipmentFound = Boolean(shipment);
    if (shipErr) { diag.error = `shipment: ${shipErr.message}`; diag.failedAt = "loadIntakeProjection.shipment"; }
  }
  return { file, shipment };
}

// ============================================================ owner directory ====

export type EligibleOwner = {
  id: string;
  name: string;
  email: string;
  roleLabel: string | null;
  departmentLabel: string | null;
};

/**
 * Active same-tenant staff eligible as canonical Operations owner (their roles
 * map to OPERATIONS in the canonical registry). Bounded; gated on the same
 * permission the assignment itself requires, so this cannot become a general
 * directory-enumeration path.
 */
export async function listEligibleOperationsOwners(): Promise<EligibleOwner[]> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.intake) return [];
  let user;
  try {
    user = await assertPermission("process:owner:assign");
  } catch {
    return [];
  }
  if (!(await getTenantProcessFlags(user.tenantId)).intake) return [];

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
    .filter((s) => (rolesByUser.get(s.id) ?? []).some((code) => roleCanonicalDepartment(code) === "OPERATIONS"))
    .map((s) => {
      const held = new Set(rolesByUser.get(s.id) ?? []);
      const primary = ROLE_DISPLAY_PRIORITY.find((code) => held.has(code)) ?? null;
      return {
        id: s.id,
        name: s.name?.trim() || s.email,
        email: s.email,
        roleLabel: primary ? roleLabel(primary) : null,
        departmentLabel: departmentLabelFr("OPERATIONS"),
      };
    });
}

// ============================================================== intake state ====

export type IntakeState = {
  fileNumber: string;
  fileStatus: string;
  validation: IntakeValidation;
  hasInstance: boolean;
  owner: { name: string; roleLabel: string | null; departmentLabel: string | null; email: string; assignedAt: string | null } | null;
  handoffSent: boolean;
  /** D-2 — official step 3 done? Drives the « prérequis » list on the dossier. */
  amOpeningDone: boolean;
  openBlockers: { id: string; title: string; category: string; status: string; customerVisible: boolean }[];
};

/** Read-side intake state for the panel. Returns null when dark/absent/error. */
export async function getIntakeState(fileId: string, diag?: IntakeDiag): Promise<IntakeState | null> {
  const ctx = await intakeGuard("process:read", fileId);
  if (isErr(ctx)) {
    if (diag) { diag.guardError = ctx; diag.failedAt = "intakeGuard"; }
    return null;
  }
  if (diag) diag.guardPassed = true;
  const admin = getAdminSupabaseClient();

  try {
    const projection = await loadIntakeProjection(admin, ctx.tenantId, fileId, diag);
    if (!projection) {
      if (diag && !diag.failedAt) diag.failedAt = "projection_null";
      return null;
    }
    if (diag) diag.projectionLoaded = true;
    const { file, shipment } = projection;

    const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
    if (diag) diag.snapshotLoaded = true;
    const instance = snap?.instance ?? null;
    if (diag) diag.processInstanceFound = Boolean(instance);

    let owner: IntakeState["owner"] = null;
    let openBlockers: IntakeState["openBlockers"] = [];
    let handoffSent = false;
    let amOpeningDone = false;

    if (instance) {
      const { data: inst } = await admin
        .from("process_instance")
        .select("owner_user_id, owner_assigned_at")
        .eq("id", instance.id)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();
      if (inst?.owner_user_id) {
        const { data: ownerRow } = await admin
          .from("app_user")
          .select("name, email")
          .eq("id", inst.owner_user_id)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle();
        const { data: ownerRoles } = await admin
          .from("user_role")
          .select("role:role_id(code)")
          .eq("tenant_id", ctx.tenantId)
          .eq("user_id", inst.owner_user_id)
          .returns<{ role: { code: string } | { code: string }[] | null }[]>();
        const codes = (ownerRoles ?? [])
          .map((r) => (Array.isArray(r.role) ? r.role[0] : r.role))
          .filter((r): r is { code: string } => Boolean(r))
          .map((r) => r.code);
        const primary = ROLE_DISPLAY_PRIORITY.find((c) => codes.includes(c)) ?? null;
        owner = {
          name: ownerRow?.name?.trim() || ownerRow?.email || "—",
          email: ownerRow?.email ?? "—",
          roleLabel: primary ? roleLabel(primary) : null,
          departmentLabel: departmentLabelFr("OPERATIONS"),
          assignedAt: inst.owner_assigned_at,
        };
      }

      const { data: blockers } = await admin
        .from("process_blocker")
        .select("id, title, category, status, customer_visible")
        .eq("tenant_id", ctx.tenantId)
        .eq("process_instance_id", instance.id)
        .in("status", ["OPEN", "ACKNOWLEDGED"])
        .returns<{ id: string; title: string; category: string; status: string; customer_visible: boolean }[]>();
      openBlockers = (blockers ?? []).map((b) => ({
        id: b.id, title: b.title, category: b.category, status: b.status, customerVisible: b.customer_visible,
      }));
      if (diag) { diag.ownerLoaded = Boolean(owner); diag.blockersLoaded = true; }

      amOpeningDone = (snap?.executions ?? []).some(
        (e) => e.stepKey === "am_dossier_opening" && isDone(e.state),
      );
      handoffSent = (snap?.handoffs ?? []).some(
        (h) => h.toStepKey === "coordinator_reception" && (h.status === "SENT" || h.status === "RECEIVED"),
      );
    }

    const validation = validateIntake({
      clientId: file.client_id,
      fileType: file.type,
      transportMode: shipment?.transport_mode ?? null,
      origin: shipment?.origin ?? null,
      destination: shipment?.destination ?? null,
      reference: shipment?.bl_awb_ref || shipment?.container_ref || null,
      eta: shipment?.eta ?? null,
      // Validation of the SELECTED owner happens at open time; for the read-side
      // readiness display, an already-assigned owner counts.
      ownerUserId: owner ? "assigned" : null,
    });

    if (diag) diag.validationBuilt = true;

    if (diag) diag.returnedState = true;
    return {
      fileNumber: file.file_number,
      fileStatus: file.status,
      validation,
      hasInstance: Boolean(instance),
      amOpeningDone,
      owner,
      handoffSent,
      openBlockers,
    };
  } catch (e) {
    // TEMPORARY UAT-1 INSTRUMENTATION — the swallowed error is surfaced to the
    // diagnostics sink only. Production behaviour is unchanged: still null.
    if (diag) {
      diag.caughtException = true;
      diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (!diag.failedAt) diag.failedAt = "try_block_exception";
    }
    return null; // structures tables absent / transient failure — the panel simply hides
  }
}

// ============================================================== open dossier ====

/**
 * THE canonical opening action. Composes existing idempotent actions in order;
 * the customer milestone is LAST — published only after the instance, the owner
 * and the legacy status transition have all persisted. A retry converges: the
 * initializer returns the existing instance, the owner assignment is idempotent,
 * the skip tolerates "already skipped", and the milestone dedup key
 * (`file_opened:<fileId>`) makes the customer message once-only.
 */
export async function openDossierWorkflow(
  fileId: string,
  input: { ownerUserId: string; skipCotation?: boolean; cotationPrecision?: string | null },
): Promise<IntakeActionResult> {
  const ctx = await intakeGuard("process:manage", fileId);
  if (isErr(ctx)) return { ok: false, error: ctx };
  const admin = getAdminSupabaseClient();

  const projection = await loadIntakeProjection(admin, ctx.tenantId, fileId);
  if (!projection) return { ok: false, error: "not_found" };
  const { file, shipment } = projection;

  const validation = validateIntake({
    clientId: file.client_id,
    fileType: file.type,
    transportMode: shipment?.transport_mode ?? null,
    origin: shipment?.origin ?? null,
    destination: shipment?.destination ?? null,
    reference: shipment?.bl_awb_ref || shipment?.container_ref || null,
    eta: shipment?.eta ?? null,
    ownerUserId: input.ownerUserId,
  });
  if (!validation.ready) return { ok: false, error: "intake_incomplete", blocking: validation.blocking };

  // 1. Instance (idempotent — a second call returns the existing one).
  const init = await initializeProcessForFile(fileId);
  if (!init.ok) return { ok: false, error: init.error };

  // 2. Canonical Operations owner (validates active/same-tenant/OPERATIONS-mapped;
  //    idempotent when unchanged; audited assigned/changed).
  const owned = await assignProcessOwner(fileId, { ownerUserId: input.ownerUserId, reason: "Ouverture du dossier" });
  if (!owned.ok) return { ok: false, error: `owner_${owned.error}` };

  // 3. Cotation: skipped by default at intake so the Operations intake step can
  //    open — but the RECORDED reason is derived, not presumed (QO-1). A devis is
  //    optional: both origins are legitimate, and each gets its honest wording.
  //    Historical executions keep whatever was recorded at the time.
  //
  //    The result is CHECKED. Only one failure is tolerated: a retry where
  //    cotation is already finished — skipping a SKIPPED step is refused by the
  //    state machine, and that refusal must not abort an otherwise valid retry.
  //    Every other failure aborts, because continuing would leave step 4 unable
  //    to open and report success for a workflow that never started.
  if (input.skipCotation !== false) {
    const { data: devis } = await admin
      .from("quotation")
      .select("quotation_number")
      .eq("tenant_id", ctx.tenantId)
      .eq("converted_file_id", fileId)
      .maybeSingle();
    let reason: string;
    if (devis) {
      reason = devis.quotation_number
        ? `Devis N° ${devis.quotation_number} accepté — cotation réalisée côté commercial.`
        : "Devis accepté — cotation réalisée côté commercial.";
    } else {
      reason = "Ouverture directe — dossier sans devis.";
      const precision = (input.cotationPrecision ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (precision) reason += ` Précision : ${precision}`;
    }
    const skipped = await skipStep(fileId, "cotation", { reason, source: "MANUAL" });
    if (!skipped.ok) {
      const after = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
      const cotation = after?.executions.find((e) => e.stepKey === "cotation");
      if (!cotation || !isDone(cotation.state)) {
        return { ok: false, error: `cotation_${skipped.error}` };
      }
    }
  }

  // 4. Open the first Operations step through the ENTRY-STEP path:
  //    PENDING -> AVAILABLE -> ACTIVE. `activateStep` alone cannot do this —
  //    PENDING -> ACTIVE is not a legal transition, and this call previously
  //    discarded that `invalid_state` error, which is how dossiers ended up
  //    opened with zero ACTIVE steps.
  //
  //    Tolerated ONLY when cotation was deliberately KEPT: the step then
  //    legitimately stays PENDING until cotation completes.
  const activated = await activateEntryStep(fileId, "operations_intake");
  if (!activated.ok) {
    const cotationKept = input.skipCotation === false && activated.error === "prerequisites_unmet";
    if (!cotationKept) {
      return { ok: false, error: `activation_${activated.error}` };
    }
  }

  // 5. Legacy lifecycle: a DRAFT dossier formally becomes OPENED through the
  //    EXISTING transition seam (its own permission + audit) — the engine itself
  //    still never writes operational_file.
  if (file.status === "DRAFT") {
    const moved = await transitionFile(fileId, "OPENED");
    if (!moved.ok) return { ok: false, error: "transition_failed" };
  }

  // 6. « Dossier reçu » — canonical customer milestone, ONLY now that everything
  //    persisted. Best-effort by contract (never throws), dedup-guaranteed
  //    once-only, portal inbox + prefs-gated email through the existing pipeline.
  const milestone = await notifyCustomer(admin, { tenantId: ctx.tenantId, actorId: ctx.userId }, {
    event: "file_opened",
    fileId,
  });

  // 7. Staff notification to the owner (existing FILE_ASSIGNED type; best-effort).
  if (input.ownerUserId !== ctx.userId) {
    await createNotification({
      tenantId: ctx.tenantId,
      userId: input.ownerUserId,
      type: "FILE_ASSIGNED",
      fileId,
      title: `Vous êtes responsable opérationnel — ${file.file_number}`,
      body: "Le dossier a été ouvert et vous en êtes le responsable opérationnel.",
    });
  }

  return {
    ok: true,
    instanceId: init.id!,
    warnings: validation.warnings,
    milestonePublished: milestone === "created",
  };
}

// ============================================================ Transit handoff ====

/**
 * Formal transmission to Transit. Operations REMAINS the owner — this changes
 * specialist responsibility, never ownership. Refused while an intake blocker
 * (missing document / customer response required) is open: an incomplete
 * dossier does not travel. The transmission itself is the engine's existing
 * controlled handoff (idempotent, explicit reception, audited).
 */
export async function handDossierToTransit(fileId: string): Promise<HandoffActionResult> {
  const ctx = await intakeGuard("process:handoff:send", fileId);
  if (isErr(ctx)) return { ok: false, error: ctx };
  const admin = getAdminSupabaseClient();

  const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!snap?.instance) return { ok: false, error: "not_found" };

  const { data: blockers } = await admin
    .from("process_blocker")
    .select("id, title, category")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", snap.instance.id)
    .in("status", ["OPEN", "ACKNOWLEDGED"])
    .in("category", [...HANDOFF_BLOCKING_CATEGORIES])
    .returns<{ id: string; title: string; category: string }[]>();
  if (blockers && blockers.length > 0) {
    return { ok: false, error: "blocked_by_intake_blockers", blockers };
  }

  // D-2 (ratified 2026-08-24) — the handoff's own FROM-step must be done first.
  // The registry is explicit: step 3 ends « Transmettre au Coordinateur », step 4
  // lists step 3 as its prerequisite, and this handoff is literally
  // am_dossier_opening -> coordinator_reception. Transmitting earlier put a
  // dossier in Transit's queue that Transit was then correctly forbidden to
  // work — a deadlock, not an overlap. Refused here rather than discovered later.
  const amOpening = snap.executions.find((e) => e.stepKey === "am_dossier_opening");
  if (!amOpening || !isDone(amOpening.state)) {
    return { ok: false, error: "am_opening_incomplete" };
  }

  const sent = await sendHandoff(fileId, "am_dossier_opening", "coordinator_reception");
  if (!sent.ok) return { ok: false, error: sent.error };

  // Notify the receiving side (Coordinator reception + Chef de Transit) —
  // best-effort, role-resolved, never a per-member task assignment.
  const { data: roleRows } = await admin
    .from("role")
    .select("id, code")
    .eq("tenant_id", ctx.tenantId)
    .in("code", ["COORDINATOR", "CHIEF_OF_TRANSIT"]);
  const roleIds = (roleRows ?? []).map((r) => r.id);
  if (roleIds.length > 0) {
    const { data: userRoles } = await admin
      .from("user_role")
      .select("user_id")
      .eq("tenant_id", ctx.tenantId)
      .in("role_id", roleIds);
    const recipientIds = [...new Set((userRoles ?? []).map((u) => u.user_id))].filter((id) => id !== ctx.userId);
    const { data: activeRecipients } = recipientIds.length
      ? await admin.from("app_user").select("id").in("id", recipientIds).eq("tenant_id", ctx.tenantId).eq("status", "active")
      : { data: [] as { id: string }[] };
    const { data: fileRow } = await admin
      .from("operational_file")
      .select("file_number")
      .eq("id", fileId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    for (const r of activeRecipients ?? []) {
      await createNotification({
        tenantId: ctx.tenantId,
        userId: r.id,
        type: "FILE_ASSIGNED",
        fileId,
        title: `Dossier transmis au Transit — ${fileRow?.file_number ?? ""}`.trim(),
        body: "Réception à confirmer : le dossier attend la prise en charge Transit.",
      });
    }
  }

  return { ok: true, handoffId: sent.id! };
}
