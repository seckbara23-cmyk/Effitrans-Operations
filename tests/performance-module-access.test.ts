/**
 * Gestion de la Performance — access, separation, and what the module must not
 * confer.
 * ---------------------------------------------------------------------------
 * The module reads indicators computed from customs data, the HR calendar and
 * approved leave. Every one of those is governed by somebody else, and the
 * whole risk of a management module is that it quietly becomes a second door
 * into all three. These assertions exist to keep that door shut.
 *
 * Behavioural refusals against a real database — cross-tenant reads, RLS on the
 * calendar, the correction RPCs — live in the SQL suites. What lives here is the
 * authority model and the route boundary, which are source facts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TENANT_ROLE_TEMPLATES, selectTenantRoleTemplates } from "@/lib/platform/role-templates";
import { BASE_SECTIONS } from "@/lib/nav";
import { PERFORMANCE_TABS } from "@/lib/performance/tabs";
import { reliabilityStatus } from "@/lib/performance/reliability";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const holders = (permission: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key).sort();

const MIGRATION = "supabase/migrations/20260921000001_performance_management_access.sql";
const m = read(MIGRATION);
const seed = read("supabase/seed.sql");

// ==================================================== the module name ====

describe("Gestion de la Performance — the module is named, and ICTD/ICAM/IPAM are not modules", () => {
  it("the navigation entry carries the official name", () => {
    const management = BASE_SECTIONS.find((s) => s.key === "management")!;
    const item = management.items.find((i) => i.key === "performance");
    expect(item, "the Management section must offer the module").toBeTruthy();
    expect(item!.label).toBe("Gestion de la Performance");
    expect(item!.href).toBe("/performance");
  });

  it("it is not called ICTD / ICAM / IPAM, nor « Performance & Pilotage »", () => {
    const management = BASE_SECTIONS.find((s) => s.key === "management")!;
    for (const item of management.items) {
      expect(item.label).not.toMatch(/ICTD|ICAM|IPAM/);
      expect(item.label).not.toMatch(/Performance & Pilotage/);
    }
  });

  it("no role is named after an indicator", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.key, t.key).not.toMatch(/ICTD|ICAM|IPAM/);
    }
  });

  it("the indicators are tabs INSIDE the module", () => {
    const keys = PERFORMANCE_TABS.map((t) => t.key);
    expect(keys).toContain("ictd");
    expect(keys).toContain("icam");
    expect(keys).toContain("ipam");
    for (const tab of PERFORMANCE_TABS) expect(tab.href.startsWith("/performance")).toBe(true);
  });
});

// ========================================================= the gate ====

describe("Gestion de la Performance — the route is the boundary, not the sidebar", () => {
  const layout = strip(read("app/performance/layout.tsx"));

  it("the segment layout re-checks performance:read and refuses", () => {
    expect(layout).toContain('hasPermission(permissions, "performance:read")');
    expect(layout).toContain("notFound()");
  });

  it("the nav entry is gated too — but it is the cosmetic half", () => {
    const management = BASE_SECTIONS.find((s) => s.key === "management")!;
    const item = management.items.find((i) => i.key === "performance")!;
    expect(item.permission).toBe("performance:read");
  });

  it("every page in the module sits under that layout", () => {
    // A page outside app/performance/ would bypass the gate entirely.
    for (const tab of PERFORMANCE_TABS) {
      expect(tab.href, tab.key).toMatch(/^\/performance(\/|$)/);
    }
  });

  it("the capability is real: catalogued in the migration AND the seed", () => {
    expect(strip(m)).toContain("'performance:read'");
    expect(strip(m)).toContain("'performance:manage'");
    expect(strip(seed)).toContain("'performance:read'");
    expect(strip(seed)).toContain("'performance:manage'");
  });
});

// ============================================ what access does NOT give ====

describe("Gestion de la Performance — an ASSIGNABLE role, not a job role", () => {
  // RATIFIED 2026-08-28. Access comes from an explicit assignment through the
  // existing « Ajouter un rôle… → Attribuer » screen. Before this, three job
  // roles carried performance:read by template: an Operations Supervisor read
  // per-person indicators because of their job, and a CEO could not be
  // un-granted without editing a template. Both are assignment questions now.
  const ROLE = "PERFORMANCE_MANAGEMENT";
  const template = TENANT_ROLE_TEMPLATES.find((t) => t.key === ROLE);

  it("the role exists, with the ratified French name", () => {
    expect(template, "PERFORMANCE_MANAGEMENT template missing").toBeDefined();
    expect(template!.labelFr).toBe("Gestion de la Performance");
  });

  it("it is assignable through the ordinary role architecture — no second system", () => {
    // listAssignableRoles offers every tenant role row except CLIENT_USER, so a
    // role that exists is a role the System Administrator can attribute. The
    // only thing this needed was the row.
    const service = strip(read("lib/users/service.ts"));
    expect(service).toContain("NON_ASSIGNABLE_STAFF_ROLE_CODES");
    expect(service).toContain("listAssignableRoles");
    expect(
      read("lib/users/service.ts"),
      "the access role must not be excluded from the picker",
    ).not.toContain(ROLE);
    // …and assignment/removal are the EXISTING actions, not new ones.
    const actions = strip(read("lib/users/actions.ts"));
    expect(actions).toContain("export async function assignRole");
    expect(actions).toContain("user_role");
  });

  it("it is provisioned for every tenant, so it can be assigned from day one", () => {
    // Not via requiredForEveryTenant — that flag is SYSTEM_ADMIN's, and an
    // invariant says so. A template with no businessProfile is selected for
    // every tenant anyway.
    expect(template!.requiredForEveryTenant).toBe(false);
    expect(template!.businessProfile).toBeUndefined();
    expect(selectTenantRoleTemplates({}).map((t) => t.key)).toContain(ROLE);
  });

  it("it can be held ALONGSIDE a job role — it replaces nothing", () => {
    // The platform has always supported several roles per user. This asserts the
    // access role does not overlap a job role's permissions, so holding both is
    // purely additive.
    for (const job of ["CEO", "HR_OFFICER", "CUSTOMS_DECLARANT", "OPS_SUPERVISOR"]) {
      const j = TENANT_ROLE_TEMPLATES.find((t) => t.key === job)!;
      const overlap = j.permissions.filter((p) => p.startsWith("performance:"));
      expect(overlap, `${job} must carry no performance authority of its own`).toEqual([]);
    }
  });
});

describe("Gestion de la Performance — no operational role is a way in", () => {
  it("performance:read is held by the access role and NOTHING else", () => {
    expect(holders("performance:read")).toEqual(["PERFORMANCE_MANAGEMENT"]);
  });

  it("performance:manage likewise", () => {
    expect(holders("performance:manage")).toEqual(["PERFORMANCE_MANAGEMENT"]);
  });

  it("OPS_SUPERVISOR no longer receives access automatically", () => {
    const ops = TENANT_ROLE_TEMPLATES.find((t) => t.key === "OPS_SUPERVISOR")!;
    expect(ops.permissions).not.toContain("performance:read");
    expect(ops.permissions).not.toContain("performance:manage");
  });

  it("neither does the CEO — entitlement is an assignment, not a job title", () => {
    const ceo = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CEO")!;
    expect(ceo.permissions).not.toContain("performance:read");
  });

  it("nor SYSTEM_ADMIN — DEC-B61 doctrine, not an exception invented here", () => {
    // DEC-B61 already withholds hr:* from SYSTEM_ADMIN because the data is
    // personal. Per-person performance indicators, computed partly FROM that
    // leave data, are the same kind of fact, and administering the platform is
    // not a reason to read what a named colleague produced last month.
    // Assignment runs on admin:roles:manage, which SYSTEM_ADMIN keeps.
    const sa = TENANT_ROLE_TEMPLATES.find((t) => t.key === "SYSTEM_ADMIN")!;
    expect(sa.permissions).not.toContain("performance:read");
    expect(sa.permissions).not.toContain("performance:manage");
    expect(sa.permissions, "…and it can still ASSIGN the role").toContain("admin:roles:manage");
  });

  it("and the migration asserts the whole rule for itself", () => {
    expect(strip(m)).toContain("access must come from an explicit role assignment");
  });

  it("no operational role acquired performance access by any route", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      if (t.key === "PERFORMANCE_MANAGEMENT") continue;
      const perf = t.permissions.filter((p) => p.startsWith("performance:"));
      expect(perf, `${t.key} must hold no performance capability`).toEqual([]);
    }
  });
});

describe("Gestion de la Performance — the capability diff, exactly", () => {
  // What does assigning this role introduce? This is the whole answer, and it is
  // an EQUALITY rather than a list of "does not contain" checks: a permission
  // slipped into the template later fails here even if nobody thought to forbid
  // it by name. The named exclusions below are the ones worth stating anyway,
  // because each is a boundary another phase spent effort establishing.
  const template = TENANT_ROLE_TEMPLATES.find((t) => t.key === "PERFORMANCE_MANAGEMENT")!;

  it("introduces exactly four permissions — two module, two profile baseline", () => {
    expect([...template.permissions].sort()).toEqual([
      "performance:manage",
      "performance:read",
      "profile:read:self",
      "profile:update:self",
    ]);
  });

  it("grants no HR authority — D3 keeps the calendar with HR", () => {
    for (const p of ["hr:read", "hr:manage", "hr:leave:approve", "hr:reports:read"]) {
      expect(template.permissions, p).not.toContain(p);
    }
  });

  it("grants no Customs authority — D4 keeps capture and certification where they are", () => {
    for (const p of [
      "customs:read", "customs:create", "customs:update", "customs:validate",
      "customs:correct", "customs:revalidate", "customs:release", "customs:register",
    ]) {
      expect(template.permissions, p).not.toContain(p);
    }
  });

  it("grants no Finance, Collections or Transport execution", () => {
    for (const p of [
      "finance:read", "finance:validate", "finance:issue", "finance:payment",
      "collections:manage", "transport:manage", "courier:deposit", "admin_service:manage",
    ]) {
      expect(template.permissions, p).not.toContain(p);
    }
  });

  it("grants no process execution, handoff or closure", () => {
    for (const p of [
      "process:read", "process:close", "process:handoff:send", "process:handoff:receive",
      "process:completeness:review", "process:delivery:followup", "file:transition", "file:update",
    ]) {
      expect(template.permissions, p).not.toContain(p);
    }
  });

  it("grants no other Management or Administration capability", () => {
    for (const p of [
      "analytics:read", "executive:dashboard:read", "admin:users:manage",
      "admin:roles:manage", "communication:manage",
    ]) {
      expect(template.permissions, p).not.toContain(p);
    }
  });

  it("templates, migration and seed agree — three sources, one answer", () => {
    for (const src of [m, seed]) {
      const stripped = strip(src);
      expect(stripped, "the role is created").toContain("PERFORMANCE_MANAGEMENT");
      // Anchored on the ROLE, not on the first permission join in the file:
      // both sources grant many roles, and slicing from the first join read
      // somebody else's grant list.
      const at = stripped.indexOf("r.code = 'PERFORMANCE_MANAGEMENT'");
      expect(at, "the role receives a grant block").toBeGreaterThan(-1);
      const grants = stripped.slice(stripped.lastIndexOf("join public.permission p", at), at);
      for (const p of [
        "profile:read:self", "profile:update:self", "performance:read", "performance:manage",
      ]) {
        expect(grants, p).toContain(`'${p}'`);
      }
    }
  });
});

// ================================================== the calendar door ====

describe("Calendrier de travail — visible to management, writable only by HR", () => {
  const page = strip(read("app/performance/calendrier/page.tsx"));
  const editor = strip(read("components/performance/calendar-editor.tsx"));
  const actions = strip(read("lib/hr/calendar-actions.ts"));

  it("the page decides EDITABILITY on hr:manage, not on performance access", () => {
    expect(page).toContain('hasPermission(permissions, "hr:manage")');
    expect(page).not.toContain('canManage = hasPermission(permissions, "performance:manage")');
  });

  it("both mutations assert hr:manage server-side — the UI flag is cosmetic", () => {
    const body = (name: string) => {
      const i = actions.indexOf(`export async function ${name}`);
      expect(i, name).toBeGreaterThan(-1);
      const j = actions.indexOf("export async function", i + 1);
      return actions.slice(i, j === -1 ? actions.length : j);
    };
    expect(body("addCalendarDay")).toContain('assertPermission("hr:manage")');
    expect(body("removeCalendarDay")).toContain('assertPermission("hr:manage")');
    // …and the READ is its own, weaker gate — hr:read, not hr:manage.
    expect(body("listCalendarDays")).toContain('assertPermission("hr:read")');
  });

  it("the editor holds no authority of its own", () => {
    // It may only call the actions; it must not consult permissions itself.
    expect(editor).not.toContain("hasPermission");
    expect(editor).not.toContain("getEffectivePermissions");
  });

  it("the table still has no write policy — the actions ARE the boundary", () => {
    const calendarMigration = strip(read("supabase/migrations/20260919000001_hr_working_day_calendar.sql"));
    expect(calendarMigration).toContain("for select to authenticated");
    expect(calendarMigration).toContain("must have NO write policy");
  });
});

// ============================================== the D4 capture surface ====

describe("D4 capture UI — the governed path, and only it", () => {
  const fields = strip(read("components/customs/governed-fields.tsx"));

  it("all five elements are capturable", () => {
    for (const f of [
      "shPositionCount",
      "declarationType",
      "dpiRegime",
      "exemptionTitleOrigin",
      "tariffClassificationOrigin",
    ]) {
      expect(fields, f).toContain(f);
    }
  });

  it("the type list comes from the canonical vocabulary — DPE is not selectable", () => {
    expect(fields).toContain("DECLARATION_TYPES.map");
    // No hand-typed option list that could drift, and no DPE anywhere.
    expect(fields).not.toContain('"DPE"');
    expect(fields).not.toContain(">DPE<");
  });

  it("capture reuses updateCustoms; correction reuses correctCustoms — no second mutation path", () => {
    expect(fields).toContain("updateCustoms(record.id");
    expect(fields).toContain("correctCustoms(record.id");
    expect(fields).toContain("revalidateCustoms(record.id");
    // Nothing writes to the database from the component.
    expect(fields).not.toContain("getAdminSupabaseClient");
    expect(fields).not.toContain(".from(");
  });

  it("the UI cannot dictate the authoritative BEFORE state", () => {
    // It sends new values and a motif. The RPC reads the old ones itself.
    expect(fields).not.toMatch(/old(Values|Value)|previous|before:/);
    const customsMigration = strip(read("supabase/migrations/20260920000001_customs_governed_data.sql"));
    expect(customsMigration).toContain("for update");
  });

  it("a motif is required before the correction button is usable", () => {
    expect(fields).toContain('disabled={pending || reason.trim() === ""}');
  });

  it("certified data is rendered read-only, and the panel says why", () => {
    expect(fields).toContain("const certified = record.reviewedAt !== null;");
    expect(fields).toContain("À revalider");
    expect(fields).toContain("Corriger une information validée");
  });

  it("the panel receives the two capabilities from the server, and holds none itself", () => {
    const panel = strip(read("components/customs/customs-panel.tsx"));
    expect(panel).toContain("canCorrect");
    expect(panel).toContain("canRevalidate");
    expect(panel).not.toContain("hasPermission");
    const filePage = strip(read("app/files/[id]/page.tsx"));
    expect(filePage).toContain('canCorrect={hasPermission(permissions, "customs:correct")}');
    expect(filePage).toContain('canRevalidate={hasPermission(permissions, "customs:revalidate")}');
  });
});

// ===================================== the retired mechanism stays dead ====

describe("D2 — the retired coverage classification cannot reappear in the UI", () => {
  const pages = [
    "app/performance/page.tsx",
    "app/performance/collaborateurs/page.tsx",
    "app/performance/ictd/page.tsx",
    "app/performance/parametres/page.tsx",
  ].map((p) => read(p));

  it("« Non classé » is rendered nowhere", () => {
    for (const src of pages) {
      const rendered = strip(src);
      expect(rendered).not.toContain("Non classé");
      expect(rendered).not.toContain("NON_CLASSE");
    }
  });

  it("no page computes or displays a coverage figure", () => {
    // The DATA pages must not mention coverage at all — there is nothing to
    // mention. Paramètres is the deliberate exception and is asserted below:
    // it names the retired threshold in order to explain that it is retired,
    // which is the opposite of reviving it.
    for (const src of pages.slice(0, 3)) {
      const rendered = strip(src);
      expect(rendered).not.toMatch(/couverture|coverage/i);
    }
    for (const src of pages) {
      const rendered = strip(src);
      // No computation, in any page: coverage has no producer to render.
      expect(rendered).not.toMatch(/coveragePct|couvertureRate|évalués\s*\/|\/ éligibles/);
    }
  });

  it("Paramètres names the retired threshold only to say it is retired", () => {
    const params = strip(read("app/performance/parametres/page.tsx"));
    const i = params.search(/couverture/i);
    expect(i, "the explanation exists").toBeGreaterThan(-1);
    expect(params.slice(i, i + 400)).toMatch(/retiré/);
    // And it is prose, not a value: no threshold is offered as a parameter row.
    expect(params).not.toContain('label="Couverture minimum"');
  });

  it("the status the UI renders comes from the engine, whose inputs cannot express coverage", () => {
    const collab = strip(read("app/performance/collaborateurs/page.tsx"));
    expect(collab).toContain("ReliabilityStatus");
    expect(reliabilityStatus.length, "volume + incident only").toBe(1);
    // And the four values the UI maps are exhaustively the engine's.
    for (const s of ["AUCUNE_DONNEE", "PROVISOIRE", "REVUE_MANAGERIALE", "CLASSE"]) {
      expect(collab, s).toContain(s);
    }
  });

  it("the volume marker survives and is explained to the reader", () => {
    const collab = read("app/performance/collaborateurs/page.tsx");
    expect(collab).toContain("MIN_DOSSIERS");
    expect(collab).toContain("Provisoire");
  });
});

// ================================================ honesty about gaps ====

describe("ICAM / IPAM — an unavailable indicator is stated, never fabricated", () => {
  it("neither page computes a score", () => {
    for (const p of ["app/performance/icam/page.tsx", "app/performance/ipam/page.tsx"]) {
      const src = strip(read(p));
      expect(src).toContain("IndicatorUnavailable");
      expect(src).not.toMatch(/toFixed|Math\.round|reduce\(/);
    }
  });

  it("the tabs declare themselves unpopulated", () => {
    for (const key of ["icam", "ipam"]) {
      expect(PERFORMANCE_TABS.find((t) => t.key === key)!.populated, key).toBe(false);
    }
  });

  it("the read service publishes no ICAM/IPAM figure at all", () => {
    const svc = strip(read("lib/performance/read.ts"));
    expect(svc).not.toMatch(/function\s+(icam|ipam)/i);
    expect(svc).toContain("INDICATOR_READINESS");
  });
});

// ============================================ parameters stay pinned ====

describe("Paramètres — read-only until version pinning exists", () => {
  const page = strip(read("app/performance/parametres/page.tsx"));

  it("nothing on the page mutates a parameter", () => {
    expect(page).not.toContain("<form");
    expect(page).not.toMatch(/onSubmit|useTransition|action=/);
  });

  it("it is a server component — no client mutation could be added by accident", () => {
    expect(read("app/performance/parametres/page.tsx")).not.toContain('"use client"');
  });

  it("and performance:manage does not unlock editing", () => {
    // The manage capability changes the SENTENCE, not the affordance.
    expect(page).toContain("canManage");
    expect(page).toContain("performance:manage");
  });
});

// ============================================ the build-only trap, closed ====

describe('every "use server" module in the repository exports only async functions', () => {
  // Phase 11.0C found this once and it recurred here: a "use server" file may
  // export ONLY async functions, and a constant array is an object export. It
  // passes tsc and dies at `next build` page-data collection, so the local
  // suite says green and CI says nothing until ten minutes later.
  //
  // The existing guards each list their own files by hand, which is exactly why
  // a NEW server module was not covered. This one walks the tree, so the class
  // is closed rather than the instance.
  const roots = ["lib", "app", "components"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  };
  for (const r of roots) walk(fileURLToPath(new URL(`../${r}`, import.meta.url)));

  const serverModules = files.filter((f) => {
    const head = readFileSync(f, "utf8").slice(0, 200);
    return /^\s*["']use server["']/.test(head);
  });

  it("finds the server modules to check", () => {
    expect(serverModules.length, "no \"use server\" module found — the walk is broken").toBeGreaterThan(5);
  });

  it("none of them exports a non-async function", () => {
    for (const f of serverModules) {
      const src = readFileSync(f, "utf8");
      for (const m of src.match(/^export (?!type )(?:async )?function/gm) ?? []) {
        expect(m, f).toContain("async");
      }
    }
  });

  it("none of them exports a const, class, or object", () => {
    for (const f of serverModules) {
      const src = readFileSync(f, "utf8");
      const bad = src.match(/^export (?:const|let|var|class|enum) \w+/gm) ?? [];
      expect(bad, `${f} exports a value from a "use server" module`).toEqual([]);
    }
  });
});
