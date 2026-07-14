/**
 * Phase 5.0E-2B — pilot readiness: the role matrix, the guided checklist, and the
 * navigation/workbench claims the pilot is supposed to VALIDATE.
 *
 * These are the assertions a human tester would otherwise have to make by hand,
 * fifteen times, and get wrong. The point of deriving the matrix from the real
 * builders is that these tests check the APPLICATION, not a document about it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildPilotMatrix, PILOT_ROLES, PILOT_FLAGS } from "@/lib/pilot/matrix";
import { buildPilotChecklist, checklistCoverage } from "@/lib/pilot/checklist";
import { EFFITRANS_PROCESS, MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";
import { QUEUES } from "@/lib/process/queues/registry";
import { KNOWN_ROLE_CODES } from "@/lib/navigation/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/**
 * Scan the CODE, not the prose about the code.
 *
 * The first cut of these banned-word checks failed on the very comments that explain
 * the guarantee — "carries no password", "cannot return a document body", "never a
 * client's name". A scanner that trips over its own documentation is measuring the
 * wrong thing: what matters is that no LINE OF CODE reads such a column.
 */
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "");      // line comments

const matrix = buildPilotMatrix();
const checklist = buildPilotChecklist();
const coverage = checklistCoverage(checklist);

// ------------------------------------------------------------------- matrix ----

