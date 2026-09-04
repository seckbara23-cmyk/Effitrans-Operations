/**
 * MAYA-P1.2 — GAINDE fact / process-state reconciliation.
 * ---------------------------------------------------------------------------
 * P1.1 created the durable milestone. This phase makes the PROJECTION agree
 * with it, and the audit found the divergence pointing the other way from the
 * one that was predicted.
 *
 * PREDICTED: the dossier says registered while the Control Tower says pending.
 * FOUND:     the Control Tower said DONE while Finance never registered.
 *
 * WES-5's `gainde_registration` rule read « customs DECLARED-or-later + a
 * declaration number ». That is the DECLARANT's fact, written under
 * customs:update, and it was completing a step the registry assigns to
 * CUSTOMS_FINANCE_OFFICER with requiredEvidence « registration_date,
 * registered_by ». One production dossier was already COMPLETED that way —
 * provenance RECONCILED, reconciled_fact CUSTOMS_DECLARED — on a registration
 * that never happened. The rule was a reasonable proxy in July, when no
 * milestone existed. It stopped being reasonable the day P1.1 created one.
 *
 * WHAT THIS PHASE IS NOT. Completing the step is not advancing the dossier.
 * The reconciliation RPC updates ONE execution row; it opens no successor,
 * moves no customs status, and refuses every human-only step. The CEO document
 * authorises the FACT (« Finance registers the declaration in GAINDE »); it
 * does not authorise a chain reaction, and none is built.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FACT_PROVABLE_STEP_KEYS,
  FACT_RULES,
  evaluateStep,
  mayReconcileComplete,
  type ModuleFacts,
} from "@/lib/process/reconcile/satisfaction";
import { deriveQC4 } from "@/lib/files/qc4";
import type { CustomsRecord } from "@/lib/customs/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const SATISFACTION = "lib/process/reconcile/satisfaction.ts";
const SERVICE = "lib/process/reconcile/service.ts";
const ACTIONS = "lib/customs/actions.ts";
const TOWER = "lib/process/queues/control-tower.ts";
const TZ = "Africa/Dakar";

/** A dossier past customs, parameterised on the two facts that compete here. */
const facts = (over: { gaindeRegisteredAt?: string | null; declarationNumber?: string | null } = {}): ModuleFacts => ({
  fileType: "IMP",
  fileStatus: "IN_PROGRESS",
  customs: {
    status: "DECLARED",
    required: true,
    declarationNumber: over.declarationNumber === undefined ? "IMP-2026-000123" : over.declarationNumber,
    baeReference: null,
    gaindeRegisteredAt: over.gaindeRegisteredAt === undefined ? null : over.gaindeRegisteredAt,
    attachmentCompletedAt: null,
  },
  transport: null,
  verifiedPodDocumentId: null,
  verifiedBaeDocumentId: null,
});

const REGISTERED = "2026-08-13T09:30:00.000Z";
const evalGainde = (f: ModuleFacts, state: string | null) =>
  evaluateStep({
    stepKey: "gainde_registration",
    facts: f,
    execution: state ? { stepKey: "gainde_registration", state } : null,
  });

