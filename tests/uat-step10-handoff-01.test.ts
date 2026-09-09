/**
 * UAT-STEP10-HANDOFF-01 — the UI must not be stricter than the engine.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it executed on EFT-IMP-2026-00011. Finance completed step 9,
 * promotion opened step 10 `coordinator_to_declarant` — AVAILABLE, unclaimed,
 * one attempt, no blocking requirement, owning role COORDINATOR, and the
 * signed-in account holding exactly that role. The Coordinator read:
 *
 *     « Bloquée »
 *     « Le dossier doit d'abord être formellement transmis au service suivant. »
 *
 * The engine disagreed. Probed with those same facts:
 *
 *     ENGINE custodyRefusal → null        (activateStep would ACCEPT)
 *     UI     canStart       → false
 *
 * WHY. `custodyRefusal` blocks on `awaiting_transmission` only where the route
 * sets `requiresReception: true`. Three of the four governed routes set it
 * FALSE on purpose — turning it on would strand any dossier that reached its
 * target by promotion — and step 10's inbound route is one of them.
 * `step-eligibility` and `contextual/view` each held their own copy of the
 * rule, written before `requiresReception` existed, and blocked on the bare
 * state. The UI refused work the server would have run.
 *
 * WHAT THIS SUITE PROTECTS. Not the instance — the CLASS. The custody decision
 * now exists once, in `custodyRefusalForState`, and the parity test below walks
 * EVERY route and EVERY custody state to prove no surface can diverge from it
 * again.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HANDOFF_ROUTES,
  custodyRefusal,
  custodyRefusalForState,
  custodyStateFor,
  routeTo,
  type CustodyState,
} from "@/lib/process/handoff-routes";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { contextualStatus } from "@/lib/process/contextual/view";
import { deriveTransitStages } from "@/lib/process/transit";
import { getStep } from "@/lib/process/effitrans-process";
import { ALL_NODES } from "@/lib/process/engine/state";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const eligibility = read("lib/process/step-eligibility.ts");
const view = read("lib/process/contextual/view.ts");
const banner = read("components/files/transit-handoff.tsx");
const intake = read("lib/process/engine/intake-actions.ts");
const panel = read("components/process/transit-panel.tsx");
const dossierPage = read("app/files/[id]/page.tsx");

const ALL_CUSTODY: CustodyState[] = [
  "not_applicable",
  "awaiting_transmission",
  "awaiting_reception",
  "received",
];

/** EFT-IMP-2026-00011's Coordinator: ACCOUNT_MANAGER + COORDINATOR, active. */
const COORD = {
  userId: "u-coordinator",
  permissions: ["process:handoff:send", "process:handoff:receive", "process:read"],
  roles: ["ACCOUNT_MANAGER", "COORDINATOR"],
};

/** Step 10 exactly as production holds it after Finance's payment. */
const step10 = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: "coordinator_to_declarant",
  state: "AVAILABLE",
  assignedUserId: null,
  custody: "awaiting_transmission", // no handoff targets step 10 — and none is required
  owningRole: "COORDINATOR",
  missingPrerequisites: [],
  requirements: [],
  notApplicable: null,
  ...over,
});

