/**
 * MAYA-P1.7 — the Control Tower counted work on closed dossiers.
 * ---------------------------------------------------------------------------
 * PRODUCTION EVIDENCE. `EFT-IMP-2026-00003` is settled, delivered and CLOSED,
 * and it was still incrementing « Bon à Délivrer manquant » in the Coordinator's
 * tower. The count was asking for work nobody can do: the dossier is closed.
 *
 * WHY. `getProcessTower` scoped on `process_instance.status <> 'CANCELLED'` and
 * never read `operational_file.status` at all — it did not even fetch the file
 * rows. So its population was "every process instance that was not cancelled",
 * which is not the same set as "dossiers the company is still carrying".
 *
 * The fix is not a new idea. DEC-B43 (Phase 10.0D-1, ratified 2026-07-24)
 * already defines an active dossier and says so in its own words: « No other
 * module may re-derive "active" from status literals; they import this
 * predicate. » The tower was the module that had not. Now it does — ONCE, at the
 * population, before any bucket is evaluated, and the linked queues use the same
 * rule so a tower count and its queue cannot disagree.
 *
 * WHAT DID NOT CHANGE: the buckets, the gate, the evidence rules, closure, QC,
 * and every historical surface. A closed dossier is still fully readable; it is
 * simply not outstanding work.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FILE_STATUSES, TERMINAL_FILE_STATUSES, isActiveFileStatus } from "@/lib/files/status";
import { isActiveFile } from "@/lib/files/filter";
import { evaluatePickupGate } from "@/lib/process/engine/gates";
import type { EvidenceSnapshot } from "@/lib/process/engine/evidence";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TOWER = "lib/process/queues/control-tower.ts";
const QUEUE = "lib/process/queues/service.ts";

/** EFT-IMP-2026-00003's shape: everything done except BAD and pre-gate. */
const closedDossierSnap = (): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: { required: true, status: "RELEASED", baeReference: "BAE-1", declarationNumber: "D-1", externalRef: null },
  transport: { status: "POD_RECEIVED", vehiclePlate: "DK-1234-AA", driverName: "A. Diop", driverUserId: null },
  invoices: [],
});

// ===========================================================================
describe("the terminal-state matrix comes from ONE ratified predicate", () => {
  it("terminal is CLOSED and CANCELLED; everything else is active work", () => {
    expect([...TERMINAL_FILE_STATUSES].sort()).toEqual(["CANCELLED", "CLOSED"]);
    for (const s of FILE_STATUSES) {
      const terminal = (TERMINAL_FILE_STATUSES as readonly string[]).includes(s);
      expect(isActiveFileStatus(s), s).toBe(!terminal);
    }
    // DELIVERED is NOT terminal — the dossier is carried until formal closure.
    expect(isActiveFileStatus("DELIVERED")).toBe(true);
    expect(isActiveFileStatus("DRAFT")).toBe(true);
  });

  it("an unrecognised status stays IN — a workload tower never hides work", () => {
    // Fail-open is the correct direction here: showing a dossier that might not
    // need work costs a glance; hiding one that does costs the work.
    expect(isActiveFile("SOMETHING_NEW")).toBe(true);
    expect(isActiveFile("CLOSED")).toBe(false);
    expect(isActiveFile("CANCELLED")).toBe(false);
  });

  it("the tower and the queue both IMPORT it rather than re-deriving it", () => {
    // DEC-B43's own instruction. Literals here would be a second definition.
    for (const f of [TOWER, QUEUE]) {
      expect(code(f), f).toContain('from "@/lib/files/filter"');
      expect(code(f), f).toContain("isActiveFile(");
      expect(code(f), `${f} must not re-derive terminal states`).not.toMatch(/status !== "CLOSED"|status === "CLOSED"/);
    }
  });
});

