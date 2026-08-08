"use server";

/**
 * EC-2 — triage actions.
 *
 * AUTHORITY (ratified EC-2D / DEC-EC-D3):
 *   read the queue            → communication:inbound:read
 *   claim · review · resolve  → communication:triage
 *   reassign someone else     → communication:triage + OPS_SUPERVISOR
 *   attach to a dossier       → communication:triage + the dossier must be
 *                               VISIBLE to this user (isFileVisible)
 *
 * Both permissions are catalogued and GRANTED TO NOBODY until management signs
 * RATIFY-EC1-1/EC2-1, so every action below denies everyone today. That is the
 * intended dark state, not a defect.
 *
 * WHY REASSIGNMENT IS GATED BY ROLE, NOT BY A PERMISSION: the obvious candidate
 * was `communication:manage`, and it is deliberately NOT used — SYSTEM_ADMIN
 * holds it, and reusing it would hand a platform administrator authority over
 * tenant correspondence through the back door.
 *
 * WHAT THESE ACTIONS CANNOT DO: create a quotation, a dossier, a client, a
 * document, a task or an invoice. HANDOFF_TO_QUOTATION records INTENT ONLY —
 * EC-3 owns the quotation entity and nothing here presumes its shape.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getUserRoleCodes } from "@/lib/workflow/access/roles";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { validateOutcome, type OutcomeInput } from "./model";

export type TriageResult = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  EC601: "terminal_item", EC610: "outcome_immutable", EC611: "outcome_required",
  EC612: "outcome_without_resolution", EC613: "quarantined_not_triable",
  EC614: "item_not_found", EC615: "assignee_required", EC616: "invalid_outcome",
  EC617: "dossier_not_found", EC618: "reason_required", EC619: "client_not_found",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code]) || "save_failed",
  detail: e?.message,
});

const PATH = "/mail/inbox";
const SUPERVISORY_ROLE = "OPS_SUPERVISOR";

/** Claim an unassigned item, or assign it to oneself. */
export async function claimTriageItem(itemId: string): Promise<TriageResult> {
  let user;
  try { user = await assertPermission("communication:triage"); } catch { return { ok: false, error: "forbidden" }; }
  return assign(itemId, user.id, user.id, user.tenantId, "claimed");
}

/**
 * Assign or reassign to another user. Reassigning an item that already has an
 * assignee is a SUPERVISORY act (DEC-EC-D3) — checked here, by role.
 */
export async function assignTriageItem(itemId: string, assigneeId: string): Promise<TriageResult> {
  let user;
  try { user = await assertPermission("communication:triage"); } catch { return { ok: false, error: "forbidden" }; }

  const s = getAdminSupabaseClient();
  const { data: current } = await s.from("ec_triage_item")
    .select("assigned_to").eq("id", itemId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!current) return { ok: false, error: "item_not_found" };

  const isReassignment = current.assigned_to !== null && current.assigned_to !== assigneeId;
  if (isReassignment) {
    const roles = await getUserRoleCodes(user.id, user.tenantId);
    if (!roles.includes(SUPERVISORY_ROLE)) return { ok: false, error: "forbidden_reassign" };
  }
  return assign(itemId, assigneeId, user.id, user.tenantId, isReassignment ? "reassigned" : "assigned");
}

