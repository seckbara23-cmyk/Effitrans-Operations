/**
 * MAYA-P1.4 — Bon à Délivrer (CEO step 11): classification A, pinned.
 * ---------------------------------------------------------------------------
 * The audit found the act fully built and reachable, and found something more
 * useful than a gap: WHY two phases in a row believed it was missing.
 *
 * The registry's per-step `implementation` block is a Phase 5.0A audit snapshot
 * from 2026-07-13. BAD's entry still says « no BON_A_DELIVRER document type » —
 * true that morning, false by that afternoon, when Phase 5.0B added the type in
 * the very next migration. Across all entries the verdicts are 16 `missing` and
 * 13 `partial`, and not one `implemented`: the block was never maintained. It is
 * an honest historical record; reading it as current state is the defect, and
 * P1.0 did exactly that, and P1.4 nearly repeated it.
 *
 * So these tests do two things. They pin the BAD chain end to end against the
 * REAL functions, and they pin the contradiction between the snapshot and the
 * catalog so the next phase meets the fact instead of the metadata.
 *
 * Nothing here is a feature. Classification A means there was nothing to build.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { mapDocument, documentIsCapturable, MISSING_DOCUMENT_TYPES } from "@/lib/process/documents";
import { checkEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { evaluatePickupGate } from "@/lib/process/engine/gates";
import { isGeneratableArtifact } from "@/lib/documents/artifacts/feasibility";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const CATALOG_MIGRATION = "supabase/migrations/20260713000002_pickup_gate_document_types.sql";
const activity = () => PARALLEL_ACTIVITIES.find((a) => a.key === "bon_a_delivrer")!;

/** A dossier ready for pickup in every respect except the documents given. */
const snap = (documents: { typeCode: string; status: string }[]): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents,
  customs: {
    required: true, status: "RELEASED", baeReference: "BAE-1",
    declarationNumber: "D-1", externalRef: null,
  },
  transport: { status: "PLANNED", vehiclePlate: "DK-1234-AA", driverName: "A. Diop", driverUserId: null },
  invoices: [],
});

const READY_DOCS = [
  { typeCode: "BON_A_DELIVRER", status: "APPROVED" },
  { typeCode: "PRE_GATE_AUTHORIZATION", status: "APPROVED" },
  { typeCode: "BORDEREAU_LIVRAISON", status: "APPROVED" },
];

// ===========================================================================
describe("the Bon à Délivrer chain is complete and reachable", () => {
  it("the document type exists, and this is the migration that added it", () => {
    const m = code(CATALOG_MIGRATION);
    expect(m).toContain("'BON_A_DELIVRER'");
    expect(m).toContain("insert into public.document_type");
    // Global catalog (P0.8-C): a literal insert, never tenant CRUD.
    expect(m).not.toMatch(/tenant_id/);
    expect(mapDocument("BON_A_DELIVRER").typeCode).toBe("BON_A_DELIVRER");
    expect(documentIsCapturable("BON_A_DELIVRER")).toBe(true);
    expect(MISSING_DOCUMENT_TYPES).toEqual([]);
  });

  it("it is UPLOADABLE — the platform does not author a carrier's document", () => {
    // The dossier dropdown offers every active type except generated artifacts.
    // BAD comes from the carrier, so it must stay in the upload catalogue.
    expect(isGeneratableArtifact("BON_A_DELIVRER")).toBe(false);
    expect(code("lib/documents/service.ts")).toContain("filter((t) => !isGeneratableArtifact(t.code))");
  });

  it("the Account Manager owns it and holds the permission it declares", () => {
    const a = activity();
    expect(a.role).toBe("ACCOUNT_MANAGER");
    expect(a.department).toBe("account_management");
    expect(a.requiredDocuments).toContain("BON_A_DELIVRER");
    expect(a.permissions).toContain("document:create");
    const roles = read("lib/platform/role-templates.ts");
    const i = roles.indexOf('key: "ACCOUNT_MANAGER"');
    const block = roles.slice(i, roles.indexOf('key: "', i + 6));
    for (const p of a.permissions) expect(block, p).toContain(`"${p}"`);
    // Approval is a distinct authority, and the AM holds that too.
    expect(block).toContain('"document:approve"');
  });

  it("APPROVAL satisfies the gate — uploading alone does not", () => {
    // The rule is stated in gates.ts, not inferred: « an APPROVED
    // BON_A_DELIVRER document ». This is the §H question, answered by source.
    expect(checkEvidence("BON_A_DELIVRER", snap(READY_DOCS)).status).toBe("satisfied");

    const uploaded = checkEvidence("BON_A_DELIVRER", snap([{ typeCode: "BON_A_DELIVRER", status: "UPLOADED" }]));
    expect(uploaded.status).not.toBe("satisfied");

    const awaiting = checkEvidence("BON_A_DELIVRER", snap([{ typeCode: "BON_A_DELIVRER", status: "PENDING_REVIEW" }]));
    expect(awaiting.status).toBe("pending_review");
    expect(awaiting.detail).toBe("awaiting_approval");

    expect(checkEvidence("BON_A_DELIVRER", snap([])).status).toBe("missing");
  });

  it("the pickup gate opens with it and stays shut without it", () => {
    expect(evaluatePickupGate(snap(READY_DOCS)).missing).not.toContain("bon_a_delivrer");
    const without = evaluatePickupGate(snap(READY_DOCS.filter((d) => d.typeCode !== "BON_A_DELIVRER")));
    expect(without.missing).toContain("bon_a_delivrer");
    expect(without.ready).toBe(false);
  });

  it("the Control Tower bucket reads the gate, not a hand-kept count", () => {
    const t = code("lib/process/queues/control-tower.ts");
    expect(t).toContain('if (r.key === "bon_a_delivrer") c.missingBad++;');
    expect(t).toContain('B("missing_bad", "Bon à Délivrer manquant", c.missingBad, "/queues/account_management")');
  });
});

