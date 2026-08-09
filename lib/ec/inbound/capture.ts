import "server-only";

/**
 * EC-1 — THE inbound capture pipeline. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The trust boundary for unauthenticated internet input. Modelled directly on
 * lib/finance/webhook.ts (Phase 1.15B), which is the proven pattern here.
 *
 * A delivery is captured ONLY when every guard passes, in this order:
 *   1. feature flag        — env kill switch (503 when dark)
 *   2. known provider      — else 404
 *   3. size ceiling        — refused before parsing (25 MiB)
 *   4. parseable payload   — adapter maps it or we stop
 *   5. valid signature     — HMAC over the RAW body, timing-safe
 *   6. idempotency         — (provider, event_id) not seen before
 *   7. routing             — recipient resolves to exactly ONE mailbox
 *   8. tenant enablement   — the tenant's own rollout row
 *
 * Guards 7 and 8 do NOT discard: they QUARANTINE. The evidence is stored with
 * tenant_id = NULL, which the RLS tenant predicate excludes from every tenant —
 * so misrouted mail is preserved for a platform operator and invisible to all
 * customers. Discarding would destroy the only proof of what was received.
 *
 * WHAT THIS FILE CANNOT DO, BY CONSTRUCTION: create a client, quotation
 * request, dossier, document, task or invoice. It writes to five ec_* tables, a
 * private bucket and the audit log. There is no import of any business service
 * anywhere below, and a test pins that.
 */
import { createHash } from "crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";
import type { Json } from "@/lib/db/types";
import {
  InboundProviderError, isInboundProviderName,
  type CaptureResult, type InboundEmail, type InboundProviderName, type QuarantineReason,
} from "./types";
import { getInboundProvider, inboundEnabled } from "./providers";
import {
  deriveThreadKey, inboundStoragePath, isAllowedAttachmentMime, isOversized,
  normalizeAddress, resolveRouting, sanitizeFilename,
  MAX_ATTACHMENT_BYTES, type MailboxRow,
} from "./parse";

export const EC_INBOUND_BUCKET = "ec-inbound";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const sha256Hex = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

/**
 * Append one webhook-event row. A unique violation means a concurrent duplicate
 * delivery — reported as such, never as an error (the payments lesson).
 */
async function logEvent(
  admin: Admin,
  row: {
    tenantId: string | null;
    provider: string;
    eventId: string;
    signatureValid: boolean;
    outcome: "CAPTURED" | "DUPLICATE" | "QUARANTINED" | "REJECTED" | "ERROR";
    detail?: string | null;
  },
): Promise<{ duplicate: boolean }> {
  const { error } = await admin.from("ec_webhook_event").insert({
    tenant_id: row.tenantId,
    provider: row.provider,
    provider_event_id: row.eventId,
    signature_valid: row.signatureValid,
    outcome: row.outcome,
    detail: row.detail ?? null,
  });
  if (error) {
    if (error.code === "23505") return { duplicate: true }; // unique_violation
    throw new Error(`[ec] webhook event log failed: ${error.message}`);
  }
  return { duplicate: false };
}

/**
 * Look up every configured mailbox matching any recipient of this message.
 *
 * EMP-5G reads the full lifecycle facts, not just `is_active`: the routing
 * decision now asks the mailbox runtime authority whether this address may
 * receive real customer mail, and that authority needs the evidence itself.
 */
