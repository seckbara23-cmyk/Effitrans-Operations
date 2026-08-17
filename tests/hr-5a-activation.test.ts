/**
 * HR-5A — workspace activation. Pins that activation exposed capability
 * WITHOUT weakening a single gate, and that the two deferred items stayed
 * deferred rather than being half-built.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { navSections } from "@/lib/nav";
import { EXECUTIVE_SECTIONS, KPI_SOURCES } from "@/lib/executive/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HUB = "app/departments/hr/page.tsx";
const HR_ROUTES = [
  "page.tsx", "registre/page.tsx", "organisation/page.tsx", "configuration/page.tsx",
  "imports/page.tsx", "onboarding/page.tsx", "equipement/page.tsx", "conges/page.tsx",
  "[id]/page.tsx",
];

// ---------------------------------------------------------------------------
describe("zero-change guarantees — activation is UI only", () => {
  it("added NO migration of its own — HR-5's is still the last before HR-6", () => {
    const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    // Pinned RELATIVELY, not as a global count: later phases legitimately add
    // migrations, and a global-count pin would make every future phase look
    // like a breach of HR-5A's guarantee. What HR-5A promised is that IT
    // shipped none — so nothing may sit between HR-5's migration and HR-6's.
    const hr5 = migrations.indexOf("20260802000003_hr_leave_attendance.sql");
    expect(hr5).toBeGreaterThan(-1);
    expect(migrations[hr5 + 1] ?? "20260803000001_hr_performance.sql")
      .toBe("20260803000001_hr_performance.sql");
  });

  it("adds no permission code and no grant anywhere in HR-5A's files", () => {
    for (const p of ["lib/hr/workspace.ts", "lib/executive/readers/hr.ts", HUB]) {
      expect(code(p), p).not.toMatch(/insert into public\.permission|role_permission|GRANT /i);
    }
  });

  it("introduces no new HR business rule: the composition layer only reads", () => {
    const w = code("lib/hr/workspace.ts");
    expect(w).not.toMatch(/\.(insert|update|delete|rpc)\(/);
    expect(w).toContain('import "server-only"');
  });
});

// ---------------------------------------------------------------------------
describe("gates remain intact", () => {
  it("every HR route still gates on hr:read server-side", () => {
    for (const r of HR_ROUTES) {
      expect(code(`app/departments/hr/${r}`), r).toContain('hasPermission(permissions, "hr:read")');
    }
  });

  it("the hub never grants itself the restricted permissions — it only reads them", () => {
    const h = code(HUB);
    expect(h).toContain('hasPermission(permissions, "hr:config:manage")');
    // Restricted tiles are rendered as gated, not as links, when the gate is absent.
    expect(h).toContain("GatedTile");
    expect(h).toContain("hr:config:manage (HRQ-D2)");
  });

  it("leave approval controls stay behind hr:leave:approve", () => {
    expect(code("app/departments/hr/conges/page.tsx")).toContain('hasPermission(permissions, "hr:leave:approve")');
    const studio = code("components/hr/leave-studio.tsx");
    expect(studio).toContain("canApprove");
  });

  it("the executive HR reader SELF-GATES on hr:read and withholds rather than zeroes", () => {
    const r = code("lib/executive/readers/hr.ts");
    expect(r).toContain('assertPermission("executive:dashboard:read")');
    expect(r).toContain('if (!hasPermission(perms, "hr:read")) return null');
  });

  it("the directory filter cannot reach a field the table does not display", () => {
    const readSvc = code("lib/hr/read.ts");
    const filter = readSvc.slice(readSvc.indexOf("const term = filters.q"));
    for (const f of ["personal_email", "personal_phone", "cni", "salary"]) {
      expect(filter).not.toContain(f);
    }
    expect(filter).toContain("first_name.ilike");
    expect(filter).toContain("employee_number.ilike");
  });
});

// ---------------------------------------------------------------------------
describe("canonical routes — one entry point per capability", () => {
  it("each completed capability has exactly ONE workspace tile", () => {
    // A KPI card may also shortcut to the same route — that is a shortcut, not a
    // second entry point. What must be unique is the workspace tile itself.
    const h = read(HUB);
    for (const href of [
      "/departments/hr/registre", "/departments/hr/organisation", "/departments/hr/onboarding",
      "/departments/hr/equipement", "/departments/hr/conges", "/departments/hr/configuration",
      "/departments/hr/imports", "/departments/hr/departs", "/departments/hr/rapports",
      "/departments/hr/guide",
    ]) {
      const tiles = [...h.matchAll(new RegExp(`WorkspaceTile href="${href}"`, "g"))].length;
      expect(tiles, href).toBe(1);
    }
  });

  it("no competing HR dashboard route was created", () => {
    const routes = readdirSync(join(root, "app", "departments", "hr"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    expect(routes).not.toContain("dashboard");
    expect(routes).not.toContain("tableau");
    // HR-6 added `performance` and `formation` — both are WORKSPACES reached
    // from the hub, not competing dashboards, so the invariant still holds.
    // HR-8B added `departs` — a workspace reached from the hub, not a rival hub.
    // HR-9B added `rapports`; HR-10 added `guide` — the mode opératoire that
    // DOCUMENTS the workspaces. Both are reached from the hub, not rival hubs.
    expect(routes.sort()).toEqual(["[id]", "configuration", "conges", "departs", "equipement",
      "formation", "guide", "imports", "onboarding", "organisation", "paie", "performance",
      "rapports", "registre"]);
  });

  it("the registry's filter links point at /registre — the HR-1 move is honoured", () => {
    const reg = code("app/departments/hr/registre/page.tsx");
    expect(reg).toContain('`/departments/hr/registre?${qs}`');
    expect(reg).not.toMatch(/return qs \? `\/departments\/hr\?\$\{qs\}`/);
  });

  it("roadmap tiles are disabled and name their phase; recruitment is NOT promised", () => {
    const h = read(HUB);
    for (const phase of ["HR-6", "HR-7", "HR-8", "HR-9"]) expect(h).toContain(phase);
    expect(h).toContain('aria-disabled="true"');
    // Word-bounded: « Contrats » contains "ats", and a loose regex would fail on it.
    expect(h).not.toMatch(/recrutement|ATS/i);
  });
});

// ---------------------------------------------------------------------------
describe("navigation and icons — ratified placement preserved", () => {
  it("HR stays under MANAGEMENT with IconTeam; DÉPARTEMENTS stays at three", () => {
    const departments = navSections.find((s) => s.key === "departments")!;
    expect(departments.items.map((i) => i.key)).toEqual(["operations", "transit", "finance"]);
    const hr = navSections.find((s) => s.key === "management")!.items.find((i) => i.key === "hr")!;
    expect(hr.label).toBe("Ressources humaines");
    expect(hr.iconKey).toBe("team");
    expect(hr.permission).toBe("hr:read");
  });

  it("the four department marks are distinct and HR does not reuse Administration's", () => {
    const byKey = Object.fromEntries(navSections.flatMap((s) => s.items).map((i) => [i.key, i.iconKey]));
    expect(byKey.operations).toBe("gear");
    expect(byKey.transit).toBe("truck");
    expect(byKey.finance).toBe("finance");
    expect(byKey.hr).toBe("team");
    expect(byKey.hr).not.toBe(byKey.users);
    expect(new Set([byKey.operations, byKey.transit, byKey.finance, byKey.hr]).size).toBe(4);
  });

  it("no emoji reaches production UI", () => {
    for (const p of [HUB, "lib/icons.tsx", "components/shell/sidebar.tsx"]) {
      expect(read(p), p).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

// ---------------------------------------------------------------------------
describe("honest figures", () => {
  it("unavailable is rendered as its own state, never as zero", () => {
    const h = read(HUB);
    expect(h).toContain("indisponible");
    expect(h).toContain("?? UNAVAILABLE");
    expect(h).toContain("center.recentActivity === null");
  });

  it("the composition layer isolates failures instead of collapsing the page", () => {
    expect(code("lib/hr/workspace.ts")).toContain("Promise.allSettled");
  });

  it("no ON_LEAVE is stored or recomputed — the count comes from HR-5's projection", () => {
    expect(code("lib/hr/workspace.ts")).not.toMatch(/ON_LEAVE/);
    expect(code(HUB)).toContain("leaveCounts");
  });

  it("the expiry window is a display window, not an implied legal notice period", () => {
    const w = code("lib/hr/workspace.ts");
    expect(w).toContain("EXPIRY_WINDOW_DAYS = 30");
    expect(w).not.toMatch(/statut|préavis|legal/i);
  });
});

// ---------------------------------------------------------------------------
describe("executive integration — composition, not a new engine", () => {
  it("HR is a registered section and KPI source", () => {
    expect([...EXECUTIVE_SECTIONS]).toContain("hr");
    expect([...KPI_SOURCES]).toContain("hr-dashboard");
  });

  it("the reader composes existing HR services and adds no query of its own", () => {
    const r = code("lib/executive/readers/hr.ts");
    for (const svc of ["employeeStats", "leaveCounts", "expiringContracts", "expiringDocuments", "hrOperationsCounts"]) {
      expect(r).toContain(svc);
    }
    expect(r).not.toMatch(/getAdminSupabaseClient|\.from\(/);
  });

  it("speculative analytics are excluded by name", () => {
    const r = read("lib/executive/readers/hr.ts");
    expect(r).toMatch(/turnover|absence rate|average onboarding/i); // named as excluded
    const c = code("lib/executive/readers/hr.ts");
    expect(c).not.toMatch(/turnover|absenteeism|attrition/i);       // and absent from the code
  });
});
