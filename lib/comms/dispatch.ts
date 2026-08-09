import "server-only";

/**
 * EMP-3 — THE send path. Every outbound message goes through `dispatchMessage`,
 * and it is the only place in the platform that calls the provider for a
 * persisted message.
 *
 * THE PROBLEM IT EXISTS TO SOLVE. The previous path read the row's status,
 * checked it was sendable, and then called the provider — with nothing in
 * between. Two concurrent callers both read QUEUED, both passed the check, and
 * both sent the customer an email. It was latent only because no surface issued
 * concurrent sends; EMP-3 adds a Send button, which makes it reachable.
 *
 * THE FIX (RATIFY-EMP3-1). A compare-and-set acquires the send before the
 * provider is touched:
 *
 *     QUEUED | FAILED  --CAS-->  SENDING  -->  SENT | FAILED
 *
 * `comm_acquire_send` is a single UPDATE with the status in its WHERE clause.
 * PostgreSQL serializes the row write, so of N concurrent callers exactly one
 * transitions it and the rest match zero rows. Only the winner may call the
 * provider. This is not a lock we take and might forget to release — the row's
 * own state IS the lock.
 *
 * WHAT IS NOT ATOMIC, STATED PLAINLY. The provider call is external HTTP; no
 * database transaction spans it. A crash after the provider accepted but before
 * `comm_record_send_accepted` commits leaves the row in SENDING. That row is
 * NEVER redispatched automatically — automatic recovery would be a
 * duplicate-send machine, because the platform cannot know whether the provider
 * accepted. It surfaces for human reconciliation instead.
 *
 * The event is exactly-once because the SENDING -> SENT transition and the
 * ledger write happen in ONE transaction inside `comm_record_send_accepted`: a
 * second call finds the status is no longer SENDING and emits nothing.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendEmail, isProviderConfigured } from "./provider";
import { resolveReplyTo, type MailboxOfRecord } from "./reply-to";
import {
  mailboxRuntimeEligibility, type LifecycleFacts,
} from "@/lib/ec/mailboxes/lifecycle";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

/**
 * Both halves of the two-layer rollout (RATIFY-EMP3-3). Lives here rather than
 * in the actions module because a `"use server"` file may only export async
 * functions — a synchronous helper there is a build-time error.
 */
export function outboundEnabled(): boolean {
  return process.env.EFFITRANS_EC_OUTBOUND_ENABLED === "true";
}

export type DispatchOutcome =
  | { ok: true; status: "SENT"; provider: string }
  | { ok: false; status: "FAILED" | "SKIPPED" | "NOT_FOUND" | "NOT_ACQUIRED"; error: string };

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/** Columns the send needs. Bcc is read to SEND, never to compose a reply. */
const SEND_SELECT =
  "id, tenant_id, status, kind, mailbox_id, recipient_email, recipient_name, " +
  "to_addresses, cc_addresses, bcc_addresses, subject, body_html, body_text, attachments";

