/**
 * OPS-UAT-CONVERGENCE-01 — the workflow has to be usable before UAT resumes.
 * ---------------------------------------------------------------------------
 * Five ratified slices, one suite, because they are one problem: an operator
 * opening EFT-IMP-2026-00011 was told four different things about what to do.
 *
 *   OPS-SERVICE-SCOPE-01  a dossier does not require every Effitrans service
 *   OPS-LENIENCY-01       an unknown requirement is not a blocker
 *   OPS-NEXT-ACTION-01    one canonical current/parallel/upcoming model
 *   APP-NAVIGATION-01     Back / Forward in the shell
 *   §11                   26 official steps + 3 parallel activities ≠ 29 steps
 *
 * THE NUMBERING FOLLOWS THE BRIEF'S §22 TEST MATRIX so a reader can check
 * coverage against the requirement rather than against this file's structure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SERVICE_KEYS,
  STEP_SERVICE,
  UNRATIFIED_STEP_SERVICES,
  UNKNOWN_SCOPE,
  inapplicableStepsForScope,
  normalizeServices,
  scopeFromFileType,
  scopeFromRow,
  scopeLabelFr,
  stepApplicability,
  stepAppliesToScope,
  type ServiceScope,
} from "@/lib/process/service-scope";
import {
  CLASSIFIED,
  blockingRequirements,
  blocksCompletion,
  governanceFor,
} from "@/lib/process/requirement-class";
import { buildDossierWork, type WorkNode } from "@/lib/process/work-model";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { buildStepFacts } from "@/lib/process/contextual/build";
import { contextualStatus, worthShowing } from "@/lib/process/contextual/view";
import {
  EFFITRANS_PROCESS,
  PARALLEL_ACTIVITIES,
  PROCESS_STEP_COUNT,
} from "@/lib/process/effitrans-process";
import { STEP_APPLICABILITY, stepAppliesToFileType } from "@/lib/process/applicability";
import { advance } from "@/components/shell/history-nav";
import type { StepEvidence } from "@/lib/process/engine/evidence";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every application source file, repo-relative, for the exhaustive census. */
function walk(dir: string, base = dir, out: string[] = []): string[] {
  const SKIP = new Set(["node_modules", ".next", ".git", "supabase", "docs", "scripts", "public"]);
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p.slice(base.length).replace(/^\/+/, ""));
  }
  return out;
}


// --------------------------------------------------------------- fixtures ---

const CUSTOMS_ONLY: ServiceScope = { customs: "APPLICABLE", transport: "NOT_APPLICABLE", source: "STORED" };
const TRANSPORT_ONLY: ServiceScope = { customs: "NOT_APPLICABLE", transport: "APPLICABLE", source: "STORED" };
const BOTH: ServiceScope = { customs: "APPLICABLE", transport: "APPLICABLE", source: "STORED" };

const DECLARANT = { userId: "u-dec", permissions: ["customs:create", "customs:update"], roles: ["CUSTOMS_DECLARANT"] };
const TRANSPORT = { userId: "u-tra", permissions: ["transport:assign"], roles: ["TRANSPORT_OFFICER"] };
const ADMIN = {
  userId: "u-adm",
  permissions: ["customs:create", "customs:update", "transport:assign", "process:manage", "document:create"],
  roles: ["SYSTEM_ADMIN"],
};

function facts(over: Partial<StepActionFacts> = {}): StepActionFacts {
  return {
    stepKey: "customs_preparation",
    state: "AVAILABLE",
    assignedUserId: null,
    custody: "not_applicable",
    owningRole: "CUSTOMS_DECLARANT",
    missingPrerequisites: [],
    requirements: [],
    notApplicable: null,
    ...over,
  };
}

/** A work node with a real eligibility verdict behind it. */
function node(over: Partial<WorkNode> & { stepKey: string }, viewer = DECLARANT): WorkNode {
  const registry = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].find((n) => n.key === over.stepKey);
  const f = facts({
    stepKey: over.stepKey,
    state: over.state ?? "PENDING",
    owningRole: null,
    assignedUserId: over.assigneeLabel ? "someone" : null,
  });
  return {
    stepNumber: registry?.stepNumber ?? null,
    labelFr: registry?.labelFr ?? over.stepKey,
    state: over.state ?? "PENDING",
    branch: registry?.parallelGroup ?? "main",
    ownerLabelFr: null,
    assigneeLabel: over.assigneeLabel ?? null,
    eligibility: over.eligibility ?? evaluateStepAction(f, viewer),
    ...over,
  } as WorkNode;
}

const work = (nodes: WorkNode[]) =>
  buildDossierWork({ nodes, officialTotal: PROCESS_STEP_COUNT, activitiesTotal: PARALLEL_ACTIVITIES.length });

const evidence = (items: StepEvidence["items"]): StepEvidence => ({
  items,
  satisfied: [],
  missing: items.filter((i) => i.status === "missing").map((i) => i.key),
  invalid: [],
  pendingReview: [],
  unauthorized: [],
  complete: false,
});

// ===========================================================================
// SERVICE SCOPE — §22.1 … §22.7
// ===========================================================================

