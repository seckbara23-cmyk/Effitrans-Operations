/** HR-3 — Documents & Contracts, structural contracts. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, ""); // WES-9A lesson: strip SQL comments
const MIG = "supabase/migrations/20260802000001_hr_documents_contracts.sql";
const ACTIONS = "lib/hr/employee-file-actions.ts";

describe("bounded context — never the logistics document subsystem", () => {
  it("no HR-3 module touches public.document or its bucket", () => {
    for (const p of [ACTIONS, "lib/hr/employee-file.ts"]) {
      const s = code(p).replace(/hr_document\w*/g, "");
      expect(s, p).not.toMatch(/public\.document|from\("document"\)|DOCUMENTS_BUCKET/);
    }
    {
      const p = MIG;
      const s = sql(p).replace(/hr_document\w*/g, "");
      expect(s, p).not.toMatch(/public\.document\b|from\("document"\)|DOCUMENTS_BUCKET/);
    }
  });
  it("the hr-documents bucket is created PRIVATE with no authenticated storage policy", () => {
    const m = read(MIG).replace(/^\s*--.*$/gm, "");
    expect(m).toContain("values ('hr-documents', 'hr-documents', false)");
    expect(m).not.toMatch(/create policy[\s\S]{0,200}storage\.objects/);
  });
  it("downloads are 60s signed URLs minted server-side; C3 re-gates on hr:sensitive:read", () => {
    const a = code(ACTIONS);
    expect(a).toContain("createSignedUrl(doc.storage_path, 60)");
    expect(a).toContain('assertPermission("hr:sensitive:read")');
  });
});

describe("lifecycle + maker-checker", () => {
  const m = read(MIG).replace(/^\s*--.*$/gm, "");
  it("contract statuses and the verifier<>preparer CHECK", () => {
    expect(m).toContain("check (status in ('DRAFT','VERIFIED','ENDED'))");
    expect(m).toContain("verified_by <> prepared_by");
    expect(m).toContain("status <> 'VERIFIED' or verified_by is not null");
  });
  it("the action refuses self-verification by name", () => {
    expect(code(ACTIONS)).toContain('if (c.prepared_by === admin.id) return { ok: false, error: "same_actor" }');
  });
  it("documents soft-delete only — no hard-delete action; compensation deletes are storage+fresh-row only", () => {
    const a = code(ACTIONS);
    expect(a).toContain('update({ deleted_at:');
    // the two compensation .delete() calls target the just-created rows
    expect([...a.matchAll(/from\("hr_document"\)\.delete\(\)/g)].length).toBe(1);
    expect([...a.matchAll(/from\("employment_contract"\)\.delete\(\)/g)].length).toBe(1);
  });
  it("templates are immutable via prevent_mutation", () => {
    expect(m).toContain("trg_hr_template_version_immutable");
  });
});

describe("ledger + termination rule", () => {
  it("all four HR-3 kinds emit, labels exhaustive", () => {
    const a = code(ACTIONS);
    for (const k of ['"document_added"', '"contract_added"', '"contract_verified"', '"contract_ended"'])
      expect(a).toContain(`kind: ${k}`);
    const l = read("lib/hr/ledger.ts");
    for (const k of ["document_added", "contract_added", "contract_verified", "contract_ended"])
      expect(l).toContain(`${k}: "`);
  });
  it("TERMINATED is gated on required documents, and the refusal is named in French", () => {
    expect(code("lib/hr/actions.ts")).toContain('fail("missing_required_document")');
    expect(read("components/hr/employee-admin.tsx")).toContain("solde de tout compte");
    const m = read(MIG);
    expect(m).toContain("'SOLDE_TOUT_COMPTE'");
    expect(m).toContain("required_for_termination");
  });
  it("employee_identifier is ABSENT — DEC-B63 gate honoured (C3 gets no dark-first pass)", () => {
    expect(sql(MIG)).not.toContain("employee_identifier");
  });
});

describe("CI runs the HR-3 suite last", () => {
  it("appended after the HR-1 suite, before Stop", () => {
    const ci = read(".github/workflows/ci.yml");
    const hr1 = ci.indexOf("rls_hr_organization_test.sql");
    const hr3 = ci.indexOf("rls_hr_documents_test.sql");
    expect(hr3).toBeGreaterThan(hr1);
    expect(ci.indexOf("Stop local Supabase")).toBeGreaterThan(hr3);
  });
});
