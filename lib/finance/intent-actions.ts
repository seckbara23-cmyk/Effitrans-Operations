"use server";

/**
 * Payment-intent server actions (Phase 1.15B). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Staff generate + send payment links (finance:payment); cancel intents
 * (finance:void). Portal users may self-initiate an intent on their own invoice
 * (gated by the portal identity), but the portal Pay button ships disabled
 * behind PAYMENTS_ENABLED. Creating an intent NEVER records money — only a
 * trusted webhook success (lib/finance/webhook) auto-creates a payment.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { queueAndSend } from "@/lib/comms/queue";
import { balanceDue, invoiceTotals, paidAmount, round2 } from "./calc";
import { canRecordPayment } from "./status";
import { canCancel, isIntentStatus, isProviderName, type IntentStatus, type ProviderName } from "./payment-intent";
import { getPaymentProvider, ProviderError } from "./providers";
import { intentTtlMinutes, paymentsEnabled, isProviderConfigured } from "./providers/config";
import type { ActionResult, InvoiceStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

function revalidate(fileId?: string | null) {
  if (fileId) revalidatePath(`/files/${fileId}`);
  revalidatePath("/finance");
  revalidatePath("/finance/reconciliation");
}

async function loadInvoiceForIntent(supabase: Admin, invoiceId: string, tenantId: string) {
  const { data } = await supabase
    .from("invoice")
    .select("id, file_id, client_id, status, currency, invoice_number")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

async function invoiceBalance(supabase: Admin, invoiceId: string, tenantId: string) {
  const [lines, payments] = await Promise.all([
    supabase.from("invoice_line").select("quantity, unit_amount, tax_rate").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
    supabase.from("payment").select("amount, reversed_at").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
  ]);
  const { total } = invoiceTotals(
    (lines.data ?? []).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) })),
  );
  const paid = paidAmount((payments.data ?? []).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null })));
  return balanceDue(total, paid);
}

/**
 * Shared creation path for staff + portal. Validates the provider + invoice,
 * inserts a CREATED intent, calls the provider, and advances to PENDING (or
 * FAILED on a provider error). Returns the checkout URL.
 */
async function createIntent(
  supabase: Admin,
  args: {
    tenantId: string;
    invoiceId: string;
    provider: ProviderName;
    actorId?: string | null;
    clientUserId?: string | null;
  },
): Promise<ActionResult & { checkoutUrl?: string | null }> {
  if (!paymentsEnabled()) return { ok: false, error: "payments_disabled" };
  if (!isProviderConfigured(args.provider)) return { ok: false, error: "provider_unavailable" };

  const inv = await loadInvoiceForIntent(supabase, args.invoiceId, args.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canRecordPayment(inv.status as InvoiceStatus)) return { ok: false, error: "not_payable" };

  const balance = round2(await invoiceBalance(supabase, args.invoiceId, args.tenantId));
  if (balance <= 0) return { ok: false, error: "nothing_due" };

  const { data: created, error: insErr } = await supabase
    .from("payment_intent")
    .insert({
      tenant_id: args.tenantId,
      invoice_id: args.invoiceId,
      provider: args.provider,
      amount: balance, // full balance only — no partial online payments (Q3)
      currency: inv.currency,
      status: "CREATED",
      created_by: args.actorId ?? null,
      created_by_client: args.clientUserId ?? null,
    })
    .select("id")
    .single();
  if (insErr || !created) return { ok: false, error: insErr?.message ?? "create_failed" };

  try {
    const checkout = await getPaymentProvider(args.provider).createCheckout({
      intentId: created.id,
      amount: balance,
      currency: inv.currency,
      invoiceNumber: inv.invoice_number,
    });
    const expiresAt = checkout.expiresAt ?? new Date(Date.now() + intentTtlMinutes() * 60000).toISOString();
    await supabase
      .from("payment_intent")
      .update({
        status: "PENDING",
        provider_intent_id: checkout.providerIntentId,
        provider_checkout_url: checkout.checkoutUrl,
        expires_at: expiresAt,
      })
      .eq("id", created.id);

    await writeAudit({
      action: AuditActions.PAYMENT_INTENT_CREATED,
      tenantId: args.tenantId,
      actorId: args.actorId ?? null,
      clientUserId: args.clientUserId ?? null,
      entity: "payment_intent",
      entityId: created.id,
      after: { provider: args.provider, amount: balance, invoice_id: args.invoiceId },
    });
    revalidate(inv.file_id);
    return { ok: true, id: created.id, checkoutUrl: checkout.checkoutUrl };
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : "provider_error";
    await supabase
      .from("payment_intent")
      .update({ status: "FAILED", failed_at: new Date().toISOString(), last_error: code })
      .eq("id", created.id);
    return { ok: false, error: code };
  }
}

