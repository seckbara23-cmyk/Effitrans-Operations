/**
 * OPS-OWNERSHIP-01 — Operations intake is an evidence-backed assignment control.
 * ---------------------------------------------------------------------------
 * THE RATIFIED CIRCUIT (K1, 2026-09-05):
 *
 *     Commercial → Intake Opérations → Account Manager → Coordinateur → Transit
 *
 * Two first-party documents disagreed about the direction — the Quality Manual
 * named « transmission aux opérations » (the reverse), the Processus Opérationnel
 * ran this way. The business ruled; the disagreement is preserved rather than
 * deleted, and a test below pins that it stays preserved.
 *
 * WHAT THIS SLICE MADE TRUE (K3, K7):
 *   * step 2's authority is `file:assign:commercial`, not the deprecated
 *     `file:assign` lane an Account Manager also holds;
 *   * step 2 cannot be submitted until a GOVERNED designation exists — the
 *     current `account_manager_id` must appear in the immutable COMMERCIAL_OWNER
 *     assignment history, so the column alone never satisfies it.
 *
 * The lettered cases are the ratification's own mandatory list (A–J).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkEvidence, evaluateStepEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { EFFITRANS_PROCESS, getStep } from "@/lib/process/effitrans-process";
import { mapDocument } from "@/lib/process/documents";
import {
  AM_ASSIGNMENT_REQUIRED_FILE_TYPES,
  amAssignmentRequiredForFileType,
  STEP_APPLICABILITY,
} from "@/lib/process/applicability";
import {
  DECLARABLE_EVIDENCE_KEYS,
  NON_DECLARABLE_EVIDENCE_KEYS,
  isDeclarableEvidence,
} from "@/lib/process/evidence-absence";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { ROLE_MAPPINGS } from "@/lib/process/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const KEY = "ACCOUNT_MANAGER_ASSIGNMENT";
const AM = "user-am-1";

/** A snapshot carrying only what this evidence key reads. */
const snap = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: null,
  transport: null,
  invoices: [],
  ...over,
});

const perms = (r: string) =>
  TENANT_ROLE_TEMPLATES.find((t) => t.key === r)!.permissions as readonly string[];

// ═══════════ A–C · the completion invariant ════════════════════════════════

describe("OPS-OWNERSHIP-01 — step 2 completes only on governed assignment", () => {
  it("A — IMP with no Account Manager: evidence_missing ACCOUNT_MANAGER_ASSIGNMENT", () => {
    const ev = evaluateStepEvidence("operations_intake", snap({
      commercialOwner: { accountManagerId: null, governedUserIds: [] },
    }));
    expect(ev.missing).toContain(KEY);
    expect(ev.complete).toBe(false);
    expect(ev.items.find((i) => i.key === KEY)!.detail).toBe("no_account_manager");
  });

  it("B — column populated but NO matching governed event: refused", () => {
    // The heart of K3: proof is the immutable history, not a nullable value.
    // A column carrying a user no COMMERCIAL_OWNER event ever named must not
    // satisfy the step — otherwise `assign_commercial_owner` is merely the only
    // writer today rather than the only way to satisfy it.
    const ev = evaluateStepEvidence("operations_intake", snap({
      commercialOwner: { accountManagerId: AM, governedUserIds: [] },
    }));
    expect(ev.missing).toContain(KEY);
    expect(ev.items.find((i) => i.key === KEY)!.detail).toBe("no_governed_assignment");
  });

  it("B2 — an event naming a DIFFERENT user does not satisfy it either", () => {
    const ev = evaluateStepEvidence("operations_intake", snap({
      commercialOwner: { accountManagerId: AM, governedUserIds: ["someone-else"] },
    }));
    expect(ev.missing).toContain(KEY);
  });

  it("C — current AM present in the governed history: allowed", () => {
    const ev = evaluateStepEvidence("operations_intake", snap({
      commercialOwner: { accountManagerId: AM, governedUserIds: [AM] },
    }));
    expect(ev.missing).toEqual([]);
    expect(ev.satisfied).toContain(KEY);
    expect(ev.complete).toBe(true);
  });

  it("C2 — an absent projection is never satisfied by omission", () => {
    // Display-only callers may omit the field; the stricter view must result.
    const ev = evaluateStepEvidence("operations_intake", snap());
    expect(ev.missing).toContain(KEY);
    expect(ev.items.find((i) => i.key === KEY)!.detail).toBe("no_assignment_data");
  });

  it("D — reassignment: the invariant follows the CURRENT Account Manager", () => {
    // History accumulates; the dossier now names the second AM. The step stays
    // satisfiable, and the superseded AM alone would not satisfy it.
    const reassigned = snap({
      commercialOwner: { accountManagerId: "am-2", governedUserIds: [AM, "am-2"] },
    });
    expect(evaluateStepEvidence("operations_intake", reassigned).complete).toBe(true);

    const staleColumn = snap({
      commercialOwner: { accountManagerId: "am-3", governedUserIds: [AM, "am-2"] },
    });
    expect(evaluateStepEvidence("operations_intake", staleColumn).missing).toContain(KEY);
  });
});

