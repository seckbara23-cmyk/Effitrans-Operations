/**
 * Document governance from the pinned policy (Phase WES-4H). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Who may upload, who may verify, and whether the two must be different people.
 *
 * All three come from the WES-7 policy pinned to the dossier — never from a
 * page component. The audit found BAE authority expressed nowhere at all:
 * `releaseCustoms` checked one permission, `customs:release`, and any holder
 * could record, verify and release in a single click.
 *
 * PINNED, not active: a later tenant policy activation must not change the
 * rules governing a dossier already in flight. Fail closed everywhere — an
 * unresolvable policy means nobody may verify, because we do not know who may.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { resolveSeatEligibility } from "@/lib/workflow/access/eligibility";
import { isEligibleForSeat } from "@/lib/workflow/access/seat";
import { getUserRoleCodes } from "@/lib/workflow/access/roles";

export type DocumentGovernance = {
  uploaderRoles: string[];
  verifierRoles: string[];
  /**
   * True when the verifier must be a different person from the uploader.
   *
   * Derived from the policy binding a `checker` seat for the step: a checker
   * seat exists precisely to say "someone other than the maker signs this off".
   * The BAE is additionally always maker-checked — WES-4D's default model
   * separates the Declarant who records it from the Chef de Transit who
   * verifies it, and that separation is the control, not a preference.
   */
  makerCheckerRequired: boolean;
  policyVersionId: string | null;
  processInstanceId: string | null;
  stepKey: string | null;
  /** False ⇒ the caller must refuse the action. */
  resolved: boolean;
};

const UNRESOLVED: DocumentGovernance = {
  uploaderRoles: [], verifierRoles: [], makerCheckerRequired: true,
  policyVersionId: null, processInstanceId: null, stepKey: null, resolved: false,
};

/** Document types whose verification is always maker-checked, by business rule. */
const ALWAYS_MAKER_CHECKED = new Set(["BAE"]);

export async function resolveDocumentGovernance(input: {
  tenantId: string;
  fileId: string;
  typeCode: string;
}): Promise<DocumentGovernance> {
  const supabase = getAdminSupabaseClient();

  const { data: instance } = await supabase
    .from("process_instance")
    .select("id")
    .eq("file_id", input.fileId)
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { data: step } = instance
    ? await supabase
        .from("process_step_execution")
        .select("step_key")
        .eq("tenant_id", input.tenantId)
        .eq("process_instance_id", instance.id)
        .in("state", ["AVAILABLE", "ACTIVE", "PENDING"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle<{ step_key: string }>()
    : { data: null };

  const ctx = { tenantId: input.tenantId, processInstanceId: instance?.id ?? null };
  const stepKey = step?.step_key ?? "";

  const [uploader, verifier, checker] = await Promise.all([
    resolveSeatEligibility(ctx, stepKey, "uploader"),
    resolveSeatEligibility(ctx, stepKey, "verifier"),
    resolveSeatEligibility(ctx, stepKey, "checker"),
  ]);

  if (!verifier.resolved) return UNRESOLVED;

  return {
    uploaderRoles: uploader.roles,
    verifierRoles: verifier.roles,
    makerCheckerRequired:
      ALWAYS_MAKER_CHECKED.has(input.typeCode) || checker.roles.length > 0,
    policyVersionId: verifier.policyVersionId,
    processInstanceId: instance?.id ?? null,
    stepKey: stepKey || null,
    resolved: true,
  };
}

export type VerifierCheck =
  | { ok: true; makerCheckerRequired: boolean; policyVersionId: string | null }
  | { ok: false; error: "policy_unresolved" | "not_a_verifier" | "self_verification" };

/**
 * May `actorId` verify this document?
 *
 * Two independent refusals, and the second is the one that matters most:
 * holding the verifier role is not enough if you are the person who uploaded
 * it. `SYSTEM_ADMIN` gains nothing here — administering the platform is not a
 * verifier seat, and WES-4D says so explicitly.
 */
export async function mayVerifyDocument(input: {
  tenantId: string;
  actorId: string;
  fileId: string;
  typeCode: string;
  uploaderId: string | null;
}): Promise<VerifierCheck> {
  const governance = await resolveDocumentGovernance(input);
  if (!governance.resolved) return { ok: false, error: "policy_unresolved" };

  const roles = await getUserRoleCodes(input.actorId, input.tenantId);
  const eligible = isEligibleForSeat(
    {
      roles: governance.verifierRoles,
      policyVersionId: governance.policyVersionId,
      identityBound: false,
      resolved: true,
    },
    roles,
  );
  if (!eligible) return { ok: false, error: "not_a_verifier" };

  if (
    governance.makerCheckerRequired &&
    input.uploaderId &&
    input.uploaderId === input.actorId
  ) {
    return { ok: false, error: "self_verification" };
  }

  return {
    ok: true,
    makerCheckerRequired: governance.makerCheckerRequired,
    policyVersionId: governance.policyVersionId,
  };
}
