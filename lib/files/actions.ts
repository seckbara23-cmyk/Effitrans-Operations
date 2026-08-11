"use server";

/**
 * Operational File server actions (Phase 1.2). SERVER ACTIONS / SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors Client Management: each action gates on a permission, scopes to the
 * caller's tenant, writes via the service-role admin client, audits, and
 * revalidates. The file number is minted atomically via next_file_number()
 * (DEC-B06). Archive (file:delete) is reserved for the POD/document module.
 *
 * No customs / documents / transport module / finance / invoices.
 */
import { closureBlockers } from "./closure";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import { validateFile } from "./validate";
import { canTransition, isFileStatus, canCancel } from "./status";
import { evaluateHardDelete, type DossierOperationCounts } from "./delete-policy";
import { validateAssignee } from "./assign-policy";
import { canCloseFile } from "@/lib/customs/gates";
import type { ActionResult, FileInput, FileStatus, ShipmentInput } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/** Optional numbers: undefined and "" both mean "not recorded", never zero. */
const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

function shipmentRow(tenantId: string, fileId: string, s: ShipmentInput | undefined) {
  return {
    tenant_id: tenantId,
    file_id: fileId,
    transport_mode: s?.transportMode ?? null,
    incoterm: s?.incoterm?.trim() || null,
    origin: s?.origin?.trim() || null,
    destination: s?.destination?.trim() || null,
    cargo_type: s?.cargoType?.trim() || null,
    carrier_name: s?.carrierName?.trim() || null,
    vessel_or_flight: s?.vesselOrFlight?.trim() || null,
    bl_awb_ref: s?.blAwbRef?.trim() || null,
    container_ref: s?.containerRef?.trim() || null,
    // MAYA-P0.5-B — the cargo declaration. Facts only.
    cargo_form: s?.cargoForm?.trim() || null,
    quantity: num(s?.quantity),
    quantity_unit: s?.quantityUnit?.trim() || null,
    net_weight_kg: num(s?.netWeightKg),
    gross_weight_kg: num(s?.grossWeightKg),
    volume_m3: num(s?.volumeM3),
    package_count: num(s?.packageCount),
    goods_description: s?.goodsDescription?.trim() || null,
    supplier_name: s?.supplierName?.trim() || null,
    warehouse_entry_date: s?.warehouseEntryDate?.trim() || null,
  };
}

/**
 * MAYA-P0.5-B dossier facts. `provenance` and `legacy_reference` are
 * DELIBERATELY absent: they are written by a migration import (P0.5-C, not
 * built), never by an operator creating a dossier here.
 */
function fileFacts(input: FileInput) {
  return {
    parent_file_id: input.parentFileId?.trim() || null,
    client_reference: input.clientReference?.trim() || null,
    on_behalf_of: input.onBehalfOf?.trim() || null,
    processing_due_date: input.processingDueDate?.trim() || null,
  };
}

