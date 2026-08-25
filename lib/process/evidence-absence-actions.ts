"use server";
/**
 * C-3 — declare an evidence type inapplicable to a dossier. SERVER ACTION.
 * ---------------------------------------------------------------------------
 * The ONLY write path. There is no client-side insert policy on
 * `evidence_absence_declaration`, so this action's checks are the whole
 * boundary, and they are the same two the platform requires of every dossier
 * mutation: the appropriate permission AND the correct current official step.
 *
 * A declaration is not a skip and not an exception. It records that a named
 * evidence type does not apply to THIS dossier, why, and who said so — the
 * « Sans devis » idiom generalised. It fabricates no document, satisfies only
 * the key it names, and can only name a type the business ratified as
 * conditional (enforced here, and again by a CHECK in migration 123).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { assertControlStep } from "@/lib/process/control-gate-server";
import { isDeclarableEvidence, validateAbsenceReason } from "./evidence-absence";

export type AbsenceResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Declare `evidenceKey` inapplicable to `fileId`, with a mandatory motif.
 *
 * Gated exactly like the step it serves: step 3 owns all three declarable
 * types, so the actor must hold `file:create` (step 3's registry permission)
 * AND step 3 must be open and not claimed by someone else.
 */
export async function declareEvidenceAbsence(
  fileId: string,
  evidenceKey: string,
  reason: string,
): Promise<AbsenceResult> {
  // 1. The ratified list, first — before any I/O.
  if (!isDeclarableEvidence(evidenceKey)) return { ok: false, error: "evidence_not_declarable" };

  const check = validateAbsenceReason(reason);
  if (!check.ok) return { ok: false, error: check.error };

  // 2. Permission (step 3's own, per A-1).
  let user;
  try {
    user = await assertPermission("file:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  // 3. The step gate — a waiver is a mutation of what the step will accept, so
  //    it obeys the same rule as every other control: not before the step opens,
  //    not after it closes, not on a step someone else has claimed.
  const gate = await assertControlStep("evidence.declare_absence", fileId, user.tenantId, user.id);
  if (gate) return { ok: false, error: gate };

  const admin = getAdminSupabaseClient();
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      insert: (v: Record<string, unknown>) => {
        select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
      };
    };
  })
    .from("evidence_absence_declaration")
    .insert({
      tenant_id: user.tenantId,
      file_id: fileId,
      evidence_key: evidenceKey,
      reason: check.reason,
      declared_by: user.id,
    })
    .select("id")
    .single();

  // A second declaration for the same (dossier, type) hits the unique index —
  // idempotent from the operator's point of view, not an error to explain. Any
  // OTHER failure is reported as itself: mapping every insert error to
  // "already_declared" once disguised a foreign-key failure as a duplicate.
  if (error || !data) {
    const duplicate = /duplicate key|unique constraint|uq_evidence_absence/i.test(error?.message ?? "");
    return { ok: false, error: duplicate ? "already_declared" : (error?.message ?? "declaration_failed") };
  }

  await writeAudit({
    action: AuditActions.EVIDENCE_ABSENCE_DECLARED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "evidence_absence_declaration",
    entityId: data.id,
    after: { file_id: fileId, evidence_key: evidenceKey, reason: check.reason },
  });

  revalidatePath(`/files/${fileId}`);
  revalidatePath(`/files/${fileId}/process`);
  return { ok: true, id: data.id };
}
