/**
 * EFFITRANS-TMS-1 — the Account-Manager assignment authority.
 * ---------------------------------------------------------------------------
 * Governing spec: docs/tms/tms-1-assignment-contract.md, ratified TMS-Q1 +
 * D1(Option A)/D2/D3. This suite pins the invariant structurally:
 *
 *   dossier créé → PAS de Responsable client automatique → le Responsable des
 *   opérations désigne → remplacement possible tant que le dossier est ouvert,
 *   avec motif et historique immuable.
 *
 * The creator and the Account Manager are separate concepts even when they
 * happen to be the same person. Live behaviour is proven in
 * supabase/tests/tms_1_commercial_owner_test.sql on every CI run.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260906000001_commercial_owner_assignment.sql";
const SUITE = "supabase/tests/tms_1_commercial_owner_test.sql";
const ACTIONS = "lib/files/actions.ts";
const UI = "components/files/commercial-owner.tsx";
const PAGE = "app/files/[id]/page.tsx";

/** The RPC body, bounded at the revoke block — the assertions below it quote
 *  the same predicates (the four-times-learned unbounded-slice lesson). */
function rpcSlice(): string {
  const m = sql(MIG);
  const start = m.indexOf("create or replace function public.assign_commercial_owner");
  const end = m.indexOf("revoke execute on function");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return m.slice(start, end);
}