export async function createFile(input: FileInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateFile(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();

  // Atomic, concurrency-safe number (per tenant x type x year).
  //
  // OPS-SEC-2B — the TRUSTED overload. `admin` is the CurrentUser returned by
  // assertPermission above, so the actor and tenant are both derived from the
  // authenticated session; neither appears in `input`, and neither can be
  // chosen by the browser. The service role carries the call but no longer
  // vouches for it: the database re-proves that this actor exists, is active,
  // belongs to this tenant and holds `file:create` BEFORE allocating a number,
  // so a refusal cannot burn one.
  const { data: fileNumber, error: numErr } = await supabase.rpc("next_file_number", {
    p_tenant: admin.tenantId,
    p_type: input.type,
    p_actor: admin.id,
  });
  if (numErr || !fileNumber) return { ok: false, error: numErr?.message ?? "numbering_failed" };

  const { data, error } = await supabase
    .from("operational_file")
    .insert({
      tenant_id: admin.tenantId,
      file_number: fileNumber,
      type: input.type,
      client_id: input.clientId,
      account_manager_id: admin.id,
      status: "DRAFT",
      priority: input.priority ?? "normal",
      created_by: admin.id,
      ...fileFacts(input),
    })
    .select("id")
    .single();
  if (error || !data) {
    // The parent guard raises in the database (other tenant, self, cycle);
    // surface it as a refusal the form can name rather than a generic failure.
    const msg = error?.message ?? "create_failed";
    return { ok: false, error: /parent dossier/i.test(msg) ? "invalid_parent" : msg };
  }

  // 1:1 shipment detail (always created; carries transport data when relevant).
  const { error: shipErr } = await supabase
    .from("shipment")
    .insert(shipmentRow(admin.tenantId, data.id, input.shipment));
  if (shipErr) return { ok: false, error: shipErr.message };

  await writeAudit({
    action: AuditActions.FILE_CREATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: data.id,
    after: { file_number: fileNumber, type: input.type, client_id: input.clientId },
  });

  revalidatePath("/files");
  return { ok: true, id: data.id };
}

export async function updateFile(id: string, input: FileInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateFile(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("operational_file")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  // A dossier may never be its own parent; the database also proves it, but
  // refusing here keeps the message specific.
  if (input.parentFileId && input.parentFileId === id) return { ok: false, error: "invalid_parent" };

  const { error } = await supabase
    .from("operational_file")
    .update({
      type: input.type,
      client_id: input.clientId,
      priority: input.priority ?? "normal",
      ...fileFacts(input),
    })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) {
    return { ok: false, error: /parent dossier/i.test(error.message) ? "invalid_parent" : error.message };
  }

  // Upsert the 1:1 shipment row.
  const { error: shipErr } = await supabase
    .from("shipment")
    .upsert(shipmentRow(admin.tenantId, id, input.shipment), { onConflict: "file_id" });
  if (shipErr) return { ok: false, error: shipErr.message };

  await writeAudit({
    action: AuditActions.FILE_UPDATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    after: { type: input.type, client_id: input.clientId },
  });

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}

/**
 * Cancel a dossier (Phase 3.2A) — soft, never destroys records. Sets status to
 * CANCELLED, appends the transition (with an optional reason note) and audits.
 * Gate: file:delete (SYSTEM_ADMIN / OPS_SUPERVISOR). Always available for a
 * non-terminal dossier, whether or not it carries operations.
 */
export async function cancelFile(id: string, reason?: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, status, file_number")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const fromStatus = file.status as FileStatus;
  if (!canCancel(fromStatus)) return { ok: false, error: "invalid_transition" };

  const note = reason?.trim() || null;
  const { error } = await supabase
    .from("operational_file")
    .update({ status: "CANCELLED" })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  const { error: histErr } = await supabase.from("file_state_transition").insert({
    tenant_id: admin.tenantId,
    file_id: id,
    from_status: fromStatus,
    to_status: "CANCELLED",
    actor_id: admin.id,
    note,
  });
  if (histErr) return { ok: false, error: histErr.message };

  await writeAudit({
    action: AuditActions.FILE_CANCELLED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    before: { status: fromStatus },
    after: { status: "CANCELLED", file_number: file.file_number, reason: note },
  });

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}

/** Count the dependent records a hard delete would cascade-destroy. */
async function countDossierOperations(
  supabase: Admin,
  tenantId: string,
  fileId: string,
): Promise<DossierOperationCounts> {
  const head = { count: "exact" as const, head: true };
  const [inv, charge, doc, cus, trp, tsk] = await Promise.all([
    supabase.from("invoice").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId),
    supabase.from("billing_charge").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId).is("deleted_at", null),
    supabase.from("document").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId).is("deleted_at", null),
    supabase.from("customs_record").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId).is("deleted_at", null),
    supabase.from("transport_record").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId).is("deleted_at", null),
    supabase.from("task").select("id", head).eq("tenant_id", tenantId).eq("file_id", fileId),
  ]);

  return {
    finance: (inv.count ?? 0) + (charge.count ?? 0),
    documents: doc.count ?? 0,
    customs: cus.count ?? 0,
    transport: trp.count ?? 0,
    tasks: tsk.count ?? 0,
  };
}

