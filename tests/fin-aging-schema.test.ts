/**
 * FIN-AGING-2 — AR schema and security foundation (dark).
 *
 * The behavioural proofs live in supabase/tests/rls_aging_balance_test.sql, which
 * runs against a real Postgres in CI: constraints, triggers, lifecycle legality
 * and RLS cannot be honestly tested by reading SQL text. What THIS suite guards
 * is everything a static reader can prove and a reviewer would otherwise have to
 * take on trust — that the ratified matrix is what actually shipped, that the
 * phase is still dark, and that the DB suite is wired into CI at all (a suite
 * nobody runs proves nothing).
 *
 * The decision this phase turns on: `invoice.file_id` became nullable. That is
 * normally a dangerous relaxation, and it is only safe because `provenance`
 * defaults to PLATFORM_NATIVE and the CHECK forces a dossier for that value — so
 * every existing write path is still obliged to supply one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { LATEST_MIGRATION } from "@/lib/platform/ops/build-info";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260729000002_aging_balance_foundation.sql";
const SUITE = "supabase/tests/rls_aging_balance_test.sql";
const sql = () => sqlCode(MIGRATION);
const perms = (key: string) => TENANT_ROLE_TEMPLATES.find((r) => r.key === key)?.permissions ?? [];

const CODES = [
  "finance:aging:read",
  "finance:aging:draft_create",
  "finance:aging:draft_update",
  "finance:aging:import_stage",
  "finance:aging:import_approve",
  "finance:aging:validate",
  "finance:aging:finalize",
  "finance:aging:export",
  "finance:aging:print",
  "finance:aging:share",
  "finance:aging:template_manage",
];

/** The ratified matrix, transcribed once. Every assertion below reads from it. */
const MATRIX: Record<string, string[]> = {
  FINANCE_OFFICER: ["read", "draft_create", "draft_update", "export", "print"],
  ACCOUNTANT: ["read", "draft_create", "draft_update", "import_stage", "export", "print"],
  TREASURER: ["read", "export", "print"],
  DAF: ["read", "draft_create", "draft_update", "import_stage", "import_approve", "validate",
        "finalize", "export", "print", "share", "template_manage"],
  DGA: ["read", "import_approve", "validate", "finalize", "export", "print", "share"],
  CEO: ["read", "export", "print"],
  SYSTEM_ADMIN: ["read", "draft_create", "draft_update", "import_stage", "export", "print"],
};

// ===========================================================================
describe("the ratified permission matrix is what shipped", () => {
  it("all eleven codes exist and are well-formed module:action[:scope]", () => {
    // The ratified names used a fourth segment (finance:aging:draft:create); the
    // repo's enforced convention admits three, [a-z_] only. Same semantics,
    // established separator — as admin:users:reset_password did.
    for (const c of CODES) expect(c, c).toMatch(/^[a-z_]+:[a-z_]+(:[a-z_]+)?$/);
    expect(CODES).toHaveLength(11);
  });

  it.each(Object.keys(MATRIX))("%s holds exactly its ratified aging permissions", (role) => {
    const held = perms(role).filter((p) => p.startsWith("finance:aging:")).sort();
    const expected = MATRIX[role].map((a) => `finance:aging:${a}`).sort();
    expect(held).toEqual(expected);
  });

  it("NO role outside the matrix receives any aging permission", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      if (MATRIX[t.key]) continue;
      expect(t.permissions.filter((p) => p.startsWith("finance:aging:")), t.key).toEqual([]);
    }
  });

  it("SYSTEM_ADMIN cannot validate, finalize, approve imports, share, or manage templates", () => {
    // Administering the platform is not financial signoff authority. Granting it
    // "so an admin can unblock things" is how maker-checker becomes decorative.
    for (const a of ["validate", "finalize", "import_approve", "share", "template_manage"]) {
      expect(perms("SYSTEM_ADMIN"), a).not.toContain(`finance:aging:${a}`);
    }
  });

  it("the CEO reads and exports but does not share", () => {
    expect(perms("CEO")).toContain("finance:aging:export");
    expect(perms("CEO")).not.toContain("finance:aging:share");
  });

  it("template administration is DAF alone", () => {
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => t.permissions.includes("finance:aging:template_manage"))
      .map((t) => t.key);
    expect(holders).toEqual(["DAF"]);
  });

  it("import preparation and import approval are held by DIFFERENT sets", () => {
    // Structural separation of duties: the ACCOUNTANT who stages a batch cannot
    // be the seat that approves it, whatever the row-level trigger also says.
    const stagers = TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes("finance:aging:import_stage")).map((t) => t.key).sort();
    const approvers = TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes("finance:aging:import_approve")).map((t) => t.key).sort();
    expect(stagers).toEqual(["ACCOUNTANT", "DAF", "SYSTEM_ADMIN"]);
    expect(approvers).toEqual(["DAF", "DGA"]);
  });

  it("migration and seed agree with the templates", () => {
    const m = sql();
    const seed = read("supabase/seed.sql");
    for (const c of CODES) {
      expect(m, `migration ${c}`).toContain(`'${c}'`);
      expect(seed, `seed ${c}`).toContain(`'${c}'`);
    }
  });

  it("no compatibility fallback grants the four protected authorities", () => {
    // Unlike admin:users:*, nothing here NARROWS an existing capability, so no
    // legacy permission is accepted as a substitute. finance:validate must not
    // appear anywhere near an aging grant.
    const m = sql();
    const grants = m.slice(m.indexOf("insert into public.role_permission"));
    for (const legacy of ["finance:read", "finance:validate", "finance:issue", "admin:users:manage"]) {
      expect(grants, legacy).not.toContain(legacy);
    }
  });
});

