"use server";

/**
 * CEO-ALIGNMENT WP1-E — governed expiry-date changes. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * CEO-010 / CEO-006. The two doors, and the only two:
 *
 *   requestDocumentExpiryChange  `document:update` + dossier visibility.
 *                                Unverified document → applied at once.
 *                                Verified document   → recorded as a PROPOSAL.
 *   decideDocumentExpiryChange   `document:approve` + dossier visibility, and
 *                                never the proposer.
 *
 * DEFENCE IN DEPTH, deliberately repeated: the permission is checked here so
 * the operator gets a sentence; the RPC re-proves the SAME actor through
 * `assert_actor_authority` (SERVICE lane), so a forged call through the service
 * key still meets the rule; and `trg_document_expiry_governed` refuses any
 * expiry move that the history does not record — so even a direct UPDATE that
 * bypassed both cannot rewrite a date silently.
 *
 * WHAT THIS NEVER DOES: change `document.status`, change bytes, invent a
 * validity duration, or let anyone confirm their own proposal.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { expiryGovernanceAvailable } from "./expiry-governance-161";
import { validateExpiryDecision, validateExpiryRequest } from "./expiry-change";

export type ExpiryActionResult =
  | { ok: true; outcome: "applied" | "proposed" | "confirmed" | "rejected" }
  | { ok: false; error: string };

/** The RPCs are not in lib/db/types.ts until #161 is applied. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Result codes the RPCs return as data (refusals the operator can cause). */
const RPC_OUTCOMES = new Set([
  "applied", "proposed", "confirmed", "rejected",
  "reason_required", "reason_too_long", "not_found", "document_superseded",
  "expiry_required", "expiry_unchanged", "proposal_pending",
  "self_approval_forbidden", "already_decided", "proposal_stale", "invalid_decision",
]);

/**
 * An RPC EXCEPTION is an authority failure (assert_actor_authority, EFA*) or a
 * broken invariant (EFX*). Neither is the operator's to fix by retrying, and
 * neither is reported as anything but « forbidden » / « generic ».
 */
function mapRpcError(error: { message: string; code?: string }): string {
  if (error.code?.startsWith("EFA") || /OPS-SEC-2A/.test(error.message)) return "forbidden";
  return "generic";
}

export async function requestDocumentExpiryChange(
  documentId: string,
  input: { expiryDate: string | null; reason: string },
): Promise<ExpiryActionResult> {
  let user;
  try {
    user = await assertPermission("document:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const check = validateExpiryRequest(input);
  if (!check.ok) return { ok: false, error: check.error };

  if (!(await expiryGovernanceAvailable())) return { ok: false, error: "not_available" };

  const admin = getAdminSupabaseClient();
  const { data: doc } = await admin
    .from("document")
    .select("id, file_id, expiry_date")
    .eq("id", documentId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };

  const { data, error } = await (admin as unknown as RpcClient).rpc("record_document_expiry_change", {
    p_document: documentId,
    p_tenant: user.tenantId,
    p_actor: user.id,
    p_new_expiry: check.expiryDate,
    p_reason: check.reason,
  });
  if (error) return { ok: false, error: mapRpcError(error) };
  const outcome = typeof data === "string" && RPC_OUTCOMES.has(data) ? data : "generic";
  if (outcome !== "applied" && outcome !== "proposed") return { ok: false, error: outcome };

  await writeAudit({
    action: AuditActions.DOCUMENT_EXPIRY_CHANGE_REQUESTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: documentId,
    before: { expiry_date: doc.expiry_date },
    // A proposal changes nothing yet: the requested value is recorded as such,
    // never as the document's expiry.
    after:
      outcome === "applied"
        ? { expiry_date: check.expiryDate, outcome, file_id: doc.file_id }
        : { proposed_expiry_date: check.expiryDate, outcome, file_id: doc.file_id },
  });

  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, outcome };
}

export async function decideDocumentExpiryChange(
  proposalId: string,
  input: { decision: "CONFIRMED" | "REJECTED"; reason?: string | null },
): Promise<ExpiryActionResult> {
  let user;
  try {
    user = await assertPermission("document:approve");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const check = validateExpiryDecision({ decision: input.decision, reason: input.reason ?? null });
  if (!check.ok) return { ok: false, error: check.error };

  if (!(await expiryGovernanceAvailable())) return { ok: false, error: "not_available" };

  const admin = getAdminSupabaseClient();
  const { data: prop } = await admin
    .from("document_expiry_change" as never)
    .select("id, document_id, file_id, old_expiry, new_expiry")
    .eq("id" as never, proposalId as never)
    .eq("tenant_id" as never, user.tenantId as never)
    .eq("kind" as never, "PROPOSED" as never)
    .maybeSingle();
  const proposal = prop as unknown as
    | { id: string; document_id: string; file_id: string; old_expiry: string | null; new_expiry: string | null }
    | null;
  if (!proposal) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, proposal.file_id))) return { ok: false, error: "forbidden" };

  const { data, error } = await (admin as unknown as RpcClient).rpc("decide_document_expiry_change", {
    p_proposal: proposalId,
    p_tenant: user.tenantId,
    p_actor: user.id,
    p_decision: check.decision,
    p_reason: check.reason,
  });
  if (error) return { ok: false, error: mapRpcError(error) };
  const outcome = typeof data === "string" && RPC_OUTCOMES.has(data) ? data : "generic";
  if (outcome !== "confirmed" && outcome !== "rejected") return { ok: false, error: outcome };

  await writeAudit({
    action: AuditActions.DOCUMENT_EXPIRY_CHANGE_DECIDED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: proposal.document_id,
    before: { expiry_date: proposal.old_expiry },
    after: {
      outcome,
      proposal_id: proposal.id,
      file_id: proposal.file_id,
      ...(outcome === "confirmed" ? { expiry_date: proposal.new_expiry } : { proposed_expiry_date: proposal.new_expiry }),
    },
  });

  revalidatePath(`/files/${proposal.file_id}`);
  return { ok: true, outcome };
}
