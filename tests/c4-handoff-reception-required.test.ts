/**
 * C-4 — an outstanding handoff blocks execution until it is RECEIVED.
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES. Reception used to be enforced by the shape of the
 * ladder rather than by a check: `PENDING -> ACTIVE` is not a legal transition
 * and `receiveHandoff` was the only writer of AVAILABLE for a non-entry step,
 * so a handoff target could not be started until somebody accepted it. C-1
 * added `promoteSuccessors` as a second writer — necessarily, or steps that are
 * neither entry steps nor handoff targets could never become reachable — and
 * that dissolved the guarantee for 23 of the 26 steps. The positive journeys
 * never saw it because they all receive properly first; the negative battery
 * walked step 4 straight to ACTIVE with its handoff still SENT.
 *
 * RATIFIED (Option 1). Promotion still opens the step. Where an explicit
 * handoff addressed to it is outstanding, execution waits for reception.
 *
 * The behavioural proof is in the journey battery, which walks the whole ladder
 * against a real database — refused, still SENT, received, then started. What
 * lives here is the coverage that battery cannot give: the mutations that would
 * leave it passing while the invariant is gone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUEUES } from "@/lib/process/queues/registry";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Source with comments removed — these assertions must never read prose. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const engine = code("lib/process/engine/actions.ts");
const fn = (name: string) => {
  const i = engine.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const j = engine.indexOf("\nexport ", i + 1);
  return engine.slice(i, j === -1 ? engine.length : j);
};
// UAT-WF-HANDOFF-01B: the question the two doors ask WIDENED — from « is a
// transfer outstanding » to « is custody actually held » — and moved into
// `custodyRefusal`, so both doors and the display read one rule. C-4's
// invariant is unchanged and now strictly stronger: a step a governed route
// targets is refused BOTH while a transfer is outstanding AND when none was
// ever sent.
const GUARD_CALL = "custodyRefusal(stepKey, st.snapshot!.handoffs)";

describe("C-4 — the guard is asked at every door that starts work", () => {
  it("activateStep asks it", () => {
    expect(fn("activateStep")).toContain(GUARD_CALL);
  });

  it("submitStep asks it too — the invariant cannot depend on which action was chosen", () => {
    expect(fn("submitStep")).toContain(GUARD_CALL);
  });

  it("activateStep asks BEFORE the pickup gate, which writes audit rows", () => {
    const a = fn("activateStep");
    expect(a.indexOf("custodyRefusal")).toBeLessThan(a.indexOf("PROCESS_GATE_BLOCKED"));
  });

  it("submitStep asks BEFORE evidence — you are not told what is missing from work you have not accepted", () => {
    const s = fn("submitStep");
    expect(s.indexOf("custodyRefusal")).toBeLessThan(s.indexOf("evidence_unauthorized"));
  });
});

describe("C-4 — the rule is exactly « an unreceived handoff addressed to THIS step »", () => {
  const routes = code("lib/process/handoff-routes.ts");
  const guard = routes.slice(routes.indexOf("export function custodyStateFor"));
  const body = guard.slice(0, guard.indexOf("\n}"));

  it("it matches on the TARGET step, not the source", () => {
    expect(body).toContain("h.toStepKey === toStepKey");
    expect(body, "matching fromStepKey would block the sender's own step").not.toContain("h.fromStepKey");
  });

  it("SENT blocks; RECEIVED unlocks; a settled transfer is not custody", () => {
    expect(body).toContain('h.status === "SENT"');
    expect(body).toContain('h.status === "RECEIVED"');
    // REJECTED/CANCELLED leave the step awaiting transmission again — the
    // default branch — rather than counting as custody either way.
    for (const settled of ["REJECTED", "CANCELLED"]) {
      expect(body, `${settled} must not be treated as custody`).not.toContain(settled);
    }
    const refusal = routes.slice(routes.indexOf("export function custodyRefusal"));
    expect(refusal).toContain('return "handoff_reception_required"');
    expect(refusal).toContain('return "handoff_not_sent"');
  });

  it("it is a QUESTION — it receives nothing, writes nothing, invents no provenance", () => {
    for (const write of ["update(", "insert(", "received_by", "received_at", "received_from_user_id", "writeAudit"]) {
      expect(body, `the guard must not ${write}`).not.toContain(write);
    }
  });
});

describe("C-4 — reception authority and eligibility are untouched", () => {
  it("receiveHandoff remains the sole writer of RECEIVED", () => {
    const writers = engine.split('status: "RECEIVED"').length - 1;
    expect(writers, "exactly one writer").toBe(1);
    expect(fn("receiveHandoff")).toContain('status: "RECEIVED"');
  });

  it("and it still refuses an ineligible receiver", () => {
    expect(fn("receiveHandoff")).toContain("not_eligible_receiver");
  });

  it("the guard creates no handoffs — sendHandoff is still the only sender", () => {
    const guard = engine.slice(engine.indexOf("function outstandingHandoffTo"));
    expect(guard.slice(0, guard.indexOf("\n}"))).not.toContain("process_handoff");
  });
});

describe("C-4 — the guard cannot be made blind", () => {
  it("the snapshot reads handoffs UNCONDITIONALLY, not through the caller's permissions", () => {
    // This is the whole safety of reading `st.snapshot`. Executions and handoffs
    // are fetched with the admin client gated only on the instance existing,
    // while documents, customs, transport and finance are gated on permissions.
    // If handoffs ever moved behind an `access.*` flag, this guard would go
    // quietly blind for exactly the callers it exists to stop — the same
    // wrong-source failure the pickup gate and the evidence evaluator both had.
    const snap = code("lib/process/engine/snapshot.ts");
    const i = snap.indexOf('scopedFrom(admin, "process_handoff", tenantId)');
    expect(i, "handoffs are read from the admin client").toBeGreaterThan(-1);
    const preceding = snap.slice(Math.max(0, i - 200), i);
    expect(preceding, "and not behind a permission flag").not.toContain("access.");
    expect(preceding).toContain("instanceId");
  });
});

describe("C-4 — intra-queue steps are out of reach of this rule, by construction", () => {
  // Steps 5 and 18 are promoted by a predecessor in their own queue and no
  // handoff is ever addressed to them. The rule keys on an EXISTING handoff, so
  // it cannot touch them — and no sender exists that could create one.
  const senders = [
    "lib/deposit/actions.ts",
    "lib/finance/request-actions.ts",
    "lib/process/engine/intake-actions.ts",
  ];

  it("nothing in the product sends a handoff to step 5 or step 18", () => {
    const all = senders.map((f) => code(f)).join("\n");
    expect(all).not.toContain("transit_declarant_assignment");
    expect(all).not.toContain("coordinator_completeness");
  });

  it("both sit in queues that DO require reception — so the exemption is real, not incidental", () => {
    // Had the rule keyed on the queue flag instead of on an actual handoff,
    // these two would have been stranded with nothing able to open them.
    const receiving = (QUEUES as { officialRole: string; requiresReception: boolean }[])
      .filter((q) => q.requiresReception)
      .map((q) => q.officialRole);
    expect(receiving).toContain("CHIEF_TRANSIT");
    expect(receiving).toContain("COORDINATOR");
  });
});

describe("C-4 — the refusal is a distinct, stable code", () => {
  it("it is declared in the engine's error union", () => {
    expect(code("lib/process/engine/types.ts")).toContain('| "handoff_reception_required"');
  });

  it("and is not collapsed into an existing refusal", () => {
    // `forbidden` is not literal here — it arrives from guard(). The refusals
    // activateStep names itself must stay three distinct facts: you may not act
    // yet, you have not accepted the work, the dossier is not ready.
    const a = fn("activateStep");
    expect(a).toContain("custodyRefusal");
    const routes2 = code("lib/process/handoff-routes.ts");
    expect(routes2).toContain('"handoff_reception_required"');
    expect(routes2).toContain('"handoff_not_sent"');
    expect(a).toContain("prerequisites_unmet");
    expect(a).toContain("gate_blocked");
  });
});
