/**
 * Clean-replay guard for SQL migrations.
 * ---------------------------------------------------------------------------
 * Regression test for the CI failure that kept `rls-tests` red from Phase 3.4
 * until Phase 5.0A:
 *
 *   ERROR: insert or update on table "role" violates foreign key constraint
 *   "role_tenant_id_fkey" (SQLSTATE 23503)
 *   Key (tenant_id)=(00000000-...-0001) is not present in table "organization".
 *
 * `supabase start` / `supabase db reset` apply every migration to an EMPTY
 * database and only then run supabase/seed.sql. So at migration time there is no
 * `organization` row: any literal `insert ... values (<tenant_uuid>, ...)` into a
 * tenant-scoped table violates its FK and aborts the entire replay — which is why
 * all 27 RLS suites silently never ran.
 *
 * Tenant-scoped rows may only be written from a migration as a GUARDED BACKFILL:
 *   insert into public.role (...)
 *   select '<tenant>', ...
 *   where exists (select 1 from public.organization where id = '<tenant>')
 * which no-ops on a clean DB (seed.sql owns that data) and backfills a live one.
 *
 * A `select`-driven insert is inherently safe: on a clean DB it matches zero rows.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Strip `--` line comments so commented-out SQL never trips the scanner. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * Strip dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$). Statements inside a
 * function body run when the function is CALLED — with a real tenant in scope —
 * not during the migration replay. e.g. next_file_number(p_tenant, ...) inserts
 * into file_counter using its PARAMETER, which is not a clean-replay hazard.
 */
function stripFunctionBodies(sql: string): string {
  return sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, " ");
}

/** A hardcoded tenant UUID in the statement — the actual hazard. */
const UUID_LITERAL = /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i;

type Offender = { file: string; table: string; statement: string };

/**
 * A statement is a clean-replay hazard when it inserts a LITERAL row (`values`)
 * into a tenant-scoped table without an `exists`-guard on `organization`.
 */
function findUnguardedInserts(file: string, sql: string): Offender[] {
  const out: Offender[] = [];

  for (const raw of stripFunctionBodies(stripComments(sql)).split(";")) {
    const stmt = raw.trim();
    if (!stmt) continue;

    const flat = stmt.replace(/\s+/g, " ").toLowerCase();

    const m = /^insert\s+into\s+(?:public\.)?([a-z_]+)/.exec(flat);
    if (!m) continue;

    const table = m[1];
    if (!TENANT_SCOPED_TABLES.has(table)) continue;

    // `insert ... select ...` is safe: zero rows on an empty DB.
    const isLiteralValues = /\bvalues\s*\(/.test(flat);
    if (!isLiteralValues) continue;

    // Only a HARDCODED tenant uuid can break the replay. A parameter or a
    // column reference resolves at call time, when the tenant already exists.
    if (!UUID_LITERAL.test(stmt)) continue;

    const guarded = /\bwhere\s+exists\s*\(\s*select\b[^)]*\borganization\b/.test(flat);
    if (guarded) continue;

    out.push({ file, table, statement: stmt.split("\n").slice(0, 3).join("\n") });
  }

  return out;
}

describe("migrations replay cleanly from an empty database", () => {
  it("finds migrations to scan", () => {
    expect(migrationFiles().length).toBeGreaterThan(30);
  });

  it("never inserts a literal tenant-scoped row without an organization guard", () => {
    const offenders: Offender[] = [];
    for (const file of migrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      offenders.push(...findUnguardedInserts(file, sql));
    }

    const detail = offenders
      .map((o) => `\n  ${o.file} → public.${o.table}\n${o.statement.replace(/^/gm, "      ")}`)
      .join("\n");

    expect(
      offenders,
      `Unguarded tenant-scoped INSERT ... VALUES in a migration. On a clean database ` +
        `\`organization\` is empty (seed.sql runs AFTER migrations), so this violates the ` +
        `tenant_id foreign key and aborts the whole replay — taking every RLS suite with it. ` +
        `Rewrite as a guarded backfill:\n` +
        `  insert into public.<table> (...)\n  select '<tenant>', ...\n` +
        `  where exists (select 1 from public.organization where id = '<tenant>');\n` +
        `Offenders:${detail}\n`,
    ).toEqual([]);
  });

  it("catches the exact statement that broke CI (scanner is not vacuously green)", () => {
    // The pre-fix form of 20260710000002_create_tracking.sql line 38.
    const broken = `
      insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
      values ('00000000-0000-0000-0000-000000000001', 'DRIVER', 'Chauffeur', 'Driver', true)
      on conflict (tenant_id, code) do nothing;
    `;
    expect(findUnguardedInserts("probe.sql", broken)).toHaveLength(1);
  });

  it("accepts the guarded backfill form", () => {
    const fixed = `
      insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
      select '00000000-0000-0000-0000-000000000001', 'DRIVER', 'Chauffeur', 'Driver', true
      where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
      on conflict (tenant_id, code) do nothing;
    `;
    expect(findUnguardedInserts("probe.sql", fixed)).toEqual([]);
  });

  it("accepts select-driven grants (zero rows on a clean DB)", () => {
    const grant = `
      insert into public.role_permission (role_id, permission_id)
      select r.id, p.id
      from public.role r
      join public.permission p on p.code = 'tracking:read'
      where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      on conflict do nothing;
    `;
    expect(findUnguardedInserts("probe.sql", grant)).toEqual([]);
  });

  it("ignores inserts inside a function body (they run at call time, with a real tenant)", () => {
    // next_file_number(p_tenant, p_type) — p_tenant is a PARAMETER, not a literal.
    const fn = `
      create or replace function public.next_file_number(p_tenant uuid, p_type text)
      returns text language plpgsql as $$
      begin
        insert into public.file_counter (tenant_id, type, year, next_seq)
        values (p_tenant, p_type, v_year, 1)
        on conflict (tenant_id, type, year) do update set next_seq = file_counter.next_seq + 1;
      end;
      $$;
    `;
    expect(findUnguardedInserts("probe.sql", fn)).toEqual([]);
  });

  it("ignores literal inserts into global (non-tenant) tables", () => {
    // document_type and permission are global — no tenant_id, no FK to organization.
    const global = `
      insert into public.document_type (code, label_fr, label_en, category) values
        ('PICKUP_PHOTO', 'Photo d''enlèvement', 'Pickup photo', 'operational');
    `;
    expect(findUnguardedInserts("probe.sql", global)).toEqual([]);
  });
});
