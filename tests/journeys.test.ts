/**
 * Phase 5.0E-3 — the final sidebar structure, and "Parcours des dossiers".
 *
 * The three ways this phase can silently go wrong:
 *   1. the sidebar drifts from the agreed five sections;
 *   2. the milestone view stops covering the official process, and shows a confident
 *      but incomplete picture;
 *   3. the Parcours page initializes a legacy dossier merely by being looked at.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildNavigation, workspacesFor } from "@/lib/navigation/build";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import {
  JOURNEY_MILESTONES,
  milestoneForStep,
  milestoneStates,
} from "@/lib/process/journeys/milestones";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
});

const ALL_PERMS = [
  "process:read", "file:read", "client:read", "communication:read",
  "document:read", "customs:read", "transport:read", "finance:read",
  "analytics:read", "admin:users:manage", "audit:read:all", "admin:config:manage",
  "collections:manage", "admin_service:manage", "courier:deposit",
];

const ctx = (over: Partial<NavigationContext> = {}): NavigationContext => ({
  userId: "u1",
  tenantId: "t1",
  roleCodes: [],
  permissions: ALL_PERMS,
  identityType: "tenant",
  featureFlags: FLAGS_ON,
  ...over,
});

const nav = (over: Partial<NavigationContext> = {}) => buildNavigation(ctx(over));
const hrefs = (over: Partial<NavigationContext> = {}) =>
  nav(over).sections.flatMap((s) => s.items.map((i) => i.href));

// ==================================================== the agreed structure ====

describe("the sidebar is exactly the five agreed sections", () => {
  const full = nav({ roleCodes: ["SYSTEM_ADMIN"] });

  it("has five sections, in the agreed order", () => {
    expect(full.sections.map((s) => s.key)).toEqual([
      "pilotage",
      "files",
      "departments",
      "management",
      "administration",
    ]);
  });

  it("labels them exactly", () => {
    expect(full.sections.map((s) => s.label)).toEqual([
      "Pilotage",
      "Dossiers",
      "Départements",
      "Management",
      "Administration",
    ]);
  });

  it("holds the agreed items, in the agreed order", () => {
    const byKey = Object.fromEntries(
      full.sections.map((s) => [s.key, s.items.map((i) => i.label)]),
    );
    expect(byKey.pilotage).toEqual(["Centre d'opérations", "Mon Travail", "Parcours des dossiers"]);
    expect(byKey.files).toEqual(["Dossiers", "Clients", "Communications"]);
    expect(byKey.departments).toEqual(["Documentation", "Douane", "Transport", "Finance"]);
    expect(byKey.management).toEqual(["Direction", "Rapports", "Tableau exécutif"]);
    expect(byKey.administration).toEqual(["Utilisateurs", "Journal d'audit", "Paramètres"]);
  });

  it("points every item at a route that EXISTS", () => {
    // No invented hrefs. Each one is a real page.tsx in this repo.
    const ROUTES: Record<string, string> = {
      "/dashboard": "../app/dashboard/page.tsx",
      "/my-work": "../app/my-work/page.tsx",
      "/journeys": "../app/journeys/page.tsx",
      "/files": "../app/files/page.tsx",
      "/clients": "../app/clients/page.tsx",
      "/communications": "../app/communications/page.tsx",
      "/departments/documentation": "../app/departments/documentation/page.tsx",
      "/departments/customs": "../app/departments/customs/page.tsx",
      "/departments/transport": "../app/departments/transport/page.tsx",
      "/departments/finance": "../app/departments/finance/page.tsx",
      "/departments/management": "../app/departments/management/page.tsx",
      "/reports": "../app/reports/page.tsx",
      "/dashboard/executive": "../app/dashboard/executive/page.tsx",
      "/users": "../app/users/page.tsx",
      "/settings/audit": "../app/settings/audit/page.tsx",
      "/settings": "../app/settings/page.tsx",
    };
    for (const href of hrefs({ roleCodes: ["SYSTEM_ADMIN"] })) {
      expect(ROUTES[href], `${href} has no page`).toBeDefined();
      expect(() => read(ROUTES[href])).not.toThrow();
    }
  });

  it("has no duplicate href and no duplicate key", () => {
    const h = hrefs({ roleCodes: ["SYSTEM_ADMIN"] });
    expect(new Set(h).size).toBe(h.length);
    const keys = full.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names Direction and Tableau exécutif as DIFFERENT things", () => {
    // Before 5.0E-3 the sidebar called /dashboard/executive "Direction" while ALSO
    // listing /departments/management as "Management" — two names for one idea, and the
    // real Direction workspace reachable under neither.
    const mgmt = full.sections.find((s) => s.key === "management")!;
    const byLabel = Object.fromEntries(mgmt.items.map((i) => [i.label, i.href]));
    expect(byLabel["Direction"]).toBe("/departments/management");
    expect(byLabel["Tableau exécutif"]).toBe("/dashboard/executive");
    expect(byLabel["Direction"]).not.toBe(byLabel["Tableau exécutif"]);
  });

  it("says Douane — never Dédouanement, never a role name, never a registry key", () => {
    const labels = full.sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Douane");
    for (const banned of [
      "Dédouanement",
      "Déclarant",
      "Chef de Transit",
      "Coursier",
      "Account Manager",
      "Finance douane",
      "customs_declaration",
      "process:read",
    ]) {
      expect(labels, banned).not.toContain(banned);
    }
  });

  it("puts AI settings UNDER Paramètres, not as a fourth top-level item", () => {
    const admin = full.sections.find((s) => s.key === "administration")!;
    expect(admin.items.map((i) => i.href)).not.toContain("/settings/ai");
    expect(read("../app/settings/page.tsx")).toContain("/settings/ai");
  });

  it("omits an empty section entirely", () => {
    const bare = nav({ roleCodes: ["CUSTOMS_DECLARANT"], permissions: ["process:read"] });
    expect(bare.sections.map((s) => s.key)).toEqual(["pilotage"]);
  });
});

// ================================================= no job titles in the nav ====

describe("operational job titles never become permanent sidebar links", () => {
  it("gives NO role a queue link in the sidebar — not even a SYSTEM_ADMIN", () => {
    for (const role of [
      "SYSTEM_ADMIN", "OPS_SUPERVISOR", "COORDINATOR", "CUSTOMS_DECLARANT",
      "CHIEF_OF_TRANSIT", "BILLING_OFFICER", "ACCOUNT_MANAGER", "COLLECTIONS_OFFICER",
    ]) {
      const h = hrefs({ roleCodes: [role] });
      expect(h.some((x) => x.startsWith("/queues/")), role).toBe(false);
      for (const panel of ["/portfolio", "/collections", "/deposits", "/transport-readiness", "/courier"]) {
        expect(h, `${role} sees ${panel}`).not.toContain(panel);
      }
    }
  });

  it("keeps every one of them reachable from Mon Travail instead", () => {
    // Removing a link from the sidebar must not remove the WORK. Each role still gets
    // exactly the workspaces they are authorized for — just somewhere better.
    const am = workspacesFor(ctx({ roleCodes: ["ACCOUNT_MANAGER"] })).map((w) => w.href);
    expect(am).toContain("/portfolio");
    expect(am).toContain("/queues/account_management");

    const decl = workspacesFor(ctx({ roleCodes: ["CUSTOMS_DECLARANT"] })).map((w) => w.href);
    expect(decl).toEqual(["/queues/customs_declaration"]);

    const coll = workspacesFor(ctx({ roleCodes: ["COLLECTIONS_OFFICER"] })).map((w) => w.href);
    expect(coll).toContain("/collections");
  });

  it("still refuses a colleague's workspace", () => {
    const decl = workspacesFor(ctx({ roleCodes: ["CUSTOMS_DECLARANT"] })).map((w) => w.href);
    for (const other of ["/portfolio", "/collections", "/deposits", "/queues/billing"]) {
      expect(decl, other).not.toContain(other);
    }
  });

  it("Mon Travail renders them — the sidebar no longer does", () => {
    const page = read("../app/my-work/page.tsx");
    expect(page).toContain("workspacesFor");
    expect(page).toContain("Mes espaces");
  });
});

// ======================================================== role expectations ====

describe("role examples (Deliverable 15)", () => {
  const P = {
    declarant: ["process:read", "customs:read", "document:read"],
    chiefTransit: ["process:read", "customs:read", "document:read"],
    accountManager: ["process:read", "file:read", "client:read", "communication:read", "document:read"],
    billing: ["process:read", "finance:read", "document:read"],
    collections: ["process:read", "finance:read", "collections:manage"],
  };

  it("Déclarant: Mon Travail + Douane; no Finance, no Administration", () => {
    const h = hrefs({ roleCodes: ["CUSTOMS_DECLARANT"], permissions: P.declarant });
    expect(h).toContain("/my-work");
    expect(h).toContain("/departments/customs");
    expect(h).not.toContain("/departments/finance");
    expect(h).not.toContain("/users");
    expect(h).not.toContain("/settings");
  });

  it("Chef Transit: Mon Travail + Douane; no management without permission", () => {
    const h = hrefs({ roleCodes: ["CHIEF_OF_TRANSIT"], permissions: P.chiefTransit });
    expect(h).toContain("/my-work");
    expect(h).toContain("/departments/customs");
    expect(h).not.toContain("/departments/management");
    expect(h).not.toContain("/dashboard/executive");
  });

  it("Account Manager: Mon Travail + Dossiers/Clients/Communications; no unrelated tools", () => {
    const h = hrefs({ roleCodes: ["ACCOUNT_MANAGER"], permissions: P.accountManager });
    expect(h).toContain("/my-work");
    expect(h).toContain("/files");
    expect(h).toContain("/clients");
    expect(h).toContain("/communications");
    expect(h).not.toContain("/departments/finance");
    expect(h).not.toContain("/departments/customs");
    // ...and the portfolio is one click away, in Mon Travail.
    expect(workspacesFor(ctx({ roleCodes: ["ACCOUNT_MANAGER"], permissions: P.accountManager })).map((w) => w.href))
      .toContain("/portfolio");
  });

  it("Facturation: Mon Travail + Finance; no Administration", () => {
    const h = hrefs({ roleCodes: ["BILLING_OFFICER"], permissions: P.billing });
    expect(h).toContain("/my-work");
    expect(h).toContain("/departments/finance");
    expect(h).not.toContain("/users");
    expect(h).not.toContain("/settings");
  });

  it("Recouvrement: no duplicate Recouvrement link anywhere", () => {
    const c = ctx({ roleCodes: ["COLLECTIONS_OFFICER"], permissions: P.collections });
    const all = [
      ...buildNavigation(c).sections.flatMap((s) => s.items.map((i) => i.label)),
      ...workspacesFor(c).map((w) => w.label),
    ];
    // "Recouvrement" is the QUEUE (step-26 handoff work). The aging workbench is
    // "Balance âgée". Two surfaces, two names, never the same word twice.
    expect(all.filter((l) => l === "Recouvrement").length).toBeLessThanOrEqual(1);
    expect(new Set(all).size).toBe(all.length);
  });

  it("Coursier: dedicated surface, no staff sidebar at all", () => {
    const c = ctx({ roleCodes: ["COURIER"], identityType: "courier", permissions: ["process:read", "courier:deposit"] });
    expect(buildNavigation(c).sections).toEqual([]);
    expect(workspacesFor(c)).toEqual([]);
  });

  it("System Admin: every tenant section, and NEVER platform navigation", () => {
    const h = hrefs({ roleCodes: ["SYSTEM_ADMIN"] });
    expect(nav({ roleCodes: ["SYSTEM_ADMIN"] }).sections).toHaveLength(5);
    expect(h.some((x) => x.startsWith("/platform"))).toBe(false);
    expect(h.some((x) => x.startsWith("/portal"))).toBe(false);
  });
});

// ============================================================== milestones ====

describe("the 15-milestone view is DERIVED from the 26-step registry", () => {
  it("partitions the official process: every step in exactly one milestone", () => {
    const owned = JOURNEY_MILESTONES.flatMap((m) => m.stepKeys);
    expect(new Set(owned).size).toBe(owned.length); // no step twice
    expect(owned.length).toBe(EFFITRANS_PROCESS.length); // ...and none missing
    for (const s of EFFITRANS_PROCESS) {
      expect(milestoneForStep(s.key), s.key).not.toBeNull();
    }
  });

  it("has exactly the fifteen agreed milestones, in order", () => {
    expect(JOURNEY_MILESTONES.map((m) => m.labelFr)).toEqual([
      "Cotation",
      "Ouverture du dossier",
      "Préparation Douane",
      "Validation Transit",
      "GAINDE",
      "Terrain Douane",
      "Préparation Transport",
      "Enlèvement",
      "Livraison",
      "Complétude",
      "Facturation",
      "Validation Finance",
      "Dépôt physique",
      "Recouvrement",
      "Clôture",
    ]);
  });

  it("marks the parallel branches", () => {
    const customs = JOURNEY_MILESTONES.filter((m) => m.branch === "customs").map((m) => m.key);
    const transport = JOURNEY_MILESTONES.filter((m) => m.branch === "transport").map((m) => m.key);
    expect(customs).toContain("prep_douane");
    expect(customs).toContain("gainde");
    expect(transport).toContain("prep_transport");
  });

  it("keeps Clôture separate from step 26 — recovery is not closure", () => {
    const closure = JOURNEY_MILESTONES.find((m) => m.key === "cloture")!;
    expect(closure.stepKeys).toEqual([]);
    const recovery = JOURNEY_MILESTONES.find((m) => m.key === "recouvrement")!;
    expect(recovery.stepKeys).toEqual(["collections"]);
  });

  it("derives the state from the executions, and lets a rejection outrank everything", () => {
    const states = milestoneStates([
      { stepKey: "cotation", state: "COMPLETED" },
      { stepKey: "customs_preparation", state: "REJECTED" },
      { stepKey: "transit_declarant_assignment", state: "COMPLETED" },
    ]);
    const by = Object.fromEntries(states.map((s) => [s.key, s.state]));
    expect(by.cotation).toBe("completed");
    // Someone is redoing work — the single most useful thing to know here.
    expect(by.prep_douane).toBe("rejected");
    expect(by.enlevement).toBe("pending");
  });

  it("reports blocked when the caller says a step is blocked", () => {
    const states = milestoneStates(
      [{ stepKey: "pickup", state: "ACTIVE" }],
      ["pickup"],
    );
    expect(states.find((s) => s.key === "enlevement")!.state).toBe("blocked");
  });

  it("shows nothing at all for a dossier with no executions", () => {
    for (const m of milestoneStates([])) expect(m.state).toBe("pending");
  });

  it("never exposes a raw step key", () => {
    for (const m of milestoneStates([{ stepKey: "cotation", state: "ACTIVE" }])) {
      expect(m.labelFr).not.toMatch(/^[a-z_]+$/);
    }
  });
});

// ================================================================= parcours ====

describe("Parcours des dossiers (Deliverable 4)", () => {
  const svc = read("../lib/process/journeys/service.ts");
  const page = read("../app/journeys/page.tsx");

  it("NEVER initializes a legacy dossier by being looked at", () => {
    // A page that migrates your data by being rendered would silently perform the
    // historical backfill management has not approved.
    for (const w of ["initializeProcessForFile", ".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(svc, w).not.toContain(w);
    }
    expect(svc).toContain("IT NEVER INITIALIZES ANYTHING");
  });

  it("includes legacy dossiers, honestly labelled", () => {
    expect(svc).toContain("initialized");
    expect(page).toContain("Non initialisé");
  });

  it("is tenant-scoped and honours file visibility", () => {
    expect(svc).toContain("scopedFrom(admin,");
    expect(svc).not.toMatch(/\badmin\.from\(/);
    expect(svc).toContain("resolveFileScope");
  });

  it("has NO N+1 — every read is batched", () => {
    expect(svc).toContain("QUERY COUNT IS CONSTANT");
    expect(svc).toContain("Promise.all");
    expect(svc).toContain('.in("file_id", fileIds)');
    expect(svc).toContain('.in("process_instance_id", instanceIds)');
  });

  it("paginates and DISCLOSES the cap rather than truncating silently", () => {
    expect(svc).toContain("WORKING_SET_CAP");
    expect(svc).toContain("capped");
    expect(page).toContain("Seuls les 500 plus récents");
  });

  it("supports every required filter", () => {
    for (const f of [
      "blocked", "awaiting_reception", "customs_branch", "transport_branch",
      "pickup_ready", "delivered", "billing", "collections", "closed", "uninitialized",
    ]) {
      expect(svc, f).toContain(`"${f}"`);
    }
  });

  it("is gated on the kill switch, the TENANT rollout, and process:read", () => {
    expect(page).toContain("globalKillSwitch().workspaces");
    expect(page).toContain("getTenantProcessFlags(user.tenantId)");
    expect(page).toContain('hasPermission(permissions, "process:read")');
    expect(page).toContain("notFound()");
  });

  it("shows French labels, never a raw step key or role code", () => {
    expect(svc).toContain("stepLabel(");
    expect(svc).toContain("roleLabel(");
    expect(page).not.toMatch(/currentStepKey|stepKey/);
  });

  it("represents the parallel branches", () => {
    expect(svc).toContain("evaluateBranch");
    expect(page).toContain("branche douane");
    expect(page).toContain("branche transport");
  });

  it("reuses the process read model — it does not re-derive the engine", () => {
    expect(svc).toContain('from "../engine/state"');
    expect(svc).toContain("missingPrerequisites");
    // No second registry, no second queue definition.
    expect(svc).not.toContain("QUEUES");
  });
});