describe("service scope — a dossier does not require every Effitrans service", () => {
  it("01 — a dédouanement-only dossier does not block on transport work", () => {
    // The step keeps its execution row and its history. It simply is not
    // outstanding, is not missing, and does not hold the graph shut.
    for (const key of ["transport_assignment", "bon_a_delivrer", "pre_gate"]) {
      const a = stepApplicability(key, CUSTOMS_ONLY);
      expect(a.applicable, key).toBe(false);
      expect(a.applicable ? "" : a.reasonFr).toContain("transport non demandé");
    }
    // And the join gate opens: a transport prerequisite that does not apply
    // cannot be an outstanding prerequisite.
    const f = buildStepFacts({
      stepKey: "pickup",
      state: "PENDING",
      assignedUserId: null,
      handoffs: [],
      views: [
        { stepKey: "customs_field_clearance", state: "COMPLETED" },
        { stepKey: "transport_assignment", state: "PENDING" },
      ],
      evidence: evidence([]),
      owningRole: null,
      scope: CUSTOMS_ONLY,
    });
    expect(f.missingPrerequisites).toEqual([]);
  });

  it("02 — a transport-only dossier does not block on customs work", () => {
    for (const key of Object.keys(STEP_APPLICABILITY)) {
      expect(stepAppliesToScope(key, TRANSPORT_ONLY), key).toBe(false);
    }
    const f = buildStepFacts({
      stepKey: "pickup",
      state: "PENDING",
      assignedUserId: null,
      handoffs: [],
      views: [
        { stepKey: "customs_field_clearance", state: "PENDING" },
        { stepKey: "transport_assignment", state: "COMPLETED" },
      ],
      evidence: evidence([]),
      owningRole: null,
      scope: TRANSPORT_ONLY,
    });
    // THE LIVE DEFECT THIS CLOSES. EFT-TRP-2026-00001 carries 29 execution
    // rows with only `cotation` skipped, so its nine customs steps sit PENDING
    // forever — and `pickup` waits on `customs_field_clearance`, which will
    // never become terminal. The dossier is permanently unreachable past
    // step 14.
    expect(f.missingPrerequisites).toEqual([]);
  });

  it("03 — with both services, both domains are evaluated exactly as today", () => {
    for (const key of [...Object.keys(STEP_SERVICE)]) {
      expect(stepAppliesToScope(key, BOTH), key).toBe(true);
    }
    expect(inapplicableStepsForScope(BOTH)).toEqual([]);
  });

  it("04 — a non-applicable step is « sans objet », never failed and never blocked", () => {
    const el = evaluateStepAction(
      facts({ notApplicable: { service: "customs", reasonFr: "Non applicable — dédouanement non demandé sur ce dossier." } }),
      DECLARANT,
    );
    expect(el.canStart).toBe(false);
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toContain("Non applicable");
    // NOT « bloquée ». The vocabulary matters: a blocked step is work someone
    // must unblock, and this is work nobody bought.
    expect(contextualStatus("AVAILABLE", el).key).toBe("sans_objet");
    expect(contextualStatus("AVAILABLE", el).labelFr).toBe("Sans objet");
  });

  it("05 — and it requires no evidence", () => {
    const el = evaluateStepAction(
      facts({
        notApplicable: { service: "customs", reasonFr: "Non applicable — dédouanement non demandé sur ce dossier." },
        requirements: [{ key: "CUSTOMS_DOSSIER", labelFr: "Dossier", status: "missing" }],
      }),
      DECLARANT,
    );
    expect(el.requirements[0].klass).toBe("NOT_APPLICABLE");
    expect(el.requirements[0].blocking).toBe(false);
    expect(el.requirements[0].messageFr).toContain("Sans objet");
    // Nor is it repeated as a contextual card: /process carries the complete
    // picture and a dossier page full of « not requested » is noise.
    expect(worthShowing("AVAILABLE", el)).toBe(false);
  });

  it("06 — a scope that was never recorded is UNKNOWN, and UNKNOWN invents nothing", () => {
    // The ratified rule for the twelve production dossiers that predate the
    // column: « If it cannot be established safely: mark service scope UNKNOWN,
    // do not invent it. »
    for (const services of [null, undefined, [], ["nonsense"]]) {
      const scope = scopeFromRow({ type: "IMP", services: services as string[] | null });
      expect(scope.source, String(services)).toBe("DERIVED_FROM_TYPE");
    }
    expect(normalizeServices([])).toBeNull();
    expect(normalizeServices(["customs", "customs", "bogus"])).toEqual(["customs"]);

    // An IMP dossier: customs is ratified (Phase 9.0B), transport is NOT ruled.
    const imp = scopeFromFileType("IMP");
    expect(imp.customs).toBe("APPLICABLE");
    expect(imp.transport).toBe("UNKNOWN");
    // …and UNKNOWN removes NOTHING. This is the safety property that lets the
    // model ship against live dossiers.
    expect(inapplicableStepsForScope(imp)).toEqual([]);
    expect(inapplicableStepsForScope(UNKNOWN_SCOPE)).toEqual([]);
    expect(scopeLabelFr(imp)).toContain("à préciser");
  });

  it("07 — the official step count is 26, and the registry says so", () => {
    expect(EFFITRANS_PROCESS.filter((s) => typeof s.stepNumber === "number")).toHaveLength(26);
    expect(PROCESS_STEP_COUNT).toBe(26);
    expect(PARALLEL_ACTIVITIES).toHaveLength(3);
    // No renumbering: 1..26, contiguous and unique.
    expect(EFFITRANS_PROCESS.map((s) => s.stepNumber)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    );
  });

  it("07b — the new model reproduces the ratified Phase-9.0B answer exactly", () => {
    // Two sources for one question is how they drift. The customs half of
    // STEP_SERVICE must agree with STEP_APPLICABILITY for every dossier type,
    // and the equivalence is asserted rather than assumed.
    for (const type of ["IMP", "EXP", "TRP", "HND"]) {
      const scope = scopeFromFileType(type);
      for (const key of Object.keys(STEP_APPLICABILITY)) {
        expect(stepAppliesToScope(key, scope), `${type}/${key}`)
          .toBe(stepAppliesToFileType(key, type));
      }
    }
  });

  it("07c — every step→service binding is either cited or declared unratified", () => {
    for (const [key, b] of Object.entries(STEP_SERVICE)) {
      expect(SERVICE_KEYS, key).toContain(b.service);
      // A real registry node, so a typo cannot bind nothing.
      expect([...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].some((n) => n.key === key), key).toBe(true);
      if (b.ratified) expect(b.source.length, key).toBeGreaterThan(40);
      else expect(b.source, key).toBe("");
    }
    // The transport half is a PROPOSAL. Nothing first-party says which official
    // steps fall away when Effitrans clears customs and the client collects, so
    // it is declared unruled rather than quietly asserted (RQ-SS-1..3).
    expect(UNRATIFIED_STEP_SERVICES.length).toBeGreaterThan(0);
    for (const k of UNRATIFIED_STEP_SERVICES) expect(STEP_SERVICE[k].service).toBe("transport");
  });
});

