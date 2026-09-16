/**
 * UAT-DECLARANT-PICKER-01 — one definition of who may be named the Déclarant.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as production showed it. On EFT-IMP-2026-00012 the reassignment
 * selector said « Aucun déclarant Transit actif » while the same panel, one
 * line above, displayed the Déclarant it had just been told about. The tenant
 * holds twelve active Déclarants. The named one satisfied BOTH eligibility
 * predicates. Nothing was misconfigured.
 *
 * Three separate things were wrong, and they are kept separate here.
 *
 * A — THE LIST WAS NEVER FETCHED. The page loaded candidates only while the
 *     slot was empty, because when that line was written the panel only offered
 *     the selector while the slot was empty. Adding « Changer le Déclarant »
 *     broke the agreement without touching the page, and an unfetched list
 *     reached the panel as an empty array — indistinguishable from a tenant
 *     with no Déclarant at all. Hence: load for whoever may assign, and make
 *     « not loaded » a different value from « nobody ».
 *
 * B — TWO DEFINITIONS OF ELIGIBILITY. The picker offered holders of exactly
 *     CUSTOMS_DECLARANT; the door accepted anybody whose role mapped to the
 *     TRANSIT department. Three active production accounts were assignable and
 *     never offered. Ratified: the narrow rule, in ONE pure function both sides
 *     call.
 *
 * C — THE CHEF'S SEAT GUARDED AN UNUSED DOOR. `ASSIGNMENT_AUTHORITY` was keyed
 *     on `transit_declarant_assignment`, which no caller passes: naming the
 *     Déclarant writes step 6. Thirteen active Coordinators hold
 *     `customs:assign`. The restriction now names the step the act writes.
 *
 * WHAT IS *NOT* WRONG, asserted here so it stays that way: no HR fact takes
 * part. Not `employee.job_title`, not the HR department, not the Poste. The
 * Déclarant who exposed this has no employment record at all and is eligible.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isEligibleAssignee,
  requiredAssigneeRole,
  STEP_ASSIGNEE_ROLE,
  type AssigneeFacts,
} from "@/lib/process/transit-eligibility";
import { mayAssignStep, ASSIGNMENT_AUTHORITY } from "@/lib/process/handoff-routes";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000f2";
const DECLARANT_STEP = "customs_preparation";
const FIELD_STEP = "customs_field_clearance";

/** An active, same-tenant account holding exactly these roles. */
const staff = (...roleCodes: string[]): AssigneeFacts => ({
  status: "active",
  tenantId: TENANT,
  roleCodes,
});

const eligibility = read("lib/process/transit-eligibility.ts");
const transitActions = read("lib/process/engine/transit-actions.ts");
const page = read("app/files/[id]/process/page.tsx");
const panel = read("components/process/transit-panel.tsx");
const seed = read("supabase/tests/journey_identities.sql");
const journey = read("tests/journey/transit-customs.journey.ts");

/** The source of one exported function, up to the next top-level export. */
const fn = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const rest = src.slice(i);
  const j = rest.indexOf("\nexport ", 1);
  return j > 0 ? rest.slice(0, j) : rest;
};

// ============================================================ RULING B ====

