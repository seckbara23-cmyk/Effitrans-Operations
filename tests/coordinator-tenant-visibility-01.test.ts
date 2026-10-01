/**
 * COORDINATOR-TENANT-VISIBILITY-01 — the control tower SEES the whole tenant.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG, proven against production on 2026-10-01:
 *
 *     user_readable_file_ids(coordonateur.demo, tenant A)  ->  0 rows
 *     operational_file where tenant_id = tenant A          -> 14 rows
 *
 * The account was correct: active, in the right tenant, holding COORDINATOR with
 * 47 permissions. The authorization layer was not. Every ground in
 * `user_readable_file_ids` except `file:read:all` asks "is this dossier attached
 * to you PERSONALLY?" — account manager, coordinator_id, creator, process owner,
 * assignee of a task or step, a name in the assignment ledger, the receiving role
 * of an open handoff, or the holder of a role owning an OPEN and UNASSIGNED step.
 * A Coordinator who has not already worked a dossier matches none of them, so the
 * seat whose entire purpose is oversight could open nothing.
 *
 * THE RATIFIED PLATFORM CONTRACT (2026-10-01), and it is not a tenant-A
 * exception: in EVERY tenant, existing and future, an active user holding the
 * canonical COORDINATOR role READS every dossier of that same tenant —
 * regardless of creator, Account Manager, current assignee, custody, department,
 * workflow step or historical involvement — never a dossier of another tenant,
 * and lifecycle state does not remove the read authority.
 *
 * SEE ≠ ACT. Tenant-wide visibility confers no workflow authority. That is the
 * half most of this file is about, because it is the half a visibility fix can
 * silently get wrong.
 *
 * WHY NO NEW MECHANISM. `file:read:all` IS the ratified tenant-wide ground — the
 * first branch of `user_readable_file_ids`, already held by nine roles. So the
 * fix is a GRANT, in the three authoritative sources, and the visibility function
 * is not edited at all. A COORDINATOR special case would be a second
 * implementation of a rule that already exists, and `create or replace` on that
 * function is how migration 121 silently deleted four grounds.
 *
 * WHAT THE DATABASE PROVES, AND WHAT THIS FILE PROVES. Visibility itself is RLS,
 * so it is proven against a REAL database in
 * `supabase/tests/rls_visibility_test.sql` (both tenants, both directions,
 * including closed and cancelled dossiers) and in
 * `supabase/tests/rls_responsibility_visibility_test.sql` (the narrowing a role
 * WITHOUT tenant-wide read still obeys). This file proves the parts that live in
 * TypeScript: that the grant is in every provisioning source, that the admin
 * readers which bypass RLS re-apply the tenant bound, that no ACT path moved, and
 * that the dossier-count surfaces now agree with each other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { resolveDossierAccess, mayCompleteWork, type DossierAccessInput } from "@/lib/workflow/access/resolver";
import { isTenantScopedTable } from "@/lib/db/tenant-tables";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20261009000001_coordinator_tenant_read.sql";
const VERIFIER = "supabase/verifiers/20261009000001_coordinator_tenant_read.verify.sql";
const SEED = "supabase/seed.sql";
const TEMPLATES = "lib/platform/role-templates.ts";
const VISIBILITY = "lib/authz/visibility.ts";
const RESOLVER = "lib/workflow/access/resolver.ts";
const FN = "supabase/migrations/20260914000001_responsibility_visibility.sql";
const POLICY = "supabase/migrations/20260614000005_scope_visibility.sql";
const RLS_VIS = "supabase/tests/rls_visibility_test.sql";
const RLS_RESP = "supabase/tests/rls_responsibility_visibility_test.sql";

const perms = (key: string) =>
  TENANT_ROLE_TEMPLATES.find((t) => t.key === key)?.permissions ?? [];

/** The body of `user_readable_file_ids` ALONE -- not the rest of its migration. */
const fnBody = () => {
  const fn = read(FN);
  const from = fn.indexOf("create or replace function public.user_readable_file_ids");
  const to = fn.indexOf("grant execute on function public.user_readable_file_ids");
  expect(from, "the function must still be defined in this migration").toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return fn.slice(from, to);
};

/**
 * The production baseline, measured read-only on 2026-10-01 before the grant.
 * Kept as named constants because the test names refer to them.
 */
