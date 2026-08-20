/**
 * TMS-7 / RQ-18 — an ORDRE DE TRANSPORT knows which branch executes it.
 * ---------------------------------------------------------------------------
 * `MANDATORY.TRANSPORT_ORDER` was authored under WES-4G on 2026-07-27 and
 * required a driver and a plate of everyone. TMS-6 gave transports a second
 * execution branch three weeks later, on 2026-08-19, and the list was never
 * revisited — so a subcontracted order could not be issued until Effitrans
 * supplied a driver and an immatriculation it does not own and, at the moment
 * the order is needed, does not yet know.
 *
 * Effitrans ratified the operational answer (RQ-18, 2026-08-20):
 *
 *   « Lorsqu'Effitrans confie un transport à un sous-traitant, l'Ordre de
 *     Transport peut être émis avec uniquement le transporteur désigné. »
 *
 * So the execution party stays mandatory — it is the CARRIER here — while
 * driver and plate become optional and are recorded later. The internal-fleet
 * rule is deliberately unchanged, and these tests hold BOTH halves: the
 * loosening must not leak across the branch, and the tightening must not
 * disappear.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveArtifactSource,
  mandatoryFieldsFor,
  type ArtifactSourceInput,
} from "@/lib/documents/artifacts/source";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const render = read("lib", "documents", "artifacts", "render.ts");
const service = read("lib", "documents", "artifacts", "service.ts");

/** A dossier ready for an order except for the execution party. */
const BASE: ArtifactSourceInput = {
  fileNumber: "EFT-IMP-2026-00005",
  fileType: "IMPORT",
  clientName: "Client UAT",
  transportMode: "SEA",
  origin: "Shanghai",
  destination: "Dakar",
  cargoType: "Divers",
  containerRef: "TEST1234567",
  pickupLocation: "Port de Dakar",
  deliveryLocation: "Zone industrielle",
  pickupPlanned: "2026-08-21",
  deliveryPlanned: "2026-08-22",
  driverName: null,
  driverUserId: null,
  vehiclePlate: null,
  providerId: null,
  trailerOrContainer: null,
  transportCompany: null,
  requestedBy: "Ops",
  requestedAt: "2026-08-20",
};

/** Branch B: bound to a subcontractor, carrier snapshotted at assignment. */
const EXTERNAL: ArtifactSourceInput = {
  ...BASE,
  providerId: "acee0000-0000-0000-0000-000000000001",
  transportCompany: "UAT Transporteur SARL",
};

/** Branch A: the Effitrans fleet, driver and plate known. */
const INTERNAL: ArtifactSourceInput = {
  ...BASE,
  driverName: "Moussa Diop",
  vehiclePlate: "DK-1234-AB",
};

const missingOf = (r: ReturnType<typeof resolveArtifactSource>) =>
  r.ok ? [] : r.missing.map((m) => m.field).sort();

describe("RQ-18 — Branch B: the carrier IS the execution party", () => {
  it("an order generates with only the carrier named", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", EXTERNAL);
    expect(r.ok).toBe(true);
  });

  it("the carrier is REQUIRED — a subcontracted order cannot be anonymous", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...EXTERNAL, transportCompany: null });
    expect(r.ok).toBe(false);
    expect(missingOf(r)).toEqual(["transportCompany"]);
  });

  it("driver and plate are NOT required", () => {
    const set = mandatoryFieldsFor("TRANSPORT_ORDER", EXTERNAL) ?? [];
    expect(set).not.toContain("driverName");
    expect(set).not.toContain("vehiclePlate");
    expect(set).toContain("transportCompany");
  });

  it("driver and plate are still CARRIED when the carrier supplies them later", () => {
    const later = { ...EXTERNAL, driverName: "Chauffeur du sous-traitant", vehiclePlate: "DK-7777-XX" };
    const r = resolveArtifactSource("TRANSPORT_ORDER", later);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.driverName).toBe("Chauffeur du sous-traitant");
    expect(r.snapshot.vehiclePlate).toBe("DK-7777-XX");
  });

  it("absent driver/plate are OMITTED from the snapshot, never blank", () => {
    // A blank « Chauffeur » line would assert there is no driver (WES-4G).
    const r = resolveArtifactSource("TRANSPORT_ORDER", EXTERNAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot).not.toHaveProperty("driverName");
    expect(r.snapshot).not.toHaveProperty("vehiclePlate");
  });

  it("the renderer prints only fields the snapshot actually has", () => {
    expect(render).toContain(".filter((f) => input.snapshot[f] !== undefined)");
  });
});

describe("RQ-18 — Branch A: the internal-fleet rule is untouched", () => {
  it("an internal order still generates when driver and plate are known", () => {
    expect(resolveArtifactSource("TRANSPORT_ORDER", INTERNAL).ok).toBe(true);
  });

  it("an internal order STILL refuses without a driver and a plate", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", BASE);
    expect(r.ok).toBe(false);
    expect(missingOf(r)).toEqual(["driverName", "vehiclePlate"]);
  });

  it("the loosening did not leak: no provider ⇒ the strict list applies", () => {
    const set = mandatoryFieldsFor("TRANSPORT_ORDER", BASE) ?? [];
    expect(set).toContain("driverName");
    expect(set).toContain("vehiclePlate");
  });

  it("an internal order does not require transportCompany", () => {
    // Effitrans carrying its own freight need not name a carrier.
    expect(mandatoryFieldsFor("TRANSPORT_ORDER", INTERNAL) ?? []).not.toContain("transportCompany");
  });
});

describe("RQ-18 — the branch signal is provenance, not content", () => {
  it("providerId never reaches the document body", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", EXTERNAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot).not.toHaveProperty("providerId");
    expect(Object.values(r.snapshot)).not.toContain(EXTERNAL.providerId);
  });

  it("driverUserId is still excluded too", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...INTERNAL, driverUserId: "u-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot).not.toHaveProperty("driverUserId");
  });

  it("the branch is read from the same column the DB exclusivity CHECK uses", () => {
    expect(service).toContain("providerId: t.provider_id ?? null,");
    expect(service).toContain("provider_id");
  });
});

describe("RQ-18 — the UAT-17 snapshot invariant is not disturbed", () => {
  it("the order names the carrier from the ASSIGNMENT snapshot", () => {
    // transportCompany is the snapshot; a later rename of the registry must not
    // change what this order says.
    const r = resolveArtifactSource("TRANSPORT_ORDER", EXTERNAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.transportCompany).toBe("UAT Transporteur SARL");
  });

  it("the artifact pipeline still never reads the live provider name", () => {
    const source = read("lib", "documents", "artifacts", "source.ts");
    for (const s of ["providerLabel", "provider?.name", "transport_provider"]) {
      expect(source, s).not.toContain(s);
      expect(render, s).not.toContain(s);
    }
  });

  it("other artifacts are unaffected by the branch rule", () => {
    const a = mandatoryFieldsFor("DEMANDE_TRANSPORT", EXTERNAL);
    const b = mandatoryFieldsFor("DEMANDE_TRANSPORT", INTERNAL);
    expect(a).toEqual(b);
  });

  it("an unknown artifact is still not generatable", () => {
    expect(mandatoryFieldsFor("NOT_AN_ARTIFACT", EXTERNAL)).toBeUndefined();
    expect(resolveArtifactSource("NOT_AN_ARTIFACT", EXTERNAL).ok).toBe(false);
  });
});
