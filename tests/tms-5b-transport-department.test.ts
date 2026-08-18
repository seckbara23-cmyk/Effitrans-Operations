/**
 * TMS-5B — Transport Department Realignment.
 * ---------------------------------------------------------------------------
 * An approved organizational decision: Transport becomes a department in its
 * own right in the sidebar, owning ground execution (demandes, exécution, Parc
 * & Flotte), while Transit keeps customs and international follow-up (Douane,
 * Intelligence douanière, Suivi maritime, Suivi aérien).
 *
 * This is a RELOCATION OF NAVIGATION. Every route, component, permission and
 * capability is unchanged — these pins exist to prove exactly that: that the
 * move happened, that nothing was duplicated, and that nobody gained access
 * merely because a menu changed.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { navSections } from "@/lib/nav";
import { canSeeNavItem, type NavSessionLike } from "@/lib/auth/nav-visibility";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const transitHub = read("app", "departments", "transit", "page.tsx");
const transitCode = strip(transitHub);
const transportHub = read("app", "departments", "transport", "page.tsx");
/**
 * The department's own responsibility CARDS, isolated from « Accès rapide ».
 * A chip in the quick-links row is not a first-class responsibility — that
 * distinction is the whole reason TMS-5A existed, so the pins below must not
 * be satisfiable by a chip.
 *
 * The boundaries are ASSERTED: when a slice boundary silently stops matching,
 * indexOf returns -1 and the slice quietly widens to the whole file — which is
 * exactly how this pin was fooled once already.
 */
function responsibilityCardsOf(hub: string): string {
  const start = hub.indexOf("the Transport department's own responsibilities");
  const end = hub.indexOf("Operational platform cards");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("responsibility-card boundaries not found — the pin would silently widen");
  }
  return hub.slice(start, end);
}
const responsibilityCards = responsibilityCardsOf(transportHub);
const departments = navSections.find((s) => s.label === "Départements")!;
const item = (label: string) => departments.items.find((i) => i.label === label);
const session = (permissions: string[]): NavSessionLike => ({ permissions, loading: false, configured: true });

// =============================================================== sidebar ====

describe("TMS-5B — Transport is a department in the sidebar", () => {
  it("appears in the ratified order: Opérations → Transit → Transport → Finance", () => {
    expect(departments.items.map((i) => i.label)).toEqual([
      "Opérations", "Transit", "Transport", "Finance",
    ]);
  });

  it("points at the EXISTING hub route and invents no permission", () => {
    expect(item("Transport")!.href).toBe("/departments/transport");
    expect(item("Transport")!.permission).toBe("transport:read");
    const nav = read("lib", "nav.ts");
    for (const invented of ["transport:department", "department:transport", "transport:nav"]) {
      expect(nav, invented).not.toContain(invented);
    }
  });

  it("visibility follows the EXISTING authority — nobody gains access from a menu", () => {
    expect(canSeeNavItem(item("Transport")!, session(["transport:read"]))).toBe(true);
    expect(canSeeNavItem(item("Transport")!, session(["customs:read"]))).toBe(false);
    expect(canSeeNavItem(item("Transport")!, session([]))).toBe(false);
  });

  it("the canonical org registry is deliberately NOT rewritten by a nav change", () => {
    // lib/organization/departments.ts drives role→department derivation,
    // messaging and workflow access — not the sidebar. TMS-5B left it alone;
    // reconciling it is a separate, load-bearing organizational decision, and
    // this pin records that the divergence is deliberate rather than forgotten.
    const registry = read("lib", "organization", "departments.ts");
    expect(registry).toContain('"OPERATIONS" | "TRANSIT" | "FINANCE" | "HUMAN_RESOURCES"');
    expect(registry).toContain('TRANSPORT_OFFICER: "TRANSIT"');
    expect(read("lib", "nav.ts")).not.toContain("CANONICAL_DEPARTMENTS");
  });
});

// ====================================================== Transport owns … ====

