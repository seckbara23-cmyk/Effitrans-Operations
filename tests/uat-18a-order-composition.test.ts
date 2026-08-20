/**
 * TMS-7 / DEFECT-UAT18a + UAT18b — the ORDRE DE TRANSPORT as a usable document.
 * ---------------------------------------------------------------------------
 * Two defects, found by reading the produced PDF rather than the code:
 *
 * 18a — a Branch-B order printed « Aucun chauffeur affecté. » That ASSERTS an
 *       absence, when the truth is merely not-yet-known: RQ-18 ratified that a
 *       subcontracted order is issued before the carrier names its driver.
 *
 * 18b — the page carried a large blank area with the content pushed to the
 *       bottom. `PdfDoc` has a TOP-LEFT origin (`text` converts via
 *       `this.height - y`), but the renderer started at `doc.height - M` and
 *       DECREMENTED — written for a bottom-left origin. The header landed at
 *       the foot and the body marched upward.
 *
 * These pins are on the RENDERER, not on pixels: the composition rules and the
 * omission semantics, which are the parts that can silently regress.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderArtifact, RENDERER_VERSION, frDateTime } from "@/lib/documents/artifacts/render";

const root = path.join(__dirname, "..");
const render = fs.readFileSync(path.join(root, "lib", "documents", "artifacts", "render.ts"), "utf-8");
const code = render.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Branch B: carrier known, driver and vehicle not yet supplied. */
const EXTERNAL_SNAPSHOT: Record<string, string> = {
  fileNumber: "EFT-IMP-2026-00005",
  fileType: "IMPORT",
  clientName: "Client UAT",
  transportMode: "SEA",
  pickupLocation: "Port de Dakar",
  pickupPlanned: "2026-08-21",
  deliveryLocation: "Diamniadio",
  deliveryPlanned: "2026-08-22T10:00",
  transportCompany: "UAT Transporteur SARL",
};

const render_ = (snapshot: Record<string, string>, provenance: "NO_DRIVER" | "LEGACY_TEXT_DRIVER" | "AUTHENTICATED_DRIVER") =>
  renderArtifact({
    artifactCode: "TRANSPORT_ORDER",
    snapshot,
    provenance,
    organizationName: "Effitrans",
    artifactVersion: 2,
  });

/** The PDF content stream as text, for asserting what reached the page. */
const asText = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("DEFECT-UAT18a — Branch B omits the driver rather than denying one", () => {
  it("« Aucun chauffeur affecté » never appears on an ORDRE DE TRANSPORT", () => {
    const out = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    expect(out).not.toContain("Aucun chauffeur");
  });

  it("the suppression is bound to the ORDER, in source", () => {
    expect(code).toContain('input.provenance === "NO_DRIVER" && !isOrder');
  });

  it("the « Exécution » section is skipped entirely when both fields are absent", () => {
    // Matched on the accent-free tail of EXÉCUTION so the assertion does not
    // depend on how the accent is encoded — and so it cannot be satisfied by
    // the unrelated word EXPORT.
    const absent = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    const present = asText(render_({ ...EXTERNAL_SNAPSHOT, driverName: "Chauffeur ST" }, "LEGACY_TEXT_DRIVER"));
    expect(present).toContain("CUTION");   // positive control: the heading CAN appear
    expect(absent).not.toContain("CUTION");
    expect(code).toContain("if (rows.length === 0) continue;");
  });

  it("the section REAPPEARS once the carrier supplies a driver", () => {
    const out = asText(render_({ ...EXTERNAL_SNAPSHOT, driverName: "Chauffeur ST", vehiclePlate: "DK-7777-XX" }, "LEGACY_TEXT_DRIVER"));
    expect(out).toContain("Chauffeur ST");
    expect(out).toContain("DK-7777-XX");
  });

  it("the legacy free-text driver warning is NOT suppressed — that one is true", () => {
    const out = asText(render_({ ...EXTERNAL_SNAPSHOT, driverName: "Chauffeur ST" }, "LEGACY_TEXT_DRIVER"));
    expect(out).toContain("texte libre");
  });
});

describe("DEFECT-UAT18b — the page is composed from the top", () => {
  it("the body starts at the TOP margin and grows downward", () => {
    // The defect verbatim was `let y = doc.height - M` with `y -=`.
    expect(code).toContain("let y = M;");
    expect(code).not.toContain("let y = doc.height - M;");
  });

  it("the header advances downward, not upward", () => {
    expect(code).toContain("y += 24;");
    expect(code).not.toContain("y -= 26;");
  });

  it("the page break resets to the top margin", () => {
    expect(code).toContain("y > doc.height - M - 60");
    expect(code).toContain("y = M;");
  });

  it("the footer sits at the FOOT of the page", () => {
    expect(code).toContain("doc.height - M + 12");
  });

  it("the dossier number and version are in the header block", () => {
    const out = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    expect(out).toContain("Dossier EFT-IMP-2026-00005");
    expect(out).toContain("Version 2");
  });

  it("the order renders as titled sections", () => {
    const out = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    for (const heading of ["CLIENT / DOSSIER", "TRANSPORTEUR", "ENL", "LIVRAISON"]) {
      expect(out, heading).toContain(heading);
    }
  });
});

describe("UAT-18 — dates are French, never raw ISO", () => {
  it("a date-only value becomes dd/mm/yyyy", () => {
    expect(frDateTime("2026-08-21")).toBe("21/08/2026");
  });

  it("a date-time becomes dd/mm/yyyy à HH:MM", () => {
    expect(frDateTime("2026-08-22T10:00")).toBe("22/08/2026 à 10:00");
    expect(frDateTime("2026-08-22 10:00:00+00")).toBe("22/08/2026 à 10:00");
  });

  it("an unrecognised value passes through rather than being mangled", () => {
    expect(frDateTime("dès que possible")).toBe("dès que possible");
  });

  it("no raw ISO timestamp reaches the page", () => {
    const out = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    expect(out).toContain("21/08/2026");
    expect(out).toContain("22/08/2026");
    expect(out).not.toContain("2026-08-21");
    expect(out).not.toContain("2026-08-22T10:00");
  });

  it("the conversion never uses a Date — determinism forbids a timezone", () => {
    const fn = code.slice(code.indexOf("export function frDateTime"), code.indexOf("const DATE_FIELDS"));
    expect(fn.length).toBeGreaterThan(50);
    expect(fn).not.toContain("new Date");
    expect(fn).not.toContain("toLocale");
  });
});

describe("UAT-18 — the guarantees that must survive a redesign", () => {
  it("rendering is still deterministic for the same snapshot", () => {
    const a = render_(EXTERNAL_SNAPSHOT, "NO_DRIVER");
    const b = render_(EXTERNAL_SNAPSHOT, "NO_DRIVER");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("no generation clock reaches the page", () => {
    expect(code).not.toContain("new Date()");
    expect(code).not.toContain("Date.now");
  });

  it("the renderer version was bumped, so old bytes stay explainable", () => {
    expect(RENDERER_VERSION).toBe("wes4g-2");
  });

  it("the carrier printed is the assignment SNAPSHOT", () => {
    const out = asText(render_(EXTERNAL_SNAPSHOT, "NO_DRIVER"));
    expect(out).toContain("UAT Transporteur SARL");
    expect(code).not.toContain("providerLabel");
  });

  it("DEMANDE_TRANSPORT keeps its flat layout", () => {
    expect(code).toContain("drawRows(rowsFor(LAYOUT[input.artifactCode] ?? []));");
  });
});