describe("B — eligibility to hold the Déclarant step, as one rule", () => {
  it("01 — an active, same-tenant CUSTOMS_DECLARANT is eligible", () => {
    expect(isEligibleAssignee(DECLARANT_STEP, staff("CUSTOMS_DECLARANT"), TENANT)).toBe(true);
  });

  it("02 — holding OTHER roles as well takes nothing away", () => {
    // Four active production accounts hold both of these, and the journey
    // fixture that proves maker/checker at 6→7 is one of them.
    expect(isEligibleAssignee(DECLARANT_STEP, staff("CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT"), TENANT)).toBe(true);
    expect(isEligibleAssignee(DECLARANT_STEP, staff("COORDINATOR", "CUSTOMS_DECLARANT", "COURIER"), TENANT)).toBe(true);
  });

  it("03 — the Chef de Transit is NOT, by himself, a Déclarant", () => {
    // He names one. That he belongs to the same department is not the question
    // the step asks, and answering the department question is what let three
    // production accounts be assignable without ever being offered.
    expect(isEligibleAssignee(DECLARANT_STEP, staff("CHIEF_OF_TRANSIT"), TENANT)).toBe(false);
  });

  it("04 — neither is the Agent de Terrain, nor anyone else in Transit", () => {
    expect(isEligibleAssignee(DECLARANT_STEP, staff("CUSTOMS_FIELD_AGENT"), TENANT)).toBe(false);
    expect(isEligibleAssignee(DECLARANT_STEP, staff("CUSTOMS_FIELD_AGENT", "PICKUP_AGENT"), TENANT)).toBe(false);
  });

  it("05 — an account that is not active is refused, whatever it holds", () => {
    for (const status of ["archived", "inactive", null, ""]) {
      expect(
        isEligibleAssignee(DECLARANT_STEP, { ...staff("CUSTOMS_DECLARANT"), status }, TENANT),
        String(status),
      ).toBe(false);
    }
  });

  it("06 — another tenant's Déclarant is nobody here", () => {
    expect(
      isEligibleAssignee(DECLARANT_STEP, { ...staff("CUSTOMS_DECLARANT"), tenantId: OTHER_TENANT }, TENANT),
    ).toBe(false);
    expect(
      isEligibleAssignee(DECLARANT_STEP, { ...staff("CUSTOMS_DECLARANT"), tenantId: null }, TENANT),
    ).toBe(false);
  });

  it("07 — the field-agent step asks for ITS role, which is what the picker always offered", () => {
    expect(isEligibleAssignee(FIELD_STEP, staff("CUSTOMS_FIELD_AGENT"), TENANT)).toBe(true);
    expect(isEligibleAssignee(FIELD_STEP, staff("CUSTOMS_DECLARANT"), TENANT)).toBe(false);
    expect(isEligibleAssignee(FIELD_STEP, staff("CHIEF_OF_TRANSIT"), TENANT)).toBe(false);
  });

  it("08 — the steps nobody staffs through a picker keep the rule they had", () => {
    // Narrowing them would be an unratified change to an act no one reviewed.
    expect(requiredAssigneeRole("customs_followup")).toBeNull();
    expect(isEligibleAssignee("customs_followup", staff("CHIEF_OF_TRANSIT"), TENANT)).toBe(true);
    expect(isEligibleAssignee("customs_followup", staff("ACCOUNT_MANAGER"), TENANT)).toBe(false);
    expect(Object.keys(STEP_ASSIGNEE_ROLE).sort()).toEqual([FIELD_STEP, DECLARANT_STEP].sort());
  });

  it("09 — a role held with no roles at all, or an empty list, is refused", () => {
    expect(isEligibleAssignee(DECLARANT_STEP, staff(), TENANT)).toBe(false);
    expect(isEligibleAssignee("customs_followup", staff(), TENANT)).toBe(false);
  });
});

// ================================================== ONE SOURCE OF TRUTH ====

describe("B — and it is ONE function, not the same sentence written twice", () => {
  it("10 — the candidate reader filters with the shared predicate", () => {
    const reader = fn(transitActions, "listEligibleTransitAssignees");
    expect(reader).toContain("isEligibleAssignee(");
    expect(reader).not.toContain('roleCanonicalDepartment(code) === "TRANSIT"');
    // It is asked about a STEP. Asking with a role code is how the caller got
    // to choose the rule, which is how the two definitions drifted apart.
    expect(transitActions).toContain("export async function listEligibleTransitAssignees(stepKey: string)");
  });

  it("11 — the assignment door enforces the same predicate, before it writes", () => {
    const door = fn(transitActions, "assignTransitStep");
    expect(door).toContain("isEligibleAssignee(");
    expect(door).not.toContain('roleCanonicalDepartment(r.code) === "TRANSIT"');
    expect(door.indexOf("isEligibleAssignee("), "eligibility precedes the write")
      .toBeLessThan(door.indexOf('admin.rpc("assign_process_step"'));
  });

  it("12 — the rule lives in a PURE module: no database, no session, no request", () => {
    for (const forbidden of [
      "getAdminSupabaseClient",
      "assertPermission",
      "supabase",
      "await ",
      "async ",
      '"use server"',
    ]) {
      expect(eligibility, forbidden).not.toContain(forbidden);
    }
  });

  it("13 — the reader passes the STORED status and tenant, not the ones it filtered on", () => {
    // Otherwise the query becomes the rule and the predicate becomes decoration:
    // a narrowed query would decide eligibility while appearing to delegate it.
    const reader = fn(transitActions, "listEligibleTransitAssignees");
    expect(reader).toContain('.select("id, name, email, status, tenant_id")');
    expect(reader).toContain("status: s.status");
    expect(reader).toContain("tenantId: s.tenant_id");
  });
});

// ================================================================= HR ====