const PROD = {
  coordinatorRoles: 1,
  dossiers: 14,
  terminalDossiers: 4, // CLOSED + CANCELLED
  readableBefore: 0,
  readableAfter: 14, // what every existing file:read:all holder already resolves to
  holdersBefore: 9,
} as const;

// ============================================================ 1. the grant ====
//
// REGRESSION 1 — COORDINATOR receives file:read:all, from every authoritative
// source, so it survives tenant and user reprovisioning.

describe("1 — COORDINATOR receives file:read:all", () => {
  it("the provisioning template grants it", () => {
    expect(perms("COORDINATOR")).toContain("file:read:all");
  });

  it("…and the baseline file:read it needs to matter", () => {
    // `operational_file_select` is `has_permission('file:read') AND
    // can_read_file(id)`. Tenant-wide scope without the baseline read is inert.
    expect(perms("COORDINATOR")).toContain("file:read");
  });

  it("the seed grants it to a freshly-seeded tenant", () => {
    const seed = sqlCode(SEED);
    expect(seed).toMatch(
      /join public\.permission p on p\.code = 'file:read:all'[\s\S]{0,200}and r\.code = 'COORDINATOR'/,
    );
  });

  it("the migration reaches tenants that are ALREADY provisioned", () => {
    // provision_tenant materializes role_permission once, for a tenant that does
    // not yet exist, and seed.sql only runs on a fresh stack. Neither touches a
    // live tenant, so without this migration production would keep the old set.
    const sql = sqlCode(MIGRATION);
    expect(sql).toMatch(/insert into public\.role_permission[\s\S]{0,200}'file:read:all'/);
    expect(sql).toContain("where r.code = 'COORDINATOR'");
    expect(sql).toContain("on conflict do nothing");
  });

  it("…for EVERY tenant, because the grant is keyed on the role and not on a tenant", () => {
    // THE MULTI-TENANT REQUIREMENT. A tenant filter here would fix tenant A and
    // leave every other tenant's Coordinator blind — and make the three sources
    // disagree the moment a second tenant exists. Same shape as 20260728000003
    // (file:transition) and 20260916000001 (document:read).
    const grant = sqlCode(MIGRATION);
    const stmt = grant.slice(grant.indexOf("insert into public.role_permission"));
    expect(stmt.slice(0, stmt.indexOf(";"))).not.toMatch(/tenant_id/);
    expect(stmt).not.toMatch(/00000000-0000-0000-0000-000000000001/);
  });

  it("nothing is patched per-user: the EXECUTABLE sql names no account at all", () => {
    // Asserted on the SQL with comments stripped. The prose deliberately names
    // the account the defect was reported on -- that is documentation, not a
    // patch. What must be absent is any STATEMENT that touches a user.
    for (const p of [MIGRATION, VERIFIER]) {
      const s = sqlCode(p);
      expect(s, p).not.toContain("coordonateur");
      expect(s, p).not.toContain("@effitrans");
      expect(s, p).not.toContain("42ad068e-8525-4fee-ab44-05686dcdd52a");
      expect(s, p).not.toMatch(/insert into public\.user_role/i);
      expect(s, p).not.toMatch(/\bapp_user\b/);
    }
  });

  it("the migration ships a verifier that asserts the grant, not just its own success", () => {
    const v = sqlCode(VERIFIER);
    // THE PREDICATE, NOT THE LABEL. A label survives having its check replaced by
    // `select true`, and a vacuous verifier is worse than none — it reports a
    // migration as verified while proving nothing.
    expect(v).toMatch(
      /from public\.role r\s*\n\s*where r\.code = 'COORDINATOR'\s*\n\s*and not exists \([\s\S]{0,260}p\.code = 'file:read:all'/,
    );
    // and the ground the grant depends on, asserted on the live function
    expect(v).toContain("pg_get_functiondef(p.oid)");
    expect(v).toMatch(/src like '%file:read:all%' from fn/);
    expect(v).toMatch(/src not like '%COORDINATOR%' from fn/);
    expect(v).toMatch(/src like '%f\.tenant_id = p_tenant%' from fn/);
    expect(v).toMatch(/\bok\b/);
    expect(v).toMatch(/\bdetail\b/);
    // a verifier must stay read-only and must never consult the ledger
    expect(v).not.toMatch(/\bdo\s+\$\$/i);
    expect(v).not.toMatch(/supabase_migrations/i);
  });

  it("the ledger is bumped, so the ops console does not under-report the build", () => {
    const build = read("lib/platform/ops/build-info.ts");
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(build).toContain(`LATEST_MIGRATION = "${files.at(-1)!.replace(/\.sql$/, "")}"`);
    expect(build).toContain(`MIGRATION_COUNT = ${files.length}`);
  });
});

// ================================================ 2. tenant-wide, by ground ====
//
// REGRESSION 2 — the Coordinator sees all same-tenant dossiers regardless of
// creator, Account Manager, assignee, custody, department or current step.

describe("2 — the reach is tenant-wide and unconditional", () => {
  it("the permission short-circuits the application scope resolver", () => {
    const src = code(VISIBILITY);
    expect(src).toContain("if (perms.includes(allPermission)) return { all: true };");
    // …before any relationship query is issued, so no ground has to be satisfied.
    const gate = src.indexOf("return { all: true }");
    const rpc = src.indexOf('rpc("user_readable_file_ids"');
    expect(gate).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(gate);
  });

  it("and it is the FIRST ground of the database rule, ahead of every relationship", () => {
    const body = fnBody();
    const all = body.indexOf("'file:read:all'");
    for (const relationship of [
      "f.account_manager_id = p_user",
      "f.coordinator_id = p_user",
      "f.created_by = p_user",
      "pi.owner_user_id = p_user",
      "t.assigned_to = p_user",
      "e.assigned_user_id = p_user",
      "assignment_event ae",
      "process_step_receiving_role",
      "process_step_owning_role",
    ]) {
      expect(body.indexOf(relationship), relationship).toBeGreaterThan(all);
    }
  });

  it("NO special COORDINATOR branch was added — the permission is the mechanism", () => {
    // Explicitly ratified: do not special-case the role if the governed
    // permission already provides the semantics. A second implementation is how
    // the two sources start disagreeing about WHY a dossier is visible.
    // Bounded to the FUNCTION BODY. The same migration seeds
    // process_step_owning_role, whose rows legitimately name COORDINATOR, so
    // slicing to end-of-file would have made this assertion about those instead.
    // The verifier checks the same property on pg_get_functiondef, which returns
    // the definition alone.
    expect(fnBody()).not.toContain("COORDINATOR");
    // and no migration in this slice touches the function or any policy
    const sql = sqlCode(MIGRATION);
    expect(sql).not.toMatch(/create or replace function|create policy|drop policy|alter table|create table/i);
  });

  it("custody, department and step state are nowhere in the read path", () => {
    const src = code(VISIBILITY);
    for (const notThere of ["custody", "handoff", "department", "step", "assign"]) {
      expect(src.toLowerCase(), notThere).not.toContain(notThere);
    }
  });

  it("the real-database proof covers an unrelated dossier, not just the coordinated one", () => {
    const sql = read(RLS_VIS);
    expect(sql).toContain("coord_fileY_unrelated");
    expect(sql).toContain("u2_fy<>1");
  });
});

// ==================================================== 3. lifecycle states ======
//
// REGRESSION 3 — active, closed and cancelled dossiers remain readable through
// the surfaces that normally expose those lifecycle states.

describe("3 — lifecycle state is not a visibility rule", () => {
  it("the dossier SELECT policy has no status predicate", () => {
    const pol = sqlCode(POLICY);
    const stmt = pol.slice(pol.indexOf("create policy operational_file_select"));
    const using = stmt.slice(0, stmt.indexOf(";"));
    expect(using).toContain("auth_tenant_id()");
    expect(using).toContain("can_read_file(id)");
    expect(using).not.toMatch(/status/i);
  });

  it("…and neither does the tenant-wide read ground", () => {
    const body = fnBody();
    expect(body).not.toMatch(/f\.status/);
    expect(body).not.toContain("'CLOSED'");
    expect(body).not.toContain("'CANCELLED'");
  });

  it("the dossier list applies no lifecycle filter of its own", () => {
    const list = code("lib/files/service.ts");
    const fn = list.slice(list.indexOf("export async function listFiles"), list.indexOf("export async function getFile"));
    expect(fn).not.toMatch(/\.eq\("status"|\.neq\("status"|\.in\("status"/);
  });

  it("and the list surface genuinely offers those states to filter on", () => {
    // If the UI could not express CLOSED/CANCELLED, "remains readable" would be
    // unobservable however permissive the policy is.
    const filters = read("components/files/files-filters.tsx");
    expect(filters).toContain('"CLOSED"');
    expect(filters).toContain('"CANCELLED"');
  });

  it("the real-database proof includes a CLOSED and a CANCELLED dossier", () => {
    const sql = read(RLS_VIS);
    expect(sql).toContain("'CLOSED'");
    expect(sql).toContain("'CANCELLED'");
    expect(sql).toContain("coord_fileW_closed");
    expect(sql).toContain("coord_fileV_cancelled");
    expect(sql).toContain("u2_fw<>1");
    expect(sql).toContain("u2_fv<>1");
  });
});

// ================================================= 4. the tenant boundary ======
//
// REGRESSION 4 — cross-tenant dossier visibility remains denied, in both
// directions, for every tenant.

describe("4 — visibility widened; the tenant did not", () => {
  it("the read ground is bounded by the tenant it was asked about", () => {
    const body = fnBody();
    expect(body).toContain("where f.tenant_id = p_tenant");
    // The bound sits on the OUTER query, so it applies to every ground including
    // the tenant-wide one — not as a clause inside one branch.
    expect(body.indexOf("where f.tenant_id = p_tenant")).toBeLessThan(body.indexOf("'file:read:all'"));
  });

  it("the policy requires the caller's own tenant INDEPENDENTLY of any ground", () => {
    const pol = sqlCode(POLICY);
    const stmt = pol.slice(pol.indexOf("create policy operational_file_select"));
    expect(stmt.slice(0, stmt.indexOf(";"))).toContain("tenant_id = public.auth_tenant_id()");
  });

  /**
   * THE ONE THAT MATTERS FOR THIS SLICE. `resolveFileScope` returns `{all:true}`
   * with no tenant in it, because the TENANT bound belongs to the query. Every
   * admin-client reader bypasses RLS, so if one of them dropped `.eq("tenant_id")`
   * while relying on the scope to bound the result, a tenant-wide read would
   * become a platform-wide read. Each call site is checked individually.
   */
  it("every admin reader that can receive all:true still filters on its own tenant", () => {
    const files = [
      "lib/files/service.ts",
      "lib/customs/service.ts",
      "lib/customs/intelligence/service.ts",
      "lib/departments/service.ts",
      "lib/docintel/service.ts",
      "lib/transport/service.ts",
      "lib/sla/service.ts",
      "lib/tasks/service.ts",
      "lib/process/queues/service.ts",
      "lib/process/journeys/service.ts",
    ];
    const TENANT_BOUND = /\.eq\("tenant_id",\s*[\w.]*[Tt]enantId\)|scopedFrom\(/;
    const SPLIT = /(?=^(?:export )?(?:async )?(?:function|const) )/m;
    let checked = 0;

    for (const file of files) {
      const src = code(file);
      // Each reader is judged on its OWN body. Anchoring on the first occurrence
      // of resolveFileScope would land on the import statement and prove nothing
      // about any of them -- which is exactly how this test first passed wrongly.
      const chunks = src.split(SPLIT);
      for (const chunk of chunks) {
        if (!/resolveFileScope\(/.test(chunk)) continue;
        const name =
          /(?:export )?(?:async )?(?:function|const) (\w+)/.exec(chunk)?.[1] ?? "(module)";
        checked += 1;
        if (TENANT_BOUND.test(chunk)) continue;

        // ONE legitimate shape does not bind the tenant itself: a private helper
        // that resolves the scope and HANDS THE TENANT BACK, leaving each caller
        // to bind it (lib/customs/intelligence/service.ts#scopeOrNull). That is
        // still safe only if every caller does, so that is what gets asserted —
        // the exemption is for the helper, never for the read.
        expect(chunk, `${file}:${name} neither binds the tenant nor returns it`).toMatch(
          /tenantId[,;:}\s]/,
        );
        const callers = chunks.filter((c) => c !== chunk && new RegExp(`\\b${name}\\(`).test(c));
        expect(callers.length, `${file}:${name} returns a tenant nobody consumes`).toBeGreaterThan(0);
        for (const caller of callers) {
          const who = /(?:export )?(?:async )?(?:function|const) (\w+)/.exec(caller)?.[1] ?? "(module)";
          expect(caller, `${file}:${who} uses ${name} and must bind the tenant`).toMatch(TENANT_BOUND);
        }
      }
    }
    // A refactor that broke the split would silently check nothing, so the number
    // of scope-resolving readers actually examined is asserted too.
    expect(checked, "every scope-resolving reader must have been examined").toBeGreaterThanOrEqual(12);
  });

  /**
   * AND EVERY TENANT-SCOPED READ IN THOSE READERS, not just one of them. The
   * check above is satisfied by a single `.eq("tenant_id", …)` anywhere in the
   * function, so a reader with four queries could lose the bound on the DOSSIER
   * query and still pass. This counts instead: as many tenant bounds as there are
   * reads of a tenant-scoped table.
   *
   * `document_type` is deliberately exempt and is not special-cased here — the
   * exemption comes from `lib/db/tenant-tables.ts`, the registry that decides
   * which tables carry a tenant_id at all, so this cannot drift from the schema.
   */
  it("…and every tenant-scoped table they read is bounded, not merely one of them", () => {
    const files = [
      "lib/files/service.ts", "lib/customs/service.ts", "lib/departments/service.ts",
      "lib/docintel/service.ts", "lib/transport/service.ts", "lib/sla/service.ts",
      "lib/tasks/service.ts", "lib/process/queues/service.ts", "lib/process/journeys/service.ts",
    ];
    const SPLIT = /(?=^(?:export )?(?:async )?(?:function|const) )/m;
    let readers = 0;
    for (const file of files) {
      const src = code(file);
      for (const chunk of src.split(SPLIT)) {
        if (!/resolveFileScope\(/.test(chunk)) continue;
        const name = /(?:export )?(?:async )?(?:function|const) (\w+)/.exec(chunk)?.[1] ?? "(module)";
        const tables = [...chunk.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
        const needed = tables.filter(isTenantScopedTable).length
          + (chunk.match(/scopedFrom\(/g) ?? []).length;
        const bounds = (chunk.match(/\.eq\("tenant_id"/g) ?? []).length
          + (chunk.match(/scopedFrom\(/g) ?? []).length;
        expect(bounds, `${file}:${name} reads ${needed} tenant-scoped table(s) but binds ${bounds}`)
          .toBeGreaterThanOrEqual(needed);
        readers += 1;
      }
    }
    expect(readers).toBeGreaterThanOrEqual(11);
  });

  it("the queue and journey readers bound the tenant through scopedFrom", () => {
    for (const f of ["lib/process/queues/service.ts", "lib/process/journeys/service.ts"]) {
      expect(code(f), f).toContain("scopedFrom(");
    }
  });

  it("both tenants are proven, both directions, against a real database", () => {
    // MULTI-TENANT REQUIREMENT: tenant A's Coordinator sees all of A and none of
    // B; tenant B's Coordinator sees all of B and none of A.
    const sql = read(RLS_VIS);
    expect(sql).toContain("coord_fileB_other_tenant");
    expect(sql).toContain("u2_fz<>0");
    expect(sql).toContain("coordB_sees_own_tenant");
    expect(sql).toContain("coordB_sees_tenant_A");
    // the raising condition itself, not just the reported label: tenant B's
    // Coordinator must read BOTH of its own dossiers and ZERO of tenant A's.
    expect(sql).toContain("u4_b1<>1 or u4_b2<>1 or u4_a_all<>0");
    // and the F-1 suite checks the same boundary from the function's side
    expect(read(RLS_RESP)).toContain("FAIL T1e: tenant-wide Coordinator read crossed into another tenant");
  });
});

// ======================================================== 5. SEE ≠ ACT =========
//
// REGRESSION 5 — the Coordinator gains no step completion, transition,
// assignment, handoff or mutation authority.

describe("5 — no execution authority moved", () => {
  const base: DossierAccessInput = {
    userId: "u-coord",
    permissions: ["file:read", "file:read:all", "process:read", "task:read"],
    roleCodes: ["COORDINATOR"],
    commercialOwnerId: "someone-else",
    operationalOwnerId: "someone-else",
    currentTaskAssigneeId: "someone-else",
    currentStepAssigneeId: "someone-else",
    responsibleDepartment: "finance",
    contributedFromDepartments: [],
    supervisorRoles: [],
  } as unknown as DossierAccessInput;

  it("a tenant-wide reader may NOT act on, complete or intervene in a step", () => {
    const a = resolveDossierAccess(base);
    expect(a.canViewSummary, "it can SEE").toBe(true);
    expect(a.canActOnCurrentStep, "but not act").toBe(false);
    expect(a.canCompleteAssignedTask, "nor complete").toBe(false);
    expect(a.canIntervene, "nor intervene").toBe(false);
  });

  it("…and the completion guard refuses it, with and without a reason", () => {
    const a = resolveDossierAccess(base);
    expect(mayCompleteWork(a, { intervening: false })).toEqual({ ok: false, error: "not_assigned" });
    expect(mayCompleteWork(a, { intervening: true, reason: "parce que" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("the three ACT capabilities are structurally independent of the read grant", () => {
    const src = code(RESOLVER);
    for (const cap of ["canActOnCurrentStep", "canCompleteAssignedTask", "canIntervene"]) {
      const at = src.indexOf(`const ${cap} =`);
      expect(at, cap).toBeGreaterThan(-1);
      const expr = src.slice(at, src.indexOf(";", at));
      expect(expr, `${cap} must not be granted by platform governance`).not.toContain(
        "isPlatformGovernance",
      );
    }
  });

  /**
   * `canReassignWithinDepartment` DOES include isPlatformGovernance, so a
   * Coordinator now satisfies it. It is reported honestly rather than hidden: no
   * mutation in the repository consumes that field, so nothing is authorized by
   * it today. This pins that fact — the day someone wires it to a real
   * reassignment, this test fails and the decision gets made deliberately.
   */
  it("the one capability the grant does widen is consumed by no mutation", () => {
    const src = code(RESOLVER);
    const expr = src.slice(
      src.indexOf("const canReassignWithinDepartment ="),
      src.indexOf(";", src.indexOf("const canReassignWithinDepartment =")),
    );
    expect(expr, "the premise of this test").toContain("isPlatformGovernance");

    const consumers = readdirSync(join(root, "lib"), { recursive: true, encoding: "utf8" })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".ts"))
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !f.includes("access/resolver.ts"))
      .filter((f) => read(`lib/${f}`).includes("canReassignWithinDepartment"));
    // tasks/actions.ts only constructs a DENIED stub with the field literally
    // false; it never reads it as authority.
    expect(consumers.sort()).toEqual(["tasks/actions.ts"]);
    const stub = code("lib/tasks/actions.ts");
    expect(stub).toContain("canReassignWithinDepartment: false");
    expect(stub).not.toMatch(/if\s*\(.*canReassignWithinDepartment/);
    expect(stub).not.toMatch(/access\.canReassignWithinDepartment/);
  });

  it("no authorization path anywhere consults file:read:all to permit a write", () => {
    const dirs = readdirSync(join(root, "lib"), { recursive: true, encoding: "utf8" })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const f of dirs) {
      const src = code(join("lib", f));
      if (!src.includes("file:read:all")) continue;
      // a writer is a module that also performs a mutation
      if (/\.(insert|update|delete|upsert)\(/.test(src)) offenders.push(f);
    }
    // resolver.ts derives capabilities and writes nothing; visibility.ts reads.
    expect(offenders.sort()).toEqual([]);
  });

  it("the Coordinator template gained EXACTLY one permission, and it is a read", () => {
    // The 47 permissions measured on production plus this one. A visibility fix
    // that smuggled a second grant in would pass every test above.
    const p = perms("COORDINATOR");
    expect(new Set(p).size).toBe(p.length);
    for (const forbidden of [
      "file:create", "file:delete", "file:assign",
      "finance:issue", "finance:payment", "finance:void", "finance:create", "finance:update",
      "decision:approve", "team:manage", "admin:config:manage", "admin:users:manage",
      "task:read:all",
    ]) {
      expect(p, forbidden).not.toContain(forbidden);
    }
    // the authorities it legitimately held before are untouched
    for (const kept of ["file:transition", "file:update", "task:update", "process:step:skip"]) {
      expect(p, kept).toContain(kept);
    }
  });

  it("the migration refuses to apply if it ever confers a mutation permission", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("SEE is not ACT");
    expect(sql).toMatch(/raise exception[\s\S]{0,120}mutation permission/);
  });

  it("…and it refuses to apply as a no-op, if the ground it relies on is gone", () => {
    // A grant of a permission nothing consults confers nothing. Without this the
    // migration would succeed, the verifier would be the only thing left to
    // notice, and the Coordinator would be blind with every check green.
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("pg_get_functiondef(p.oid) like '%file:read:all%'");
    expect(sql).toMatch(
      /raise exception 'M147: user_readable_file_ids has no file:read:all ground/,
    );
    // all three self-assertions must RAISE, not merely notice
    expect((sql.match(/raise exception/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

// ============================================ 6. a narrow role stays narrow ====
//
// REGRESSION 6 — a role without file:read:all remains relationship-scoped.

describe("6 — the default is still narrow", () => {
  it("without the permission the resolver falls through to the relationship query", () => {
    const src = code(VISIBILITY);
    expect(src).toContain('rpc("user_readable_file_ids"');
    expect(src).toContain("return { all: false, ids: (data ?? []).map((r) => r.id) };");
  });

  it("exactly the ratified ten roles hold it — the grant did not spread by analogy", () => {
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => t.permissions.includes("file:read:all"))
      .map((t) => t.key)
      .sort();
    expect(holders).toEqual([
      "ACCOUNT_MANAGER", "ADMINISTRATIVE_OFFICER", "BILLING_OFFICER", "CEO",
      "COLLECTIONS_OFFICER", "COMPLIANCE_HSSE", "COORDINATOR", "FINANCE_OFFICER",
      "OPS_SUPERVISOR", "SYSTEM_ADMIN",
    ]);
    expect(holders).toHaveLength(PROD.holdersBefore + 1);
  });

  it("the execution roles that must stay scoped are named, and are not holders", () => {
    for (const narrow of [
      "CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "CUSTOMS_FIELD_AGENT", "CUSTOMS_FINANCE_OFFICER",
      "TRANSPORT_OFFICER", "PICKUP_AGENT", "COURIER", "DOCUMENTATION_OFFICER",
      "WAREHOUSE_COORDINATOR", "QUOTATION_MANAGER", "DRIVER", "CASHIER",
    ]) {
      expect(perms(narrow), narrow).not.toContain("file:read:all");
    }
  });

  it("the real-database suites keep a witness that genuinely has no tenant-wide read", () => {
    // rls_visibility_test proves it with CHIEF_OF_TRANSIT; the F-1 suite's
    // narrowing triad moved to COURIER for exactly this reason — COORDINATOR can
    // no longer witness a rule it is now exempt from.
    const vis = read(RLS_VIS);
    expect(vis).toContain("CHIEF_OF_TRANSIT");
    expect(vis).toContain("u3_fx<>0");
    expect(vis).toContain("u3_fw<>0");
    const resp = read(RLS_RESP);
    // the declaration, so deleting it cannot leave the usages looking intact
    expect(resp).toMatch(/courier_b uuid := '[0-9a-f-]{36}';/);
    expect(resp).toContain("('00000000-0000-0000-0000-00000000d009'::uuid, 'COURIER'");
    expect(resp).toContain("FAIL R4: owning-role visibility survived assignment (narrowing absent)");
    expect(resp).toContain("FAIL R5: responsibility visibility survived step completion");
    expect(resp).toContain("FAIL R6: role membership alone granted access");
  });
});

// ================================================= 7. the reported account ====
//
// REGRESSION 7 — coordonateur.demo@effitrans.sn resolves from 0 readable
// dossiers to the expected tenant-wide scope after deployment/provisioning.

describe("7 — the reported seat resolves to the whole tenant", () => {
  it("the seeded tenant's COORDINATOR role is granted, so its holders inherit", () => {
    // Nothing is granted to the account. The account holds COORDINATOR; the role
    // holds the permission; get_user_permissions joins user_role -> role ->
    // role_permission. That is the whole mechanism, and it is why "do not patch
    // coordonateur.demo individually" is satisfiable at all.
    const seed = sqlCode(SEED);
    const block = seed.slice(seed.lastIndexOf("join public.permission p on p.code = 'file:read:all'"));
    expect(block).toContain("r.code = 'COORDINATOR'");
    expect(block).toContain("'00000000-0000-0000-0000-000000000001'");
  });

  it("the expected post-deployment scope is the tenant's full dossier count", () => {
    // Measured read-only on production: every EXISTING file:read:all holder
    // already resolves to all 14 dossiers of tenant A, four of them terminal.
    // The Coordinator joins that set; it does not get a new kind of answer.
    expect(PROD.readableBefore).toBe(0);
    expect(PROD.readableAfter).toBe(PROD.dossiers);
    expect(PROD.terminalDossiers).toBeGreaterThan(0);
  });

  it("…and that is a role grant, so a NEW Coordinator gets it with no extra step", () => {
    const sql = sqlCode(MIGRATION);
    // keyed on the role, applied to the role row — every current and future
    // holder of that role row is covered the moment they are assigned it.
    expect(sql).toContain("join public.permission p on p.code = 'file:read:all'");
    expect(sql).toContain("from public.role r");
    expect(sql).not.toMatch(/user_role|app_user/);
  });
});

// ======================================== 8. dashboard / KPI scope parity ======
//
// THE CONTRADICTION THIS SLICE ALSO CLOSES. `/dashboard` composes two families
// of reader side by side:
//
//   * per-user dossier-scoped — getFileOverview, listFiles, getRecentFiles,
//     getQueueCounts, getIntelligenceDashboard
//   * permission-gated and TENANT-WIDE — getProcessTower (« Circuit officiel »),
//     getWorkloadByTeam, getControlTower
//
// COORDINATOR holds `process:read`, so the tenant-wide family was already
// counting all fourteen dossiers' steps while the scoped family resolved to
// ZERO. The Coordinator's dashboard reported no dossiers next to a « Circuit
// officiel » full of pending stages — the same dossiers, two scopes. The grant
// puts both families on the tenant, which is the parity requirement.

describe("8 — every dossier-count surface resolves from a compatible scope", () => {
  const files = code("lib/files/service.ts");

  it("KPIs, the listing and recents share ONE scope resolution", () => {
    // Bounded to each function's OWN body. A fixed character window ran past the
    // end of the short readers into the next one, so a reader could switch to a
    // different scope permission and borrow its neighbour's correct call.
    const chunks = files.split(/(?=export async function )/);
    for (const fn of ["listFiles", "getFileOverview", "getRecentFiles"]) {
      const body = chunks.find((c) => c.startsWith(`export async function ${fn}`));
      expect(body, fn).toBeDefined();
      expect(body!, fn).toContain('resolveFileScope(user.id, user.tenantId, "file:read:all")');
      // and it resolves exactly one scope, so there is no second answer in play
      expect((body!.match(/resolveFileScope\(/g) ?? []).length, fn).toBe(1);
    }
  });

  it("…and they agree on what an EMPTY scope means, so none of them invents rows", () => {
    expect(files).toContain("if (!scope.all && scope.ids.length === 0) return [];");
    expect(files).toContain("if (!scope.all && scope.ids.length === 0) return aggregateFiles([], new Date());");
  });

  it("« Circuit officiel » is tenant-wide and gated only on process:read", () => {
    const tower = code("lib/process/queues/control-tower.ts");
    expect(tower).toContain('hasPermission(permissions, "process:read")');
    // It applies NO per-user dossier scope — that is the asymmetry.
    expect(tower).not.toContain("resolveFileScope");
    expect(tower).not.toContain("isFileVisible");
    expect(tower).toContain("scopedFrom(admin,");
  });

  it("so a Coordinator cannot land on zero dossiers beside non-zero stage counts", () => {
    // The invariant, stated on the permission set: anything that puts a role on
    // the tenant-wide Circuit officiel must also put it on the tenant-wide
    // dossier scope, or the two panels contradict each other.
    const p = perms("COORDINATOR");
    expect(p).toContain("process:read");
    expect(p).toContain("file:read:all");
  });

  it("the cockpit still composes both families rather than owning a third", () => {
    const reader = code("lib/operations/reader.ts");
    expect(reader).toContain("getFileOverview()");
    expect(reader).toContain("getProcessTower(user.tenantId, perms)");
    // CONSUME, NEVER OWN — no table read of its own, so there is no third scope.
    expect(reader).not.toMatch(/\.from\("operational_file"\)/);
  });

  it("task-side scoping reaches the same dossiers, without a second grant", () => {
    // COORDINATOR does NOT hold task:read:all, so resolveFileScope(...,
    // "task:read:all") falls through to the RPC — which returns every tenant
    // dossier anyway, because the RPC's own ground is file:read:all. Task reach
    // therefore follows the dossier read; it is not a separate authority.
    const vis = code(VISIBILITY);
    expect(vis).toContain('allPermission: "file:read:all" | "task:read:all"');
    const body = fnBody();
    expect(body).toContain("gp.code = 'file:read:all'");
    expect(body).not.toContain("task:read:all");
    expect(perms("COORDINATOR")).not.toContain("task:read:all");
  });
});