describe("TMS-5B — the Transport department page carries its responsibilities", () => {
  it("is presented as the Transport department, not a logistics sub-page", () => {
    expect(transportHub).toContain('title="Transport"');
    expect(transportHub).toContain('meta="Départements"');
  });

  it("reaches Demandes & Exécution (the TMS-4 machine) at its existing route", () => {
    expect(responsibilityCards).toContain("Demandes &amp; Exécution");
    expect(responsibilityCards).toContain('href="/transport"');
    expect(responsibilityCards).toContain("enlèvement, transit, livraison et POD");
  });

  it("reaches Parc & Flotte (TMS-5) as a CARD, not merely a quick-link chip", () => {
    expect(responsibilityCards).toContain("Parc &amp; Flotte");
    expect(responsibilityCards).toContain('href="/transport/parc"');
    expect(responsibilityCards).toContain("Véhicules, conformité, maintenance et disponibilité.");
  });

  it("tells the truth about road tracking instead of inventing a workspace", () => {
    // TMS-3's road tracking has NO standalone route: positions and events are
    // recorded per dossier and by the driver on their mission.
    expect(transportHub).toContain("Suivi routier :");
    expect(transportHub).toContain("saisis sur chaque dossier");
    const appDir = path.join(root, "app");
    const invented: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx" && /suivi-routier|road-tracking/i.test(full)) invented.push(full);
      }
    };
    walk(appDir);
    expect(invented).toEqual([]);
  });
});

// ========================================================= Transit keeps … ====

describe("TMS-5B — Transit keeps customs and international follow-up", () => {
  it("still offers exactly Douane, Intelligence douanière, Suivi maritime, Suivi aérien", () => {
    const labels = [...transitCode.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      "Douane", "Intelligence douanière", "Suivi maritime", "Suivi aérien",
    ]);
  });

  it("no longer presents ground transport as a Transit responsibility", () => {
    expect(transitCode).not.toContain("Transport & Logistique");
    expect(transitCode).not.toContain("/departments/transport");
    expect(transitCode).not.toContain("/transport/parc");
  });

  it("still admits a transport reader — maritime and air follow-up are gated on transport:read", () => {
    expect(transitHub).toContain('const HUB_ANY_OF = ["customs:read", "transport:read"]');
    expect(transitCode).toContain('{ label: "Suivi maritime", href: "/shipping", permission: "transport:read"');
  });
});

// ================================================== nothing was duplicated ====

describe("TMS-5B — relocation, not duplication", () => {
  it("every relocated route still exists and is served by ONE page", () => {
    for (const route of [
      ["app", "departments", "transport", "page.tsx"],
      ["app", "departments", "transit", "page.tsx"],
      ["app", "transport", "page.tsx"],
      ["app", "transport", "parc", "page.tsx"],
      ["app", "shipping", "page.tsx"],
      ["app", "air", "page.tsx"],
    ]) {
      expect(fs.existsSync(path.join(root, ...route)), route.join("/")).toBe(true);
    }
  });

  it("no second transport console, fleet module or tracking surface appeared", () => {
    const libDirs: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { libDirs.push(e.name); walk(path.join(d, e.name)); }
      }
    };
    walk(path.join(root, "lib"));
    expect(libDirs.filter((n) => n === "transport")).toHaveLength(1);
    expect(libDirs.filter((n) => n === "fleet")).toHaveLength(1);
    expect(libDirs.filter((n) => n === "tracking")).toHaveLength(1);
  });

  it("the TMS-4 execution machine and TMS-5 fleet semantics are untouched", () => {
    const status = read("lib", "transport", "status.ts");
    for (const invented of ["VEHICLE_ASSIGNED", "AWAITING_VEHICLE", "IMMOBILIZED", "EXTERNAL"]) {
      expect(status, invented).not.toContain(invented);
    }
    // the fleet status vocabulary still excludes an assignment value
    expect(read("supabase", "migrations", "20260908000001_fleet_registry.sql"))
      .toContain("check (status in ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'))");
  });

  it("TMS-5B shipped NO migration and NO permission change", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations[migrations.length - 1]).toBe("20260908000001_fleet_registry.sql");
    const templates = read("lib", "platform", "role-templates.ts");
    for (const invented of ["transport:department", "department:transport"]) {
      expect(templates, invented).not.toContain(invented);
    }
  });

  it("the maritime carrier concept was not moved into road Transport", () => {
    const transportCode = strip(transportHub);
    expect(transportCode).not.toContain("ocean_carrier");
    // « Lignes maritimes » may still be linked from the command center, but the
    // department's OWN responsibilities are the ground ones asserted above.
    expect(read("lib", "organization", "departments.ts")).toContain('TRANSIT_TEAMS');
  });
});