describe("no HR fact takes part in workflow eligibility", () => {
  it("14 — the rule reads three things, and an employment record is none of them", () => {
    const facts: AssigneeFacts = staff("CUSTOMS_DECLARANT");
    expect(Object.keys(facts).sort()).toEqual(["roleCodes", "status", "tenantId"]);
  });

  it("15 — no module on this path READS the HR registry", () => {
    // CODE, not prose: these modules explain in their comments exactly which HR
    // facts they refuse to consult, and a naive grep would read the refusal as
    // the offence.
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The Déclarant whose dossier exposed this has NO `employee` row and is
    // eligible. If eligibility ever starts reading HR, this fails first.
    for (const [name, src] of [
      ["transit-eligibility", eligibility],
      ["transit-actions", transitActions],
      ["process page", page],
      ["transit panel", panel],
    ] as const) {
      const body = code(src);
      // Whole identifiers: the French copy on the process page contains
      // « a posteriori », which a substring search reads as « poste ».
      for (const hr of [/\bemployee\b/i, /\bjob_title\b/i, /\bjobTitle\b/, /\bposte\b/i, /\bhr_[a-z]/i]) {
        expect(hr.test(body), `${name} reads ${hr}`).toBe(false);
      }
    }
  });

  it("16 — an HR job title of « Déclarant en douane » grants nothing", () => {
    // The fixture exists, so this is proven against a real account in CI too.
    expect(seed).toContain("'Déclarant en douane'");
    expect(seed).toContain("journey.hrtitled@test.local");
    expect(isEligibleAssignee(DECLARANT_STEP, staff("TRANSPORT_OFFICER"), TENANT)).toBe(false);
  });
});

// ============================================================ RULING A ====