/**
 * Hard-delete a dossier (Phase 3.2A) — allowed ONLY for an empty shell (no
 * finance/documents/customs/transport/tasks). Every FK to operational_file
 * cascades, so this guard is what prevents destroying business records; a
 * non-empty dossier returns "has_operations" and must be cancelled instead.
 * Gate: file:delete (SYSTEM_ADMIN / OPS_SUPERVISOR). Audited BEFORE the write.
 */
export async function deleteFile(id: string, reason?: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, status, file_number, type")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const counts = await countDossierOperations(supabase, admin.tenantId, id);
  const decision = evaluateHardDelete(counts);
  if (!decision.allowed) return { ok: false, error: decision.reason };

  // Audit first — the row (and its cascade children) is about to disappear.
  await writeAudit({
    action: AuditActions.FILE_DELETED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    before: { file_number: file.file_number, status: file.status, type: file.type },
    after: { reason: reason?.trim() || null },
  });

  const { error } = await supabase
    .from("operational_file")
    .delete()
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/files");
  return { ok: true };
}

/**
 * Assign (or unassign, when assigneeUserId is null) a dossier to a staff member
 * (Phase 3.2A). The candidate must be an ACTIVE app_user in the SAME tenant
 * (validateAssignee). Audits file.assigned / file.unassigned with the previous +
 * new assignee, and best-effort notifies the NEW assignee (no self/unassign/
 * no-op spam). Gate: file:assign.
 */
/**
 * @deprecated WES-3F — the legacy single-slot dossier assignment.
 *
 * `operational_file.assigned_to_user_id` behaved as a dossier-owner shortcut and
 * was, before WES-3, one of only two non-owner routes into
 * `user_readable_file_ids`. That is why reassigning a dossier could make it
 * disappear for the person who had been working it.
 *
 * WES-3 RETIRES THE SEMANTIC, not the column:
 *   * it no longer grants visibility — removed from `user_readable_file_ids`
 *     in migration `20260727000002`;
 *   * it is no longer a source of operational ownership — that is
 *     `process_instance.owner_user_id`, resolved through
 *     `resolveEffectiveProcessOwner`;
 *   * it no longer represents "the current worker" — people are assigned TASKS
 *     (`assignTaskToUser`) and STEPS (`assignStepToUser`).
 *
 * The column and this action survive a compatibility window so existing rows
 * keep displaying. Its value is NOT copied into any canonical field: the audit
 * found no evidence of what it was ever intended to mean per row, and
 * fabricating an ownership history from it would be worse than leaving it as
 * legacy metadata.
 *
 * REMOVAL CRITERIA: once no read path references `assignedToUserId` and the
 * dossier page shows the canonical four (commercial owner, operational owner,
 * responsible department, current assignee), the column is dropped.
 *
 * Use `assignTaskToUser` / `assignStepToUser` / `assignOperationalOwner`.
 */
export async function assignFile(id: string, assigneeUserId: string | null): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, file_number, assigned_to_user_id")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const previous = file.assigned_to_user_id as string | null;
  const next = assigneeUserId && assigneeUserId.trim() ? assigneeUserId.trim() : null;

  // No-op — same assignee: succeed silently (no audit, no notification spam).
  if (previous === next) return { ok: true, id };

  if (next !== null) {
    const { data: cand } = await supabase
      .from("app_user")
      .select("id, tenant_id, status")
      .eq("id", next)
      .maybeSingle();
    const decision = validateAssignee({
      found: Boolean(cand),
      active: cand?.status === "active",
      sameTenant: cand?.tenant_id === admin.tenantId,
    });
    if (!decision.ok) return { ok: false, error: decision.error };
  }

  const { error } = await supabase
    .from("operational_file")
    .update({ assigned_to_user_id: next })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: next ? AuditActions.FILE_ASSIGNED : AuditActions.FILE_UNASSIGNED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    before: { assigned_to_user_id: previous },
    after: { assigned_to_user_id: next, file_number: file.file_number },
  });

  // Best-effort in-app notification to the NEW assignee only.
  if (next && next !== admin.id) {
    await createNotification({
      tenantId: admin.tenantId,
      userId: next,
      type: "FILE_ASSIGNED",
      fileId: id,
      title: "Dossier assigné",
      body: `Le dossier ${file.file_number} vous a été assigné.`,
    });
  }

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}