/** One exported server action's slice. */
function actionSlice(name: string): string {
  const a = code(ACTIONS);
  const start = a.indexOf(`export async function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const end = a.indexOf("export async function", start + 10);
  return a.slice(start, end === -1 ? undefined : end);
}

// ===========================================================================
describe("the defect is closed — creation crowns nobody", () => {
  it("createFile no longer writes account_manager_id", () => {
    const s = actionSlice("createFile");
    expect(s).not.toContain("account_manager_id");
    // The dossier facts and identity are untouched.
    expect(s).toContain("file_number: fileNumber");
    expect(s).toContain("created_by: admin.id");
  });

  it("the ONLY writer of account_manager_id is the governed RPC", () => {
    // The original defect, verbatim, must never return; and no insert/update
    // payload in the action layer carries the column (the audit RECORD of the
    // new action legitimately names it — a record is not a write).
    const a = code(ACTIONS);
    expect(a).not.toContain("account_manager_id: admin.id");
    for (const m of a.matchAll(/\.(insert|update)\(\{[\s\S]{0,400}?\}\)/g)) {
      expect(m[0]).not.toContain("account_manager_id");
    }
    expect(rpcSlice()).toMatch(/set account_manager_id = p_new_user_id/);
  });
});

describe("D1 Option A — one new authority, both lanes intact", () => {
  it("the permission is catalogued and granted to exactly the two ratified seats", () => {
    const m = sql(MIG);
    expect(m).toMatch(/insert into public\.permission[\s\S]{0,300}'file:assign:commercial'/);
    // Pinned to the GRANT statement — the migration's own assertions quote the
    // same role list, so a file-wide match would let a widened grant pass.
    expect(m).toMatch(
      /join public\.permission p on p\.code = 'file:assign:commercial'\s+where r\.code in \('OPS_SUPERVISOR', 'SYSTEM_ADMIN'\)\s+on conflict do nothing;/,
    );
    expect(read(MIG)).toMatch(/assertion 4b failed: file:assign:commercial held by unratified role/);
  });

  it("templates: exactly OPS_SUPERVISOR and SYSTEM_ADMIN hold the commercial authority", () => {
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => t.permissions.includes("file:assign:commercial"))
      .map((t) => t.key).sort();
    expect(holders).toEqual(["OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
  });

  it("the Account Manager KEEPS file:assign — the working-assignee lane is untouched", () => {
    const am = TENANT_ROLE_TEMPLATES.find((t) => t.key === "ACCOUNT_MANAGER")!;
    expect(am.permissions).toContain("file:assign");
    expect(am.permissions).not.toContain("file:assign:commercial");
    // assignFile still exists, still gates on file:assign, still writes the
    // WORKING assignee — a different column, a different concept.
    const s = actionSlice("assignFile");
    expect(s).toMatch(/assertPermission\("file:assign"\)/);
    expect(s).toContain("assigned_to_user_id");
    expect(s).not.toContain("account_manager_id");
  });

  it("the three grant sources agree (migration, seed, templates)", () => {
    const seed = read("supabase/seed.sql");
    expect(seed).toContain("('file:assign:commercial', 'files', 'assign_commercial'");
    expect(seed).toMatch(/p\.code = 'file:assign:commercial'[\s\S]{0,200}r\.code in \('OPS_SUPERVISOR', 'SYSTEM_ADMIN'\)/);
  });
});

describe("the RPC — every ratified rule, in the database", () => {
  it("INV-7: actor integrity + the commercial authority asserted in the body", () => {
    const s = rpcSlice();
    expect(s).toContain("errcode = 'HR630'");
    expect(s).toMatch(/assert_actor_authority\(p_actor, v_tenant, 'file:assign:commercial', 'SERVICE'\)/);
  });

  it("owner never vacated; unchanged refused; active same-tenant target required", () => {
    const s = rpcSlice();
    expect(s).toMatch(/if p_new_user_id is null then[\s\S]{0,160}TM102/);
    expect(s).toMatch(/is not distinct from p_new_user_id[\s\S]{0,160}TM103/);
    expect(s).toMatch(/TM104/);
  });

  it("terminal dossiers refuse (ratified: while operationally open)", () => {
    expect(rpcSlice()).toMatch(/v_status in \('CLOSED', 'CANCELLED'\)[\s\S]{0,220}TM105/);
  });

  it("a replacement demands a non-blank reason, and INITIAL cannot motivate one", () => {
    const s = rpcSlice();
    expect(s).toMatch(/v_previous is not null and p_reason_code = 'INITIAL'/);
    expect(s).toMatch(/v_previous is not null and nullif\(btrim\(coalesce\(p_reason, ''\)\), ''\) is null/);
    expect(s).toContain("un remplacement exige un motif détaillé");
  });

  it("the immutable history row and the business event ride the SAME transaction", () => {
    const s = rpcSlice();
    expect(s).toMatch(/insert into public\.assignment_event[\s\S]{0,300}'COMMERCIAL_OWNER'/);
    expect(s).toMatch(/emit_business_event[\s\S]{0,200}COMMERCIAL_OWNER_ASSIGNED/);
    expect(s).toContain("COMMERCIAL_OWNER_REASSIGNED");
    // service_role transport only.
    const m = sql(MIG);
    expect(m).toMatch(/revoke execute on function public\.assign_commercial_owner[\s\S]{0,120}from public/);
    expect(m).toMatch(/grant execute on function public\.assign_commercial_owner[\s\S]{0,120}to service_role/);
  });

  it("both event types are registered in the workflow event registry", () => {
    const reg = read("lib/workflow/events/types.ts");
    expect(reg).toContain('type: "COMMERCIAL_OWNER_ASSIGNED"');
    expect(reg).toContain('type: "COMMERCIAL_OWNER_REASSIGNED"');
  });
});

describe("D3 — honest history for the pre-TMS-1 dossiers", () => {
  it("the backfill is LEGACY_IMPORT, actor-less, and idempotent", () => {
    const m = sql(MIG);
    const start = m.indexOf("insert into public.assignment_event");
    const backfill = m.slice(m.indexOf("'LEGACY_IMPORT'", start) - 2000, m.indexOf("'LEGACY_IMPORT'", start) + 200);
    expect(backfill).toMatch(/null, f\.account_manager_id, null/); // no fabricated actor
    expect(backfill).toContain("'INITIAL', 'LEGACY_IMPORT'");
    expect(m).toMatch(/not exists \(\s*select 1 from public\.assignment_event e\s+where e\.subject_type = 'COMMERCIAL_OWNER' and e\.subject_id = f\.id\)/);
    // And the apply-time honesty assertion.
    expect(read(MIG)).toMatch(/assertion 4d failed: % LEGACY_IMPORT row\(s\) fabricate an actor/);
  });

  it("no historical rewrite: only the RPC updates operational_file, never the backfill", () => {
    const m = sql(MIG);
    const updates = [...m.matchAll(/update public\.operational_file/gi)];
    expect(updates).toHaveLength(1); // the governed write inside the RPC
    const rpcStart = m.indexOf("create or replace function public.assign_commercial_owner");
    const rpcEnd = m.indexOf("revoke execute on function");
    expect(updates[0].index).toBeGreaterThan(rpcStart);
    expect(updates[0].index).toBeLessThan(rpcEnd);
  });
});

describe("the action and the screen", () => {
  it("assignCommercialOwner gates on the commercial authority and maps codes to French-safe errors", () => {
    const s = actionSlice("assignCommercialOwner");
    expect(s).toMatch(/assertPermission\("file:assign:commercial"\)/);
    expect(s).toMatch(/rpc\("assign_commercial_owner"/);
    expect(s).toMatch(/FILE_COMMERCIAL_OWNER_ASSIGNED/);
    expect(s).toMatch(/createNotification/);
  });

  it("the Responsable client block renders beside — not instead of — the working assignee", () => {
    const p = code(PAGE);
    expect(p).toMatch(/<CommercialOwner[\s\S]{0,400}canAssign=\{canAssignCommercial\}/);
    expect(p).toMatch(/<FileAssignment[\s\S]{0,300}canAssign=\{canAssign\}/);
    expect(p).toMatch(/hasPermission\(permissions, "file:assign:commercial"\)/);
  });

  it("the invariant is stated on screen, and « À affecter » is a visible state", () => {
    const u = read(UI);
    expect(u).toContain("n&apos;est pas automatiquement Responsable client");
    expect(u).toContain("À affecter");
    expect(u).toContain("Motif détaillé du remplacement (obligatoire)");
    // Reason vocabulary is the WES-3A one, reused not redefined.
    expect(u).toContain('from "@/lib/workflow/access/vocabulary"');
    // No SQLSTATE or permission code reaches the screen.
    const rendered = code(UI);
    expect(rendered).not.toMatch(/TM10\d|HR630|EFA\d\d/);
    expect(rendered).not.toMatch(/file:assign/);
  });

  it("the dashboard owner column shows « À affecter » rather than silence", () => {
    expect(read("components/dashboard/dashboard-recent-files.tsx")).toContain("À affecter");
  });
});

describe("CI wiring and suite discipline", () => {
  it("the SQL suite is wired (ordering pinned in fin-aging-schema) and disciplined", () => {
    expect(read(".github/workflows/ci.yml")).toContain("supabase/tests/tms_1_commercial_owner_test.sql");
    const s = read(SUITE);
    expect(s).toContain("set_config('request.jwt.claims', '', true)");
    expect(s.trimEnd().endsWith("rollback;")).toBe(true);
    // The refusal tests fail for the right reason: the fixture holds the REAL
    // grant, and a file:assign holder is proven refused (Option A separation).
    expect(s).toMatch(/where p\.code = 'file:assign:commercial'/);
    expect(s).toMatch(/expected EFA15 for the file:assign holder/);
  });
});