function actionBody(): string {
  const s = code(ACTIONS);
  const start = s.indexOf("export async function recordGaindeRegistration");
  expect(start, "recordGaindeRegistration must exist").toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

// ===========================================================================
describe("the invariant: the milestone decides, and only the milestone", () => {
  it("no registration → the step still projects as pending, exactly as before", () => {
    // Requirement 1. Nothing about an unregistered dossier changes.
    expect(evalGainde(facts(), "AVAILABLE").satisfaction).toBe("IN_PROGRESS");
    expect(evalGainde(facts(), null).satisfaction).toBe("IN_PROGRESS");
  });

  it("registration present → the step is NOT projected as pending", () => {
    // Requirement 2 — the invariant this phase exists to establish.
    for (const state of [null, "PENDING", "AVAILABLE", "ACTIVE", "BLOCKED"]) {
      expect(evalGainde(facts({ gaindeRegisteredAt: REGISTERED }), state).satisfaction, state ?? "none")
        .toBe("SATISFIED");
      expect(mayReconcileComplete(state)).toBe(true);
    }
  });

  it("the DECLARANT's fact alone no longer completes a FINANCE step", () => {
    // The defect, stated as a test. A declaration number and DECLARED status
    // are the Declarant's work; CEO step 8 belongs to Finance.
    const declarantOnly = facts({ declarationNumber: "IMP-2026-000123", gaindeRegisteredAt: null });
    expect(evalGainde(declarantOnly, "AVAILABLE").satisfaction).not.toBe("SATISFIED");
  });

  it("correcting the reference does not reopen the act", () => {
    // Requirement 3. `external_ref` remains writable through customs:update;
    // the milestone is what was signed, so only the milestone is read.
    const rule = FACT_RULES.gainde_registration;
    expect(rule.satisfied(facts({ gaindeRegisteredAt: REGISTERED, declarationNumber: null }))).toBe(true);
    expect(code(SATISFACTION)).not.toMatch(/gainde_registration:[\s\S]{0,400}externalRef/);
  });

  it("the rule reads the milestone and nothing else", () => {
    const s = code(SATISFACTION);
    const rule = s.slice(s.indexOf("gainde_registration: {"), s.indexOf("customs_field_clearance: {"));
    expect(rule).toContain("gaindeRegisteredAt");
    expect(rule).not.toContain("declarationNumber");
    // …and the service actually reads the column, or the rule reads undefined.
    expect(code(SERVICE)).toContain("gainde_registered_at");
    expect(code(SERVICE)).toContain("gaindeRegisteredAt: customs.data.gainde_registered_at");
  });

  it("the reconciled fact code names what proves the step", () => {
    // It used to record CUSTOMS_DECLARED on this step — the wrong department's
    // fact, written into the audit trail as the reason.
    const s = code(SERVICE);
    const fn = s.slice(s.indexOf("function factCode"));
    expect(fn).toMatch(/case "gainde_registration": return "GAINDE_REGISTERED"/);
    expect(fn).not.toMatch(/case "gainde_registration": return "CUSTOMS_DECLARED"/);
  });
});

// ===========================================================================
describe("legacy and in-flight dossiers", () => {
  it("COMPLETED with no milestone → CONFLICT, never a silent regression", () => {
    // Requirement 13. This is a real production row: EFT-IMP-2026-00003,
    // COMPLETED / RECONCILED / CUSTOMS_DECLARED, no Finance registration.
    // Tightening the rule cannot un-complete it — WES-5 reports conflicts and
    // refuses to resolve them, because a completion is somebody's record.
    const r = evalGainde(facts({ gaindeRegisteredAt: null }), "COMPLETED");
    expect(r.satisfaction).toBe("CONFLICT");
    expect(r.factFr).toMatch(/marquée terminée mais le fait attendu est absent/);
  });

  it("nothing is back-filled — a date and an actor are never invented", () => {
    // The only honest reading of a missing milestone is that Finance did not
    // record one. No migration guesses otherwise, and none may.
    expect(code(SERVICE)).not.toMatch(/gainde_registered_at\s*=/);
    const s = code(SATISFACTION);
    expect(s).not.toMatch(/coalesce\([^)]*gaindeRegisteredAt/);
  });

  it("a dossier with no process instance is untouched", () => {
    // Two of the three production dossiers have no instance at all. There is
    // nothing to reconcile INTO; the fact stands alone and the dossier page
    // reads it directly. The service fabricates no instance and no execution —
    // initialization is the engine's own action, never a side effect of a fact.
    const s = code(SERVICE);
    expect(s).not.toMatch(/insert into|\.insert\(/);
    expect(s).toMatch(/from\("process_instance"\)\s*\.select\(/);
  });

  it("a pending maker-checker review still wins over the fact", () => {
    expect(evalGainde(facts({ gaindeRegisteredAt: REGISTERED }), "SUBMITTED").satisfaction).toBe("IN_PROGRESS");
    expect(mayReconcileComplete("SUBMITTED")).toBe(false);
    for (const decided of ["APPROVED", "REJECTED", "CANCELLED"]) {
      expect(mayReconcileComplete(decided), decided).toBe(false);
    }
  });

  it("customs not required → still NOT_APPLICABLE, milestone or not", () => {
    const f = facts({ gaindeRegisteredAt: REGISTERED });
    f.customs!.required = false;
    expect(evalGainde(f, "AVAILABLE").satisfaction).toBe("NOT_APPLICABLE");
  });
});

// ===========================================================================
describe("the fact reaches the projection, and stops there", () => {
  it("registration triggers the ONE existing convergence service", () => {
    // Requirement 11, at the authoritative boundary: the Control Tower and the
    // queue both read persisted execution state, so converging the state is
    // what fixes both. No count is patched anywhere.
    const b = actionBody();
    expect(b).toContain("reconcileDossierProcess");
    expect(b).toContain('cause: "gainde_registration"');
    expect(b).toContain("actorId: user.id");
    // …after the RPC, never before: a failed write must not converge anything.
    expect(b.indexOf(".rpc(")).toBeLessThan(b.indexOf("reconcileDossierProcess"));
  });

  it("no second completion architecture was invented", () => {
    // Requirement: reuse. The only completion path remains the WES-5 RPC.
    expect(actionBody()).not.toMatch(/process_step_execution|reconcile_step_completion|from\("process_/);
    expect([...FACT_PROVABLE_STEP_KEYS].sort()).toEqual([
      // `am_dossier_opening` left the set on 2026-09-03 (H-1/H-2): step 3's
      // completion is the Account Manager's readiness act, not a fact.
      "customs_field_clearance",
      "gainde_document_submission", // MAYA-P1.11 — CEO step 9, once ratified
      "gainde_registration",
      "pickup",
      "transport_pod_handoff",
    ]);
  });

  it("the Control Tower still reads persisted state — untouched", () => {
    // Requirement 12. The tower is not taught about GAINDE; it counts open
    // executions as it always has, and now they close for the right reason.
    const t = code(TOWER);
    expect(t).toContain('if (isOpenAt(execs, "gainde_registration")) c.waitingGaindeRegistration++;');
    expect(t).not.toContain("gainde_registered_at");
    expect(t).not.toContain("gaindeRegisteredAt");
  });

  it("registration moves no status and validates nothing", () => {
    // Requirements 5, 6, 7. The migration owns the database half; this is the
    // action half, and neither may grow a transition.
    const b = actionBody();
    expect(b).not.toMatch(/status:|intel_status|reviewed_at|reviewed_by|receivability/);
    expect(b).not.toMatch(/provider_code|provider_synced_at/);
  });

  it("the RPC completes one row and opens no successor", () => {
    const m = code("supabase/migrations/20260727000005_process_reconciliation.sql");
    const fn = m.slice(m.indexOf("create or replace function public.reconcile_step_completion"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("update public.process_step_execution");
    expect(body).toContain("where id = p_execution_id");
    // No successor opening, no instance status move, no customs write.
    expect(body).not.toMatch(/insert into public\.process_step_execution/);
    expect(body).not.toMatch(/update public\.process_instance/);
    expect(body).not.toMatch(/customs_record/);
  });
});

// ===========================================================================
describe("P1.1 survives P1.2 intact", () => {
  it("customs:register remains the sole authority for the act", () => {
    const b = actionBody();
    expect([...b.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(["customs:register"]);
    expect(read("supabase/migrations/20260827000001_gainde_registration.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:register', 'SERVICE'\)/);
  });

  it("no role gained anything — the grants are byte-identical to P1.1", () => {
    // Requirements 9 and 10. P1.2 is a projection phase; it touches no RBAC.
    const roles = read("lib/platform/role-templates.ts");
    const block = (k: string) => {
      const i = roles.indexOf(`key: "${k}"`);
      const j = roles.indexOf('key: "', i + 6);
      return roles.slice(i, j === -1 ? undefined : j);
    };
    expect(block("FINANCE_OFFICER")).not.toMatch(/"customs:/);
    const cfo = block("CUSTOMS_FINANCE_OFFICER");
    expect(cfo).toContain('"customs:register"');
    for (const denied of ["create", "update", "delete", "release", "validate", "assign"]) {
      expect(cfo, `customs:${denied}`).not.toContain(`"customs:${denied}"`);
    }
  });

  it("duplicate refused, correction allowed — unchanged", () => {
    // Requirement 4.
    const m = read("supabase/migrations/20260827000001_gainde_registration.sql");
    expect(m).toContain("this GAINDE reference is already recorded");
    expect(m).toMatch(/'corrected', v_prev is not null/);
    expect(actionBody()).toContain('"reference_unchanged"');
  });

  it("QC4 is unchanged and still says « saisie manuelle »", () => {
    // Requirement 8, and section J: a completed process step is not a
    // synchronisation. QC4 derives from the customs record, not the engine.
    const e = deriveQC4({
      canReadCustoms: true, canReadDocuments: true,
      customs: {
        id: "c1", fileId: "f1", status: "DECLARED", required: true,
        declarationNumber: null, customsOffice: null, regime: null, declarationDate: null,
        baeReference: null, releaseDate: null, inspectionStatus: "NOT_REQUIRED",
        externalRef: "UAT-GAINDE-P11-002", notes: null,
        receivabilityStatus: null, receivabilityAt: null, receivabilityNote: null,
        providerCode: "manual", providerSyncedAt: null,
        reviewedAt: null, reviewedByEmail: null,
        gaindeRegisteredAt: REGISTERED, gaindeRegisteredByEmail: null,
        attachmentCompletedAt: null, attachmentCompletedByEmail: null, attachmentSystems: [],
        shPositionCount: null, declarationType: null, dpiRegime: null,
        exemptionTitleOrigin: null, tariffClassificationOrigin: null,
      } satisfies CustomsRecord,
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "customsTracking")!;
    expect(c.value).toContain("saisie manuelle");
    expect(c.reason).toMatch(/aucune intégration/i);
    expect(code("lib/files/qc4.ts")).not.toContain("gainde_registration");
  });

  it("no migration was needed — the durable fact already exists", () => {
    // Section M: 106 is not created merely because this is a new phase. The
    // rule, the read and the trigger are all code; the fact shipped in 105.
    const bi = read("lib/platform/ops/build-info.ts");
    // MAYA-P1.11 made this a moving number. What the phase actually meant is
    // that the ledger stays self-consistent, which is durable.
    expect(readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql")).length)
      .toBe(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    // LATEST_MIGRATION moves with every migration; the ledger-consistency
    // check above is the durable form of « this phase added none ».
  });
});