function addresses(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * EMP-5G — the mailbox of record, as lifecycle facts, tenant-scoped.
 *
 * One read feeding both the readiness decision and the Reply-To, so the two
 * cannot disagree about the same mailbox within one send.
 */
export async function loadMailboxFacts(
  admin: Admin, tenantId: string, mailboxId: string,
): Promise<LifecycleFacts | null> {
  const { data } = await admin
    .from("ec_mailbox")
    .select(
      "id, tenant_id, address, mailbox_type, owner_user_id, provisioning_status, "
      + "provisioning_note, ownership, external_provider, external_mailbox_id, "
      + "corporate_identity_confirmed_at, corporate_identity_confirmed_by, "
      + "outbound_verified_at, outbound_verified_by, outbound_verification_ref, "
      + "inbound_verified_at, inbound_verified_by, inbound_verification_ref, "
      + "activated_at, activated_by",
    )
    .eq("id", mailboxId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    address: (r.address as string | null) ?? "",
    mailboxType: (r.mailbox_type as string) ?? "SHARED",
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    provisioningStatus: (r.provisioning_status as string) ?? "",
    provisioningNote: (r.provisioning_note as string | null) ?? null,
    ownership: (r.ownership as string | null) ?? "UNKNOWN",
    externalProvider: (r.external_provider as string | null) ?? null,
    externalMailboxId: (r.external_mailbox_id as string | null) ?? null,
    corporateIdentityConfirmedAt: (r.corporate_identity_confirmed_at as string | null) ?? null,
    corporateIdentityConfirmedBy: (r.corporate_identity_confirmed_by as string | null) ?? null,
    outboundVerifiedAt: (r.outbound_verified_at as string | null) ?? null,
    outboundVerifiedBy: (r.outbound_verified_by as string | null) ?? null,
    outboundVerificationRef: (r.outbound_verification_ref as string | null) ?? null,
    inboundVerifiedAt: (r.inbound_verified_at as string | null) ?? null,
    inboundVerifiedBy: (r.inbound_verified_by as string | null) ?? null,
    inboundVerificationRef: (r.inbound_verification_ref as string | null) ?? null,
    activatedAt: (r.activated_at as string | null) ?? null,
    activatedBy: (r.activated_by as string | null) ?? null,
  };
}

/**
 * Dispatch one persisted message.
 *
 * Preconditions the CALLER owns: the actor is authorized (`communication:send`),
 * the mailbox is active and the tenant is outbound-enabled. This function
 * re-checks tenant ownership and provider configuration because those are the
 * two that would be catastrophic to get wrong, but it is not the authorization
 * boundary and does not pretend to be.
 */
export async function dispatchMessage(
  tenantId: string,
  actorId: string,
  messageId: string,
): Promise<DispatchOutcome> {
  const admin = getAdminSupabaseClient();

  // RATIFY-EMP3-2 — refuse BEFORE acquiring. A message must not burn its
  // sendable state on an attempt that could never have reached a provider; it
  // stays QUEUED and is dispatchable once a provider is configured.
  if (!isProviderConfigured()) {
    return { ok: false, status: "SKIPPED", error: "provider_not_configured" };
  }

  const { data: row } = await admin
    .from("communication_message")
    .select(SEND_SELECT)
    .eq("id", messageId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return { ok: false, status: "NOT_FOUND", error: "not_found" };

  const m = row as unknown as Record<string, unknown>;

  // EMP-5G — MAILBOX RUNTIME READINESS, and it runs BEFORE the compare-and-set
  // for the same reason `isProviderConfigured` does (RATIFY-EMP3-2): an
  // unverified mailbox is a condition that persists until someone fixes it, so
  // the message must keep its sendable state rather than burn it on an attempt
  // that could never have reached a customer. It stays QUEUED and sends itself
  // once the mailbox is verified.
  //
  // ONLY messages that HAVE a mailbox of record are gated. Invoice
  // notifications, portal invitations, quotation mail, welcome mail, tenant
  // provisioning — every template and system path — carry no `mailbox_id`,
  // never reach this branch, and are byte-for-byte unaffected. Blocking them
  // because they lack a mailbox they were never designed to have would be a
  // self-inflicted outage.
  let mailboxOfRecord: MailboxOfRecord | null = null;
  if (m.mailbox_id) {
    const facts = await loadMailboxFacts(admin, tenantId, m.mailbox_id as string);
    const decision = mailboxRuntimeEligibility({
      tenantId, mailbox: facts, direction: "OUTBOUND", now: new Date().toISOString(),
    });
    if (!decision.eligible) {
      return { ok: false, status: "SKIPPED", error: `mailbox_${decision.reason}` };
    }
    mailboxOfRecord = {
      id: facts!.id,
      tenantId: facts!.tenantId,
      address: facts!.address,
      isActive: true,
      provisioningStatus: facts!.provisioningStatus,
    };
  }

  // THE compare-and-set. Everything after this point is owned by exactly one
  // caller; everything before it is safe to run concurrently.
  const { data: acquired, error: acquireError } = await admin.rpc("comm_acquire_send", {
    p_message_id: messageId,
    p_tenant_id: tenantId,
  });
  if (acquireError) {
    reportError(acquireError, { scope: "action", event: "comms.acquire" });
    return { ok: false, status: "FAILED", error: "acquire_failed" };
  }
  if (acquired !== true) {
    // Another caller owns this send, or the message was not in a sendable
    // state. Either way this call must not touch the provider.
    return { ok: false, status: "NOT_ACQUIRED", error: "already_in_flight_or_not_sendable" };
  }

  // Recipients: template rows keep using `recipient_email`; composed rows use
  // the arrays. The provider seam takes one `to`, so the first recipient leads
  // and the rest are carried as a header-safe list by the caller's rendering.
  const to = addresses(m.to_addresses);
  const primary = (to[0] as string | undefined) ?? (m.recipient_email as string | null) ?? "";

  // EMP-5D — Reply-To from the MAILBOX OF RECORD, resolved AFTER the acquire so
  // exactly one sender owns the decision, from the facts read above rather than
  // accepted from anywhere. The lookup was tenant-scoped, so a mailbox_id
  // belonging to another tenant cannot become a Reply-To even if one were
  // stored on the row. Deterministic from the row, so a retry of the same
  // message resolves the identical value and the idempotency contract holds.
  const replyTo = resolveReplyTo(tenantId, mailboxOfRecord).replyTo;

  let result;
  try {
    result = await sendEmail({
      to: primary,
      toName: (m.recipient_name as string | null) ?? null,
      subject: (m.subject as string) ?? "",
      html: (m.body_html as string) ?? "",
      text: (m.body_text as string) ?? "",
      replyTo,
    });
  } catch (e) {
    // A thrown provider call is indistinguishable from a timeout: the message
    // may or may not have been accepted. Record the failure and let a human
    // decide — do NOT retry here.
    reportError(e, { scope: "action", event: "comms.provider_threw" });
    await admin.rpc("comm_record_send_failed", {
      p_message_id: messageId, p_tenant_id: tenantId, p_error: "provider_exception",
    });
    return { ok: false, status: "FAILED", error: "provider_exception" };
  }

  if (!result.ok || !result.provider) {
    await admin.rpc("comm_record_send_failed", {
      p_message_id: messageId, p_tenant_id: tenantId, p_error: result.error ?? "send_failed",
    });
    await writeAudit({
      action: AuditActions.COMMUNICATION_FAILED, actorId, tenantId,
      entity: "communication_message", entityId: messageId,
      after: { error: result.error ?? null },
    });
    return { ok: false, status: "FAILED", error: result.error ?? "send_failed" };
  }

  // Acceptance + ledger event, in ONE transaction. Returns false if this call
  // no longer owns the send, in which case the event was already emitted by
  // whoever did — never twice.
  const { data: recorded, error: recordError } = await admin.rpc("comm_record_send_accepted", {
    p_message_id: messageId,
    p_tenant_id: tenantId,
    p_provider: result.provider,
    p_provider_message_id: result.providerMessageId ?? null,
    p_actor_user_id: actorId,
  });

  if (recordError || recorded !== true) {
    // The provider ACCEPTED but we could not record it. The message is in
    // SENDING and must stay there: re-sending could duplicate a real email.
    // This is the boundary the audit named, surfaced rather than papered over.
    reportError(recordError ?? new Error("acceptance_not_recorded"), {
      scope: "action", event: "comms.acceptance_unrecorded",
    });
    await writeAudit({
      action: AuditActions.COMMUNICATION_FAILED, actorId, tenantId,
      entity: "communication_message", entityId: messageId,
      after: { error: "accepted_but_unrecorded", provider: result.provider },
    });
    return { ok: false, status: "FAILED", error: "accepted_but_unrecorded" };
  }

  await writeAudit({
    action: AuditActions.COMMUNICATION_SENT, actorId, tenantId,
    entity: "communication_message", entityId: messageId,
    after: { provider: result.provider },
  });
  return { ok: true, status: "SENT", provider: result.provider };
}

/**
 * Resolve a message stuck in SENDING (RATIFY-EMP3-1).
 *
 * The only exit from SENDING, and deliberately a human one. The platform cannot
 * know whether the provider accepted a message whose recording crashed, so it
 * refuses to guess: an operator with `communication:manage` states the outcome
 * and the decision is audited.
 *
 * CANCELLED and FAILED are the only outcomes offered. "It was actually sent" is
 * NOT offered, because recording an acceptance nobody witnessed would put a
 * fabricated CORRESPONDENCE_SENT into the ledger.
 */
export async function reconcileStuckSend(
  admin: Admin,
  tenantId: string,
  actorId: string,
  messageId: string,
  outcome: "FAILED" | "CANCELLED",
  note: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("comm_reconcile_stuck_send", {
    p_message_id: messageId, p_tenant_id: tenantId, p_outcome: outcome, p_note: note.slice(0, 400),
  });
  if (error || data !== true) return false;

  await writeAudit({
    action: AuditActions.COMMUNICATION_RECONCILED, actorId, tenantId,
    entity: "communication_message", entityId: messageId,
    after: { outcome, note: note.slice(0, 400) },
  });
  return true;
}