// ===========================================================================
// A. ROUTE-WIDE PARITY — the class, not the instance
// ===========================================================================
describe("A — no surface may contradict the engine's custody rule", () => {
  it("the rule exists ONCE, and the row-reading form delegates to it", () => {
    const routes = read("lib/process/handoff-routes.ts");
    expect(routes).toContain("export function custodyRefusalForState(");
    // `custodyRefusal` must not re-implement the predicate.
    const rowForm = routes.slice(
      routes.indexOf("export function custodyRefusal("),
      routes.indexOf("// ============================================================ Transit custody"),
    );
    expect(rowForm).toContain("custodyRefusalForState(toStepKey, custodyStateFor(toStepKey, handoffs))");
    expect(rowForm, "the predicate may not live here too").not.toMatch(/requiresReception/);
  });

  it("EVERY route × EVERY custody state: eligibility agrees with custodyRefusal", () => {
    for (const route of HANDOFF_ROUTES) {
      for (const custody of ALL_CUSTODY) {
        const engine = custodyRefusalForState(route.toStepKey, custody);
        const el = evaluateStepAction(
          step10({ stepKey: route.toStepKey, custody, owningRole: null }),
          { userId: "u", permissions: [], roles: [] },
        );
        expect(
          el.custodyRefusal,
          `${route.toStepKey} / ${custody}: UI says ${el.custodyRefusal}, engine says ${engine}`,
        ).toBe(engine);
      }
    }
  });

  it("…and the ROW form agrees too, from real handoff rows", () => {
    const rows = (status: string | null, to: string) => (status ? [{ toStepKey: to, status }] : []);
    for (const route of HANDOFF_ROUTES) {
      for (const status of [null, "SENT", "RECEIVED"]) {
        const handoffs = rows(status, route.toStepKey);
        const custody = custodyStateFor(route.toStepKey, handoffs);
        expect(custodyRefusal(route.toStepKey, handoffs)).toBe(
          custodyRefusalForState(route.toStepKey, custody),
        );
      }
    }
  });

  it("a step NO route targets is never custody-blocked, whatever it is handed", () => {
    // The old fixtures set custody states on unrouted steps and the evaluator
    // believed them. `custodyStateFor` answers `not_applicable` for these, so
    // those states were never reachable — and the tests that used them passed
    // on facts production cannot produce.
    const unrouted = ALL_NODES.map((n) => n.key).filter((k) => routeTo(k) === null);
    expect(unrouted.length).toBeGreaterThan(20);
    for (const key of unrouted) {
      for (const custody of ALL_CUSTODY) {
        expect(custodyRefusalForState(key, custody), `${key}/${custody}`).toBeNull();
        expect(custodyStateFor(key, [{ toStepKey: key, status: "SENT" }])).toBe("not_applicable");
      }
    }
  });

  it("the two surfaces read the verdict, not the raw state", () => {
    expect(eligibility).toContain("custodyRefusalForState(facts.stepKey, facts.custody)");
    expect(eligibility).toContain("const custodyBlocked = custodyRefusalCode !== null");
    expect(view).toContain("const custodyStopped = e.custodyRefusal !== null");
    // Neither may re-derive it from the state.
    expect(view).not.toMatch(/e\.custody === "awaiting_transmission"/);
    const decide = eligibility.slice(
      eligibility.indexOf("export function evaluateStepAction"),
      eligibility.indexOf("function reasonFor"),
    );
    expect(decide).not.toMatch(/custody === "awaiting_transmission"/);
  });
});

// ===========================================================================
// B. THE EXACT STEP-10 REGRESSION
// ===========================================================================
describe("B — step 10 on EFT-IMP-2026-00011 is actionable for its Coordinator", () => {
  it("the route is the one production has, and it does not require reception", () => {
    const route = routeTo("coordinator_to_declarant")!;
    expect(route.fromStepKey).toBe("gainde_registration");
    expect(route.requiresReception).toBe(false);
    expect(getStep("coordinator_to_declarant")!.prerequisites).toEqual(["gainde_registration"]);
    expect(getStep("coordinator_to_declarant")!.role).toBe("COORDINATOR");
  });

  it("canStart = true, no false transmission reason, status not « Bloquée »", () => {
    const el = evaluateStepAction(step10(), COORD);
    expect(el.canStart, "the Coordinator must be able to claim step 10").toBe(true);
    expect(el.custodyRefusal).toBeNull();
    expect(el.reasonFr).toBeNull();
    expect(el.isOwner).toBe(true);
    expect(el.mayAct).toBe(true);

    const status = contextualStatus("AVAILABLE", el);
    expect(status.key).not.toBe("bloquee");
    expect(status.labelFr).not.toBe("Bloquée");
    expect(status.key).toBe("a_votre_tour");
  });

  it("…and once claimed, the Coordinator may submit it", () => {
    const el = evaluateStepAction(
      step10({ state: "ACTIVE", assignedUserId: COORD.userId }),
      COORD,
    );
    expect(el.canSubmit).toBe(true);
    expect(el.reasonFr).toBeNull();
  });

  it("the engine and the surface now say the same thing about it", () => {
    const handoffs = [{ toStepKey: "coordinator_reception", status: "RECEIVED" }]; // the only row on 00011
    const custody = custodyStateFor("coordinator_to_declarant", handoffs);
    expect(custody).toBe("awaiting_transmission");
    expect(custodyRefusal("coordinator_to_declarant", handoffs)).toBeNull();
    expect(evaluateStepAction(step10({ custody }), COORD).canStart).toBe(true);
  });
});

