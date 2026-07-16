/**
 * Phase 7.2C — Shipping platform integration & verification. Proves every Ocean Shipping
 * route is reachable and no workspace-nav destination is a dead link. Structural (no jsdom).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const exists = (p: string) => existsSync(fileURLToPath(new URL(p, import.meta.url)));

/** The workspace-nav destinations → the page file each must resolve to (no orphans). */
const ROUTES: Record<string, string> = {
  "/shipping": "../app/shipping/page.tsx",
  "/shipping/shipments": "../app/shipping/shipments/page.tsx",
  "/shipping/containers": "../app/shipping/containers/page.tsx",
  "/shipping/vessels": "../app/shipping/vessels/page.tsx",
  "/shipping/voyages": "../app/shipping/voyages/page.tsx",
  "/shipping/ports": "../app/shipping/ports/page.tsx",
  "/shipping/carriers": "../app/shipping/carriers/page.tsx",
  "/shipping/alerts": "../app/shipping/alerts/page.tsx",
};

describe("every shipping route exists (no 404 in a current build)", () => {
  it("each workspace destination has a real page.tsx", () => {
    for (const [route, file] of Object.entries(ROUTES)) {
      expect(exists(file), `${route} → ${file}`).toBe(true);
    }
    expect(exists("../app/shipping/shipments/[shipmentId]/page.tsx")).toBe(true);
  });
});

describe("the workspace is composed + discoverable (Phase 7.2C)", () => {
  const nav = read("../components/shipping/shipping-nav.tsx");
  it("the layout wraps every /shipping route with the shared nav", () => {
    const layout = read("../app/shipping/layout.tsx");
    expect(layout).toContain("ShippingNav");
    expect(layout).toContain("{children}");
  });
  it("the nav is a breadcrumb + a tab to every implemented surface (no dead link)", () => {
    expect(nav).toContain('"use client"');
    expect(nav).toContain("usePathname");
    expect(nav).toContain("/departments/transport"); // breadcrumb root
    for (const route of Object.keys(ROUTES)) {
      expect(nav, `nav must link ${route}`).toContain(`"${route}"`);
    }
  });
  it("every href in the nav resolves to a real page (no orphan tab)", () => {
    const hrefs = [...nav.matchAll(/href:\s*"(\/shipping[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const h of hrefs) expect(ROUTES[h], `orphan tab ${h}`).toBeDefined();
  });
  it("the Transport department exposes a prominent Ocean Shipping entry", () => {
    // Phase 7.3C superseded the simple links with the Logistics Command Center platform
    // cards; the Ocean Shipping entry is now a card CTA + quick-nav link.
    const dept = read("../app/departments/transport/page.tsx");
    expect(dept).toContain('href="/shipping"');
    expect(dept).toContain("Ocean Shipping");
  });
  it("cross-links: shipment detail reaches its containers and customs", () => {
    const detail = read("../app/shipping/shipments/[shipmentId]/page.tsx");
    expect(detail).toContain('href="/shipping/containers"');
    expect(detail).toContain("/customs/intelligence");
  });
  it("no new backend/schema was introduced by this phase", () => {
    // 7.2C is composition/routing only — the layout + nav are pure UI.
    expect(read("../app/shipping/layout.tsx")).not.toMatch(/getAdminSupabaseClient|assertPermission|from\("/);
    expect(nav).not.toMatch(/getAdminSupabaseClient|assertPermission/);
  });
});