// ===========================================================================
// LENIENCY — §22.8 … §22.15
// ===========================================================================

describe("leniency — governance without unnecessary friction", () => {
  it("08 — an unknown business requirement is NOT automatically a hard gate", () => {
    // The ratified default rule, in one line.
    const g = governanceFor("customs_preparation", "SOMETHING_NOBODY_RULED_ON");
    expect(g.klass).toBe("FLAG_FOR_RULING");
    expect(g.ratified).toBe(false);
    expect(blocksCompletion(g)).toBe(false);
  });

  it("09 — a ratified HARD gate still blocks, at the surface AND at the server", () => {
    const el = evaluateStepAction(
      facts({
        state: "ACTIVE",
        assignedUserId: DECLARANT.userId,
        requirements: [{ key: "CUSTOMS_DOSSIER", labelFr: "Dossier", status: "missing" }],
      }),
      DECLARANT,
    );
    expect(el.canSubmit).toBe(false);
    expect(el.requirements[0].blocking).toBe(true);
    // ONE classifier, read by both. A button offered against an engine that
    // refuses is the defect this whole programme exists to end.
    expect(
      blockingRequirements("customs_preparation", evidence([{ key: "CUSTOMS_DOSSIER", labelFr: "Dossier", status: "missing" }])),
    ).toHaveLength(1);
    expect(code("lib/process/engine/actions.ts")).toContain("blockingRequirements(stepKey, ev)");
  });

  it("10 — a SOFT gate warns, names its checkpoint, and permits the transition", () => {
    const el = evaluateStepAction(
      facts({
        stepKey: "bon_a_delivrer",
        state: "ACTIVE",
        owningRole: null,
        assignedUserId: DECLARANT.userId,
        requirements: [{ key: "BON_A_DELIVRER", labelFr: "Bon à Délivrer", status: "missing" }],
      }),
      { ...DECLARANT, permissions: ["document:create"] },
    );
    expect(el.requirements[0].klass).toBe("SOFT_GATE");
    expect(el.requirements[0].blocking).toBe(false);
    expect(el.requirements[0].messageFr).toContain("Information à compléter");
    expect(el.requirements[0].messageFr).toContain("étape 15");
    expect(el.canSubmit).toBe(true);
  });

  it("11 — INFORMATIONAL never blocks", () => {
    expect(blocksCompletion({ klass: "INFORMATIONAL", ratified: true, mandatoryAtFr: null, source: "x" })).toBe(false);
  });

  it("12 — NOT_APPLICABLE never blocks", () => {
    expect(blocksCompletion({ klass: "NOT_APPLICABLE", ratified: true, mandatoryAtFr: null, source: "x" })).toBe(false);
  });

  it("13 — security and ownership stay fail-closed", () => {
    // A foreign role holding the permission is still not the owner.
    const el = evaluateStepAction(facts(), { userId: "u-chef", permissions: ["customs:create", "customs:update"], roles: ["CHIEF_TRANSIT"] });
    expect(el.mayAct).toBe(true);
    expect(el.isOwner).toBe(false);
    expect(el.canStart).toBe(false);

    // `unauthorized` is an AUTHORITY fact and no classification may soften it.
    const blind = evaluateStepAction(
      facts({
        state: "ACTIVE",
        assignedUserId: DECLARANT.userId,
        requirements: [{ key: "ANYTHING_UNRULED", labelFr: "Pièce", status: "unauthorized" }],
      }),
      DECLARANT,
    );
    expect(blind.requirements[0].blocking).toBe(true);
    expect(blind.canSubmit).toBe(false);
    // The classifier is not even consulted for it.
    expect(blockingRequirements("customs_preparation", evidence([{ key: "X", labelFr: "P", status: "unauthorized" }]))).toHaveLength(0);
    expect(code("lib/process/engine/actions.ts")).toContain('fail("evidence_unauthorized")');
  });

  it("14 — maker/checker remains non-bypassable", () => {
    // The maker's own artefact is HARD on both sides of the pair, so neither
    // half of a four-eyes control can be completed on nothing.
    for (const step of ["customs_preparation", "transit_validation"]) {
      expect(governanceFor(step, "CUSTOMS_DOSSIER").klass, step).toBe("HARD_GATE");
    }
    // And the review itself is untouched by any of this.
    expect(code("lib/process/engine/actions.ts")).toContain("requiresIndependentReview(stepKey)");
    expect(code("lib/process/engine/state.ts")).toContain("self_validation_forbidden");
  });

  it("15 — the unclassified BAD / Pre-Gate no longer claim to be ratified blockers", () => {
    // ⚠ §8, VERBATIM FROM PRODUCTION. Dossier 00011 displayed « Account Manager
    // — obtenir le Bon à Délivrer » and « … l'autorisation Pre-Gate » as
    // « bloquante aujourd'hui ; sa classification est en attente de
    // ratification » — internal governance bookkeeping printed on an operator's
    // screen, presenting two unexamined requirements as confirmed blockers.
    //
    // They are now SOFT with a cited checkpoint: the registry's own pickup join
    // gate is what makes them mandatory, at step 15.
    for (const [step, key] of [
      ["bon_a_delivrer", "BON_A_DELIVRER"],
      ["pre_gate", "PRE_GATE_AUTHORIZATION"],
    ] as const) {
      const g = governanceFor(step, key);
      expect(g.klass, step).toBe("SOFT_GATE");
      expect(g.ratified, step).toBe(true);
      expect(g.mandatoryAtFr, step).toContain("étape 15");
      expect(g.source, step).toContain("PICKUP_READINESS");
      expect(blocksCompletion(g), step).toBe(false);
    }
    // The sentence itself is gone from the codebase.
    expect(code("lib/process/requirement-class.ts")).not.toContain("bloquante aujourd'hui");
  });
});

