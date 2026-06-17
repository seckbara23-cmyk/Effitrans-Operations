/**
 * Customer notification events (Phase 2.5) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The seven customer-relevant milestones, each mapped to a category + an
 * existing Communications Hub template. Customer-facing copy lives in i18n
 * (t.customerNotify.events) — this module is internal-language-free. Dedup keys
 * and the email-preference filter are pure + unit-tested.
 */
import type { TemplateKey } from "@/lib/comms/templates";

export type CustomerEvent =
  | "documents_received"
  | "documents_verified"
  | "customs_cleared"
  | "transport_started"
  | "delivered"
  | "invoice_issued"
  | "payment_received";

export type NotifyCategory = "shipment" | "invoice" | "payment";
/** Channels — email + portal in MVP; sms/whatsapp are reserved extension points. */
export type NotifyChannel = "email" | "portal";

export type CustomerEventDef = { category: NotifyCategory; template: TemplateKey };

export const CUSTOMER_EVENTS: Record<CustomerEvent, CustomerEventDef> = {
  documents_received: { category: "shipment", template: "shipment_progress" },
  documents_verified: { category: "shipment", template: "shipment_progress" },
  customs_cleared: { category: "shipment", template: "shipment_progress" },
  transport_started: { category: "shipment", template: "shipment_progress" },
  delivered: { category: "shipment", template: "shipment_delivered" },
  invoice_issued: { category: "invoice", template: "invoice_issued" },
  payment_received: { category: "payment", template: "payment_received" },
};

export const CUSTOMER_EVENT_KEYS = Object.keys(CUSTOMER_EVENTS) as CustomerEvent[];

export function isCustomerEvent(v: string): v is CustomerEvent {
  return (CUSTOMER_EVENT_KEYS as string[]).includes(v);
}

/** One notification per (event + entity). Webhook retries / repeats hit the unique index. */
export function dedupKey(event: CustomerEvent, entityId: string): string {
  return `${event}:${entityId}`;
}

export type EmailPrefs = {
  notify_email: boolean;
  notify_shipment: boolean;
  notify_invoice: boolean;
  notify_payment: boolean;
};

/** Email channel allowed for this category given the portal user's preferences. */
export function emailAllowed(prefs: EmailPrefs, category: NotifyCategory): boolean {
  if (!prefs.notify_email) return false;
  if (category === "shipment") return prefs.notify_shipment;
  if (category === "invoice") return prefs.notify_invoice;
  if (category === "payment") return prefs.notify_payment;
  return false;
}
