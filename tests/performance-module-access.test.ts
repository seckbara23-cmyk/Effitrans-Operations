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
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
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

describe("Gestion de la Performance — reading performance confers no authority", () => {
  const OPERATIONAL = [
    "hr:manage",
    "customs:update",
    "customs:validate",
    "customs:correct",
    "customs:revalidate",
  ] as const;

  it("the CEO — the archetypal performance reader — gained no operational permission", () => {
    const ceo = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CEO")!;
    expect(ceo.permissions).toContain("performance:read");
    for (const p of OPERATIONAL) {
      expect(ceo.permissions, `CEO must not hold ${p}`).not.toContain(p);
    }
  });

  it("…and the migration asserts that for itself", () => {
    expect(strip(m)).toContain("Gestion de la Performance must confer none");
  });

  it("the module's own capabilities are not implied by any operational one", () => {
    // The converse direction: holding customs or HR authority is not a way in.
    for (const key of ["CUSTOMS_DECLARANT", "CHIEF_OF_TRANSIT", "HR_OFFICER"]) {
      const role = TENANT_ROLE_TEMPLATES.find((t) => t.key === key);
      if (!role) continue;
      expect(role.permissions, `${key} must not read performance by virtue of its job`).not.toContain(
        "performance:read",
      );
    }
  });

  it("performance:read is held by the management audience only", () => {
    expect(holders("performance:read")).toEqual(["CEO", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
  });

  it("performance:manage is narrower still", () => {
    expect(holders("performance:manage")).toEqual(["CEO", "SYSTEM_ADMIN"]);
  });

  it("templates, migration and seed agree on both — three sources, one answer", () => {
    for (const [perm, roles] of [
      ["performance:read", ["CEO", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]],
      ["performance:manage", ["CEO", "SYSTEM_ADMIN"]],
    ] as const) {
      for (const src of [m, seed]) {
        const block = src.slice(src.indexOf(`p.code = '${perm}'`));
        const where = block.slice(0, block.indexOf("on conflict"));
        for (const r of roles) expect(where, `${perm} → ${r}`).toContain(`'${r}'`);
      }
      expect(holders(perm)).toEqual([...roles].sort());
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
