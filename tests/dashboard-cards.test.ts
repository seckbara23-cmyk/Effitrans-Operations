import { describe, it, expect } from "vitest";
import {
  documentationCardData,
  customsCardData,
  transportCardData,
  financeCardData,
  managementCardData,
} from "@/lib/departments/dashboard-map";

describe("department dashboard card mapping (Dashboard UX)", () => {
  it("documentation → missing (primary) / ready-for-customs (secondary) / urgent (alert)", () => {
    const c = documentationCardData({ pending: 2, missing: 3, verified: 1, urgent: 1 }, 4);
    expect(c.key).toBe("documentation");
    expect(c.primary.value).toBe(3);
    expect(c.secondary.value).toBe(4);
    expect(c.alert?.value).toBe(1);
  });

  it("customs → ready-for-declaration / under-inspection / blocked", () => {
    const c = customsCardData({ readyForDeclaration: 5, awaitingResponse: 2, underInspection: 1, readyForRelease: 0 }, 2);
    expect(c.primary.value).toBe(5);
    expect(c.secondary.value).toBe(1);
    expect(c.alert?.value).toBe(2);
  });

  it("transport → dispatch / in-transit / POD required", () => {
    const c = transportCardData({ readyForDispatch: 3, assigned: 1, inTransit: 4, podRequired: 2, delivered: 9 });
    expect(c.primary.value).toBe(3);
    expect(c.secondary.value).toBe(4);
    expect(c.alert?.value).toBe(2);
  });

  it("finance → invoices pending / payments to verify / overdue", () => {
    const c = financeCardData({ issued: 7, overdue: 3 }, 5);
    expect(c.primary.value).toBe(7);
    expect(c.secondary.value).toBe(5);
    expect(c.alert?.value).toBe(3);
  });

  it("management → active / high priority / blocked", () => {
    const c = managementCardData({ active: 12, highPriority: 4, blocked: 2 });
    expect(c.primary.value).toBe(12);
    expect(c.secondary.value).toBe(4);
    expect(c.alert?.value).toBe(2);
  });

  it("uses only real department routes (no mock/prototype routes reintroduced)", () => {
    const all = [
      documentationCardData({ pending: 0, missing: 0, verified: 0, urgent: 0 }, 0),
      customsCardData({ readyForDeclaration: 0, awaitingResponse: 0, underInspection: 0, readyForRelease: 0 }, 0),
      transportCardData({ readyForDispatch: 0, assigned: 0, inTransit: 0, podRequired: 0, delivered: 0 }),
      financeCardData({ issued: 0, overdue: 0 }, 0),
      managementCardData({ active: 0, highPriority: 0, blocked: 0 }),
    ];
    for (const c of all) {
      expect(c.href.startsWith("/departments/")).toBe(true);
      for (const mock of ["/customers", "/shipments", "/documents", "/reports", "/settings"]) {
        expect(c.href).not.toBe(mock);
      }
    }
  });
});
