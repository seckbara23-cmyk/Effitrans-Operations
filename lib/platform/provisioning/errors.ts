/**
 * Provisioning error codes (Phase 6.0A). PURE.
 * ---------------------------------------------------------------------------
 * One closed set, shared by the SQL function's expected refusals and the action's
 * stage-1 / compensation failures, so a caller (and the wizard) matches on a stable
 * vocabulary rather than on a message string that could be reworded.
 */
export const PROVISION_ERRORS = [
  "invalid_input",
  "duplicate_slug",
  "admin_email_conflict",
  "auth_user_creation_failed",
  "relational_provisioning_failed",
  "compensation_failed",
  "invitation_send_failed",
  "already_provisioned",
  "unauthorized",
] as const;

export type ProvisionErrorCode = (typeof PROVISION_ERRORS)[number];

export function isProvisionError(v: string): v is ProvisionErrorCode {
  return (PROVISION_ERRORS as readonly string[]).includes(v);
}

/**
 * `invitation_send_failed` is deliberately NOT terminal: the tenant is fully
 * provisioned by the time we try to invite, so a mail failure must not roll it back.
 * The action returns success WITH this warning and the setup link, never a hard error.
 */
export const NON_FATAL_WARNINGS: ReadonlySet<ProvisionErrorCode> = new Set([
  "invitation_send_failed",
]);
