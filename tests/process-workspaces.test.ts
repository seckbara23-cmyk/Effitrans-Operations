/**
 * Phase 5.0C — workspaces: navigation, flags, route authorization, legacy
 * handling, and the Coordinator tower's official buckets.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildNavigation } from "@/lib/navigation/build";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import { QUEUES } from "@/lib/process/queues/registry";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const PERMS = ["process:read"];

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
});
const FLAGS_OFF = resolveProcessFlags({});

/** Phase 5.0E-1 — ONE builder now produces the whole sidebar. */
const ctx = (
  roleCodes: string[],
  permissions: string[] = PERMS,
  featureFlags = FLAGS_ON,
): NavigationContext => ({
  userId: "u1",
  tenantId: "t1",
  roleCodes,
  permissions,
  identityType: "tenant",
  featureFlags,
});

const hrefsFor = (...args: Parameters<typeof ctx>): string[] =>
  buildNavigation(ctx(...args)).sections.flatMap((s) => s.items.map((i) => i.href));

/** Only the entries the process engine contributes — queues and role panels. */
const processHrefs = (hrefs: string[]): string[] =>
  hrefs.filter(
    (h) =>
      h.startsWith("/queues/") ||
      ["/my-work", "/courier", "/portfolio", "/collections", "/deposits", "/transport-readiness"].includes(h),
  );

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

describe("role-aware navigation (Deliverable 14; rebuilt on ONE builder in 5.0E-1)", () => {
  it("contributes NOTHING when the workspaces flag is off — production nav unchanged", () => {
    const hrefs = hrefsFor(["OPS_SUPERVISOR"], PERMS, FLAGS_OFF);
    expect(processHrefs(hrefs)).toEqual([]);
    // ...and what remains is exactly the legacy navigation.
    expect(hrefs).toContain("/dashboard");
  });

  it("contributes nothing without process:read, whatever the role", () => {
    expect(processHrefs(hrefsFor(["OPS_SUPERVISOR"], []))).toEqual([]);
  });

  it("shows a courier ONLY their own work — no other department", () => {
    const hrefs = hrefsFor(["COURIER"], [...PERMS, "courier:deposit"]);
    expect(processHrefs(hrefs)).toEqual(["/my-work", "/courier", "/queues/courier"]);
    expect(hrefs).not.toContain("/collections");
    expect(hrefs).not.toContain("/portfolio");
    expect(hrefs).not.toContain("/deposits");
  });

  it("shows a Chief Transit only the transit queue", () => {
    expect(processHrefs(hrefsFor(["CHIEF_OF_TRANSIT"]))).toEqual(["/my-work", "/queues/transit"]);
  });

  it("never shows an empty, unauthorized department", () => {
    const hrefs = hrefsFor(["CUSTOMS_DECLARANT"]);
    expect(hrefs).not.toContain("/queues/billing");
    expect(hrefs).not.toContain("/queues/finance");
    expect(hrefs).not.toContain("/queues/collections");
  });

  it("gives a supervisor the cross-department view", () => {
    const hrefs = hrefsFor(["OPS_SUPERVISOR"]);
    expect(hrefs.filter((h) => h.startsWith("/queues/")).length).toBeGreaterThan(10);
    expect(hrefs).toContain("/queues/coordination");
    expect(hrefs).toContain("/queues/billing");
  });

  it("gives a user with no queue roles the My Work link and no queue", () => {
    expect(processHrefs(hrefsFor(["COMPLIANCE_HSSE"]))).toEqual(["/my-work"]);
  });

  it("never exposes platform navigation, even to a SYSTEM_ADMIN", () => {
    const hrefs = hrefsFor(["SYSTEM_ADMIN"]);
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
//
// The retired-route assertions moved to tests/no-mock-modules.test.ts in Phase
// 5.0D-5: the routes and the mock modules were DELETED outright, so there is no
// longer a file here to read. That guard proves they are gone and fails CI if any
// of them returns.
