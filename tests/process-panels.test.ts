/**
 * Phase 5.0D-5 — specialized panels, portal-safe outputs, privacy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveDriverContact, trackingFreshness } from "@/lib/process/panels/driver-contact";
import {
  PORTAL_POST_DELIVERY_STATES,
  invoiceVisibleToClient,
  portalPostDeliveryState,
} from "@/lib/portal/closure-view";
import { buildNavigation } from "@/lib/navigation/build";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import { derivePromise } from "@/lib/collections/model";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const amPanel = read("../lib/process/panels/account-manager.ts");
const transportPanel = read("../lib/process/panels/transport.ts");
const collectionsService = read("../lib/collections/service.ts");
const portalDocs = read("../lib/portal/docs-service.ts");
const collectionsPage = read("../app/collections/page.tsx");

const PERMS = ["process:read", "collections:manage", "transport:read", "courier:deposit", "admin_service:manage"];

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
});

/** Phase 5.0E-1 — ONE builder now produces the whole sidebar. */
const navHrefs = (
  roleCodes: string[],
  permissions: string[] = PERMS,
  featureFlags = FLAGS_ON,
): string[] => {
  const ctx: NavigationContext = {
    userId: "u1",
    tenantId: "t1",
    roleCodes,
    permissions,
    identityType: "tenant",
    featureFlags,
  };
  return buildNavigation(ctx).sections.flatMap((s) => s.items.map((i) => i.href));
};

// ---------------------------------------------------- DRIVER CONTACT PRIVACY ----

describe("driver contact privacy (Deliverable 2, criterion 4)", () => {
  it("NEVER exposes a personal driver number by default", () => {
    const c = resolveDriverContact({
      businessPhone: "+221 33 000 0000",
      driverPhone: "+221 77 123 4567",
    });
    expect(c.policy).toBe("business");
    expect(c.customerSafeContact).toBe("+221 33 000 0000");
    expect(c.exposesPersonalNumber).toBe(false);
    // The personal number does not leave the function.
    expect(c.customerSafeContact).not.toBe("+221 77 123 4567");
  });

  it("refuses to fall back to the personal number when no business number exists", () => {
    // A MISSING contact is better than a LEAKED one.
    const c = resolveDriverContact({ businessPhone: null, driverPhone: "+221 77 123 4567" });
    expect(c.policy).toBe("masked");
    expect(c.customerSafeContact).toBeNull();
    expect(c.exposesPersonalNumber).toBe(false);
  });

  it("shares the personal number ONLY on an explicit tenant opt-in", () => {
    const c = resolveDriverContact({
      businessPhone: "+221 33 000 0000",
      driverPhone: "+221 77 123 4567",
      tenantAllowsDriverDirect: true,
    });
    expect(c.policy).toBe("driver_direct");
    expect(c.customerSafeContact).toBe("+221 77 123 4567");
    // And it says so loudly, so it can never be shared unknowingly.
    expect(c.exposesPersonalNumber).toBe(true);
  });

  it("treats anything other than an explicit true as no opt-in", () => {
    for (const flag of [undefined, false]) {
      const c = resolveDriverContact({
        businessPhone: "+221 33 000 0000",
        driverPhone: "+221 77 123 4567",
        tenantAllowsDriverDirect: flag,
      });
      expect(c.exposesPersonalNumber).toBe(false);
    }
  });

  it("keeps the opt-in as a configuration seam, off everywhere today", () => {
    expect(transportPanel).toContain("EFFITRANS_SHARE_DRIVER_PHONE");
    expect(process.env.EFFITRANS_SHARE_DRIVER_PHONE).toBeUndefined();
  });
});

describe("tracking freshness", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  it("classifies position age deterministically", () => {
    expect(trackingFreshness(null, now)).toBe("none");
    expect(trackingFreshness("2026-07-14T11:59:00Z", now)).toBe("live");
    expect(trackingFreshness("2026-07-14T11:50:00Z", now)).toBe("stale");
    expect(trackingFreshness("2026-07-14T10:00:00Z", now)).toBe("offline");
  });
});

// -------------------------------------------------------------- AM portfolio ----

