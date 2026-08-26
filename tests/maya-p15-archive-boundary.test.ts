/**
 * MAYA-P1.5 — R-19 dossier archive: classification G, pinned.
 * ---------------------------------------------------------------------------
 * « Archivage » wears one word over two different things:
 *
 *   step 23's archivage   the Administration files the dossier documents —
 *                         deposit pack + append-only chain of custody. BUILT.
 *   the ARCHIVED status   a distinct terminal state, transition, workspace and
 *                         retention redesign. DELIBERATELY DEFERRED, scope named
 *                         in docs/workflow/effitrans-business-workflow.md §3.15.
 *
 * R-19 recorded the second and it was read as the first being missing. Nothing
 * was built here; these guards defend the three properties a future archive
 * phase must not quietly break, and the two facts that keep the register honest.
 *
 * When Effitrans answers §8 of docs/maya/maya-p1-5-archive-audit.md, the
 * `archived_at`-is-unwritten guard is meant to be rewritten. The separation and
 * retention guards are not.
 *
 * AMENDED 2026-08-26 BY EXPLICIT BUSINESS RATIFICATION (C-4).
 *
 * The separation guard as originally written was STRONGER than the requirement
 * it defends: it denied `process:close` to both end-stage roles, which made
 * closure supervisory-only. C-4's journey showed the consequence — the last act
 * of every dossier was an OPS_SUPERVISOR intervention, in a programme whose
 * purpose is to prove the workflow runs without one.
 *
 * Effitrans ruled: Recouvrement performs the final dossier closure, after full
 * VERIFIED settlement and once every closure gate is satisfied. Granting that
 * authority does not let Recouvrement close early — closeDossier evaluates the
 * whole closure gate first, and the dossier's own transition re-checks customs
 * release, invoice settlement and payment verification besides.
 *
 * THE ENDURING INVARIANT IS UNCHANGED: archive and closure are distinct acts,
 * and no single end-stage role may collapse both. Administration archives and
 * may not close; Recouvrement closes and may not archive. Only the false
 * corollary — that NEITHER may close — was retired.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import type { FileStatus } from "@/lib/files/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ROLES = "lib/platform/role-templates.ts";
const step = (key: string) => EFFITRANS_PROCESS.find((s) => s.key === key)!;

function rolePerms(key: string): string[] {
  const s = read(ROLES);
  const i = s.indexOf(`key: "${key}"`);
  expect(i, key).toBeGreaterThan(-1);
  const block = s.slice(i, s.indexOf('key: "', i + 6));
  return [...new Set([...block.matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map((m) => m[1]))];
}

// ===========================================================================
describe("archive is not closure, and RBAC says so", () => {
  it("the two acts have different owners at different steps", () => {
    expect(step("administration_deposit_prep").role).toBe("ADMINISTRATIVE_OFFICER");
    expect(step("administration_deposit_prep").stepNumber).toBe(23);
    expect(step("collections").role).toBe("COLLECTIONS_OFFICER");
    expect(step("collections").stepNumber).toBe(26);
    // The registry says it in words, on the step itself.
    expect(step("administration_deposit_prep").description)
      .toContain("L'archivage n'est PAS la clôture financière");
  });

  it("neither end-stage role can perform the other's act", () => {
    // Stronger than the sentence: the CEO separation is enforced by grants.
    //
    // BUSINESS RATIFICATION 2026-08-26 — this guard was STRONGER than the
    // requirement it defends. It denied `process:close` to BOTH end-stage
    // roles, which made closure supervisory-only and left the last act of every
    // dossier an intervention. Effitrans has since ruled explicitly:
    // Recouvrement performs the final dossier closure, after full verified
    // settlement and once every closure gate is satisfied.
    //
    // The ENDURING invariant is unchanged and still asserted below: archive and
    // closure are DISTINCT acts and no single end-stage role may collapse both.
    // Administration archives and may not close; Recouvrement closes and may
    // not archive. What moved is only the false corollary that neither may
    // close — an amendment, not a weakening, and not a workaround for a test.
    const admin = rolePerms("ADMINISTRATIVE_OFFICER");
    const collections = rolePerms("COLLECTIONS_OFFICER");

    // Administration archives — and still may NOT close.
    expect(admin).toContain("admin_service:manage");
    expect(admin).toContain("courier:assign");
    for (const denied of ["file:update", "process:close", "collections:manage"]) {
      expect(admin, `ADMINISTRATIVE_OFFICER must not hold ${denied}`).not.toContain(denied);
    }

    // Recouvrement closes — and still may NOT perform Administration's acts.
    expect(collections).toContain("collections:manage");
    expect(collections, "RATIFIED: Recouvrement performs the final closure").toContain("process:close");
    for (const denied of ["admin_service:manage", "courier:assign"]) {
      expect(collections, `COLLECTIONS_OFFICER must not hold ${denied}`).not.toContain(denied);
    }

    // The separation itself, stated as the property rather than as a list: the
    // two roles' authorities do not overlap on either act.
    expect(admin.includes("process:close"), "archive role must not close").toBe(false);
    expect(collections.includes("admin_service:manage"), "closure role must not archive").toBe(false);
  });

  it("the product tells the operator the same thing", () => {
    expect(read("app/deposits/page.tsx"))
      .toContain("L&apos;archivage n&apos;est pas la clôture");
  });
});

// ===========================================================================
describe("the ARCHIVED status is deferred, not missing", () => {
  it("no ARCHIVED file status exists, and the ladder ends at CLOSED", () => {
    const statuses: FileStatus[] = ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED", "CANCELLED"];
    const union = read("lib/files/types.ts").slice(read("lib/files/types.ts").indexOf("FileStatus"));
    for (const s of statuses) expect(union.slice(0, 200)).toContain(`"${s}"`);
    expect(union.slice(0, 200)).not.toContain('"ARCHIVED"');
  });

  it("archived_at is reserved and unwritten — for the dossier, not the client", () => {
    // The column exists on operational_file and its migration says why.
    expect(read("supabase/migrations/20260614000002_create_operational_file.sql"))
      .toMatch(/archived_at[\s\S]{0,60}reserved/);
    // No code writes it. `client.archived_at` is a DIFFERENT column on a
    // DIFFERENT table and is legitimately written by lib/clients/actions.ts —
    // so this asserts the dossier surfaces, not a repo-wide word ban.
    for (const f of ["lib/files/service.ts", "lib/files/actions.ts", "lib/deposit/actions.ts"]) {
      expect(code(f), f).not.toContain("archived_at");
    }
    // The audit action exists and is still unused — dead until the phase lands.
    expect(read("lib/audit/events.ts")).toContain("FILE_ARCHIVED");
  });

  it("the deferral is documented with a named scope", () => {
    // Not an oversight: a decision, with what it covers written down.
    const wf = read("docs/workflow/effitrans-business-workflow.md");
    expect(wf).toContain("deferred phase");
    expect(wf).toMatch(/Deferred:.*ARCHIVED.*status/);
    expect(wf).toContain("No `ARCHIVED` status exists");
  });
});

// ===========================================================================
describe("step 23 is built and is not blocked by the deferral", () => {
  it("its other two evidence items are really recorded", () => {
    const a = code("lib/deposit/actions.ts");
    expect(a).toContain("export async function preparePackage");
    expect(a).toContain("prepared_at");
    expect(a).toContain("export async function assignCourier");
    expect(a).toContain('guard("admin_service:manage"');
    expect(step("administration_deposit_prep").permissions).toContain("admin_service:manage");
  });

  it("completionRule and requiredEvidence are descriptive, never enforced", () => {
    // This is why the missing archived_at blocks nothing. completionRule is a
    // label shown as `nextAction`; evidenceKeys is only ever counted.
    expect(code("lib/process/queues/service.ts")).toContain("nextAction: node?.completionRule");
    expect(code("lib/workflow/policy/validate.ts")).toMatch(/evidenceKeys\?\.length/);
    expect(step("administration_deposit_prep").requiredEvidence).toContain("archived_at");
  });
});

// ===========================================================================
describe("retention: archive may never destroy evidence", () => {
  it("the deposit chain of custody is append-only", () => {
    const m = code("supabase/migrations/20260714000002_deposit_custody.sql");
    expect(m).toMatch(/no_update|no_delete/);
  });

  it("the audit is on the record", () => {
    const doc = read("docs/maya/maya-p1-5-archive-audit.md");
    expect(doc).toContain("STALE GAP; NOTHING TO BUILD");
    expect(doc).toContain("DELIBERATELY DEFERRED");
    // The questions a future phase must answer first.
    expect(doc).toContain("Is archive **reversible**");
  });
});
