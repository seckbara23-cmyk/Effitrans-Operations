/**
 * MAYA-P1.6 — Recouvrement → dossier closure: classification A, pinned.
 * ---------------------------------------------------------------------------
 * I ended P1.5 by suspecting RBAC was wrong: COLLECTIONS_OFFICER holds neither
 * `file:update` nor `process:close`, so — I reasoned — the role the CEO names as
 * closing the dossier might be unable to. It was the wrong reading twice over.
 *
 *   * Recouvrement was never meant to close. The architecture document splits
 *     the end-chain into TWO rows: step 26 Collections produces the settlement
 *     evidence, step 27 Operations performs « Clôture du dossier » under
 *     `file:transition`.
 *   * Step 26's declared `permissions: [..., "file:update"]` is a LABEL. The
 *     engine reads `permissions[0]` only. I read metadata as a requirement —
 *     the same class of error as P1.4's stale `implementation` block.
 *
 * So nothing is built. These guards defend the separation that makes the chain
 * safe, and the invariant that no payment event may ever close a dossier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closureBlockers, canCloseDossier, type ClosureFactsInput } from "@/lib/files/closure";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const COLLECTIONS = "lib/collections/actions.ts";
const FINANCE = "lib/finance/actions.ts";

function holders(permission: string): string[] {
  const s = read("lib/platform/role-templates.ts");
  const out: string[] = [];
  for (const m of s.matchAll(/key: "(\w+)"/g)) {
    const next = s.indexOf('key: "', m.index! + 6);
    if (s.slice(m.index!, next === -1 ? undefined : next).includes(`"${permission}"`)) out.push(m[1]);
  }
  return out;
}

function actionBody(file: string, name: string): string {
  const s = code(file);
  const start = s.indexOf(`export async function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const next = s.indexOf("export async function", start + 1);
  return s.slice(start, next === -1 ? undefined : next);
}

/** A dossier that is settled in every respect. */
const settled = (over: Partial<ClosureFactsInput> = {}): ClosureFactsInput => ({
  fileType: "IMP",
  customs: { status: "RELEASED", required: true },
  transport: { status: "DELIVERED" },
  invoices: [{ status: "ISSUED", balance: 0 }],
  payments: [{ verified: true }],
  ...over,
});

