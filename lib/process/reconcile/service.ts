/**
 * Dossier reconciliation (Phase WES-5A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE service that makes module facts and the official process engine agree:
 *
 *     reconcileDossierProcess({ fileId, cause })
 *
 * It loads the facts, evaluates every fact-provable step through the PURE
 * satisfaction model, and applies forward completions through ONE atomic RPC
 * per step (transition + evidence consumption + event in a single
 * transaction). It is IDEMPOTENT: running it twice writes nothing the second
 * time, and running it concurrently is safe because the RPC locks the
 * execution row and treats already-COMPLETED as success.
 *
 * CONVERGENT, not inline: module facts are already atomic with their own
 * WES-9 events. Reconciliation runs after them; a failed run changes nothing
 * and the next run catches up. That is the documented model — no dual writes,
 * no partial history, at the cost of bounded lag.
 *
 * WHAT IT REFUSES, by construction:
 *   * completing a SUBMITTED step (maker-checker pending) — refused in the
 *     satisfaction model AND again in SQL;
 *   * touching human-only steps — absent from FACT_RULES, so never evaluated
 *     as completable;
 *   * resolving conflicts — a step marked done whose fact is absent is
 *     REPORTED, never regressed;
 *   * inventing actors — the RPC records the module fact's actor when the
 *     caller knows it, else NULL with RECONCILED provenance.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  FACT_PROVABLE_STEP_KEYS,
  evaluateStep,
  mayReconcileComplete,
  type ModuleFacts,
  type StepEvaluation,
} from "./satisfaction";

export type ReconcileCause =
  | "customs_release"
  | "document_verified"
  | "transport_transition"
  /** MAYA-P1.2 — Finance recorded the GAINDE registration milestone. */
  | "gainde_registration"
  /** MAYA-P1.11 — the Declarant recorded the rattachement. */
  | "customs_attachment"
  | "manual"
  | "legacy_compatibility";

export type ReconcileResult = {
  ok: boolean;
  /** Steps this run completed (idempotent re-runs return []). */
  completed: { stepKey: string; factFr: string }[];
  /** Facts contradicting persisted engine state. Reported, never resolved. */
  conflicts: { stepKey: string; factFr: string }[];
  /** Steps satisfied but with no execution row to complete (no instance). */
  unmatched: string[];
  /** Every evaluation, for explainability surfaces. */
  evaluations: StepEvaluation[];
};

const EMPTY: ReconcileResult = {
  ok: true, completed: [], conflicts: [], unmatched: [], evaluations: [],
};

/**
 * Reconcile one dossier. Never throws: reconciliation failing must never break
 * the module action that triggered it — the model is convergent, and the next
 * run (or a manual one) picks up where this one could not.
 */
export async function reconcileDossierProcess(input: {
  tenantId: string;
  fileId: string;
  cause: ReconcileCause;
  /** The module fact's actor, recorded on completions this run applies. */
  actorId?: string | null;
}): Promise<ReconcileResult> {
  try {
    return await run(input);
  } catch {
    return { ...EMPTY, ok: false };
  }
}

