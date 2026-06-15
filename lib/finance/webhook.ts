/**
 * Provider webhook processing pipeline (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The trust boundary for online money. A success event auto-records a payment
 * ONLY when EVERY guard passes (DEC-B24 Q4/Q6):
 *   1. valid HMAC signature over the raw body
 *   2. idempotency  — (provider, event_id) not seen before
 *   3. not replayed — provider timestamp within the skew window
 *   4. intent match — (provider, provider_intent_id) resolves to an intent
 *   5. amount match — equals the invoice's CURRENT balance (no partials, Q3)
 *   6. invoice payable — status allows a payment
 * Otherwise: log the event, mark the intent FAILED/UNMATCHED, route to manual
 * reconciliation. Money double-spend is independently prevented by an ATOMIC
 * conditional transition of the intent out of its open states.
 *
 * The resulting payment is a NORMAL `payment` row (born VERIFIED), so the 1.11
 * paid = Σ non-reversed formula is unchanged.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { balanceDue, invoiceTotals, paidAmount, paymentStatus, round2 } from "./calc";
import { canRecordPayment } from "./status";
import { amountMatches, isIntentStatus, isProviderName, type ProviderName } from "./payment-intent";
import { getPaymentProvider, ProviderError } from "./providers";
import { webhookSkewMinutes } from "./providers/config";
import type { InvoiceStatus, PaymentMethod } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Outcome = "APPLIED" | "DUPLICATE" | "REPLAYED" | "REJECTED" | "UNMATCHED";

export type WebhookResult = { httpStatus: number; outcome: Outcome | "ERROR"; detail?: string };

const OPEN_STATUSES = ["CREATED", "PENDING", "PROCESSING"];

/** Map a provider to a valid payment.method (MOCK has no method → OTHER). */
function methodForProvider(provider: ProviderName): PaymentMethod {
  if (provider === "WAVE") return "WAVE";
  if (provider === "ORANGE_MONEY") return "ORANGE_MONEY";
  return "OTHER";
}

async function invoiceBalance(supabase: Admin, invoiceId: string, tenantId: string) {
  const [lines, payments, inv] = await Promise.all([
    supabase.from("invoice_line").select("quantity, unit_amount, tax_rate").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
    supabase.from("payment").select("amount, reversed_at").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
    supabase.from("invoice").select("status").eq("id", invoiceId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const { total } = invoiceTotals(
    (lines.data ?? []).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) })),
  );
  const paid = paidAmount((payments.data ?? []).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null })));
  return { total, paid, balance: balanceDue(total, paid), status: (inv.data?.status ?? "VOID") as InvoiceStatus };
}

/** Append one webhook-event log row. Unique-violation = concurrent duplicate → swallowed. */
async function logEvent(
  supabase: Admin,
  row: {
    tenantId: string | null;
    provider: ProviderName;
    eventId: string;
    eventType: string;
    intentId: string | null;
    signatureValid: boolean;
    outcome: Outcome;
  },
): Promise<{ duplicate: boolean }> {
  const { error } = await supabase.from("provider_webhook_event").insert({
    tenant_id: row.tenantId,
    provider: row.provider,
    provider_event_id: row.eventId,
    event_type: row.eventType,
    payment_intent_id: row.intentId,
    signature_valid: row.signatureValid,
    outcome: row.outcome,
  });
  if (error) {
    // 23505 = unique_violation on (provider, provider_event_id)
    if (error.code === "23505") return { duplicate: true };
    throw new Error(`[webhook] event log failed: ${error.message}`);
  }
  return { duplicate: false };
}

