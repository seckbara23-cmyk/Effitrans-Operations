/**
 * C-4 — evidence the actor cannot SEE is not evidence the actor may CLOSE.
 * ---------------------------------------------------------------------------
 * The defect: `evaluateStepEvidence` classifies an item the caller has no read
 * access to as `unauthorized` — neither satisfied nor missing — and `complete`
 * was computed from `missing`/`invalid`/`pendingReview` only. A step whose whole
 * evidence set was invisible to the actor therefore reported complete on an
 * empty `missing` and closed having verified nothing.
 *
 * The evaluator is NOT changed here: reporting "I cannot say" is the honest
 * answer for a reader, and a queue must not paint a step red merely because the
 * viewer is not the auditor. What changed is the WRITE path, which must not act
 * on an answer that says "I cannot say".
 *
 * These are the source-level and pure-function halves. The behavioural halves —
 * refusal code, state unchanged after refusal, and the quotation lead executing
 * the live devis path — are in tests/journey/lifecycle.journey.ts against a real
 * database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateStepEvidence } from "@/lib/process/engine/evidence";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/** The body of one exported function, bounded by the next top-level export. */
function fnSlice(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const after = source.indexOf("\nexport ", start + 1);
  return source.slice(start, after === -1 ? source.length : after);
}

const blindSnap = {
  documents: [], invoices: [], customs: null, declaredAbsences: [],
  access: { documents: false, customs: false, transport: false, finance: false },
} as never;

const sightedEmptySnap = {
  documents: [], invoices: [], customs: null, declaredAbsences: [],
  access: { documents: true, customs: true, transport: true, finance: true },
} as never;

describe("C-4 — the evaluator still reports blindness honestly", () => {
  it("classifies unreadable evidence as unauthorized, never as satisfied", () => {
    const ev = evaluateStepEvidence("cotation", blindSnap);
    expect(ev.unauthorized).toEqual(["QUOTATION", "QUOTATION_APPROVAL"]);
    expect(ev.satisfied, "unauthorized must never be counted as satisfied").toEqual([]);
    expect(ev.missing, "and it is not the same claim as missing").toEqual([]);
  });

  it("still distinguishes MISSING from UNAUTHORIZED for a sighted actor", () => {
    const ev = evaluateStepEvidence("cotation", sightedEmptySnap);
    expect(ev.missing).toEqual(["QUOTATION", "QUOTATION_APPROVAL"]);
    expect(ev.unauthorized).toEqual([]);
    expect(ev.complete).toBe(false);
  });
});

describe("C-4 — the WRITE path refuses what the evaluator cannot vouch for", () => {
  const submit = fnSlice(read("lib/process/engine/actions.ts"), "submitStep");

  it("submitStep refuses on unauthorized evidence, with its own code", () => {
    expect(submit).toContain("ev.unauthorized.length > 0");
    expect(submit).toContain('fail("evidence_unauthorized")');
  });

  it("the authority check runs BEFORE the completeness check", () => {
    // Order is the whole point: `complete` can be true while `unauthorized` is
    // non-empty — that combination IS the defect — so a guard placed after the
    // completeness branch would never be reached in exactly the case it exists
    // to catch.
    const authority = submit.indexOf("ev.unauthorized.length > 0");
    const completeness = submit.indexOf("!ev.complete");
    expect(authority).toBeGreaterThan(-1);
    expect(completeness).toBeGreaterThan(-1);
    expect(authority, "the unauthorized guard must precede !ev.complete").toBeLessThan(completeness);
  });

  it("the two refusals stay distinct — neither is folded into the other", () => {
    // `evidence_missing` now refuses THROUGH `failWithEvidence`, which names the
    // outstanding artefacts; `evidence_unauthorized` deliberately does not, since
    // the caller may not be told what it cannot see. Still exactly one of each.
    expect(submit).toContain('failWithEvidence("evidence_missing", ev)');
    expect(submit.match(/fail\("evidence_unauthorized"\)/g) ?? []).toHaveLength(1);
    expect(submit.match(/failWithEvidence\("evidence_missing"/g) ?? []).toHaveLength(1);
    expect(submit).not.toContain('failWithEvidence("evidence_unauthorized"');
  });

  it("the operator sees a sentence, not a code", () => {
    const fr = read("components/process/queue-row-actions.tsx");
    expect(fr).toContain("evidence_unauthorized:");
    const line = fr.slice(fr.indexOf("evidence_unauthorized:"));
    expect(line.slice(0, 260)).toMatch(/n'avez pas accès aux preuves/);
  });
});

describe("C-4 — the quotation lead can read the evidence its own step requires", () => {
  // Step 1 (Cotation) requires QUOTATION + QUOTATION_APPROVAL, both gated on
  // document:read. Without the grant the engine's new refusal would hard-block
  // QUOTATION_MANAGER from the one step it exists to perform. Asserted in all
  // THREE sources, because they answer for three different populations:
  // templates provision NEW tenants, seed.sql builds a fresh database, and the
  // migration repairs tenants that already exist. Two out of three is drift.
  it("role-templates.ts (provisioning) grants it", () => {
    const tpl = getTenantRoleTemplate("QUOTATION_MANAGER");
    expect(tpl, "QUOTATION_MANAGER template missing").toBeDefined();
    expect(tpl!.permissions).toContain("document:read");
  });

  it("seed.sql (fresh database) grants it", () => {
    const seed = read("supabase/seed.sql");
    const blocks = seed.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    const granted = blocks.some(
      (b) => /r\.code\s*=\s*'QUOTATION_MANAGER'/.test(b) && b.includes("'document:read'"),
    );
    expect(granted, "no seed block grants document:read to QUOTATION_MANAGER").toBe(true);
  });

  it("migration 124 (existing tenants) grants it and asserts the result", () => {
    const m = read("supabase/migrations/20260916000001_quotation_manager_document_read.sql");
    expect(m).toContain("'document:read'");
    expect(m).toContain("QUOTATION_MANAGER");
    // The migration must VERIFY, not merely attempt: an unqualified insert that
    // silently granted nothing would otherwise look identical to success.
    expect(m).toMatch(/raise exception 'M124/);
  });

  it("reading its evidence does not become authoring or signing it", () => {
    const tpl = getTenantRoleTemplate("QUOTATION_MANAGER")!;
    expect(tpl.permissions).not.toContain("document:create");
    expect(tpl.permissions).not.toContain("document:update");
    expect(tpl.permissions).not.toContain("document:approve");
  });
});
