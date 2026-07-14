/**
 * Phase 5.0E-1 — role-driven navigation, landing routes and the workbench.
 *
 * The three things that can silently break here:
 *   1. the flag-off sidebar stops being today's sidebar,
 *   2. a landing route sends someone to a page they cannot open,
 *   3. a workbench tab shows work the engine would then refuse.
 * Each has a test below.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildNavigation, legacyNavigation, workspacesFor } from "@/lib/navigation/build";
import { resolveLandingRoute, isCourierOnly } from "@/lib/navigation/landing";
import { primaryRoleLabel, roleLabel, KNOWN_ROLE_CODES, ROLE_DISPLAY_PRIORITY } from "@/lib/navigation/roles";
import {
  buildWorkbench,
  classifyItem,
  actionableCount,
  WORKBENCH_TAB_ORDER,
  type WorkbenchItem,
} from "@/lib/navigation/workbench";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import { LEGACY_SECTIONS } from "@/lib/nav";
import { QUEUES } from "@/lib/process/queues/registry";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
});
const FLAGS_OFF = resolveProcessFlags({});

const ALL_PERMS = [
  "process:read",
  "collections:manage",
  "courier:deposit",
  "admin_service:manage",
  "transport:read",
  "customs:read",
  "document:read",
  "finance:read",
  "analytics:read",
  "file:read",
  "client:read",
  "communication:read",
  "admin:users:manage",
  "audit:read:all",
  "admin:config:manage",
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

const hrefs = (c: NavigationContext) =>
  buildNavigation(c).sections.flatMap((s) => s.items.map((i) => i.href));

/**
 * Phase 5.0E-3 — the queues and role panels left the permanent sidebar. They are the
 * user's own WORK, not navigation, so they live in Mon Travail. The authorization
 * rules did not change at all; only the placement did. Every assertion below that used
 * to read the sidebar for a queue now reads here, and means exactly the same thing.
 */
const workHrefs = (c: NavigationContext) => workspacesFor(c).map((w) => w.href);
const allReachable = (c: NavigationContext) => [...hrefs(c), ...workHrefs(c)];

// ------------------------------------------------------------- flag safety ----

describe("flag off — the sidebar is EXACTLY today's sidebar", () => {
  it("returns the legacy sections, in order, when workspaces are dark", () => {
    const nav = buildNavigation(ctx({ roleCodes: ["SYSTEM_ADMIN"], featureFlags: FLAGS_OFF }));
    expect(nav.sections.map((s) => s.key)).toEqual(LEGACY_SECTIONS.map((s) => s.key));
    expect(hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"], featureFlags: FLAGS_OFF }))).toEqual(
      LEGACY_SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
    );
  });

  it("emits no process route at all when the flag is off", () => {
    const h = hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"], featureFlags: FLAGS_OFF }));
    expect(h.some((x) => x.startsWith("/queues/"))).toBe(false);
    for (const r of ["/my-work", "/portfolio", "/collections", "/deposits", "/courier", "/transport-readiness"]) {
      expect(h).not.toContain(r);
    }
  });

  it("resolves NO session when the flag is off — the layout must stay static-safe", () => {
    // Regression guard. Making the root layout read cookies unconditionally broke
    // the static prerender of /login and /_not-found (the whole tree under a
    // cookie-reading layout becomes dynamic) AND undid the 5.0C promise that a
    // flag-off deployment does zero auth work in the layout. The flag MUST be
    // checked before getCurrentUser is ever called.
    const src = read("../lib/navigation/server.ts");
    const start = src.indexOf("export async function getNavigation(");
    expect(start, "getNavigation() not found").toBeGreaterThan(-1);
    const body = src.slice(start);
    // 5.0E-2A renamed this to globalKillSwitch() — same rule, clearer name: it is a
    // NECESSARY condition resolved without a session, never a sufficient one.
    const flagCheck = body.indexOf("globalKillSwitch");
    const authCall = body.indexOf("getNavigationContext");
    expect(flagCheck).toBeGreaterThan(-1);
    expect(authCall).toBeGreaterThan(-1);
    expect(flagCheck).toBeLessThan(authCall);
  });

  it("hands the legacy sections to the client UNFILTERED, as it always has", () => {
    // No session on the flag-off path => the server cannot filter => the client
    // applies canSeeNav, exactly as since Phase 2.0.
    expect(legacyNavigation().filtered).toBe(false);
    expect(legacyNavigation().sections).toEqual(LEGACY_SECTIONS);
    // ...whereas the role-aware path is always pre-filtered.
    expect(buildNavigation(ctx({ roleCodes: ["OPS_SUPERVISOR"] })).filtered).toBe(true);
  });

  it("the engine flag alone does NOT light up navigation", () => {
    const f = resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" });
    expect(hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"], featureFlags: f }))).not.toContain("/my-work");
  });

  it("a sub-flag never opens a route its parent flag has closed", () => {
    // Deposits require the deposit flag; collections require the collections flag.
    const noSub = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
    });
    const h = hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"], featureFlags: noSub }));
    expect(h).toContain("/my-work");
    expect(h).not.toContain("/deposits");
    expect(h).not.toContain("/collections");
  });
});

