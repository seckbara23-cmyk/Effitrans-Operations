/**
 * Migration ↔ canonical-schema compatibility guard.
 * ---------------------------------------------------------------------------
 * Born from migration 73's failure: its permission INSERT named `scope` where
 * the live table (RBAC foundation, migration 2) has `data_scope`. CI caught it
 * (the Start-Supabase step aborted, skipping every RLS suite) and the operator
 * hit the identical 42703 in the production SQL editor. The migration was
 * atomic, so nothing landed — but the class must die here:
 *
 *   any INSERT a migration makes into a table it did NOT create must name only
 *   columns that exist in the hand-maintained DB types (lib/db/types.ts), which
 *   are themselves exercised by every service test.
 *
 * The "apply 1→N on a clean database" proof itself is CI's rls-tests job —
 * `supabase start` applies every migration from empty on every push. This
 * suite is the fast local guard that fires BEFORE a push gets that far.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const stripSqlComments = (s: string) => s.replace(/^\s*--.*$/gm, "");

const MIGRATIONS_DIR = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

/** Row-type column names per table, parsed from lib/db/types.ts. */
function typesColumns(): Map<string, Set<string>> {
  const src = read("lib/db/types.ts");
  const tables = new Map<string, Set<string>>();
  const tableRe = /(\w+): \{\s*Row: \{([\s\S]*?)\};/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src)) !== null) {
    const cols = new Set([...m[2].matchAll(/(\w+)(?:\?)?:/g)].map((c) => c[1]));
    if (cols.size > 0 && !tables.has(m[1])) tables.set(m[1], cols);
  }
  return tables;
}

// ---------------------------------------------------------------------------
describe("permission INSERTs use the canonical signature", () => {
  it("every migration writing public.permission names data_scope, never scope", () => {
    const offenders: string[] = [];
    for (const f of migrationFiles) {
      const sql = stripSqlComments(read(`supabase/migrations/${f}`));
      for (const m of sql.matchAll(/insert into public\.permission\s*\(([^)]+)\)/g)) {
        const cols = m[1].split(",").map((c) => c.trim());
        if (cols.includes("scope") || !cols.includes("data_scope")) offenders.push(`${f}: (${cols.join(", ")})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("migration 73 — every external-table reference matches the canonical schema", () => {
  const MIG = "supabase/migrations/20260801000001_hr_organization_foundation.sql";
  const sql = stripSqlComments(read(MIG));
  const created = new Set([...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]));
  const types = typesColumns();

  it("INSERT column lists into pre-existing tables exist in the DB types", () => {
    const problems: string[] = [];
    for (const m of sql.matchAll(/insert into public\.(\w+)\s*\(([^)]+)\)/g)) {
      const table = m[1];
      if (created.has(table)) continue;
      const known = types.get(table);
      expect(known, `types.ts has no table '${table}'`).toBeDefined();
      for (const col of m[2].split(",").map((c) => c.trim())) {
        if (!known!.has(col)) problems.push(`${table}.${col}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("foreign keys reference only tables that exist (types.ts or created here)", () => {
    for (const m of sql.matchAll(/references public\.(\w+)\s*\(/g)) {
      const t = m[1];
      expect(created.has(t) || types.has(t), `unknown FK target '${t}'`).toBe(true);
    }
  });

  it("trigger/RLS helper functions come from the foundation migrations", () => {
    const foundation = stripSqlComments(
      read("supabase/migrations/20260613000001_create_foundation_tables.sql") +
      read("supabase/migrations/20260613000002_create_rbac_foundation.sql") +
      read("supabase/migrations/20260613000003_rls_scope_hooks.sql"),
    );
    for (const fn of ["set_updated_at", "prevent_mutation", "auth_tenant_id", "has_permission"]) {
      if (sql.includes(`${fn}(`)) {
        expect(foundation, `helper ${fn} must predate migration 73`).toContain(`function public.${fn}`);
      }
    }
  });

  it("the ALTER-adjacent change touches employee via trigger only — no column change to any pre-existing table", () => {
    for (const m of sql.matchAll(/alter table public\.(\w+)([^;]*);/g)) {
      const t = m[1];
      if (created.has(t)) continue;
      // Only RLS enablement / triggers may touch pre-existing tables — never DDL columns.
      expect(m[2], `alter on pre-existing ${t}`).not.toMatch(/add column|drop column|alter column/);
    }
  });
});