describe("Account Manager portfolio (Deliverable 1)", () => {
  it("is bounded — never one query per client, dossier, invoice or message", () => {
    expect(amPanel).toContain("BOUNDED");
    expect(amPanel).toContain("Never one query per client, per dossier, per invoice or per message");
    // Batched reads, not per-row.
    expect(amPanel).toContain("Promise.all");
    expect(amPanel).toContain('.in("client_id", clientIds)');
    expect(amPanel).toContain('.in("file_id", fileIds)');
  });

  it("reports its query count as telemetry", () => {
    expect(amPanel).toContain("queries");
    expect(amPanel).toContain('panel: "account_manager"');
  });

  it("NEVER leaks Collections or Finance internals", () => {
    for (const forbidden of [
      "collection_follow_up",
      "collections_assignee_id",
      "dispute_reason",
      "promised_payment_date",
      "escalated_at",
      "priority.score",
    ]) {
      expect(amPanel, `AM panel must not read ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows only a SAFE payment summary — the same balance finance uses", () => {
    expect(amPanel).toContain("invoiceTotals");
    expect(amPanel).toContain("paidAmount");
    expect(amPanel).toContain("The SAME balance finance uses — never a second ledger");
  });

  it("never ships a communication BODY — subject and timestamp only", () => {
    expect(amPanel).toContain("Subject only — never the message body");
    expect(amPanel).not.toContain("body_html");
    expect(amPanel).not.toContain("body_text");
  });

  it("hides the panel behind the workspaces flag", () => {
    expect(amPanel).toContain("if (!flags.workspaces) return empty;");
  });
});

// ----------------------------------------------------------- Transport panel ----

describe("Transport readiness panel (Deliverable 2)", () => {
  it("reuses the ENGINE's pickup gate rather than reimplementing it", () => {
    expect(transportPanel).toContain("evaluatePickupGate");
    expect(transportPanel).toContain("The engine's gate — not a reimplementation of it");
  });

  it("is bounded and reports its query count", () => {
    expect(transportPanel).toContain("BOUNDED");
    expect(transportPanel).toContain("Promise.all");
    expect(transportPanel).toContain('panel: "transport"');
  });

  it("hides the panel behind the workspaces flag", () => {
    expect(transportPanel).toContain("if (!flags.workspaces) return empty;");
  });
});

// -------------------------------------------------------- Collections detail ----

describe("Collections aging detail (Deliverable 3)", () => {
  it("supports every required filter, server-side", () => {
    for (const f of [
      "bucket",
      "assigneeId",
      "unassigned",
      "disputed",
      "promiseDue",
      "missedPromise",
      "noRecentFollowUp",
      "partiallyPaid",
      "fullyPaid",
      "pendingVerification",
      "closureReady",
      "minBalance",
      "maxBalance",
      "search",
    ]) {
      expect(collectionsService, `missing filter: ${f}`).toContain(`${f}?`);
    }
  });

  it("exposes the pending-verification signal, the superseded promise count and the blocker list", () => {
    expect(collectionsService).toContain("paymentAwaitingVerification");
    expect(collectionsService).toContain("closureBlockers");
    // The superseded count reaches the row via PromiseView (derived, append-only
    // history), and the page renders it — an earlier promise is counted, not erased.
    expect(derivePromise(
      [
        { id: "a", channel: "PHONE", outcome: "PAYMENT_PROMISED", note: null, promisedPaymentDate: "2026-07-05", promisedAmount: null, nextFollowUpAt: null, performedBy: "u", createdAt: "2026-07-01T00:00:00Z" },
        { id: "b", channel: "PHONE", outcome: "PAYMENT_PROMISED", note: null, promisedPaymentDate: "2026-07-25", promisedAmount: null, nextFollowUpAt: null, performedBy: "u", createdAt: "2026-07-06T00:00:00Z" },
      ],
      100,
      "2026-07-14",
    ).supersededCount).toBe(1);
    expect(collectionsPage).toContain("supersededCount");
  });

  it("paginates server-side", () => {
    expect(collectionsService).toContain("pageSize");
    expect(collectionsService).toContain("rows.slice(start, start + pageSize)");
  });

  it("sorts deterministically — no AI ordering", () => {
    expect(collectionsService).toContain("compareAging");
    expect(collectionsService).not.toContain("openai");
    expect(collectionsService).not.toContain("llm");
  });
});

// --------------------------------------------------------------- PORTAL SAFE ----

describe("portal-safe post-delivery state (Deliverables 5-6)", () => {
  const base = { fileStatus: "DELIVERED", invoiceStatus: null, outstandingBalance: 0, processClosed: false };

  it("declares the six customer-safe states", () => {
    expect(PORTAL_POST_DELIVERY_STATES).toEqual([
      "delivered",
      "invoice_issued",
      "payment_pending",
      "partially_paid",
      "paid",
      "closed",
    ]);
  });

  it("HIDES a validated-but-unsent invoice from the client", () => {
    // A VALIDATED invoice has not been sent. The client must not learn it exists.
    expect(invoiceVisibleToClient("VALIDATED")).toBe(false);
    expect(invoiceVisibleToClient("DRAFT")).toBe(false);
    expect(invoiceVisibleToClient("VOID")).toBe(false);
    expect(portalPostDeliveryState({ ...base, invoiceStatus: "VALIDATED" })).toBe("delivered");
  });

  it("shows only sent invoices", () => {
    expect(invoiceVisibleToClient("ISSUED")).toBe(true);
    expect(invoiceVisibleToClient("PARTIALLY_PAID")).toBe(true);
    expect(invoiceVisibleToClient("PAID")).toBe(true);
  });

  it("maps the payment states", () => {
    expect(portalPostDeliveryState({ ...base, invoiceStatus: "ISSUED", outstandingBalance: 500 })).toBe("payment_pending");
    expect(portalPostDeliveryState({ ...base, invoiceStatus: "PARTIALLY_PAID", outstandingBalance: 200 })).toBe("partially_paid");
    expect(portalPostDeliveryState({ ...base, invoiceStatus: "PAID", outstandingBalance: 0 })).toBe("paid");
  });

  it("NEVER implies closure before the explicit close action succeeded", () => {
    // Fully paid, but not closed => the client sees "paid", not "closed".
    expect(
      portalPostDeliveryState({ ...base, invoiceStatus: "PAID", outstandingBalance: 0, processClosed: false }),
    ).toBe("paid");
    expect(
      portalPostDeliveryState({ ...base, invoiceStatus: "PAID", outstandingBalance: 0, processClosed: true }),
    ).toBe("closed");
  });

  it("the portal invoice reader selects ONLY safe columns", () => {
    // Explicit column list — no dispute, no collections, no deposit columns.
    for (const forbidden of [
      "dispute_reason",
      "dispute_category",
      "collections_assignee_id",
      "collections_completed_at",
      "escalated_at",
      "rejection_reason",
      "validated_by",
      "submitted_by",
    ]) {
      expect(portalDocs, `portal must not select ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the portal never reads Collections or deposit tables at all", () => {
    for (const table of ["collection_follow_up", "invoice_deposit", "invoice_deposit_event"]) {
      expect(portalDocs, `portal must not read ${table}`).not.toContain(table);
    }
  });
});

// ------------------------------------------------------------------- nav/roles ----

describe("role-aware panel navigation (Deliverable 7/10; ONE builder as of 5.0E-1)", () => {
  it("gives an Account Manager the portfolio, not Collections or deposits", () => {
    const hrefs = navHrefs(["ACCOUNT_MANAGER"]);
    expect(hrefs).toContain("/portfolio");
    expect(hrefs).not.toContain("/collections");
    expect(hrefs).not.toContain("/deposits");
    expect(hrefs).not.toContain("/courier");
  });

  it("gives Transport the readiness panel, not the portfolio or Collections", () => {
    const hrefs = navHrefs(["TRANSPORT_OFFICER"]);
    expect(hrefs).toContain("/transport-readiness");
    expect(hrefs).not.toContain("/portfolio");
    expect(hrefs).not.toContain("/collections");
  });

  it("a COURIER sees ONLY their own deposits — never Collections or the portfolio", () => {
    const hrefs = navHrefs(["COURIER"]);
    expect(hrefs).toContain("/courier");
    expect(hrefs).not.toContain("/collections");
    expect(hrefs).not.toContain("/portfolio");
    expect(hrefs).not.toContain("/deposits");
  });

  it("a DRIVER gets NO staff sidebar at all — separate identity stack", () => {
    const ctx: NavigationContext = {
      userId: "u1",
      tenantId: "t1",
      roleCodes: ["DRIVER"],
      permissions: ["tracking:read", "tracking:write"],
      identityType: "driver",
      featureFlags: FLAGS_ON,
    };
    expect(buildNavigation(ctx).sections).toEqual([]);
  });

  it("gives Collections the aging panel", () => {
    const hrefs = navHrefs(["COLLECTIONS_OFFICER"]);
    expect(hrefs).toContain("/collections");
    expect(hrefs).not.toContain("/portfolio");
  });

  it("adds NO process entry when the workspaces flag is off — production nav unchanged", () => {
    const hrefs = navHrefs(["OPS_SUPERVISOR"], PERMS, resolveProcessFlags({}));
    for (const h of ["/my-work", "/collections", "/deposits", "/portfolio", "/transport-readiness"]) {
      expect(hrefs).not.toContain(h);
    }
    expect(hrefs.some((h) => h.startsWith("/queues/"))).toBe(false);
  });

  it("never exposes platform navigation", () => {
    expect(navHrefs(["SYSTEM_ADMIN"]).some((h) => h.startsWith("/platform"))).toBe(false);
  });
});
