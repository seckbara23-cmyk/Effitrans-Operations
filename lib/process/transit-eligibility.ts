/**
 * THE one definition of who may HOLD a Transit execution step. PURE.
 * ---------------------------------------------------------------------------
 * UAT-DECLARANT-PICKER-01 found two definitions of the same idea, and they did
 * not agree. The candidate picker offered only holders of one exact role code;
 * the assignment door accepted anybody whose role mapped to the canonical
 * TRANSIT department. Three active users were therefore assignable by the
 * server and never offered by the interface, and nothing could have detected
 * the drift because neither side read the other.
 *
 * So the rule lives HERE, once, and both sides call it. Not the same condition
 * written twice in two modules — the same function. A picker that offers
 * somebody the door would refuse, or a door that accepts somebody the picker
 * would never show, is now a contradiction inside one expression rather than a
 * disagreement between two files.
 *
 * ---------------------------------------------------------------------------
 * THE RATIFIED RULE (UAT-DECLARANT-PICKER-01, ruling B).
 *
 * Eligibility to be named the dossier's Déclarant requires an ACTIVE,
 * SAME-TENANT user who HOLDS the application role CUSTOMS_DECLARANT. Holding
 * CHIEF_OF_TRANSIT or CUSTOMS_FIELD_AGENT alone does not make somebody a
 * Déclarant, even though all three map to the TRANSIT department. Somebody who
 * legitimately holds several roles, one of them CUSTOMS_DECLARANT, remains
 * eligible — four active production accounts are exactly that shape.
 *
 * WHAT THIS IS NOT. It is not an HR question. A professional Poste, an
 * `employee.job_title` reading « Déclarant en douane », and an HR department of
 * TRANSIT grant NOTHING here: this module reads application role codes and
 * nothing else, and the HR registry is not consulted on this path at any point.
 * The link between an employment record and a platform account has never
 * granted authority (HR-0F), and naming a Déclarant does not become the first
 * exception.
 *
 * WHY A STEP KEY AND NOT A ROLE CODE. The caller asks « who may hold step 6 »
 * and the answer belongs to the step, so the step is what it passes. Asking
 * with a role code was how the two definitions drifted apart in the first
 * place: the picker's caller chose the role, the door derived its own.
 */
import { roleCanonicalDepartment } from "@/lib/organization/departments";

/**
 * The role a person must HOLD to be given each assignable Transit step.
 *
 * Only the two steps the product actually assigns through a picker are named.
 * `customs_field_clearance` is listed because UAT-STEP12-FIELD-AGENT-01 already
 * offered exactly CUSTOMS_FIELD_AGENT holders there: naming it makes the door
 * agree with the interface that already existed, and the production census
 * confirms every assignee of both steps already satisfies it. The remaining
 * assignable keys are reached by no picker and keep the department rule below,
 * because narrowing them would be an unratified change to an act nobody has
 * reviewed.
 */
export const STEP_ASSIGNEE_ROLE: Readonly<Record<string, string>> = {
  customs_preparation: "CUSTOMS_DECLARANT",
  customs_field_clearance: "CUSTOMS_FIELD_AGENT",
};

/** The role this step requires of its holder, or null when only TRANSIT is required. */
export function requiredAssigneeRole(stepKey: string): string | null {
  return STEP_ASSIGNEE_ROLE[stepKey] ?? null;
}

/** Everything the rule is allowed to look at. Deliberately small. */
export type AssigneeFacts = {
  /** `app_user.status` as stored. Anything but "active" is ineligible. */
  status: string | null;
  /** `app_user.tenant_id` as stored. */
  tenantId: string | null;
  /** Application role codes held IN that tenant. */
  roleCodes: readonly string[];
};

/**
 * May this person be given this step, in this tenant?
 *
 * Three facts, in order: the account is active, it belongs to the asking
 * tenant, and it holds the role the step requires. No HR record, no job title,
 * no department membership, no professional Poste.
 */
export function isEligibleAssignee(
  stepKey: string,
  facts: AssigneeFacts,
  tenantId: string,
): boolean {
  if (facts.status !== "active") return false;
  if (!facts.tenantId || facts.tenantId !== tenantId) return false;

  const required = requiredAssigneeRole(stepKey);
  if (required) return facts.roleCodes.includes(required);

  // Every other assignable step keeps the rule it had: somebody of the Transit
  // department. Unchanged on purpose — see the comment on STEP_ASSIGNEE_ROLE.
  return facts.roleCodes.some((code) => roleCanonicalDepartment(code) === "TRANSIT");
}