async function assign(
  itemId: string, assigneeId: string, actorId: string, tenantId: string, verb: string,
): Promise<TriageResult> {
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("ec_assign_triage", {
    p_tenant: tenantId, p_item: itemId, p_actor: actorId, p_assignee: assigneeId,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  // Identifiers and the verb only — never a subject, sender or body.
  await writeAudit({
    action: `ec.correspondence.${verb}`, actorId, tenantId,
    entity: "ec_triage_item", entityId: itemId, after: { assignee_id: assigneeId },
  });
  revalidatePath(PATH);
  return { ok: true, id: itemId };
}

/** Move an assigned item into review. */
export async function reviewTriageItem(itemId: string): Promise<TriageResult> {
  let user;
  try { user = await assertPermission("communication:triage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("ec_review_triage", {
    p_tenant: user.tenantId, p_item: itemId, p_actor: user.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({
    action: "ec.correspondence.review_started", actorId: user.id, tenantId: user.tenantId,
    entity: "ec_triage_item", entityId: itemId,
  });
  revalidatePath(PATH);
  return { ok: true, id: itemId };
}

/**
 * THE resolution — one entry point for all four outcomes.
 *
 * For ATTACH_TO_DOSSIER the dossier must be VISIBLE to this user, not merely
 * present in the tenant: a triager may not attach correspondence to a dossier
 * they are not authorized to read. The RPC independently re-checks tenant
 * ownership, so cross-tenant attachment is refused twice.
 */
export async function resolveTriageItem(
  itemId: string, input: OutcomeInput,
): Promise<TriageResult> {
  let user;
  try { user = await assertPermission("communication:triage"); } catch { return { ok: false, error: "forbidden" }; }

  const problem = validateOutcome(input);
  if (problem) return { ok: false, error: problem };

  if (input.outcome === "ATTACH_TO_DOSSIER") {
    const visible = await isFileVisible(user.id, user.tenantId, input.fileId!);
    if (!visible) return { ok: false, error: "dossier_not_visible" };
  }

  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("ec_resolve_triage", {
    p_tenant: user.tenantId, p_item: itemId, p_actor: user.id,
    p_outcome: input.outcome,
    p_file_id: input.fileId || null,
    p_client_id: input.clientId || null,
    p_reason_code: input.reasonCode || null,
    p_comment: input.comment || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };

  // C3 DISCIPLINE: the outcome and the reason CODE are recorded; the operator's
  // free-text comment stays in the domain row and never enters the audit trail.
  await writeAudit({
    action: input.outcome === "DISCARD"
      ? "ec.correspondence.discarded"
      : "ec.correspondence.resolved",
    actorId: user.id, tenantId: user.tenantId,
    entity: "ec_triage_item", entityId: itemId,
    after: {
      outcome: input.outcome,
      reason_code: input.reasonCode ?? null,
      dossier_id: input.fileId ?? null,
    },
  });
  revalidatePath(PATH);
  return { ok: true, id: itemId };
}

/**
 * The captured plain-text body, returned as TEXT for escaped rendering.
 *
 * THE HTML BODY IS NEVER RETURNED and never rendered. That is the deliberate
 * answer to safe rendering: with no HTML parsed there is no XSS surface, no
 * tracking pixel, no remote content and no sanitizer to keep current. The
 * stored HTML remains as evidence in the private bucket, reachable only as a
 * download — never injected into a page.
 */
export async function readBodyText(itemId: string): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  let user;
  try { user = await assertPermission("communication:inbound:read"); } catch { return { ok: false, error: "forbidden" }; }

  const s = getAdminSupabaseClient();
  const { data: item } = await s.from("ec_triage_item")
    .select("message_id").eq("id", itemId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!item) return { ok: false, error: "item_not_found" };

  const { data: msg } = await s.from("ec_inbound_message")
    .select("text_body_path").eq("id", item.message_id).eq("tenant_id", user.tenantId).maybeSingle();
  if (!msg?.text_body_path) return { ok: false, error: "no_text_body" };

  const { data, error } = await s.storage.from("ec-inbound").download(msg.text_body_path);
  if (error || !data) return { ok: false, error: "download_failed" };

  const text = (await data.text()).slice(0, 200_000);
  await writeAudit({
    action: "ec.correspondence.body_read", actorId: user.id, tenantId: user.tenantId,
    entity: "ec_inbound_message", entityId: item.message_id,
  });
  return { ok: true, text };
}

/** A short-TTL signed URL for one stored attachment. Never a public URL. */
export async function signAttachment(attachmentId: string): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  let user;
  try { user = await assertPermission("communication:inbound:read"); } catch { return { ok: false, error: "forbidden" }; }

  const s = getAdminSupabaseClient();
  const { data: att } = await s.from("ec_inbound_attachment")
    .select("id, storage_path, stored").eq("id", attachmentId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!att) return { ok: false, error: "not_found" };
  if (!att.stored || !att.storage_path) return { ok: false, error: "not_stored" };

  const { data, error } = await s.storage.from("ec-inbound").createSignedUrl(att.storage_path, 60);
  if (error || !data) return { ok: false, error: "url_failed" };

  await writeAudit({
    action: "ec.correspondence.attachment_accessed", actorId: user.id, tenantId: user.tenantId,
    entity: "ec_inbound_attachment", entityId: att.id,
  });
  return { ok: true, url: data.signedUrl };
}
