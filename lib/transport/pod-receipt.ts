/**
 * Automatic POD receipt (UAT-1 POD ownership redesign). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Operations obtains the signed delivery note and an authorized reviewer
 * VERIFIES it. Verification is the operator decision; recording that the POD
 * was received is its mechanical consequence, so the platform performs it —
 * nobody in Transport has to click a second button for a fact that is already
 * established.
 *
 * ===========================================================================
 * AUTHORIZATION — why this does not assert `transport:complete`
 * ===========================================================================
 * The AUTHORIZING ACT is the document verification, which already required
 * `document:approve` and passed maker-checker. This function is not a second
 * user-facing action: it is unexported from any server-action surface, takes an
 * already-authorized context, and is reachable ONLY from the verified-document
 * path in `runReview`. Granting Operations `transport:complete` would have been
 * the wrong fix — it would let them move transport rows directly, for any
 * reason, with no evidence at all.
 *
 * It does NOT weaken the gate. It re-evaluates `canReceivePod` over the SAME
 * `isVerified` document statuses the manual path uses, so an automatic receipt
 * is impossible without exactly the evidence a manual one would have required.
 *
 * ===========================================================================
 * IDEMPOTENCY
 * ===========================================================================
 *   * the UPDATE is a compare-and-set on `status = 'DELIVERED'`, so concurrent
 *     verifications produce exactly one transition;
 *   * already POD_RECEIVED -> reports `already`, writes nothing;
 *   * not yet DELIVERED -> reports `not_delivered` and leaves the document
 *     verified; the receipt happens when delivery is recorded and someone
 *     re-verifies, or through the ordinary manual path;
 *   * the Finance handoff runs through the existing `onPodReceived`, whose
 *     WES-1D guard already refuses a duplicate or surpassed handoff.
 *
 * The transport status UPDATE fires `trg_emit_transport_events`, so the
 * business events are emitted in the SAME transaction as the fact (WES-9A
 * Model A) — this file adds no second emission path.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isVerified } from "@/lib/documents/doctrine";
import { canReceivePod } from "./gates";
import { onPodReceived } from "@/lib/handoffs/triggers";
import { custDelivered } from "@/lib/customer-notify/triggers";
import { reconcileDossierProcess } from "@/lib/process/reconcile/service";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type PodReceiptOutcome =
  | "recorded"
  | "already"
  | "not_delivered"
  | "no_transport"
  | "evidence_missing"
  | "failed";

/**
 * Record POD receipt because a delivery note was just verified.
 *
 * NEVER THROWS. A failure here must not roll back the document verification —
 * the verification is the authoritative decision and stands on its own; the
 * receipt converges on the next verification or the manual path.
 */
export async function recordPodReceiptFromVerifiedEvidence(input: {
  supabase: Admin;
  tenantId: string;
  fileId: string;
  actorId: string;
}): Promise<PodReceiptOutcome> {
  const { supabase, tenantId, fileId, actorId } = input;
  try {
    const { data: transport } = await supabase
      .from("transport_record")
      .select("id, status")
      .eq("file_id", fileId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; status: string }>();

    if (!transport) return "no_transport";
    if (transport.status === "POD_RECEIVED") return "already";
    // Only DELIVERED advances. A dossier still in transit keeps its verified
    // POD on file; the platform does not invent a delivery that has not
    // happened.
    if (transport.status !== "DELIVERED") return "not_delivered";

    // THE SAME GATE as the manual transition — not a relaxed copy.
    const { data: docs } = await supabase
      .from("document")
      .select("type_code, status")
      .eq("tenant_id", tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null);
    const verifiedCodes = (docs ?? [])
      .filter((d) => isVerified(d.status as string))
      .map((d) => d.type_code as string);
    if (!canReceivePod(verifiedCodes)) return "evidence_missing";

    // CAS: constrain on DELIVERED so two concurrent verifications cannot both
    // transition, and a row someone else already moved is left alone.
    const { data: moved, error } = await supabase
      .from("transport_record")
      .update({ status: "POD_RECEIVED" })
      .eq("id", transport.id)
      .eq("tenant_id", tenantId)
      .eq("status", "DELIVERED")
      .select("id");
    if (error) return "failed";
    if ((moved?.length ?? 0) !== 1) return "already"; // someone else won the race

    await writeAudit({
      action: AuditActions.TRANSPORT_POD_RECEIVED,
      actorId,
      tenantId,
      entity: "transport_record",
      entityId: transport.id,
      before: { status: "DELIVERED" },
      // Provenance is recorded honestly: a person verified the evidence, the
      // platform recorded the receipt. It never reads as a Transport click.
      after: { status: "POD_RECEIVED", source: "AUTOMATIC_ON_POD_VERIFICATION" },
    });

    const ctx = { tenantId, actorId };
    // Existing Transport -> Finance handoff. WES-1D refuses a duplicate or a
    // handoff the dossier has already surpassed, so this is safe to re-run.
    await onPodReceived(supabase, ctx, fileId);
    // Existing customer notice; dedup-guaranteed once per dossier.
    await custDelivered(supabase, ctx, fileId);
    // WES-5 — converge the official engine and consume the exact POD version.
    await reconcileDossierProcess({
      tenantId,
      fileId,
      cause: "document_verified",
      actorId,
    });

    return "recorded";
  } catch {
    return "failed";
  }
}