export async function transitionFile(id: string, toStatus: string): Promise<ActionResult> {
  let admin;
  try {
    // ADVANCING the status is `file:transition`, NOT `file:update`. The two
    // were conflated, so OPS_SUPERVISOR -- which may open a workflow, assign
    // its owner, complete transport and delete the dossier -- could not move
    // the dossier forward, because it deliberately cannot EDIT master data.
    admin = await assertPermission("file:transition");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!isFileStatus(toStatus)) return { ok: false, error: "invalid_status" };

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, status, type")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const fromStatus = file.status as FileStatus;
  if (!canTransition(fromStatus, toStatus)) return { ok: false, error: "invalid_transition" };

  // Phase 1.9 close guard: an IMP/EXP dossier with a REQUIRED customs record
  // that isn't RELEASED/CANCELLED cannot be closed (customs.required is the
  // escape hatch). No record / non-IMP-EXP / required=false => allowed.
  // CLOSURE GUARD. The lifecycle already DISPLAYED an `await_payment` gate on
  // the archive stage, but nothing enforced it: only customs was checked, so a
  // dossier with an unpaid invoice — or with a payment recorded but never
  // verified — closed without complaint. A displayed gate the server does not
  // enforce is a suggestion, not a control.
  //
  // The rule now lives in ONE pure function that the display and this guard
  // both call, and the refusal names the actual unmet requirement rather than
  // returning a generic failure.
  if (toStatus === "CLOSED") {
    const [customsRes, transportRes, invoiceRes] = await Promise.all([
      supabase.from("customs_record").select("status, required")
        .eq("file_id", id).eq("tenant_id", admin.tenantId).is("deleted_at", null).maybeSingle(),
      supabase.from("transport_record").select("status")
        .eq("file_id", id).eq("tenant_id", admin.tenantId).is("deleted_at", null).maybeSingle(),
      supabase.from("invoice").select("id, status").eq("file_id", id).eq("tenant_id", admin.tenantId),
    ]);

    const invoiceRows = invoiceRes.data ?? [];
    const invoiceIds = invoiceRows.map((i) => i.id as string);
    const [lineRes, payRes] = invoiceIds.length
      ? await Promise.all([
          supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate")
            .eq("tenant_id", admin.tenantId).in("invoice_id", invoiceIds),
          supabase.from("payment").select("invoice_id, amount, reversed_at, verification_status")
            .eq("tenant_id", admin.tenantId).in("invoice_id", invoiceIds),
        ])
      : [{ data: [] }, { data: [] }];

    const invoices = invoiceRows.map((inv) => {
      const invId = inv.id as string;
      const lines = (lineRes.data ?? []).filter((l) => l.invoice_id === invId)
        .map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) }));
      const pays = (payRes.data ?? []).filter((p) => p.invoice_id === invId && p.reversed_at == null);
      const { total } = invoiceTotals(lines);
      const paid = paidAmount(pays.map((p) => ({ amount: Number(p.amount), reversed: false })));
      return { status: inv.status as string, balance: balanceDue(total, paid) };
    });

    const blockers = closureBlockers({
      fileType: file.type as string,
      customs: customsRes.data
        ? { status: customsRes.data.status as string, required: customsRes.data.required as boolean }
        : null,
      transport: transportRes.data ? { status: transportRes.data.status as string } : null,
      invoices,
      payments: (payRes.data ?? [])
        .filter((p) => p.reversed_at == null)
        .map((p) => ({ verified: p.verification_status === "VERIFIED" })),
    });

    if (blockers.length > 0) return { ok: false, error: blockers[0] };
  }

  const patch: { status: string; opened_at?: string } = { status: toStatus };
  if (toStatus === "OPENED") patch.opened_at = new Date().toISOString();

  const { error } = await supabase
    .from("operational_file")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  const { error: histErr } = await supabase.from("file_state_transition").insert({
    tenant_id: admin.tenantId,
    file_id: id,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: admin.id,
  });
  if (histErr) return { ok: false, error: histErr.message };

  await writeAudit({
    action: AuditActions.FILE_TRANSITION,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    before: { status: fromStatus },
    after: { status: toStatus },
  });

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}