async function matchMailboxes(admin: Admin, recipients: string[]): Promise<MailboxRow[]> {
  if (recipients.length === 0) return [];
  const { data, error } = await admin
    .from("ec_mailbox")
    .select(
      "id, tenant_id, address, is_active, mailbox_type, owner_user_id, "
      + "provisioning_status, provisioning_note, ownership, external_provider, "
      + "external_mailbox_id, corporate_identity_confirmed_at, "
      + "corporate_identity_confirmed_by, outbound_verified_at, outbound_verified_by, "
      + "outbound_verification_ref, inbound_verified_at, inbound_verified_by, "
      + "inbound_verification_ref, activated_at, activated_by",
    )
    .in("address", recipients);
  if (error) throw new Error(`[ec] mailbox lookup failed: ${error.message}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id, tenantId: m.tenant_id, address: m.address, isActive: m.is_active,
    facts: {
      id: m.id,
      tenantId: m.tenant_id,
      address: m.address ?? "",
      mailboxType: m.mailbox_type ?? "SHARED",
      ownerUserId: m.owner_user_id ?? null,
      provisioningStatus: m.provisioning_status ?? "",
      provisioningNote: m.provisioning_note ?? null,
      ownership: m.ownership ?? "UNKNOWN",
      externalProvider: m.external_provider ?? null,
      externalMailboxId: m.external_mailbox_id ?? null,
      corporateIdentityConfirmedAt: m.corporate_identity_confirmed_at ?? null,
      corporateIdentityConfirmedBy: m.corporate_identity_confirmed_by ?? null,
      outboundVerifiedAt: m.outbound_verified_at ?? null,
      outboundVerifiedBy: m.outbound_verified_by ?? null,
      outboundVerificationRef: m.outbound_verification_ref ?? null,
      inboundVerifiedAt: m.inbound_verified_at ?? null,
      inboundVerifiedBy: m.inbound_verified_by ?? null,
      inboundVerificationRef: m.inbound_verification_ref ?? null,
      activatedAt: m.activated_at ?? null,
      activatedBy: m.activated_by ?? null,
    },
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Layer two of the flag: the tenant's own rollout row. Missing row = OFF. */
async function tenantEnabled(admin: Admin, tenantId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("tenant_ec_inbound_rollout")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return false; // fail closed
  return data.enabled === true;
}

/** Upload one object into the private bucket. Returns the path, or null. */
async function putObject(
  admin: Admin, path: string, body: Buffer, contentType: string,
): Promise<string | null> {
  const { error } = await admin.storage
    .from(EC_INBOUND_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error) return null;
  return path;
}

/**
 * Persist the envelope, its bodies and its attachments, then the triage item.
 * `tenantId` is null for quarantine — the storage scope becomes "quarantine",
 * which keeps unrouted evidence out of every tenant's path prefix.
 */
async function persist(
  admin: Admin,
  email: InboundEmail,
  provider: InboundProviderName,
  routed: { tenantId: string; mailboxId: string } | null,
  quarantineReason: QuarantineReason | null,
): Promise<string> {
  const tenantId = routed?.tenantId ?? null;
  const messageRowId = crypto.randomUUID();
  const scope = tenantId ?? "quarantine";

  const rawBuf = Buffer.from(email.rawEnvelope, "utf8");
  const rawPath = inboundStoragePath(scope, messageRowId, "raw.eml");
  await putObject(admin, rawPath, rawBuf, "message/rfc822");

  let textPath: string | null = null;
  if (email.textBody) {
    textPath = await putObject(
      admin, inboundStoragePath(scope, messageRowId, "body.txt"),
      Buffer.from(email.textBody, "utf8"), "text/plain",
    );
  }
  let htmlPath: string | null = null;
  if (email.htmlBody) {
    htmlPath = await putObject(
      admin, inboundStoragePath(scope, messageRowId, "body.html"),
      Buffer.from(email.htmlBody, "utf8"), "text/html",
    );
  }

  const receivedAt = email.receivedAt ?? new Date().toISOString();

  const { error: msgErr } = await admin.from("ec_inbound_message").insert({
    id: messageRowId,
    tenant_id: tenantId,
    mailbox_id: routed?.mailboxId ?? null,
    provider,
    provider_event_id: email.eventId,
    provider_message_id: email.providerMessageId,
    message_id: email.messageId,
    in_reply_to: email.inReplyTo,
    references_header: email.referencesHeader,
    thread_key: deriveThreadKey(email),
    from_address: email.fromAddress,
    from_name: email.fromName,
    to_addresses: email.toAddresses as unknown as Json,
    cc_addresses: email.ccAddresses as unknown as Json,
    subject: email.subject,
    raw_sha256: sha256Hex(rawBuf),
    raw_storage_path: rawPath,
    raw_size_bytes: rawBuf.byteLength,
    headers: email.headers as unknown as Json,
    text_body_path: textPath,
    html_body_path: htmlPath,
    received_at: receivedAt,
    capture_status: quarantineReason ? "QUARANTINED" : "RECEIVED",
    quarantine_reason: quarantineReason,
  });
  if (msgErr) throw new Error(`[ec] message insert failed: ${msgErr.message}`);

  // Attachments: EVERY part is recorded; only allowed, in-budget ones are stored.
  for (const [i, part] of email.attachments.entries()) {
    const bytes = Buffer.from(part.contentBase64, "base64");
    const filename = sanitizeFilename(part.filename);
    const mime = part.mimeType?.split(";")[0].trim().toLowerCase() ?? null;

    let stored = false;
    let storagePath: string | null = null;
    let rejection: "mime_not_allowed" | "too_large" | "extraction_failed" | null = null;

    if (!isAllowedAttachmentMime(mime)) {
      rejection = "mime_not_allowed";
    } else if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      rejection = "too_large";
    } else {
      storagePath = await putObject(
        admin, inboundStoragePath(scope, messageRowId, `att-${i}-${filename}`),
        bytes, mime ?? "application/octet-stream",
      );
      if (storagePath) stored = true;
      else rejection = "extraction_failed";
    }

    const { error: attErr } = await admin.from("ec_inbound_attachment").insert({
      tenant_id: tenantId,
      message_id: messageRowId,
      filename,
      original_filename: part.filename?.slice(0, 300) ?? null,
      mime_type: mime,
      size_bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      storage_path: storagePath,
      stored,
      rejection_reason: rejection,
    });
    if (attErr) throw new Error(`[ec] attachment insert failed: ${attErr.message}`);
  }

  // The mutable half. Quarantined mail starts (and stays) QUARANTINED.
  const { error: triErr } = await admin.from("ec_triage_item").insert({
    tenant_id: tenantId,
    message_id: messageRowId,
    status: quarantineReason ? "QUARANTINED" : "NEW",
  });
  if (triErr) throw new Error(`[ec] triage insert failed: ${triErr.message}`);

  return messageRowId;
}

/**
 * Process one inbound webhook delivery.
 *
 * AUDIT DISCIPLINE: every payload below carries identifiers, an outcome and a
 * short classification — never a subject, body, filename, address or header
 * value. `writeAudit` is called with a "system." action because the actor is a
 * machine, which the AUD-2 validator requires for unattributed events.
 */
export async function captureInbound(
  providerParam: string,
  rawBody: string,
  headers: Record<string, string>,
): Promise<CaptureResult> {
  // (1) feature flag — the global kill switch.
  if (!inboundEnabled()) return { httpStatus: 503, outcome: "ERROR", detail: "inbound_disabled" };

  // (2) known provider.
  const name = providerParam.toUpperCase();
  if (!isInboundProviderName(name)) {
    return { httpStatus: 404, outcome: "ERROR", detail: "unknown_provider" };
  }
  const provider: InboundProviderName = name;

  // (3) size ceiling — refused before any parsing work is done.
  if (isOversized(rawBody)) {
    return { httpStatus: 413, outcome: "REJECTED", detail: "payload_too_large" };
  }

  const admin = getAdminSupabaseClient();

  // (4) parseable payload.
  let email: InboundEmail;
  try {
    email = await getInboundProvider(provider).parseWebhook(rawBody, headers);
  } catch (e) {
    const code = e instanceof InboundProviderError ? e.code : "bad_payload";
    return {
      httpStatus: code === "not_configured" ? 503 : 400,
      outcome: "ERROR",
      detail: code,
    };
  }

  // (5) signature. Logged as a refusal, then dropped — an unsigned body is not
  // evidence of anything except that someone posted to a public URL.
  if (!email.signatureValid) {
    await logEvent(admin, {
      tenantId: null, provider, eventId: email.eventId,
      signatureValid: false, outcome: "REJECTED", detail: "invalid_signature",
    }).catch(() => undefined);
    await writeAudit({
      action: AuditActions.EC_INBOUND_REJECTED,
      entity: "ec_webhook_event",
      after: { provider, outcome: "REJECTED", reason: "invalid_signature" },
    }).catch(() => undefined);
    return { httpStatus: 401, outcome: "REJECTED", detail: "invalid_signature" };
  }

  // (6) idempotency — replay-safe on (provider, event_id).
  const { data: seen } = await admin
    .from("ec_webhook_event")
    .select("id")
    .eq("provider", provider)
    .eq("provider_event_id", email.eventId)
    .maybeSingle();
  if (seen) return { httpStatus: 200, outcome: "DUPLICATE", detail: "already_captured" };

  try {
    // (7) routing — explicit, or quarantine. Sender is NEVER consulted.
    const recipients = [...new Set([...email.toAddresses, ...email.ccAddresses])]
      .map((a) => normalizeAddress(a))
      .filter((a): a is string => a !== null);
    const routing = resolveRouting(
      await matchMailboxes(admin, recipients),
      new Date().toISOString(),
    );

    let routed: { tenantId: string; mailboxId: string } | null = null;
    let quarantine: QuarantineReason | null = null;

    if (!routing.routed) {
      quarantine = routing.reason;
    } else {
      // (8) tenant enablement — layer two of the flag.
      if (!(await tenantEnabled(admin, routing.tenantId))) {
        quarantine = "tenant_not_enabled";
      } else {
        routed = { tenantId: routing.tenantId, mailboxId: routing.mailboxId };
      }
    }

    const messageRowId = await persist(admin, email, provider, routed, quarantine);

    const outcome = quarantine ? "QUARANTINED" : "CAPTURED";
    const { duplicate } = await logEvent(admin, {
      tenantId: routed?.tenantId ?? null,
      provider,
      eventId: email.eventId,
      signatureValid: true,
      outcome,
      detail: quarantine ?? null,
    });
    if (duplicate) return { httpStatus: 200, outcome: "DUPLICATE", detail: "concurrent_delivery" };

    await writeAudit({
      action: quarantine ? AuditActions.EC_INBOUND_QUARANTINED : AuditActions.EC_INBOUND_RECEIVED,
      tenantId: routed?.tenantId ?? null,
      entity: "ec_inbound_message",
      entityId: messageRowId,
      // Identifiers, outcome and classification ONLY.
      after: {
        provider,
        provider_event_id: email.eventId,
        mailbox_id: routed?.mailboxId ?? null,
        outcome,
        reason: quarantine ?? null,
        attachments: email.attachments.length,
      },
    });

    return { httpStatus: 200, outcome, detail: quarantine ?? undefined };
  } catch (e) {
    // The failure is reported server-side; the caller learns nothing internal.
    reportError(e, { scope: "webhook", event: "ec.inbound.capture", extra: { provider } });
    await logEvent(admin, {
      tenantId: null, provider, eventId: email.eventId,
      signatureValid: true, outcome: "ERROR", detail: "capture_failed",
    }).catch(() => undefined);
    return { httpStatus: 500, outcome: "ERROR", detail: "capture_failed" };
  }
}
