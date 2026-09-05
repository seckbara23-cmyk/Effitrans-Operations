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
import { assertControlStep } from "@/lib/process/control-gate-server";
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
    .select("id, file_id, status, required, bae_reference, declaration_number, declaration_date, receivability_status, receivability_note, release_approval_status, release_approval_by, release_approval_at, release_approval_note, bae_recorded_by, bae_recorded_at, created_by, updated_by, reviewed_at, reviewed_by, external_ref")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/customs");
  // UAT-ICTD-STATE-01 — the governed customs elements ARE the ICTD inputs, so a
  // customs mutation invalidates every performance surface derived from them:
  // the indicators, the BI dashboards and any report DRAFT rendering live.
  // Published reports are unaffected by construction — they render a frozen
  // snapshot and never recompute — so this widens no history.
  revalidatePath("/performance", "layout");
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


  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.create", fileId, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
  }
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


  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.update", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
  }

  // D4 — certified data does not change here. Once the Chef de Transit has
  // validated the record, the only door is the governed correction path, which
  // demands a motif and preserves old → new. Saying so explicitly matters: the
  // control gate happens to refuse this today because the owning step is
  // closed by then, but that is a side effect of sequencing, not a statement
  // about certified data, and it would evaporate the moment a step reopened.
  if (rec.reviewed_at) return { ok: false, error: "validated_use_correction" };

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
      // D4 — the five governed elements. Entered here by the Déclarant, on the
      // ordinary step-gated path; `undefined` leaves a value alone so a partial
      // form never silently erases a captured fact.
      ...(input.shPositionCount === undefined ? {} : { sh_position_count: input.shPositionCount }),
      ...(input.declarationType === undefined ? {} : { declaration_type: input.declarationType }),
      ...(input.dpiRegime === undefined ? {} : { dpi_regime: input.dpiRegime }),
      ...(input.exemptionTitleOrigin === undefined ? {} : { exemption_title_origin: input.exemptionTitleOrigin }),
      ...(input.tariffClassificationOrigin === undefined
        ? {}
        : { tariff_classification_origin: input.tariffClassificationOrigin }),
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


  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.status", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
  }
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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.gainde_registration", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.attachment", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.validation", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
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

/**
 * D4 — the governed correction door (RATIFIED 2026-08-28).
 *
 * « Toute correction après validation est tracée. » Before this existed,
 * validated customs data was de-facto permanently immutable: `updateCustoms`
 * is control-gated to open step states and the owning step is long closed by
 * validation time. That is not what Effitrans asked for — neither free editing
 * nor a locked record, but a correction that leaves a trace.
 *
 * The Chef de Transit corrects; a motif is obligatory; the RPC reads the OLD
 * values itself inside the transaction, so what is recorded as "before" cannot
 * be dictated by the caller. The correction clears the certification — the data
 * is no longer validated, because it is no longer the data that was validated —
 * and the record returns to certified through `revalidateCustoms`.
 */