async function run(input: {
  tenantId: string;
  fileId: string;
  cause: ReconcileCause;
  actorId?: string | null;
}): Promise<ReconcileResult> {
  const supabase = getAdminSupabaseClient();

  // ---- the authoritative facts -------------------------------------------
  const [file, customs, transport, pod, bae, instance] = await Promise.all([
    supabase.from("operational_file").select("id, type, status")
      .eq("id", input.fileId).eq("tenant_id", input.tenantId)
      .maybeSingle<{ id: string; type: string; status: string }>(),
    supabase.from("customs_record")
      .select("status, required, declaration_number, bae_reference, gainde_registered_at, attachment_completed_at")
      .eq("file_id", input.fileId).eq("tenant_id", input.tenantId)
      .maybeSingle<{ status: string; required: boolean; declaration_number: string | null; bae_reference: string | null; gainde_registered_at: string | null; attachment_completed_at: string | null }>(),
    supabase.from("transport_record").select("status")
      .eq("file_id", input.fileId).eq("tenant_id", input.tenantId)
      .maybeSingle<{ status: string }>(),
    currentVerifiedDocument(supabase, input.tenantId, input.fileId, "DELIVERY_NOTE"),
    currentVerifiedDocument(supabase, input.tenantId, input.fileId, "BAE"),
    supabase.from("process_instance").select("id, policy_version_id")
      .eq("file_id", input.fileId).eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false }).limit(1)
      .maybeSingle<{ id: string; policy_version_id: string | null }>(),
  ]);

  if (!file.data) return { ...EMPTY, ok: false };

  const facts: ModuleFacts = {
    fileType: file.data.type,
    fileStatus: file.data.status,
    customs: customs.data
      ? {
          status: customs.data.status,
          required: customs.data.required,
          declarationNumber: customs.data.declaration_number,
          baeReference: customs.data.bae_reference,
          gaindeRegisteredAt: customs.data.gainde_registered_at,
          attachmentCompletedAt: customs.data.attachment_completed_at,
        }
      : null,
    transport: transport.data ? { status: transport.data.status } : null,
    verifiedPodDocumentId: pod,
    verifiedBaeDocumentId: bae,
  };

  // ---- persisted engine state --------------------------------------------
  // A dossier without a process instance has nothing to reconcile INTO. The
  // facts still stand on their own; the projection reads them directly. No
  // instance is fabricated here — initialization is the engine's own action.
  const executions = instance.data
    ? await supabase.from("process_step_execution")
        .select("id, step_key, state")
        .eq("tenant_id", input.tenantId)
        .eq("process_instance_id", instance.data.id)
        .in("step_key", [...FACT_PROVABLE_STEP_KEYS])
        .not("state", "in", "(REJECTED,CANCELLED)")
        .returns<{ id: string; step_key: string; state: string }[]>()
    : { data: [] as { id: string; step_key: string; state: string }[] };

  const byStep = new Map((executions.data ?? []).map((e) => [e.step_key, e]));

  // ---- evaluate + apply ---------------------------------------------------
  const result: ReconcileResult = { ...EMPTY, evaluations: [] };

  for (const stepKey of FACT_PROVABLE_STEP_KEYS) {
    const execution = byStep.get(stepKey) ?? null;
    const evaluation = evaluateStep({
      stepKey,
      facts,
      execution: execution ? { stepKey, state: execution.state } : null,
    });
    result.evaluations.push(evaluation);

    if (evaluation.satisfaction === "CONFLICT") {
      result.conflicts.push({ stepKey, factFr: evaluation.factFr });
      continue;
    }
    if (evaluation.satisfaction !== "SATISFIED") continue;

    if (!execution) {
      // Satisfied by facts, but the engine has no row for it (legacy dossier
      // or instance not initialized). Recorded, not fabricated.
      if (instance.data) result.unmatched.push(stepKey);
      continue;
    }
    if (!mayReconcileComplete(execution.state)) continue;

    const { data, error } = await supabase.rpc("reconcile_step_completion", {
      p_execution_id: execution.id,
      p_tenant_id: input.tenantId,
      p_fact_code: factCode(stepKey),
      p_actor: input.actorId ?? null,
      p_evidence_doc_id: evaluation.evidenceDocumentId,
      p_policy_id: instance.data?.policy_version_id ?? null,
      p_legacy: input.cause === "legacy_compatibility",
    });
    if (error) {
      // One step failing must not abort the rest: each is its own transaction.
      result.ok = false;
      continue;
    }
    const applied = data as { already?: boolean } | null;
    if (applied && !applied.already) {
      result.completed.push({ stepKey, factFr: evaluation.factFr });
    }
  }

  return result;
}

/** The current (non-superseded) verified document of a type, if any. */
async function currentVerifiedDocument(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
  fileId: string,
  typeCode: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("document")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .eq("type_code", typeCode)
    .in("status", ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE"])
    .is("superseded_by_id", null)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/** Stable fact codes recorded on reconciled completions and in events. */
function factCode(stepKey: string): string {
  switch (stepKey) {
    case "am_dossier_opening": return "FILE_OPENED";
    // MAYA-P1.2: was CUSTOMS_DECLARED, which named the DECLARANT's fact on a
    // step the registry assigns to Finance. The code now names what proves it.
    case "gainde_registration": return "GAINDE_REGISTERED";
    case "gainde_document_submission": return "CUSTOMS_ATTACHMENT_RECORDED";
    case "customs_field_clearance": return "CUSTOMS_RELEASED";
    case "pickup": return "TRANSPORT_PICKED_UP";
    case "transport_pod_handoff": return "POD_RECEIVED";
    default: return "MODULE_FACT";
  }
}
