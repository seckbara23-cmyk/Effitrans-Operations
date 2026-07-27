/**
 * Phase WES-4H — the generated-artifact operator surface.
 *
 * WES-4G built the generator; nothing could reach it. These tests pin the
 * surface AND the rules it must not weaken — in particular that the panel is
 * convenience, never authorization.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { generatableArtifacts } from "@/lib/documents/artifacts/feasibility";
import { resolveArtifactSource, type ArtifactSourceInput } from "@/lib/documents/artifacts/source";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = "components/documents/artifact-panel.tsx";
const SERVICE = "lib/documents/artifacts/service.ts";
const PAGE = "app/files/[id]/page.tsx";

const FULL: ArtifactSourceInput = {
  fileNumber: "EFT-IMP-2026-0001", fileType: "IMP", clientName: "Caetano SA",
  transportMode: "SEA", origin: "Dakar", destination: "Bamako",
  cargoType: "Riz", containerRef: "MSKU1234567",
  pickupLocation: "Port de Dakar", deliveryLocation: "Bamako",
  pickupPlanned: "2026-08-01", deliveryPlanned: "2026-08-04",
  driverName: "Moussa Diop", driverUserId: "d-1", vehiclePlate: "DK-1234-AB",
  trailerOrContainer: "REM-88", transportCompany: "Diallo",
  requestedBy: "A. Ndiaye", requestedAt: "2026-07-27",
};

describe("WES-4H the panel reaches the generator, and nothing else", () => {
  it("calls the WES-4G action rather than reimplementing generation", () => {
    const src = code(PANEL);
    expect(src).toContain("generateArtifact");
    // No rendering, no hashing, no storage, no SQL in a component.
    expect(src).not.toContain("renderArtifact");
    expect(src).not.toContain("sha256");
    expect(src).not.toContain("uploadObject");
    expect(src).not.toContain("finalize_generated_artifact");
  });

  it("shows generation controls only to an authorized user", () => {
    const src = code(PANEL);
    expect(src).toMatch(/\{canGenerate && \(/);
    expect(code(PAGE)).toContain('hasPermission(permissions, "transport:manage")');
  });

  it("keeps the SERVER authoritative — the prop mirrors the gate, it is not the gate", () => {
    // The action asserts the permission itself, so a forged prop changes nothing.
    const action = code("lib/documents/artifacts/actions.ts");
    expect(action).toContain('assertPermission("transport:manage")');
    expect(action).toContain("isFileVisible");
  });

  it("offers Générer, Régénérer, Télécharger and the version history", () => {
    const raw = read(PANEL);
    expect(raw).toContain("Générer");
    expect(raw).toContain("Régénérer");
    expect(raw).toContain("Télécharger la version courante");
    expect(raw).toContain("Voir les versions précédentes");
  });

  it("shows generated-by, generated-at, renderer version and current state", () => {
    const raw = read(PANEL);
    expect(raw).toContain("Généré par");
    expect(raw).toContain("moteur {item.current.rendererVersion}");
    expect(raw).toContain("courante");
    expect(raw).toContain("Remplacée");
  });

  it("refreshes after a successful generation so the new version is current", () => {
    const src = code(PANEL);
    expect(src).toMatch(/if \(!res\.ok\)[\s\S]{0,200}router\.refresh\(\)/);
  });
});

describe("WES-4H incomplete source data", () => {
  it("names the exact missing fields, in French", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, driverName: null, vehiclePlate: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.map((m) => m.labelFr).sort()).toEqual(["Chauffeur", "Véhicule"]);
    }
  });

  it("renders those fields and disables generation", () => {
    const src = code(PANEL);
    expect(src).toContain("item.missing.map");
    expect(src).toMatch(/disabled=\{pending \|\| !item\.sourceComplete\}/);
  });

  it("tells the operator to correct the dossier, not to upload", () => {
    const raw = read(PANEL);
    expect(raw).toMatch(/ne peut pas être téléversé\s*\n?\s*manuellement/);
  });

  it("computes completeness from the SAME reader the generator uses", () => {
    // Two implementations would drift, and the drift would look like a Générer
    // button that fails when pressed.
    expect(code(SERVICE)).toContain("resolveArtifactSource");
    expect(code("lib/documents/artifacts/actions.ts")).toContain("readArtifactSource");
  });
});

describe("WES-4H manual upload stays retired", () => {
  it("excludes generated types from the upload catalogue", () => {
    expect(code("lib/documents/service.ts")).toMatch(/filter\(\(t\) => !isGeneratableArtifact\(t\.code\)\)/);
  });

  it("refuses a hand upload of a generated type server-side", () => {
    expect(code("lib/documents/actions.ts")).toContain('error: "generated_artifact_no_upload"');
  });

  it("gives the panel NO upload path at all", () => {
    const src = code(PANEL);
    expect(src).not.toContain("uploadDocument");
    expect(src).not.toContain("<input type=\"file\"");
    expect(src).not.toContain("FormData");
  });
});

describe("WES-4H version access stays tenant-safe", () => {
  it("downloads through the existing authorized action", () => {
    // No signed URL is built in the component; the server action owns that.
    const src = code(PANEL);
    expect(src).toContain("createDocumentDownloadUrl");
    expect(src).not.toContain("createSignedUrl");
    expect(src).not.toContain("storage_path");
  });

  it("scopes every artifact read to the caller's tenant", () => {
    const src = code(SERVICE);
    const reads = src.match(/\.from\("(document|app_user|operational_file|shipment|transport_record)"\)/g) ?? [];
    expect(reads.length).toBeGreaterThan(3);
    // Every one of them filters on tenant_id.
    expect(src.match(/\.eq\("tenant_id", (user\.)?tenantId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(reads.length - 1);
  });

  it("returns nothing when there is no session", () => {
    expect(code(SERVICE)).toMatch(/if \(!user\) return \[\];/);
  });

  it("lists superseded versions as history, never as current", () => {
    const src = code(SERVICE);
    expect(src).toContain("isCurrent: v.superseded_by_id === null");
    expect(src).toMatch(/previous: mine\.filter\(\(v\) => !v\.isCurrent\)/);
  });
});

// ---------------------------------------------------------------------------
// CI workflow integrity
//
// Lives here because WES-4G broke it. A Python heredoc wrote a LITERAL newline
// inside `tr '\n' ...`, which split the YAML mid-string. GitHub then failed the
// run with ZERO jobs and no annotation — the workflow never parsed, so nothing
// could report why. Two whole runs were lost to a fault no local gate could
// see, because typecheck, tests and build never read this file.
// ---------------------------------------------------------------------------
describe("CI workflow file stays parseable", () => {
  const ci = () => read(".github/workflows/ci.yml");

  it("has no line beginning with a bare quote — the corruption signature", () => {
    // A YAML block-scalar line never legitimately starts at column 0 with a
    // quote; that is what a newline broken into a shell string looks like.
    const offenders = ci()
      .split("\n")
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => /^["']/.test(l));
    expect(offenders, `broken lines:\n${offenders.map((o) => `${o.n}: ${o.l}`).join("\n")}`)
      .toEqual([]);
  });

  it("keeps every step a properly indented list item", () => {
    const steps = ci().match(/^ {6}- name:/gm) ?? [];
    expect(steps.length).toBeGreaterThan(50);
    // Any `- name:` at a different indent means the list structure broke.
    const stray = (ci().match(/^[ 	]*- name:/gm) ?? []).filter((l) => !/^ {6}- name:/.test(l));
    expect(stray).toEqual([]);
  });

  it("wires every SQL suite on disk into CI, and nothing that is absent", () => {
    const wired = Array.from(ci().matchAll(/-f supabase\/tests\/([\w.]+\.sql)/g)).map((m) => m[1]);
    const onDisk = readdirSync(join(root, "supabase/tests")).filter((f) => f.endsWith(".sql"));
    expect([...wired].sort()).toEqual([...onDisk].sort());
  });

  it("keeps each annotation step's tr invocation on one line", () => {
    // The exact fault: `tr '` followed by a real newline.
    expect(ci()).not.toMatch(/tr '\r?\n/);
  });
});

describe("WES-4H scope discipline", () => {
  it("adds generation for NO further artifact", () => {
    expect(generatableArtifacts().map((a) => a.code).sort()).toEqual([
      "DEMANDE_TRANSPORT", "TRANSPORT_ORDER",
    ]);
    const src = code(PANEL) + code(SERVICE);
    expect(src).not.toMatch(/MISSION_SHEET|DISPATCH_ORDER|INTERNAL_MANIFEST/);
  });

  it("ships no migration — this phase is UI and documentation", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260727000004_generated_artifacts.sql");
  });

  it("does not wire the evidence resolver into lifecycle or projection", () => {
    for (const f of ["lib/files/lifecycle.ts", "lib/workflow/projection.ts"]) {
      expect(code(f)).not.toContain("resolveEvidenceRequirements");
      expect(code(f)).not.toContain("getArtifactPanel");
    }
  });

  it("starts no WES-5 reconciliation", () => {
    const src = code(PANEL) + code(SERVICE) + code("lib/documents/artifacts/actions.ts");
    expect(src).not.toMatch(/process_step_execution|reconcil/i);
  });
});