describe("A — a list that was never asked for is not an empty list", () => {
  it("17 — the page loads candidates for whoever may assign, full slot or not", () => {
    expect(page).toContain("if (transit && canAssignTransit) {");
    expect(page).toContain('listEligibleTransitAssignees("customs_preparation")');
    expect(page).toContain('listEligibleTransitAssignees("customs_field_clearance")');
    // THE DEFECT ITSELF: the fetch used to be conditioned on the slot being
    // empty, so « Changer le Déclarant » opened a selector nobody had filled.
    expect(page).not.toContain("!transit.declarant");
    expect(page).not.toContain("!transit.fieldAgent");
  });

  it("18 — « not loaded » is a different value from « nobody »", () => {
    expect(page).toContain("let eligibleDeclarants: TransitAssignee[] | null = null;");
    expect(page).toContain("let eligibleFieldAgents: TransitAssignee[] | null = null;");
    expect(panel).toContain("eligibleDeclarants: TransitAssignee[] | null;");
    expect(panel).toContain("eligibleFieldAgents: TransitAssignee[] | null;");
  });

  it("19 — the empty-state sentence is reachable ONLY from a loaded, empty list", () => {
    expect(panel).toContain("{eligibleDeclarants !== null && eligibleDeclarants.length === 0 && (");
    expect(panel).toContain("Aucun déclarant Transit actif.");
    expect(panel).toContain("{eligibleFieldAgents !== null && eligibleFieldAgents.length === 0 && (");
    // And the unasked case says so, in its own words and its own tone: an
    // alarming amber sentence about staffing is exactly what misled the UAT.
    expect(panel).toContain("Liste des déclarants non chargée.");
    expect(panel).toMatch(/eligibleDeclarants === null && \(\s*<p className="text-xs text-slate-500">/);
  });

  it("20 — the options render from the loaded list, never from a null", () => {
    expect(panel).toContain("{(eligibleDeclarants ?? []).map((d) => (");
    expect(panel).toContain("{(eligibleFieldAgents ?? []).map((a) => (");
  });

  it("21 — the selector still opens for a CHANGE, which is what PR #5 added", () => {
    expect(panel).toContain("(state.declarant === null || changingDeclarant)");
    expect(panel).toContain("Changer le Déclarant");
  });
});

// ============================================================ RULING C ====

describe("C — naming the Déclarant is the Chef's seat, on the step the act writes", () => {
  it("22 — the authority map is keyed on what callers actually pass", () => {
    expect(Object.keys(ASSIGNMENT_AUTHORITY).sort())
      .toEqual(["customs_preparation", "transit_declarant_assignment"]);
    // Every caller in the product passes `customs_preparation` for the
    // Déclarant. That was true before the fix too — which is why the rule
    // applied to nothing.
    expect(panel).toContain('assignTransitStep(fileId, "customs_preparation", declarantId)');
  });

  it("23 — the seats, and everybody else", () => {
    for (const seat of ["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]) {
      expect(mayAssignStep(DECLARANT_STEP, [seat]), seat).toBe(true);
    }
    for (const outsider of ["COORDINATOR", "CUSTOMS_DECLARANT", "ACCOUNT_MANAGER", "CUSTOMS_FIELD_AGENT", "DRIVER"]) {
      expect(mayAssignStep(DECLARANT_STEP, [outsider]), outsider).toBe(false);
    }
    // A Coordinator who also holds a seat keeps it — the rule is about seats
    // held, not about seats missing.
    expect(mayAssignStep(DECLARANT_STEP, ["COORDINATOR", "OPS_SUPERVISOR"])).toBe(true);
  });

  it("24 — and step 12's own staffing work is untouched", () => {
    // The Coordinator assigns the Agent de Terrain. That is the documented
    // reason it holds `customs:assign` at all, and nothing here narrows it.
    expect(mayAssignStep(FIELD_STEP, ["COORDINATOR"])).toBe(true);
    expect(mayAssignStep("customs_followup", ["COORDINATOR"])).toBe(true);
  });

  it("25 — the door checks the seat before it checks anything about the assignee", () => {
    const door = fn(transitActions, "assignTransitStep");
    expect(door.indexOf("mayAssignStep(stepKey, ctx.roles)"))
      .toBeLessThan(door.indexOf("isEligibleAssignee("));
  });
});

// ======================================================== CI FIXTURES ====

describe("the CI fixtures carry every shape these rules must tell apart", () => {
  it("26 — four accounts, each REALLY the shape its name claims", () => {
    // Asserting the email alone would let a fixture drift into uselessness: an
    // archived account quietly reactivated, or the HR-titled one granted the
    // very role it exists to lack, would make its regression pass while
    // proving nothing. So each fixture is pinned on the fact that makes it one.
    expect(seed).toContain("journey.declarantchief@test.local");
    expect(seed, "the dual-role account holds BOTH, or the maker/checker proof weakens")
      .toContain("('00000000-0000-0000-0000-00000000aa20'::uuid, 'CUSTOMS_DECLARANT')");
    expect(seed).toContain("('00000000-0000-0000-0000-00000000aa20'::uuid, 'CHIEF_OF_TRANSIT')");

    expect(seed, "the archived account must really be archived")
      .toContain("'journey.declarantarchived@test.local','Journey Declarant Archived','archived'");
    expect(seed).toContain("('00000000-0000-0000-0000-00000000aa21'::uuid, 'CUSTOMS_DECLARANT')");

    expect(seed, "the foreign tenant must really exist").toContain("Journey Other Tenant");
    expect(seed).toContain("'00000000-0000-0000-0000-0000000000f2', 'journey.foreigndeclarant@test.local'");

    expect(seed, "the HR-titled account must NOT hold the Déclarant role")
      .toContain("('00000000-0000-0000-0000-00000000aa23'::uuid, 'TRANSPORT_OFFICER')");
    expect(seed, "…and must carry the job title that makes it a temptation")
      .toContain("'Déclarant en douane', 'ACTIVE')");

    expect(seed).toContain("expected 23 identities");
    expect(seed).toContain("expected 24 role grants");
    // The seed refuses to load at all if any of these drift — asserted here so
    // the guard itself cannot be deleted quietly.
    for (const guard of [
      "the archived Déclarant is not archived",
      "the foreign Déclarant is not in the other tenant",
      "the Déclarant-Chef does not hold both roles",
      "the HR-titled account HOLDS the Déclarant role",
    ]) {
      expect(seed, guard).toContain(guard);
    }
  });

  it("27 — and the journey exercises the list, not only the door", () => {
    expect(journey).toContain('listEligibleTransitAssignees("customs_preparation")');
    expect(journey).toContain("the list IS the rule — no extra name, no missing name");
    // Both directions: offered ⇒ assignable, withheld ⇒ refused.
    expect(journey).toContain("must not be assignable as Déclarant");
    expect(journey).toContain("the current holder stays offered, or no change is possible");
  });

  it("28 — no journey names a non-Déclarant as the Déclarant any more", () => {
    for (const f of [
      "tests/journey/transit-customs.journey.ts",
      "tests/journey/delivery-completeness.journey.ts",
      "tests/journey/issuance-consequence.journey.ts",
      "tests/journey/no-deposit.journey.ts",
      "tests/journey/negative-battery.journey.ts",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain('assignTransitStep(fileId, "customs_preparation", transit.id)');
    }
  });
});
