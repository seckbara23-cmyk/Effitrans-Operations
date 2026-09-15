/**
 * TRN-VEHICLE-01 — one vehicle identity, read the same way everywhere.
 * ---------------------------------------------------------------------------
 * A transport names its vehicle in one of two ways: `vehicle_id` → the parc's
 * `vehicle.registration` (the AUTHORITATIVE fleet assignment, TMS-5) or the
 * free-text `vehicle_plate` (external / hired / legacy, the TMS-6 boundary).
 * Most readers took the free text as "the vehicle", so a fleet-executed mission
 * — whose plate is, correctly, NULL — read as having none: « Véhicule : — » for
 * the chauffeur, « Véhicule » missing on the Ordre de transport, and
 * `no_vehicle_plate` at the step-15 pickup gate.
 *
 * These tests pin the rule (registration first, plate fallback, never a copy)
 * and every seam that applies it, so a reader that goes back to the plate alone
 * fails here before it fails on a dossier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isVehicleAssigned, resolveVehicleIdentity } from "@/lib/transport/vehicle-identity";
import { evaluatePickupGate } from "@/lib/process/engine/gates";
import type { EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { resolveArtifactSource, type ArtifactSourceInput } from "@/lib/documents/artifacts/source";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8").replace(/\r\n/g, "\n");
/** Source without comments: prose may mention a call, code may not. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/ .*$/gm, "");

const FLEET_ID = "23db7f54-f6b6-479d-beb6-14f8b8d2422c"; // the AA605MW row, as bound on EFT-IMP-2026-00011

// ===========================================================================
describe("resolveVehicleIdentity — the fleet registration first, the plate as the fallback", () => {
  it("names the fleet vehicle by its registration when one is bound", () => {
    expect(resolveVehicleIdentity({ registration: "AA605MW", plate: null })).toBe("AA605MW");
  });

  it("falls back to the free-text plate of an external/legacy vehicle", () => {
    expect(resolveVehicleIdentity({ registration: null, plate: "DK-1234-AB" })).toBe("DK-1234-AB");
    expect(resolveVehicleIdentity({ plate: "DK-1234-AB" })).toBe("DK-1234-AB");
  });

  it("the fleet registration wins when both representations exist", () => {
    expect(resolveVehicleIdentity({ registration: "AA605MW", plate: "DK-1234-AB" })).toBe("AA605MW");
  });

  it("names nothing when neither exists, and never reads whitespace as a vehicle", () => {
    expect(resolveVehicleIdentity({ registration: null, plate: null })).toBeNull();
    expect(resolveVehicleIdentity({})).toBeNull();
    expect(resolveVehicleIdentity({ registration: "   ", plate: "  " })).toBeNull();
    expect(resolveVehicleIdentity({ registration: "  ", plate: " DK-1 " })).toBe("DK-1");
    expect(resolveVehicleIdentity({ registration: " AA605MW ", plate: null })).toBe("AA605MW");
  });
});

describe("isVehicleAssigned — the authoritative link OR the legacy text", () => {
  it("fleet vehicle bound, NULL plate → assigned", () => {
    expect(isVehicleAssigned({ vehicleId: FLEET_ID, plate: null })).toBe(true);
  });

  it("external plate, NULL vehicle_id → assigned (unchanged)", () => {
    expect(isVehicleAssigned({ vehicleId: null, plate: "DK-1234-AB" })).toBe(true);
    expect(isVehicleAssigned({ plate: "DK-1234-AB" })).toBe(true);
  });

  it("neither → not assigned; whitespace counts as neither", () => {
    expect(isVehicleAssigned({ vehicleId: null, plate: null })).toBe(false);
    expect(isVehicleAssigned({})).toBe(false);
    expect(isVehicleAssigned({ vehicleId: "  ", plate: "   " })).toBe(false);
  });

  it("both → assigned", () => {
    expect(isVehicleAssigned({ vehicleId: FLEET_ID, plate: "DK-1234-AB" })).toBe(true);
  });
});

// ===========================================================================
describe("step 15 — the pickup gate recognises a bound fleet vehicle", () => {
  const ready: EvidenceSnapshot = {
    fileType: "IMP",
    declaredAbsences: [],
    access: { documents: true, customs: true, transport: true, finance: true },
    documents: [
      { typeCode: "BON_A_DELIVRER", status: "APPROVED" },
      { typeCode: "PRE_GATE_AUTHORIZATION", status: "APPROVED" },
      { typeCode: "BORDEREAU_LIVRAISON", status: "APPROVED" },
    ],
    customs: { required: true, status: "RELEASED", baeReference: "BAE-2026-001", declarationNumber: "D-1", externalRef: "GAINDE-1" },
    transport: null,
    invoices: [],
  };
  const vehicle = (g: ReturnType<typeof evaluatePickupGate>) => g.requirements.find((r) => r.key === "vehicle_assigned")!;

  it("fleet vehicle + NULL plate — the production shape of EFT-IMP-2026-00011 — is a vehicle assignment", () => {
    const g = evaluatePickupGate({
      ...ready,
      transport: { status: "DRIVER_ASSIGNED", vehiclePlate: null, vehicleId: FLEET_ID, driverName: "UAT Chauffeur", driverUserId: "de297e89-6723-48a3-ba87-5692837ccf68" },
    });
    expect(vehicle(g).satisfied).toBe(true);
    expect(vehicle(g).detail).toBeUndefined();
    expect(g.missing).not.toContain("vehicle_assigned");
    expect(g.ready).toBe(true);
  });

  it("external plate + NULL vehicle_id still satisfies it — legacy and subcontracted missions are unchanged", () => {
    const withKey = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: "DK-1234-AB", vehicleId: null, driverName: "A. Diop", driverUserId: null },
    });
    expect(vehicle(withKey).satisfied).toBe(true);
    // A projection that predates the key (no `vehicleId` at all) reads the same.
    const withoutKey = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: "DK-1234-AB", driverName: "A. Diop", driverUserId: null },
    });
    expect(vehicle(withoutKey).satisfied).toBe(true);
    expect(withoutKey.ready).toBe(true);
  });

  it("neither → the requirement is missing, with the detail the matrix documents", () => {
    const g = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: null, vehicleId: null, driverName: "A. Diop", driverUserId: null },
    });
    expect(vehicle(g).satisfied).toBe(false);
    expect(vehicle(g).detail).toBe("no_vehicle_plate");
    expect(g.missing).toEqual(["vehicle_assigned"]);
    // Whitespace in either representation is still nothing.
    const blank = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: "  ", vehicleId: " ", driverName: "A. Diop", driverUserId: null },
    });
    expect(blank.missing).toEqual(["vehicle_assigned"]);
  });

  it("both representations → assigned; the driver rule beside it is untouched", () => {
    const both = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: "DK-1234-AB", vehicleId: FLEET_ID, driverName: "A. Diop", driverUserId: null },
    });
    expect(vehicle(both).satisfied).toBe(true);
    const noDriver = evaluatePickupGate({
      ...ready,
      transport: { status: "PLANNED", vehiclePlate: null, vehicleId: FLEET_ID, driverName: null, driverUserId: null },
    });
    expect(noDriver.missing).toEqual(["driver_assigned"]);
    expect(noDriver.requirements.find((r) => r.key === "driver_assigned")!.detail).toBe("no_driver_assigned");
  });

  it("every producer of the gate's transport snapshot carries vehicle_id, from the query to the literal", () => {
    // The pure predicate is only as good as what each snapshot feeds it. These
    // are the four readers that build `EvidenceSnapshot.transport` from the
    // database; one that forgot the column would refuse fleet missions again.
    for (const [file, row, wrap] of [
      ["lib/process/engine/snapshot.ts", "transport", "s"],
      ["lib/process/panels/transport.ts", "t", "str"],
      ["lib/process/queues/service.ts", "trn", "str"],
      ["lib/process/queues/control-tower.ts", "trn", "str"],
    ]) {
      const src = code(file);
      expect(src, file).toMatch(/select\("[^"]*\bvehicle_id\b[^"]*"/);
      expect(src, file).toMatch(/evaluatePickupGate\(|export async function loadProcessSnapshot/);
      // Inside the snapshot literal itself — the same call elsewhere in the
      // file must not stand in for the field the gate actually reads.
      const driver = src.indexOf(`driverUserId: ${wrap}(${row}.driver_user_id)`);
      expect(driver, file).toBeGreaterThan(-1);
      const literal = src.slice(src.lastIndexOf("{", driver), driver);
      expect(literal, file).toContain(`vehiclePlate: ${wrap}(${row}.vehicle_plate),`);
      expect(literal, file).toContain(`vehicleId: ${wrap}(${row}.vehicle_id),`);
    }
    // The predicate itself is the shared rule, not a local re-spelling.
    const gates = code("lib/process/engine/gates.ts");
    expect(gates).toContain("const vehicleAssigned = isVehicleAssigned({ vehicleId: snap.transport?.vehicleId, plate: snap.transport?.vehiclePlate });");
    expect(gates).not.toContain("nonEmpty(snap.transport?.vehiclePlate)");
    expect(gates).toContain("const driverAssigned = nonEmpty(snap.transport?.driverUserId) || nonEmpty(snap.transport?.driverName);");
  });

  it("the transport-readiness panel reports and names the vehicle by the same rule", () => {
    const panel = code("lib/process/panels/transport.ts");
    expect(panel).toContain("const vehicleAssigned = isVehicleAssigned({ vehicleId: str(t.vehicle_id), plate: str(t.vehicle_plate) });");
    expect(panel).toContain("vehiclePlate: resolveVehicleIdentity({ registration: fleetVehicle?.registration, plate: str(t.vehicle_plate) }),");
    expect(panel).toContain("vehicle:vehicle_id(registration)");
    expect(panel).not.toContain("!!str(t.vehicle_plate)?.trim()");
  });
});

// ===========================================================================
describe("the chauffeur's mission resolves the fleet vehicle", () => {
  const service = code("lib/driver/service.ts");

  it("the mission query reaches the fleet row through vehicle_id and resolves it", () => {
    expect(service).toContain("vehicle_plate, vehicle_id, vehicle:vehicle_id(registration), driver_name");
    expect(service).toContain("vehicleLabel: resolveVehicleIdentity({ registration: r.vehicle?.registration, plate: r.vehicle_plate }),");
    expect(service).toContain('import { resolveVehicleIdentity } from "@/lib/transport/vehicle-identity";');
  });

  it("the DTO no longer exposes the plate as the vehicle, and the page renders the resolved identity", () => {
    const dto = service.slice(service.indexOf("export type DriverMission = {"), service.indexOf("export type MissionEvidence"));
    expect(dto).toContain("vehicleLabel: string | null;");
    expect(dto).not.toContain("vehiclePlate");
    const page = code("app/driver/missions/[transportId]/page.tsx");
    expect(page).toContain('{d.missions.vehicle} : {mission.vehicleLabel ?? "—"}');
    expect(page).not.toContain("vehiclePlate");
  });

  it("the projection stays customer-safe — the fleet row contributes its registration and nothing else", () => {
    expect(service).toMatch(/vehicle:vehicle_id\(registration\)/);
    expect(service).not.toMatch(/vehicle:vehicle_id\([^)]*(notes|odometer|capacity|status)/);
    // Still hard-gated on the assignment, never on a broad permission.
    expect(service).toMatch(/\.eq\("driver_user_id", user\.id\)/);
  });
});

// ===========================================================================
describe("the Ordre de transport resolves the fleet vehicle", () => {
  const FULL: ArtifactSourceInput = {
    fileNumber: "EFT-IMP-2026-00011", fileType: "IMP", clientName: "Client", transportMode: "ROAD",
    origin: null, destination: null, cargoType: null, containerRef: null,
    pickupLocation: "Port de Ndayane", deliveryLocation: "Dakar Plateau", pickupPlanned: "2026-09-15", deliveryPlanned: null,
    driverName: "UAT Chauffeur", driverUserId: "de297e89-6723-48a3-ba87-5692837ccf68",
    vehiclePlate: null, providerId: null, trailerOrContainer: null, transportCompany: "Effitrans Logistics",
    requestedBy: null, requestedAt: null,
  };

  it("the source read reaches the fleet row and feeds the resolved identity into the snapshot field", () => {
    const src = code("lib/documents/artifacts/service.ts");
    expect(src).toContain("vehicle_plate, vehicle_id, vehicle:vehicle_id(registration), provider_id");
    expect(src).toContain("vehiclePlate: resolveVehicleIdentity({ registration: vehicle?.registration, plate: t.vehicle_plate }),");
    expect(src).toContain("const vehicle = Array.isArray(t.vehicle) ? t.vehicle[0] : t.vehicle;");
  });

  it("a fleet-bound internal order is complete on the registration, with the historical snapshot key", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, vehiclePlate: "AA605MW" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.vehiclePlate).toBe("AA605MW");
      expect(r.provenance).toBe("AUTHENTICATED_DRIVER");
    }
  });

  it("without any vehicle the internal order is still refused on « Véhicule » — nothing is invented", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", FULL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual([{ field: "vehiclePlate", labelFr: "Véhicule" }]);
  });

  it("the external branch is untouched: the carrier is mandatory, the vehicle is not", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, driverName: null, driverUserId: null, providerId: "p-1", transportCompany: "Transports Diallo" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot).not.toHaveProperty("vehiclePlate");
  });
});

// ===========================================================================
describe("the Transport Officer's panel — the parc registration is the immatriculation", () => {
  const panel = code("components/transport/transport-panel.tsx");
  const reader = code("lib/transport/service.ts");

  it("the reader exposes the bare registration of the bound fleet vehicle", () => {
    expect(reader).toContain("vehicleRegistration: r.vehicle?.registration ?? null,");
    expect(code("lib/transport/types.ts")).toContain("vehicleRegistration?: string | null;");
  });

  it("with a fleet vehicle bound the registration is shown read-only where the plate would be typed", () => {
    const at = panel.indexOf("{record.vehicleId ? (");
    expect(at).toBeGreaterThan(-1);
    const branch = panel.slice(at, panel.indexOf(") : (", at));
    expect(branch).toContain("resolveVehicleIdentity({ registration: record.vehicleRegistration, plate: record.vehiclePlate })");
    expect(branch).toContain("(véhicule du parc)");
    expect(branch).not.toContain("<Field");
    expect(branch).not.toContain("<input");
  });

  it("the free-text plate input exists only for an external/hired vehicle", () => {
    expect(panel.match(/name="vehiclePlate"/g)).toHaveLength(1);
    const field = panel.indexOf('<Field label={tr.fields.vehiclePlate} name="vehiclePlate" defaultValue={record.vehiclePlate} />');
    const elseAt = panel.indexOf(") : (", panel.indexOf("{record.vehicleId ? ("));
    expect(field).toBeGreaterThan(elseAt);
  });

  it("a bound fleet vehicle never sends, clears or rewrites the free-text plate", () => {
    const assign = panel.slice(panel.indexOf("function onAssign("), panel.indexOf("const completeTargets"));
    expect(assign).toContain("const fleetBound = Boolean(r.vehicleId);");
    expect(assign).toContain('vehiclePlate: fleetBound ? undefined : String(fd.get("vehiclePlate") ?? ""),');
    expect(assign).toContain('...(fleetBound ? [] : [["vehiclePlate", r.vehiclePlate] as [string, string | null]]),');
  });

  it("nothing copies the registration into vehicle_plate — the two representations stay distinct", () => {
    const actions = code("lib/transport/actions.ts");
    expect(actions).not.toMatch(/vehicle_plate\s*=/);
    expect(actions).not.toMatch(/patch\.vehicle_plate|\.vehicle_plate\s*=/);
    expect(actions).not.toMatch(/registration/);
    // The only assignment-time snapshot is TMS-6's carrier name (UAT-17).
    expect(actions).toContain("transport_company = provider.name");
    expect(code("lib/transport/patch.ts")).toContain('vehiclePlate: "vehicle_plate"');
    expect(code("lib/transport/patch.ts")).toContain('vehicleId: "vehicle_id"');
  });
});

// ===========================================================================
describe("scope — read-side only", () => {
  it("no migration accompanies this correction", () => {
    for (const f of ["lib/transport/vehicle-identity.ts", "lib/driver/service.ts", "lib/documents/artifacts/service.ts", "lib/process/engine/gates.ts"]) {
      expect(read(f), f).not.toMatch(/supabase\/migrations|alter table|create table/i);
    }
  });

  it("the C-4 journey binds a seeded parc vehicle with NO plate and reads it back through every seam", () => {
    const seed = read("supabase/tests/journey_identities.sql");
    expect(seed).toContain("insert into public.vehicle");
    expect(seed).toContain("'JRN-FLEET-01'");
    const journey = read("tests/journey/delivery-completeness.journey.ts");
    expect(journey).toContain('assignTransport(t.id, { vehicleId: FLEET_VEHICLE, clearFields: ["vehiclePlate"] }, t.updatedAt)');
    expect(journey).toContain('expect(gate?.missing).not.toContain("vehicle_assigned");');
    expect(journey).toContain("expect(mission?.vehicleLabel).toBe(FLEET_VEHICLE_REGISTRATION);");
    expect(journey).toContain("expect(source?.vehiclePlate).toBe(FLEET_VEHICLE_REGISTRATION);");
  });
});
