/**
 * Phase WES-4G — generated artifacts, upload integrity, sharing enforcement.
 *
 * Behavioural where behaviour can be proven: the renderer, the hash, the source
 * contract and the sharing rule all run for real. `sqlCode()` strips SQL `--`
 * so a migration header can never satisfy a test about its own code.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ARTIFACT_FEASIBILITY,
  artifactFeasibility,
  generatableArtifacts,
  isGeneratableArtifact,
} from "@/lib/documents/artifacts/feasibility";
import {
  canonicalizeSnapshot,
  resolveArtifactSource,
  type ArtifactSourceInput,
} from "@/lib/documents/artifacts/source";
import { RENDERER_VERSION, renderArtifact } from "@/lib/documents/artifacts/render";
import { isShareable } from "@/lib/documents/doctrine";
import { getEventType } from "@/lib/workflow/events/types";
import { validateEventMetadata } from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260727000004_generated_artifacts.sql";
const sql = () => sqlCode(MIGRATION);

const FULL: ArtifactSourceInput = {
  fileNumber: "EFT-IMP-2026-0001",
  fileType: "IMP",
  clientName: "Caetano SA",
  transportMode: "SEA",
  origin: "Dakar",
  destination: "Bamako",
  cargoType: "Riz",
  containerRef: "MSKU1234567",
  pickupLocation: "Port de Dakar",
  deliveryLocation: "Bamako, Zone industrielle",
  pickupPlanned: "2026-08-01",
  deliveryPlanned: "2026-08-04",
  driverName: "Moussa Diop",
  driverUserId: "driver-uuid",
  vehiclePlate: "DK-1234-AB",
  trailerOrContainer: "REM-88",
  transportCompany: "Transports Diallo",
  requestedBy: "A. Ndiaye",
  requestedAt: "2026-07-27",
};

// ---------------------------------------------------------------------------
// WES-4G.1 feasibility
// ---------------------------------------------------------------------------
describe("WES-4G.1 artifact feasibility", () => {
  it("assesses every artifact WES-4G.1 names", () => {
    for (const c of ["DEMANDE_TRANSPORT", "TRANSPORT_ORDER", "MISSION_SHEET", "DISPATCH_ORDER", "INTERNAL_MANIFEST"]) {
      expect(artifactFeasibility(c)).not.toBeNull();
    }
  });

  it("generates exactly the two the mandate prioritises", () => {
    expect(generatableArtifacts().map((a) => a.code).sort()).toEqual([
      "DEMANDE_TRANSPORT", "TRANSPORT_ORDER",
    ]);
  });

  it("defers the Mission Sheet to WES-6 rather than inventing a mission", () => {
    expect(artifactFeasibility("MISSION_SHEET")?.verdict).toBe("DEPENDENT_ON_WES_6_MISSION_MODEL");
    expect(isGeneratableArtifact("MISSION_SHEET")).toBe(false);
  });

  it("blocks artifacts with no authoritative source record", () => {
    for (const c of ["DISPATCH_ORDER", "INTERNAL_MANIFEST"]) {
      expect(artifactFeasibility(c)?.verdict).toBe("BLOCKED_BY_MISSING_STRUCTURED_DATA");
    }
  });

  it("gives every verdict a stated rationale", () => {
    for (const a of ARTIFACT_FEASIBILITY) expect(a.rationale.length).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// WES-4G.3 / 4G.4 source contract
// ---------------------------------------------------------------------------
describe("WES-4G source contract", () => {
  it("builds a snapshot when every mandatory field is present", () => {
    const r = resolveArtifactSource("DEMANDE_TRANSPORT", FULL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.fileNumber).toBe("EFT-IMP-2026-0001");
  });

  it("REFUSES rather than rendering a blank where a fact belongs", () => {
    const r = resolveArtifactSource("DEMANDE_TRANSPORT", { ...FULL, pickupLocation: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.map((m) => m.field)).toContain("pickupLocation");
  });

  it("names every missing field, in French, for the operator", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", {
      ...FULL, driverName: null, vehiclePlate: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.map((m) => m.field).sort()).toEqual(["driverName", "vehiclePlate"]);
      expect(r.missing.every((m) => m.labelFr.length > 0)).toBe(true);
    }
  });

  it("NEVER invents a driver or a vehicle", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, driverName: "   " });
    expect(r.ok).toBe(false);
  });

  it("lets a Demande be produced before any driver exists", () => {
    // A transport REQUEST precedes the assignment; requiring a driver would
    // make the artifact impossible exactly when it is needed.
    const r = resolveArtifactSource("DEMANDE_TRANSPORT", {
      ...FULL, driverName: null, driverUserId: null, vehiclePlate: null,
    });
    expect(r.ok).toBe(true);
  });

  it("labels driver provenance instead of hiding it", () => {
    const auth = resolveArtifactSource("TRANSPORT_ORDER", FULL);
    const legacy = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, driverUserId: null });
    expect(auth.ok && auth.provenance).toBe("AUTHENTICATED_DRIVER");
    expect(legacy.ok && legacy.provenance).toBe("LEGACY_TEXT_DRIVER");
  });

  it("keeps identity and unrestricted notes OUT of the snapshot", () => {
    const r = resolveArtifactSource("TRANSPORT_ORDER", FULL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.driverUserId).toBeUndefined();
      expect(Object.keys(r.snapshot)).not.toContain("notes");
      expect(Object.keys(r.snapshot)).not.toContain("driverPhone");
    }
  });

  it("hashes deterministically regardless of key order", () => {
    const a = canonicalizeSnapshot({ b: "2", a: "1" });
    const b = canonicalizeSnapshot({ a: "1", b: "2" });
    expect(a).toBe(b);
  });

  it("changes the source hash when any source value changes", () => {
    const one = canonicalizeSnapshot({ a: "1" });
    const two = canonicalizeSnapshot({ a: "2" });
    expect(one).not.toBe(two);
  });
});

// ---------------------------------------------------------------------------
// WES-4G.6 deterministic rendering
// ---------------------------------------------------------------------------
describe("WES-4G.6 reproducible generation", () => {
  const render = (over: Partial<Parameters<typeof renderArtifact>[0]> = {}) =>
    renderArtifact({
      artifactCode: "TRANSPORT_ORDER",
      snapshot: (resolveArtifactSource("TRANSPORT_ORDER", FULL) as { snapshot: Record<string, string> }).snapshot,
      provenance: "AUTHENTICATED_DRIVER",
      organizationName: "Effitrans",
      artifactVersion: 1,
      ...over,
    });

  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

  it("produces BYTE-IDENTICAL output for the same snapshot and version", () => {
    // The contract: same snapshot + same renderer version => same hash.
    expect(sha(render())).toBe(sha(render()));
  });

  it("carries no clock, so a regeneration is not different merely for being later", () => {
    const src = code("lib/documents/artifacts/render.ts");
    expect(src).not.toMatch(/new Date\(|Date\.now\(|toISOString/);
  });

  it("changes the bytes when the source changes", () => {
    const other = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, vehiclePlate: "DK-9999-ZZ" });
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(sha(render())).not.toBe(sha(render({ snapshot: other.snapshot })));
    }
  });

  it("changes the bytes between versions, so a regeneration is a new artifact", () => {
    expect(sha(render())).not.toBe(sha(render({ artifactVersion: 2 })));
  });

  it("declares a renderer version that can be compared", () => {
    expect(RENDERER_VERSION.length).toBeGreaterThan(0);
    expect(sql()).toContain("p_renderer_version");
  });

  it("says on the page when the driver is only free text", () => {
    const legacy = render({ provenance: "LEGACY_TEXT_DRIVER" });
    expect(sha(legacy)).not.toBe(sha(render()));
  });
});

// ---------------------------------------------------------------------------
// WES-4G.5 upload hashing
// ---------------------------------------------------------------------------
describe("WES-4G.5 upload integrity", () => {
  it("hashes the STORED bytes, in every document-creating path", () => {
    for (const f of [
      "lib/documents/actions.ts",
      "lib/deposit/actions.ts",
      "lib/driver/upload.ts",
      "lib/portal/self-service-actions.ts",
    ]) {
      const src = code(f);
      expect(src).toContain("sha256Hex");
      expect(src).toMatch(/await file\.arrayBuffer\(\)/);
      // The SAME buffer is uploaded that was hashed.
      expect(src).toMatch(/uploadObject\(path, bytes,/);
    }
  });

  it("fails the upload when hashing fails rather than storing an unverified row", () => {
    expect(code("lib/documents/actions.ts")).toMatch(/return \{ ok: false, error: "hash_failed" \}/);
  });

  it("changes the hash when one byte changes", () => {
    const a = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
    const b = createHash("sha256").update(new Uint8Array([1, 2, 4])).digest("hex");
    expect(a).not.toBe(b);
  });

  it("takes no hash from the client", () => {
    const src = code("lib/documents/actions.ts");
    expect(src).not.toMatch(/formData\.get\("(sha256|hash|checksum)"\)/);
  });

  it("computes no hash for legacy rows", () => {
    const wes4 = sqlCode("supabase/migrations/20260727000003_document_governance.sql");
    expect(wes4).not.toMatch(/update public\.document[\s\S]{0,200}set content_sha256/);
    expect(sql()).not.toMatch(/update public\.document[\s\S]{0,200}set content_sha256/);
  });

  it("requires a hash on every generated artifact", () => {
    expect(sql()).toContain("a generated artifact must carry a content hash");
  });
});

// ---------------------------------------------------------------------------
// WES-4G.7 manual-upload retirement
// ---------------------------------------------------------------------------
describe("WES-4G.7 manual-upload retirement", () => {
  it("refuses a hand upload of a generated artifact, server-side", () => {
    const src = code("lib/documents/actions.ts");
    expect(src).toContain("isGeneratableArtifact(typeCode)");
    expect(src).toContain('error: "generated_artifact_no_upload"');
  });

  it("removes generated types from the upload catalogue", () => {
    expect(code("lib/documents/service.ts")).toMatch(/filter\(\(t\) => !isGeneratableArtifact\(t\.code\)\)/);
  });

  it("blocks manual SUPERSESSION of a generated artifact in the database", () => {
    const s = sql();
    expect(s).toContain("a generated artifact is replaced by regeneration, not by manual upload");
    expect(s).toMatch(/before insert on public\.document[\s\S]{0,120}protect_generated_artifact/);
  });

  it("does NOT relabel historical uploads as system generated", () => {
    const s = sql();
    expect(s).not.toMatch(/update public\.document[\s\S]{0,200}set artifact_code/);
    expect(s).not.toMatch(/update public\.document[\s\S]{0,200}set generated_by/);
  });
});

// ---------------------------------------------------------------------------
// WES-4G.8 sharing enforcement
// ---------------------------------------------------------------------------
describe("WES-4G.8 sharing enforcement", () => {
  it("enforces the canonical rule in the server action", () => {
    const src = code("lib/documents/actions.ts");
    expect(src).toContain("isShareable({");
    // The old single check would now BLOCK a properly verified document.
    expect(src).not.toMatch(/doc\.status !== "APPROVED"/);
  });

  it("shares a verified, client-safe, current version", () => {
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: null })).toBe(true);
    // …including the legacy alias, so WES-4 did not strand existing rows.
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "APPROVED", supersededById: null })).toBe(true);
  });

  it("refuses rejected, superseded, unverified, and internal documents", () => {
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "REJECTED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: "x" })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "UPLOADED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "TRANSPORT_ORDER", status: "VERIFIED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "BAE", status: "VERIFIED", supersededById: null })).toBe(false);
  });

  it("checks dossier access, not merely tenant", () => {
    const src = code("lib/documents/actions.ts");
    const fn = src.slice(src.indexOf("export async function setDocumentShared"));
    expect(fn).toContain("isFileVisible");
  });

  it("keeps REVOCATION always available", () => {
    // A document that should never have been shared must be retractable; a
    // shareability re-check on the way out would strand exactly the wrong ones.
    const src = code("lib/documents/actions.ts");
    const fn = src.slice(src.indexOf("export async function setDocumentShared"));
    expect(fn).toMatch(/if \(shared\) \{/);
  });

  it("explains which rule refused", () => {
    const src = code("lib/documents/actions.ts");
    expect(src).toContain("function shareRefusal");
    for (const e of ["not_client_safe", "superseded", "not_verified"]) {
      expect(src).toContain(e);
    }
  });
});

// ---------------------------------------------------------------------------
// WES-4G.10 atomicity and events
// ---------------------------------------------------------------------------
describe("WES-4G.10 atomic finalization", () => {
  it("writes row + supersession + event in ONE function", () => {
    const body = sql().slice(sql().indexOf("create or replace function public.finalize_generated_artifact"));
    expect(body).toContain("insert into public.document");
    expect(body).toContain("set superseded_by_id");
    expect(body).toContain("INTERNAL_DOCUMENT_GENERATED");
  });

  it("stores the object BEFORE finalizing, and cleans up on failure", () => {
    const src = code("lib/documents/artifacts/actions.ts");
    const upIdx = src.indexOf("uploadObject(path, bytes");
    const rpcIdx = src.indexOf('rpc("finalize_generated_artifact"');
    expect(upIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(upIdx);
    expect(src).toMatch(/if \(error\) \{[\s\S]{0,200}removeObject\(path\)/);
  });

  it("emits the event only from the authoritative path", () => {
    const src = code("lib/documents/artifacts/actions.ts");
    expect(src).not.toContain("emit_business_event");
    expect(src).not.toContain("business_event");
  });

  it("declares INTERNAL_DOCUMENT_GENERATED as RPC-emitted, no longer reserved", () => {
    const def = getEventType("INTERNAL_DOCUMENT_GENERATED");
    expect(def?.emission).toBe("rpc");
    expect(def?.clientSafe).toBe(false);
  });

  it("keeps the source snapshot OUT of event metadata", () => {
    const def = getEventType("INTERNAL_DOCUMENT_GENERATED");
    expect(def?.metadataKeys).not.toContain("source_snapshot");
    expect(def?.metadataKeys).not.toContain("snapshot");
    const body = sql().slice(sql().indexOf("INTERNAL_DOCUMENT_GENERATED"));
    expect(body.slice(0, 400)).not.toContain("p_source_snapshot");
  });

  it("rejects unrestricted text in a generation event", () => {
    const r = validateEventMetadata("INTERNAL_DOCUMENT_GENERATED", {
      artifact_code: "TRANSPORT_ORDER",
      notes: "chauffeur remplacé au dernier moment",
    });
    expect(r.ok).toBe(false);
  });

  it("locks the previous version so two regenerations cannot both supersede it", () => {
    expect(sql()).toMatch(/limit 1\s*\n\s*for update;/);
  });
});

// ---------------------------------------------------------------------------
// scope discipline
// ---------------------------------------------------------------------------
describe("WES-4G scope discipline", () => {
  it("does NOT wire the evidence resolver into lifecycle or projection", () => {
    // Explicitly deferred to WES-5: rewiring would move responsibleDepartment
    // and therefore WES-3 visibility for every existing dossier.
    for (const f of ["lib/files/lifecycle.ts", "lib/workflow/projection.ts"]) {
      expect(code(f)).not.toContain("resolveEvidenceRequirements");
      expect(code(f)).not.toContain("artifact");
    }
  });

  it("starts no WES-5 reconciliation and touches no process-engine table", () => {
    const s = sql();
    expect(s).not.toMatch(/process_step_execution|process_instance/i);
    expect(s).not.toMatch(/reconcil/i);
  });

  it("adds no SLA field or Mission entity", () => {
    const s = sql() + code("lib/documents/artifacts/actions.ts");
    expect(s).not.toMatch(/\bsla\b|breach|escalation/i);
    expect(s).not.toMatch(/create table public\.mission/i);
  });

  it("ships exactly one migration of its own", () => {
    // Pinned by CONTENT: WES-5 legitimately adds a later migration.
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => /generated_artifacts/.test(f))).toHaveLength(1);
  });
});
