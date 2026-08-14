"use server";

/**
 * Customs server actions (Phase 1.9). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gate on permission, verify dossier visibility, write via the service-role
 * admin client, audit, revalidate. Manual reference tracking only (no GAINDE/
 * Orbus). Release is a privileged step (customs:release) requiring a BAE ref.
 * Soft-delete via deleted_at; CANCELLED is the normal workflow abort.
 */
import { isVerified } from "@/lib/documents/doctrine";
import { reconcileDossierProcess } from "@/lib/process/reconcile/service";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { onCustomsReleased } from "@/lib/handoffs/triggers";
import { custCustomsCleared } from "@/lib/customer-notify/triggers";
import { canDeclare, canRelease, requiredCustomsDocCodes } from "./gates";
import { canTransition, isCustomsStatus } from "./status";
import { validateReceivability } from "./receivability";
import type { ActionResult, CustomsInput, CustomsStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadCustoms(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("customs_record")
    .select("id, file_id, status, required, bae_reference, declaration_number, declaration_date, receivability_status, receivability_note, created_by, updated_by, reviewed_at, external_ref")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/customs");
}

/** Codes of customs-prerequisite documents still missing (admin, no extra gate). */
async function missingCustomsDocCodes(
  supabase: Admin,
  tenantId: string,
  fileId: string,
): Promise<string[]> {
  const [gating, shipment, docs] = await Promise.all([
    supabase.from("document_type").select("code").eq("active", true).eq("gates_customs", true),
    supabase.from("shipment").select("transport_mode").eq("file_id", fileId).maybeSingle(),
    supabase
      .from("document")
      .select("type_code, status")
      .eq("tenant_id", tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null),
  ]);
  const mode = (shipment.data?.transport_mode as string | null) ?? null;
  const required = requiredCustomsDocCodes((gating.data ?? []).map((g) => g.code), mode);
  const approved = new Set(
    // UAT-2A — canonical doctrine.
    (docs.data ?? []).filter((d) => isVerified(d.status as string)).map((d) => d.type_code),
  );
  return required.filter((c) => !approved.has(c));
}

export async function createCustoms(fileId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, type")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.tenant_id !== user.tenantId) return { ok: false, error: "file_not_found" };

  const required = file.type === "IMP" || file.type === "EXP";

  // 1:1: revive a soft-deleted record, else reject a live duplicate.
  const { data: existing } = await supabase
    .from("customs_record")
    .select("id, deleted_at")
    .eq("file_id", fileId)
    .maybeSingle();
  if (existing) {
    if (!existing.deleted_at) return { ok: false, error: "already_exists" };
    // WES-1C — revival RESTORES the record; it never rewrites history. A soft
    // delete never cleared the status, bae_reference, declaration or release
    // date, so clearing deleted_at is the whole operation. Resetting to
    // NOT_STARTED here silently discarded a released dossier's BAE evidence as
    // far as every lifecycle projection was concerned.
    const { error } = await supabase
      .from("customs_record")
      .update({ deleted_at: null })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    await writeAudit({
      action: AuditActions.CUSTOMS_CREATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "customs_record",
      entityId: existing.id,
      after: { file_id: fileId },
    });
    revalidate(fileId);
    return { ok: true, id: existing.id };
  }

  const { data, error } = await supabase
    .from("customs_record")
    .insert({ tenant_id: user.tenantId, file_id: fileId, status: "NOT_STARTED", required, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: data.id,
    after: { file_id: fileId },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export async function updateCustoms(id: string, input: CustomsInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("customs_record")
    .update({
      declaration_number: input.declarationNumber?.trim() || null,
      customs_office: input.customsOffice?.trim() || null,
      regime: input.regime?.trim() || null,
      declaration_date: input.declarationDate || null,
      inspection_status: input.inspectionStatus ?? "NOT_REQUIRED",
      external_ref: input.externalRef?.trim() || null,
      notes: input.notes?.trim() || null,
      // MAYA-P0.8-B (PG-6) — attribute the EDIT. This is the information whose
      // exactitude the Chef de Transit later certifies, so whoever wrote it
      // must be excluded from validating it.
      updated_by: user.id,
      ...(input.required === undefined ? {} : { required: input.required }),
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function changeCustomsStatus(id: string, toStatus: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isCustomsStatus(toStatus)) return { ok: false, error: "invalid_status" };
  if (toStatus === "RELEASED") return { ok: false, error: "use_release" }; // privileged path

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const from = rec.status as CustomsStatus;
  if (!canTransition(from, toStatus)) return { ok: false, error: "invalid_transition" };

  // Gate: a declaration can be filed only when no prerequisite document is missing.
  if (toStatus === "DECLARED") {
    const missing = await missingCustomsDocCodes(supabase, user.tenantId, rec.file_id);
    if (!canDeclare(missing)) return { ok: false, error: "customs_docs_missing" };
  }

  const patch: { status: string; declaration_date?: string } = { status: toStatus };
  if (toStatus === "DECLARED" && !rec.declaration_date) {
    patch.declaration_date = new Date().toISOString().slice(0, 10);
  }

  const { error } = await supabase
    .from("customs_record")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  const action =
    toStatus === "DECLARED"
      ? AuditActions.CUSTOMS_DECLARED
      : toStatus === "BLOCKED"
        ? AuditActions.CUSTOMS_BLOCKED
        : AuditActions.CUSTOMS_STATUS_CHANGED;
  await writeAudit({
    action,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: from },
    after: { status: toStatus },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * WES-4E step 1 — RECORD the BAE reference.
 *
 * This is not a release and not a verification. Before WES-4 there was no way
 * to say "the BAE arrived" without simultaneously declaring the goods
 * released: `releaseCustoms` recorded the reference, set RELEASED, stamped the
 * reviewer, fired the Transport handoff and notified the customer, in one call
 * by one person holding one permission.
 *
 * Recording is the Declarant's action. The official evidence is uploaded
 * separately as a BAE document and verified by someone else.
 */
/**
 * MAYA-P0.7-A — record the recevabilité decision (Quality Control N°3).
 *
 * OWNERSHIP comes from first-party evidence: the Effitrans Quality Control
 * Manual places « Recevabilité » under QC N°3, Déclarant en Douane. The
 * declarant already holds `customs:update`, so this needs NO new permission —
 * and deliberately does not use `customs:validate`, which is the Chef de
 * Transit's checker half and must stay separate from the preparer's work.
 *
 * WHAT IT DOES NOT DO:
 *   * it does not evaluate criteria — the manual names the control, not the
 *     checklist, so the outcome is the declarant's judgement and no document
 *     requirement is invented here;
 *   * it does not gate anything — no status moves, no step completes, no
 *     handoff fires. Recording that the control happened is the whole change.
 *
 * Re-deciding is allowed (a refused file becomes receivable once the missing
 * piece arrives); repeating the IDENTICAL decision is refused so the timeline
 * does not accumulate the same fact twice.
 */
/**
 * MAYA-P0.8-A (PG-1) — record the Chef de Transit validation.
 *
 * Closes a gap that had been open since the customs module shipped:
 * `customs:validate` existed, the maker-checker separation existed in the role
 * templates, and `reviewed_by` existed — but nothing ever consumed the
 * permission or wrote the column, so the platform expressed a control it could
 * not perform.
 *
 * THE SERVER CHECKS, AND THEN THE DATABASE CHECKS AGAIN. This action asserts
 * `customs:validate` and refuses an obvious self-validation early so the
 * operator gets a clear message; the RPC re-establishes BOTH independently,
 * because the checker role holds `customs:update` as well and a UI-only
 * separation would be one crafted request away from being bypassed.
 *
 * WHAT IT DOES NOT DO: it moves no customs status, completes no process step,
 * fires no handoff, and asserts no Quality verdict. Recording that the Chef de
 * Transit validated is an operational fact; whether that fact satisfies QC4's
 * « Exactitude des informations » is a business criterion nobody has ratified.
 */
/**
 * MAYA-P1.1 — CEO step 8: Finance records the GAINDE registration.
 *
 * `customs:register` has existed since the process engine shipped, catalogued as
 * « Register the declaration in GAINDE (Finance, step 9) » and granted to the
 * Finance customs role. Nothing consumed it. This is its consumer.
 *
 * IT ASSERTS THE NARROW CAPABILITY AND NOTHING WIDER. `external_ref` is already
 * writable through `updateCustoms`, but that path requires `customs:update` —
 * the declaration-editing authority, which Finance deliberately does not hold.
 * Reaching this one field by widening Finance's customs rights would trade a
 * precise permission for a broad one.
 *
 * WHAT IT DOES NOT DO: it moves no customs status, asserts no synchronisation
 * with GAINDE (there is no API contract — BLK-1), and touches neither
 * `provider_code` nor `provider_synced_at`. The provenance stays « manual »,
 * which is what QC4 reports.
 *
 * MAYA-P1.2 — AND THEN THE PROJECTION CATCHES UP. P1.1 shipped without the
 * reconciliation call below, deliberately: no rule yet proved this step from
 * Finance's fact, so calling it would have completed the step from the
 * DECLARANT's paperwork and called that a Finance act. The rule now reads the
 * milestone, so the call is the ordinary WES-5 convergence every other
 * fact-writing action already performs — and the prohibition it was protecting
 * still holds, because reconciliation completes exactly the steps a fact
 * proves: no status moves, no successor opens, no human-only step is touched.
 */
export async function recordGaindeRegistration(
  id: string,
  reference: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:register");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const ref = reference.trim();
  if (!ref) return { ok: false, error: "reference_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }
  // Fail before showing success; the RPC refuses the duplicate as well.
  if (rec.external_ref === ref) return { ok: false, error: "reference_unchanged" };

  const { error } = await supabase.rpc("record_gainde_registration", {
    p_customs_id: id,
    p_reference: ref,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { external_ref: ref, gainde_registered_by: user.id },
  });

  // WES-5 convergence. Idempotent and never-throwing: the milestone already
  // committed atomically with its own event, and a failed run changes nothing
  // — the next one catches up. Without it the Control Tower would keep asking
  // Finance for an act Finance has durable evidence of having performed.
  await reconcileDossierProcess({
    tenantId: user.tenantId,
    fileId: rec.file_id,
    cause: "gainde_registration",
    actorId: user.id,
  });

  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * MAYA-P1.11 - CEO step 9: the Declarant attaches the documents (rattachement).
 *
 * Effitrans ratified the act: the Declarant scans the Facture, the BL and the
 * required authorizations and attaches them HIMSELF, in GAINDE and ORBUS, with
 * NO automatic synchronisation. This records that he did it. It is registry
 * step 11 `gainde_document_submission`, whose owner, permission, manual nature
 * and prerequisite already matched that description.
 *
 * AUTHORITY is `customs:update` - the permission the registry step already
 * declares, held by CUSTOMS_DECLARANT. No permission is created and no role is
 * widened: every holder could already edit this record.
 *
 * RE-RECORDING IS ALLOWED, deliberately. Effitrans defined the failure path as
 * "la declaration sera bloquee au niveau de la recevabilite, le declarant
 * rattache de nouveau", and a second attempt is normally the SAME documents in
 * the SAME systems - so refusing an identical repeat would block the exact
 * retry the business describes. Every attempt is kept in the ledger.
 *
 * WHAT IT DOES NOT DO: it moves no customs status, asserts no synchronisation
 * with GAINDE or ORBUS (BLK-1 - Effitrans answered "Non"), touches no other
 * customs act, and never requires a screenshot to succeed.
 */
export async function recordCustomsAttachment(
  id: string,
  systems: string[],
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const clean = [...new Set(systems.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (clean.length === 0) return { ok: false, error: "system_required" };
  if (!clean.every((s) => s === "GAINDE" || s === "ORBUS")) {
    return { ok: false, error: "unknown_system" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  const { error } = await supabase.rpc("record_customs_attachment", {
    p_customs_id: id,
    p_systems: clean,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { attachment_systems: clean, attachment_completed_by: user.id },
  });

  // WES-5 convergence - the same path every other fact-writing action uses.
  // Idempotent and never-throwing: the fact already committed with its event.
  await reconcileDossierProcess({
    tenantId: user.tenantId,
    fileId: rec.file_id,
    cause: "customs_attachment",
    actorId: user.id,
  });

  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function recordCustomsValidation(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:validate");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }
  // Fail before showing success. The RPC enforces all of these too.
  // BOTH halves of authorship disqualify: whoever wrote the information may not
  // certify it, whether they wrote it first (created_by) or last (updated_by).
  if (rec.created_by && rec.created_by === user.id) {
    return { ok: false, error: "self_validation" };
  }
  if (rec.updated_by && rec.updated_by === user.id) {
    return { ok: false, error: "self_validation_editor" };
  }
  if (rec.reviewed_at) return { ok: false, error: "already_validated" };

  const { error } = await supabase.rpc("record_customs_validation", {
    p_customs_id: id,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { reviewed_by: user.id },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function recordReceivability(
  id: string,
  outcome: string,
  note: string | null,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  const check = validateReceivability(
    { outcome, note },
    { outcome: rec.receivability_status ?? null, note: rec.receivability_note ?? null },
  );
  if (!check.ok) return { ok: false, error: check.error };

  // The RPC writes the decision and appends the ledger event in ONE
  // transaction, so a decision can never land without leaving a trace.
  const { error } = await supabase.rpc("record_customs_receivability", {
    p_customs_id: id,
    p_status: check.decision.outcome,
    p_note: check.decision.note,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { receivability_status: check.decision.outcome, has_reason: check.decision.note !== null },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function recordBaeReference(
  id: string,
  baeReference: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!baeReference.trim()) return { ok: false, error: "bae_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  const { error } = await supabase.rpc("record_bae_reference", {
    p_customs_id: id,
    p_bae_reference: baeReference.trim(),
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { bae_reference: baeReference.trim() },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * WES-4E step 5 — RECORD the operational customs release (« mainlevée
 * constatée »).
 *
 * A fact Effitrans OBSERVES. Effitrans does not approve Customs and the
 * wording never says it does.
 *
 * What this action does NOT do, deliberately:
 *   * it does not verify the BAE evidence — that is `verifyDocument` on the
 *     BAE document, by someone other than whoever recorded it;
 *   * it does not complete or advance any official process-engine step — WES-5
 *     owns that reconciliation, and a document phase must not move the engine.
 *
 * It still creates the Transport handoff task and the customer notice, exactly
 * as before: those are pre-existing behaviour, they are outside the
 * transaction, and neither can roll the release back.
 */
export async function recordCustomsRelease(
  id: string,
  baeReference: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:release");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!canRelease({ baeReference })) return { ok: false, error: "bae_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }
  if (!canTransition(rec.status as CustomsStatus, "RELEASED")) {
    return { ok: false, error: "invalid_transition" };
  }

  // Atomic: the status, the reference and the release date move together, and
  // the WES-9 customs trigger emits CUSTOMS_RELEASE_COMPLETED and BAE_RECORDED
  // inside the same transaction.
  const { error } = await supabase.rpc("record_customs_release", {
    p_customs_id: id,
    p_bae_reference: baeReference.trim(),
    p_actor: user.id,
    p_release_date: null,
    p_policy_id: null,
  });
  if (error) return { ok: false, error: "release_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_RELEASED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: rec.status },
    after: { status: "RELEASED", bae_reference: baeReference.trim() },
  });

  const cctx = { tenantId: user.tenantId, actorId: user.id };
  await onCustomsReleased(supabase, cctx, rec.file_id);
  await custCustomsCleared(supabase, cctx, rec.file_id);

  // WES-5 — converge the official engine on the new fact. Idempotent and
  // never-throwing: the release already committed atomically with its event,
  // and a failed reconciliation changes nothing (the next run catches up).
  await reconcileDossierProcess({
    tenantId: user.tenantId,
    fileId: rec.file_id,
    cause: "customs_release",
    actorId: user.id,
  });

  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * @deprecated WES-4E — split into `recordBaeReference` (record) and
 * `recordCustomsRelease` (observe the release). Kept as a delegator so no
 * caller silently breaks; it now takes the release path, which is what the
 * single old action always did.
 */
export async function releaseCustoms(id: string, baeReference: string): Promise<ActionResult> {
  return recordCustomsRelease(id, baeReference);
}

export async function deleteCustoms(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };
  // WES-1C — a RELEASED record carries the BAE: the authoritative evidence that
  // the goods may move. Deleting it would make every projection read customs as
  // never started. No ordinary path may do so; WES-1 builds no override system.
  if (rec.status === "RELEASED") return { ok: false, error: "protected_released" };

  const { error } = await supabase
    .from("customs_record")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.CUSTOMS_DELETED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: rec.status },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}