export async function processWebhook(
  providerParam: string,
  rawBody: string,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  const name = providerParam.toUpperCase();
  if (!isProviderName(name)) return { httpStatus: 404, outcome: "ERROR", detail: "unknown_provider" };
  const provider: ProviderName = name;

  const supabase = getAdminSupabaseClient();

  // Parse + verify signature (provider-specific).
  let event;
  try {
    event = await getPaymentProvider(provider).parseWebhook(rawBody, headers);
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : "bad_payload";
    return { httpStatus: code === "not_configured" ? 503 : 400, outcome: "ERROR", detail: code };
  }

  // (1) signature
  if (!event.signatureValid) {
    await logEvent(supabase, {
      tenantId: null, provider, eventId: event.eventId || `unsigned_${event.eventType}`,
      eventType: event.eventType, intentId: null, signatureValid: false, outcome: "REJECTED",
    }).catch(() => undefined);
    await writeAudit({ action: AuditActions.PROVIDER_WEBHOOK_REPLAYED, entity: "provider_webhook_event", after: { provider, outcome: "REJECTED" } });
    return { httpStatus: 401, outcome: "REJECTED" };
  }

  if (!event.eventId) return { httpStatus: 400, outcome: "ERROR", detail: "missing_event_id" };

  // (2) idempotency — already seen?
  const { data: seen } = await supabase
    .from("provider_webhook_event")
    .select("id")
    .eq("provider", provider)
    .eq("provider_event_id", event.eventId)
    .maybeSingle();
  if (seen) return { httpStatus: 200, outcome: "DUPLICATE" };

  // (3) replay — too old?
  if (event.occurredAt) {
    const ageMin = (Date.now() - new Date(event.occurredAt).getTime()) / 60000;
    if (Number.isFinite(ageMin) && ageMin > webhookSkewMinutes()) {
      await logEvent(supabase, { tenantId: null, provider, eventId: event.eventId, eventType: event.eventType, intentId: null, signatureValid: true, outcome: "REPLAYED" }).catch(() => undefined);
      await writeAudit({ action: AuditActions.PROVIDER_WEBHOOK_REPLAYED, entity: "provider_webhook_event", after: { provider, event_id: event.eventId } });
      return { httpStatus: 200, outcome: "REPLAYED" };
    }
  }

  // (4) intent match
  if (!event.providerIntentId) return finalize(supabase, provider, event, null, null, "UNMATCHED", 202);
  const { data: intent } = await supabase
    .from("payment_intent")
    .select("id, tenant_id, invoice_id, status, amount, payment_id")
    .eq("provider", provider)
    .eq("provider_intent_id", event.providerIntentId)
    .maybeSingle();
  if (!intent) return finalize(supabase, provider, event, null, null, "UNMATCHED", 202);
  if (!isIntentStatus(intent.status)) return finalize(supabase, provider, event, intent.tenant_id, intent.id, "UNMATCHED", 202);

  // FAILURE event → mark intent FAILED (if still open).
  if (event.kind === "FAILURE") {
    await supabase
      .from("payment_intent")
      .update({ status: "FAILED", failed_at: new Date().toISOString(), last_error: "provider_failure" })
      .eq("id", intent.id).in("status", OPEN_STATUSES);
    await writeAudit({ action: AuditActions.PAYMENT_INTENT_FAILED, tenantId: intent.tenant_id, entity: "payment_intent", entityId: intent.id, after: { reason: "provider_failure" } });
    return finalize(supabase, provider, event, intent.tenant_id, intent.id, "APPLIED", 200);
  }

  // PENDING/UNKNOWN → nudge to PROCESSING, no money.
  if (event.kind !== "SUCCESS") {
    await supabase.from("payment_intent").update({ status: "PROCESSING" }).eq("id", intent.id).in("status", ["CREATED", "PENDING"]);
    return finalize(supabase, provider, event, intent.tenant_id, intent.id, "APPLIED", 200);
  }

  // SUCCESS — run the money guards (5,6) then ATOMIC transition (double-spend guard).
  const { balance, status } = await invoiceBalance(supabase, intent.invoice_id, intent.tenant_id);
  const amount = round2(Number(intent.amount));
  const payable = canRecordPayment(status);
  const matches = amountMatches(amount, balance);

  if (!payable || !matches || amount <= 0) {
    await supabase
      .from("payment_intent")
      .update({ status: "FAILED", failed_at: new Date().toISOString(), last_error: !payable ? "invoice_not_payable" : "amount_mismatch" })
      .eq("id", intent.id).in("status", OPEN_STATUSES);
    await writeAudit({ action: AuditActions.PAYMENT_INTENT_FAILED, tenantId: intent.tenant_id, entity: "payment_intent", entityId: intent.id, after: { reason: !payable ? "invoice_not_payable" : "amount_mismatch", amount, balance } });
    return finalize(supabase, provider, event, intent.tenant_id, intent.id, "UNMATCHED", 200);
  }

  // Atomic claim: only one worker transitions the intent out of its open states.
  const { data: claimed } = await supabase
    .from("payment_intent")
    .update({ status: "PROCESSING" })
    .eq("id", intent.id).in("status", OPEN_STATUSES)
    .select("id");
  if (!claimed || claimed.length === 0) {
    // Someone else already resolved it → idempotent no-op.
    return finalize(supabase, provider, event, intent.tenant_id, intent.id, "DUPLICATE", 200);
  }

  // Auto-record a NORMAL payment, born VERIFIED (trusted webhook success).
  const now = new Date().toISOString();
  const { data: pay, error: payErr } = await supabase
    .from("payment")
    .insert({
      tenant_id: intent.tenant_id,
      invoice_id: intent.invoice_id,
      amount,
      method: methodForProvider(provider),
      reference: event.providerReference ?? null,
      provider_name: provider,
      provider_reference: event.providerReference ?? null,
      paid_at: now.slice(0, 10),
      recorded_by: null,
      verification_status: "VERIFIED",
      verified_at: now,
    })
    .select("id")
    .single();
  if (payErr || !pay) {
    // Roll the claim back to PENDING so it can be retried/reconciled.
    await supabase.from("payment_intent").update({ status: "PENDING" }).eq("id", intent.id);
    return { httpStatus: 500, outcome: "ERROR", detail: payErr?.message ?? "record_failed" };
  }

  // Recompute the invoice payment status from the post-insert totals.
  const after = await invoiceBalance(supabase, intent.invoice_id, intent.tenant_id);
  await supabase
    .from("invoice")
    .update({ status: paymentStatus(after.total, round2(after.paid)) })
    .eq("id", intent.invoice_id).eq("tenant_id", intent.tenant_id);

  await supabase
    .from("payment_intent")
    .update({ status: "SUCCEEDED", payment_id: pay.id, provider_reference: event.providerReference ?? null, completed_at: now })
    .eq("id", intent.id);

  await writeAudit({ action: AuditActions.PAYMENT_INTENT_SUCCEEDED, tenantId: intent.tenant_id, entity: "payment_intent", entityId: intent.id, after: { payment_id: pay.id, amount } });
  await writeAudit({ action: AuditActions.PAYMENT_AUTO_RECORDED, tenantId: intent.tenant_id, entity: "invoice", entityId: intent.invoice_id, after: { payment_id: pay.id, provider, amount } });

  return finalize(supabase, provider, event, intent.tenant_id, intent.id, "APPLIED", 200);
}

/** Append the event log + the received-audit, then return the HTTP result. */
async function finalize(
  supabase: Admin,
  provider: ProviderName,
  event: { eventId: string; eventType: string; signatureValid: boolean },
  tenantId: string | null,
  intentId: string | null,
  outcome: Outcome,
  httpStatus: number,
): Promise<WebhookResult> {
  const { duplicate } = await logEvent(supabase, {
    tenantId, provider, eventId: event.eventId, eventType: event.eventType, intentId,
    signatureValid: event.signatureValid, outcome,
  });
  if (duplicate) return { httpStatus: 200, outcome: "DUPLICATE" };
  await writeAudit({ action: AuditActions.PROVIDER_WEBHOOK_RECEIVED, tenantId, entity: "provider_webhook_event", entityId: intentId, after: { provider, outcome, event_id: event.eventId } });
  return { httpStatus, outcome };
}