export async function correctCustoms(
  id: string,
  input: {
    reason: string;
    shPositionCount: number | null;
    declarationType: string | null;
    dpiRegime: string | null;
    exemptionTitleOrigin: string | null;
    tariffClassificationOrigin: string | null;
  },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:correct");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const reason = input.reason?.trim() ?? "";
  if (!reason) return { ok: false, error: "reason_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  // This door is for CERTIFIED data. Uncertified data is corrected where it was
  // entered, on the step-gated update path.
  if (!rec.reviewed_at) return { ok: false, error: "not_validated" };

  const { error } = await supabase.rpc("record_customs_correction", {
    p_customs_id: id,
    p_actor: user.id,
    p_reason: reason,
    p_sh_position_count: input.shPositionCount,
    p_declaration_type: input.declarationType,
    p_dpi_regime: input.dpiRegime,
    p_exemption_title_origin: input.exemptionTitleOrigin,
    p_tariff_classification_origin: input.tariffClassificationOrigin,
  });
  if (error) {
    if (/must change something/i.test(error.message)) return { ok: false, error: "no_change" };
    return { ok: false, error: "record_failed" };
  }

  // The correction history is the authoritative old→new record; this audit row
  // is the platform-wide trail, and says what happened without duplicating it.
  await writeAudit({
    action: AuditActions.CUSTOMS_CORRECTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { reviewed_by: rec.reviewed_by ?? null, reviewed_at: rec.reviewed_at },
    after: { corrected_by: user.id, reason, validation: "cleared_pending_revalidation" },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * D4 — recertification after a governed correction.
 *
 * RATIFIED: either the Chef de Transit or the Déclarant en Douane may
 * revalidate. That is not a weakening of PG-6 — first certification still
 * requires `customs:validate`, which the Déclarant does not hold. It is the
 * cleaner cross-check: the Chef made the change, so a different pair of eyes
 * confirms it, and maker≠checker stays person-level — the corrector may never
 * certify their own correction.
 */
export async function revalidateCustoms(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:revalidate");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }
  if (rec.reviewed_at) return { ok: false, error: "already_validated" };

  // Fail before showing success; the RPC enforces this too, from the history.
  const { data: last } = await supabase
    .from("customs_correction")
    .select("id, corrected_by")
    .eq("customs_id", id)
    .eq("tenant_id", user.tenantId)
    .order("corrected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return { ok: false, error: "never_corrected" };
  if (last.corrected_by === user.id) return { ok: false, error: "self_revalidation" };

  const { error } = await supabase.rpc("record_customs_revalidation", {
    p_customs_id: id,
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_REVALIDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { reviewed_by: user.id, after_correction: last.id },
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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.receivability", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.bae", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
  }

  // TRANSIT-CUSTODY-05. Recording the mainlevée names its author, stamps the
  // moment, and puts the dossier in front of the Chef de Transit — it does NOT
  // release. The previous reference, if this is a correction after a refusal,
  // is carried into the ledger event rather than quietly overwritten.
  const { error } = await supabase.rpc("record_customs_bae", {
    p_customs_id: id,
    p_bae_reference: baeReference.trim(),
    p_actor: user.id,
  });
  if (error) {
    // Same token discipline as the approval below: an already-released record
    // and a missing reference are different refusals and must stay different.
    const token = (error.message ?? "").split(":")[0].trim();
    if (token === "invalid_transition" || token === "reason_required") {
      return { ok: false, error: token };
    }
    return { ok: false, error: "record_failed" };
  }

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

  // RATIFIED 2026-08-24 — permission is necessary, not sufficient: the
  // owning official step must also be open and not claimed by someone else.
  {
    const gate = await assertControlStep("customs.release", rec.file_id, user.tenantId, user.id);
    if (gate) return { ok: false, error: gate };
  }
  if (!canTransition(rec.status as CustomsStatus, "RELEASED")) {
    return { ok: false, error: "invalid_transition" };
  }

  // TRANSIT-CUSTODY-05 — the release rests on an independent verification.
  // Enforced HERE, on the persisted decision, rather than on anything a screen
  // believed: recording the BAE opens the verification, and only the Chef de
  // Transit's APPROVED decision permits the release to proceed. This ADDS a
  // precondition to the ratified control gate above; it does not replace or
  // weaken it, and the release remains the act of whoever legitimately owns it.
  if (rec.release_approval_status !== "APPROVED") {
    return { ok: false, error: "release_not_approved" };
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
 * THE Chef de Transit's independent verification of the customs section
 * (TRANSIT-CUSTODY-05).
 *
 * It decides; it does not release. `recordCustomsRelease` still performs the
 * release under its own ratified control gate — this only supplies the fact
 * that gate had no way to express: that somebody other than the field actor
 * looked at the mainlevée and accepted responsibility for letting the goods
 * move.
 *
 * Authority is `customs:validate` — held by neither the Déclarant nor the field
 * agent — and the ROLE scope above it keeps this the Chef's act rather than any
 * holder's. Maker/checker is enforced in the RPC, on the recorded author, so it
 * cannot be sidestepped by a second permission.
 */
export async function recordCustomsReleaseApproval(
  id: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:validate");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (status === "REJECTED" && !(note ?? "").trim()) {
    return { ok: false, error: "reason_required" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  const { error } = await supabase.rpc("record_customs_release_approval", {
    p_customs_id: id,
    p_status: status,
    p_note: note?.trim() || null,
    p_actor: user.id,
  });
  if (error) {
    // The RPC raises `token: sentence`. Matching the TOKEN, not the prose,
    // means rewording an exception can never silently flatten a precise
    // refusal into one generic word.
    const token = (error.message ?? "").split(":")[0].trim();
    for (const known of ["self_approval_forbidden", "already_decided", "bae_required", "reason_required", "invalid_transition"]) {
      if (token === known) return { ok: false, error: known };
    }
    return { ok: false, error: "approval_failed" };
  }

  await writeAudit({
    action: status === "APPROVED"
      ? AuditActions.CUSTOMS_RELEASE_APPROVED
      : AuditActions.CUSTOMS_RELEASE_REJECTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { release_approval_status: rec.release_approval_status ?? null },
    after: { release_approval_status: status, has_reason: Boolean(note?.trim()) },
  });

  revalidatePath(`/files/${rec.file_id}`);
  revalidatePath(`/files/${rec.file_id}/process`);
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
