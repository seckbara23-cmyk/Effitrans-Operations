/**
 * TMS-1A — vehicle retirement hardening.
 * ---------------------------------------------------------------------------
 * The lifecycle existed (is_active, migration 117); this slice finished it.
 * What is pinned here, and why it must not drift:
 *
 *   * the mid-mission interlock lives in the DATABASE, names the blocking
 *     dossier, and uses the SAME engaged vocabulary the fleet view derives
 *     « En mission » from — the two lists are pinned to each other;
 *   * the retirement instant is DATABASE time (the trigger stamps now());
 *   * a reason is mandatory at BOTH layers (action and trigger);
 *   * retirement and reactivation are their own audit events — an odometer
 *     edit can never masquerade as either;
 *   * the retire/bind race is closed (FOR SHARE on the bind-side read);
 *   * a retired vehicle is excluded from every operational count and from the
 *     assignable list, but its history remains.
 *
 * The real-Postgres behaviour lives in
 * supabase/tests/tms_1a_vehicle_retirement_test.sql.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AuditActions } from "@/lib/audit/events";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260924000001_vehicle_retirement.sql";
const m = strip(read(MIGRATION));
const actions = strip(read("lib/fleet/actions.ts"));
const service = read("lib/fleet/service.ts");
const console_ = read("components/fleet/fleet-console.tsx");
const page = read("app/transport/parc/page.tsx");

// The service module cannot be imported here (its auth chain needs a React
// server environment), so the engaged vocabulary is read from the SOURCE —
// which is also what the migration's 4d assertion pins from the other side.
const ENGAGED = /ENGAGED_TRANSPORT_STATUSES = \[\s*([^\]]+)\]/.exec(read("lib/fleet/service.ts"))![1]
  .split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);

const fn = (name: string) => {
  const i = actions.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const rest = actions.slice(i);
  const next = rest.indexOf("export async function", 10);
  return next === -1 ? rest : rest.slice(0, next);
};

// ═══════════════════════ the mid-mission interlock ═════════════════════════

describe("TMS-1A — a vehicle on a live mission cannot be retired", () => {
  it("the refusal is in the DATABASE, not a screen", () => {
    expect(m).toContain("create trigger trg_vehicle_retirement_guard before update on public.vehicle");
    expect(m).toContain("retrait refusé : le véhicule est affecté à une mission en cours (dossier %)");
  });

  it("« mission en cours » is the EXISTING engaged vocabulary — not redefined", () => {
    // The service's derived « En mission » and the trigger must forever agree.
    expect(ENGAGED).toEqual(["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT"]);
    expect(m).toContain("tr.status in ('PLANNED', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')");
    expect(m).toContain("tr.deleted_at is null");
    // …and the migration asserts it against its own function source (4d).
    expect(read(MIGRATION)).toContain("ENGAGED_TRANSPORT_STATUSES");
  });

  it("the action's friendly pre-check uses the same list, imported — never retyped", () => {
    const retire = fn("retireVehicle");
    expect(retire).toContain('.in("status", [...ENGAGED_TRANSPORT_STATUSES])');
    expect(retire).toContain('.is("deleted_at", null)');
    expect(retire).toContain('return { ok: false, error: "vehicle_on_mission" }');
    // The trigger remains the authority when the race is lost.
    expect(retire).toContain('error.message.includes("mission en cours")');
  });

  it("the retire/bind race is closed: the bind-side read takes FOR SHARE", () => {
    expect(m).toContain("for share;");
    // …and the migration's self-assertion strips comments before checking, so
    // a commented-out lock cannot pass (the MAYA-P1.1 prosrc lesson).
    expect(read(MIGRATION)).toContain("regexp_replace(prosrc,");
  });
});

// ═══════════════════════ reason, actor, database time ══════════════════════

describe("TMS-1A — the act carries why, who and when", () => {
  it("a reason is mandatory at the action layer", () => {
    const retire = fn("retireVehicle");
    expect(retire).toContain('return { ok: false, error: "reason_required" }');
  });

  it("…and at the database layer, so no other path can skip it", () => {
    expect(m).toContain("retrait refusé : un motif est obligatoire");
    expect(m).toContain("retrait refusé : l''acteur du retrait doit être identifié");
    expect(m).toContain("vehicle_retirement_coherent");
  });

  it("the instant is stamped by the DATABASE — the action never dates the act", () => {
    expect(m).toContain("new.retired_at := now()");
    const retire = fn("retireVehicle");
    expect(retire).not.toContain("retired_at");        // never written app-side
    expect(retire).not.toContain("new Date");          // no application clock
  });

  it("reactivation clears the record in the trigger; the audit keeps the past", () => {
    expect(m).toContain("new.retired_at     := null");
    const react = fn("reactivateVehicle");
    expect(react).toContain("retired_reason: vehicle.retired_reason");
    expect(react).toContain('before: { is_active: false');
  });
});

// ═══════════════════════ audit semantics ═══════════════════════════════════

describe("TMS-1A — retirement is distinguishable in the audit trail", () => {
  it("vehicle.retired and vehicle.reactivated exist and are distinct", () => {
    expect(AuditActions.VEHICLE_RETIRED).toBe("vehicle.retired");
    expect(AuditActions.VEHICLE_REACTIVATED).toBe("vehicle.reactivated");
    expect(AuditActions.VEHICLE_UPDATED).not.toBe(AuditActions.VEHICLE_RETIRED);
  });

  it("retireVehicle writes VEHICLE_RETIRED — never the generic update event", () => {
    const retire = fn("retireVehicle");
    expect(retire).toContain("AuditActions.VEHICLE_RETIRED");
    expect(retire).not.toContain("AuditActions.VEHICLE_UPDATED");
    expect(retire).toContain("reason: retiredReason");
  });

  it("reactivateVehicle writes VEHICLE_REACTIVATED", () => {
    const react = fn("reactivateVehicle");
    expect(react).toContain("AuditActions.VEHICLE_REACTIVATED");
    expect(react).not.toContain("AuditActions.VEHICLE_UPDATED");
  });

  it("the un-governed flip is gone: setVehicleActive no longer exists", () => {
    expect(actions).not.toContain("setVehicleActive");
  });
});

// ═══════════════════════ authority ═════════════════════════════════════════

describe("TMS-1A — authority is the ratified transport:manage", () => {
  it("both acts assert it server-side", () => {
    expect(fn("retireVehicle")).toContain('assertPermission("transport:manage")');
    expect(fn("reactivateVehicle")).toContain('assertPermission("transport:manage")');
  });

  it("no vehicle/fleet permission was invented — asserted by the migration too", () => {
    expect(m).toContain("'vehicle:retire'");   // in the refusal list
    expect(actions).not.toContain("vehicle:retire");
  });
});

// ═══════════════════════ operational exclusion ═════════════════════════════

describe("TMS-1A — a retired vehicle is not operational fleet", () => {
  it("every operational count filters on isActive FIRST; retired is its own count", () => {
    const summarize = service.slice(service.indexOf("export function summarizeFleet"));
    const body = summarize.slice(0, summarize.indexOf("\n}\n"));
    // The whole overview derives from the ACTIVE subset…
    expect(body).toContain("const active = fleet.filter((v) => v.isActive);");
    expect(body).toContain("total: active.length");
    // …so a retired row whose stored status is still AVAILABLE cannot leak
    // into any operational figure. Retired is counted apart, by difference.
    expect(body).toContain("retired: fleet.length - active.length");
    for (const line of ["available:", "engaged:", "maintenance:", "outOfService:"]) {
      expect(body.split(line)[1]!.slice(0, 60), line).toContain("active.filter");
    }
  });

  it("the assignable list filters on isActive", () => {
    expect(service).toContain("v.isActive && v.status === \"AVAILABLE\" && !v.engaged");
  });

  it("the page shows « Retiré du parc » INSTEAD of any operational chip", () => {
    // The retired branch is checked before engaged/status branches.
    const cell = page.slice(page.indexOf("!v.isActive ? ("));
    expect(page.indexOf("!v.isActive ? (")).toBeGreaterThan(-1);
    expect(cell.indexOf("Retiré du parc")).toBeLessThan(cell.indexOf("En mission"));
    expect(page).toContain('label="Retirés du parc"');
  });
});

// ═══════════════════════ UI behaviour ══════════════════════════════════════

describe("TMS-1A — the console offers the action the state permits", () => {
  it("an ACTIVE vehicle gets « Retirer du parc », a retired one « Réintégrer »", () => {
    expect(console_).toContain("selected && selected.isActive && (");
    expect(console_).toContain("selected && !selected.isActive && (");
    expect(console_).toContain("Retirer du parc");
    expect(console_).toContain("Réintégrer au parc");
  });

  it("retirement identifies the vehicle, requires a reason, explains history, confirms", () => {
    expect(console_).toContain("Confirmer le retrait de {selected.registration}");
    expect(console_).toContain('placeholder="Motif du retrait (obligatoire)"');
    expect(console_).toContain("disabled={pending || !retireReason.trim()}");
    expect(console_).toContain("reste consultable");
  });

  it("it submits through the governed server action — no direct write", () => {
    expect(console_).toContain("retireVehicle(target, retireReason.trim())");
    expect(console_).toContain("reactivateVehicle(target)");
    expect(console_).not.toContain('from("vehicle")');
  });

  it("the refusals speak French", () => {
    expect(console_).toContain("Un motif de retrait est obligatoire.");
    expect(console_).toContain("affecté à une mission en cours");
  });
});

// ═══════════════════════ slice discipline ══════════════════════════════════

describe("TMS-1A — the slice stayed inside its boundary", () => {
  it("no TMS-1B cleanup: the demo vehicles are not named anywhere in the slice", () => {
    for (const f of [m, actions, console_, page]) {
      expect(f).not.toMatch(/UAT-TMS7|AA-?605-?MW/i);
    }
  });

  it("no TMS-1C tracking: no provider fields were added", () => {
    for (const f of [m, actions]) {
      expect(f).not.toContain("tracking_url");
      expect(f).not.toContain("tracking_provider");
    }
  });

  it("deleteVehicle is untouched: still refuses history, still no force flag", () => {
    const del = fn("deleteVehicle");
    expect(del).toContain('return { ok: false, error: "vehicle_in_use" }');
    expect(del).toContain('return { ok: false, error: "vehicle_has_history" }');
    expect(del).not.toContain("force");
  });

  it("the SQL behaviour suite exists and CI runs it before the journey", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/tms_1a_vehicle_retirement_test.sql");
    expect(ci.indexOf("tms_1a_vehicle_retirement_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });
});
