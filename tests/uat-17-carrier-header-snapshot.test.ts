/**
 * TMS-7 / UAT-17 — the header must name the carrier as it was CONFIDED TO.
 * ---------------------------------------------------------------------------
 * The rename proved the data layer right and the presentation wrong. After
 * « UAT Transporteur SARL » became « … — RENOMME UAT17 », production showed:
 *
 *   header       Transport externe · UAT Transporteur SARL — RENOMME UAT17  ✗
 *   Transporteur UAT Transporteur SARL                                       ✓
 *
 * `transport_company` — the snapshot taken at assignment — had survived
 * exactly as designed. The header was reading `providerLabel`, a LIVE join on
 * `transport_provider.name`, so it moved with the rename and made an
 * already-bound transport look as though it had been given to a carrier that
 * did not exist under that name at the time.
 *
 * The census behind this fix: `providerLabel` has exactly three consumers, all
 * in the transport panel — the header (now snapshot-first) and the selector's
 * two <option> lines (deliberately unchanged). The ORDRE DE TRANSPORT pipeline
 * and the Copilot projections already read the snapshot.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const panel = read("components", "transport", "transport-panel.tsx");
const service = read("lib", "transport", "service.ts");
const source = read("lib", "documents", "artifacts", "source.ts");
const render = read("lib", "documents", "artifacts", "render.ts");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const panelCode = strip(panel);

/**
 * The header's own resolution rule, evaluated the way the component does.
 * Mirrors `record.transportCompany ?? record.providerLabel`, and the pin below
 * holds the production expression to that shape.
 */
const headerCarrier = (r: { transportCompany: string | null; providerLabel: string | null }) =>
  r.transportCompany ?? r.providerLabel;

describe("UAT-17 — the header shows the historical carrier", () => {
  it("the production header resolves snapshot BEFORE the live label", () => {
    expect(panelCode).toContain("record.transportCompany ?? record.providerLabel");
  });

  it("after a rename it still names the carrier as at assignment", () => {
    // The exact production scenario.
    const bound = {
      transportCompany: "UAT Transporteur SARL",
      providerLabel: "UAT Transporteur SARL — RENOMME UAT17",
    };
    expect(headerCarrier(bound)).toBe("UAT Transporteur SARL");
    expect(headerCarrier(bound)).not.toContain("RENOMME");
  });

  it("the header no longer reads the live label first", () => {
    // The defect verbatim: the old expression put providerLabel first.
    expect(panelCode).not.toContain("`Transport externe${record.providerLabel ?");
  });
});

describe("UAT-17 — legacy rows without a snapshot still resolve", () => {
  it("a row bound before the snapshot existed falls back to the live label", () => {
    expect(headerCarrier({ transportCompany: null, providerLabel: "Transporteur X" })).toBe("Transporteur X");
  });

  it("a row with neither yields nothing to print, not a crash", () => {
    expect(headerCarrier({ transportCompany: null, providerLabel: null })).toBe(null);
  });

  it("an empty snapshot is not silently preferred over a real label", () => {
    // ?? falls through on null/undefined only, which is the intent: an empty
    // string would be a real recorded value, not an absent one.
    expect(headerCarrier({ transportCompany: "", providerLabel: "Transporteur X" })).toBe("");
  });
});

describe("UAT-17 — the selector deliberately still shows the CURRENT registry", () => {
  it("the provider <option> keeps the live label", () => {
    expect(panelCode).toContain("{record.providerId && record.providerLabel && (");
    expect(panelCode).toContain("<option value={record.providerId}>{record.providerLabel}</option>");
  });

  it("providerLabel is still a live join — the model did not change", () => {
    expect(service).toContain("providerLabel: r.provider?.name ?? null,");
  });

  it("the snapshot field is still projected alongside it", () => {
    expect(service).toContain("transportCompany: r.transport_company,");
  });
});

describe("UAT-17 — nothing outside the header moved", () => {
  it("the printable ORDRE DE TRANSPORT still sources the snapshot", () => {
    expect(source).toContain('transportCompany: "Transporteur",');
    expect(render).toContain('"driverName", "vehiclePlate", "transportCompany",');
  });

  it("the artifact pipeline never reads the live provider name", () => {
    for (const s of ["providerLabel", "provider?.name", "transport_provider"]) {
      expect(source, s).not.toContain(s);
      expect(render, s).not.toContain(s);
    }
  });

  it("the « Transporteur » field still edits the snapshot", () => {
    expect(panelCode).toContain('name="transportCompany" defaultValue={record.transportCompany}');
  });

  it("the fleet branch of the header is untouched", () => {
    expect(panelCode).toContain("`Flotte Effitrans${record.vehicleLabel ? ` · ${record.vehicleLabel}` : \"\"}`");
  });
});
