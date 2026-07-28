/**
 * Dossier status follows the transport fact (Option A).
 *
 * The platform ran two state machines on different columns:
 *
 *   * the LIFECYCLE reads module facts — `delivered` is
 *     `transport_record.status >= DELIVERED`;
 *   * the TRANSITION ladder is `operational_file.status`.
 *
 * Nothing advanced IN_PROGRESS → DELIVERED, so with transport at POD_RECEIVED
 * and the invoice paid, the lifecycle reached its final stage and advertised
 * « Clôturer le dossier » while the file's only legal next step was DELIVERED.
 * The operator followed the instruction and found a different button.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canTransition, nextStatuses } from "@/lib/files/status";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { canonicalWorkflowInput } from "@/lib/workflow/canonical-input";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ADVANCE = "lib/files/auto-advance.ts";

// ---------------------------------------------------------------------------
describe("the drift this closes", () => {
  it("IN_PROGRESS cannot reach CLOSED directly — the ladder has no shortcut", () => {
    expect(canTransition("IN_PROGRESS", "CLOSED")).toBe(false);
    expect(nextStatuses("IN_PROGRESS")).toEqual(["DELIVERED"]);
    expect(nextStatuses("DELIVERED")).toEqual(["CLOSED"]);
  });

  it("the lifecycle advertises closure from TRANSPORT facts, not file.status", () => {
    // Exactly the production shape: file still IN_PROGRESS, everything else done.
    const lc = getDossierLifecycle(canonicalWorkflowInput({
      fileId: "f",
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "VERIFIED" }],
      missingRequired: [],
      customs: { status: "RELEASED", required: true },
      transport: { status: "POD_RECEIVED" },
      invoices: [{ status: "PAID", balance: 0 }],
      podApproved: true,
    }));
    // The lifecycle says "close it"…
    expect(lc.nextAction?.reasonCode).toBe("close_dossier");
    // …while the transition engine offers only DELIVERED. That was the drift.
    expect(nextStatuses("IN_PROGRESS")).not.toContain("CLOSED");
  });
});

// ---------------------------------------------------------------------------
describe("the auto-advance contract", () => {
  const src = () => code(ADVANCE);

  it("advances only from OPENED or IN_PROGRESS", () => {
    expect(src()).toMatch(/ADVANCEABLE: readonly FileStatus\[\] = \["OPENED", "IN_PROGRESS"\]/);
  });

  it("is idempotent: already DELIVERED or CLOSED writes nothing", () => {
    expect(src()).toMatch(/if \(current === "DELIVERED" \|\| current === "CLOSED"\) return "already";/);
  });

  it("never touches DRAFT or CANCELLED", () => {
    // Neither is in ADVANCEABLE, so both fall to not_applicable.
    expect(src()).toContain('return "not_applicable"');
    expect(src()).not.toMatch(/"DRAFT"[\s\S]{0,40}update/);
  });

  it("respects the state machine — canTransition still rules", () => {
    expect(src()).toMatch(/if \(!canTransition\(current, next\)\) break;/);
  });

  it("walks at most two hops and never skips a rung", () => {
    const s = src();
    expect(s).toMatch(/for \(let hop = 0; hop < 2/);
    expect(s).toMatch(/current === "OPENED" \? "IN_PROGRESS" : "DELIVERED"/);
  });

  it("uses compare-and-set so a concurrent operator transition wins", () => {
    const s = src();
    expect(s).toMatch(/\.eq\("status", current\)/);
    expect(s).toMatch(/if \(\(rows\?\.length \?\? 0\) !== 1\) break;/);
  });

  it("writes the SAME history row and audit a manual transition writes", () => {
    const s = src();
    expect(s).toContain('from("file_state_transition")');
    expect(s).toContain("AuditActions.FILE_TRANSITION");
    expect(s).toContain("from_status: current");
    expect(s).toContain("to_status: next");
  });

  it("records provenance honestly — never as an operator click", () => {
    expect(src()).toContain('source: "AUTOMATIC_ON_TRANSPORT_DELIVERY"');
  });

  it("never throws — it cannot roll back the transport fact", () => {
    expect(src()).toMatch(/\} catch \{\s*\n\s*return "failed";/);
  });

  it("asserts no permission — the transport transition was the authorizing act", () => {
    const s = src();
    expect(s).not.toContain("assertPermission");
    expect(s).not.toContain("hasPermission");
  });

  it("NEVER closes a dossier — closure stays behind its own guard", () => {
    const s = src();
    expect(s).not.toMatch(/"CLOSED"\s*[,}]/);
    expect(s).not.toContain("closureBlockers");
  });
});

// ---------------------------------------------------------------------------
describe("both delivery paths converge the dossier", () => {
  it("the manual transport transition advances on DELIVERED and POD_RECEIVED", () => {
    const s = code("lib/transport/actions.ts");
    expect(s).toMatch(/if \(toStatus === "DELIVERED" \|\| toStatus === "POD_RECEIVED"\) \{[\s\S]{0,260}advanceFileToDeliveredFromTransport/);
  });

  it("the AUTOMATIC POD receipt advances it too", () => {
    expect(code("lib/transport/pod-receipt.ts")).toContain("advanceFileToDeliveredFromTransport");
  });

  it("so a delivered dossier can always reach CLOSED", () => {
    // After the advance, file.status is DELIVERED and the closure control has
    // something to offer.
    expect(nextStatuses("DELIVERED")).toEqual(["CLOSED"]);
  });
});

// ---------------------------------------------------------------------------
describe("what did NOT change", () => {
  it("the closure guard is untouched", () => {
    const s = code("lib/files/actions.ts");
    expect(s).toContain("closureBlockers({");
    expect(s).toContain("if (blockers.length > 0) return { ok: false, error: blockers[0] };");
  });

  it("the ladder itself is unchanged — no new transition was added", () => {
    const s = code("lib/files/status.ts");
    expect(s).toContain('IN_PROGRESS: ["DELIVERED"]');
    expect(s).toContain('DELIVERED: ["CLOSED"]');
    expect(s).toContain("CLOSED: []");
    expect(s).not.toMatch(/IN_PROGRESS: \[[^\]]*"CLOSED"/);
  });

  it("no ARCHIVED status appeared", () => {
    expect(code("lib/files/status.ts")).not.toContain('"ARCHIVED"');
  });

  it("task completion still never moves the dossier", () => {
    const s = code("lib/tasks/actions.ts");
    expect(s).not.toContain("advanceFileToDeliveredFromTransport");
    expect(s).not.toContain("transitionFile");
  });
});
