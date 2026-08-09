/**
 * EMP-5D — Reply-To resolution. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * EMP-5B.1's central insight: visible From, envelope From / Return-Path,
 * Reply-To and the DKIM signing domain are FOUR DIFFERENT THINGS, and insisting
 * they be identical is exactly what forces risky edits to a live SPF record.
 *
 * Reply-To is the one that decides where a human's answer lands. Setting it to
 * the real corporate mailbox means a customer replying to platform mail arrives
 * in Outlook, read by the team who already work there — which is the whole
 * point of coexistence. Nothing else about the message changes.
 *
 * THE RULE IS DELIBERATELY NARROW. Reply-To is set only from a mailbox of
 * record that the server itself resolved and validated. It is never taken from
 * request input, never guessed, and omitted entirely when the mailbox cannot be
 * trusted — which reproduces today's behaviour exactly, so a message that would
 * have been sent before is still sent now.
 */

/** The mailbox facts this decision needs. Resolved server-side, never supplied. */
export type MailboxOfRecord = {
  id: string;
  tenantId: string;
  address: string | null;
  /** `is_active` — an administratively disabled mailbox must not collect replies. */
  isActive: boolean;
  /** `provisioning_status` — only a mailbox believed to work should be offered. */
  provisioningStatus: string;
  /** EMP-5C — the platform's capture feed. NEVER a Reply-To; see below. */
  integrationAddress?: string | null;
};

export type ReplyToDecision =
  | { replyTo: string; reason: "mailbox_of_record" }
  | { replyTo: null; reason: ReplyToRefusal };

export type ReplyToRefusal =
  | "no_mailbox_of_record"
  | "tenant_mismatch"
  | "mailbox_inactive"
  | "mailbox_not_active_status"
  | "no_corporate_address";

/** Same shape rule the database enforces on `ec_mailbox.address`. */
function looksLikeAddress(v: string): boolean {
  return v === v.toLowerCase() && v.includes("@") && v.length >= 3 && v.length <= 320;
}

/**
 * Decide the Reply-To for one outbound message.
 *
 * `messageTenantId` is the tenant of the MESSAGE, and the mailbox must match it.
 * That check is what makes a cross-tenant mailbox unusable as a Reply-To even
 * if a `mailbox_id` from another tenant were somehow stored on the row.
 *
 * Returns a refusal reason rather than throwing: an unusable mailbox must not
 * stop a legitimate send, it must only stop the Reply-To. Failing the whole
 * message here would turn a cosmetic improvement into an outage.
 */
export function resolveReplyTo(
  messageTenantId: string,
  mailbox: MailboxOfRecord | null | undefined,
): ReplyToDecision {
  if (!mailbox) return { replyTo: null, reason: "no_mailbox_of_record" };

  // Tenant first: nothing else matters if the mailbox is not ours.
  if (mailbox.tenantId !== messageTenantId) {
    return { replyTo: null, reason: "tenant_mismatch" };
  }
  if (!mailbox.isActive) return { replyTo: null, reason: "mailbox_inactive" };

  // A mailbox that is still being set up, disabled, or whose setup failed is
  // not somewhere a customer's reply should be directed.
  if (mailbox.provisioningStatus !== "ACTIVE") {
    return { replyTo: null, reason: "mailbox_not_active_status" };
  }

  const address = mailbox.address?.trim() ?? "";
  if (!address || !looksLikeAddress(address)) {
    return { replyTo: null, reason: "no_corporate_address" };
  }

  // DELIBERATELY `address`, NEVER `integrationAddress`.
  //
  // The integration address is the platform's own capture feed — the alias a
  // provider-side copy rule writes into. Directing customer replies there would
  // send them into the integration channel instead of the mailbox the team
  // actually reads, which is precisely the disruption this design exists to
  // avoid. The corporate address is where humans are.
  return { replyTo: address, reason: "mailbox_of_record" };
}
