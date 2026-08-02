"use server";
/**
 * EC-3C — quotation delivery and artifact access. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors `lib/finance/invoice-send.ts` deliberately, statement for statement:
 * resolve the STORED artifact, download those exact bytes, attach them, and
 * hand the message to the existing `lib/comms` provider. No second email
 * engine, no template table, no re-render — the customer receives the same
 * bytes whose SHA-256 the quotation row already records, which is the entire
 * point of storing the hash.
 *
 * Sending is not a state transition here. `sendQuotation` (actions.ts) already
 * minted the number, froze the quotation and emitted QUOTATION_SENT through its
 * RPC. This delivers the document. A delivery failure therefore reports itself
 * and stays retryable; it never un-sends a quotation, because the event that
 * says it was sent has already committed.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { sendEmail, isProviderConfigured } from "@/lib/comms/provider";
import { createSignedDownloadUrl, downloadObject } from "@/lib/documents/storage";
import { writeAudit } from "@/lib/audit/log";
import { assertCommercialRead } from "./service";

export type QuotationSendResult =
  | { ok: true; sha256: string | null; resend: boolean }
  | { ok: false; error: string };

/** Filename the customer sees. Derived from the minted number, never invented. */
function quotationFileName(number: string | null, version: number): string {
  return `${(number ?? "cotation").replace(/[^\w.-]+/g, "-")}-v${version}.pdf`;
}

/**
 * Email a SENT quotation to the customer with its immutable PDF attached.
 *
 * Gated on `quotation:send` — the same authority as the act of sending, so a
 * validator cannot deliver an offer and an agent cannot deliver one that was
 * never validated (the quotation would not be in SENT).
 */
export async function emailQuotationToCustomer(quotationId: string): Promise<QuotationSendResult> {
  let user;
  try { user = await assertPermission("quotation:send"); }
  catch { return { ok: false, error: "forbidden_send" }; }

  const s = getAdminSupabaseClient();
  const { data: q } = await s.from("quotation")
    .select("id, client_id, status, quotation_number, version, artifact_storage_path, artifact_sha256")
    .eq("id", quotationId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!q) return { ok: false, error: "not_found" };

  // Only an offer that actually went out may be delivered. A DRAFT or a
  // PENDING_VALIDATION quotation has no number and no artifact by construction.
  if (q.status !== "SENT" && q.status !== "ACCEPTED" && q.status !== "DECLINED") {
    return { ok: false, error: "not_sent" };
  }
  if (!q.artifact_storage_path) return { ok: false, error: "artifact_unavailable" };

  const { data: client } = q.client_id
    ? await s.from("client").select("name, email")
        .eq("id", q.client_id).eq("tenant_id", user.tenantId).maybeSingle()
    : { data: null };
  const to = client?.email?.trim();
  if (!to) return { ok: false, error: "no_recipient" };

  if (!isProviderConfigured()) return { ok: false, error: "email_not_configured" };

  // THE stored artifact. Not a re-render.
  const bytes = await downloadObject(q.artifact_storage_path);
  if (!bytes) return { ok: false, error: "artifact_unavailable" };

  const { count: priorSends } = await s.from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId).eq("entity", "quotation")
    .eq("entity_id", quotationId).eq("action", "commercial.quotation.delivered");
  const resend = (priorSends ?? 0) > 0;

  const label = q.quotation_number ?? "";
  const result = await sendEmail({
    to,
    toName: client?.name ?? null,
    subject: `${resend ? "Rappel — " : ""}Cotation ${label}`,
    html:
      `<p>Bonjour,</p>` +
      `<p>Veuillez trouver ci-jointe notre cotation <strong>${label}</strong>.</p>` +
      `<p>Nous restons à votre disposition pour toute précision.</p>` +
      `<p>Cordialement,<br/>Service Commercial</p>`,
    text:
      `Cotation ${label}\n\n` +
      `Veuillez trouver ci-jointe notre cotation.\n` +
      `Nous restons à votre disposition pour toute précision.`,
    attachments: [{
      filename: quotationFileName(q.quotation_number, q.version),
      contentBase64: Buffer.from(bytes).toString("base64"),
    }],
  });

  if (!result.ok) {
    await writeAudit({
      action: "commercial.quotation.delivery_failed", actorId: user.id, tenantId: user.tenantId,
      entity: "quotation", entityId: quotationId,
      after: { quotation_number: q.quotation_number, error: result.error ?? "send_failed" },
    });
    return { ok: false, error: result.error ?? "send_failed" };
  }

  // Records WHICH artifact was delivered, by hash — so "what did the customer
  // actually receive" is answerable years later.
  await writeAudit({
    action: "commercial.quotation.delivered", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId,
    after: { quotation_number: q.quotation_number, content_sha256: q.artifact_sha256, resend },
  });

  return { ok: true, sha256: q.artifact_sha256 ?? null, resend };
}

/**
 * A short-lived signed URL for the stored PDF.
 *
 * Gated by `assertCommercialRead`, not by `quotation:send`: a validator must be
 * able to OPEN the document they are judging. The bucket is private and no
 * `storage.objects` policy exposes it to `authenticated`, so this function is
 * the only way in — which is why the gate is here rather than on the caller.
 */
export async function quotationArtifactUrl(quotationId: string): Promise<string | null> {
  const s = getAdminSupabaseClient();
  const { data: q } = await s.from("quotation")
    .select("tenant_id, artifact_storage_path").eq("id", quotationId).maybeSingle();
  if (!q?.artifact_storage_path) return null;
  try {
    await assertCommercialRead(q.tenant_id as string);
  } catch {
    return null;
  }
  return createSignedDownloadUrl(q.artifact_storage_path as string);
}
