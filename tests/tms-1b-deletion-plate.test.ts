/**
 * TMS-1B — controlled deletion & normalized plate identity.
 * ---------------------------------------------------------------------------
 * Three lifecycle concepts, kept apart in server logic, database behaviour
 * and UI language:
 *
 *   SUPPRIMER DÉFINITIVEMENT — an erroneous record that never served;
 *   RETIRER DU PARC          — a legitimate vehicle permanently leaving;
 *   METTRE HORS SERVICE      — temporary operational unavailability.
 *
 * The production trail proved the conflation live: aa-605-mw was retired at
 * 22:08 and deleted at 22:09 — deleteVehicle never looked at is_active. This
 * slice closes that, corrects the guidance that pointed users at « hors
 * service » for permanent departures, gives retired vehicles their own
 * surface, and makes a registration's identity its alphanumeric content.
 *
 * Real-Postgres behaviour: supabase/tests/tms_1b_plate_normalization_test.sql.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260925000001_vehicle_plate_normalization.sql";
const mRaw = read(MIGRATION);
const m = strip(mRaw);
const actions = strip(read("lib/fleet/actions.ts"));
const console_ = read("components/fleet/fleet-console.tsx");
const page = read("app/transport/parc/page.tsx");

const deleteFn = (() => {
  const i = actions.indexOf("export async function deleteVehicle");
  expect(i).toBeGreaterThan(-1);
  const rest = actions.slice(i);
  return rest.slice(0, rest.indexOf("export async function", 10));
})();

// ═══════════════════ G2 — a retired vehicle is never deleted ═══════════════

describe("TMS-1B — deletion refuses a retired vehicle SERVER-SIDE", () => {
  it("the refusal reads is_active from the row, before any history check", () => {
    expect(deleteFn).toContain('select("id, registration, is_active")');
    expect(deleteFn).toContain('if (!vehicle.is_active) return { ok: false, error: "vehicle_retired" }');
    // Ordered before the history checks: eligibility of the OBJECT first.
    expect(deleteFn.indexOf('error: "vehicle_retired"'))
      .toBeLessThan(deleteFn.indexOf('error: "vehicle_in_use"'));
  });

  it("the UI does not offer deletion for a retired vehicle — but is not the boundary", () => {
    const block = console_.slice(console_.indexOf("Suppression définitive") - 800);
    expect(block).toContain("selected && selected.isActive && (");
  });

  it("the corrective path is réintégrer → supprimer, each with its own audit", () => {
    expect(console_).toContain("réintégrez-le d'abord, puis supprimez-le");
    // The two acts still write their own distinct events.
    expect(actions).toContain("AuditActions.VEHICLE_REACTIVATED");
    expect(deleteFn).toContain("AuditActions.VEHICLE_DELETED");
  });

  it("no force path appeared while hardening", () => {
    expect(deleteFn).not.toContain("force");
    expect(actions).not.toContain("bypass");
  });
});

// ═══════════════════ G1 — the guidance names the right lifecycle ═══════════

describe("TMS-1B — deletion refusals point to « Retirer du parc », never « hors service »", () => {
  const RULED =
    "Ce véhicule possède un historique opérationnel et ne peut pas être supprimé définitivement. Utilisez “Retirer du parc” pour le conserver dans l'historique tout en le retirant de la flotte active.";

  it("both history refusals carry the ruled sentence, verbatim", () => {
    const errBlock = console_.slice(console_.indexOf("const ERR"), console_.indexOf("};"));
    const inUse = errBlock.split("vehicle_in_use:")[1]!.split("vehicle_has_history:")[0]!;
    const hasHistory = errBlock.split("vehicle_has_history:")[1]!.split("vehicle_retired:")[0]!;
    expect(inUse).toContain(RULED);
    expect(hasHistory).toContain(RULED);
  });

  it("« Mettez-le hors service » is GONE from every deletion context", () => {
    expect(console_).not.toContain("Mettez-le hors service");
    // The delete-block explainer names the correct lifecycle too.
    const block = console_.slice(console_.indexOf("Suppression définitive"));
    expect(block).toContain("Retirer du parc");
    expect(block).not.toContain("Mettre hors service");
  });

  it("« Mettre hors service » survives EXACTLY once — the temporary-unavailability control", () => {
    expect(console_.match(/Mettre hors service/g)?.length).toBe(1);
    const availability = console_.slice(console_.indexOf("Disponibilité :"));
    expect(availability.slice(0, 1200)).toContain("Mettre hors service");
  });
});

// ═══════════════════ G4 — active fleet primary, retired apart ══════════════

describe("TMS-1B — the operational view is the ACTIVE fleet", () => {
  it("the primary table iterates the active subset only", () => {
    expect(page).toContain("const activeFleet = fleet.filter((v) => v.isActive);");
    expect(page).toContain("const retiredFleet = fleet.filter((v) => !v.isActive);");
    expect(page).toContain("{activeFleet.map((v) => (");
  });

  it("retired vehicles have their own collapsed surface, with date and motif", () => {
    expect(page).toContain("Véhicules retirés ({retiredFleet.length})");
    expect(page).toContain("{retiredFleet.map((v) => (");
    expect(page).toContain("reste intégralement consultable");
    expect(page).toContain("<details");
  });

  it("history remains loaded for EVERY vehicle — retirement hides nothing", () => {
    // The intervention-history section still iterates the FULL fleet.
    const history = page.slice(page.indexOf("Historique des interventions"));
    expect(history).toContain("{fleet.map((v) => {");
    expect(page).toContain("fleet.map(async (v) => [v.id, await listVehicleMaintenance(v.id)]");
  });

  it("dispatch still excludes retired vehicles (unchanged, re-pinned)", () => {
    expect(read("lib/fleet/service.ts"))
      .toContain('v.isActive && v.status === "AVAILABLE" && !v.engaged');
  });
});

// ═══════════════════ G5 — reactivation names its vehicle ═══════════════════

describe("TMS-1B — the reactivation event answers WHICH vehicle", () => {
  it("registration travels in the audit payload", () => {
    const i = actions.indexOf("export async function reactivateVehicle");
    const react = actions.slice(i, actions.indexOf("export async function", i + 10));
    expect(react).toContain("registration: vehicle.registration");
    expect(react).toContain("AuditActions.VEHICLE_REACTIVATED");
  });
});

// ═══════════════════ migration 133 — normalized identity ═══════════════════

describe("TMS-1B — a registration's identity is its alphanumeric content", () => {
  it("the unique index normalizes case AND separators, per tenant", () => {
    expect(m).toContain("create unique index if not exists uq_vehicle_registration_normalized");
    expect(m).toContain("(tenant_id, upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g')))");
  });

  it("ALL rows participate — no is_active predicate, so retired plates block twins", () => {
    const idx = m.slice(m.indexOf("create unique index if not exists uq_vehicle_registration_normalized"));
    expect(idx.slice(0, idx.indexOf(";"))).not.toContain("where");
  });

  it("the census runs FIRST, fails DESCRIPTIVELY, and mutates nothing", () => {
    expect(m.indexOf("M133 REFUSED")).toBeLessThan(m.indexOf("create unique index"));
    // It lists the colliding registrations instead of guessing a canonical…
    expect(m).toContain("string_agg(registration");
    expect(m).toContain("an operator must resolve them first");
    // …and the whole migration performs NO data write on vehicle.
    expect(m).not.toMatch(/update\s+public\.vehicle/i);
    expect(m).not.toMatch(/delete\s+from\s+public\.vehicle/i);
    expect(m).not.toMatch(/insert\s+into\s+public\.vehicle/i);
  });

  it("the 117 index survives — strictness was added, nothing weakened", () => {
    expect(m).toContain("uq_vehicle_registration'");
    expect(m).toContain("must not weaken anything");
  });

  it("stored registrations are display text — the migration says so and does so", () => {
    expect(mRaw).toContain("stored registrations are NOT rewritten");
  });

  it("the action layer needed no change: 23505 already maps to the duplicate message", () => {
    expect(actions).toContain('if (error?.code === "23505") return { ok: false, error: "duplicate_registration" }');
    expect(console_).toContain("Cette immatriculation existe déjà dans le parc.");
  });
});

// ═══════════════════ slice discipline ══════════════════════════════════════

describe("TMS-1B — the slice stayed inside its boundary", () => {
  it("AA605MW and the UAT pair are named NOWHERE in the change set", () => {
    for (const f of [m, actions, console_, page]) {
      expect(f).not.toMatch(/AA-?605-?MW|UAT-TMS7/i);
    }
  });

  it("no TMS-1C tracking fields", () => {
    for (const f of [m, actions]) {
      expect(f).not.toContain("tracking_url");
      expect(f).not.toContain("tracking_provider");
    }
  });

  it("no RLS, grant or permission change rode along", () => {
    expect(m).not.toMatch(/\b(grant|revoke|policy)\b/i);
    expect(m).not.toContain("permission");
  });

  it("the SQL behaviour suite exists and CI runs it before the journey", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/tms_1b_plate_normalization_test.sql");
    expect(ci.indexOf("tms_1b_plate_normalization_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });
});
