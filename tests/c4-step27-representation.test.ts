/**
 * C-4 — « Step 27 » is CEO numbering, not a registry node. RESOLVED, pinned.
 * ---------------------------------------------------------------------------
 * The question: the architecture names a step 27, « Clôture du dossier », while
 * the implemented registry ends at 26 and closure lives in a separate action.
 * Is the registry short a step?
 *
 * ANSWERED FROM THE AUTHORITATIVE MATERIAL — docs/maya/maya-p1-6-closure-audit.md
 * — not from reasoning about the gap:
 *
 *   NO. Step 27 is the CEO's numbering of a terminal business ACT performed by
 *   `file:transition` holders. It is not a process-engine node, and P1.6
 *   concludes the sequence is "faithfully implemented" with "Nothing to build
 *   for closure."
 *
 * WHY THE DISTINCTION IS REAL AND NOT A TECHNICALITY. The 26 registry steps and
 * the dossier LIFECYCLE are different objects with different authorities —
 * P1.6's "four separated authorities, none accidental". A registry step is
 * gated on ONE permission (`permissions[0]`), promoted by prerequisites, and
 * reached by handoff. Closure is none of those: it is a lifecycle transition
 * over `operational_file.status`, reached through ONE guarded seam
 * (`transitionFile`) from either of TWO doors, and it involves two permissions
 * over two different objects — neither a superset of the other.
 *
 * So representing it as step 27 would not be a formality. It would subject a
 * lifecycle transition to process-engine machinery it was deliberately kept out
 * of, and force a single `permissions[0]` onto an act that legitimately needs
 * two. The 26-step registry is preserved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALL_NODE_KEYS, getNode } from "@/lib/process/engine/state";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const holders = (permission: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key).sort();

describe("C-4 — the registry ends at 26, and that is correct", () => {
  it("there is no step 27 node, and the last numbered step is collections", () => {
    expect(ALL_NODE_KEYS).not.toContain("dossier_closure");
    expect(ALL_NODE_KEYS).not.toContain("closure");
    const collections = getNode("collections") as { stepNumber?: number } | null;
    expect(collections?.stepNumber, "26 is the last numbered step").toBe(26);
  });

  it("the authoritative audit says closure needs nothing built", () => {
    const doc = read("docs/maya/maya-p1-6-closure-audit.md");
    expect(doc).toContain("Nothing to build for closure");
    expect(doc).toContain("Recouvrement produces the settlement evidence. Operations performs the closure.");
  });
});

describe("C-4 — closure is a LIFECYCLE act, not a process step", () => {
  it("CLOSED is reached through ONE guarded seam, from two doors", () => {
    // Door 1: manual closure by a file:transition holder — the CEO's step 27.
    // Door 2: closeDossier, which closes the process instance AND calls the
    //         same seam. Both pass the identical gate.
    const collections = read("lib/collections/actions.ts");
    expect(collections).toContain('transitionFile(fileId, "CLOSED")');
    const files = read("lib/files/actions.ts");
    expect(files).toContain("closureBlockers({");
  });

  it("the two authorities govern two different objects", () => {
    // P1.6: "neither is a superset of the other". This is why closure cannot be
    // squeezed into a registry step's single `permissions[0]`.
    expect(holders("file:transition")).toContain("OPS_SUPERVISOR");
    expect(holders("process:close")).toContain("OPS_SUPERVISOR");
    expect(holders("file:transition")).not.toEqual(holders("process:close"));
  });

  it("the CEO's step-27 actors are exactly the file:transition holders", () => {
    // « Ops Supervisor, Coordinateur, AM or Admin (file:transition) ».
    expect(holders("file:transition")).toEqual(
      ["ACCOUNT_MANAGER", "COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"].sort(),
    );
  });

  it("Recouvrement proves settlement and closes nothing — P1.5/P1.6 preserved", () => {
    // The ratification withdrawn on 2026-08-26: the earlier grant was made
    // before P1.6 surfaced. Operations performs the final closure, and an
    // OPS_SUPERVISOR doing so is legitimate workflow execution rather than a
    // supervisor rescue.
    for (const denied of ["process:close", "file:transition", "file:update"]) {
      expect(holders(denied), denied).not.toContain("COLLECTIONS_OFFICER");
    }
    expect(holders("collections:manage")).toContain("COLLECTIONS_OFFICER");
  });
});

describe("C-4 — what adding step 27 would cost, recorded so it is not re-argued", () => {
  it("a registry step is gated on ONE permission — closure needs two", () => {
    // getNode(...).permissions[0] is what `stepPermission` returns and what
    // `guard` asserts. Closure legitimately spans file:transition (the dossier)
    // and process:close (the instance).
    const engine = read("lib/process/engine/state.ts");
    expect(engine).toContain("permissions[0]");
  });

  it("every registry step carries process-engine machinery closure does not", () => {
    // Prerequisites, promotion and handoff routing are properties of a step.
    // Closure has none of them: it is guarded by closureBlockers, not by
    // prerequisitesMet, and no handoff routes to it.
    const collections = getNode("collections") as { prerequisites?: string[] } | null;
    expect(collections?.prerequisites, "steps declare prerequisites").toBeDefined();
    const receiving = read("supabase/migrations/20260913000001_handoff_receiver_visibility.sql");
    expect(receiving, "no handoff routes to a closure step").not.toContain("'dossier_closure'");
  });

  it("the 26-step count is pinned in the ownership invariant", () => {
    // Changing the canon to 27 would move that assertion and every step-number
    // pin with it. Recorded as a cost, not a blocker.
    const invariant = read("tests/c4-step-ownership-invariant.test.ts");
    expect(invariant).toContain("expect(rows.length).toBe(26)");
  });
});