// ===========================================================================
describe("Q-08 — a dossier is mandatory for platform invoices, not for legacy ones", () => {
  it("relaxes file_id and adds the provenance columns", () => {
    const m = sql();
    expect(m).toContain("alter table public.invoice alter column file_id drop not null");
    expect(m).toMatch(/add column if not exists provenance text not null default 'PLATFORM_NATIVE'/);
    expect(m).toMatch(/add column if not exists legacy_file_reference text/);
  });

  it("the CHECK is exactly the ratified invariant", () => {
    const m = sql();
    expect(m).toMatch(/provenance = 'PLATFORM_NATIVE' and file_id is not null/);
    expect(m).toMatch(/provenance = 'OPENING_IMPORT' and \(file_id is not null or legacy_file_reference is not null\)/);
  });

  it("the default keeps every EXISTING write path obliged to supply a dossier", () => {
    // This is why relaxing a NOT NULL on a core table is safe here: nothing that
    // exists today can create a dossier-less invoice, because nothing sets
    // provenance, and the default demands a file_id.
    expect(sql()).toContain("default 'PLATFORM_NATIVE'");
    expect(sql()).toMatch(/check \(provenance in \('PLATFORM_NATIVE', 'OPENING_IMPORT'\)\)/);
  });

  it("the shared tenant trigger stops rejecting a legitimately dossier-less invoice", () => {
    const m = sql();
    expect(m).toContain("create or replace function public.enforce_finance_file_tenant");
    expect(m).toMatch(/if new\.file_id is null then\s+return new;/);
    // …but a supplied dossier must still be same-tenant.
    expect(m).toContain("raise exception 'finance tenant mismatch");
  });

  it("no fake dossier is created anywhere to satisfy the old constraint", () => {
    const m = sql();
    expect(m).not.toMatch(/insert into public\.operational_file/i);
  });

  it("the two dossier-keyed consumers now exclude dossier-less receivables", () => {
    // Their row types assert file_id: string. Filtering keeps that assertion
    // TRUE rather than aspirational.
    expect(code("lib/control-tower/service.ts")).toContain('.not("file_id", "is", null)');
    expect(code("lib/collections/service.ts")).toContain('.not("file_id", "is", null)');
  });

  it("linking a legacy receivable later is append-only and preserves the origin", () => {
    const m = sql();
    expect(m).toContain("create table if not exists public.legacy_receivable_link");
    expect(m).toContain("preserved_legacy_reference");
    expect(m).toContain("previous_file_id");
    expect(m).toMatch(/trg_legacy_link_no_update[\s\S]{0,120}prevent_mutation/);
    expect(m).toMatch(/trg_legacy_link_no_delete[\s\S]{0,120}prevent_mutation/);
  });
});

