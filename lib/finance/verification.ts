/**
 * Payment verification state (Phase 1.15A). PURE — no I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * A recorded payment carries a manual reconciliation status, independent of the
 * invoice's payment status. The flow is one-shot from PENDING:
 *
 *   PENDING ──verify──▶ VERIFIED   (confirmed received; stays in paid total)
 *   PENDING ──reject──▶ REJECTED   (also reversed → leaves the paid total)
 *
 * VERIFIED and REJECTED are terminal: a payment is verified or rejected exactly
 * once. Reject is handled by the action as reverse + mark REJECTED, so the
 * Phase-1.11 paid/balance formula (Σ non-reversed) is unchanged.
 */
export const VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export function isVerificationStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

/** Only a still-pending payment can be verified. */
export function canVerify(status: VerificationStatus): boolean {
  return status === "PENDING";
}

/** Only a still-pending payment can be rejected. */
export function canReject(status: VerificationStatus): boolean {
  return status === "PENDING";
}

/**
 * A payment is "missing a reference" (a reconciliation flag, not an error) when
 * it carries no operator reference AND no provider reference. Manual cash is the
 * common case; bank/mobile-money payments should normally have one.
 */
export function isMissingReference(input: {
  reference: string | null;
  providerReference: string | null;
}): boolean {
  return !input.reference?.trim() && !input.providerReference?.trim();
}
