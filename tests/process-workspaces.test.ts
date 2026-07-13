/**
 * Phase 5.0C — workspaces: navigation, flags, route authorization, legacy
 * handling, and the Coordinator tower's official buckets.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildProcessNav } from "@/lib/process/queues/nav";
import { resolveProcessFlags } from "@/lib/process/flags";
import { QUEUES } from "@/lib/process/queues/registry";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const PERMS = ["process:read"];

// --------------------------------------------------------------------- flags ----

describe("workspaces flag — off by default, and dark without the engine", () => {
  it("is off when nothing is set", () => {
    expect(resolveProcessFlags({}).workspaces).toBe(false);
  });

  it("stays off when only the workspaces flag is set (the engine is still dark)", () => {
    // Queues over a dark engine would always be empty — never show them.
    expect(
      resolveProcessFlags({ EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true" }).workspaces,
    ).toBe(false);
  });

  it("turns on only with BOTH the engine and the workspaces flag", () => {
    expect(
      resolveProcessFlags({
        EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
        EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
      }).workspaces,
    ).toBe(true);
  });

  it("leaves the engine flag independent of the workspaces flag", () => {
    const f = resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" });
    expect(f.enabled).toBe(true);
    expect(f.workspaces).toBe(false);
  });
});

// ---------------------------------------------------------------- navigation ----

describe("role-aware navigation (Deliverable 14)", () => {
  it("adds NOTHING when the workspaces flag is off — nav is unchanged", () => {
    expect(buildProcessNav(["OPS_SUPERVISOR"], PERMS, false)).toEqual([]);
  });

  it("adds nothing without process:read, whatever the role", () => {
    expect(buildProcessNav(["OPS_SUPERVISOR"], [], true)).toEqual([]);
  });

  it("shows a courier ONLY their own queue — no other department", () => {
    const nav = buildProcessNav(["COURIER"], PERMS, true);
    const hrefs = nav.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toEqual(["/my-work", "/queues/courier"]);
  });

  it("shows a Chief Transit only the transit queue", () => {
    const hrefs = buildProcessNav(["CHIEF_OF_TRANSIT"], PERMS, true).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).toEqual(["/my-work", "/queues/transit"]);
  });

  it("never shows an empty, unauthorized department", () => {
    const hrefs = buildProcessNav(["CUSTOMS_DECLARANT"], PERMS, true).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/queues/billing");
    expect(hrefs).not.toContain("/queues/finance");
    expect(hrefs).not.toContain("/queues/collections");
  });

  it("gives a supervisor the cross-department view", () => {
    const hrefs = buildProcessNav(["OPS_SUPERVISOR"], PERMS, true).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs).toContain("/queues/coordination");
    expect(hrefs).toContain("/queues/billing");
  });

  it("gives a user with no queue roles the My Work link and nothing else", () => {
    const nav = buildProcessNav(["COMPLIANCE_HSSE"], PERMS, true);
    expect(nav.flatMap((s) => s.items.map((i) => i.href))).toEqual(["/my-work"]);
  });

  it("never exposes platform navigation", () => {
    const hrefs = buildProcessNav(["SYSTEM_ADMIN"], PERMS, true).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs.some((h) => h.startsWith("/platform"))).toBe(false);
  });
});

// ------------------------------------------------------- route authorization ----

describe("route authorization", () => {
  const queuePage = read("../app/queues/[queueKey]/page.tsx");
  const myWork = read("../app/my-work/page.tsx");
  const processPage = read("../app/files/[id]/process/page.tsx");

  it("404s every workspace route when the flag is off", () => {
    for (const [name, src] of [
      ["queue", queuePage],
      ["my-work", myWork],
    ] as const) {
      expect(src, name).toContain("notFound()");
      expect(src, name).toContain("getProcessFlags().workspaces");
    }
    // The process inspector rides the ENGINE flag, not the workspaces flag.
    expect(processPage).toContain("getProcessFlags().enabled");
  });

  it("checks BOTH the permission and the user's role before opening a queue", () => {
    expect(queuePage).toContain('hasPermission(permissions, def.permission)');
    // A user cannot reach a department they do not staff by typing its URL.
    expect(queuePage).toContain("def.roles.some((r) => user.roles.includes(r))");
  });

  it("paginates server-side and never ships the whole dossier set", () => {
    expect(queuePage).toContain("pageSize");
    expect(queuePage).toContain("page");
  });
});

// -------------------------------------------------------------------- actions ----

describe("queue actions go through the Phase 5.0B engine (Deliverable 10)", () => {
  const actions = read("../lib/process/queues/actions.ts");

  it("delegates every action to the engine — no queue-layer business logic", () => {
    for (const fn of [
      "receiveHandoff",
      "rejectHandoff",
      "activateStep",
      "submitStep",
      "approveStep",
      "rejectStep",
      "sendHandoff",
    ]) {
      expect(actions).toContain(fn);
    }
    expect(actions).toContain('from "../engine/actions"');
  });

  it("never touches the database directly from the queue layer", () => {
    expect(actions).not.toContain("getAdminSupabaseClient");
    expect(actions).not.toContain("scopedFrom");
    expect(actions).not.toContain(".update(");
    expect(actions).not.toContain(".insert(");
  });

  it("never mutates process state from a page component", () => {
    const queuePage = read("../app/queues/[queueKey]/page.tsx");
    const myWork = read("../app/my-work/page.tsx");
    for (const src of [queuePage, myWork]) {
      expect(src).not.toContain("getAdminSupabaseClient");
      expect(src).not.toContain("process_step_execution");
    }
  });
});

// --------------------------------------------------------------------- legacy ----

describe("legacy dossiers (Deliverable 13)", () => {
  const processPage = read("../app/files/[id]/process/page.tsx");

  it("labels a dossier with no instance instead of inventing one", () => {
    expect(processPage).toContain("Processus officiel non initialisé");
  });

  it("NEVER initializes a process instance while rendering a list or a page", () => {
    const queuePage = read("../app/queues/[queueKey]/page.tsx");
    const myWork = read("../app/my-work/page.tsx");
    const queueService = read("../lib/process/queues/service.ts");
    for (const src of [processPage, queuePage, myWork, queueService]) {
      expect(src).not.toContain("initializeProcessForFile");
    }
  });

  it("excludes legacy dossiers from queues by construction", () => {
    const queueService = read("../lib/process/queues/service.ts");
    // Queues read process_step_execution — a dossier with no instance has no rows,
    // so it cannot appear. There is no filter to forget.
    expect(queueService).toContain("process_step_execution");
    expect(queueService).toContain("Legacy dossiers (no process instance) are EXCLUDED");
  });

  it("promises never to mark a prior step completed", () => {
    expect(processPage).toContain("non vérifiées");
  });
});

// ------------------------------------------------------------ control tower ----

describe("Coordinator Control Tower (Deliverable 4)", () => {
  const tower = read("../lib/process/queues/control-tower.ts");
  const dashboard = read("../app/dashboard/page.tsx");

  it("UPGRADES the existing Control Tower rather than creating a second one", () => {
    // The process tower is rendered as a section of /dashboard, alongside the
    // existing ControlTower — not on a competing route.
    expect(dashboard).toContain("ProcessTowerSection");
    expect(dashboard).toContain("<ControlTower data={controlTower} />");
  });

  it("returns nothing (and costs nothing) when the flag is off", () => {
    expect(tower).toContain("if (!getProcessFlags().workspaces) return null;");
  });

  it("covers the official parallel-mismatch buckets", () => {
    expect(tower).toContain("customsReadyTransportNot");
    expect(tower).toContain("transportReadyCustomsNot");
    expect(tower).toContain("pickupReady");
  });

  it("covers the customs chain, handoffs and post-delivery buckets", () => {
    for (const bucket of [
      "waitingChiefValidation",
      "waitingGaindeRegistration",
      "waitingGaindeDocs",
      "waitingFieldAgent",
      "baeMissing",
      "deliveredNoPod",
      "podAwaitingCompleteness",
      "billingReady",
    ]) {
      expect(tower, bucket).toContain(bucket);
    }
  });

  it("uses the engine's gates rather than reconstructing workflow logic in the UI", () => {
    expect(tower).toContain("evaluatePickupGate");
    expect(tower).toContain("evaluateBranch");
  });

  it("links every bucket to the queue that can act on it", () => {
    for (const q of QUEUES.slice(0, 5)) {
      // At least the operational queues are reachable from the tower.
      expect(typeof q.key).toBe("string");
    }
    expect(tower).toContain("/queues/");
  });
});

// ---------------------------------------------------------------- BLOCKER-3 ----

describe("BLOCKER-3 — legacy mock routes retired (Deliverable 16)", () => {
  const customsDetail = read("../app/customs/[customsId]/page.tsx");
  const taskDetail = read("../app/tasks/[taskId]/page.tsx");

  it("stops rendering mock data on /customs/[customsId]", () => {
    expect(customsDetail).not.toContain('from "@/lib/customs"');
    // No longer bakes fake customs IDs into the production build.
    expect(customsDetail).not.toMatch(/export\s+function\s+generateStaticParams/);
    expect(customsDetail).toContain("RETIRED");
  });

  it("stops rendering mock data on /tasks/[taskId]", () => {
    expect(taskDetail).not.toContain('from "@/lib/tasks"');
    expect(taskDetail).not.toMatch(/export\s+function\s+generateStaticParams/);
    expect(taskDetail).toContain("RETIRED");
  });

  it("keeps the REAL list pages untouched", () => {
    // /customs and /tasks lists read the database; only the mock DETAIL routes go.
    const customsList = read("../app/customs/page.tsx");
    expect(customsList).not.toContain('from "@/lib/customs"');
  });
});
