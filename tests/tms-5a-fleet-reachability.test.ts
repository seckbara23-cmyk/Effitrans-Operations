/**
 * TMS-5A — Parc & Flotte reachability closure.
 * ---------------------------------------------------------------------------
 * TMS-5 shipped the whole capability and left it effectively undiscoverable:
 * the only entry point was a chip on the Transport hub, itself a workspace two
 * levels below the sidebar, so an operator looking at the Transit department
 * page saw no parc at all. A second reader (listVehicleMaintenance) was built
 * and never rendered.
 *
 * These pins guard the FIX and the rule behind it: a shipped fleet surface
 * must be reachable by navigation and gated by the ratified authority —
 * transport:read to view, transport:manage to change, transport:assign to bind.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const transitHub = read("app", "departments", "transit", "page.tsx");
const transportHub = read("app", "departments", "transport", "page.tsx");
const parcPage = read("app", "transport", "parc", "page.tsx");
const console_ = read("components", "fleet", "fleet-console.tsx");
const service = read("lib", "fleet", "service.ts");

// ============================================================ reachability ====

describe("TMS-5A — the parc is reachable from its department page", () => {
  // PINS MOVED (TMS-5B, 2026-08-18): TMS-5A put the parc card on the TRANSIT
  // hub because that was where the operator looked and where transport lived.
  // TMS-5B made Transport its own department, so the card moved with the
  // responsibility. The REACHABILITY requirement is unchanged — only the hub.
  it("the Transport hub carries a « Parc & Flotte » card with the ratified wording", () => {
    // Bounded to the responsibility cards: the « Accès rapide » row also holds a
    // Parc chip, and a chip is not a first-class card (the TMS-5A lesson). The
    // boundaries are asserted — a vanished boundary must fail, never widen.
    const start = transportHub.indexOf("the Transport department's own responsibilities");
    const end = transportHub.indexOf("Operational platform cards");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const cards = transportHub.slice(start, end);
    expect(cards).toContain("Parc &amp; Flotte");
    expect(cards).toContain('href="/transport/parc"');
    expect(cards).toContain("Véhicules, conformité, maintenance et disponibilité.");
  });

  it("the Transit hub no longer presents the parc as a Transit responsibility", () => {
    // Comment-stripped: the hub's doctrine comment NAMES what moved away, and a
    // pin that forbids the phrase must not trip on the sentence explaining it.
    const code = transitHub.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("Parc & Flotte");
    expect(code).not.toContain("/transport/parc");
    expect(code).not.toContain("/departments/transport");
    // …and the hub still filters what it does show by permission.
    expect(transitHub).toContain("WORKSPACES.filter((w) => hasPermission(permissions, w.permission))");
  });

  it("the hub itself still admits either Transit reader — no new gate was invented", () => {
    expect(transitHub).toContain('const HUB_ANY_OF = ["customs:read", "transport:read"]');
  });

  it("the route is the EXISTING one — no duplicate fleet page was created", () => {
    const appDir = path.join(root, "app");
    const routes: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx" && /parc|fleet|vehicul|vehicle/i.test(full)) routes.push(full);
      }
    };
    walk(appDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].replace(/\\/g, "/")).toContain("app/transport/parc/page.tsx");
  });

  it("the Transport hub keeps its own shortcut — a second path, not a second implementation", () => {
    expect(transportHub).toContain('href="/transport/parc"');
  });
});

// ========================================================= permission gates ====

describe("TMS-5A — the ratified authority is what actually gates the surface", () => {
  it("viewing requires transport:read and refuses in French otherwise", () => {
    expect(parcPage).toContain('if (!hasPermission(permissions, "transport:read"))');
    expect(parcPage).toContain("Accès non autorisé.");
  });

  it("the management console renders ONLY for transport:manage", () => {
    expect(parcPage).toContain('const canManage = hasPermission(permissions, "transport:manage")');
    // TMS-5C turned this into a ternary so a reader gets an explanation rather
    // than nothing; the console itself is still gated on canManage alone.
    expect(parcPage).toContain("{canManage ? (");
    expect(parcPage).toContain("<FleetConsole vehicles={fleet} />");
  });

  it("a reader without transport:manage is never shown a write control", () => {
    // every mutating control lives inside the console, which the page gates.
    for (const control of ["Ajouter au parc", "Ouvrir l&apos;intervention", "Enregistrer la conformité"]) {
      expect(console_, control).toContain(control);
      expect(parcPage, control).not.toContain(control);
    }
  });

  it("binding a vehicle to a transport stays behind transport:assign", () => {
    const filePage = read("app", "files", "[id]", "page.tsx");
    // `transport:assign` appears three more times on this page (driver identity,
    // the panel prop), so the pin must be the fleet load's OWN expression.
    const fleetGate = filePage.slice(
      filePage.indexOf("const fleetOptions"),
      filePage.indexOf("const canAssign ="),
    );
    expect(fleetGate).toContain('hasPermission(permissions, "transport:assign")');
    expect(fleetGate).toContain("await listAssignableVehicles()");
    expect(fleetGate).toContain(": [];");
  });

  it("no fleet surface introduces a new permission code", () => {
    for (const src of [transitHub, parcPage, console_, service]) {
      for (const invented of ["fleet:manage", "fleet:read", "vehicle:manage", "vehicle:read"]) {
        expect(src, invented).not.toContain(invented);
      }
    }
  });
});

// ==================================================== capability coverage ====

describe("TMS-5A — every TMS-5 capability is actually surfaced", () => {
  it("the registry shows immatriculation, internal code, type and capacity", () => {
    expect(parcPage).toContain("{v.registration}");
    expect(parcPage).toContain("{v.internalCode");
    expect(parcPage).toContain("TYPE_FR[v.vehicleType]");
    expect(parcPage).toContain("v.capacityKg");
  });

  it("availability shows all four operational states, « En mission » derived", () => {
    for (const label of ["En mission", "Disponible", "Maintenance", "Hors service"]) {
      expect(parcPage, label).toContain(label);
    }
    expect(parcPage).toContain("v.engaged ?");
  });

  it("compliance shows the item, its expiry state and the date", () => {
    expect(parcPage).toContain("COMPLIANCE_FR[c.typeCode]");
    expect(parcPage).toContain("EXPIRY_FR[c.expiryState]");
    expect(parcPage).toContain("c.expiresOn");
  });

  it("the intervention history is RENDERED — the reader is no longer orphaned", () => {
    expect(parcPage).toContain("listVehicleMaintenance");
    expect(parcPage).toContain("Historique des interventions");
    // open vs closed, and the return to service, are both legible
    expect(parcPage).toContain("Clôturée");
    expect(parcPage).toContain("remise en service le");
  });

  it("current mission usage is visible on the vehicle row", () => {
    expect(parcPage).toContain("v.engagedFileNumbers");
  });

  it("no fleet reader ships without a consumer (the TMS-5A defect class)", () => {
    const exported = [...service.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    const consumers = [parcPage, console_, read("app", "files", "[id]", "page.tsx")].join("\n");
    for (const fn of exported) {
      expect(consumers, `${fn} is exported but rendered nowhere`).toContain(fn);
    }
  });
});
