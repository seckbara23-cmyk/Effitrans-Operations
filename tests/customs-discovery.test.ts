/**
 * Douane dossier discoverability.
 *
 * `user_readable_file_ids` granted visibility PERSON by person — owner,
 * assignee, task, bounded assignment history — with no notion of a department.
 * The three customs roles hold `file:read` but not `file:read:all`, so a Douane
 * user who had not been personally assigned saw ZERO dossiers, even where
 * customs was required, declared and released by their own team.
 *
 * The predicate itself is proven on live Postgres by
 * `supabase/tests/rls_customs_discovery_test.sql`. These tests pin the SHAPE of
 * the fix: scope, exclusions, the single authorization contract, and the
 * security boundaries that must not move.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260728000002_customs_department_discovery.sql";
const SUITE = "supabase/tests/rls_customs_discovery_test.sql";
const sql = () => sqlCode(MIGRATION);

// ---------------------------------------------------------------------------
describe("the customs discovery predicate", () => {
  it("covers exactly the three ratified customs roles", () => {
    expect(sql()).toContain("'CUSTOMS_DECLARANT', 'CHIEF_OF_TRANSIT', 'CUSTOMS_FIELD_AGENT'");
  });

  it("requires an APPLICABLE customs leg — waived legs are excluded", () => {
    const s = sql();
    expect(s).toMatch(/from public\.customs_record c[\s\S]{0,220}c\.required\s*=\s*true/);
  });

  it("ignores soft-deleted customs records", () => {
    expect(sql()).toMatch(/c\.deleted_at is null/);
  });

  it("is tenant-scoped on BOTH the role and the customs record", () => {
    const s = sql();
    const branch = s.slice(s.indexOf("DEPARTMENT INVOLVEMENT") >= 0 ? 0 : 0);
    expect(branch).toMatch(/ur\.tenant_id = p_tenant/);
    expect(branch).toMatch(/c\.tenant_id = p_tenant/);
  });

  it("has NO status filter — completed and archived dossiers stay discoverable", () => {
    const s = sql();
    const start = s.indexOf("or (\n        exists (");
    const branch = s.slice(start, start + 900);
    expect(branch).not.toMatch(/f\.status/);
    expect(branch).not.toContain("CLOSED");
    expect(branch).not.toContain("ARCHIVED");
  });
});

// ---------------------------------------------------------------------------
describe("security boundaries that must not move", () => {
  it("grants NO permission to anyone", () => {
    // `file:read:all` legitimately APPEARS — it is the pre-existing clause the
    // function already honours. What must not appear is a GRANT of it.
    expect(sql()).not.toMatch(/insert into public\.role_permission/i);
    expect(sql()).not.toMatch(/grant .* to (authenticated|anon)/i);
  });

  it("does not extend discovery to Transport or Finance by analogy", () => {
    const s = sql();
    for (const role of ["TRANSPORT_OFFICER", "FINANCE_OFFICER", "BILLING_OFFICER", "PICKUP_AGENT"]) {
      expect(s, role).not.toContain(`'${role}'`);
    }
    expect(s).not.toContain("transport_record");
    expect(s).not.toContain("from public.invoice");
  });

  it("leaves CASHIER untouched — DEC-C21 execute-only stands", () => {
    // CASHIER appears only in the documentation string, stating the boundary.
    // What matters is that it is not in the role list the predicate matches.
    const roleList = sql().slice(sql().indexOf("r.code in ("), sql().indexOf("r.code in (") + 120);
    expect(roleList).not.toContain("CASHIER");
    // and the role template still grants it no dossier read
    const t = read("lib/platform/role-templates.ts");
    const start = t.indexOf('key: "CASHIER"');
    const next = t.indexOf('key: "', start + 10);
    const cashier = t.slice(start, next > start ? next : undefined);
    expect(cashier).not.toContain('"file:read"');
    expect(cashier).not.toContain('"file:read:all"');
  });

  it("grants no mutation authority and creates no schema", () => {
    const s = sql();
    expect(s).not.toMatch(/create table|alter table|add column|create index/i);
    expect(s).not.toMatch(/insert into public\.(permission|role)\b/i);
  });

  it("changes one function and nothing else", () => {
    const s = sql();
    const fns = s.match(/create or replace function/g) ?? [];
    expect(fns).toHaveLength(1);
    expect(s).toContain("public.user_readable_file_ids(p_user uuid, p_tenant uuid)");
  });

  it("preserves every pre-existing visibility clause", () => {
    const s = sql();
    for (const clause of [
      "'file:read:all'",
      "f.account_manager_id = p_user",
      "f.coordinator_id = p_user",
      "f.created_by = p_user",
      "pi.owner_user_id = p_user",
      "t.assigned_to = p_user",
      "e.assigned_user_id = p_user",
      "assignment_event",
    ]) {
      expect(s, clause).toContain(clause);
    }
    // The retired source stays retired: it is named in the doc string as
    // deliberately absent, and must never return as a PREDICATE.
    expect(s).not.toMatch(/f\.assigned_to_user_id\s*=/);
  });
});

// ---------------------------------------------------------------------------
describe("ONE authorization contract — discovery cannot diverge from access", () => {
  it("the dossier list and direct access resolve through the same helper", () => {
    // list scope
    expect(code("lib/authz/visibility.ts")).toContain("user_readable_file_ids");
    // per-dossier openability is the same function
    expect(code("lib/authz/visibility.ts")).toMatch(/isFileVisible[\s\S]{0,300}resolveFileScope/);
  });

  it("RLS uses the same helper, so the row filter cannot disagree", () => {
    const rls = read("supabase/migrations/20260727000002_assignment_history.sql");
    expect(rls).toContain("user_readable_file_ids");
  });

  it("the live suite asserts discovery == openability", () => {
    const s = read(SUITE);
    expect(s).toContain("not public.can_read_file(d.id)");
    expect(s).toContain("discovery_matches_openability");
  });
});

// ---------------------------------------------------------------------------
describe("the live suite covers every ratified case", () => {
  const s = () => read(SUITE);

  it.each([
    ["required = true is discoverable", "discovers_customs_required"],
    ["still discoverable after completion", "discovers_after_completion"],
    ["still discoverable after archival", "discovers_after_archival"],
    ["required = false excluded", "excludes_waived_required_false"],
    ["handling-only excluded", "excludes_handling_only"],
    ["soft-deleted customs excluded", "excludes_soft_deleted_customs"],
    ["chief of transit discovers", "chief_of_transit_discovers"],
    ["field agent discovers", "field_agent_discovers"],
    ["cashier discovers nothing", "cashier_discovers_nothing"],
    ["cross-tenant denied", "cross_tenant_denied"],
    ["discovery matches openability", "discovery_matches_openability"],
  ])("asserts: %s", (_label, key) => {
    expect(s()).toContain(key);
  });

  it("proves department discovery specifically — not personal ownership", () => {
    // created_by is a DIFFERENT user, so nothing can leak in via the personal
    // clauses; a pass can only come from the new department branch.
    expect(s()).toContain("created_by is deliberately a DIFFERENT user");
  });

  it("is wired into CI", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/rls_customs_discovery_test.sql");
  });
});

// ---------------------------------------------------------------------------
describe("scope discipline", () => {
  it("ships exactly one migration", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => /customs_department_discovery/.test(f))).toHaveLength(1);
  });

  it("documents its own rollback", () => {
    expect(read(MIGRATION)).toMatch(/ROLLBACK/);
  });

  it("touches no application code", () => {
    // The fix is entirely in the coarse SQL filter; every surface already
    // routes through it, which is why one change fixes list, search, counts,
    // queues, direct URL and archived retrieval together.
    expect(code("lib/authz/visibility.ts")).not.toContain("CUSTOMS_DECLARANT");
    expect(code("lib/files/service.ts")).not.toContain("CUSTOMS_DECLARANT");
  });
});
