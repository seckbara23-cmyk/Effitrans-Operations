/**
 * Phase 9.3C — Finance hub workspace links (Scope E) + the documented HR blocker
 * (Scope F). The department realignment itself (Départements → Opérations/Transit/
 * Finance, permissionsAnyOf, hub pages) shipped in the prior commit and is covered
 * by tests/journeys.test.ts, tests/departments-nav.test.ts, tests/nav-visibility.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { navSections } from "@/lib/nav";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const financeDept = read("../app/departments/finance/page.tsx");
const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

describe("Finance hub workspace links (Scope E)", () => {
  it("lists the finance workspaces over EXISTING routes, each permission-gated", () => {
    for (const [label, href, perm] of [
      ["Facturation", "/finance", "finance:read"],
      ["Recouvrement", "/collections", "collections:manage"],
      ["Caisse", "/finance/caisse", "caisse:manage"],
      ["Rapprochement", "/finance/reconciliation", "finance:read"],
      ["Rapports", "/reports", "report:read"],
      // Phase 11.0C — over the 11.0B permission family, no new permission.
      ["Autorisations de dépenses", "/finance/autorisations-depenses", "finance:expense:read"],
    ] as const) {
      expect(financeDept, label).toContain(`label: "${label}"`);
      expect(financeDept, href).toContain(`href: "${href}"`);
      expect(financeDept, perm).toContain(`"${perm}"`);
    }
    // Each link is filtered by its own permission (cosmetic; routes re-check).
    expect(financeDept).toContain("hasPermission(permissions, l.permission)");
  });

  it("does not fabricate a standalone Finance Requests route (it is the per-dossier panel)", () => {
    expect(financeDept).not.toContain("/finance/requests");
    expect(financeDept).not.toContain('label: "Finance Requests"');
  });

  it("preserves the Caisse route and invents no finance permission", () => {
    expect(financeDept).toContain('href: "/finance/caisse"');
    // The guard's INTENT is « no invented scoped finance permission », not « none
    // at all »: 11.0B ratified the finance:expense:* family, so 11.0C's link may
    // use it. Every scoped finance permission on this page must be one that
    // actually exists in the permission catalog.
    // FIN-AGING-2 ratified a second scoped family, finance:aging:*, so the
    // catalogue this checks against is now the union of the migrations that
    // define them. The intent is unchanged and is the point of the test: a link
    // may only cite a permission that really exists.
    const scoped = [...financeDept.matchAll(/"(finance:[a-z]+:[a-z_]+)"/g)].map((m) => m[1]);
    const catalog = [
      "../supabase/migrations/20260725000001_expense_documents.sql",
      "../supabase/migrations/20260729000002_aging_balance_foundation.sql",
    ]
      .map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"))
      .join("\n");
    for (const code of scoped) expect(catalog, code).toContain(`'${code}'`);
    expect(scoped.sort()).toEqual(["finance:aging:read", "finance:expense:read"]);
  });
});

// Phase HR-1 flipped the former 9.3C HR blocker: HR now has a real route
// (/departments/hr), permissions (hr:read/hr:manage) and role (HR_OFFICER), so
// « Ressources humaines » is a legitimate MANAGEMENT item — never a fabrication.
describe("HR under Management — now real (Phase HR-1)", () => {
  const seed = read("../supabase/seed.sql");
  const depts = read("../lib/organization/departments.ts");

  it("MANAGEMENT contains « Ressources humaines », gated on hr:read, at /departments/hr", () => {
    const mgmt = navSections.find((s) => s.label === "Management")!;
    expect(mgmt.items.map((i) => i.label)).toEqual([
      "Direction",
      "Ressources humaines",
      "Gestion de la Performance",
      "Rapports",
      "Tableau exécutif",
    ]);
    const hr = mgmt.items.find((i) => i.label === "Ressources humaines")!;
    expect(hr.href).toBe("/departments/hr");
    expect(hr.permission).toBe("hr:read");
  });

  it("HR is NOT a DÉPARTEMENTS entry (it is a management support function)", () => {
    const dep = navSections.find((s) => s.label === "Départements")!;
    expect(dep.items.some((i) => /Ressources humaines/i.test(i.label) || i.href === "/departments/hr")).toBe(false);
    // PIN MOVED (TMS-5B, 2026-08-18): Transport became a DEPARTMENT by business
    // decision, so the section holds four. The point this case makes is unchanged:
    // a WORKSPACE never earns a top-level entry.
    expect(dep.items.map((i) => i.label)).toEqual(["Opérations", "Transit", "Transport", "Finance"]);
  });

  it("the HR permissions exist in the catalog and are held only by HR_OFFICER", () => {
    expect(seed).toMatch(/'hr:read'/);
    expect(seed).toMatch(/'hr:manage'/);
    // SYSTEM_ADMIN is deliberately NOT granted hr:* (DEC-B25). Assert no seed
    // grant block that targets SYSTEM_ADMIN also mentions an hr:* code.
    const blocks = seed.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    for (const b of blocks) {
      if (/hr:(read|manage)/.test(b)) {
        expect(/SYSTEM_ADMIN/.test(b), "hr:* must not be granted to SYSTEM_ADMIN").toBe(false);
      }
    }
  });

  it("HUMAN_RESOURCES stays in the canonical registry (now with its first mapped role)", () => {
    expect(depts).toContain('code: "HUMAN_RESOURCES"');
    expect(depts).toContain('labelFr: "Ressources humaines"');
    expect(depts).toMatch(/HR_OFFICER:\s*"HUMAN_RESOURCES"/);
  });
});

// ---------------------------------------------------------------------------
// FIN-UAT STEP 0bis — « Dépôts physiques » on the Finance hub (DISCOVERY ONLY)
//
// The operator ratified the incoming-money journey as
// Facturation → Dépôts physiques → Recouvrement → Rapprochement → Balance âgée.
// /deposits already admitted Finance readers: its gate is `admin_service:manage`
// OR `collections:manage`, and FINANCE_OFFICER/COLLECTIONS_OFFICER hold the
// latter. So this is navigation, not authorization — the tile grants REACH, and
// every mutation stays re-asserted server-side under the existing custody model.
//
// The load-bearing case is the WES-3A.6 one: the tile must carry `available:`
// bound to the SAME flag the route enforces, or it becomes a link to a 404 the
// moment the flag is off — which is exactly the production state today.
// ---------------------------------------------------------------------------
describe("FIN-UAT — Dépôts physiques discovery from Finance", () => {
  const nav = read("../lib/navigation/build.ts");
  const route = read("../app/deposits/page.tsx");

  it("places the tile between Facturation and Recouvrement, over the EXISTING route", () => {
    expect(financeDept).toContain('label: "Dépôts physiques"');
    expect(financeDept).toContain('href: "/deposits"');
    const iFact = financeDept.indexOf('label: "Facturation"');
    const iDep = financeDept.indexOf('label: "Dépôts physiques"');
    const iRec = financeDept.indexOf('label: "Recouvrement"');
    expect(iFact).toBeGreaterThan(-1);
    expect(iDep).toBeGreaterThan(iFact);
    expect(iRec).toBeGreaterThan(iDep);
  });

  it("gates the tile on EXACTLY what /deposits enforces — the WES-3A.6 mutation", () => {
    // BOUNDED to the tile: a global toContain("depositsAvailable") would be
    // satisfied by the declaration alone even after the tile lost its gate.
    expect(financeDept).toMatch(/label: "Dépôts physiques"[\s\S]{0,220}available: depositsAvailable/);
    // …and the value is the route's own resolved flag, not a lookalike.
    expect(financeDept).toContain("const depositsAvailable = killSwitchOn && !!processFlags?.physicalDeposit;");
    expect(route).toContain("if (!flags.physicalDeposit) notFound();");
  });

  it("reuses ONE flag resolution — no second mechanism, no extra fetch", () => {
    // The env var is read only by the rollout module, never re-implemented here.
    expect(financeDept).not.toContain("EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED");
    expect(financeDept).toContain("getTenantProcessFlags");
    // Both tiles read the SAME fetched flags object.
    expect(financeDept).toContain("const collectionsAvailable = killSwitchOn && !!processFlags?.collections;");
    expect((financeDept.match(/await getTenantProcessFlags\(/g) ?? []).length).toBe(1);
    // The kill switch still short-circuits the fetch entirely.
    expect(financeDept).toContain("killSwitchOn ? await getTenantProcessFlags(user.tenantId) : null");
  });

  it("transfers NO authority to Finance and duplicates no workflow", () => {
    // The hub gates nothing on the Administration mutation permission. Asserted
    // on the CODE forms, not on the string: the explanatory comment above the
    // tile names `admin_service:manage` to say the route still demands it, and a
    // bare not.toContain would fail on that prose while proving nothing.
    expect(financeDept).not.toMatch(/permission: "admin_service:manage"/);
    expect(financeDept).not.toContain('hasPermission(permissions, "admin_service:manage")');
    // …and the route keeps BOTH audiences, unchanged: read for Finance,
    // mutation authority still decided by the server per action.
    expect(route).toContain('hasPermission(permissions, "admin_service:manage")');
    expect(route).toContain('hasPermission(permissions, "collections:manage")');
    // One workflow, two discovery contexts — no Finance-local re-implementation.
    expect(financeDept).not.toContain("/finance/depots");
    expect(existsSync(join(rootDir, "app/finance/depots"))).toBe(false);
  });

  it("leaves the Administration panel and the COURIER landing surface untouched", () => {
    // Administration keeps its own entry, on its own permission.
    expect(nav).toMatch(/has\("ADMINISTRATIVE_OFFICER"[\s\S]{0,120}physicalDeposit && can\("admin_service:manage"\)/);
    expect(nav).toContain('href: "/deposits"');
    // /courier is an identity landing surface, never a navigation item.
    expect(nav).not.toContain('href: "/courier"');
    expect(read("../lib/navigation/landing.ts")).toContain('LANDING_COURIER = "/courier"');
  });
});
