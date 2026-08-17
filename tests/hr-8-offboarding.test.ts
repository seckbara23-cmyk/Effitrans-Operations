/**
 * EFFITRANS-HR-8A — offboarding dark foundation.
 * ---------------------------------------------------------------------------
 * The governing spec is docs/hr/hr-8-offboarding-audit.md (verdict GO) and
 * the HR-0F freeze. This suite pins the boundaries structurally:
 *
 *   * OFFBOARDING ≠ TERMINATION (I-8.12): the employee lifecycle is untouched;
 *   * the completion gate is DATABASE-SIDE (I-8.2): TERMINATED + zero open
 *     custody + blocking items resolved, inside hr_complete_offboarding —
 *     proven live in supabase/tests/hr_8_offboarding_test.sql;
 *   * the account step is a PROMPT, never a call (I-8.3): no HR surface or
 *     role touches admin:users:*;
 *   * NO new permission is catalogued (audit §9): hr:manage operates HR-8;
 *   * the template engine is SHARED, discriminated by kind (I-8.10);
 *   * HR-8A is DARK: no route, no tile — HR-8B activates « Départs ».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260902000001_hr_offboarding_foundation.sql";
const MIG_EVIDENCE = "supabase/migrations/20260903000001_hr_offboarding_evidence_provenance.sql";
const SUITE = "supabase/tests/hr_8_offboarding_test.sql";
const RPCS = ["hr_open_offboarding_case", "hr_complete_offboarding_item", "hr_complete_offboarding"];

/**
 * The body of one migration RPC — pins must bind to THE function, not the
 * file. The boundary is the next function OR the revoke block that follows
 * the last one: a `-- ===` marker would be gone after comment-stripping, and
 * an over-long slice would reach assertion 6c, whose text shares the pinned
 * predicates (the HR-7 shared-string lesson — M1 survived exactly this way).
 */
function fnSlice(name: string): string {
  const m = sql(MIG);
  const start = m.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} present`).toBeGreaterThan(-1);
  const rest = m.slice(start + 10);
  const next = rest.search(/create or replace function|revoke execute on function/);
  expect(next, `${name} slice bounded`).toBeGreaterThan(-1);
  return m.slice(start, start + 10 + next);
}

// ===========================================================================
describe("I-8.2 — the completion gate is database-side, in the RPC", () => {
  it("hr_complete_offboarding tests TERMINATED, open custody, and blocking items", () => {
    const s = fnSlice("hr_complete_offboarding");
    // M2 killer: the employment must actually have ended.
    expect(s).toMatch(/is distinct from 'TERMINATED'/);
    expect(s).toContain("HR813");
    // M1 killer: the equipment gate reads the LIVE custody rows.
    expect(s).toMatch(/from public\.hr_equipment_assignment a[\s\S]{0,200}?\.returned_on is null/);
    expect(s).toContain("HR814");
    // Blocking items must be resolved (DONE or NOT_APPLICABLE).
    expect(s).toMatch(/is_blocking and status = 'PENDING'/);
    expect(s).toContain("HR815");
    // And the migration ASSERTS the gate at apply time (drift-refusing).
    expect(read(MIG)).toMatch(/assertion 6c failed: completion gate weakened/);
  });

  it("completion never writes employee, custody, or account rows (I-8.1/I-8.3)", () => {
    const s = fnSlice("hr_complete_offboarding");
    expect(s).not.toMatch(/update public\.(employee|hr_equipment_assignment|app_user)\b/);
    // The advisory is an EVENT about the account, never an act on it.
    expect(s).toContain("offboarding_completed_account_active");
  });
});

describe("INV-7 — every HR-8 RPC checks actor integrity and authority", () => {
  it("HR630 + assert_actor_authority('hr:manage') in each of the three RPCs", () => {
    for (const fn of RPCS) {
      const s = fnSlice(fn);
      expect(s, fn).toContain("errcode = 'HR630'");
      expect(s, fn).toMatch(/assert_actor_authority\(p_actor, p_tenant, 'hr:manage', 'SERVICE'\)/);
    }
    expect(read(MIG)).toMatch(/assertion 6e failed/); // the apply-time census
  });

  it("the RPCs are service_role transport only", () => {
    const m = sql(MIG);
    for (const fn of RPCS) {
      expect(m).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public`));
      expect(m).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    }
  });
});

