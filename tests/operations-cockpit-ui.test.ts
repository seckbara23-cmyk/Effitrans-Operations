/**
 * Phase 10.0C — Centre d'Opérations cockpit UI. The summary projection is exercised DIRECTLY
 * (permission-shaping, counts-only, currency-safe); the server components and page are verified
 * STRUCTURALLY (consumes getOperationsCockpit, route unchanged, no parallel route, preserved
 * sections retained, currency never summed, no Caisse balance, no Realtime/polling/Copilot/
 * getExecutiveAnalytics/mutation, links resolve to real routes, French labels, empty/degraded states).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildCockpitSummary } from "@/lib/operations/compose";
import type {
  CockpitAlerts, CockpitFinance, CockpitKpis, CockpitMessaging, CockpitOperations, CockpitTransit,
} from "@/lib/operations/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const has = (p: string) => existsSync(fileURLToPath(new URL(p, import.meta.url)));

const OPS_DIR = "../components/operations/";
const CARD_FILES = [
  "cockpit-summary.tsx", "cockpit-attention-panel.tsx", "operations-queue-card.tsx",
  "transit-overview-card.tsx", "finance-pipeline-card.tsx", "workload-panel.tsx",
  "cockpit-section-shell.tsx", "cockpit-states.tsx",
];
const ALL_OPS_FILES = [
  ...CARD_FILES, "operations-cockpit-header.tsx", "cockpit-refresh.tsx", "cockpit-skeleton.tsx",
  "cockpit-sections.tsx", "dashboard-supporting.tsx",
];

const PAGE = code("../app/dashboard/page.tsx");
const SECTIONS = code(OPS_DIR + "cockpit-sections.tsx");
const SUPPORTING = code(OPS_DIR + "dashboard-supporting.tsx");
const READER = code("../lib/operations/reader.ts");

// ---- fixtures (partial section shapes; buildCockpitSummary only reads specific fields) --------
const opsOnly = (): CockpitOperations =>
  ({ files: { active: 5, overdueShipments: 2, highPriority: 1 }, tasks: { dueToday: 3, overdue: 4, mine: 1 }, processTower: null } as unknown as CockpitOperations);
const transitTransport = (): CockpitTransit =>
  ({ headline: { awaitingCustoms: 6, overdueOps: 4 }, cards: [], upcomingCount: 0, transportAuthorized: true, customs: null, customsAuthorized: false } as unknown as CockpitTransit);
const transitCustoms = (): CockpitTransit =>
  ({ headline: null, cards: [], upcomingCount: 0, transportAuthorized: false, customs: { total: 9, pending: 3, released: 5, inspection: 1, avgClearanceDays: 4 }, customsAuthorized: true } as unknown as CockpitTransit);
const financeOnly = (): CockpitFinance =>
  ({ invoices: null, revenueThisMonth: null, reconciliation: null, requests: { pendingReview: 2, approvedNotDisbursed: 1, returned: 0, evidenceMissing: 0, evidenceToVerify: 0, pendingAmounts: [], oldestRequestedAt: null, items: [] }, collectionsOpen: null, currency: "XOF" } as unknown as CockpitFinance);
const messaging = (unread: number): CockpitMessaging => ({ unread, summary: null });
const alerts = (critical: number): CockpitAlerts => ({ items: [], counts: { critical, high: 0, medium: 0, low: 0 } });
const kpis = (active: number): CockpitKpis => ({ executive: { activeDossiers: active } as unknown as CockpitKpis["executive"] });

const NONE = { operations: null, transit: null, finance: null, messaging: null, alerts: null, kpis: null };
const keys = (s: ReturnType<typeof buildCockpitSummary>) => s.map((i) => i.key);

// ================================================================ summary: permission-shaped ====
describe("buildCockpitSummary is permission-shaped — an absent section emits no indicator", () => {
  it("a viewer who can read nothing gets an EMPTY band (never a wall of zeros)", () => {
    expect(buildCockpitSummary(NONE)).toEqual([]);
  });
  it("operations-only → operations/task indicators, and NOTHING from transit/finance/messaging", () => {
    const s = keys(buildCockpitSummary({ ...NONE, operations: opsOnly() }));
    expect(s).toContain("activeFiles");
    expect(s).toContain("tasksToday");
    expect(s).toContain("overdueShipments");
    expect(s).not.toContain("awaitingCustoms");
    expect(s).not.toContain("financeRequests");
    expect(s).not.toContain("unread");
  });
  it("customs-only → 'en attente de douane' from the customs slice, NO transport-only overdueOps", () => {
    const s = buildCockpitSummary({ ...NONE, transit: transitCustoms() });
    const awaiting = s.find((i) => i.key === "awaitingCustoms");
    expect(awaiting?.value).toBe(3); // customs.pending
    expect(keys(s)).not.toContain("overdueOps"); // headline is null for a customs-only user
  });
  it("transport-only → awaitingCustoms + overdueOps from the headline, no finance", () => {
    const s = buildCockpitSummary({ ...NONE, transit: transitTransport() });
    expect(s.find((i) => i.key === "awaitingCustoms")?.value).toBe(6);
    expect(s.find((i) => i.key === "overdueOps")?.value).toBe(4);
    expect(keys(s)).not.toContain("financeRequests");
  });
  it("finance-only → actionable-request count (pendingReview + approvedNotDisbursed), nothing else", () => {
    const s = buildCockpitSummary({ ...NONE, finance: financeOnly() });
    expect(s.find((i) => i.key === "financeRequests")?.value).toBe(3);
    expect(keys(s)).not.toContain("activeFiles");
    expect(keys(s)).not.toContain("awaitingCustoms");
  });
  it("prefers the control-tower activeDossiers when analytics:read supplies it", () => {
    const s = buildCockpitSummary({ ...NONE, operations: opsOnly(), kpis: kpis(42) });
    expect(s.find((i) => i.key === "activeFiles")?.value).toBe(42); // kpis wins over files.active (5)
  });
  it("every summary value is a COUNT (a plain number) — never a currency-formatted string", () => {
    const s = buildCockpitSummary({ operations: opsOnly(), transit: transitTransport(), finance: financeOnly(), messaging: messaging(2), alerts: alerts(1), kpis: kpis(10) });
    expect(s.length).toBeGreaterThan(0);
    for (const i of s) expect(typeof i.value).toBe("number");
  });
});

// ================================================================ page composition ====
describe("page composition — /dashboard evolved in place over the composition layer (DEC-B29)", () => {
  it("the route still exists and keeps its identity", () => {
    expect(has("../app/dashboard/page.tsx")).toBe(true);
    expect(PAGE).toContain("t.dashboard.title");
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
  });
  it("consumes getOperationsCockpit() via CockpitSections", () => {
    expect(PAGE).toContain("CockpitSections");
    expect(SECTIONS).toContain("getOperationsCockpit");
  });
  it("no parallel cockpit route was created", () => {
    expect(has("../app/operations/page.tsx")).toBe(false);
    expect(has("../app/cockpit/page.tsx")).toBe(false);
    expect(has("../app/centre-operations/page.tsx")).toBe(false);
  });
  it("the sidebar entry « Centre d'opérations » still points at /dashboard (nav unchanged)", () => {
    const nav = read("../lib/nav.ts");
    expect(nav).toContain('label: "Centre d\'opérations", href: "/dashboard"');
  });
  it("streams with the /analytics Suspense pattern (independent loading boundaries)", () => {
    expect(PAGE).toContain("Suspense");
    expect(PAGE).toContain("CockpitSkeleton");
    expect(PAGE).toContain("CockpitSupportingSkeleton");
  });
});

describe("preserved sections are NOT silently removed (disposition table)", () => {
  const whole = SECTIONS + SUPPORTING;
  it("every preserved dashboard section is still rendered somewhere in the cockpit composition", () => {
    for (const comp of [
      "ProcessTowerSection", "ControlTower", "DashboardTasks", "DepartmentCards",
      "RecentActivity", "AdminPresenceCard", "DashboardRecentFiles", "MessagingSummaryCard", "DashboardBreakdown",
    ]) {
      expect(whole, comp).toContain(comp);
    }
  });
  it("the management ControlTower is preserved through its existing reader", () => {
    expect(SUPPORTING).toContain("getControlTower");
    expect(SUPPORTING).toContain("<ControlTower data={controlTower} />");
  });
});

// ================================================================ transit permission boundary ====
describe("transit degrades per-permission — no unauthorized data merged under a 'Transit' card", () => {
  it("the reader sources customs INDEPENDENTLY (customs:read), not only via transport:read", () => {
    expect(READER).toContain('canCustoms = hasPermission(perms, "customs:read")');
    expect(READER).toContain("canCustoms ? getIntelligenceDashboard() : none");
    expect(READER).toContain("cc || customsDash"); // present when EITHER is authorized
  });
  it("the transit card shows mode cards for transport, else the authorized customs figures", () => {
    const transit = code(OPS_DIR + "transit-overview-card.tsx");
    expect(transit).toContain("transit.transportAuthorized");
    expect(transit).toContain("transit.customs");
    // customs mode card marked unauthorized unless customs:read
    expect(transit).toContain("!transit.customsAuthorized");
  });
});

// ================================================================ finance currency rules ====
describe("finance widget — currency is per-currency, never summed; no fake Caisse balance", () => {
  const fin = code(OPS_DIR + "finance-pipeline-card.tsx");
  it("renders pending amounts PER CURRENCY (maps the array) and never reduces/sums them", () => {
    expect(fin).toContain("req.pendingAmounts.map");
    expect(fin).not.toMatch(/pendingAmounts[\s\S]{0,40}\.reduce\(/);
    expect(fin).toContain("money(a.amount, a.currency)");
  });
  it("shows the finance-request lifecycle states", () => {
    for (const f of ["pendingReview", "approvedNotDisbursed", "evidenceToVerify", "evidenceMissing", "returned"]) {
      expect(fin, f).toContain(`req.${f}`);
    }
  });
  it("no cockpit component fabricates a Caisse / treasury / cash balance", () => {
    // Comment-stripped: a comment explaining we deliberately show NO caisse balance is fine.
    for (const f of ALL_OPS_FILES) {
      const src = code(OPS_DIR + f).toLowerCase();
      expect(src, f).not.toContain("caisse");
      expect(src, f).not.toContain("solde");
      expect(src, f).not.toContain("trésorerie");
    }
  });
});

// ================================================================ workload privacy ====
describe("workload panel — coordination data, not a performance score (DEC-B30)", () => {
  const wl = code(OPS_DIR + "workload-panel.tsx");
  it("renders named rows by display name only — never the raw user id as visible text", () => {
    expect(wl).toContain("label: u.displayName"); // display name is the visible label
    expect(wl).toContain("key: u.userId"); // id flows only into the React key (WorkloadBars key={r.key})
    expect(wl).not.toMatch(/>\s*\{u\.userId\}\s*</); // never rendered as content
  });
  it("uses coordination language and no ranking / best-worst / performance wording", () => {
    const src = code(OPS_DIR + "workload-panel.tsx").toLowerCase();
    expect(src).toContain("coordination");
    expect(src).not.toContain("classement");
    expect(src).not.toContain("performance");
    expect(src).not.toContain("meilleur");
  });
  it("named rows appear only when the reader supplies byUser (the UI never forces them)", () => {
    expect(wl).toContain("workload.byUser &&");
  });
});

// ================================================================ attention ====
describe("attention panel — normalized alerts, bounded, empty state, no 10.0E code adapters", () => {
  const att = code(OPS_DIR + "cockpit-attention-panel.tsx");
  it("renders severity by label + dot (not colour alone) and links each alert", () => {
    expect(att).toContain("LEVEL_LABEL");
    expect(att).toContain("LEVEL_DOT");
    expect(att).toContain("href={a.href}");
  });
  it("bounds the primary list and has a truthful empty state", () => {
    expect(att).toContain("PRIMARY_CAP");
    expect(att).toContain("CockpitEmptyState");
  });
  it("does not introduce the DEC-B34 code? field (deferred to 10.0E)", () => {
    expect(att).not.toMatch(/a\.code\b/);
  });
});

// ================================================================ doctrine / safety ====
describe("cockpit doctrine — no Realtime, polling, Copilot, legacy analytics or mutations in the UI", () => {
  it("no Realtime channel/subscription in any cockpit component", () => {
    for (const f of ALL_OPS_FILES) {
      expect(read(OPS_DIR + f), f).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes/);
    }
  });
  it("no polling loop (setInterval) in any cockpit component — refresh is on-demand only", () => {
    for (const f of ALL_OPS_FILES) {
      expect(read(OPS_DIR + f), f).not.toContain("setInterval");
    }
    // The refresh control re-runs the existing server request; it is not a poll.
    expect(read(OPS_DIR + "cockpit-refresh.tsx")).toContain("router.refresh()");
  });
  it("no Copilot surface and no getExecutiveAnalytics adoption (DEC-B32 / DEC-B33)", () => {
    for (const f of ALL_OPS_FILES) {
      const src = read(OPS_DIR + f);
      expect(src, f).not.toContain("copilot");
      expect(src, f).not.toContain("getExecutiveAnalytics");
      expect(src, f).not.toContain("operations:copilot:read");
    }
  });
  it("presentational cards perform NO data read — no supabase client, no domain reader import", () => {
    for (const f of CARD_FILES) {
      const src = read(OPS_DIR + f);
      expect(src, f).not.toContain("getAdminSupabaseClient");
      expect(src, f).not.toContain("scopedFrom");
      expect(src, f).not.toMatch(/from "@\/lib\/supabase/);
    }
  });
  it("no cockpit component mutates (no insert/update/delete, no server action, no revalidate)", () => {
    for (const f of ALL_OPS_FILES) {
      const src = read(OPS_DIR + f);
      expect(src, f).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      expect(src, f).not.toContain('"use server"');
      expect(src, f).not.toContain("revalidatePath");
    }
  });
  it("CockpitSections consumes ONLY the composition layer (no direct table read)", () => {
    expect(SECTIONS).not.toContain("getAdminSupabaseClient");
    expect(SECTIONS).not.toContain("scopedFrom");
    expect(SECTIONS).not.toMatch(/\.from\(/);
  });
});

// ================================================================ UX: routes + labels + states ====
describe("UX — links resolve to real routes, French labels, empty/degraded states", () => {
  it("every static href in the cockpit cards points at an existing app route", () => {
    const sources = [
      "operations-queue-card.tsx", "transit-overview-card.tsx", "finance-pipeline-card.tsx",
    ].map((f) => read(OPS_DIR + f)).join("\n") + read("../lib/operations/compose.ts");
    const paths = new Set<string>();
    for (const m of sources.matchAll(/["'`](\/[a-zA-Z0-9/_-]+)(\?[^"'`]*)?["'`]/g)) paths.add(m[1]);
    expect(paths.size).toBeGreaterThan(3);
    for (const p of paths) {
      const segs = p.split("/").filter(Boolean);
      // Resolve /a/b → app/a/b/page.tsx (all cockpit hrefs are static, no dynamic segments).
      const routeFile = `../app/${segs.join("/")}/page.tsx`;
      expect(has(routeFile), `${p} → ${routeFile}`).toBe(true);
    }
  });
  it("uses the ratified French terminology", () => {
    // Vocabulary presence, case-insensitive (the words matter, not their capitalisation).
    const all = ALL_OPS_FILES.map((f) => read(OPS_DIR + f)).join("\n").toLowerCase();
    for (const term of ["opérations", "transit", "finance", "à traiter", "en attente", "en retard", "charge de travail", "attention requise"]) {
      expect(all, term).toContain(term);
    }
  });
  it("no unapproved English UI noun leaks into a rendered label", () => {
    const all = ALL_OPS_FILES.map((f) => read(OPS_DIR + f)).join("\n");
    for (const bad of [">Dashboard<", ">Workload<", ">Overview<", ">Attention<"]) {
      expect(all, bad).not.toContain(bad);
    }
  });
  it("distinguishes empty (authorized, zero) from unavailable (feature dark)", () => {
    const states = read(OPS_DIR + "cockpit-states.tsx");
    expect(states).toContain("CockpitEmptyState");
    expect(states).toContain("CockpitUnavailableState");
    // Finance uses the UNAVAILABLE state when the request pipeline is dark (migration absent).
    expect(read(OPS_DIR + "finance-pipeline-card.tsx")).toContain("CockpitUnavailableState");
  });
  it("the summary band stacks to two columns on mobile (no horizontal scroll for primary widgets)", () => {
    expect(read(OPS_DIR + "cockpit-summary.tsx")).toContain("grid-cols-2");
  });
});