// ------------------------------------------------------------ role-driven nav ----

describe("the sidebar is role-driven, not a static list of every role", () => {
  it("puts NO operational role in the permanent sidebar", () => {
    // THE point of 5.0E-3. Even a SYSTEM_ADMIN — who staffs all fifteen queues — gets a
    // sidebar with zero queue links. A queue is work waiting on you; it is not a place.
    const admin = hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"] }));
    expect(admin.some((h) => h.startsWith("/queues/"))).toBe(false);
    for (const panel of ["/portfolio", "/collections", "/deposits", "/transport-readiness", "/courier"]) {
      expect(admin, panel).not.toContain(panel);
    }
  });

  it("never shows one specialist another specialist's queue (now in Mon Travail)", () => {
    const queues = workHrefs(ctx({ roleCodes: ["CUSTOMS_DECLARANT"] })).filter((h) =>
      h.startsWith("/queues/"),
    );
    expect(queues).toEqual(["/queues/customs_declaration"]);
  });

  it("gives a supervisor every queue — and a specialist exactly one", () => {
    const sup = workHrefs(ctx({ roleCodes: ["OPS_SUPERVISOR"] })).filter((h) => h.startsWith("/queues/"));
    expect(sup.length).toBe(QUEUES.filter((q) => q.roles.includes("OPS_SUPERVISOR")).length);
    expect(sup.length).toBeGreaterThan(10);
  });

  it("opens with PILOTAGE, and Mon Travail is always in it", () => {
    for (const role of ["CUSTOMS_DECLARANT", "ACCOUNT_MANAGER", "OPS_SUPERVISOR", "BILLING_OFFICER"]) {
      const nav = buildNavigation(ctx({ roleCodes: [role] }));
      expect(nav.sections[0].key, role).toBe("pilotage");
      expect(nav.sections[0].items.map((i) => i.href), role).toContain("/my-work");
    }
  });

  it("keeps the five sections in the agreed order, always", () => {
    const nav = buildNavigation(ctx({ roleCodes: ["SYSTEM_ADMIN"] }));
    expect(nav.sections.map((s) => s.key)).toEqual([
      "pilotage",
      "files",
      "departments",
      "management",
      "administration",
    ]);
  });

  it("does NOT give a Déclarant the control tower — it would be an empty page", () => {
    // A Déclarant holds no analytics:read. Linking them to /dashboard is how a user
    // decides the product is broken.
    const nav = buildNavigation(
      ctx({ roleCodes: ["CUSTOMS_DECLARANT"], permissions: ["process:read", "customs:read"] }),
    );
    const pilotage = nav.sections.find((s) => s.key === "pilotage")!;
    expect(pilotage.items.map((i) => i.href)).not.toContain("/dashboard");
    expect(pilotage.items.map((i) => i.href)).toContain("/my-work");
  });

  it("never offers /platform to a tenant administrator", () => {
    expect(hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"] })).some((h) => h.startsWith("/platform"))).toBe(false);
  });

  it("never links a staff user into the client portal", () => {
    expect(hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN"] })).some((h) => h.startsWith("/portal"))).toBe(false);
  });

  it("gives a platform or portal identity no staff sidebar at all", () => {
    expect(buildNavigation(ctx({ identityType: "platform" })).sections).toEqual([]);
    expect(buildNavigation(ctx({ identityType: "portal" })).sections).toEqual([]);
    expect(buildNavigation(ctx({ identityType: "driver" })).sections).toEqual([]);
  });

  it("emits no duplicate href — the 'Recouvrement' collision is gone", () => {
    const h = hrefs(ctx({ roleCodes: ["SYSTEM_ADMIN", "COLLECTIONS_OFFICER"] }));
    expect(new Set(h).size).toBe(h.length);
  });

  it("emits no duplicate label within a section", () => {
    const nav = buildNavigation(ctx({ roleCodes: ["SYSTEM_ADMIN", "COLLECTIONS_OFFICER"] }));
    for (const s of nav.sections) {
      const labels = s.items.map((i) => i.label);
      expect(new Set(labels).size, s.key).toBe(labels.length);
    }
  });

  it("keeps the department modules reachable (secondary, not deleted)", () => {
    const h = hrefs(ctx({ roleCodes: ["OPS_SUPERVISOR"] }));
    for (const d of ["documentation", "customs", "transport", "finance", "management"]) {
      expect(h).toContain(`/departments/${d}`);
    }
  });

  it("drops a section entirely when the user may see none of its items", () => {
    // process:read only: no analytics, no client:read, no file:read, no admin. Only
    // PILOTAGE survives, and inside it only Mon Travail and the Parcours.
    const nav = buildNavigation(ctx({ roleCodes: ["CUSTOMS_DECLARANT"], permissions: ["process:read"] }));
    expect(nav.sections.map((s) => s.key)).toEqual(["pilotage"]);
    expect(nav.sections[0].items.map((i) => i.href)).toEqual(["/my-work", "/journeys"]);
  });

  it("uses the canonical queue keys and labels in Mon Travail — never a re-declared one", () => {
    for (const w of workspacesFor(ctx({ roleCodes: ["SYSTEM_ADMIN"] }))) {
      if (w.kind !== "queue") continue;
      const key = w.href.replace("/queues/", "");
      const def = QUEUES.find((q) => q.key === key);
      expect(def, key).toBeDefined();
      expect(w.label).toBe(def!.labelFr);
    }
  });
});

// -------------------------------------------------------------- landing route ----

describe("role-driven landing (Deliverable 2)", () => {
  it("sends a coursier to their deposit runs, NOT to an empty dashboard", () => {
    // A COURIER holds no analytics:read, so the old unconditional redirect to
    // /dashboard gave them a blank page. As of 5.0E-3 they are a separate surface.
    expect(
      resolveLandingRoute(
        ctx({
          roleCodes: ["COURIER"],
          identityType: "courier",
          permissions: ["process:read", "courier:deposit"],
        }),
      ),
    ).toBe("/courier");
  });

  it("treats COURIER-only as a separate surface — but a COURIER who is also staff is staff", () => {
    expect(isCourierOnly(["COURIER"])).toBe(true);
    expect(isCourierOnly(["COURIER", "ADMINISTRATIVE_OFFICER"])).toBe(false);
    expect(isCourierOnly(["COURIER", "OPS_SUPERVISOR"])).toBe(false);
    expect(isCourierOnly(["ADMINISTRATIVE_OFFICER"])).toBe(false);

    // ...and the staff one keeps a real sidebar.
    const dual = buildNavigation(ctx({ roleCodes: ["COURIER", "ADMINISTRATIVE_OFFICER"] }));
    expect(dual.sections.length).toBeGreaterThan(0);
  });

  it("sends oversight roles to the control tower", () => {
    for (const role of ["COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]) {
      expect(resolveLandingRoute(ctx({ roleCodes: [role] })), role).toBe("/dashboard");
    }
  });

  it("sends an Account Manager to their portfolio and Collections to the aging balance", () => {
    expect(resolveLandingRoute(ctx({ roleCodes: ["ACCOUNT_MANAGER"] }))).toBe("/portfolio");
    expect(resolveLandingRoute(ctx({ roleCodes: ["COLLECTIONS_OFFICER"] }))).toBe("/collections");
  });

  it("sends every other operational role to the workbench", () => {
    for (const role of ["CUSTOMS_DECLARANT", "CHIEF_OF_TRANSIT", "TRANSPORT_OFFICER", "BILLING_OFFICER"]) {
      expect(resolveLandingRoute(ctx({ roleCodes: [role] })), role).toBe("/my-work");
    }
  });

  it("keeps the separate identity stacks apart", () => {
    expect(resolveLandingRoute(ctx({ identityType: "platform" }))).toBe("/platform");
    expect(resolveLandingRoute(ctx({ identityType: "driver" }))).toBe("/driver");
    expect(resolveLandingRoute(ctx({ identityType: "portal" }))).toBe("/portal");
  });

  it("falls back to today's landing when workspaces are dark", () => {
    expect(
      resolveLandingRoute(ctx({ roleCodes: ["OPS_SUPERVISOR"], featureFlags: FLAGS_OFF })),
    ).toBe("/dashboard");
  });

  it("never lands a user on a page they cannot read", () => {
    // A user with file:read but no analytics:read must not be sent to /dashboard.
    expect(
      resolveLandingRoute(
        ctx({ roleCodes: ["DOCUMENTATION_OFFICER"], permissions: ["file:read"], featureFlags: FLAGS_OFF }),
      ),
    ).toBe("/files");
  });

  it("ALWAYS lands the user on a route they can actually reach", () => {
    // The invariant that keeps a landing from bouncing into a 404 or stranding someone
    // on a page with no way back. After 5.0E-3 "reachable" means the sidebar OR Mon
    // Travail — because that is where the workspaces now live.
    const roles = [
      ["ACCOUNT_MANAGER"],
      ["COLLECTIONS_OFFICER"],
      ["CUSTOMS_DECLARANT"],
      ["OPS_SUPERVISOR"],
      ["SYSTEM_ADMIN"],
      ["CHIEF_OF_TRANSIT"],
      ["BILLING_OFFICER"],
      ["TRANSPORT_OFFICER"],
    ];
    for (const roleCodes of roles) {
      const c = ctx({ roleCodes });
      expect(allReachable(c), roleCodes.join()).toContain(resolveLandingRoute(c));
    }

    // The courier is the exception, deliberately: their landing IS their whole surface.
    const courier = ctx({ roleCodes: ["COURIER"], identityType: "courier" });
    expect(resolveLandingRoute(courier)).toBe("/courier");
    expect(buildNavigation(courier).sections).toEqual([]);
  });
});

// ------------------------------------------------------------------- identity ----

describe("role presentation (Deliverable 8) — never a raw role code", () => {
  it("labels every role code that exists in the seed", () => {
    const seed = read("../supabase/seed.sql");
    const codes = [...seed.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]);
    const roleCodes = codes.filter((c) => KNOWN_ROLE_CODES.includes(c));
    for (const c of new Set(roleCodes)) {
      expect(roleLabel(c), c).not.toBeNull();
    }
  });

  it("keeps the label table and the display priority in sync", () => {
    expect([...ROLE_DISPLAY_PRIORITY].sort()).toEqual([...KNOWN_ROLE_CODES].sort());
  });

  it("shows the job, not the privilege, when a user holds both", () => {
    // A Coordinator who is also SYSTEM_ADMIN reads as "Coordinateur".
    expect(primaryRoleLabel(["SYSTEM_ADMIN", "COORDINATOR"])).toBe("Coordinateur");
    expect(primaryRoleLabel(["SYSTEM_ADMIN"])).toBe("Administrateur système");
  });

  it("returns null rather than leaking an unknown code", () => {
    expect(roleLabel("NOT_A_ROLE")).toBeNull();
    expect(primaryRoleLabel(["NOT_A_ROLE"])).toBeNull();
  });

  it("prints no role code anywhere in the shell", () => {
    for (const f of ["../components/shell/sidebar.tsx", "../components/shell/topbar.tsx"]) {
      const src = read(f);
      for (const code of KNOWN_ROLE_CODES) {
        expect(src, `${f} must not print ${code}`).not.toContain(`"${code}"`);
      }
    }
  });
});

// ------------------------------------------------------------------ workbench ----

const item = (over: Partial<WorkbenchItem> = {}): WorkbenchItem =>
  ({
    executionId: `e${Math.round(over.priority?.score ?? 0)}${over.state ?? ""}${over.stepKey ?? ""}`,
    processInstanceId: "p1",
    fileId: "f1",
    fileNumber: "IMP-1",
    clientName: "Client",
    stepKey: "step",
    stepNumber: 1,
    stepLabel: "Étape",
    phase: null,
    department: "transit",
    requiredRole: null,
    assigneeId: null,
    handoffId: null,
    handoffSentBy: null,
    handoffSentAt: null,
    receptionRequired: false,
    received: true,
    isCorrection: false,
    state: "ACTIVE",
    submittedBy: null,
    ageHours: 1,
    sla: { policyKey: "", state: "unconfigured", label: "SLA non configuré" },
    missingPrerequisites: [],
    missingEvidenceCount: 0,
    blockerSummary: null,
    branches: { customsComplete: true, transportComplete: true, waitingOnOtherBranch: false },
    nextAction: "Traiter",
    nextRecipient: null,
    customerImpacting: false,
    priority: { score: 0, reasons: [], level: "normal" },
    queueKey: "transit",
    ...over,
  }) as WorkbenchItem;

describe("the workbench PARTITIONS work — every count is a real count", () => {
  it("puts each item in exactly one tab", () => {
    const items = [
      item({ receptionRequired: true, received: false, blockerSummary: "x", isCorrection: true }),
      item({ state: "SUBMITTED", submittedBy: "other" }),
      item({ state: "SUBMITTED", submittedBy: "u1" }),
      item({ isCorrection: true }),
      item({ blockerSummary: "missing BL" }),
      item({ state: "COMPLETED" }),
    ];
    const tabs = buildWorkbench(items, "u1");
    const total = tabs.reduce((n, t) => n + t.items.length, 0);
    expect(total).toBe(items.length);

    // ...and it is the tab we intend, not merely *a* tab.
    const where = (k: string) => tabs.find((t) => t.key === k)!.items.length;
    expect(where("to_receive")).toBe(1);
    expect(where("to_validate")).toBe(1);
    expect(where("to_forward")).toBe(1);
    expect(where("corrections")).toBe(1);
    expect(where("blocked")).toBe(1);
    expect(where("done")).toBe(1);
    expect(where("todo")).toBe(0);
  });

  it("routes a rejected step to Corrections, above a mere blocker", () => {
    expect(classifyItem(item({ isCorrection: true }), "u1")).toBe("corrections");
    expect(classifyItem(item({ isCorrection: true, blockerSummary: "x" }), "u1")).toBe("corrections");
  });

  it("ranks reception above everything — an unreceived handoff is where work goes quiet", () => {
    const i = item({
      receptionRequired: true,
      received: false,
      blockerSummary: "missing BL",
      branches: { customsComplete: false, transportComplete: true, waitingOnOtherBranch: true },
    });
    expect(classifyItem(i, "u1")).toBe("to_receive");
  });

  it("never asks a maker to validate their own submission", () => {
    // Maker-checker is enforced on IDENTITY by the engine. The workbench must not
    // even OFFER the work, or a supervisor would be sent to a button that refuses.
    expect(classifyItem(item({ state: "SUBMITTED", submittedBy: "u1" }), "u1")).toBe("to_forward");
    expect(classifyItem(item({ state: "SUBMITTED", submittedBy: "u2" }), "u1")).toBe("to_validate");
  });

  it("asks the maker to validate nothing even when the step is assigned to them", () => {
    const i = item({ state: "SUBMITTED", submittedBy: "u1", assigneeId: "u1" });
    expect(classifyItem(i, "u1")).toBe("to_forward");
  });

  it("leaves another person's named work off your bench", () => {
    expect(classifyItem(item({ assigneeId: "u2" }), "u1")).toBeNull();
    expect(classifyItem(item({ assigneeId: "u1" }), "u1")).toBe("todo");
    expect(classifyItem(item({ assigneeId: null }), "u1")).toBe("todo");
  });

  it("separates 'blocked on evidence' from 'waiting on the other branch'", () => {
    expect(
      classifyItem(
        item({
          blockerSummary: "gate",
          branches: { customsComplete: false, transportComplete: true, waitingOnOtherBranch: true },
        }),
        "u1",
      ),
    ).toBe("other_branch");
    expect(classifyItem(item({ blockerSummary: "missing BL" }), "u1")).toBe("blocked");
  });

  it("counts only work you can act on NOW in the badge", () => {
    const tabs = buildWorkbench(
      [
        item({ state: "ACTIVE" }), // todo        -> counted
        item({ blockerSummary: "x" }), // blocked -> NOT counted
        item({ state: "COMPLETED" }), // done     -> NOT counted
        item({
          branches: { customsComplete: false, transportComplete: true, waitingOnOtherBranch: true },
        }), // other branch                       -> NOT counted
      ],
      "u1",
    );
    expect(actionableCount(tabs)).toBe(1);
  });

  it("orders the tabs by urgency, not alphabetically", () => {
    expect(WORKBENCH_TAB_ORDER[0]).toBe("to_receive");
    expect(WORKBENCH_TAB_ORDER.at(-1)).toBe("done");
  });
});

// -------------------------------------------------------------- one builder ----

describe("there is exactly ONE navigation builder", () => {
  it("the old process-nav modules are gone", () => {
    const files = readdirSync(fileURLToPath(new URL("../lib/process/queues", import.meta.url)));
    expect(files).not.toContain("nav.ts");
    expect(files).not.toContain("nav-server.ts");
  });

  it("the sidebar makes no visibility decision of its own", () => {
    const src = read("../components/shell/sidebar.tsx");
    // It renders what the server hands it. No permission filtering, no role checks.
    expect(src).not.toContain("canSeeNav(item");
    expect(src).not.toContain("visibleQueues");
    expect(src).not.toMatch(/roles\.(has|includes)\(/);
  });

  it("only the root layout builds navigation", () => {
    const layout = read("../app/layout.tsx");
    expect(layout).toContain("getNavigation");
  });

  it("does not permanently place the 26 steps in the sidebar", () => {
    const nav = buildNavigation(ctx({ roleCodes: ["SYSTEM_ADMIN"] }));
    const items = nav.sections.flatMap((s) => s.items);
    // 15 queues + panels + modules — nowhere near 26 step links, and no /process route.
    expect(items.some((i) => i.href.includes("/process"))).toBe(false);
    expect(items.length).toBeLessThan(35);
  });
});
