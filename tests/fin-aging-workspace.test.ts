/**
 * FIN-AGING-3 — the read-only Aging Balance workspace.
 *
 * Two properties carry this phase, and both are easy to lose by accident:
 *
 *   * THE FIVE TABS MUST NOT DISAGREE. They are projections of one view model,
 *     so the way they drift apart is a component quietly re-aggregating
 *     something "just for the chart". The tests below re-derive every tab from
 *     the engine and assert equality, and separately assert that no component
 *     contains arithmetic over money.
 *
 *   * OPENING A PAGE MUST NOT WRITE. A report is a deliberate, permissioned act
 *     arriving in a later phase; a page view is not that act. The read service
 *     is asserted to contain nothing but selects.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUCKET_KEYS,
  RISK_LABEL_FR,
  buildAgingReport,
  isoDate,
  money,
  sum,
} from "@/lib/finance/aging";
import {
  AVERAGE_DELAY_NOTE,
  EXCLUSION_LABEL_FR,
  PROVENANCE_LABEL_FR,
  dossierLabel,
  filterRows,
  formatAmount,
  formatDateFr,
  formatDateLongFr,
  formatDays,
  formatShare,
  hasActiveFilters,
} from "@/lib/finance/aging/presentation";
import {
  ARRETE,
  CURRENCY,
  M,
  TENANT,
  dueDaysBeforeArrete,
  invoice,
  payment,
  portfolio,
} from "./fixtures/aging-synthetic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/finance/aging/page.tsx";
const WORKSPACE = "components/finance/aging/aging-workspace.tsx";
const CHARTS = "components/finance/aging/aging-charts.tsx";
const SERVICE = "lib/finance/aging/server/read-service.ts";

const vm = () =>
  buildAgingReport(portfolio(), { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY });

// ===========================================================================
describe("the five views reconcile to one report", () => {
  it("dashboard, buckets, clients and charts all state the same total", () => {
    const r = vm();
    const rowTotal = sum(r.rows.map((x) => x.outstanding));
    expect(r.kpis.totalOutstanding).toBe(rowTotal);
    expect(sum(r.buckets.map((b) => b.amount))).toBe(rowTotal);
    expect(sum(r.clients.map((c) => c.amount))).toBe(rowTotal);
    expect(sum(r.charts.bucketAmounts.values.map((v) => money(v)))).toBe(rowTotal);
  });

  it("critical totals equal the > 365 bucket and the « Montant > 1 an » card", () => {
    const r = vm();
    const over = r.buckets.find((b) => b.bucket === "OVER_365")!;
    expect(r.criticalTotal.amount).toBe(over.amount);
    expect(r.criticalTotal.invoiceCount).toBe(over.invoiceCount);
    expect(r.kpis.amountOverOneYear).toBe(r.criticalTotal.amount);
  });

  it("top-client ordering is exactly the engine's ranking", () => {
    const r = vm();
    expect(r.charts.topClients.categories).toEqual(r.clients.slice(0, 10).map((c) => c.clientName));
    expect(r.charts.topClients.values).toEqual(r.clients.slice(0, 10).map((c) => c.amount as number));
  });

  it("chart categories are the bucket table's labels, in the same order", () => {
    const r = vm();
    expect(r.charts.bucketAmounts.categories).toEqual(r.buckets.map((b) => b.labelFr));
    expect(r.charts.bucketShares.categories).toEqual(r.buckets.map((b) => b.labelFr));
    expect(r.buckets.map((b) => b.bucket)).toEqual([...BUCKET_KEYS]);
  });

  it("the engine's own reconciliation passes for the workspace fixture", () => {
    expect(vm().reconciliation.every((c) => c.ok)).toBe(true);
  });
});

// ===========================================================================
describe("filters select rows; they never change a total", () => {
  it("filtering the table leaves every aggregate untouched", () => {
    const r = vm();
    const before = {
      total: r.kpis.totalOutstanding,
      buckets: r.buckets.map((b) => b.amount),
      clients: r.clients.map((c) => c.amount),
      critical: r.criticalTotal.amount,
    };
    const shown = filterRows(r.rows, { risk: "CRITIQUE" });
    expect(shown.length).toBeLessThan(r.rows.length);
    // The view model object is untouched — filtering returns a new array.
    expect(r.kpis.totalOutstanding).toBe(before.total);
    expect(r.buckets.map((b) => b.amount)).toEqual(before.buckets);
    expect(r.clients.map((c) => c.amount)).toEqual(before.clients);
    expect(r.criticalTotal.amount).toBe(before.critical);
  });

  it("every filter narrows on the stated field only", () => {
    const r = vm();
    expect(filterRows(r.rows, { disputedOnly: true }).every((x) => x.disputed)).toBe(true);
    expect(filterRows(r.rows, { bucket: "OVER_365" }).every((x) => x.bucket === "OVER_365")).toBe(true);
    const someClient = r.rows[0].clientId;
    expect(filterRows(r.rows, { clientId: someClient }).every((x) => x.clientId === someClient)).toBe(true);
  });

  it("search matches invoice, client and either dossier reference", () => {
    const r = vm();
    const row = r.rows[0];
    expect(filterRows(r.rows, { search: row.invoiceNumber }).map((x) => x.invoiceId)).toContain(row.invoiceId);
    expect(filterRows(r.rows, { search: row.clientName.toLowerCase() }).length).toBeGreaterThan(0);
    expect(filterRows(r.rows, { search: "zzz-not-present" })).toHaveLength(0);
  });

  it("no filter is the identity", () => {
    const r = vm();
    expect(filterRows(r.rows, {})).toHaveLength(r.rows.length);
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ disputedOnly: true })).toBe(true);
    expect(hasActiveFilters({ search: "   " })).toBe(false);
  });

  it("the UI states how many of how many rows a filtered table shows", () => {
    // A filtered table that looks like the whole portfolio is a reporting error.
    const w = code(WORKSPACE);
    expect(w).toContain("facture(s) affichée(s)");
    expect(w).toMatch(/formatInteger\(visibleRows\.length\)/);
    expect(w).toMatch(/formatInteger\(rows\.length\)/);
    expect(w).toContain("Réinitialiser les filtres");
  });
});

// ===========================================================================
describe("aging rules survive the trip through the workspace", () => {
  it("365 is excluded from critical, 366 is included", () => {
    const r = buildAgingReport(
      [
        invoice({ dueDate: dueDaysBeforeArrete(365), originalAmount: M(100_000), invoiceNumber: "A-365" }),
        invoice({ dueDate: dueDaysBeforeArrete(366), originalAmount: M(200_000), invoiceNumber: "A-366" }),
      ],
      { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY },
    );
    expect(r.critical.map((x) => x.invoiceNumber)).toEqual(["A-366"]);
    expect(r.criticalTotal.amount).toBe(M(200_000));
  });

  it("future and due-today invoices stay Non échu", () => {
    const r = buildAgingReport(
      [
        invoice({ dueDate: dueDaysBeforeArrete(0), invoiceNumber: "T-0" }),
        invoice({ dueDate: dueDaysBeforeArrete(-15), invoiceNumber: "T-F" }),
      ],
      { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY },
    );
    expect(r.rows.every((x) => x.bucket === "NON_ECHU")).toBe(true);
    expect(r.kpis.overdueAmount).toBe(0);
  });

  it("fully settled invoices are absent and post-arrêté payments are ignored", () => {
    const r = buildAgingReport(
      [
        invoice({
          dueDate: dueDaysBeforeArrete(40), originalAmount: M(500_000), invoiceNumber: "S-1",
          allocations: [payment(500_000, "2026-05-01")],
        }),
        invoice({
          dueDate: dueDaysBeforeArrete(40), originalAmount: M(500_000), invoiceNumber: "S-2",
          allocations: [payment(500_000, "2026-07-01")], // AFTER the arrêté
        }),
      ],
      { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY },
    );
    expect(r.rows.map((x) => x.invoiceNumber)).toEqual(["S-2"]);
    expect(r.rows[0].outstanding).toBe(M(500_000));
  });

  it("client risk floors at Faible — there is no client-level « Non échu »", () => {
    const r = buildAgingReport(
      [invoice({ dueDate: dueDaysBeforeArrete(-40), clientId: "c1", clientName: "Client Un" })],
      { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY },
    );
    expect(r.clients[0].risk).toBe("FAIBLE");
    expect(r.rows[0].risk).toBe("NON_ECHU"); // row level is unaffected
  });

  it("foreign-currency rows are excluded, counted, and never converted", () => {
    const r = vm();
    const foreign = r.exclusions.filter((e) => e.reason === "FOREIGN_CURRENCY");
    expect(foreign.length).toBe(1);
    expect(foreign[0].currency).toBe("EUR");
    expect(code(SERVICE)).not.toMatch(/exchange|convert|fx_rate/i);
    // …and the UI surfaces the reason rather than hiding it.
    expect(EXCLUSION_LABEL_FR.FOREIGN_CURRENCY).toMatch(/[Dd]evise/);
    expect(code(WORKSPACE)).toContain("Créances exclues du calcul");
  });
});

// ===========================================================================
describe("Q-04 is disclosed, not hidden", () => {
  it("the population travels in the view model", () => {
    expect(vm().kpis.averageDelayPopulation).toBe("ALL_ROWS");
  });

  it("both populations have an explanatory note the UI can show", () => {
    expect(AVERAGE_DELAY_NOTE.ALL_ROWS).toMatch(/non échues/);
    expect(AVERAGE_DELAY_NOTE.OVERDUE_ONLY).toMatch(/exclues/);
    for (const n of Object.values(AVERAGE_DELAY_NOTE)) expect(n.length).toBeGreaterThan(60);
  });

  it("the KPI card renders the note as its tooltip, and the choice is NOT hard-coded in the component", () => {
    const w = code(WORKSPACE);
    expect(w).toContain("AVERAGE_DELAY_NOTE[kpis.averageDelayPopulation]");
    expect(w).not.toMatch(/averageDelayPopulation\s*=\s*"/);
  });

  it("the route reads it from the query with the ratified default", () => {
    const p = code(PAGE);
    expect(p).toContain('searchParams?.population === "OVERDUE_ONLY" ? "OVERDUE_ONLY" : "ALL_ROWS"');
  });
});

// ===========================================================================
describe("dossier and legacy reference behaviour", () => {
  it("shows the platform dossier when there is one", () => {
    const r = vm();
    const row = r.rows.find((x) => x.dossierReference)!;
    expect(dossierLabel(row)).toEqual({ text: row.dossierReference, legacy: false });
  });

  it("falls back to the preserved external reference, and marks it as inherited", () => {
    const legacy = invoice({
      dueDate: dueDaysBeforeArrete(500),
      dossierReference: null,
      externalDossierReference: "DOSSIER-LEGACY-2019-044",
      source: "OPENING_IMPORT",
    });
    const r = buildAgingReport([legacy], { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY });
    expect(dossierLabel(r.rows[0])).toEqual({ text: "DOSSIER-LEGACY-2019-044", legacy: true });
    expect(code(WORKSPACE)).toContain("réf. héritée");
  });

  it("never manufactures a dossier", () => {
    const r = buildAgingReport(
      [invoice({ dueDate: dueDaysBeforeArrete(10), dossierReference: null, externalDossierReference: null })],
      { tenantId: TENANT, reportingDate: ARRETE, currency: CURRENCY },
    );
    expect(dossierLabel(r.rows[0])).toEqual({ text: "—", legacy: false });
    expect(code(SERVICE)).not.toMatch(/insert into|\.insert\(/);
  });

  it("provenance is displayed with a French label", () => {
    expect(PROVENANCE_LABEL_FR.OPENING_IMPORT).toBe("Reprise historique");
    expect(code(WORKSPACE)).toContain("PROVENANCE_LABEL_FR");
  });
});

// ===========================================================================
describe("the workspace writes NOTHING", () => {
  it("the read service performs only selects", () => {
    const s = code(SERVICE);
    for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(s, forbidden).not.toContain(forbidden);
    }
  });

  it("no aging_report row is created by opening the page", () => {
    for (const p of [SERVICE, PAGE, WORKSPACE]) {
      expect(code(p), p).not.toContain("aging_report");
    }
  });

  it("the page and its components declare no server action", () => {
    for (const p of [PAGE, WORKSPACE, CHARTS]) {
      expect(read(p), p).not.toContain('"use server"');
    }
    expect(code(WORKSPACE)).not.toMatch(/<form/);
  });

  it("the client bundle holds no service-role credential", () => {
    for (const p of [WORKSPACE, CHARTS]) {
      for (const bad of ["getAdminSupabaseClient", "SERVICE_ROLE", "service_role"]) {
        expect(code(p), `${p} / ${bad}`).not.toContain(bad);
      }
    }
  });
});

// ===========================================================================
describe("calculations stay out of the components", () => {
  it("no component sums, averages or re-buckets money", () => {
    for (const p of [WORKSPACE, CHARTS]) {
      const s = code(p);
      // The engine's helpers are the only legitimate aggregation, and they are
      // not imported here at all.
      expect(s, p).not.toContain("buildAgingReport");
      expect(s, p).not.toMatch(/\.reduce\([^)]*outstanding/);
      expect(s, p).not.toMatch(/daysOverdue\s*[+\-*/]/);
      expect(s, p).not.toMatch(/classifyDays|clientRisk|isCritical|balanceAsOf/);
    }
  });

  it("charts receive a finished series and only draw it", () => {
    const c = code(CHARTS);
    expect(c).toMatch(/series\.values/);
    expect(c).not.toMatch(/\.filter\(/);
    expect(c).not.toMatch(/\.sort\(/);
  });

  it("the risk band is grouped from the engine's bucket aggregates, not from rows", () => {
    const w = code(WORKSPACE);
    const block = w.slice(w.indexOf("const riskSegments"), w.indexOf("const clientOptions"));
    expect(block).toContain("for (const b of buckets)");
    expect(block).not.toContain("rows");
  });

  it("the pure engine still imports nothing but itself", () => {
    for (const f of ["money.ts", "dates.ts", "buckets.ts", "balance.ts", "share.ts", "report.ts", "types.ts"]) {
      const src = read(`lib/finance/aging/${f}`);
      for (const spec of [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])) {
        expect(spec.startsWith("./"), `${f} imports ${spec}`).toBe(true);
      }
    }
  });

  it("the presentation module formats but never aggregates", () => {
    const s = code("lib/finance/aging/presentation.ts");
    expect(s).not.toMatch(/\.reduce\(/);
    expect(s).not.toContain("buildAgingReport");
  });
});

