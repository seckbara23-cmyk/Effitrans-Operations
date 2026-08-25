/**
 * C-4 — reconciliation shares the engine's authority, or it has none.
 * ---------------------------------------------------------------------------
 * There are two paths that can COMPLETE an official step: the action path
 * (`submitStep`/`approveStep`/`skipStep`) and the WES-5 reconciliation path.
 * The first checked evidence and promoted successors; the second did neither.
 *
 * The consequence was not theoretical. `am_dossier_opening`'s fact rule asks
 * only whether the dossier is past DRAFT, so verifying ANY document on ANY open
 * dossier completed step 3 with its four required documents outstanding — and
 * promoted nothing, leaving `transport_assignment`, `bon_a_delivrer` and
 * `pre_gate` PENDING with no other path to AVAILABLE. The transport-readiness
 * branch, and the pickup convergence that waits on it, became unreachable.
 *
 * Both halves are fixed by DEFERRING to the existing authority rather than by
 * re-implementing it, so these tests assert that the deferral is wired and that
 * the registry relation it depends on is real. The end-to-end behaviour is
 * proved against a live database in tests/journey/transit-customs.journey.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dependentsOf } from "@/lib/process/engine/state";
import { FACT_RULES, FACT_PROVABLE_STEP_KEYS } from "@/lib/process/reconcile/satisfaction";
import { isSystemAction } from "@/lib/audit/validate";
import { AuditActions } from "@/lib/audit/events";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/** The body of one function, bounded by the next top-level declaration. */
function fnSlice(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const after = source.indexOf("\nexport ", start + 1);
  return source.slice(start, after === -1 ? source.length : after);
}

const service = read("lib/process/reconcile/service.ts");

describe("C-4 — a reconciled completion promotes, using the ONE authority", () => {
  it("the service calls promoteSuccessors — it does not reimplement promotion", () => {
    expect(service).toContain("await promoteSuccessors(");
    expect(service).toContain('from "@/lib/process/engine/promote"');
  });

  it("promotion is not duplicated in SQL", () => {
    // The RPC completes; it must never be the thing that opens the next step,
    // or the two implementations would drift and only one would be tested.
    const rpc = read("supabase/migrations/20260727000005_process_reconciliation.sql");
    expect(rpc).not.toContain("'AVAILABLE'");
  });

  it("promotion happens only on a completion this run actually applied", () => {
    // `already: true` is an idempotent no-op re-run. Promoting there would be
    // harmless (promoteSuccessors is itself idempotent) but it would mean the
    // service could not tell the two apart, and the audit would gain a
    // promotion event for a completion that did not happen in this run.
    const run = fnSlice(service, "async function run(");
    const applied = run.indexOf("!applied.already");
    const promote = run.indexOf("await promoteSuccessors(");
    expect(applied).toBeGreaterThan(-1);
    expect(promote).toBeGreaterThan(applied);
  });

  it("every fact-provable step's dependents are a real registry relation", () => {
    // promoteSuccessors promotes `dependentsOf(stepKey)`. Proving the call is
    // wired proves promotion for EVERY step it can complete, provided that
    // relation is non-empty where the workflow says it should be. These are the
    // six steps reconciliation can close, and the dependents each one opens.
    const expected: Record<string, string[]> = {
      am_dossier_opening: ["coordinator_reception", "transport_assignment", "bon_a_delivrer", "pre_gate"],
      gainde_registration: ["coordinator_to_declarant", "gainde_document_submission"],
      gainde_document_submission: ["customs_followup"],
      customs_field_clearance: ["pickup"],
      pickup: ["am_delivery_followup"],
      transport_pod_handoff: ["coordinator_completeness"],
    };
    for (const [step, deps] of Object.entries(expected)) {
      expect(FACT_PROVABLE_STEP_KEYS, `${step} must be fact-provable`).toContain(step);
      expect([...dependentsOf(step)].sort(), `dependents of ${step}`).toEqual([...deps].sort());
    }
  });

  it("pickup opens only when BOTH its branches have landed", () => {
    // The convergence the defect made unreachable. promoteSuccessors refuses to
    // promote until `prerequisitesMet`, so one branch landing must not open it.
    const registry = read("lib/process/effitrans-process.ts");
    const pickup = registry.slice(registry.indexOf('key: "pickup"'));
    const prereq = pickup.slice(pickup.indexOf("prerequisites:"), pickup.indexOf("requiredDocuments:"));
    expect(prereq).toContain("customs_field_clearance");
    expect(prereq).toContain("transport_assignment");

    const promote = read("lib/process/engine/promote.ts");
    expect(promote).toContain("if (!prerequisitesMet(key, views)) continue;");
    // …and it never overwrites a step that is not still waiting.
    expect(promote).toContain('if (!exec || exec.state !== "PENDING") continue;');
    // …and the CAS makes the promotion happen exactly once under concurrency.
    expect(promote).toContain('.eq("state", "PENDING")');
  });
});

