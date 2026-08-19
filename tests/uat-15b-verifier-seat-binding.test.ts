/**
 * TMS-7 / DEFECT-UAT15b — the verifier seat that was never bound.
 * ---------------------------------------------------------------------------
 * UAT-15 part 2 failed a SECOND time, after the dossier had been opened and a
 * process instance existed. That falsified the first hypothesis and exposed the
 * real one: `defaultSeats()` emitted `assignee` bindings and nothing else, so
 * `resolveSeatEligibility(..., "verifier")` returned an EMPTY binding for every
 * step of every dossier. An empty binding is refused by design, so document
 * verification was structurally impossible — production carried 0 rows in
 * `document_review` from the day WES-4H shipped.
 *
 * The fix restores the authority that governed verification BEFORE the seat
 * check existed: the roles the ratified templates grant `document:approve`.
 * These tests pin that the seat is now bound, that it is bound in the role
 * vocabulary a tenant's `role` row actually carries, and — the half that
 * matters most — that every fail-closed axis still refuses.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPlatformDefaultPolicy } from "@/lib/workflow/policy/default";
import { isEligibleForSeat, NOT_RESOLVED } from "@/lib/workflow/access/seat";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const policy = buildPlatformDefaultPolicy();
const eligibility = read("lib", "workflow", "access", "eligibility.ts");
const governance = read("lib", "documents", "governance.ts");
const seatSrc = read("lib", "workflow", "access", "seat.ts");

/**
 * Mirrors `resolveSeatEligibility`'s selection exactly. The assertion below
 * pins the production filter, so this helper cannot drift into testing a
 * reimplementation of its own.
 */
const seatRoles = (stepKey: string, seat: string) =>
  Array.from(
    new Set(
      policy.seats
        .filter((s) => s.stepKey === stepKey && s.seat === seat)
        .flatMap((s) => s.roles),
    ),
  );

const asEligibility = (roles: string[]) => ({
  roles,
  policyVersionId: null,
  identityBound: false,
  resolved: true,
});

/** The step that opens the dossier and carries its documentation work. */
const DOCUMENTATION_STEP = "am_dossier_opening";
const ALL_STEPS = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].map((n) => n.key);

describe("DEFECT-UAT15b — the verifier seat is bound at all", () => {
  it("the helper selects seats the same way production resolves them", () => {
    expect(eligibility).toContain(
      "(s) => s.stepKey === stepKey && s.seat === seat,",
    );
  });

  it("EVERY registry step binds a non-empty verifier seat", () => {
    expect(ALL_STEPS.length).toBeGreaterThan(20);
    const unbound = ALL_STEPS.filter((k) => seatRoles(k, "verifier").length === 0);
    expect(unbound).toEqual([]);
  });

  it("the documentation step binds a verifier — the exact UAT-15 case", () => {
    expect(ALL_STEPS).toContain(DOCUMENTATION_STEP);
    expect(seatRoles(DOCUMENTATION_STEP, "verifier").length).toBeGreaterThan(0);
  });
});

describe("DEFECT-UAT15b — bound to the authority that already existed", () => {
  const approvers = TENANT_ROLE_TEMPLATES.filter((t) =>
    t.permissions.includes("document:approve"),
  ).map((t) => t.key);

  it("the verifier roles are exactly the document:approve holders", () => {
    expect(approvers.length).toBeGreaterThan(0);
    expect([...seatRoles(DOCUMENTATION_STEP, "verifier")].sort()).toEqual(
      [...approvers].sort(),
    );
  });

  it("no role was granted verification that does not already hold the permission", () => {
    for (const step of ALL_STEPS) {
      for (const role of seatRoles(step, "verifier")) {
        const tpl = TENANT_ROLE_TEMPLATES.find((t) => t.key === role);
        expect(tpl?.permissions, `${role} @ ${step}`).toContain("document:approve");
      }
    }
  });

  it("binds the tenant ROLE CODE vocabulary, not the generic names", () => {
    // The live codes are template `key`s. `genericName` differs for real roles,
    // and binding those would produce a seat matching nobody — the same silent
    // failure this defect was.
    const roles = seatRoles(DOCUMENTATION_STEP, "verifier");
    expect(roles).toContain("OPS_SUPERVISOR");
    expect(roles).not.toContain("MANAGER");
    expect(roles).toContain("COMPLIANCE_HSSE");
    expect(roles).not.toContain("COMPLIANCE");
  });
});

describe("DEFECT-UAT15b — an eligible verifier passes, an ineligible one does not", () => {
  it("a document:approve holder IS eligible at the active documentation step", () => {
    const seat = asEligibility(seatRoles(DOCUMENTATION_STEP, "verifier"));
    expect(isEligibleForSeat(seat, ["ACCOUNT_MANAGER"])).toBe(true);
    expect(isEligibleForSeat(seat, ["OPS_SUPERVISOR"])).toBe(true);
  });

  it("a role WITHOUT document:approve remains refused", () => {
    const seat = asEligibility(seatRoles(DOCUMENTATION_STEP, "verifier"));
    for (const role of ["DRIVER", "CLIENT_USER", "CASHIER"]) {
      expect(isEligibleForSeat(seat, [role]), role).toBe(false);
    }
  });

  it("holding no role at all is refused", () => {
    expect(isEligibleForSeat(asEligibility(seatRoles(DOCUMENTATION_STEP, "verifier")), [])).toBe(false);
  });
});

describe("DEFECT-UAT15b — every fail-closed axis still refuses", () => {
  it("a dossier with NO active step still resolves no verifier", () => {
    // An un-opened dossier has an empty step key. It stays refused, and the
    // French message tells the operator to open it.
    expect(seatRoles("", "verifier")).toEqual([]);
    expect(isEligibleForSeat(asEligibility([]), ["ACCOUNT_MANAGER"])).toBe(false);
  });

  it("an unresolved policy refuses everyone", () => {
    expect(isEligibleForSeat(NOT_RESOLVED, ["SYSTEM_ADMIN"])).toBe(false);
  });

  it("an empty binding still refuses — the guard was not removed", () => {
    expect(seatSrc).toContain("if (eligibility.roles.length === 0) return false;");
  });

  it("an identity-bound seat is still not satisfiable by role", () => {
    expect(
      isEligibleForSeat({ ...asEligibility(["ACCOUNT_MANAGER"]), identityBound: true }, ["ACCOUNT_MANAGER"]),
    ).toBe(false);
  });

  it("maker-checker still forbids verifying your own upload", () => {
    expect(governance).toContain("input.uploaderId === input.actorId");
    expect(governance).toContain('return { ok: false, error: "self_verification" }');
  });

  it("the permission check still runs before the seat check", () => {
    expect(read("lib", "documents", "actions.ts")).toContain(
      'runReview(id, "VERIFIED", "document:approve", null, null)',
    );
  });
});

describe("DEFECT-UAT15b — the assignee seats WES-3 depends on are untouched", () => {
  it("steps naming an official role still bind an assignee seat", () => {
    const withRole = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].filter((n) => n.role);
    const bound = withRole.filter((n) => seatRoles(n.key, "assignee").length > 0);
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.length).toBe(withRole.length);
  });

  it("the checker seat is still unbound — maker-checker stays type-driven", () => {
    // Binding a checker would flip `makerCheckerRequired` for every document,
    // which is a business decision this fix deliberately does not make.
    for (const step of ALL_STEPS) expect(seatRoles(step, "checker")).toEqual([]);
  });
});