// ===========================================================================
describe("permission enforcement", () => {
  it("the route requires finance:aging:read, before any data is read", () => {
    const p = code(PAGE);
    const gate = p.indexOf('hasPermission(permissions, "finance:aging:read")');
    const readData = p.indexOf("getAgingReportView(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(readData);
  });

  it("access is decided by permission, never by role name", () => {
    const p = code(PAGE);
    for (const role of ["DAF", "DGA", "FINANCE_OFFICER", "SYSTEM_ADMIN", "ACCOUNTANT", "CEO"]) {
      expect(p, role).not.toContain(`"${role}"`);
    }
    expect(code(WORKSPACE)).not.toMatch(/roles\.(includes|indexOf)/);
  });

  it("the entry point is the Finance hub tile, gated on the same permission", () => {
    // NOT a sidebar entry: the ratified realignment fixed DÉPARTEMENTS at exactly
    // three (Opérations, Transit, Finance), with workspaces reached from their
    // department hub — as Douane, Transport, Documentation and Caisse already are.
    const hub = code("app/departments/finance/page.tsx");
    expect(hub).toMatch(/label: "Balance âgée"[\s\S]{0,200}permission: "finance:aging:read"/);
    expect(code("lib/nav.ts")).not.toContain("/finance/aging");
  });

  it("the hub tile ALSO respects the kill switch, so it cannot link to a 404", () => {
    // A permission-only tile over a flag-gated route is the WES-3A.6 defect.
    const hub = code("app/departments/finance/page.tsx");
    expect(hub).toContain("const agingEnabled = agingWorkspaceEnabled();");
    expect(hub).toMatch(/label: "Balance âgée"[\s\S]{0,200}available: agingEnabled/);
  });

  it("DÉPARTEMENTS holds only departments — « Balance âgée » stays a workspace", () => {
    // PIN MOVED (TMS-5B, 2026-08-18): Transport became a DEPARTMENT by business
    // decision, so the section holds four. The point this case makes is unchanged:
    // a WORKSPACE never earns a top-level entry.

    const nav = code("lib/nav.ts");
    const section = nav.slice(nav.indexOf('key: "departments"'), nav.indexOf('key: "management"'));
    const labels = [...section.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["Départements", "Opérations", "Transit", "Transport", "Finance"]);
  });

  it("the env kill switch 404s the route rather than refusing it", () => {
    // A 404 leaks nothing about what is being built.
    const p = code(PAGE);
    expect(p).toContain("if (!agingWorkspaceEnabled()) notFound();");
    expect(p.indexOf("agingWorkspaceEnabled()")).toBeLessThan(p.indexOf("requireUser()"));
    expect(code("lib/finance/aging/rollout.ts")).toContain('=== "true"');
  });

  it("follow-up notes need collections:manage, not merely aging read", () => {
    expect(code(PAGE)).toContain('hasPermission(permissions, "collections:manage")');
    expect(code(WORKSPACE)).toContain("canReadFollowUps");
  });
});

// ===========================================================================
describe("FIN-AGING-3A — the flag × permission matrix", () => {
  // Four combinations, one outcome. The route reads the flag FIRST and 404s, so
  // the two lower-left cases are indistinguishable from a route that does not
  // exist — which is the point.
  const page = () => code(PAGE);

  it("flag OFF — the route 404s before authentication is even attempted", () => {
    const p = page();
    const flag = p.indexOf("if (!agingWorkspaceEnabled()) notFound();");
    expect(flag).toBeGreaterThan(-1);
    // Compare against the CALL SITES, not the imports at the top of the file.
    expect(flag).toBeLessThan(p.indexOf("await requireUser()"));
    expect(flag).toBeLessThan(p.indexOf("await getEffectivePermissions("));
  });

  it("flag ON + permission OFF — a refusal, not a blank page and not data", () => {
    const p = page();
    const gate = p.indexOf('!hasPermission(permissions, "finance:aging:read")');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(p.indexOf("getAgingReportView("));
    expect(p).toContain("Vous n&apos;avez pas l&apos;autorisation de consulter la balance âgée.");
  });

  it("flag ON + permission ON is the ONLY combination that reads data", () => {
    const p = page();
    // Both gates precede the single call that touches Finance records.
    const read = p.indexOf("getAgingReportView(");
    expect(p.indexOf("agingWorkspaceEnabled()")).toBeLessThan(read);
    expect(p.indexOf('hasPermission(permissions, "finance:aging:read")')).toBeLessThan(read);
  });

  it("the hub tile needs BOTH as well — permission alone would link to a 404", () => {
    const hub = code("app/departments/finance/page.tsx");
    expect(hub).toMatch(/label: "Balance âgée"[\s\S]{0,220}available: agingEnabled/);
    expect(hub).toContain("hasPermission(permissions, l.permission) && l.available !== false");
  });

  it("the flag fails closed — anything but the literal \"true\" is off", () => {
    expect(code("lib/finance/aging/rollout.ts"))
      .toContain('process.env.EFFITRANS_FINANCE_AGING_ENABLED === "true"');
  });
});

// ===========================================================================
describe("FIN-AGING-3A — sorting is a way of looking, not of counting", () => {
  it("sorting changes the ORDER of displayed rows and nothing else", () => {
    const r = vm();
    const w = code(WORKSPACE);
    // The sort helper copies before sorting — the report's own array is never
    // mutated, which is what keeps every other tab stable.
    expect(w).toContain("return [...rows].sort(");
    expect(w).toMatch(/const visibleRows = useMemo\(\(\) => sortRows\(filterRows\(rows, filters\), sort\)/);
    // Totals are read straight off the view model, never off visibleRows.
    expect(w).not.toMatch(/visibleRows[\s\S]{0,40}reduce/);
    expect(r.kpis.totalOutstanding).toBe(sum(r.rows.map((x) => x.outstanding)));
  });

  it("ordering is total — ties break on invoice number, so it cannot reshuffle", () => {
    expect(code(WORKSPACE)).toContain('a.invoiceNumber.localeCompare(b.invoiceNumber, "fr")');
  });

  it("a third click returns to the engine's canonical order", () => {
    expect(code(WORKSPACE)).toMatch(/dir === "asc" \? \{ key: sortKey, dir: "desc" \} : null/);
  });

  it("sortable headings announce their state with aria-sort", () => {
    const w = code(WORKSPACE);
    expect(w).toContain('aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}');
  });
});

// ===========================================================================
describe("FIN-AGING-3A — accessibility", () => {
  it("the tab strip implements the FULL ARIA pattern, not half of it", () => {
    // role="tab" without a tabpanel, aria-controls or arrow keys announces a
    // widget and then fails to behave like one — worse than plain buttons.
    const w = code(WORKSPACE);
    expect(w).toContain('role="tablist"');
    expect(w).toContain('role="tabpanel"');
    expect(w).toContain('aria-controls="aging-tabpanel"');
    expect(w).toContain("aria-labelledby={`aging-tab-${tab}`}");
    expect(w).toContain("tabIndex={tab === t.key ? 0 : -1}"); // roving tabindex
    expect(w).toContain('e.key === "ArrowRight"');
    expect(w).toContain('e.key === "ArrowLeft"');
  });

  it("SVG charts carry a text alternative — role=img hides their contents", () => {
    const c = code(CHARTS);
    expect(c).toContain("function ChartDataTable");
    expect((c.match(/<ChartDataTable/g) ?? []).length).toBe(2); // the two SVG charts
    expect(c).toContain('<table className="sr-only">');
    expect(c).toContain('<th scope="row">');
  });

  it("the top-clients chart is NOT labelled an image — it is real text", () => {
    const c = code(CHARTS);
    const fn = c.slice(c.indexOf("export function TopClientsChart"));
    expect(fn).not.toContain('role="img"');
    expect(fn).toContain('aria-label="Principaux clients par encours"');
  });

  it("no body text sits at slate-400 (about 2.8:1 on white — below 4.5:1)", () => {
    for (const p of [WORKSPACE, CHARTS]) {
      expect(code(p), p).not.toContain("text-slate-400");
    }
  });

  it("interactive controls have a visible focus ring", () => {
    const w = code(WORKSPACE);
    expect((w.match(/focus-visible:ring/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("long tables keep their headings visible while scrolling", () => {
    expect(code(WORKSPACE)).toMatch(/<thead className="sticky top-0/);
  });

  it("every table is captioned and column-scoped", () => {
    const w = code(WORKSPACE);
    expect((w.match(/<caption className="sr-only">/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((w.match(/scope="col"/g) ?? []).length).toBeGreaterThan(15);
  });
});

// ===========================================================================
describe("FIN-AGING-3A — the synthetic preview dataset", () => {
  const DATASET = "supabase/demo/aging_preview_dataset.sql";
  const sql = () => read(DATASET);

  it("exists and shouts that it is preview-only", () => {
    expect(sql()).toContain("NEVER RUN THIS AGAINST PRODUCTION");
  });

  it("writes ONLY into its own demo tenant", () => {
    const s = sql();
    const tenants = [...s.matchAll(/tenant_id\s*=\s*'([0-9a-f-]{36})'/g)].map((m) => m[1]);
    for (const t of tenants) expect(t).toBe("00000000-0000-0000-0000-00000000de00");
    // …and it is not the seeded Effitrans tenant.
    expect(s).not.toContain("00000000-0000-0000-0000-000000000001");
  });

  it("aborts rather than touch a tenant holding anything real", () => {
    const s = sql();
    expect(s).toContain("REFUSING:");
    expect(s).toMatch(/not like 'DEMO-%'/);
  });

  it("is idempotent and reversible", () => {
    const s = sql();
    expect(s).toContain("delete from public.invoice");
    expect(s).toContain("TEARDOWN");
  });

  it("every fixture name is an obvious placeholder", () => {
    const s = sql();
    const names = [...s.matchAll(/'(Client Démo [^']+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const n of names) expect(n).toMatch(/^Client Démo /);
    expect(s).toMatch(/'DEMO-INV-\d{4}'|DEMO-INV-' \|\| spec\.suffix/);
  });

  it("exercises every state the review checklist names", () => {
    const s = sql();
    for (const marker of [
      "OPENING_IMPORT",     // legacy rows with a preserved reference
      "'EUR'",              // foreign-currency exclusion
      "disputed_at",        // dispute indicator
      "PARTIALLY_PAID",     // partial payment
      "'PAID'",             // settled → excluded
      "DEMO-PAY-FUTURE",    // a payment after a back-dated arrêté
      "2505",               // the oldest critical balance
      "365",                // the boundary pair
      "366",
    ]) {
      expect(s, marker).toContain(marker);
    }
  });

  it("uses only valid hex UUID literals", () => {
    const bad = [...sql().matchAll(/'([0-9a-zA-Z-]{36})'/g)]
      .map((m) => m[1])
      .filter((u) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u));
    expect(bad).toEqual([]);
  });

  it("is NOT wired into CI or the normal seed — it is an operator tool", () => {
    expect(read(".github/workflows/ci.yml")).not.toContain("aging_preview_dataset");
    expect(read("supabase/seed.sql")).not.toContain("DEMO-INV");
  });
});

// ===========================================================================
describe("FIN-AGING-3B — it looks like it belongs in Effitrans", () => {
  const w = () => code(WORKSPACE);

  it("KPI cards use the house StatCard shape, not an invented palette", () => {
    // components/departments/stat-card.tsx: white `surface`, coloured accent bar
    // on the left, small slate label, large `tabular` navy figure. Tinted card
    // backgrounds appear nowhere else in the platform.
    const s = w();
    expect(s).toContain("before:absolute before:inset-y-0 before:left-0 before:w-1");
    expect(s).toContain("before:bg-navy-700");
    expect(s).toContain('className="tabular mt-2 text-2xl font-bold text-navy-900"');
    expect(s).not.toMatch(/tone === "critical"[\s\S]{0,60}bg-red-50/); // the old tinted card
  });

  it("tabs use the house pill styling from ShippingNav", () => {
    const s = w();
    expect(s).toContain('tab === t.key ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100"');
    expect(s).toContain("rounded-md px-3 py-1.5 text-sm font-medium transition");
  });

  it("navigation carries no emoji — the platform's labels are plain", () => {
    const s = w();
    const tabsBlock = s.slice(s.indexOf("const TABS = ["), s.indexOf("type TabKey"));
    expect(tabsBlock).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    // …but the workbook's ratified dashboard risk labels keep theirs.
    expect(read("lib/finance/aging/buckets.ts")).toContain("✅ Sain");
  });

  it("a breadcrumb says where the workspace sits, like every other one", () => {
    const s = w();
    expect(s).toContain('aria-label="Fil d\'Ariane"');
    expect(s).toMatch(/href="\/departments\/finance"[\s\S]{0,80}Finance/);
  });

  it("figures use the house `tabular` class", () => {
    const s = w();
    expect(s).not.toContain("tabular-nums");
    expect((s.match(/\btabular\b/g) ?? []).length).toBeGreaterThan(15);
  });

  it("form controls use the shared `.input` class where they can", () => {
    expect(w()).toContain('className="input mt-1 w-auto"');
  });

  it("the arrêté is restated in French, because a native date input is locale-bound", () => {
    // <input type="date"> renders per BROWSER locale — an en-US profile shows
    // 07/30/2026 and no CSS changes that. The control keeps its picker and its
    // accessibility; the date is restated unambiguously beneath it.
    const s = w();
    expect(s).toContain('aria-describedby="arrete-fr"');
    expect(s).toMatch(/id="arrete-fr"[\s\S]{0,200}formatDateFr\(report\.reportingDate\)/);
  });

  it("the footer recedes by size and separation, never by failing contrast", () => {
    const s = w();
    expect(s).toContain('className="border-t border-slate-100 pt-3 text-center text-[11px] text-slate-500"');
    expect(s).not.toContain("text-slate-400");
    // The technical provenance is still there — it is how a figure is traced.
    expect(s).toContain("barème {report.schemeKey}");
  });

  it("empty states reuse the house visual language without misusing the page-level component", () => {
    const s = w();
    expect(s).toContain("stamp-frame");
    expect(s).toContain("bg-sand-50");
    // The shared EmptyState is a full-page treatment with a dashboard link —
    // wrong inside a table cell, so it is deliberately NOT imported.
    expect(s).not.toContain('from "@/components/ui/empty-state"');
  });
});

// ===========================================================================
describe("presentation is French-first and honest", () => {
  it("uses the ISO currency code everywhere — the platform's own convention", () => {
    // lib/operations/kpi/format.ts states the rule: "explicit currency code
    // (never abbreviated ambiguously)". FCFA appeared in no other component, so
    // this module was the outlier; it now matches.
    expect(formatAmount(123456700, "XOF")).toMatch(/ XOF$/);
    expect(formatAmount(123456700, "XOF")).not.toContain(",00"); // XOF is zero-decimal
    expect(formatAmount(100000, "EUR")).toMatch(/ EUR$/);
    for (const p of [WORKSPACE, CHARTS, "lib/finance/aging/presentation.ts"]) {
      expect(code(p), p).not.toContain("FCFA");
    }
  });

  it("dates use the workbook's forms", () => {
    expect(formatDateFr("2026-06-12")).toBe("12/06/2026");
    expect(formatDateLongFr("2026-06-12")).toBe("12 juin 2026");
    expect(formatDateFr(null)).toBe("—");
  });

  it("a not-yet-due row reads as advance, not as negative overdue days", () => {
    expect(formatDays(-12)).toContain("avance");
    expect(formatDays(0)).toBe("Échéance du jour");
    expect(formatDays(45)).toBe("45 j");
    expect(formatDays(null)).toBe("—");
  });

  it("shares render to one decimal, French style", () => {
    expect(formatShare(2394)).toBe("23,9 %");
    expect(formatShare(10000)).toBe("100,0 %");
  });

  it("uses the workbook's French labels", () => {
    const w = code(WORKSPACE);
    for (const label of [
      "Tableau de bord", "Données brutes", "Analyse clients", "Dossiers critiques", "Graphiques",
      "Total encours", "Nb factures", "Nb clients", "Montant en retard", "Retard moyen",
      "Montant > 1 an", "TOTAL GÉNÉRAL", "Tranche d&apos;ancienneté", "Part encours",
    ]) {
      expect(w, label).toContain(label);
    }
    expect(RISK_LABEL_FR.CRITIQUE).toBe("Critique");
  });

  it("all five tabs exist — none optional, none deferred", () => {
    const w = code(WORKSPACE);
    for (const key of ["dashboard", "rows", "clients", "critical", "charts"]) {
      expect(w, key).toContain(`tab === "${key}"`);
    }
  });

  it("says plainly that the view is provisional and saves nothing", () => {
    expect(code(WORKSPACE)).toMatch(/provisoire/);
    expect(code(WORKSPACE)).toMatch(/Aucun rapport n&apos;est enregistré/);
  });

  it("tables are accessible and wide content scrolls inside its own container", () => {
    const w = code(WORKSPACE);
    expect((w.match(/<caption className="sr-only">/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((w.match(/scope="col"/g) ?? []).length).toBeGreaterThan(20);
    expect((w.match(/overflow-x-auto/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(w).toContain('role="tablist"');
    expect(w).toContain('aria-selected=');
  });

  it("has polished empty states that say WHY, not blank tables", () => {
    const w = code(WORKSPACE);
    expect(w).toContain("function TableEmpty");
    expect(w).toContain("Aucune facture ne correspond à ces critères");
    expect(w).toContain("Aucun dossier critique à cette date");
    expect(w).toContain("Aucun encours client à cette date");
    // Each one explains the cause rather than stating a bare absence.
    expect(w).toContain("Élargissez la recherche");
    expect(w).toContain("c'est une bonne nouvelle");
    const c = code(CHARTS);
    expect(c).toContain("Aucun encours à représenter");
    expect((c.match(/hint="/g) ?? []).length).toBe(4);
  });

  it("has an error state that does not leak internals in production", () => {
    const p = code(PAGE);
    expect(p).toContain("n&apos;a pas pu être calculée");
    expect(p).toContain('process.env.NODE_ENV !== "production"');
  });
});

// ===========================================================================
describe("the read service respects tenancy and the arrêté", () => {
  it("every query is tenant-filtered", () => {
    const s = code(SERVICE);
    const selects = (s.match(/\.from\("/g) ?? []).length;
    const scoped = (s.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length;
    expect(selects).toBeGreaterThan(0);
    expect(scoped).toBe(selects);
  });

  it("it never asks for invoices issued after the arrêté", () => {
    expect(code(SERVICE)).toContain('.lte("issue_date", reportingDate)');
  });

  it("it derives the balance rather than reading a stored one", () => {
    const s = code(SERVICE);
    expect(s).toContain("invoice_line");
    expect(s).toContain("lineTotalMinorUnits");
    expect(s).not.toMatch(/select\([^)]*outstanding/);
  });

  it("payment reversals are passed as DATES so history stays stable", () => {
    expect(code(SERVICE)).toContain("reversedOn: p.reversed_at");
  });

  it("the arrêté defaults to the tenant's day, not the server's UTC day", () => {
    const p = code(PAGE);
    expect(p).toContain("todayInTimezone(");
    expect(p).toContain('"Africa/Dakar"');
  });

  it("an unparseable ?date= falls back instead of throwing", () => {
    expect(code(PAGE)).toContain("tryIsoDate(searchParams?.date ?? null) ?? fallback");
  });

  it("the currency must be one the tenant actually has", () => {
    expect(code(PAGE)).toContain("currencies.includes(requested)");
  });
});

// ===========================================================================
describe("the phase adds no capability it was not authorised to add", () => {
  it("no import, draft editing, validation, finalization, export, print or share", () => {
    const all = [code(PAGE), code(WORKSPACE), code(CHARTS), code(SERVICE)].join("\n");
    for (const forbidden of [
      "draft_create", "draft_update", "import_stage", "import_approve",
      "finance:aging:validate", "finance:aging:finalize", "finance:aging:export",
      "finance:aging:print", "finance:aging:share", "finance:aging:template_manage",
    ]) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });

  it("no XLSX or PDF renderer is wired in", () => {
    const all = [code(PAGE), code(WORKSPACE), code(CHARTS), code(SERVICE)].join("\n");
    for (const bad of ["xlsx", "toXlsx", "PdfDoc", "ReportLayout"]) {
      expect(all.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
  });

  it("no second rollout system was invented", () => {
    const r = code("lib/finance/aging/rollout.ts");
    expect(r).toContain("EFFITRANS_FINANCE_AGING_ENABLED");
    expect(r).toContain("server-only");
    // It does not add itself to the process engine's coupled feature set.
    expect(code("lib/process/rollout.ts")).not.toContain("aging");
  });
});
