/**
 * RQ-18b — « Mode de l'expédition », not « Mode de transport ».
 * ---------------------------------------------------------------------------
 * `transportMode` is the mode of the EXPÉDITION: how the principal shipment
 * moves internationally. Every consumer treats it that way — air tracking gates
 * on AIR, customs drops the airway bill or the bill of lading from it.
 *
 * On an ORDRE DE TRANSPORT it was printed under a bare « Mode de transport », on
 * a document whose purpose is to instruct a ROAD movement, so a reader could not
 * tell whether « SEA » described the voyage the goods arrived on or the movement
 * being ordered.
 *
 * The audit's conclusion was that the DATA MODEL is already right — the two
 * concepts are separate, with different cardinality — and that the fix is one
 * label. These tests hold both halves of that: the order says « expédition »,
 * and nothing else moved. In particular they guard the tempting wrong fix,
 * which would be to write an execution mode into shipment.transport_mode and
 * break air-tracking and customs gating in the process.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderArtifact, RENDERER_VERSION } from "@/lib/documents/artifacts/render";
import { SOURCE_FIELD_LABELS_FR } from "@/lib/documents/artifacts/source";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const render = read("lib", "documents", "artifacts", "render.ts");
const code = render.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SNAPSHOT: Record<string, string> = {
  fileNumber: "EFT-IMP-2026-00005",
  fileType: "IMPORT",
  clientName: "Client UAT",
  transportMode: "SEA",
  pickupLocation: "Port de Dakar",
  pickupPlanned: "2026-08-21",
  deliveryLocation: "Diamniadio",
  deliveryPlanned: "2026-08-22",
  transportCompany: "UAT Transporteur SARL",
  requestedBy: "Ops",
  requestedAt: "2026-08-20",
};

const asText = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const renderAs = (artifactCode: string) =>
  asText(renderArtifact({
    artifactCode,
    snapshot: SNAPSHOT,
    provenance: "NO_DRIVER",
    organizationName: "Effitrans",
    artifactVersion: 3,
  }));

describe("RQ-18b — the ORDRE DE TRANSPORT names the expédition", () => {
  it("renders « Mode de l'expédition »", () => {
    // Rendered uppercase as a row label; matched on the accent-free stem so the
    // assertion does not depend on how « é » is encoded in the content stream.
    const out = renderAs("TRANSPORT_ORDER");
    expect(out).toContain("DITION");
  });

  it("does NOT regress to the ambiguous « Mode de transport »", () => {
    const out = renderAs("TRANSPORT_ORDER");
    expect(out).not.toContain("MODE DE TRANSPORT");
  });

  it("the override is declared for this artifact only", () => {
    expect(code).toContain('TRANSPORT_ORDER: { transportMode: "Mode de l\'expédition" },');
    expect(code).toContain("const overrides = ARTIFACT_LABEL_OVERRIDES[input.artifactCode] ?? {};");
  });

  it("the label resolution prefers the override, then the shared map", () => {
    expect(code).toContain("label: overrides[f] ?? SOURCE_FIELD_LABELS_FR[f] ?? f,");
  });
});

describe("RQ-18b — the VALUE is untouched; only the label changed", () => {
  it("the order still prints the shipment's own mode", () => {
    expect(renderAs("TRANSPORT_ORDER")).toContain("SEA");
  });

  it("no execution mode is derived or invented", () => {
    const out = renderAs("TRANSPORT_ORDER");
    expect(out).not.toContain("ROUTIER");
    expect(code).not.toContain("executionMode");
    expect(code).not.toContain("execution_mode");
  });
});

describe("RQ-18b — nothing else was renamed", () => {
  it("the DEMANDE DE TRANSPORT keeps « Mode de transport »", () => {
    // A dossier-level document, where the label is already unambiguous. A global
    // rename would have relabelled this too.
    const out = renderAs("DEMANDE_TRANSPORT");
    expect(out).toContain("MODE DE TRANSPORT");
  });

  it("the shared label map is unchanged", () => {
    expect(SOURCE_FIELD_LABELS_FR.transportMode).toBe("Mode de transport");
  });

  it("no other field acquired an override", () => {
    const overrides = code.slice(
      code.indexOf("const ARTIFACT_LABEL_OVERRIDES"),
      code.indexOf("};", code.indexOf("const ARTIFACT_LABEL_OVERRIDES")),
    );
    expect(overrides).toContain("transportMode");
    for (const other of ["driverName", "vehiclePlate", "transportCompany", "pickupLocation"]) {
      expect(overrides, other).not.toContain(other);
    }
  });
});

describe("RQ-18b — the guarantees that must survive", () => {
  it("the renderer version is bumped whenever rendered output changes", () => {
    expect(RENDERER_VERSION).toBe("wes4g-4");
  });

  it("rendering is still deterministic for the same snapshot", () => {
    const a = renderAs("TRANSPORT_ORDER");
    const b = renderAs("TRANSPORT_ORDER");
    expect(a).toEqual(b);
  });

  it("the carrier is still the assignment snapshot", () => {
    expect(renderAs("TRANSPORT_ORDER")).toContain("UAT Transporteur SARL");
    expect(code).not.toContain("providerLabel");
  });
});
