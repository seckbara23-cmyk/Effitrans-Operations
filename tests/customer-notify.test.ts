import { describe, it, expect } from "vitest";
import { CUSTOMER_EVENTS, CUSTOMER_EVENT_KEYS, isCustomerEvent, dedupKey, emailAllowed } from "@/lib/customer-notify/events";
import { t } from "@/lib/i18n";

describe("customer notification events (Phase 2.5)", () => {
  it("maps the eight milestones to category + Hub template", () => {
    // Phase 9.0C added file_opened (« Dossier reçu ») to the original seven.
    expect(CUSTOMER_EVENT_KEYS).toHaveLength(8);
    expect(CUSTOMER_EVENTS.file_opened).toEqual({ category: "shipment", template: "shipment_progress" });
    expect(CUSTOMER_EVENTS.documents_received).toEqual({ category: "shipment", template: "shipment_progress" });
    expect(CUSTOMER_EVENTS.customs_cleared).toEqual({ category: "shipment", template: "shipment_progress" });
    expect(CUSTOMER_EVENTS.delivered.template).toBe("shipment_delivered");
    expect(CUSTOMER_EVENTS.invoice_issued.category).toBe("invoice");
    expect(CUSTOMER_EVENTS.payment_received.category).toBe("payment");
  });

  it("never treats internal events as customer events (no leakage)", () => {
    expect(isCustomerEvent("FINANCE_HANDOFF")).toBe(false);
    expect(isCustomerEvent("CUSTOMS_RELEASED")).toBe(false);
    expect(isCustomerEvent("customs_cleared")).toBe(true);
    // No internal handoff/SLA event is in the customer catalog.
    expect(Object.keys(CUSTOMER_EVENTS)).not.toContain("FINANCE_HANDOFF");
  });

  it("uses customer-friendly copy (CUSTOMS_RELEASED → 'dédouanée', not the internal code)", () => {
    const ev = t.portal.notify.events.customs_cleared;
    expect(ev.title).toContain("dédouanée");
    expect(ev.message).not.toContain("RELEASED");
    expect(ev.message).not.toContain("HANDOFF");
  });

  it("dedup key is stable per (event, entity) — repeats collapse to one", () => {
    expect(dedupKey("customs_cleared", "file-1")).toBe("customs_cleared:file-1");
    expect(dedupKey("customs_cleared", "file-1")).toBe(dedupKey("customs_cleared", "file-1"));
    expect(dedupKey("payment_received", "inv-9")).toBe("payment_received:inv-9");
  });
});

describe("email preference filtering", () => {
  const all = { notify_email: true, notify_shipment: true, notify_invoice: true, notify_payment: true };
  it("master email OFF blocks every category", () => {
    expect(emailAllowed({ ...all, notify_email: false }, "shipment")).toBe(false);
    expect(emailAllowed({ ...all, notify_email: false }, "invoice")).toBe(false);
  });
  it("a category OFF blocks only that category", () => {
    expect(emailAllowed({ ...all, notify_invoice: false }, "invoice")).toBe(false);
    expect(emailAllowed({ ...all, notify_invoice: false }, "shipment")).toBe(true);
    expect(emailAllowed({ ...all, notify_payment: false }, "payment")).toBe(false);
  });
  it("all ON allows every category", () => {
    expect(emailAllowed(all, "shipment")).toBe(true);
    expect(emailAllowed(all, "invoice")).toBe(true);
    expect(emailAllowed(all, "payment")).toBe(true);
  });
});