// ═══════════ E–F · authority ═══════════════════════════════════════════════

describe("OPS-OWNERSHIP-01 — the authority is the Operations Supervisor's", () => {
  it("E — an ACCOUNT_MANAGER cannot execute Operations intake", () => {
    const step = getStep("operations_intake")!;
    expect(step.permissions[0]).toBe("file:assign:commercial");
    expect(perms("ACCOUNT_MANAGER")).not.toContain("file:assign:commercial");
    // …and the reason it used to be possible: the AM holds the old lane.
    expect(perms("ACCOUNT_MANAGER")).toContain("file:assign");
  });

  it("F — OPS_SUPERVISOR (and platform admin) hold exactly this authority", () => {
    expect(perms("OPS_SUPERVISOR")).toContain("file:assign:commercial");
    expect(perms("SYSTEM_ADMIN")).toContain("file:assign:commercial");
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => (t.permissions as readonly string[]).includes("file:assign:commercial"))
      .map((t) => t.key)
      .sort();
    expect(holders).toEqual(["OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
  });

  it("F2 — no grant was broadened: the permission set is migration 115's, unchanged", () => {
    const templates = read("lib/platform/role-templates.ts");
    const occurrences = (templates.match(/file:assign:commercial/g) ?? []).length;
    expect(occurrences).toBe(2); // OPS_SUPERVISOR + SYSTEM_ADMIN, and nobody else
  });

  it("F3 — the documentary role stays the OFFICIAL vocabulary, and still maps", () => {
    // `role` names the first-party process document's actor, not a tenant role.
    // ROLE_MAPPINGS resolves it; the operations queue keys on it. Rewriting it
    // to OPS_SUPERVISOR would have routed step 2 to /my-work.
    expect(getStep("operations_intake")!.role).toBe("OPERATIONS_MANAGER");
    const m = ROLE_MAPPINGS.find((x) => x.officialRole === "OPERATIONS_MANAGER")!;
    expect(m.tenantRole).toBe("OPS_SUPERVISOR");
  });
});

// ═══════════ G–H · containment and non-waivability ═════════════════════════

describe("OPS-OWNERSHIP-01 — containment and non-waivability", () => {
  it("G — TRP/HND: the gate is inert, pending deferred K4", () => {
    for (const t of ["TRP", "HND"]) {
      const ev = evaluateStepEvidence("operations_intake", snap({
        fileType: t,
        commercialOwner: { accountManagerId: null, governedUserIds: [] },
      }));
      expect(ev.missing, t).toEqual([]);
      expect(ev.complete, t).toBe(true);
    }
    expect(amAssignmentRequiredForFileType("TRP")).toBe(false);
    expect(amAssignmentRequiredForFileType("IMP")).toBe(true);
    expect(amAssignmentRequiredForFileType("EXP")).toBe(true);
  });

  it("G2 — containment is scoped to the EVIDENCE, not to the step", () => {
    // Skipping the step for TRP would have been a ruling on K4. The step still
    // applies to every type; only its evidence requirement is scoped.
    expect(STEP_APPLICABILITY.operations_intake).toBeUndefined();
    expect([...AM_ASSIGNMENT_REQUIRED_FILE_TYPES]).toEqual(["IMP", "EXP"]);
  });

  it("H — an absence declaration cannot waive the designation", () => {
    expect(isDeclarableEvidence(KEY)).toBe(false);
    expect(DECLARABLE_EVIDENCE_KEYS).not.toContain(KEY);
    expect(NON_DECLARABLE_EVIDENCE_KEYS).toContain(KEY);
    // Even with a declaration present on the dossier, the key stays missing.
    const item = checkEvidence(KEY, snap({
      declaredAbsences: [{ key: KEY, reason: "NOT_APPLICABLE" }],
      commercialOwner: { accountManagerId: null, governedUserIds: [] },
    }));
    expect(item.status).toBe("missing");
  });
});

// ═══════════ the wiring that feeds the evaluator ═══════════════════════════

describe("OPS-OWNERSHIP-01 — both snapshot assemblers feed the governed history", () => {
  // The evaluator is pure and unit-tested above; what those tests CANNOT see is
  // whether anything actually supplies `commercialOwner`. A snapshot that reads
  // the wrong subject_type would silently make every step-2 row unsatisfiable
  // while every pure test stayed green — so the wiring is asserted here.
  for (const f of ["lib/process/engine/snapshot.ts", "lib/process/queues/service.ts"]) {
    it(`${f} reads COMMERCIAL_OWNER events and populates commercialOwner`, () => {
      const src = code(f);
      expect(src, f).toContain('.from("assignment_event")');
      expect(src, f).toMatch(/subject_type"?,\s*"COMMERCIAL_OWNER"/);
      expect(src, f).toContain("new_user_id");
      expect(src, f).toContain("commercialOwner");
      expect(src, f).toContain("governedUserIds");
    });
  }

  it("the engine snapshot scopes the read to the types the gate covers", () => {
    const src = code("lib/process/engine/snapshot.ts");
    expect(src).toContain("amAssignmentRequiredForFileType");
    expect(src).toContain("account_manager_id");
  });

  it("submitStep still refuses on missing evidence — the gate's actual door", () => {
    const src = code("lib/process/engine/actions.ts");
    expect(src).toContain("evaluateStepEvidence(stepKey, st.snapshot!.evidence)");
    expect(src).toContain('failWithEvidence("evidence_missing", ev)');
  });
});

// ═══════════ the OTHER door into step 2 ════════════════════════════════════

describe("OPS-OWNERSHIP-01 — the opening act honours the same gate", () => {
  it("completeIntakeFromOpening evaluates the evidence before completing", () => {
    // H-1 completes step 2 from the dossier-opening act, writing COMPLETED
    // directly rather than going through submitStep. Gating only submitStep
    // would therefore have left the control inert on the path everyone actually
    // uses — CI stayed green precisely because the journeys never call
    // submitStep here. Same evaluator, same snapshot, second door.
    const src = code("lib/process/engine/intake-actions.ts");
    const fn = src.slice(src.indexOf("async function completeIntakeFromOpening"));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + "export ", 1));
    expect(body).toContain('evaluateStepEvidence("operations_intake"');
    expect(body).toMatch(/if \(!ev\.complete\) return;/);
    // …and the check must precede the write that completes the step.
    expect(body.indexOf("evaluateStepEvidence")).toBeLessThan(body.indexOf('state: "COMPLETED"'));
  });

  it("no third completion path writes COMPLETED for operations_intake", () => {
    // If another module starts completing step 2 directly, this fails and the
    // new door gets the gate too, rather than silently reopening the bypass.
    const offenders: string[] = [];
    for (const f of ["lib/process/engine/intake-actions.ts", "lib/process/engine/actions.ts",
                     "lib/process/reconcile/service.ts", "lib/process/queues/service.ts"]) {
      const src = code(f);
      if (/operations_intake/.test(src) && /state: "COMPLETED"/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual(["lib/process/engine/intake-actions.ts"]);
  });
});

// ═══════════ I · the portal ════════════════════════════════════════════════

describe("OPS-OWNERSHIP-01 — portal ownership precedence", () => {
  it("I — assigned_to_user_id no longer wins the owner fallback", () => {
    const src = code("lib/portal/self-service-actions.ts");
    expect(src).toMatch(/ownerId:\s*own\.account_manager_id\s*\?\?\s*own\.coordinator_id/);
    expect(src).not.toMatch(/ownerId:[^\n]*assigned_to_user_id/);
  });

  it("I2 — the column itself is NOT removed (deferred K6)", () => {
    // Precedence corrected, schema untouched: the read still selects it, and
    // the legacy assignment action still exists for the compatibility window.
    expect(read("lib/portal/self-service-actions.ts")).toContain("assigned_to_user_id");
    expect(read("lib/files/actions.ts")).toContain("export async function assignFile");
  });
});

// ═══════════ J · nothing else moved ════════════════════════════════════════

describe("OPS-OWNERSHIP-01 — the ratified frame is untouched", () => {
  it("J1 — assign_commercial_owner remains the SOLE writer of the column", () => {
    for (const f of ["lib/files/actions.ts", "lib/process/engine/snapshot.ts", "lib/process/queues/service.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/update\([^)]*account_manager_id/);
    }
    // createFile still does not crown the creator.
    const create = code("lib/files/actions.ts");
    const body = create.slice(create.indexOf("export async function createFile"));
    expect(body.slice(0, body.indexOf("export async function", 1))).not.toContain("account_manager_id:");
  });

  it("J2 — no second assignment path was created", () => {
    const actions = read("lib/files/actions.ts");
    expect((actions.match(/rpc\("assign_commercial_owner"/g) ?? []).length).toBe(1);
    // The step-2 UI reuses the existing component, it does not reimplement it.
    const page = read("app/files/[id]/process/page.tsx");
    expect(page).toContain('import { CommercialOwner } from "@/components/files/commercial-owner"');
    expect(page).not.toContain("assignCommercialOwner(");
  });

  it("J3 — the 26-step graph is unchanged", () => {
    expect(getStep("operations_intake")!.nextSteps).toEqual(["am_dossier_opening"]);
    expect(getStep("operations_intake")!.prerequisites).toEqual(["cotation"]);
    expect(getStep("am_dossier_opening")!.prerequisites).toEqual(["operations_intake"]);
    // Count the DATA, not the text: `stepNumber:` also appears in types and
    // commentary, so a text count says 29 and proves nothing about the graph.
    expect(EFFITRANS_PROCESS).toHaveLength(26);
    expect(EFFITRANS_PROCESS.map((s) => s.stepNumber)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    );
  });

  it("J4 — assertControlStep, maker/checker and TRANSIT-CUSTODY-05 untouched", () => {
    const gate = read("lib/process/control-gate.ts") + read("lib/process/control-gate-server.ts");
    expect(gate).toContain("assignedUserId");
    expect(gate).not.toMatch(/ACCOUNT_MANAGER_ASSIGNMENT|file:assign:commercial/);
    const customs = code("lib/customs/actions.ts");
    expect(customs).toContain('customsControlGate("customs.release"');
    expect(customs).toMatch(/release_approval_status\s*!==\s*"APPROVED"/);
    expect(read("lib/process/handoff-routes.ts")).toContain('senderRoles: ["OPS_SUPERVISOR", "SYSTEM_ADMIN"]');
  });

  it("J5 — no customs status was added or changed", () => {
    const status = read("lib/customs/status.ts");
    for (const invented of ["PENDING_RELEASE", "AWAITING_APPROVAL", "ASSIGNED"]) {
      expect(status, invented).not.toContain(invented);
    }
  });

  it("J6 — no migration was created for this slice", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260930000001_customs_release_approval.sql");
    expect(files).toHaveLength(138);
  });
});

// ═══════════ registry + governance ═════════════════════════════════════════

describe("OPS-OWNERSHIP-01 — registry and governance", () => {
  it("the evidence key resolves through the registry's own invariant", () => {
    expect(() => mapDocument(KEY)).not.toThrow();
    expect(mapDocument(KEY).typeCode).toBeNull(); // structured: needs no document_type row
    expect(getStep("operations_intake")!.requiredDocuments).toEqual([KEY]);
  });

  it("the QC2 ruling is recorded AND the historical disagreement preserved", () => {
    const qc2 = read("lib/files/qc2.ts");
    expect(qc2).toContain("Circuit ratifié");
    expect(qc2).toContain("Commercial → Intake Opérations → Account Manager → Coordinateur → Transit");
    // The contradiction that made a ruling necessary must survive it.
    expect(qc2).toContain("transmission aux opérations");
    expect(qc2).toMatch(/[Dd]ivergence historique/);
    expect(qc2).not.toContain("Non déterminable :");
  });

  it("the decisions are in the register", () => {
    const reg = read("docs/decision-register.md");
    for (const d of ["DEC-C33", "DEC-C34", "DEC-C35", "DEC-C36"]) expect(reg, d).toContain(d);
    expect(reg).toContain("OPS-OWNERSHIP-01");
  });

  it("stale claims that the creator becomes Account Manager are gone", () => {
    const own = read("lib/process/ownership.ts");
    expect(own).not.toMatch(/account_manager_id — auto-set to the creator and never changed/);
    const step = JSON.stringify(getStep("operations_intake")!.implementation);
    expect(step).not.toMatch(/auto-set to the CREATOR/);
  });
});
