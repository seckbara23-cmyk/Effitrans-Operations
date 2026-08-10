"use server";
/**
 * Employee registry — server actions (Phase HR-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONE write path for public.employee. Every mutation is permission-gated
 * (hr:manage), tenant-scoped, compare-and-set guarded where a state race is
 * possible, and audited with SAFE METADATA ONLY (DEC-B27): ids, status
 * before/after, changed field NAMES, department, dates — never contact values,
 * never emergency-contact values. Salary/national-ID/medical fields do not exist.
 *
 * Boundaries enforced here (DEC-B23/B25/B26):
 *   * an employee may be created/updated with NO platform account;
 *   * linking an account NEVER writes public.user_role (grants nothing) and is
 *     tenant-matched + one-employee-per-account (partial unique backstop);
 *   * termination sets employment status only — it NEVER bans or archives the
 *     linked account; it returns `promptRevocation` so the operator can run the
 *     existing /users flow explicitly (termination ≠ access revocation);
 *   * TERMINATED never returns to ACTIVE — rehire is a new record.
 *
 * NOT engine-flag-gated: HR is a standalone Management surface (like /finance),
 * not a process-engine sub-feature.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";
import { missingTerminationDocuments } from "./employee-file";
import { AuditActions } from "@/lib/audit/events";
import type { Database } from "@/lib/db/types";
import {
  canTransitionEmployee,
  isEmployeeStatus,
  terminationRequiresReason,
  type EmployeeStatus,
} from "./lifecycle";
import { validateEmployeeInput } from "./validate";
import { validateAssignmentTargets, ASSIGNMENT_TARGET_ERROR_FR } from "./assignment-core";

type Tbl = Database["public"]["Tables"];
type Ctx = { userId: string; tenantId: string };

export type HrActionError =
  | "forbidden"
  | "missing_required_document"
  | "not_found"
  | "invalid_input"
  | "invalid_state"
  | "reason_required"
  | "account_not_eligible"
  | "account_already_linked"
  // HR-A2 — warning-first duplicate guard: an ACTIVE-side employee with the
  // same name exists. Never destructive: the caller may confirm with
  // allowDuplicateName (human identity is legitimately ambiguous — homonyms
  // are real people, not errors).
  | "duplicate_name"
  | "write_failed";

export type HrActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: HrActionError; messages?: string[] };

const fail = (error: HrActionError, messages?: string[]): HrActionResult => ({ ok: false, error, messages });

async function guard(): Promise<Ctx | HrActionError> {
  let user;
  try {
    user = await assertPermission("hr:manage");
  } catch {
    return "forbidden";
  }
  return { userId: user.id, tenantId: user.tenantId };
}
const isErr = (v: Ctx | HrActionError): v is HrActionError => typeof v === "string";

export type CreateEmployeeInput = {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  department: string;
  jobTitle?: string | null;
  workLocation?: string | null;
  employmentType?: string | null;
  managerEmployeeId?: string | null;
  hireDate?: string | null;
  probationEndDate?: string | null;
  professionalEmail?: string | null;
  personalEmail?: string | null;
  professionalPhone?: string | null;
  personalPhone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  // HR-A2 — OPTIONAL initial organizational placement (employee_assignment →
  // hr_org_unit, the authoritative model). Tenant + active validated BEFORE
  // the matricule is allocated; absent when the structure is not configured
  // yet. NEVER an authorization input.
  orgUnitId?: string | null;
  // HR-A2 — explicit operator confirmation past the duplicate-name warning.
  allowDuplicateName?: boolean;
};

const clean = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Create an employee (status DRAFT). Matricule is server-assigned. */
export async function createEmployee(input: CreateEmployeeInput): Promise<HrActionResult> {
  const ctx = await guard();
  if (isErr(ctx)) return fail(ctx);

  const errors = validateEmployeeInput({
    firstName: input.firstName,
    lastName: input.lastName,
    department: input.department,
    professionalEmail: input.professionalEmail,
    personalEmail: input.personalEmail,
    employmentType: input.employmentType,
    hireDate: input.hireDate,
    probationEndDate: input.probationEndDate,
  });
  if (errors.length) return fail("invalid_input", errors);

  const admin = getAdminSupabaseClient();

  // Manager (if given) must be an employee in the same tenant.
  const managerId = clean(input.managerEmployeeId);
  if (managerId) {
    const { data: mgr } = await admin
      .from("employee")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", managerId)
      .maybeSingle();
    if (!mgr) return fail("invalid_input", ["Le responsable indiqué est introuvable."]);
  }

  // HR-A2 — duplicate guard, WARNING-FIRST (§11): an exact same-name employee
  // in a non-terminal status refuses once; the operator confirms explicitly
  // with allowDuplicateName (homonyms are legitimate people). Exact
  // case-insensitive match only — never fuzzy, never a unique constraint on
  // names. Runs BEFORE allocation, so a refusal consumes no matricule; it also
  // absorbs an accidental double-submit of the same person.
  if (!input.allowDuplicateName) {
    const esc = (s: string) => s.trim().replace(/[%_\\]/g, "\\$&");
    const { data: dupe } = await admin
      .from("employee")
      .select("id, employee_number")
      .eq("tenant_id", ctx.tenantId)
      .ilike("first_name", esc(input.firstName))
      .ilike("last_name", esc(input.lastName))
      .not("status", "in", "(TERMINATED,ARCHIVED)")
      .limit(1)
      .maybeSingle();
    if (dupe) {
      return fail("duplicate_name", [
        `Un employé en cours porte déjà ce nom (${dupe.employee_number}). S'il s'agit d'une autre personne, confirmez la création.`,
      ]);
    }
  }

  // HR-A2 — initial placement target validated BEFORE the matricule is
  // allocated: a refused creation must never consume a number (§4).
  const orgUnitId = clean(input.orgUnitId);
  if (orgUnitId) {
    const targetError = await validateAssignmentTargets(ctx.tenantId, { orgUnitId });
    if (targetError) return fail("invalid_input", [ASSIGNMENT_TARGET_ERROR_FR[targetError]]);
  }

  // OPS-SEC-2B — the TRUSTED overload. `ctx` comes from guard(), which is
  // assertPermission("hr:manage"), so actor and tenant are session-derived and
  // absent from `input`. The database re-proves the actor holds `hr:manage` in
  // this tenant before allocating, so a refusal advances no sequence.
  const { data: numData, error: numErr } = await admin.rpc("next_employee_number", {
    p_tenant: ctx.tenantId,
    p_actor: ctx.userId,
  });
  if (numErr || !numData) return fail("write_failed");

  const row: Tbl["employee"]["Insert"] = {
    tenant_id: ctx.tenantId,
    employee_number: numData as string,
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    preferred_name: clean(input.preferredName),
    professional_email: clean(input.professionalEmail),
    personal_email: clean(input.personalEmail),
    professional_phone: clean(input.professionalPhone),
    personal_phone: clean(input.personalPhone),
    emergency_contact_name: clean(input.emergencyContactName),
    emergency_contact_phone: clean(input.emergencyContactPhone),
    department: input.department,
    job_title: clean(input.jobTitle),
    manager_employee_id: managerId,
    work_location: clean(input.workLocation),
    employment_type: clean(input.employmentType),
    hire_date: clean(input.hireDate),
    probation_end_date: clean(input.probationEndDate),
    status: "DRAFT",
    created_by: ctx.userId,
  };

  const { data, error } = await admin.from("employee").insert(row).select("id").single();
  if (error || !data) return fail("write_failed");

  // HR-A2 — initial placement, INSIDE the compensable window: the assignment
  // row is inserted BEFORE the 'created' event, so any failure below unwinds
  // cleanly (the append-only ledger cannot be deleted, so nothing may fail
  // after it is written). Initial placement travels in the 'created' payload —
  // there is no separate assignment_changed event for a person who had no
  // previous assignment; employee_assignment itself is the placement history.
  let assignmentId: string | null = null;
  if (orgUnitId) {
    const { data: assignment, error: assignErr } = await admin
      .from("employee_assignment")
      .insert({
        tenant_id: ctx.tenantId,
        employee_id: data.id,
        org_unit_id: orgUnitId,
        assignment_kind: "PRIMARY",
        effective_from: new Date().toISOString().slice(0, 10),
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (assignErr || !assignment) {
      await admin.from("employee").delete().eq("id", data.id).eq("tenant_id", ctx.tenantId);
      return fail("write_failed");
    }
    assignmentId = assignment.id;
  }

  // HR-2 — MANDATORY ledger emission; compensation: assignment + fresh row removed.
  const createdEmitted = await emitHrEvent({
    tenantId: ctx.tenantId, employeeId: data.id, kind: "created", actorId: ctx.userId,
    payload: {
      employee_number: numData,
      department: input.department,
      ...(orgUnitId ? { org_unit_id: orgUnitId } : {}),
    },
  });
  if (!createdEmitted) {
    if (assignmentId) {
      await admin.from("employee_assignment").delete().eq("id", assignmentId).eq("tenant_id", ctx.tenantId);
    }
    await admin.from("employee").delete().eq("id", data.id).eq("tenant_id", ctx.tenantId);
    return fail("write_failed");
  }

  await writeAudit({
    action: AuditActions.HR_EMPLOYEE_CREATED,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    entity: "employee",
    entityId: data.id,
    // Safe metadata only — no contact values.
    after: {
      employee_number: numData,
      department: input.department,
      status: "DRAFT",
      ...(orgUnitId ? { org_unit_id: orgUnitId } : {}),
    },
  });
  return { ok: true, id: data.id };
}

/**
 * Editable employment/contact fields. Employee_number and status are NOT here;
 * neither are the creation-only inputs (orgUnitId — placement changes go
 * through the assignment engine; allowDuplicateName — a creation confirmation).
 */
export type UpdateEmployeeInput = Partial<Omit<CreateEmployeeInput, "orgUnitId" | "allowDuplicateName">>;

const FIELD_MAP: Record<keyof UpdateEmployeeInput, keyof Tbl["employee"]["Update"]> = {
  firstName: "first_name",
  lastName: "last_name",
  preferredName: "preferred_name",
  department: "department",
  jobTitle: "job_title",
  workLocation: "work_location",
  employmentType: "employment_type",
  managerEmployeeId: "manager_employee_id",
  hireDate: "hire_date",
  probationEndDate: "probation_end_date",
  professionalEmail: "professional_email",
  personalEmail: "personal_email",
  professionalPhone: "professional_phone",
  personalPhone: "personal_phone",
  emergencyContactName: "emergency_contact_name",
  emergencyContactPhone: "emergency_contact_phone",
};

export async function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<HrActionResult> {
  const ctx = await guard();
  if (isErr(ctx)) return fail(ctx);

  const errors = validateEmployeeInput(
    {
      firstName: input.firstName,
      lastName: input.lastName,
      department: input.department,
      professionalEmail: input.professionalEmail,
      personalEmail: input.personalEmail,
      employmentType: input.employmentType,
      hireDate: input.hireDate,
      probationEndDate: input.probationEndDate,
    },
    { partial: true },
  );
  if (errors.length) return fail("invalid_input", errors);

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("employee")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return fail("not_found");

  const managerId = clean(input.managerEmployeeId);
  if (input.managerEmployeeId !== undefined && managerId) {
    if (managerId === id) return fail("invalid_input", ["Un employé ne peut pas être son propre responsable."]);
    const { data: mgr } = await admin
      .from("employee")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", managerId)
      .maybeSingle();
    if (!mgr) return fail("invalid_input", ["Le responsable indiqué est introuvable."]);
  }

  const patch: Tbl["employee"]["Update"] = {};
  const changedFields: string[] = [];
  for (const key of Object.keys(input) as (keyof UpdateEmployeeInput)[]) {
    if (input[key] === undefined) continue;
    const col = FIELD_MAP[key];
    const value = key === "firstName" || key === "lastName" ? (input[key] as string).trim() : clean(input[key] as string | null);
    (patch as Record<string, unknown>)[col] = value;
    changedFields.push(col);
  }
  if (changedFields.length === 0) return { ok: true, id };

  const { error } = await admin.from("employee").update(patch).eq("tenant_id", ctx.tenantId).eq("id", id);
  if (error) return fail("write_failed");

  await writeAudit({
    action: AuditActions.HR_EMPLOYEE_UPDATED,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    entity: "employee",
    entityId: id,
    // Only the NAMES of changed fields — never their (possibly personal) values.
    after: { changed_fields: changedFields },
  });
  return { ok: true, id };
}

export type TransitionResult = HrActionResult<{ id: string; status: EmployeeStatus; promptRevocation?: boolean }>;

/**
 * Move an employee through the employment lifecycle. TERMINATED requires a
 * reason. When terminating an employee who has a linked platform account, the
 * result carries `promptRevocation: true` — the caller then offers the EXISTING
 * /users archive/ban flow. This action NEVER revokes access itself.
 */
export async function transitionEmployee(
  id: string,
  toStatus: string,
  reason?: string | null,
): Promise<TransitionResult> {
  const ctx = await guard();
  if (isErr(ctx)) return fail(ctx) as TransitionResult;
  if (!isEmployeeStatus(toStatus)) return fail("invalid_state") as TransitionResult;

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("employee")
    .select("id, status, linked_app_user_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return fail("not_found") as TransitionResult;

  const from = existing.status as EmployeeStatus;
  if (!isEmployeeStatus(from) || !canTransitionEmployee(from, toStatus)) {
    return fail("invalid_state") as TransitionResult;
  }
  const cleanReason = clean(reason);
  if (terminationRequiresReason(toStatus) && !cleanReason) {
    return fail("reason_required") as TransitionResult;
  }

  const patch: Tbl["employee"]["Update"] = { status: toStatus };
  if (toStatus === "TERMINATED") {
    patch.termination_reason = cleanReason;
    patch.termination_date = new Date().toISOString().slice(0, 10);
  }

  // CAS: only transition if still in `from` (guards a concurrent status change).
  // HR-3 — the ratified transition rule (addendum §6): TERMINATED requires the
  // signed « solde de tout compte » (every required_for_termination type).
  if (toStatus === "TERMINATED") {
    const missing = await missingTerminationDocuments(ctx.tenantId, id);
    if (missing.length > 0) return fail("missing_required_document") as TransitionResult;
  }

  const { data: updated, error } = await admin
    .from("employee")
    .update(patch)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) return fail("write_failed") as TransitionResult;
  if (!updated) return fail("invalid_state") as TransitionResult;

  // HR-2 — MANDATORY ledger emission; compensation: the status is reverted.
  const statusEmitted = await emitHrEvent({
    tenantId: ctx.tenantId, employeeId: id, kind: "status_changed", actorId: ctx.userId,
    payload: { from, to: toStatus },
  });
  if (!statusEmitted) {
    await admin.from("employee").update({ status: from }).eq("id", id).eq("tenant_id", ctx.tenantId);
    return fail("write_failed") as TransitionResult;
  }

  await writeAudit({
    action: AuditActions.HR_EMPLOYEE_STATUS_CHANGED,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    entity: "employee",
    entityId: id,
    // Status transition only — the reason TEXT stays on the row, not in the log.
    before: { status: from },
    after: { status: toStatus },
  });

  // Termination of a linked account is NOT revocation. Signal the operator.
  const promptRevocation = toStatus === "TERMINATED" && existing.linked_app_user_id !== null;
  return { ok: true, id, status: toStatus, ...(promptRevocation ? { promptRevocation: true } : {}) };
}

/**
 * Link an employee to an active platform account in the same tenant. Grants
 * NOTHING (never writes user_role). One employee per account (partial unique).
 */
export async function linkEmployeeAccount(id: string, appUserId: string): Promise<HrActionResult> {
  const ctx = await guard();
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();
  const { data: employee } = await admin
    .from("employee")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!employee) return fail("not_found");

  // Target must be an ACTIVE account in the same tenant.
  const { data: account } = await admin
    .from("app_user")
    .select("id, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", appUserId)
    .maybeSingle();
  if (!account || account.status !== "active") return fail("account_not_eligible");

  // One employee per account — friendly check before the DB backstop.
  const { data: taken } = await admin
    .from("employee")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("linked_app_user_id", appUserId)
    .maybeSingle();
  if (taken && taken.id !== id) return fail("account_already_linked");

  const { error } = await admin
    .from("employee")
    .update({ linked_app_user_id: appUserId })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) return fail("account_already_linked"); // partial-unique violation lands here

  // HR-2 — MANDATORY ledger emission; compensation: the link is undone.
  const linkEmitted = await emitHrEvent({
    tenantId: ctx.tenantId, employeeId: id, kind: "account_linked", actorId: ctx.userId,
    payload: { linked_app_user_id: appUserId },
  });
  if (!linkEmitted) {
    await admin.from("employee").update({ linked_app_user_id: null }).eq("id", id).eq("tenant_id", ctx.tenantId);
    return fail("write_failed");
  }

  await writeAudit({
    action: AuditActions.HR_EMPLOYEE_ACCOUNT_LINKED,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    entity: "employee",
    entityId: id,
    // Account id is a safe reference; the account's email is not logged.
    after: { linked_app_user_id: appUserId },
  });
  return { ok: true, id };
}

/** Unlink the platform account. Deletes NEITHER record; grants/revokes nothing. */
export async function unlinkEmployeeAccount(id: string): Promise<HrActionResult> {
  const ctx = await guard();
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();
  const { data: employee } = await admin
    .from("employee")
    .select("id, linked_app_user_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!employee) return fail("not_found");
  if (!employee.linked_app_user_id) return { ok: true, id };

  const { error } = await admin
    .from("employee")
    .update({ linked_app_user_id: null })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) return fail("write_failed");

  // HR-2 — MANDATORY ledger emission; compensation: the link is restored.
  const unlinkEmitted = await emitHrEvent({
    tenantId: ctx.tenantId, employeeId: id, kind: "account_unlinked", actorId: ctx.userId,
    payload: {},
  });
  if (!unlinkEmitted) {
    await admin.from("employee").update({ linked_app_user_id: employee.linked_app_user_id }).eq("id", id).eq("tenant_id", ctx.tenantId);
    return fail("write_failed");
  }

  await writeAudit({
    action: AuditActions.HR_EMPLOYEE_ACCOUNT_UNLINKED,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    entity: "employee",
    entityId: id,
    after: { linked_app_user_id: null },
  });
  return { ok: true, id };
}