// ===========================================================================
// NEXT ACTION — §22.16 … §22.21
// ===========================================================================

describe("one canonical next action", () => {
  /** EFT-IMP-2026-00011, exactly as production holds it (read-only probe). */
  const dossier00011 = (viewer = DECLARANT) => [
    node({ stepKey: "cotation", state: "SKIPPED" }, viewer),
    node({ stepKey: "operations_intake", state: "COMPLETED" }, viewer),
    node({ stepKey: "am_dossier_opening", state: "COMPLETED" }, viewer),
    node({ stepKey: "coordinator_reception", state: "COMPLETED" }, viewer),
    node({ stepKey: "transit_declarant_assignment", state: "COMPLETED" }, viewer),
    node(
      {
        stepKey: "customs_preparation",
        state: "ACTIVE",
        eligibility: evaluateStepAction(
          facts({ state: "ACTIVE", assignedUserId: viewer.userId }),
          viewer,
        ),
      },
      viewer,
    ),
    node(
      {
        stepKey: "transport_assignment",
        state: "AVAILABLE",
        eligibility: evaluateStepAction(
          facts({ stepKey: "transport_assignment", state: "AVAILABLE", owningRole: "TRANSPORT_OFFICER" }),
          viewer,
        ),
      },
      viewer,
    ),
    node({ stepKey: "bon_a_delivrer", state: "AVAILABLE" }, viewer),
    node({ stepKey: "pre_gate", state: "AVAILABLE" }, viewer),
    node({ stepKey: "transit_validation", state: "PENDING" }, viewer),
  ];

  it("16 — an ACTIVE step 6 outranks an unrelated future Transport action", () => {
    // ⚠ THE HEADLINE PRODUCTION DEFECT. The journey panel announced
    // « Prochaine action : Service Transport — affecter le véhicule » while the
    // Déclarant's step 6 was ACTIVE and assigned to him, because `nextAction`
    // was `activeSteps[0]` over an UNSORTED array of every open node.
    const w = work(dossier00011());
    expect(w.current.map((i) => i.stepKey)).toEqual(["customs_preparation"]);
    expect(w.nextActionFr).toContain("Déclarant");
    expect(w.nextActionFr).not.toContain("véhicule");
  });

  it("17 — genuinely concurrent work is labelled parallel, not queued and not promoted", () => {
    const w = work(dossier00011());
    expect(w.parallel.map((i) => i.stepKey).sort())
      .toEqual(["bon_a_delivrer", "pre_gate", "transport_assignment"]);
    for (const i of w.parallel) expect(i.kind).toBe("parallel");
    // …and it never speaks for the dossier while a current action exists.
    expect(w.current.length).toBeGreaterThan(0);
    expect(w.nextActionFr).toBe(w.current[0].labelFr);
  });

  it("18 — future work whose prerequisites are unmet cannot become the current action", () => {
    const w = work(dossier00011());
    expect(w.upcoming.map((i) => i.stepKey)).toContain("transit_validation");
    for (const i of w.upcoming) expect(i.kind).toBe("upcoming");
    expect(w.current.map((i) => i.stepKey)).not.toContain("transit_validation");
    // With nothing current or parallel, an upcoming item is named as upcoming
    // rather than dressed up as an action.
    const quiet = work([node({ stepKey: "transit_validation", state: "PENDING" })]);
    expect(quiet.nextActionFr).toContain("À venir");
  });

  it("19 — the header, the cards and the queue read ONE model", () => {
    // Not « are consistent » — are the same object. `getDossierWork` is built
    // once per request on the dossier page and handed to all three.
    const page = code("app/files/[id]/page.tsx");
    expect(page.match(/getDossierWork\(/g) ?? []).toHaveLength(1);
    expect(page).toContain("<DossierWorkSummary fileId={file.id} view={workView} />");
    expect(page).toContain("cardsFromWork(file.id, workView)");
    expect(page).toContain("work={workView?.work}");
    // The journey panel derives its sentence from it rather than from
    // `activeSteps[0]`.
    const journey = code("lib/navigation/journey.ts");
    expect(journey).toContain("work.nextActionFr");
    expect(journey).not.toContain("model.activeSteps.slice");
    // The queue's own column stops printing an internal completionRule code.
    expect(code("lib/process/queues/service.ts")).not.toContain("nextAction: node?.completionRule");
  });

  it("20 — work held by somebody else renders as status, never as a button", () => {
    const held = work([
      node({
        stepKey: "customs_preparation",
        state: "ACTIVE",
        assigneeLabel: "Awa D.",
        eligibility: evaluateStepAction(facts({ state: "ACTIVE", assignedUserId: "someone-else" }), DECLARANT),
      }),
    ]);
    expect(held.primary?.viewer).toBe("someone_else");
    expect(held.primary?.eligibility.canSubmit).toBe(false);
    expect(held.primary?.eligibility.canStart).toBe(false);
    expect(held.currentOwnerFr).toBe("Awa D.");
  });

  it("21 — evidence the viewer cannot see never renders as ready", () => {
    const el = evaluateStepAction(
      facts({
        state: "ACTIVE",
        assignedUserId: DECLARANT.userId,
        requirements: [{ key: "K", labelFr: "Pièce", status: "unauthorized" }],
      }),
      DECLARANT,
    );
    expect(el.unauthorized).toBe(true);
    expect(el.canSubmit).toBe(false);
    expect(contextualStatus("ACTIVE", el).key).not.toBe("a_votre_tour");
  });

  it("21b — and the reader's own action is the one drawn first", () => {
    // §13. `yours_active` outranks `yours_available`, which outranks status.
    const mine = work(dossier00011(DECLARANT));
    expect(mine.primary?.stepKey).toBe("customs_preparation");
    expect(mine.primary?.viewer).toBe("yours_active");

    // The Transport officer, reading the same dossier, is offered THEIR step —
    // not the Déclarant's, which is neither theirs nor claimable.
    const theirs = work(dossier00011(TRANSPORT));
    expect(theirs.primary?.stepKey).toBe("transport_assignment");
    expect(theirs.primary?.viewer).toBe("yours_available");
  });
});

// ===========================================================================
// TRANSPORT — §22.22 … §22.24
// ===========================================================================

describe("transport — two acts, two names", () => {
  it("22 — the official step and the transport-domain control cannot contradict", () => {
    // Production showed « Étape 14 — Bloquée » beside « Démarrer le transport »
    // on the same dossier. Step 14 was AVAILABLE and healthy; it read
    // « Bloquée » only because it was not the reader's.
    const notMine = evaluateStepAction(
      facts({ stepKey: "transport_assignment", state: "AVAILABLE", owningRole: "TRANSPORT_OFFICER" }),
      DECLARANT,
    );
    expect(notMine.canStart).toBe(false);
    expect(contextualStatus("AVAILABLE", notMine).key).toBe("autre_service");
    expect(contextualStatus("AVAILABLE", notMine).labelFr).not.toBe("Bloquée");
    // Genuinely stopped work still reads Bloquée.
    const stopped = evaluateStepAction(
      facts({ stepKey: "transport_assignment", state: "AVAILABLE", owningRole: "TRANSPORT_OFFICER", custody: "awaiting_reception" }),
      TRANSPORT,
    );
    expect(contextualStatus("AVAILABLE", stopped).key).toBe("bloquee");
  });

  it("23 — the two business acts have distinct labels and distinct authorities", () => {
    const i18n = read("lib/i18n.ts");
    // `createTransport` creates the mission RECORD (transport:create).
    expect(i18n).toContain('start: "Créer la mission transport"');
    expect(i18n).not.toContain('start: "Démarrer le transport"');
    // Nothing else in the product still says it either.
    expect(i18n).not.toContain('"Démarrer le transport"');
    // The panel says which act is which.
    const panel = code("components/transport/transport-panel.tsx");
    expect(panel).toContain("{tr.startHint}");
    expect(i18n).toContain("étape officielle 14");
    // Étape 14 is `transport:assign`, owned by TRANSPORT_OFFICER — a different
    // permission from `transport:create`.
    const step14 = EFFITRANS_PROCESS.find((s) => s.key === "transport_assignment")!;
    expect(step14.permissions[0]).toBe("transport:assign");
    expect(step14.role).toBe("TRANSPORT_OFFICER");
  });

  it("24 — the wrong role cannot start an official step, administrator included", () => {
    // OPS-CUSTOMS-OWNERSHIP-01, preserved. SYSTEM_ADMIN holds the permission
    // and is still not the owner: the audited escape hatch is to ASSIGN the
    // step and then act, which leaves a record of who took whose work.
    const el = evaluateStepAction(facts({ stepKey: "transport_assignment", owningRole: "TRANSPORT_OFFICER" }), ADMIN);
    expect(el.mayAct).toBe(true);
    expect(el.isOwner).toBe(false);
    expect(el.canStart).toBe(false);
    // …and the work model reports them as an observer, not as every maker.
    const w = work([node({ stepKey: "transport_assignment", state: "AVAILABLE", eligibility: el })]);
    expect(w.primary?.viewer).toBe("observer");
    // The engine's own guard is untouched.
    expect(code("lib/process/engine/actions.ts")).toContain("step_gate_not_owning_role");
  });
});

// ===========================================================================
// DOSSIER UX + COUNTS — §22.25 … §22.28, §11
// ===========================================================================

describe("the dossier reads as work, and the counts stay honest", () => {
  it("25 — the reader's own action appears first, in the summary at the top", () => {
    const page = code("app/files/[id]/page.tsx");
    const summary = page.indexOf("<DossierWorkSummary");
    const journey = page.indexOf("<ProcessJourneyPanel");
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(journey);
    expect(code("components/process/dossier-work-summary.tsx")).toContain("work.primary");
  });

  it("26 — a viewer with no action gets status, not a fake button", () => {
    const quiet = work([
      node({
        stepKey: "customs_preparation",
        state: "ACTIVE",
        assigneeLabel: "Awa D.",
        eligibility: evaluateStepAction(facts({ state: "ACTIVE", assignedUserId: "x" }), TRANSPORT),
      }),
    ]);
    expect(quiet.primary?.viewer).toBe("someone_else");
    expect(quiet.primary?.eligibility.canStart).toBe(false);
    expect(quiet.primary?.eligibility.canSubmit).toBe(false);
  });

  it("27 — informational quality observations never become blockers", () => {
    // §17. The QC panels are complete and reachable; they simply no longer sit
    // between the operational panels, where « Non suivi par la plateforme »
    // visually outweighed the work an operator came to do.
    const page = code("app/files/[id]/page.tsx");
    for (const qc of ["QC2Panel", "QC4Panel", "QC5Panel", "QC6Panel"]) {
      expect(page, qc).toContain(`<${qc}`);
      expect(page.match(new RegExp(`<${qc}`, "g")) ?? [], qc).toHaveLength(1);
    }
    const qualite = page.indexOf('id="qualite"');
    expect(qualite).toBeGreaterThan(-1);
    for (const qc of ["QC2Panel", "QC4Panel", "QC5Panel", "QC6Panel"]) {
      expect(page.indexOf(`<${qc}`), qc).toBeGreaterThan(qualite);
    }
    // No QC verdict is wired to any engine door.
    for (const mod of ["lib/process/engine/actions.ts", "lib/process/step-eligibility.ts", "lib/process/work-model.ts"]) {
      expect(code(mod), mod).not.toMatch(/qc[2-6]|deriveQC/i);
    }
  });

  it("28 — every panel the dossier had is still mounted", () => {
    const page = read("app/files/[id]/page.tsx");
    for (const panel of [
      "CommercialOrigin", "CarriagePanel", "QC2Panel", "QC4Panel", "QC5Panel", "QC6Panel",
      "FileForm", "FileWorkflow", "FileAssignment", "CommercialOwner", "FileDangerZone",
      "TaskPanel", "DocumentsPanel", "CustomsPanel", "TransportPanel", "DeliveryProofPanel",
      "TrackingTimeline", "DriverAssign", "MissionTracking", "FinancePanel", "MailTimeline",
      "LifecycleTracker", "TransitHandoff", "SlaPanel", "CopilotPanel", "RiskPanel",
      "EventTimeline", "OwnershipPanel", "ArtifactPanel", "ProcessJourneyPanel",
    ]) {
      expect(page, panel).toContain(`<${panel}`);
    }
  });

  it("11 — 26 official steps + 3 parallel activities are never called 29 steps", () => {
    const w = work([
      node({ stepKey: "operations_intake", state: "COMPLETED" }),
      node({ stepKey: "am_dossier_opening", state: "COMPLETED" }),
      node({ stepKey: "cotation", state: "SKIPPED" }),
      node({ stepKey: "bon_a_delivrer", state: "COMPLETED" }),
      node({ stepKey: "pre_gate", state: "COMPLETED" }),
    ]);
    // The two finished ACTIVITIES do not touch the official numerator — which
    // is precisely how `completedSteps.length` over a denominator of 26 could
    // produce « 28/26 ».
    expect(w.progress.officialCompleted).toBe(2);
    expect(w.progress.officialTotal).toBe(26);
    expect(w.progress.activitiesCompleted).toBe(2);
    expect(w.progress.activitiesTotal).toBe(3);
    // SKIPPED is not completed.
    expect(w.progress.officialNotApplicable).toBe(1);

    const journey = code("lib/navigation/journey.ts");
    expect(journey).toContain("work.progress.officialCompleted");
    expect(journey).not.toContain("completed: model.completedSteps.length");
    // Nothing in the product calls the execution nodes « étapes officielles ».
    for (const f of ["components/process/process-journey.tsx", "app/files/[id]/process/page.tsx",
                     "components/process/dossier-work-summary.tsx"]) {
      expect(read(f), f).not.toMatch(/29\s*(étapes|etapes)/i);
    }
  });
});

// ===========================================================================
// NAVIGATION — §22.29 … §22.33
// ===========================================================================

describe("APP-NAVIGATION-01 — Back / Forward, and nothing else", () => {
  it("29/30 — the trail tracks back and forward without drifting", () => {
    let t = advance(null, "/files");
    expect(t).toEqual({ urls: ["/files"], cursor: 0 });
    t = advance(t, "/files/abc");
    t = advance(t, "/files/abc/process");
    expect(t.cursor).toBe(2);
    // Back — recognised by URL, so it self-corrects whoever navigated: these
    // buttons, the keyboard, or the browser's own chrome.
    t = advance(t, "/files/abc");
    expect(t.cursor).toBe(1);
    // Forward.
    t = advance(t, "/files/abc/process");
    expect(t.cursor).toBe(2);
    // A new destination truncates forward history, exactly as a browser does.
    t = advance(t, "/files/abc");
    t = advance(t, "/files/xyz");
    expect(t.urls).toEqual(["/files", "/files/abc", "/files/xyz"]);
    expect(t.cursor).toBe(2);
  });

  it("31 — disabled when there is nowhere to go", () => {
    const first = advance(null, "/dashboard");
    expect(first.cursor > 0).toBe(false);                       // no Back
    expect(first.cursor < first.urls.length - 1).toBe(false);   // no Forward
    const src = code("components/shell/history-nav.tsx");
    expect(src).toContain("disabled={!state.back}");
    expect(src).toContain("disabled={!state.forward}");
    // A re-render is not a move.
    const same = advance(first, "/dashboard");
    expect(same).toBe(first);
  });

  it("32 — Alt+← and Alt+→, and not while the caret is in a field", () => {
    const src = code("components/shell/history-nav.tsx");
    expect(src).toContain('e.key === "ArrowLeft"');
    expect(src).toContain('e.key === "ArrowRight"');
    expect(src).toContain("if (!e.altKey");
    expect(src).toContain("if (editing(e.target)) return;");
    // preventDefault is deliberate: those are already the platform's own
    // Back/Forward, and letting both run would move two entries per press.
    expect(src).toContain("e.preventDefault()");
  });

  it("33 — history navigation cannot mutate workflow state", () => {
    const src = read("components/shell/history-nav.tsx");
    // The ONLY two effects this file can have.
    expect(src).toContain("router.back()");
    expect(src).toContain("router.forward()");
    for (const forbidden of [
      "activateStep", "submitStep", "approveStep", "rejectStep", "skipStep",
      "createTransport", "assignTransport", "sendHandoff", "receiveHandoff",
      "server-only", "use server", "fetch(", "supabase", "revalidate",
      "<form", "action=", "method=",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    // It is mounted in the shell header, once.
    const topbar = read("components/shell/topbar.tsx");
    expect(topbar).toContain("<HistoryNav />");
    expect(topbar.match(/<HistoryNav/g) ?? []).toHaveLength(1);
  });
});

// ===========================================================================
// PENDING SCHEMAS — §22.34 … §22.37, and the two unapplied migrations
// ===========================================================================

describe("the deployed code runs on schema 138, with #139 AND #140 unapplied", () => {
  /** Everything the two pending migrations introduce, and nothing else. */
  const PENDING_139 = [
    "gainde_declaration_reference", "gainde_declaration_recorded_by",
    "gainde_declaration_recorded_at", "gainde_tax_payment", "gainde_tax_payment_line",
    "record_declaration_reference", "void_gainde_tax_payment",
  ];
  const PENDING_140 = ["services"];

  const GUARD_139 = "gaindeLedgerAvailable";
  const GUARD_140 = "serviceScopeStored";

  it("34 — every module touching a #139 object guards it", () => {
    for (const mod of ["lib/customs/service.ts", "lib/customs/actions.ts",
                       "lib/process/reconcile/service.ts", "lib/customs/intelligence/persistence.ts"]) {
      const src = code(mod);
      for (const object of PENDING_139) {
        if (!src.includes(object)) continue;
        expect(src, `${mod}: ${object} is reached without a capability check`).toContain(GUARD_139);
      }
    }
  });

  it("35 — and every module touching the #140 column guards it too", () => {
    // The same discipline, applied BEFORE the incident this time. Each of these
    // names `services` in a query, and each must ask first.
    for (const mod of ["lib/files/service.ts", "lib/files/actions.ts",
                       "lib/process/engine/snapshot.ts"]) {
      const src = code(mod);
      for (const object of PENDING_140) {
        if (!new RegExp(`["'\`][^"'\`]*\\b${object}\\b`).test(src)) continue;
        expect(src, `${mod}: ${object} is reached without a capability check`).toContain(GUARD_140);
      }
    }
    // The probes are narrow: one column, one SQLSTATE, zero rows, per-request.
    for (const probe of ["lib/customs/schema-139.ts", "lib/files/service-scope-140.ts"]) {
      const src = code(probe);
      expect(src, probe).toContain('const UNDEFINED_COLUMN = "42703"');
      expect(src, probe).toContain("if (error.code === UNDEFINED_COLUMN) return false;");
      expect(src, probe).toContain(".limit(0)");
      expect(src, probe).toContain('import { cache } from "react"');
      expect(src, probe).not.toContain("try {");
      expect(src, probe).not.toContain("catch");
      // Dated and marked for deletion: a shim that outlives its window becomes
      // a place where real schema drift can hide.
      expect(read(probe), probe).toContain("DELETE THIS FILE");
    }
  });

  it("36 — no #140-only capability is presented as usable before the schema has it", () => {
    // The « Services demandés » checkboxes are DEFERRED UI: a checkbox whose
    // value cannot be stored is a lie to the operator, so it is not rendered.
    const form = code("components/files/file-form.tsx");
    expect(form).toContain("{servicesAvailable && (");
    expect(form).toContain("Services demand");
    expect(form).toContain("servicesAvailable && services.length > 0 ? services : undefined");
    for (const page of ["app/files/new/page.tsx", "app/files/[id]/page.tsx"]) {
      expect(code(page), page).toContain("serviceScopeStored()");
    }
    // And nothing claims a scope was saved: the write is included only when the
    // column exists, and the audit records what was chosen either way.
    const actions = code("lib/files/actions.ts");
    expect(actions).toContain("scopeStored && chosenServices ? { services: chosenServices } : {}");
    expect(actions).toContain("services: chosenServices,");
  });

  it("37 — an absent scope column degrades to derivation, never to « no services »", () => {
    // The trap `false` could have been: « the column is missing » must not mean
    // « Effitrans sells nothing here », which would put every dossier out of
    // scope for everything.
    const absent = scopeFromRow({ type: "IMP", services: undefined });
    expect(absent.source).toBe("DERIVED_FROM_TYPE");
    expect(absent.customs).toBe("APPLICABLE");
    expect(inapplicableStepsForScope(absent)).toEqual([]);
    // With the column applied and a real choice, the stored answer wins.
    const stored = scopeFromRow({ type: "IMP", services: ["customs"] });
    expect(stored.source).toBe("STORED");
    expect(stored.transport).toBe("NOT_APPLICABLE");
  });

  it("38 — both migrations ship with a verifier, and neither is claimed applied", () => {
    for (const [mig, ver] of [
      ["20261001000001_gainde_declaration_and_tax_payment", "20261001000001_gainde_declaration_and_tax_payment.verify.sql"],
      ["20261002000001_dossier_service_scope", "20261002000001_dossier_service_scope.verify.sql"],
    ]) {
      expect(read(`supabase/migrations/${mig}.sql`).length).toBeGreaterThan(500);
      const verifier = read(`supabase/verifiers/${ver}`);
      expect(verifier, ver).toContain("Read-only");
      expect(verifier, ver).toContain("ok boolean, detail text");
    }
    // #140 must not backfill: a scope invented for a dossier nobody recorded
    // one for would remove official steps on the strength of a guess.
    const m140 = read("supabase/migrations/20261002000001_dossier_service_scope.sql");
    expect(m140).toContain("must not backfill");
    expect(m140).not.toMatch(/^\s*update\s+public\.operational_file/im);
    expect(m140).not.toContain("default");
  });

  it("39 — REPO-WIDE CENSUS: nothing reaches a pending schema unconditionally", () => {
    // ⚠ THE EXHAUSTIVE FORM. Tests 34/35 check the modules we know about; this
    // walks EVERY .ts/.tsx in the application and finds the ones we do not.
    // That is the shape the OPS-GAINDE-04-COMPAT-01 incident took: one
    // projection nobody thought of, in a file nobody was looking at, and
    // PostgREST fails the WHOLE select on an unknown column.
    //
    // A name only reaches the database through `.from(x)`, `.select(x)` or
    // `.rpc(x)`. Everywhere else it is inert — a registry entry, a documentary
    // registry string, an audit payload key, or the ordinary French word
    // « services » in a sentence — and this distinguishes the two rather than
    // banning the word.
    const files = walk(fileURLToPath(new URL("..", import.meta.url)));
    const offenders: string[] = [];

    for (const rel of files) {
      if (rel.startsWith("tests/")) continue;
      const src = code(rel);
      for (const [guard, names] of [
        ["gaindeLedgerAvailable", PENDING_139],
        ["serviceScopeStored", PENDING_140],
      ] as const) {
        if (src.includes(guard)) continue; // the module asks first
        for (const name of names) {
          // Inside a `.from(...)` / `.select(...)` / `.rpc(...)` argument only.
          const re = new RegExp(`\\.(from|select|rpc)\\(\\s*[\`"'][^\`"']*\\b${name}\\b`);
          if (re.test(src)) offenders.push(`${rel}: ${name}`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("40 — and the four inert references stay inert", () => {
    // Named individually, because « it does not appear in a query » is a
    // property that could decay quietly into « it does », and each of these is
    // a legitimate reason for the word to exist.
    //
    //   tenant-tables.ts   the guard's registry of tenant-scoped table NAMES.
    //                      A table missing from it is invisible to the guard,
    //                      so both #139 tables are listed BEFORE they exist.
    //   effitrans-process  a documentary `requiredEvidence` string. The registry
    //                      describes the process; it never queries.
    //   customs/actions    an audit payload KEY, not a column.
    //   executive-pdf      the French word « services », in a sentence.
    for (const [rel, name] of [
      ["lib/db/tenant-tables.ts", "gainde_tax_payment"],
      ["lib/db/tenant-tables.ts", "gainde_tax_payment_line"],
      ["lib/process/effitrans-process.ts", "gainde_declaration_reference"],
      ["lib/reports/executive-pdf.ts", "services"],
    ] as const) {
      const src = code(rel);
      expect(src, `${rel} should still mention ${name}`).toContain(name);
      expect(src, `${rel}: ${name} must not reach a query`)
        .not.toMatch(new RegExp(`\\.(from|select|rpc)\\(\\s*[\`"'][^\`"']*\\b${name}\\b`));
    }
  });
});