describe("pilot role matrix (Deliverable 2)", () => {
  it("covers all fifteen official operational roles", () => {
    expect(PILOT_ROLES).toHaveLength(15);
    expect(new Set(PILOT_ROLES.map((r) => r.roleCode)).size).toBe(15);
  });

  it("uses only real tenant role codes", () => {
    for (const r of PILOT_ROLES) {
      expect(KNOWN_ROLE_CODES, r.roleCode).toContain(r.roleCode);
    }
  });

  it("gives every role a landing page it can actually open", () => {
    // A landing that 404s is worse than no landing: the user concludes the product
    // is broken before they have done anything.
    for (const m of matrix) {
      const all = m.sections.flatMap((s) => s.items);
      expect(all.length, `${m.role.roleCode} has an empty sidebar`).toBeGreaterThan(0);
    }
  });

  it("lands the Coursier on their runs, never on an empty dashboard", () => {
    const courier = matrix.find((m) => m.role.roleCode === "COURIER")!;
    expect(courier.landing).toBe("/courier");
    expect(courier.role.permissions).not.toContain("analytics:read");
  });

  it("lands each role where the pilot expects", () => {
    const expected: Record<string, string> = {
      OPS_SUPERVISOR: "/dashboard",
      SYSTEM_ADMIN: "/dashboard",
      COORDINATOR: "/dashboard",
      ACCOUNT_MANAGER: "/portfolio",
      COLLECTIONS_OFFICER: "/collections",
      COURIER: "/courier",
      CHIEF_OF_TRANSIT: "/my-work",
      CUSTOMS_DECLARANT: "/my-work",
      CUSTOMS_FINANCE_OFFICER: "/my-work",
      CUSTOMS_FIELD_AGENT: "/my-work",
      TRANSPORT_OFFICER: "/my-work",
      PICKUP_AGENT: "/my-work",
      BILLING_OFFICER: "/my-work",
      FINANCE_OFFICER: "/my-work",
      ADMINISTRATIVE_OFFICER: "/my-work",
    };
    for (const m of matrix) {
      expect(m.landing, m.role.roleCode).toBe(expected[m.role.roleCode]);
    }
  });

  it("shows each specialist EXACTLY one queue — never a colleague's", () => {
    const SPECIALISTS = [
      "CHIEF_OF_TRANSIT",
      "CUSTOMS_DECLARANT",
      "CUSTOMS_FINANCE_OFFICER",
      "CUSTOMS_FIELD_AGENT",
      "TRANSPORT_OFFICER",
      "PICKUP_AGENT",
      "BILLING_OFFICER",
      "ADMINISTRATIVE_OFFICER",
      "COURIER",
      "ACCOUNT_MANAGER",
      "COLLECTIONS_OFFICER",
    ];
    for (const code of SPECIALISTS) {
      const m = matrix.find((x) => x.role.roleCode === code)!;
      expect(m.queues.length, `${code} sees ${m.queues.length} queues`).toBe(1);
      expect(m.hiddenQueues.length, code).toBe(QUEUES.length - 1);
    }
  });

  it("gives the supervisor cross-department visibility", () => {
    const sup = matrix.find((m) => m.role.roleCode === "OPS_SUPERVISOR")!;
    expect(sup.queues.length).toBeGreaterThan(10);
    const admin = matrix.find((m) => m.role.roleCode === "SYSTEM_ADMIN")!;
    expect(admin.queues.length).toBe(QUEUES.length);
  });

  it("never names a role by its raw code in the tester-facing label", () => {
    for (const m of matrix) {
      expect(m.displayLabel, m.role.roleCode).not.toBeNull();
      expect(m.displayLabel).not.toBe(m.role.roleCode);
    }
  });

  it("never offers /platform or /portal to any pilot role", () => {
    for (const m of matrix) {
      const hrefs = m.sections.flatMap((s) => s.items);
      expect(hrefs.some((h) => h.includes("Plateforme")), m.role.roleCode).toBe(false);
    }
  });

  it("states a FORBIDDEN list for every role — the part that cannot be derived", () => {
    for (const r of PILOT_ROLES) {
      expect(r.forbidden.length, r.roleCode).toBeGreaterThan(0);
      expect(r.primaryActions.length, r.roleCode).toBeGreaterThan(0);
    }
  });

  it("runs the pilot with every capability on — for the pilot tenant only", () => {
    expect(PILOT_FLAGS.enabled).toBe(true);
    expect(PILOT_FLAGS.workspaces).toBe(true);
    expect(PILOT_FLAGS.physicalDeposit).toBe(true);
    expect(PILOT_FLAGS.collections).toBe(true);
    // ...but never the governance escape hatches.
    expect(PILOT_FLAGS.overrideAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------- checklist ----

describe("guided pilot checklist (Deliverable 4)", () => {
  it("walks all 26 official steps, in order", () => {
    expect(checklist).toHaveLength(26);
    expect(checklist.map((c) => c.stepNumber)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    );
  });

  it("can actually execute all 26 — every official role now has a real user behind it", () => {
    // This is the number the pilot lives or dies by. It was 17/26 until we found that
    // ROLE_MAPPINGS had been stale since 5.0B: seven roles had been created but the
    // map still said tenantRole: null, so the checklist declared nine phantom blockers.
    expect(coverage.executable).toBe(26);
    expect(coverage.blocked).toBe(0);
    expect(coverage.blockedSteps).toEqual([]);
  });

  it("assigns every step a real route and a named human actor", () => {
    for (const c of checklist) {
      expect(c.actorRoleCode, `step ${c.stepNumber}`).not.toBeNull();
      expect(c.actorLabel, `step ${c.stepNumber}`).not.toBe(c.actorRoleCode);
      expect(c.route, `step ${c.stepNumber}`).toMatch(/^\/(queues\/|my-work)/);
    }
  });

  it("flags every maker-checker step, so the tester tries to break it", () => {
    const flagged = checklist.filter((c) => c.makerChecker).map((c) => c.stepKey).sort();
    const expected = MAKER_CHECKER_PAIRS.flatMap((p) => [p.preparerStep, p.validatorStep]).sort();
    expect(flagged).toEqual(expected);
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("tells the tester who gets the dossier next, at every step but the last", () => {
    for (const c of checklist.slice(0, -1)) {
      expect(c.nextActorLabel, `step ${c.stepNumber}`).not.toBeNull();
    }
    expect(checklist.at(-1)!.nextActorLabel).toBeNull();
  });

  it("names every step in French, never by its key", () => {
    for (const c of checklist) {
      expect(c.label).not.toBe(c.stepKey);
      expect(c.label.length).toBeGreaterThan(3);
    }
  });

  it("ends at recovery (26) — which is NOT closure", () => {
    const last = checklist.at(-1)!;
    expect(last.stepNumber).toBe(26);
    expect(last.stepKey).toBe("collections");
    // Closure is a separate, explicit act by a Supervisor. Step 26 completing does
    // not close anything, and the checklist must not imply that it does.
    expect(EFFITRANS_PROCESS.at(-1)!.nextSteps).toEqual([]);
  });

  it("carries no credential, secret or customer datum", () => {
    const src = code("../lib/pilot/checklist.ts");
    for (const banned of ["password", "motdepasse", "secret", "token", "apiKey", "SUPABASE_SERVICE"]) {
      expect(src.toLowerCase(), banned).not.toContain(banned.toLowerCase());
    }
  });
});

// ------------------------------------------------------------ observability ----

describe("pilot observability is counts-only (Deliverable 8)", () => {
  const src = code("../lib/pilot/observability.ts");

  it("never selects a free-text or content column", () => {
    // The guarantee is structural, not a promise: this file selects statuses and
    // identifiers. It COULD NOT return a document body or a collection note without
    // being rewritten.
    for (const forbidden of [
      "select(\"*\")",
      "notes",
      "body",
      "content",
      "message",
      "driver_phone",
      "client_name",
      "amount",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("reads only the columns it needs", () => {
    const selects = [...src.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    const ALLOWED = new Set(["status", "state", "action", "file_id"]);
    for (const s of selects) {
      for (const col of s.split(",").map((c) => c.trim())) {
        expect(ALLOWED.has(col), `observability selects "${col}"`).toBe(true);
      }
    }
  });

  it("is tenant-scoped — a pilot admin sees their own numbers, nobody else's", () => {
    expect(src).toContain("scopedFrom(admin,");
    expect(src).not.toMatch(/admin\.from\(/);
  });
});

// ------------------------------------------------------------------ inventory ----

describe("dossier inventory helper (Deliverable 12)", () => {
  const src = code("../lib/pilot/inventory.ts");

  it("is READ-ONLY — there is no backfill here and no way to add one by accident", () => {
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", "initializeProcessForFile"]) {
      expect(src, w).not.toContain(w);
    }
  });

  it("returns aggregates, never a customer detail", () => {
    const selects = [...src.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    const ALLOWED = new Set(["id", "status", "created_at", "file_id"]);
    for (const s of selects) {
      for (const col of s.split(",").map((c) => c.trim())) {
        expect(ALLOWED.has(col), `inventory selects "${col}"`).toBe(true);
      }
    }
    expect(src).not.toContain("file_number");
    expect(src).not.toContain("client");
  });

  it("answers the question the compatibility decision has been blocked on", () => {
    // "How many dossiers, in what status, and how many lack a process instance."
    expect(src).toContain("withoutInstance");
    expect(src).toContain("terminalWithoutInstance");
  });

  it("is tenant-scoped", () => {
    expect(src).toContain("scopedFrom(admin,");
  });
});

// -------------------------------------------------------------- pilot console ----

describe("the pilot console is an admin-only diagnostic", () => {
  const page = code("../app/settings/pilot/page.tsx");

  it("404s for anyone without admin:config:manage", () => {
    expect(page).toContain('hasPermission(permissions, "admin:config:manage")');
    expect(page).toContain("notFound()");
  });

  it("creates no user and stores no credential", () => {
    for (const w of ["password", "createUser", "inviteUser", ".insert("]) {
      expect(page.toLowerCase(), w).not.toContain(w.toLowerCase());
    }
  });
});
