/** HR-4 — Onboarding, Equipment, icons: structural contracts. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { navSections } from "@/lib/nav";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");
const MIG = "supabase/migrations/20260802000002_hr_onboarding_equipment.sql";
const ACTIONS = "lib/hr/onboarding-actions.ts";

describe("no competing subsystem is created", () => {
  const m = sql(MIG);
  it("creates no vehicle/fleet/inventory/document/identity table", () => {
    for (const t of ["vehicle", "fleet", "inventory"]) {
      expect(m).not.toMatch(new RegExp(`create table if not exists public\\.\\w*${t}`, "i"));
    }
    expect(m).not.toMatch(/create table if not exists public\.hr_document\b/);
    expect(m).not.toMatch(/create table if not exists public\.app_user\b/);
  });
  it("references existing entities instead of redefining them", () => {
    for (const r of ["references public.employee", "references public.hr_document",
                     "references public.app_user", "references public.hr_work_location"]) {
      expect(m).toContain(r);
    }
  });
  it("provisioning tracks identity, never creates it", () => {
    expect(code(ACTIONS)).not.toMatch(/auth\.admin|createUser|generateLink/);
    expect(m).toContain("linked_app_user_id uuid references public.app_user (id)");
  });
});

describe("ADR-HR2-01 hardening — transactional RPCs, no new compensation", () => {
  const m = sql(MIG);
  const RPCS = ["hr_assign_equipment", "hr_return_equipment",
                "hr_complete_onboarding_item", "hr_complete_onboarding"];

  it("the four state-changing operations are RPCs, revoked from public", () => {
    for (const fn of RPCS) {
      expect(m).toContain(`create or replace function public.${fn}`);
      expect(m).toContain(`grant execute on function public.${fn}`);
      expect(m).toContain(`revoke execute on function public.${fn}`);
    }
  });

  it("each RPC writes its ledger event in its own body — one transaction", () => {
    const assign = m.slice(m.indexOf("function public.hr_assign_equipment"),
                           m.indexOf("function public.hr_return_equipment"));
    expect(assign).toContain("insert into public.hr_employee_event");
    const ret = m.slice(m.indexOf("function public.hr_return_equipment"),
                        m.indexOf("function public.hr_complete_onboarding_item"));
    expect(ret).toContain("insert into public.hr_employee_event");
  });

  it("the actions call the RPCs rather than composing the writes client-side", () => {
    const a = code(ACTIONS);
    for (const fn of RPCS) expect(a).toContain(`.rpc("${fn}"`);
    expect(a).not.toMatch(/from\("hr_equipment_assignment"\)\s*\n?\s*\.insert/);
  });
});

describe("custody and lifecycle invariants", () => {
  const m = sql(MIG);

  it("one active custodian per asset is a partial unique index", () => {
    expect(m).toContain("uq_equipment_single_custodian");
    expect(m).toContain("where returned_on is null");
  });

  it("a return records an explicit outcome, incl. damaged / lost / not returned", () => {
    expect(m).toContain("'RETURNED','DAMAGED','LOST','NOT_RETURNED'");
    expect(m).toContain("custody_return_is_complete");
  });

  it("custody history is append-only from the application side", () => {
    const a = code(ACTIONS);
    expect(a).not.toMatch(/from\("hr_equipment_assignment"\)[\s\S]{0,120}\.(update|delete)\(/);
  });

  it("the onboarding lifecycle is a closed vocabulary with governed cancellation", () => {
    expect(m).toContain("check (status in ('DRAFT','READY','IN_PROGRESS','COMPLETED','CANCELLED'))");
    expect(m).toContain("onboarding_cancelled_has_reason");
    expect(m).toContain("uq_onboarding_live_case");
  });

  it("the completion gate lives in the DATABASE and names its blockers", () => {
    const fn = m.slice(m.indexOf("function public.hr_complete_onboarding("));
    expect(fn).toContain("is_required and is_blocking and status = 'PENDING'");
    expect(fn).toContain("bloquants non");
  });

  it("checklists are configuration-driven and item labels are snapshots", () => {
    expect(m).toContain("hr_checklist_template");
    expect(m).toContain("hr_checklist_item_template");
    expect(code(ACTIONS)).toContain("label_fr: it.label_fr");
  });
});

describe("security posture", () => {
  const m = sql(MIG);
  const TABLES = ["hr_checklist_template", "hr_checklist_item_template", "hr_onboarding_case",
                  "hr_onboarding_item", "hr_provisioning_request", "hr_equipment_type",
                  "hr_equipment", "hr_equipment_assignment"];

  it("RLS + an hr:read policy on all eight tables; no portal policy anywhere", () => {
    for (const t of TABLES) {
      expect(m, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(m, t).toContain(`create policy ${t}_select`);
    }
    expect(m).not.toContain("client_user");
  });

  it("no new permission, no grant, no SYSTEM_ADMIN mention (B1 pause intact)", () => {
    expect(m).not.toContain("insert into public.permission");
    expect(m).not.toContain("role_permission");
    expect(m).not.toContain("SYSTEM_ADMIN");
  });

  it("every exported action gates on hr:manage", () => {
    const a = code(ACTIONS);
    const exported = [...a.matchAll(/export async function (\w+)/g)].map((x) => x[1]);
    expect(exported.length).toBeGreaterThan(5);
    expect([...a.matchAll(/assertPermission\("hr:manage"\)/g)].length).toBe(exported.length);
  });
});

describe("navigation & department icons", () => {
  it("each department carries a DISTINCT icon, and HR differs from Administration", () => {
    const departments = navSections.find((s) => s.key === "departments")!;
    const keys = departments.items.map((i) => i.iconKey);
    expect(new Set(keys).size).toBe(keys.length);
    const hr = navSections.find((s) => s.key === "management")!.items.find((i) => i.key === "hr")!;
    const users = navSections.find((s) => s.key === "administration")!.items.find((i) => i.key === "users")!;
    expect(hr.iconKey).not.toBe(users.iconKey);
    expect(keys).not.toContain(hr.iconKey);
  });

  it("Operations wears a gear, Transit the truck, Finance the chart, HR the team", () => {
    const byKey = Object.fromEntries(navSections.flatMap((s) => s.items).map((i) => [i.key, i.iconKey]));
    expect(byKey.operations).toBe("gear");
    expect(byKey.transit).toBe("truck");
    expect(byKey.finance).toBe("finance");
    expect(byKey.hr).toBe("team");
  });

  it("labels and placement are unchanged — DÉPARTEMENTS stays three, HR stays under MANAGEMENT", () => {
    const departments = navSections.find((s) => s.key === "departments")!;
    expect(departments.items.map((i) => i.label)).toEqual(["Opérations", "Transit", "Finance"]);
    expect(navSections.find((s) => s.key === "management")!.items.some((i) => i.key === "hr")).toBe(true);
  });

  it("the icons exist, are wired, and carry no emoji", () => {
    const icons = read("lib/icons.tsx");
    expect(icons).toContain("export function IconGear");
    expect(icons).toContain("export function IconTeam");
    expect(icons).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    const sidebar = read("components/shell/sidebar.tsx");
    expect(sidebar).toContain("gear: IconGear");
    expect(sidebar).toContain("team: IconTeam");
  });
});

// ===========================================================================
// HR-8 carryover — Intégration reaches evidence parity with Départs. ONE
// architecture (the ratified D-4 model), expressed in each family's numbering.
// ===========================================================================
describe("evidence parity with Départs (D-4 model, not a second one)", () => {
  const MIG = "supabase/migrations/20260904000001_hr_onboarding_evidence_provenance.sql";
  const strip = (s: string) => s.replace(/--[^\n]*/g, "");
  const fnSlice = () => {
    const m = strip(read(MIG));
    const start = m.indexOf("create or replace function public.hr_complete_onboarding_item");
    const end = m.indexOf("revoke execute on function");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return m.slice(start, end);
  };

  it("the RPC enforces presence AND provenance", () => {
    const fn = fnSlice();
    expect(fn).toContain("HR408");
    expect(fn).toMatch(/d\.employee_id = v_employee/);
    expect(fn).toMatch(/d\.tenant_id = p_tenant/);
    expect(fn).toMatch(/d\.deleted_at is null/);
    expect(fn).toContain("HR412");
    expect(read(MIG)).toMatch(/assertion 1 failed: the evidence provenance rule is absent or weakened/);
    // Parity itself is asserted at apply time against the offboarding twin.
    expect(read(MIG)).toMatch(/assertion 2 failed: the two checklist families disagree/);
  });

  it("the workspace completes an evidence step by CITING a document", () => {
    const s = read("components/hr/onboarding-studio.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(s).toMatch(/i\.evidence_required && \(\s*<select[\s\S]{0,800}documentsByCase/);
    expect(s).toMatch(/\(!i\.evidence_required \|\| evidenceFor\[i\.id\]\)/);
    expect(s).toMatch(/evidenceDocumentId: i\.evidence_required \? evidenceFor\[i\.id\] : null/);
    // The page supplies only that employee's documents, sensitive tier respected.
    const p = read("app/departments/hr/onboarding/page.tsx");
    expect(p).toMatch(/listEmployeeDocuments\(user\.tenantId, c\.employee_id, canSeeSensitive\)/);
    expect(p).toMatch(/hasPermission\(permissions, "hr:sensitive:read"\)/);
  });

  it("the refusal is one semantic in both families, in French", () => {
    expect(read("lib/hr/onboarding-actions.ts")).toMatch(/HR412: "evidence_not_eligible"/);
    expect(read("lib/hr/offboarding-actions.ts")).toMatch(/HR816: "evidence_not_eligible"/);
    for (const f of ["components/hr/onboarding-studio.tsx", "components/hr/offboarding-studio.tsx"]) {
      expect(read(f), f).toContain("n'appartient pas au dossier de cet employé");
    }
  });

  it("the SQL suite proves it live", () => {
    const s = read("supabase/tests/rls_hr_onboarding_test.sql");
    expect(s).toMatch(/expected HR408/);
    expect(s).toMatch(/expected HR412 foreign evidence/);
    expect(s).toMatch(/expected HR412 deleted evidence/);
    expect(s).toMatch(/a qualifying document must complete the step and be recorded/);
  });
});

describe("CI runs the HR-4 suite last", () => {
  it("appended after HR-3, before Stop", () => {
    const ci = read(".github/workflows/ci.yml");
    const hr3 = ci.indexOf("rls_hr_documents_test.sql");
    const hr4 = ci.indexOf("rls_hr_onboarding_test.sql");
    expect(hr4).toBeGreaterThan(hr3);
    expect(ci.indexOf("Stop local Supabase")).toBeGreaterThan(hr4);
  });
});
