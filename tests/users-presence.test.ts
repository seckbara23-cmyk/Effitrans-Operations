import { describe, it, expect } from "vitest";
import { classifyPresence, loginMethodLabel } from "@/lib/users/presence";

const NOW = new Date("2026-06-17T14:30:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();

describe("classifyPresence (Phase 2.1A)", () => {
  it("returns 'never' when the user has never logged in", () => {
    expect(classifyPresence({ lastSeenAt: null, lastLoginAt: null, loginCount: 0 }, NOW)).toBe("never");
    // never overrides any stray last_seen
    expect(classifyPresence({ lastSeenAt: minutesAgo(1), lastLoginAt: null, loginCount: 0 }, NOW)).toBe("never");
  });

  it("returns 'online' when last seen within 5 minutes", () => {
    expect(classifyPresence({ lastSeenAt: minutesAgo(2), lastLoginAt: minutesAgo(10), loginCount: 3 }, NOW)).toBe("online");
    expect(classifyPresence({ lastSeenAt: minutesAgo(5), lastLoginAt: minutesAgo(10), loginCount: 1 }, NOW)).toBe("online");
  });

  it("returns 'recently_active' when last seen within 30 minutes", () => {
    expect(classifyPresence({ lastSeenAt: minutesAgo(6), lastLoginAt: minutesAgo(60), loginCount: 1 }, NOW)).toBe("recently_active");
    expect(classifyPresence({ lastSeenAt: minutesAgo(30), lastLoginAt: minutesAgo(60), loginCount: 1 }, NOW)).toBe("recently_active");
  });

  it("returns 'offline' when last seen older than 30 minutes or null", () => {
    expect(classifyPresence({ lastSeenAt: minutesAgo(31), lastLoginAt: minutesAgo(60), loginCount: 1 }, NOW)).toBe("offline");
    expect(classifyPresence({ lastSeenAt: minutesAgo(600), lastLoginAt: minutesAgo(700), loginCount: 5 }, NOW)).toBe("offline");
    // logged in before but no last_seen recorded
    expect(classifyPresence({ lastSeenAt: null, lastLoginAt: minutesAgo(60), loginCount: 1 }, NOW)).toBe("offline");
  });

  it("counts a prior login via loginCount even without lastLoginAt", () => {
    expect(classifyPresence({ lastSeenAt: minutesAgo(2), lastLoginAt: null, loginCount: 2 }, NOW)).toBe("online");
  });
});

describe("loginMethodLabel", () => {
  it("maps known methods to French labels", () => {
    expect(loginMethodLabel("password")).toBe("Mot de passe");
    expect(loginMethodLabel("google")).toBe("Google");
    expect(loginMethodLabel("recovery")).toBe("Réinitialisation");
    expect(loginMethodLabel("portal_password")).toBe("Portail (mot de passe)");
    expect(loginMethodLabel("portal_google")).toBe("Portail (Google)");
  });
  it("falls back gracefully", () => {
    expect(loginMethodLabel(null)).toBe("—");
    expect(loginMethodLabel("unknown")).toBe("unknown");
  });
});
