/**
 * Automatic dossier-status advance on delivery. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The platform ran TWO state machines that read different columns and could
 * disagree:
 *
 *   * the LIFECYCLE derives its stages from module facts — the `delivered`
 *     stage is `transport_record.status >= DELIVERED`;
 *   * the TRANSITION ladder is `operational_file.status`, advanced only by an
 *     operator clicking, by dossier opening, and by collections completion.
 *
 * Nothing advanced `IN_PROGRESS → DELIVERED`. So once transport reached
 * POD_RECEIVED and the invoice was paid, the lifecycle legitimately reached its
 * final stage and advertised « Clôturer le dossier » — while the file status
 * was still IN_PROGRESS, whose only legal next step is DELIVERED. The operator
 * followed the instruction and found a button offering something else.
 *
 * This closes the drift at its source: when transport records delivery, the
 * dossier status follows the fact. The two engines stop disagreeing because one
 * of them now tracks the other.
 *
 * ===========================================================================
 * IT WALKS THE LADDER; IT NEVER SKIPS
 * ===========================================================================
 * `canTransition` is still the authority. From OPENED the walk goes
 * OPENED → IN_PROGRESS → DELIVERED, one legal step at a time, each its own
 * transition with its own history row and audit entry — because each IS a real
 * transition. It never jumps, never moves backwards, and never touches CLOSED
 * or CANCELLED.
 *
 * ===========================================================================
 * AUTHORIZATION
 * ===========================================================================
 * It does NOT assert `file:update`, and no role is granted it. The authorizing
 * act is the transport transition the caller already performed under
 * `transport:complete`; recording that the dossier is delivered is its
 * mechanical consequence. Like the POD receipt in UAT-1, this function is
 * reachable only from that path and takes an already-authorized context.
 *
 * NEVER THROWS: a failure here must not roll back the transport transition,
 * which is the authoritative fact. The next delivery-class event converges.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { canTransition } from "./status";
import type { FileStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type AutoAdvanceOutcome = "advanced" | "already" | "not_applicable" | "failed";

/** Statuses from which delivery may legitimately be recorded automatically. */
const ADVANCEABLE: readonly FileStatus[] = ["OPENED", "IN_PROGRESS"];

/**
 * Bring `operational_file.status` up to DELIVERED because transport says so.
 *
 * Idempotent: already DELIVERED (or CLOSED) returns without writing. A dossier
 * in DRAFT or CANCELLED is left alone — an undelivered draft and a cancelled
 * dossier are not made "delivered" by a transport row.
 */
export async function advanceFileToDeliveredFromTransport(input: {
  supabase: Admin;
  tenantId: string;
  fileId: string;
  actorId: string;
}): Promise<AutoAdvanceOutcome> {
  const { supabase, tenantId, fileId, actorId } = input;
  try {
    const { data: file } = await supabase
      .from("operational_file")
      .select("status")
      .eq("id", fileId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ status: string }>();
    if (!file) return "failed";

    let current = file.status as FileStatus;
    if (current === "DELIVERED" || current === "CLOSED") return "already";
    if (!ADVANCEABLE.includes(current)) return "not_applicable"; // DRAFT, CANCELLED

    let moved = false;
    // At most two hops: OPENED → IN_PROGRESS → DELIVERED. Bounded so a future
    // ladder change cannot turn this into an unbounded walk.
    for (let hop = 0; hop < 2 && current !== "DELIVERED"; hop++) {
      const next: FileStatus = current === "OPENED" ? "IN_PROGRESS" : "DELIVERED";
      if (!canTransition(current, next)) break; // the state machine still rules

      // CAS on the status we read, so a concurrent operator transition wins
      // rather than being overwritten.
      const { data: rows, error } = await supabase
        .from("operational_file")
        .update({ status: next })
        .eq("id", fileId)
        .eq("tenant_id", tenantId)
        .eq("status", current)
        .select("id");
      if (error) return moved ? "advanced" : "failed";
      if ((rows?.length ?? 0) !== 1) break; // someone else moved it; leave theirs

      // Same history row and audit entry a manual transition writes — an
      // automatic advance must not be invisible in the dossier's history.
      await supabase.from("file_state_transition").insert({
        tenant_id: tenantId,
        file_id: fileId,
        from_status: current,
        to_status: next,
        actor_id: actorId,
      });
      await writeAudit({
        action: AuditActions.FILE_TRANSITION,
        actorId,
        tenantId,
        entity: "operational_file",
        entityId: fileId,
        before: { status: current },
        // Provenance is recorded honestly: transport recorded a fact, the
        // platform followed it. It never reads as an operator's click.
        after: { status: next, source: "AUTOMATIC_ON_TRANSPORT_DELIVERY" },
      });

      current = next;
      moved = true;
    }

    return moved ? "advanced" : "already";
  } catch {
    return "failed";
  }
}