describe("I-8.3 — the account step stays a handoff between two seats", () => {
  it("no role template holds both hr:manage and any admin:users:*", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      if (t.permissions.includes("hr:manage")) {
        const leaked = t.permissions.filter((p) => p.startsWith("admin:users:"));
        expect(leaked, `template ${JSON.stringify(t).slice(0, 60)}`).toEqual([]);
      }
    }
    // And the migration + SQL suite re-assert it against LIVE grants.
    expect(read(MIG)).toMatch(/assertion 6d failed/);
    expect(read(SUITE)).toMatch(/hold both hr:manage and admin:users/);
  });

  it("no HR lib file calls any admin:users authority or account write", () => {
    for (const f of ["lib/hr/offboarding.ts", "lib/hr/offboarding-actions.ts"]) {
      const s = code(f);
      expect(s, f).not.toMatch(/admin:users/);
      expect(s, f).not.toMatch(/from\("app_user"\)\s*\.(update|insert|delete|upsert)/);
    }
  });
});

describe("audit §9 — no new authority; hr:manage operates HR-8", () => {
  it("migration 111 catalogues ZERO permissions and asserts so", () => {
    const m = sql(MIG);
    expect(m).not.toMatch(/insert into public\.permission/);
    expect(m).not.toMatch(/insert into public\.role_permission/);
    expect(read(MIG)).toMatch(/assertion 6f failed/);
  });

  it("actions gate on hr:manage only — no four-eyes invented (RQ-8.5)", () => {
    const a = code("lib/hr/offboarding-actions.ts");
    expect(a.split('assertPermission("hr:manage")').length - 1).toBe(4);
    expect(a).not.toMatch(/assertPermission\("(?!hr:manage)/);
  });
});

describe("I-8.10 — one shared template engine, discriminated by kind", () => {
  it("the kind column is constrained to the audited vocabulary, census first", () => {
    const m = sql(MIG);
    expect(m).toMatch(/add column if not exists kind text not null default 'ONBOARDING'/);
    expect(m).toMatch(/check \(kind in \('ONBOARDING','OFFBOARDING'\)\)/);
    // The MAYA-P0.8-A rule: a data census precedes the constraint.
    expect(m.indexOf("refusing to constrain")).toBeLessThan(m.indexOf("hr_checklist_template_kind_check\n  check"));
  });

  it("every template-consuming read filters its own kind", () => {
    // The census found exactly two list sites; each must claim its kind.
    expect(code("lib/hr/onboarding.ts")).toMatch(/hr_checklist_template[\s\S]{0,200}\.eq\("kind", "ONBOARDING"\)/);
    expect(code("lib/hr/offboarding.ts")).toMatch(/hr_checklist_template[\s\S]{0,200}\.eq\("kind", "OFFBOARDING"\)/);
  });

  it("the open RPC accepts only an OFFBOARDING-kind template", () => {
    expect(fnSlice("hr_open_offboarding_case")).toMatch(/kind = 'OFFBOARDING'/);
  });
});

describe("case governance — the audited lifecycle, structurally", () => {
  it("statuses, one live case per employee, governed cancellation, terminal COMPLETED", () => {
    const m = sql(MIG);
    expect(m).toMatch(/check \(status in \('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'\)\)/);
    // M5 killer: the live-slot index is PARTIAL over the open statuses.
    expect(m).toMatch(/create unique index if not exists uq_offboarding_live_case\s+on public\.hr_offboarding_case \(employee_id\)\s+where status in \('OPEN','IN_PROGRESS'\)/);
    // M4 killer: the PREDICATES are pinned, not the constraint names — a
    // weakened check (true) must not survive.
    expect(m).toMatch(/offboarding_cancelled_has_reason\s+check \(status <> 'CANCELLED' or \(cancellation_reason is not null and btrim\(cancellation_reason\) <> ''\)\)/);
    expect(m).toMatch(/offboarding_completed_has_date\s+check \(status <> 'COMPLETED' or completed_at is not null\)/);
    expect(m).toMatch(/offboarding_item_done_has_actor\s+check \(status <> 'DONE' or \(completed_by is not null and completed_at is not null\)\)/);
  });

  it("cases open only for ACTIVE/SUSPENDED employees (RQ-8.6 untouched)", () => {
    expect(fnSlice("hr_open_offboarding_case")).toMatch(/not in \('ACTIVE','SUSPENDED'\)/);
  });

  it("the cancel action compensates a failed ledger emission (WES-9A)", () => {
    const a = code("lib/hr/offboarding-actions.ts");
    const start = a.indexOf("export async function cancelOffboardingCase");
    const s = a.slice(start, a.indexOf("export async function", start + 10));
    // M6 killer: the compensating revert lives INSIDE the cancel function.
    expect(s).toMatch(/status: c\.status, cancelled_at: null, cancellation_reason: null/);
    expect(s).toContain("offboarding_case_cancelled");
  });
});

describe("I-8.12 — the termination lifecycle is NOT modified", () => {
  it("transitionEmployee still gates on documents and still only prompts revocation", () => {
    const a = code("lib/hr/actions.ts");
    expect(a).toContain("missingTerminationDocuments(ctx.tenantId, id)");
    expect(a).toMatch(/promptRevocation = toStatus === "TERMINATED"/);
    // And nothing in HR-8 imports or wraps the transition.
    expect(code("lib/hr/offboarding-actions.ts")).not.toMatch(/transitionEmployee/);
  });

  it("lifecycle.ts is byte-identical in intent: TERMINATED requires a reason, ARCHIVED is terminal", () => {
    const l = code("lib/hr/lifecycle.ts");
    expect(l).toMatch(/TERMINATED: \["ARCHIVED"\]/);
    expect(l).toMatch(/ARCHIVED: \[\]/);
    expect(l).toMatch(/to === "TERMINATED"/);
  });
});

describe("registry, types, ledger — the platform knows the new tables", () => {
  it("both tables are tenant-scoped and typed with Relationships", () => {
    const reg = code("lib/db/tenant-tables.ts");
    expect(reg).toContain('"hr_offboarding_case"');
    expect(reg).toContain('"hr_offboarding_item"');
    const t = read("lib/db/types.ts");
    for (const tbl of ["hr_offboarding_case", "hr_offboarding_item"]) {
      const start = t.indexOf(`${tbl}: {`);
      expect(start, tbl).toBeGreaterThan(-1);
      expect(t.slice(start, start + 2500), tbl).toContain("Relationships: [];");
    }
  });

  it("the five offboarding ledger kinds exist with French labels", () => {
    const l = read("lib/hr/ledger.ts");
    for (const k of [
      "offboarding_case_opened", "offboarding_item_completed", "offboarding_case_completed",
      "offboarding_case_cancelled", "offboarding_completed_account_active",
    ]) {
      expect((l.match(new RegExp(`\\b${k}\\b`, "g")) ?? []).length, k).toBeGreaterThanOrEqual(2);
    }
  });

  it("RLS: select on hr:read, and NO write policy — actions are the boundary", () => {
    const m = sql(MIG);
    expect(m).toMatch(/hr_offboarding_case_select[\s\S]{0,200}has_permission\('hr:read'\)/);
    expect(m).toMatch(/hr_offboarding_item_select[\s\S]{0,200}has_permission\('hr:read'\)/);
    expect(m).not.toMatch(/create policy \w+_(insert|update|delete)/);
    expect(m).toMatch(/grant select on public\.hr_offboarding_case, public\.hr_offboarding_item to authenticated/);
  });
});

// ===========================================================================
// HR-8B — the workspace. Everything below is about what a person SEES.
// ===========================================================================
const PAGE = "app/departments/hr/departs/page.tsx";
const STUDIO = "components/hr/offboarding-studio.tsx";
const HUB = "app/departments/hr/page.tsx";

describe("HR-8B — the workspace exists and the tile is activated", () => {
  it("the route is gated on hr:read and composes the HR-8A reads", () => {
    const p = code(PAGE);
    expect(p).toMatch(/hasPermission\(permissions, "hr:read"\)/);
    expect(p).toMatch(/notFound\(\)/);
    expect(p).toMatch(/hasPermission\(permissions, "hr:manage"\)/);
    for (const fn of ["listOffboardingCases", "listOffboardingItems", "listOffboardingTemplates", "offboardingGates"]) {
      expect(p, fn).toContain(fn);
    }
  });

  it("the hub tile is live and the « à venir » note is gone", () => {
    const h = read(HUB);
    expect(h).toMatch(/WorkspaceTile href="\/departments\/hr\/departs" title="Départs"/);
    expect(h).not.toMatch(/SoonTile[^/]*title="Offboarding"/);
    expect(h).not.toContain("À venir — HR-8");
    // Exactly one entry point for the capability (the HR-5A rule).
    expect([...h.matchAll(/WorkspaceTile href="\/departments\/hr\/departs"/g)].length).toBe(1);
  });

  it("counters are composed from existing facts, not a new analytics layer", () => {
    const h = read(HUB);
    expect(h).toContain("Départs en cours");
    expect(h).toContain("Matériel à restituer (départs)");
    expect(h).toContain("Étapes de clôture à terminer");
    // The reader lives in the HR-8 domain module and counts rows — nothing else.
    const c = code("lib/hr/offboarding.ts");
    expect(c).toContain("export async function offboardingCounts");
    expect(c).not.toMatch(/materialized|_kpi|analytics/i);
  });
});

describe("HR-8B — plain French, no engineering vocabulary on screen", () => {
  it("no SQLSTATE, permission code, or table name reaches the UI", () => {
    // Comment-stripped: a comment explaining which SQLSTATE is translated is
    // documentation; a SQLSTATE in a rendered string is a leak.
    for (const f of [PAGE, STUDIO]) {
      expect(code(f), f).not.toMatch(/HR8\d\d|HR630|EFA\d\d/);
    }
    // A permission code may be CHECKED (that is authorization); it may never be
    // DISPLAYED. Comments and the gate calls themselves are removed, and what
    // remains must be free of engineering vocabulary — so a code rendered into
    // any label, message or attribute fails this test.
    // Type positions (Tbl["hr_offboarding_case"]["Row"]) and the gate calls are
    // removed first: they are authorization and typing, never rendered text.
    const rendered = (f: string) =>
      code(f)
        .replace(/hasPermission\(permissions, "[^"]+"\)/g, "")
        .replace(/Tbl\["[^"]+"\]\["[^"]+"\]/g, "");
    for (const f of [PAGE, STUDIO]) {
      expect(rendered(f), f).not.toMatch(/hr:manage|hr:read|hr:config|admin:users/);
      expect(rendered(f), f).not.toMatch(/hr_offboarding_|assert_actor_authority|SQLSTATE/);
    }
  });

  it("the governed refusals are translated into business sentences", () => {
    const s = read(STUDIO);
    expect(s).toContain("L'employé doit d'abord être marqué comme ayant quitté l'entreprise");
    expect(s).toContain("Du matériel est encore attribué à cet employé");
    expect(s).toContain("Certaines étapes obligatoires ne sont pas terminées");
    // Each maps from the action-layer code, not from a raw database string.
    for (const k of ["employee_not_terminated", "equipment_outstanding", "blocking_items_pending"]) {
      expect(s, k).toMatch(new RegExp(`${k}:\\s*"`));
    }
  });
});

describe("HR-8B — the boundaries hold on screen", () => {
  it("the workspace never terminates anyone", () => {
    for (const f of [PAGE, STUDIO]) {
      expect(code(f), f).not.toMatch(/transitionEmployee|"TERMINATED"/);
    }
    // And it says so, in French, where the case is opened.
    expect(read(STUDIO)).toContain("ne met pas fin au contrat");
  });

  it("equipment return is delegated, never reimplemented", () => {
    const s = code(STUDIO);
    expect(s).toContain('href="/departments/hr/equipement"');
    expect(s).not.toMatch(/returnEquipment|hr_return_equipment|returned_on/);
  });

  it("the account step is a link to Administration, never an action", () => {
    const s = code(STUDIO);
    expect(s).toContain('href="/users"');
    expect(s).not.toMatch(/archiveUser|setUserStatus|banUser|admin:users/);
    // The prompt only appears when the completion RPC says the account is live.
    expect(s).toContain("promptAccountHandoff");
    expect(read(STUDIO)).toContain("PAS été désactivé");
  });

  it("no four-eyes was introduced in the workspace (RQ-8.5 still open)", () => {
    expect(code(STUDIO)).not.toMatch(/quatre yeux|four.eyes|approver|second acteur/i);
  });

  it("HR-8C D-3 — eligibility is NOT weakened: only ACTIVE/SUSPENDED, never already-departing", () => {
    // The picker mirrors the RPC rule (HR803) exactly. Widening it — to include
    // TERMINATED people, or to stop excluding those with a live case — must
    // fail here. An empty picker is a legitimate state, not a bug to code around.
    const p = code(PAGE);
    expect(p).toMatch(/\["ACTIVE", "SUSPENDED"\]\.includes\(e\.status\)/);
    expect(p).toMatch(/!eligibleIds\.has\(e\.id\)/);
    expect(p).toMatch(/\["OPEN", "IN_PROGRESS"\]\.includes\(c\.status\)/);
    expect(p).not.toMatch(/"TERMINATED"|"DRAFT"|"ARCHIVED"/);
    // The database still refuses anything else regardless of the screen.
    expect(fnSlice("hr_open_offboarding_case")).toMatch(/not in \('ACTIVE','SUSPENDED'\)/);
  });

  it("HR-8C D-3 — an empty picker explains itself, with the right reason", () => {
    const s = code(STUDIO);
    // Two distinct causes, two distinct sentences, driven by the registry size.
    expect(s).toMatch(/eligible\.length === 0 &&/);
    expect(s).toMatch(/registrySize === 0 \?/);
    const t = read(STUDIO);
    expect(t).toContain("Un compte de connexion n&apos;est pas");
    expect(t).toContain("soit déjà en cours de départ, soit déjà sorties des effectifs");
    expect(t).toContain('href="/departments/hr/registre"');
    // The page supplies the fact rather than the component guessing it.
    expect(code(PAGE)).toMatch(/registrySize=\{directory\.length\}/);
  });

  it("HR-8D D-4 — an evidence-required step is completed by CITING a document", () => {
    // Supersedes D-1: the affordance was withheld because no picker existed.
    // The model always carried evidence_document_id, so the picker is what was
    // missing — a blocking step that can only ever be « Sans objet » cannot be
    // truthfully closed.
    const s = code(STUDIO);
    // The picker offers this employee's documents, for evidence-required steps.
    expect(s).toMatch(/i\.evidence_required && \(\s*<select[\s\S]{0,800}gates\?\.documents/);
    // « Fait » appears when no evidence is required, OR once one is chosen.
    expect(s).toMatch(/\(!i\.evidence_required \|\| evidenceFor\[i\.id\]\)/);
    expect(s).toMatch(/evidenceDocumentId: i\.evidence_required \? evidenceFor\[i\.id\] : null/);
    expect(s).toMatch(/status: "NOT_APPLICABLE"/);
  });

  it("HR-8D D-4 — evidence rules are the DATABASE's: presence AND provenance", () => {
    const m = sql(MIG_EVIDENCE);
    // Bound the slice at the revoke block: the self-assertions below it QUOTE
    // these very predicates, and an unbounded slice would let a gutted function
    // pass on its own assertion's text (the HR-8A M1 lesson, twice learned).
    const start = m.indexOf("create or replace function public.hr_complete_offboarding_item");
    const end = m.indexOf("revoke execute on function");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = m.slice(start, end);
    // Presence (unchanged) and provenance (new): same employee, same tenant, live.
    expect(fn).toContain("HR809");
    expect(fn).toMatch(/d\.employee_id = v_employee/);
    expect(fn).toMatch(/d\.tenant_id = p_tenant/);
    expect(fn).toMatch(/d\.deleted_at is null/);
    expect(fn).toContain("HR816");
    // Applied-time refusal if any of it is ever weakened away.
    expect(read(MIG_EVIDENCE)).toMatch(/assertion 1 failed: the evidence provenance rule is absent or weakened/);
    // The closure gate is NOT touched by this migration — asserted at apply time.
    expect(read(MIG_EVIDENCE)).toMatch(/assertion 2 failed: the closure gate changed/);
    expect(m).not.toMatch(/create or replace function public\.hr_complete_offboarding\(/);
    // The refusal reaches the user in French, never as a code.
    expect(code("lib/hr/offboarding-actions.ts")).toMatch(/HR816: "evidence_not_eligible"/);
    expect(read(STUDIO)).toContain("n'appartient pas au dossier de cet employé");
  });

  it("the SQL suite proves the evidence rules live", () => {
    const s = read(SUITE);
    expect(s).toMatch(/expected HR809 missing evidence/);
    expect(s).toMatch(/expected HR816 foreign evidence/);
    expect(s).toMatch(/expected HR816 deleted evidence/);
    expect(s).toMatch(/a qualifying document must complete the step and be recorded/);
  });
});

describe("CI wiring — the suite runs, and runs LAST", () => {
  it("ci.yml runs hr_8_offboarding_test.sql (ordering pinned in fin-aging-schema)", () => {
    expect(read(".github/workflows/ci.yml")).toContain("supabase/tests/hr_8_offboarding_test.sql");
  });

  it("the SQL suite clears jwt claims before RPC calls (EFA08) and rolls back", () => {
    const s = read(SUITE);
    expect(s).toContain("set_config('request.jwt.claims', '', true)");
    expect(s.trimEnd().endsWith("rollback;")).toBe(true);
    // Suite actors hold REAL grants (or refusal tests pass for the wrong reason).
    expect(s).toMatch(/where p\.code = 'hr:manage'/);
  });
});