// ===========================================================================
describe("Recouvrement proves settlement; Operations closes", () => {
  it("the collector may record a payment and may never verify it", () => {
    // §L maker-checker, enforced by grants rather than a runtime identity test.
    expect(holders("finance:payment")).toContain("COLLECTIONS_OFFICER");
    expect(holders("finance:void")).not.toContain("COLLECTIONS_OFFICER");
    expect(actionBody(FINANCE, "recordPayment")).toContain('assertPermission("finance:payment")');
    expect(actionBody(FINANCE, "verifyPayment")).toContain('assertPermission("finance:void")');
  });

  it("the collector may finish the recovery and may not close anything", () => {
    expect(holders("collections:manage")).toContain("COLLECTIONS_OFFICER");
    for (const denied of ["process:close", "file:transition", "file:update"]) {
      expect(holders(denied), denied).not.toContain("COLLECTIONS_OFFICER");
    }
    // …and the action says so itself.
    expect(actionBody(COLLECTIONS, "completeCollections")).toContain('guard("collections:manage"');
    expect(read(COLLECTIONS)).toContain("This is deliberately NOT closure");
  });

  it("the two closure permissions govern two different objects", () => {
    // process:close closes the process INSTANCE and then reuses the file seam;
    // file:transition closes the DOSSIER. Neither is a superset of the other.
    expect(holders("process:close").sort()).toEqual(["OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
    expect(holders("file:transition").sort())
      .toEqual(["ACCOUNT_MANAGER", "COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
    const close = actionBody(COLLECTIONS, "closeDossier");
    expect(close).toContain('assertPermission("process:close")');
    expect(close).toContain('transitionFile(fileId, "CLOSED")');
    // It never writes the dossier status behind the seam's back.
    expect(close).not.toMatch(/from\("operational_file"\)[\s\S]{0,200}\.update\(/);
  });

  it("the migration records the separation as intentional", () => {
    expect(read("supabase/migrations/20260714000003_collections_closure.sql"))
      .toContain("a collector may mark the\n--    recovery complete, but the dossier is closed by a supervisor");
  });
});

// ===========================================================================
describe("the closure gate is one rule, and it is real", () => {
  it("a fully settled dossier closes", () => {
    expect(closureBlockers(settled())).toEqual([]);
    expect(canCloseDossier(settled())).toBe(true);
  });

  it("an unpaid or partially paid dossier does not", () => {
    expect(closureBlockers(settled({ invoices: [{ status: "ISSUED", balance: 250_000 }] })))
      .toContain("invoice_outstanding");
    expect(closureBlockers(settled({ invoices: [{ status: "DRAFT", balance: 0 }] })))
      .toContain("invoice_outstanding");
  });

  it("a VOID invoice proves nothing — it is not a settled invoice", () => {
    // Voiding the only invoice leaves the dossier with none, not with a paid one.
    expect(closureBlockers(settled({ invoices: [{ status: "VOID", balance: 0 }] })))
      .toContain("no_invoice");
  });

  it("an UNVERIFIED payment blocks even at zero balance", () => {
    // The heart of §L: one person must not both receive and confirm the money.
    const b = closureBlockers(settled({ payments: [{ verified: true }, { verified: false }] }));
    expect(b).toContain("payment_unverified");
    expect(canCloseDossier(settled({ payments: [{ verified: false }] }))).toBe(false);
  });

  it("customs and delivery still gate closure", () => {
    expect(closureBlockers(settled({ customs: { status: "DECLARED", required: true } })))
      .toContain("customs_not_released");
    expect(closureBlockers(settled({ transport: { status: "IN_TRANSIT" } })))
      .toContain("delivery_incomplete");
    // The documented escape hatches stay open.
    expect(closureBlockers(settled({ customs: { status: "DECLARED", required: false } }))).toEqual([]);
    expect(closureBlockers(settled({ transport: { status: "CANCELLED" } }))).toEqual([]);
  });

  it("both doors call the SAME rule — a display-only gate is not a control", () => {
    expect(code("lib/files/actions.ts")).toContain("closureBlockers");
    expect(code(COLLECTIONS)).toContain("evaluateClosure");
    expect(read("lib/files/closure.ts")).toContain("is not a control; it is a\n * suggestion");
  });
});

// ===========================================================================
describe("payment never closes a dossier by itself", () => {
  it("verifyPayment transitions nothing", () => {
    // §P, the mandatory invariant. Settlement is a precondition of closure, not
    // the closure decision.
    const v = actionBody(FINANCE, "verifyPayment");
    expect(v).not.toMatch(/transitionFile|closeDossier|"CLOSED"/);
    expect(actionBody(FINANCE, "recordPayment")).not.toMatch(/transitionFile|closeDossier|"CLOSED"/);
  });

  it("completing the recovery transitions nothing either", () => {
    expect(actionBody(COLLECTIONS, "completeCollections")).not.toMatch(/transitionFile|"CLOSED"/);
  });
});

// ===========================================================================
describe("step 26's declared permissions are a label, not a requirement", () => {
  it("the engine reads permissions[0] only", () => {
    const step26 = EFFITRANS_PROCESS.find((s) => s.key === "collections")!;
    expect(step26.stepNumber).toBe(26);
    expect(step26.role).toBe("COLLECTIONS_OFFICER");
    expect(step26.permissions[0]).toBe("collections:manage");
    expect(step26.permissions).toContain("file:update"); // …and it is never consumed
    expect(code("lib/process/engine/actions.ts")).toContain("permissions[0]");
    // The P1.5 finding, re-verified rather than carried over.
    expect(code("lib/process/queues/service.ts")).toContain("nextAction: node?.completionRule");
  });

  it("the audit records the correction to my own P1.5 note", () => {
    const doc = read("docs/maya/maya-p1-6-closure-audit.md");
    expect(doc).toContain("ALREADY IMPLEMENTED CORRECTLY");
    // Prose wraps in the document; match within a line.
    expect(doc).toContain("hypothesis is **wrong**");
    // The defect found on the way, reported and not built.
    expect(doc).toContain("Control Tower counts readiness gaps on closed dossiers");
  });
});