// ===========================================================================
// C + D. THE CONTROLS — custody governance is intact
// ===========================================================================
describe("C/D — custody still stops what it is supposed to stop", () => {
  it("C — a strict route with nothing transmitted is still blocked", () => {
    const route = routeTo("coordinator_reception")!;
    expect(route.requiresReception, "step 4 is the strict route").toBe(true);
    expect(custodyRefusal("coordinator_reception", [])).toBe("handoff_not_sent");

    const el = evaluateStepAction(
      step10({ stepKey: "coordinator_reception", custody: "awaiting_transmission", owningRole: "CHIEF_OF_TRANSIT" }),
      { userId: "u-chef", permissions: ["process:handoff:receive", "process:handoff:send"], roles: ["CHIEF_OF_TRANSIT"] },
    );
    expect(el.canStart).toBe(false);
    expect(el.custodyRefusal).toBe("handoff_not_sent");
    expect(el.reasonFr).toBe("Le dossier doit d'abord être formellement transmis au service suivant.");
    expect(contextualStatus("AVAILABLE", el).key).toBe("bloquee");
  });

  it("D — SENT but not RECEIVED is awaiting_reception, and blocks EVERY route", () => {
    for (const route of HANDOFF_ROUTES) {
      const handoffs = [{ toStepKey: route.toStepKey, status: "SENT" }];
      expect(custodyStateFor(route.toStepKey, handoffs)).toBe("awaiting_reception");
      expect(custodyRefusal(route.toStepKey, handoffs)).toBe("handoff_reception_required");

      const el = evaluateStepAction(
        step10({ stepKey: route.toStepKey, custody: "awaiting_reception", owningRole: "COORDINATOR" }),
        COORD,
      );
      expect(el.canStart, route.toStepKey).toBe(false);
      expect(el.awaitingReception).toBe(true);
      expect(el.reasonFr).toBe("Le transfert doit d'abord être réceptionné.");
    }
  });

  it("a RECEIVED transfer unlocks, and never re-blocks", () => {
    for (const route of HANDOFF_ROUTES) {
      const handoffs = [{ toStepKey: route.toStepKey, status: "RECEIVED" }];
      expect(custodyStateFor(route.toStepKey, handoffs)).toBe("received");
      expect(custodyRefusal(route.toStepKey, handoffs)).toBeNull();
    }
  });
});