// ===========================================================================
describe("one snapshot, five renderings", () => {
  it("pins everything needed to reproduce the figures", () => {
    const m = sql();
    for (const col of ["reporting_date", "currency", "engine_version", "bucket_scheme",
                       "risk_scheme", "template_id", "prepared_by", "validated_by",
                       "finalized_by", "status"]) {
      expect(m, col).toContain(col);
    }
  });

  it("stores ONE authoritative row set plus its totals — not five tab datasets", () => {
    const m = sql();
    expect(m).toContain("create table if not exists public.aging_report_row");
    expect(m).toContain("create table if not exists public.aging_report_totals");
    // No per-tab tables: the tabs are projections, and separate stores could drift.
    for (const forbidden of ["aging_dashboard", "aging_client_tab", "aging_chart_table", "aging_critical_table"]) {
      expect(m, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps source identity AND a copied client name", () => {
    const m = sql();
    expect(m).toContain("source_invoice_id");
    expect(m).toMatch(/client_name\s+text not null/); // copied: a rename must not rewrite history
    expect(m).toContain("legacy_file_reference text");
  });

  it("row order is pinned so a re-render cannot reshuffle a signed report", () => {
    expect(sql()).toContain("unique (report_id, row_order)");
  });

  it("one receivable appears at most once per report", () => {
    expect(sql()).toContain("unique (report_id, source_invoice_id)");
  });
});

// ===========================================================================
describe("immutability and lifecycle are enforced in the database", () => {
  it("snapshot rows freeze once the report leaves DRAFT", () => {
    const m = sql();
    expect(m).toContain("function public.enforce_aging_snapshot_immutable");
    expect(m).toMatch(/v_status <> 'DRAFT'/);
    expect(m).toMatch(/trg_aging_row_immutable before insert or update or delete/);
    expect(m).toMatch(/trg_aging_totals_immutable before insert or update or delete/);
  });

  it("only the ratified transitions are legal", () => {
    const m = sql();
    for (const t of ["('DRAFT', 'VALIDATED')", "('VALIDATED', 'FINAL')", "('FINAL', 'SUPERSEDED')"]) {
      expect(m, t).toContain(t);
    }
    expect(m).toContain("illegal aging report transition");
  });

  it("superseding must NAME the successor, and cancelling must give a reason", () => {
    const m = sql();
    expect(m).toContain("requires superseded_by_id");
    expect(m).toContain("requires a reason");
  });

  it("a FINAL or SUPERSEDED report can never be deleted", () => {
    const m = sql();
    expect(m).toContain("function public.prevent_final_aging_report_delete");
    expect(m).toMatch(/trg_aging_report_no_delete before delete/);
  });

  it("at most one live FINAL per tenant, arrêté and currency", () => {
    const m = sql();
    expect(m).toMatch(/create unique index if not exists uq_aging_report_one_final[\s\S]{0,160}where status = 'FINAL'/);
  });

  it("a template version pinned by a report is immutable", () => {
    const m = sql();
    expect(m).toContain("function public.protect_pinned_aging_template");
    expect(m).toContain("is pinned by an existing report");
  });

  it("artifacts cannot be re-hashed or deleted", () => {
    const m = sql();
    expect(m).toContain("function public.protect_aging_artifact");
    expect(m).toContain("may not be deleted");
    expect(m).toContain("unique (report_id, format)");
  });
});

// ===========================================================================
describe("trigger functions handle DELETE correctly", () => {
  // In a PL/pgSQL row trigger, NEW is UNASSIGNED for DELETE — `new.col` and even
  // a bare `coalesce(new, old)` raise "record \"new\" is not assigned yet"
  // rather than falling back to OLD. Two functions here were written that way
  // and would have failed the first time anyone deleted a snapshot row or an
  // unpinned template. Caught by review before CI ever ran the migration; this
  // guard keeps the pattern from returning.
  const deleteCapable = () => {
    const m = sql();
    const names = [...m.matchAll(/create trigger (\w+) before[^\n]*delete[^\n]*\n\s*for each row execute function public\.(\w+)/g)];
    return [...new Set(names.map((x) => x[2]))];
  };

  it("finds the DELETE-capable trigger functions", () => {
    expect(deleteCapable().length).toBeGreaterThan(0);
  });

  it("none of them dereferences NEW without a TG_OP branch", () => {
    const m = sql();
    for (const fn of deleteCapable()) {
      if (fn === "prevent_mutation") continue; // always raises; never returns
      const start = m.indexOf(`function public.${fn}()`);
      const body = m.slice(start, m.indexOf("$$;", start));
      const touchesNew = /\bnew\./.test(body) || /coalesce\(\s*new\s*,/.test(body);
      if (touchesNew) {
        // Any TG_OP branch is fine — guarding the UPDATE path (touch NEW inside,
        // fall through to raise on DELETE) is as correct as guarding the DELETE
        // path. What must not happen is NEW being read unconditionally.
        expect(body, `${fn} must branch on tg_op before touching NEW`).toMatch(/tg_op\s*=\s*'(DELETE|UPDATE|INSERT)'/);
      }
    }
  });

  it("never returns coalesce(new, old) — that itself fails on DELETE", () => {
    expect(sql()).not.toMatch(/return coalesce\(\s*new\s*,\s*old\s*\)/);
  });

  it("every trigger creation is idempotent, matching the header's claim", () => {
    const m = sql();
    const creates = [...m.matchAll(/^create trigger (\w+) /gm)].map((x) => x[1]);
    const drops = new Set([...m.matchAll(/^drop trigger if exists (\w+) /gm)].map((x) => x[1]));
    expect(creates.length).toBeGreaterThan(10);
    for (const t of creates) expect(drops.has(t), `${t} lacks a drop-if-exists guard`).toBe(true);
  });

  it("every POLICY creation is idempotent too — CREATE POLICY has no IF NOT EXISTS", () => {
    // Postgres offers no IF NOT EXISTS for CREATE POLICY, so an unguarded one
    // makes the whole migration fail on a second run with "policy already
    // exists" — the exact scenario an operator hits when re-applying a
    // corrected migration to a database that already has the first version.
    const m = sql();
    const creates = [...m.matchAll(/^create policy (\w+) on /gm)].map((x) => x[1]);
    const drops = new Set([...m.matchAll(/^drop policy if exists (\w+) on /gm)].map((x) => x[1]));
    expect(creates.length).toBe(10);
    for (const p of creates) expect(drops.has(p), `${p} lacks a drop-if-exists guard`).toBe(true);
  });

  it("nothing else in the migration would fail a second run", () => {
    const m = sql();
    // Tables, columns, indexes and constraints are all guarded; functions use
    // CREATE OR REPLACE; inserts use ON CONFLICT DO NOTHING.
    for (const [pattern, guard] of [
      [/^create table (?!if not exists)/gm, "create table without IF NOT EXISTS"],
      [/^create (unique )?index (?!if not exists)/gm, "create index without IF NOT EXISTS"],
      [/^create function /gm, "create function without OR REPLACE"],
    ] as [RegExp, string][]) {
      expect(m.match(pattern), guard).toBeNull();
    }
    for (const ins of m.match(/^insert into public\.\w+/gm) ?? []) {
      expect(m, ins).toContain("on conflict");
    }
  });
});

// ===========================================================================
describe("maker-checker is structural", () => {
  it("the report cannot exist with one person on both sides", () => {
    const m = sql();
    expect(m).toMatch(/constraint aging_report_validator_differs check \(validated_by is null or validated_by <> prepared_by\)/);
    expect(m).toMatch(/constraint aging_report_finalizer_differs check \(finalized_by is null or finalized_by <> prepared_by\)/);
  });

  it("an import batch cannot be approved by its preparer", () => {
    expect(sql()).toMatch(/constraint legacy_batch_approver_differs check \(approved_by is null or approved_by <> prepared_by\)/);
  });
});

// ===========================================================================
describe("the import pipeline cannot leak a bad row into the ledger", () => {
  it("creates batch, staging, error and approval trail", () => {
    const m = sql();
    for (const t of ["legacy_import_batch", "legacy_import_staging_row", "legacy_import_error"]) {
      expect(m, t).toContain(`create table if not exists public.${t}`);
    }
    expect(m).toContain("approved_by");
    expect(m).toContain("source_file_sha256");
    expect(m).toContain("source_row_number");
    expect(m).toContain("raw"); // the original row, preserved verbatim
  });

  it("a REJECTED staging row structurally cannot carry a receivable", () => {
    expect(sql()).toMatch(/check \(status <> 'REJECTED' or created_invoice_id is null\)/);
  });

  it("an ACCEPTED row must point at the invoice it created", () => {
    expect(sql()).toMatch(/check \(status <> 'ACCEPTED' or created_invoice_id is not null\)/);
  });

  it("duplicate detection is deterministic", () => {
    expect(sql()).toMatch(/create unique index if not exists uq_staging_invoice_number_per_batch/);
  });
});

// ===========================================================================
describe("RLS and tenancy", () => {
  const TABLES = [
    "aging_template_version", "aging_report", "aging_report_row", "aging_report_totals",
    "aging_report_artifact", "aging_report_share", "legacy_import_batch",
    "legacy_import_staging_row", "legacy_import_error", "legacy_receivable_link",
  ];

  // The migration column-aligns these statements for readability, so match on
  // normalised whitespace rather than on the exact spacing.
  const flat = () => sql().replace(/[ \t]+/g, " ");

  it.each(TABLES)("%s has RLS enabled", (t) => {
    expect(flat()).toContain(`alter table public.${t} enable row level security`);
  });

  it("every policy is SELECT-only and permission-gated — writes go through actions", () => {
    const m = sql();
    const policies = [...m.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+)/g)];
    expect(policies.length).toBe(TABLES.length);
    for (const [, name, , verb] of policies) expect(verb, name).toBe("select");
    expect(m).not.toMatch(/for (insert|update|delete)/);
    expect(m).not.toMatch(/with check/);
  });

  it("share links are readable only by the roles that may create them", () => {
    expect(sql()).toMatch(/create policy aging_report_share_select[\s\S]{0,200}has_permission\('finance:aging:share'\)/);
  });

  it("no anon policy exists — a public download resolves its token server-side", () => {
    expect(sql()).not.toMatch(/to anon/);
    expect(sql()).toContain("token_hash"); // never the token itself
  });

  it("child rows must match their parent's tenant", () => {
    const m = sql();
    expect(m).toContain("function public.enforce_aging_tenant_match");
    for (const t of ["trg_aging_row_tenant", "trg_aging_artifact_tenant", "trg_aging_share_tenant",
                     "trg_staging_tenant", "trg_legacy_link_tenant"]) {
      expect(m, t).toContain(t);
    }
  });

  it("a legacy receivable can only be linked to a dossier of its own tenant", () => {
    expect(sql()).toContain("function public.enforce_legacy_link_file_tenant");
    expect(sql()).toContain("function public.enforce_staging_file_tenant");
  });

  it("only a FINAL report's artifact can be shared externally", () => {
    const m = sql();
    expect(m).toContain("function public.enforce_aging_share_final_only");
    expect(m).toMatch(/only FINAL may be shared externally/);
  });
});

// ===========================================================================
describe("no competing system was created", () => {
  it("creates no second invoice, payment, client, dossier, audit or document table", () => {
    const m = sql();
    for (const t of ["public.invoice (", "public.payment (", "public.client (",
                     "public.operational_file (", "public.audit_log (", "public.document ("]) {
      expect(m, t).not.toContain(`create table ${t}`);
      expect(m, t).not.toContain(`create table if not exists ${t}`);
    }
  });

  it("reuses the existing collection-note and dispute models rather than cloning them", () => {
    const m = sql();
    expect(m).not.toContain("create table if not exists public.aging_collection_note");
    expect(m).not.toContain("create table if not exists public.aging_dispute");
  });

  it("touches the invoice table only additively", () => {
    const m = sql();
    const invoiceStatements = m.split("\n").filter((l) => l.includes("alter table public.invoice"));
    expect(invoiceStatements.length).toBeGreaterThan(0);
    expect(m).not.toMatch(/drop column/i);
    expect(m).not.toMatch(/drop table/i);
    expect(m).not.toMatch(/delete from public\./i);
  });
});

// ===========================================================================
describe("the DB suite is wired into CI, last, with a readable failure", () => {
  it("the suite exists and CI runs it", () => {
    expect(() => read(SUITE)).not.toThrow();
    expect(read(".github/workflows/ci.yml")).toContain(`-f ${SUITE}`);
  });

  it("it runs LAST — a new suite must never skip the established ones", () => {
    const ci = read(".github/workflows/ci.yml");
    // Each phase appends its suite after the last (the standing rule: newest
    // runs last), so this pin moves to whichever suite is currently newest.
    // EMP-3 appended its suite, so the pin moves to it (the standing rule).
    // OPS-SEC-2A appended two; the pin moves to the later of them.
    //
    // The property being defended is append-only ordering: a new suite inserted
    // BEFORE the established ones would, on failure, abort and skip every suite
    // after it — which is how one failure hid seventy skips during OPS-SEC-1.
    // EMP-5G appended its readiness suite; the pin moves to it.
    // HR-A1 appended its foundation activation suite; the pin moves to it.
    const mine = ci.indexOf("hr_a1_foundation_activation_test.sql");
    const others = [...ci.matchAll(/-f supabase\/tests\/(\w+)\.sql/g)]
      .map((m) => ci.indexOf(`${m[1]}.sql`))
      .filter((i) => i !== mine);
    expect(mine).toBeGreaterThan(Math.max(...others));
  });

  it("EVERY suite in supabase/tests is wired into CI — none is written and forgotten", () => {
    // The ordering pin above must be moved by hand each phase, so it cannot
    // catch the failure that actually matters: a suite that exists in the repo
    // and never runs anywhere. This check is self-maintaining and does.
    const ci = read(".github/workflows/ci.yml");
    const dir = join(root, "supabase", "tests");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      expect(ci, `supabase/tests/${f} is not run by CI`).toContain(`-f supabase/tests/${f}`);
    }
  });

  it("surfaces the real SQL error rather than a bare exit code", () => {
    const ci = read(".github/workflows/ci.yml");
    const step = ci.slice(ci.indexOf("Run Aging Balance foundation isolation test"));
    expect(step).toContain("ERROR:");
    expect(step).toContain("::error::");
  });

  it("is non-destructive and uses only valid hex UUID literals", () => {
    const s = read(SUITE);
    expect(s).toContain("begin;");
    expect(s.trimEnd().endsWith("rollback;")).toBe(true);
    const bad = [...s.matchAll(/'([0-9a-zA-Z-]{36})'/g)]
      .map((m) => m[1])
      .filter((u) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u));
    expect(bad).toEqual([]);
  });

  it("proves each invariant the ratification demands", () => {
    const s = read(SUITE);
    for (const check of [
      "q08_native_without_dossier_rejected", "q08_legacy_with_reference_accepted",
      "q08_legacy_without_anything_rejected", "q08_cross_tenant_dossier_rejected",
      "mc_batch_self_approval_rejected", "mc_report_self_validation_rejected",
      "snapshot_rows_frozen_after_validate", "snapshot_rows_frozen_on_final",
      "supersede_requires_successor", "superseded_rows_preserved",
      "final_report_delete_rejected", "two_live_finals_rejected",
      "pinned_template_immutable", "artifact_hash_immutable",
      "share_on_draft_rejected", "share_on_final_accepted",
      "staging_rejected_row_carries_no_invoice", "staging_cross_tenant_dossier_rejected",
      "rls_tenant_a_sees_b", "rls_no_permission_sees_nothing",
      "sysadmin_cannot_validate", "sysadmin_cannot_finalize",
      "sysadmin_cannot_approve_import", "sysadmin_cannot_share",
    ]) {
      expect(s, check).toContain(check);
    }
  });

  it("build-info pins the newest migration on disk", () => {
    // Read from the directory rather than restating a filename every phase must
    // come back and edit — the invariant is the PIN, not which file is newest.
    const migs = readdirSync(join(root, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    expect(LATEST_MIGRATION).toBe(migs[migs.length - 1].replace(/\.sql$/, ""));
  });
});

// ===========================================================================
describe("the phase stays DARK", () => {
  it("no WRITE surface exists for any of these tables", () => {
    // FIN-AGING-3 added a READ-ONLY route, so "no route" is no longer the claim.
    // What this phase's schema still owns: nothing anywhere writes an aging
    // report, a snapshot, an artifact, a share link or an import batch.
    let importRoute = true;
    try { read("app/finance/aging/import/page.tsx"); } catch { importRoute = false; }
    expect(importRoute).toBe(false);

    for (const p of [
      "app/finance/aging/page.tsx",
      "lib/finance/aging/server/read-service.ts",
      "lib/finance/actions.ts",
      "lib/finance/service.ts",
    ]) {
      const s = code(p);
      for (const t of ["aging_report", "aging_report_row", "aging_report_artifact",
                       "aging_report_share", "legacy_import_batch"]) {
        expect(s, `${p} touches ${t}`).not.toContain(t);
      }
    }
  });

  it("the read route is gated by permission AND an env kill switch", () => {
    const page = code("app/finance/aging/page.tsx");
    expect(page).toContain("agingWorkspaceEnabled()");
    expect(page).toContain('hasPermission(permissions, "finance:aging:read")');
  });

  it("the migration is NOT applied by this phase — the operator sequence is 68,69,70,71 first", () => {
    // Documented in the migration header so the sequence cannot be lost.
    expect(read(MIGRATION)).toContain("DARK");
  });
});