describe("C-4 — reconciliation defers to canonical evidence", () => {
  it("the service evaluates the engine's own evidence rules", () => {
    expect(service).toContain("evaluateStepEvidence(stepKey, evidenceSnap.evidence)");
    expect(service).toContain('from "@/lib/process/engine/evidence"');
  });

  it("the evidence gate runs BEFORE the completion RPC", () => {
    const run = fnSlice(service, "async function run(");
    const gate = run.indexOf("evaluateStepEvidence(stepKey");
    const rpc = run.indexOf('supabase.rpc("reconcile_step_completion"');
    expect(gate).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(-1);
    expect(gate, "evidence must be checked before the step is completed").toBeLessThan(rpc);
  });

  it("unsatisfied evidence skips the step — in ANY of its forms", () => {
    const run = fnSlice(service, "async function run(");
    // `complete` already covers missing / invalid / pending_review; unauthorized
    // is checked explicitly because `complete` deliberately ignores it, which is
    // the exact gap C-4 found in submitStep.
    expect(run).toContain("if (ev.unauthorized.length > 0 || !ev.complete) continue;");
  });

  it("the fix is general — not a patch on the step that exposed it", () => {
    // The gate is inside the loop over FACT_PROVABLE_STEP_KEYS and names no
    // step, so every step reconciliation can complete is covered by it.
    const run = fnSlice(service, "async function run(");
    const gate = run.slice(run.indexOf("if (evidenceSnap) {"), run.indexOf("const { data, error }"));
    for (const step of FACT_PROVABLE_STEP_KEYS) {
      expect(gate, `the evidence gate must not special-case ${step}`).not.toContain(`"${step}"`);
    }
  });

  it("evidence is judged on the RECORD, not on who triggered reconciliation", () => {
    // Reading every domain is what makes the verdict about the dossier rather
    // than about the verifier's permissions — the same lesson as the submitStep
    // finding, applied to the other completion path.
    expect(service).toContain('const RECONCILE_FULL_READ = ["document:read", "customs:read", "transport:read", "finance:read"]');
  });

  it("the weak proxy that caused this is still weak — which is why the gate exists", () => {
    // Not a regression on the rule: the rule is a PROXY and is allowed to be
    // one. This pins WHY the gate is required, so nobody later concludes the
    // gate is redundant and removes it.
    const rule = FACT_RULES["am_dossier_opening"];
    expect(rule.satisfied({ fileStatus: "OPENED" } as never)).toBe(true);
    expect(rule.satisfied({ fileStatus: "IN_PROGRESS" } as never)).toBe(true);
  });
});

describe("C-4 — attribution on a reconciliation-triggered promotion", () => {
  it("the causing actor is passed through", () => {
    expect(service).toContain("input.actorId ?? null");
  });

  it("a system-caused promotion uses the platform's system semantics", () => {
    // F-α: never actorId:null on a non-system action. RATIFY-OPSSEC2-2A: never
    // invent a principal. The platform's third answer is a `system.` action,
    // which the audit layer accepts as legitimately unattributed.
    expect(isSystemAction(AuditActions.PROCESS_STEP_ACTIVATED_SYSTEM)).toBe(true);
    expect(isSystemAction(AuditActions.PROCESS_STEP_ACTIVATED)).toBe(false);

    const promote = read("lib/process/engine/promote.ts");
    expect(promote).toContain("? AuditActions.PROCESS_STEP_ACTIVATED");
    expect(promote).toContain(": AuditActions.PROCESS_STEP_ACTIVATED_SYSTEM");
    expect(promote).toContain("actorId: actorId ?? undefined");
  });

  it("no principal is fabricated anywhere on the path", () => {
    const promote = read("lib/process/engine/promote.ts");
    expect(promote).not.toMatch(/SYSTEM_USER_ID|00000000-0000-0000-0000-0000000000/);
    expect(service).not.toMatch(/SYSTEM_USER_ID|actorId: ".*-.*-.*"/);
  });

  it("F-β's hard error is recorded on this path, not thrown and not swallowed", () => {
    // Reconciliation reuses promoteSuccessors, so F-β's compensation applies
    // unchanged. Its ONE unrecoverable case is handled differently here, and
    // deliberately so.
    //
    // On the action path the request fails, which is right: that operator was
    // completing that step. Here the operator was verifying a DOCUMENT, and
    // WES-5A ratified that reconciliation must never break the module action —
    // throwing would recreate the exact shape F-α exists to prevent, a crash
    // after the writes have committed. So the breach is written to the ledger
    // as a machine-caused event and the run reports not-ok.
    expect(service).toContain("if (err instanceof PromotionAuditUnrecoverableError)");
    expect(service).toContain("AuditActions.PROMOTION_AUDIT_UNRECOVERABLE_SYSTEM");
    expect(service).toContain("result.ok = false;");
    // Anything that is NOT that error still propagates — this catch must not
    // become a general-purpose silencer.
    expect(service).toContain("throw err;");
    // And the wrapper keeps its ratified promise: WES-5A's "never throws".
    expect(service).toContain("return { ...EMPTY, ok: false };");
  });
});