// ===========================================================================
// E. STEP 11 GOVERNANCE — the Déclarant still waits for the handoff
// ===========================================================================
describe("E — step 11 stays governed", () => {
  const DECLARANT = {
    userId: "u-declarant",
    permissions: ["customs:create", "customs:update", "process:handoff:receive"],
    roles: ["CUSTOMS_DECLARANT"],
  };

  it("step 11 waits on step 10 — prerequisite, not custody", () => {
    // Both halves of the customs return: Finance's registration AND the
    // Coordinator's handover. Neither is weakened here.
    expect(getStep("gainde_document_submission")!.prerequisites).toEqual([
      "coordinator_to_declarant",
      "gainde_registration",
    ]);
    expect(getStep("gainde_document_submission")!.role).toBe("CUSTOMS_DECLARANT");
  });

  it("the Déclarant cannot begin step 11 while step 10 is unfinished", () => {
    const el = evaluateStepAction(
      step10({
        stepKey: "gainde_document_submission",
        state: "PENDING",
        owningRole: "CUSTOMS_DECLARANT",
        custody: "not_applicable",
        missingPrerequisites: ["coordinator_to_declarant"],
        blockedReason: "Prérequis manquants : coordinator_to_declarant",
      }),
      DECLARANT,
    );
    expect(el.canStart).toBe(false);
    expect(el.canSubmit).toBe(false);
  });

  it("…and step 10 is NOT auto-completed by anything in this repair", () => {
    // Nothing here writes state. Both modules are PURE read-side deciders:
    // they import no engine action and no database client, so no path through
    // them can transition, complete or reconcile a step. (Their prose names
    // `activateStep` when explaining what the server does — hence a pin on
    // IMPORTS, not on words.)
    const NL = String.fromCharCode(10);
    for (const [name, src] of [["step-eligibility", eligibility], ["view", view]] as const) {
      for (const line of src.split(NL).filter((l) => l.trimStart().startsWith("import "))) {
        expect(line, `${name} must import no writer`).not.toMatch(
          /engine\/actions|supabase|server-only|reconcile/,
        );
      }
      expect(src, `${name} must not call a transition`).not.toMatch(
        /await\s+(submitStep|activateStep|promoteSuccessors|approveStep)\(/,
      );
    }
  });
});

// ===========================================================================
// F. THE HISTORICAL TRANSIT BANNER
// ===========================================================================
describe("F — a received handoff stops claiming reception is outstanding", () => {
  it("SENT and RECEIVED are two facts, and the state carries both", () => {
    expect(intake).toContain("handoffReceived: boolean;");
    expect(intake).toMatch(
      /handoffReceived = \(snap\?\.handoffs \?\? \[\]\)\.some\([\s\S]{0,140}h\.status === "RECEIVED"/,
    );
    // `handoffSent` keeps its meaning — « has been handed over » — so the
    // « transmettre » button stays absent on a received dossier.
    expect(intake).toMatch(/h\.status === "SENT" \|\| h\.status === "RECEIVED"/);
  });

  it("the banner renders the received state first, and says so in the past", () => {
    const received = banner.indexOf("if (handoffReceived)");
    const sent = banner.indexOf("if (handoffSent)");
    expect(received).toBeGreaterThan(-1);
    expect(received, "received must be answered before sent").toBeLessThan(sent);
    expect(banner).toContain("Dossier reçu par le Transit");
    const receivedBlock = banner.slice(received, sent);
    expect(receivedBlock).not.toContain("réception à confirmer");
    expect(receivedBlock).not.toContain("doit");
  });

  it("the dossier page passes the new fact", () => {
    expect(dossierPage).toContain("handoffReceived={intakeState.handoffReceived}");
  });
});

// ===========================================================================
// G. THE ROUTE LABEL
// ===========================================================================
describe("G — a custody status names its own route, never « au Transit »", () => {
  it("the panel's generic label names no service", () => {
    expect(panel).toContain('awaiting_transmission: "À transmettre"');
    expect(panel).not.toContain('"À transmettre au Transit"');
    expect(panel).toContain("stageStatusLabel(s.status, s.custodyRouteLabelFr)");
  });

  it("the projection carries the route's own words", () => {
    const execs = [
      { stepKey: "am_dossier_opening", state: "COMPLETED" as const },
      { stepKey: "coordinator_reception", state: "AVAILABLE" as const },
    ];
    const t1 = deriveTransitStages(execs, [])[0];
    expect(t1.status).toBe("awaiting_transmission");
    expect(t1.custodyRouteLabelFr).toBe("Transmission des Opérations au Transit");
  });

  it("…and T7 no longer announces a Transit transfer nobody is waiting for", () => {
    // Steps 10 + 11 as EFT-IMP-2026-00011 holds them. The route into step 10
    // is « Retour de la Finance douane à la Coordination » and requires no
    // reception, so the stage is simply available.
    const t7 = deriveTransitStages(
      [
        { stepKey: "coordinator_to_declarant", state: "AVAILABLE" },
        { stepKey: "gainde_document_submission", state: "PENDING" },
      ],
      [{ toStepKey: "coordinator_reception", status: "RECEIVED" }],
    ).find((s) => s.key === "T7")!;
    expect(t7.status, "nothing is owed here").toBe("available");
    expect(t7.custodyRouteLabelFr).toBeNull();
  });

  it("a genuinely outstanding transfer still names itself, and it is not Transit", () => {
    const stage = deriveTransitStages(
      [{ stepKey: "collections", state: "AVAILABLE" }],
      [{ toStepKey: "collections", status: "SENT" }],
    ).find((s) => s.stepKeys.includes("collections"));
    if (stage) {
      expect(stage.status).toBe("awaiting_reception");
      expect(stage.custodyRouteLabelFr).toBe("Remise de l'Administration au Recouvrement");
    }
  });
});

// ===========================================================================
// H. WHAT DOES *NOT* BLOCK STEP 10
// ===========================================================================
describe("H — step 10 waits for step 9 and for nothing else", () => {
  it("its only prerequisite is step 9", () => {
    expect(getStep("coordinator_to_declarant")!.prerequisites).toEqual(["gainde_registration"]);
  });

  it("no parallel activity and no transport step is among its prerequisites", () => {
    const prereqs = getStep("coordinator_to_declarant")!.prerequisites as readonly string[];
    for (const notAPrereq of [
      "transport_assignment",       // step 14
      "pickup",
      "customs_field_clearance",    // BAE
      "billing_draft",              // invoice
      "am_transport_pre_gate",
      "am_bad",
      "transport_readiness",
    ]) {
      expect(prereqs, notAPrereq).not.toContain(notAPrereq);
    }
  });

  it("the parallel activities are not prerequisites of step 10, whatever their state", () => {
    // Pre-Gate and BAD are declared as parallel activities; step 10 is in the
    // customs branch and converges with them only at pickup (step 15).
    const stepKeys = new Set(
      ALL_NODES.filter((n) => "stepNumber" in n && typeof n.stepNumber === "number").map((n) => n.key),
    );
    const activityKeys = ALL_NODES.map((n) => n.key).filter((k) => !stepKeys.has(k));
    expect(activityKeys.length, "the three parallel activities").toBe(3);
    for (const key of activityKeys) {
      expect(getStep("coordinator_to_declarant")!.prerequisites).not.toContain(key);
    }
  });

  it("step 10's eligibility is unaffected by every one of them", () => {
    // The evaluator is handed nothing about transport, BAE, vehicles, drivers,
    // invoices or the dossier's lifecycle status — so none of them can reach
    // it. Proven by construction: the fact set has no field for any of them.
    const el = evaluateStepAction(step10(), COORD);
    expect(el.canStart).toBe(true);
    const factKeys = Object.keys(step10());
    for (const absent of ["transport", "vehicle", "driver", "invoice", "bae", "lifecycle", "status"]) {
      expect(
        factKeys.filter((k) => k.toLowerCase().includes(absent) && k !== "state"),
        `no ${absent} fact reaches step eligibility`,
      ).toEqual([]);
    }
  });

  it("and no blocking requirement is declared for step 10 at all", () => {
    expect(getStep("coordinator_to_declarant")!.requiredDocuments).toEqual([]);
    const el = evaluateStepAction(step10(), COORD);
    expect(el.requirements).toEqual([]);
    expect(el.unauthorized).toBe(false);
  });
});
