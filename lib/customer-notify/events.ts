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
  | "file_opened"
  | "documents_received"
  | "documents_verified"
  | "customs_cleared"
  | "transport_started"
  | "delivered"
  | "invoice_issued"
  | "payment_received"
  // EC-3D — the commercial decision, acknowledged to the customer. A quotation
  // has NO dossier and NO invoice at this point, so these resolve their
  // recipient through the quotation itself (see service.ts).
  | "quotation_accepted"
  | "quotation_declined";

export type NotifyCategory = "shipment" | "invoice" | "payment" | "commercial";
/** Channels — email + portal in MVP; sms/whatsapp are reserved extension points. */
export type NotifyChannel = "email" | "portal";

export type CustomerEventDef = { category: NotifyCategory; template: TemplateKey };

export const CUSTOMER_EVENTS: Record<CustomerEvent, CustomerEventDef> = {
  // Phase 9.0C — the canonical « Dossier reçu » initial milestone, published by
  // the intake action ONLY after the dossier and its process instance persisted.
  file_opened: { category: "shipment", template: "shipment_progress" },
  documents_received: { category: "shipment", template: "shipment_progress" },
  documents_verified: { category: "shipment", template: "shipment_progress" },
  customs_cleared: { category: "shipment", template: "shipment_progress" },
  transport_started: { category: "shipment", template: "shipment_progress" },
  delivered: { category: "shipment", template: "shipment_delivered" },
  invoice_issued: { category: "invoice", template: "invoice_issued" },
  payment_received: { category: "payment", template: "payment_received" },
  quotation_accepted: { category: "commercial", template: "quotation_accepted" },
  quotation_declined: { category: "commercial", template: "quotation_declined" },
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
  // EC-3D — a quotation acknowledgement follows the SHIPMENT preference. No new
  // preference column is invented: the quotation is the shipment's first step,
  // and a customer who muted shipment updates has muted this too.
  if (category === "commercial") return prefs.notify_shipment;
  return false;
}