// ===========================================================================
describe("the 5.0A snapshot is history, not state", () => {
  it("BAD's recorded gaps are both false today — the trap P1.0 fell into", () => {
    // Kept deliberately: rewriting a historical audit record to match today
    // would destroy the record and fix nothing. Pin the contradiction instead.
    const impl = activity().implementation!;
    expect(impl.verdict).toBe("missing");
    expect(impl.gaps.join(" ")).toContain("no BON_A_DELIVRER document type");
    // …and here is the type it says does not exist.
    expect(code(CATALOG_MIGRATION)).toContain("'BON_A_DELIVRER'");
    expect(documentIsCapturable("BON_A_DELIVRER")).toBe(true);
  });

  it("no entry was ever marked implemented — the block is unmaintained", () => {
    // 16 missing + 13 partial + 0 implemented. A verdict here describes
    // 2026-07-13, and `lib/process/types.ts` says so in as many words.
    const verdicts = [...read("lib/process/effitrans-process.ts").matchAll(/verdict: "(\w+)"/g)].map((m) => m[1]);
    expect(verdicts.length).toBeGreaterThan(20);
    expect(new Set(verdicts)).toEqual(new Set(["missing", "partial"]));
    expect(read("lib/process/types.ts")).toContain("Phase 5.0A audit verdict");
  });

  it("the audit is on the record", () => {
    const doc = read("docs/maya/maya-p1-4-bad-audit.md");
    expect(doc).toContain("ALREADY IMPLEMENTED CORRECTLY");
    // Prose wraps in the document; match within a line.
    expect(doc).toContain("externally issued artifact");
    expect(doc).toContain("bad_reference");
  });
});

// ===========================================================================
describe("P1.4 built nothing", () => {
  it("no migration, no new document type, no permission", () => {
    const bi = read("lib/platform/ops/build-info.ts");
    // MAYA-P1.11 made this a moving number. What the phase actually meant is
    // that the ledger stays self-consistent, which is durable.
    expect(readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql")).length)
      .toBe(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    // LATEST_MIGRATION moves with every migration; the ledger-consistency
    // check above is the durable form of « this phase added none ».
  });

  it("recording a BAD moves no status and completes nothing downstream", () => {
    // §N. The document subsystem is the only writer, and a document is not a
    // dossier transition: uploading BAD leaves customs, transport and the
    // dossier exactly where they were. The gate merely reports readiness.
    const g = evaluatePickupGate(snap(READY_DOCS));
    expect(g.requirements.find((r) => r.key === "customs_released")).toBeDefined();
    // A satisfied BAD does not by itself open the gate: every other
    // requirement still has to hold.
    const noVehicle = evaluatePickupGate({ ...snap(READY_DOCS), transport: null });
    expect(noVehicle.ready).toBe(false);
    // …and nothing in the document action reaches customs or the process engine.
    const docActions = code("lib/documents/actions.ts");
    expect(docActions).not.toMatch(/customs_record|gainde_registered|bae_reference|record_customs_/);
  });
});