// ===========================================================================
describe("the boundary is the population, applied once", () => {
  it("the tower reads the dossier status it previously ignored", () => {
    const t = code(TOWER);
    expect(t).toContain('scopedFrom(admin, "operational_file", tenantId).select("id, status")');
    expect(t).toContain("const activeFileIds = new Set(");
  });

  it("terminal dossiers are dropped BEFORE any bucket is evaluated", () => {
    const t = code(TOWER);
    const loop = t.slice(t.indexOf("for (const inst of instances)"));
    const guard = loop.indexOf("if (!activeFileIds.has(fileId)) continue;");
    expect(guard).toBeGreaterThan(-1);
    // Every bucket is computed after the guard — none before it.
    for (const bucket of ["c.missingBad++", "c.waitingGaindeRegistration++", "c.baeMissing++", "c.deliveredNoPod++"]) {
      expect(loop.indexOf(bucket), bucket).toBeGreaterThan(guard);
    }
  });

  it("the bucket loop checks it ONCE, not per bucket", () => {
    // Fifteen copies of a semantic is fifteen chances to drift. The set is also
    // used once OUTSIDE the loop to derive the instance ids for handoffs, which
    // is the same boundary expressed for a different collection — not a copy.
    const t = code(TOWER);
    const loop = t.slice(t.indexOf("for (const inst of instances)"));
    expect((loop.match(/activeFileIds\.has\(/g) ?? []).length).toBe(1);
    expect((t.match(/activeFileIds\.has\(/g) ?? []).length).toBe(2);
  });

  it("handoff counts follow the same population", () => {
    const t = code(TOWER);
    expect(t).toContain("activeInstanceIds.has(h.process_instance_id as string)");
    const h = t.slice(t.indexOf("const handoffs ="));
    expect(h.slice(0, 400)).toContain("activeInstanceIds");
  });

  it("the linked queues use the same rule, so counts cannot diverge", () => {
    const q = code(QUEUE);
    expect(q).toContain('.select("id, file_number, type, client_id, priority, status")');
    expect(q).toMatch(/filter\(\(f\) => isActiveFile\(String\(f\.status\)\)\)/);
    // The existing scope guard drops those rows — no second mechanism.
    expect(q).toContain("if (!file) continue;");
  });
});

// ===========================================================================
describe("what a closed dossier stops doing — and what it keeps", () => {
  it("the gate itself is unchanged: a LIVE dossier missing BAD still counts", () => {
    // The fix is population, not evidence. This is the exact shape of
    // EFT-IMP-2026-00003, and the gate must still report it as unready.
    const g = evaluatePickupGate(closedDossierSnap());
    expect(g.missing).toContain("bon_a_delivrer");
    expect(g.missing).toContain("pre_gate");
    expect(g.ready).toBe(false);
    // …which is exactly why the tower counted it. The dossier's status, not the
    // gate's verdict, is what makes it stop being work.
    expect(isActiveFile("CLOSED")).toBe(false);
  });

  it("bucket logic, gate and evidence rules were not touched", () => {
    const t = code(TOWER);
    expect(t).toContain('if (r.key === "bon_a_delivrer") c.missingBad++;');
    expect(t).toContain('if (isOpenAt(execs, "gainde_registration")) c.waitingGaindeRegistration++;');
    expect(t).toContain("evaluatePickupGate(snap, views)");
    expect(t).toContain('.neq("status", "CANCELLED")'); // the pre-existing instance filter stays
  });

  it("historical surfaces are untouched — this is not an archive phase", () => {
    // Closed dossiers stay readable: the dossier page, search, audit and the
    // KPI aggregates keep their own rules. P1.7 changed two work surfaces.
    for (const f of ["lib/files/service.ts", "lib/audit/read.ts"]) {
      expect(code(f), f).not.toContain("activeFileIds");
    }
    // The KPI layer already had its own DEC-B43 usage; it is not this phase's.
    expect(code("lib/files/aggregate.ts")).toContain("isActiveFileStatus");
  });

  it("closure, QC and rattachement are all unchanged", () => {
    expect(code("lib/files/closure.ts")).toContain("payment_unverified");
    expect(code("lib/files/qc4.ts")).toContain("QC4_NO_CHECKLIST");
    expect(code("lib/process/effitrans-process.ts")).not.toContain("rattachement_completed_at");
    const bi = read("lib/platform/ops/build-info.ts");
    expect(bi).toContain("MIGRATION_COUNT = 105");
  });

  it("tenant scoping is unchanged on both surfaces", () => {
    // The new read goes through the same tenant-scoped helper as every other.
    expect(code(TOWER)).toContain('scopedFrom(admin, "operational_file", tenantId)');
    expect(code(QUEUE)).toContain('scopedFrom(admin, "operational_file", req.tenantId)');
    expect(code(QUEUE)).toContain("resolveFileScope(");
  });
});
