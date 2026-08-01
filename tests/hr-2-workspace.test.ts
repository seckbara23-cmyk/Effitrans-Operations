/**
 * HR-2 — Employee Workspace, structural contracts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIG = "supabase/migrations/20260801000002_hr_employee_workspace.sql";
const ASSIGN = "lib/hr/assignment-actions.ts";
const LEDGER = "lib/hr/ledger.ts";
const ACTIONS = "lib/hr/actions.ts";

describe("migration 74 is minimal and additive", () => {
  const m = read(MIG).replace(/^\s*--.*$/gm, "");
  it("widens the import-kind CHECK to include EMPLOYEES", () => {
    expect(m).toContain("'ORG_UNITS', 'POSITIONS', 'WORK_LOCATIONS', 'EMPLOYEES'");
  });
  it("adds no table, no permission, no grant", () => {
    expect(m).not.toContain("create table");
    expect(m).not.toContain("public.permission");
    expect(m).not.toContain("role_permission");
  });
});

describe("assignment engine — append-and-close, never overwrite", () => {
  const a = code(ASSIGN);
  it("closes the open row and inserts a new one; no update of historical fields", () => {
    expect(a).toContain('update({ effective_to: today })');
    expect(a).toContain('.insert({');
    // The ONLY updates in this module set/clear effective_to (close + compensation).
    const updates = [...a.matchAll(/\.update\(\{([^}]+)\}\)/g)].map((m) => m[1].trim());
    for (const u of updates) expect(u).toMatch(/^effective_to:/);
  });
  it("has no delete of history (the only delete is the compensation of the fresh row)", () => {
    const deletes = [...a.matchAll(/\.delete\(\)/g)];
    expect(deletes.length).toBe(1);
    expect(a).toContain('.delete().eq("id", created.id)');
  });
  it("emission is mandatory: event failure compensates and aborts", () => {
    expect(a).toContain('error: "event_failed"');
    expect(a.indexOf("await emitHrEvent")).toBeGreaterThan(a.indexOf(".insert({"));
  });
  it("the change kind is the actor's declaration (promotion/transfer/change)", () => {
    expect(a).toContain('"PROMOTION" | "TRANSFER" | "CHANGE"');
    expect(a).toContain("change_kind: input.changeKind");
  });
});

describe("ledger — every registry write emits, with compensation", () => {
  const s = code(ACTIONS);
  it("createEmployee, transitionEmployee, link and unlink all emit", () => {
    expect([...s.matchAll(/emitHrEvent\(/g)].length).toBe(4);
    for (const k of ['"created"', '"status_changed"', '"account_linked"', '"account_unlinked"'])
      expect(s).toContain(`kind: ${k}`);
  });
  it("payloads are C3-free by vocabulary (no salary/amount/identifier keys)", () => {
    for (const p of [ASSIGN, ACTIONS, LEDGER]) {
      expect(code(p)).not.toMatch(/salary|salaire|amount|montant|cni|passport|iban/i);
    }
  });
  it("the projection is read-only: no client component imports the ledger writer", () => {
    expect(read("components/hr/assignment-panel.tsx")).not.toContain("emitHrEvent");
    expect(code(LEDGER)).toContain('import "server-only"');
  });
});

describe("EMPLOYEES import stays staging-only", () => {
  const o = code("lib/hr/organization-actions.ts");
  it("the kind exists with its validation, and no apply path appeared", () => {
    expect(o).toContain("EMPLOYEES:");
    expect(o).toContain('"invalid_department"');
    expect(o).not.toMatch(/applyHrImport|from\("employee"\)\s*\.insert/);
  });
});

describe("the profile is a workspace", () => {
  const p = read("app/departments/hr/[id]/page.tsx");
  it("renders Affectation, Chronologie, and dark HR-3 tabs", () => {
    expect(p).toContain("AssignmentPanel");
    expect(p).toContain("Chronologie");
    for (const t of ["Contrats", "Documents", "Notes"]) expect(p).toContain(t);
    expect(p).toContain("HR-3");
  });
});