/** Staff: generate a payment link for an issued invoice (finance:payment). */
export async function createPaymentLink(invoiceId: string, provider: string): Promise<ActionResult & { checkoutUrl?: string | null }> {
  let user;
  try {
    user = await assertPermission("finance:payment");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isProviderName(provider.toUpperCase())) return { ok: false, error: "unknown_provider" };
  const supabase = getAdminSupabaseClient();
  return createIntent(supabase, { tenantId: user.tenantId, invoiceId, provider: provider.toUpperCase() as ProviderName, actorId: user.id });
}

/** Staff: email the payment link to the invoice's client via the Communications Hub. */
export async function sendPaymentLink(intentId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:payment");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: intent } = await supabase
    .from("payment_intent")
    .select("id, invoice_id, status, provider_checkout_url, amount, currency")
    .eq("id", intentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!intent || !intent.provider_checkout_url) return { ok: false, error: "not_found" };
  if ((intent.status as IntentStatus) !== "PENDING" && (intent.status as IntentStatus) !== "PROCESSING") {
    return { ok: false, error: "not_sendable" };
  }

  const { data: inv } = await supabase
    .from("invoice")
    .select("file_id, client_id, invoice_number, client:client_id(name, email)")
    .eq("id", intent.invoice_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ file_id: string; client_id: string; invoice_number: string | null; client: { name: string | null; email: string | null } | null }>();
  if (!inv?.client?.email) return { ok: false, error: "no_recipient" };

  const res = await queueAndSend({
    tenantId: user.tenantId,
    createdBy: user.id,
    templateKey: "payment_link",
    vars: {
      clientName: inv.client.name ?? "",
      invoiceNumber: inv.invoice_number ?? "",
      amount: `${intent.amount.toLocaleString("fr-FR")} ${intent.currency}`,
      paymentLink: intent.provider_checkout_url,
    },
    recipientEmail: inv.client.email,
    recipientName: inv.client.name,
    related: "payment_intent",
    relatedId: intent.id,
    fileId: inv.file_id,
    clientId: inv.client_id,
  });
  revalidate(inv.file_id);
  return res.id ? { ok: true, id: intent.id } : { ok: false, error: "send_failed" };
}

/** Staff: cancel an open intent (finance:void). */
export async function cancelPaymentIntent(intentId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:void");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: intent } = await supabase
    .from("payment_intent")
    .select("id, invoice_id, status")
    .eq("id", intentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!intent) return { ok: false, error: "not_found" };
  const status = isIntentStatus(intent.status) ? intent.status : "CREATED";
  if (!canCancel(status)) return { ok: false, error: "not_cancellable" };

  const { data: claimed } = await supabase
    .from("payment_intent")
    .update({ status: "CANCELLED" })
    .eq("id", intentId)
    .in("status", ["CREATED", "PENDING", "PROCESSING"])
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, error: "not_cancellable" };

  const { data: inv } = await supabase.from("invoice").select("file_id").eq("id", intent.invoice_id).maybeSingle();
  await writeAudit({ action: AuditActions.PAYMENT_INTENT_CANCELLED, tenantId: user.tenantId, actorId: user.id, entity: "payment_intent", entityId: intentId });
  revalidate(inv?.file_id);
  return { ok: true, id: intentId };
}

/**
 * Portal: a client self-initiates payment on its own invoice. Gated by the
 * portal identity + ownership (not an RBAC permission). Reachable only when
 * PAYMENTS_ENABLED is on (the portal Pay button is otherwise hidden/disabled).
 */
export async function createPortalPaymentIntent(invoiceId: string, provider: string): Promise<ActionResult & { checkoutUrl?: string | null }> {
  const portalUser = await getCurrentPortalUser();
  if (!portalUser || portalUser.status !== "ACTIVE") return { ok: false, error: "forbidden" };
  if (!isProviderName(provider.toUpperCase())) return { ok: false, error: "unknown_provider" };

  const supabase = getAdminSupabaseClient();
  // Ownership: the invoice must belong to this portal user's client + tenant.
  const inv = await loadInvoiceForIntent(supabase, invoiceId, portalUser.tenantId);
  if (!inv || inv.client_id !== portalUser.clientId) return { ok: false, error: "not_found" };

  return createIntent(supabase, {
    tenantId: portalUser.tenantId,
    invoiceId,
    provider: provider.toUpperCase() as ProviderName,
    clientUserId: portalUser.id,
  });
}
