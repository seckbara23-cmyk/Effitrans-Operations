import { describe, it, expect } from "vitest";
import { activityMeta, isActivityVisible } from "@/lib/activity/classify";

describe("recent activity classification (Dashboard UX)", () => {
  it("labels + categories for allow-listed actions", () => {
    expect(activityMeta("customs.released")?.category).toBe("customs");
    expect(activityMeta("transport.pod_received")?.category).toBe("transport");
    expect(activityMeta("handoff.task.created")?.category).toBe("handoff");
    expect(activityMeta("user.created")?.label).toBeTruthy();
    expect(activityMeta("communication.sent")?.category).toBe("comms");
  });

  it("returns null for non-allow-listed actions (no arbitrary audit leakage)", () => {
    expect(activityMeta("auth.login")).toBeNull();
    expect(activityMeta("portal.invoice.viewed")).toBeNull();
    expect(activityMeta("admin.override.access")).toBeNull();
  });

  it("hides finance activity from viewers without finance:read", () => {
    expect(isActivityVisible("invoice.issued", false)).toBe(false);
    expect(isActivityVisible("payment.recorded", false)).toBe(false);
    expect(isActivityVisible("payment.verified", false)).toBe(false);
    // ...and shows it once finance:read is held
    expect(isActivityVisible("invoice.issued", true)).toBe(true);
    expect(isActivityVisible("payment.recorded", true)).toBe(true);
  });

  it("shows non-finance events regardless of finance permission", () => {
    expect(isActivityVisible("customs.released", false)).toBe(true);
    expect(isActivityVisible("handoff.task.completed", false)).toBe(true);
    expect(isActivityVisible("document.approved", false)).toBe(true);
  });

  it("never shows non-allow-listed actions even with finance:read", () => {
    expect(isActivityVisible("auth.login", true)).toBe(false);
    expect(isActivityVisible("portal.document.downloaded", true)).toBe(false);
  });
});
