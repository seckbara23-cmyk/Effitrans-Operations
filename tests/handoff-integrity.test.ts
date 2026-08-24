/**
 * C-2 — GENERIC handoff integrity: a handoff may not outrun its from-step.
 * ---------------------------------------------------------------------------
 * D-2 guarded one call site (Operations→Transit). The audit found the other
 * three senders — 9→10, 22→23, 25→26 — able to send while their from-step was
 * unfinished, which is how a dossier reached Transit's queue that Transit was
 * then correctly forbidden to work. The requirement now lives in `sendHandoff`
 * itself, so every present and future handoff inherits it and no call site can
 * opt out.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { getNode } from "@/lib/process/engine/state";
import { isDone } from "@/lib/process/engine/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const engine = read("../lib/process/engine/actions.ts");

/** Every handoff the platform actually sends: from-step → to-step. */
const HANDOFFS = [
  ["am_dossier_opening", "coordinator_reception"],
  ["gainde_registration", "coordinator_to_declarant"],
  ["billing_dispatch", "administration_deposit_prep"],
  ["administration_proof_handoff", "collections"],
] as const;

function sendHandoffSlice(): string {
  const start = engine.indexOf("export async function sendHandoff");
  expect(start, "sendHandoff not found").toBeGreaterThan(-1);
  const next = engine.indexOf("\nexport ", start + 1);
  return engine.slice(start, next === -1 ? engine.length : next);
}

describe("C-2 — the guard is generic", () => {
  it("sendHandoff itself refuses an unfinished from-step", () => {
    const s = sendHandoffSlice();
    expect(s).toContain('return fail("from_step_incomplete");');
    expect(s).toContain("!isDone(from.state)");
    // …and it refuses BEFORE creating the row.
    expect(s.indexOf("from_step_incomplete")).toBeLessThan(s.indexOf(".insert("));
  });

  it("terminal-rejected/cancelled attempts are not mistaken for a live from-step", () => {
    const s = sendHandoffSlice();
    expect(s).toContain('e.state !== "REJECTED" && e.state !== "CANCELLED"');
  });

  it("idempotency survives: an already-open handoff is returned without re-checking", () => {
    const s = sendHandoffSlice();
    expect(s).toContain("const alreadyOpen = snap.handoffs.some(");
    expect(s).toContain("if (!alreadyOpen) {");
    // The open-handoff early return still exists.
    expect(s).toContain("if (open) return { ok: true, id: open.id };");
  });

  it("no call site is special-cased — the rule is in the engine, not the callers", () => {
    // The engine names no specific step in its guard.
    const guardBlock = sendHandoffSlice().slice(0, sendHandoffSlice().indexOf("const round ="));
    for (const [from] of HANDOFFS) {
      expect(guardBlock, from).not.toContain(`"${from}"`);
    }
  });

  it("every real handoff's from-step is a registry step whose completion is meaningful", () => {
    for (const [from, to] of HANDOFFS) {
      expect(getNode(from), `${from} must be a registry node`).toBeTruthy();
      expect(getNode(to), `${to} must be a registry node`).toBeTruthy();
      // The target lists the from-step (directly or transitively) as prerequisite,
      // so the guard and the target's own prerequisites agree.
      const target = getNode(to)!;
      expect(target.prerequisites.length, `${to} has no prerequisites`).toBeGreaterThan(0);
    }
  });

  it("the done-vocabulary the guard uses is the canonical one", () => {
    expect(isDone("COMPLETED")).toBe(true);
    expect(isDone("APPROVED")).toBe(true);
    expect(isDone("SKIPPED")).toBe(true);
    for (const notDone of ["PENDING", "AVAILABLE", "ACTIVE", "SUBMITTED", "BLOCKED"]) {
      expect(isDone(notDone as never), notDone).toBe(false);
    }
  });

  it("explicit reception remains mandatory — sending never opens the target", () => {
    const s = sendHandoffSlice();
    expect(s).not.toContain('state: "AVAILABLE"');
    // Reception is where the target opens.
    const receive = engine.slice(engine.indexOf("export async function receiveHandoff"));
    expect(receive).toContain('state: "AVAILABLE"');
    expect(receive).toContain('status: "RECEIVED"');
  });
});
