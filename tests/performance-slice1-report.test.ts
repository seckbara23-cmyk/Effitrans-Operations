/**
 * Slice 1 « Premier rapport » — ICTD 7/7, one engine, and the frozen report.
 * ---------------------------------------------------------------------------
 * The behavioural half (a real publication against Postgres, the immutability
 * trigger refusing an UPDATE, cross-tenant refusal) lives in
 * supabase/tests/performance_report_test.sql. What lives here is everything
 * provable without a database: the derivation rules, the period arithmetic, the
 * single-engine guarantee, and the authority model around publication.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { PERFORMANCE_TABS } from "@/lib/performance/tabs";
import { ICTD_TERMS, ICTD_TERM_COUNT } from "@/lib/performance/read";
import {
  dakarToday,
  monthPeriod,
  quarterPeriod,
  yearPeriod,
  customPeriod,
  resolvePeriod,
  BUSINESS_TIME_ZONE,
} from "@/lib/performance/period";
import { buildSnapshot, PARAMETER_SET_VERSION, PERFORMANCE_ENGINE_VERSION } from "@/lib/performance/report";
import { renderPerformanceReport } from "@/lib/performance/report-pdf";
import { buildBriefing } from "@/lib/performance/briefing";
import { networkDays, workedDaysInPeriod, delaiJoursOuvres } from "@/lib/performance/working-days";
import { computeIctdDossier } from "@/lib/performance/ictd";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260922000001_performance_report.sql";
const m = read(MIGRATION);
const mCode = strip(m);
const actions = strip(read("lib/performance/report-actions.ts"));
const readSvc = strip(read("lib/performance/read.ts"));

const holders = (permission: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key).sort();

// ================================================== ICTD 7/7 derivation ====

describe("ICTD reaches seven sourced terms", () => {
  it("the inventory names all seven", () => {
    expect(ICTD_TERM_COUNT).toBe(7);
    expect(ICTD_TERMS.join(" ")).toMatch(/NF/);
    expect(ICTD_TERMS.join(" ")).toMatch(/Cotations/);
  });

  it("NF counts COMMERCIAL_INVOICE — never VENDOR_INVOICE", () => {
    // The ratified distinction. VENDOR_INVOICE is « facture tierce payable »,
    // a payable Effitrans owes, and it belongs to ICAM's NFACT.
    expect(readSvc).toContain('.eq("type_code", "COMMERCIAL_INVOICE")');
    expect(readSvc, "a payable is not a declaration input").not.toContain("VENDOR_INVOICE");
  });

  it("…and only VERIFIED ones, through the shared doctrine rather than a re-implementation", () => {
    // `isVerified` is alias-aware: legacy rows say APPROVED and evidence-consumed
    // documents say CONSUMED_AS_EVIDENCE. Re-testing `status === "VERIFIED"`
    // here would silently undercount both.
    expect(readSvc).toContain("isVerified(String(row.status))");
    expect(readSvc).toContain('from "@/lib/documents/doctrine"');
  });

  it("deleted documents are excluded", () => {
    const fn = readSvc.slice(readSvc.indexOf("async function verifiedCommercialInvoiceCounts"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain('.is("deleted_at", null)');
  });

  it("cotations count on sent_at — a timestamp, not a status list", () => {
    const fn = readSvc.slice(readSvc.indexOf("async function sentCotationCounts"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('.not("sent_at", "is", null)');
    // Drafts and cancellations are excluded BY CONSTRUCTION, so no status list
    // exists here to drift out of date.
    for (const s of ["DRAFT", "PENDING_VALIDATION", "CANCELLED", "ACCEPTED"]) {
      expect(body, `${s} must not be named — sent_at decides`).not.toContain(s);
    }
  });

  it("cotations span the originating request, not only the winning quotation", () => {
    const fn = readSvc.slice(readSvc.indexOf("async function sentCotationCounts"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("converted_file_id");
    expect(body).toContain("request_id");
  });

  it("both derivations are tenant-scoped", () => {
    for (const name of ["verifiedCommercialInvoiceCounts", "sentCotationCounts"]) {
      const fn = readSvc.slice(readSvc.indexOf(`async function ${name}`));
      const body = fn.slice(0, fn.indexOf("\n}\n"));
      const scoped = body.split('.eq("tenant_id", tenantId)').length - 1;
      expect(scoped, `${name} must filter every query by tenant`).toBeGreaterThan(0);
    }
  });

  it("a fully captured dossier computes with all seven terms", () => {
    // F-ICTD-01, the methodology's own example: NF 3, NPSH 10, CCT EFFITRANS,
    // APE, DPI EFFITRANS, TE EFFITRANS, 2 cotations → 12,34.
    expect(
      computeIctdDossier({
        invoiceCount: 3,
        shPositionCount: 10,
        tariffOrigin: "EFFITRANS",
        declarationType: "APE",
        dpiRegime: "EFFITRANS",
        exemptionTitleOrigin: "EFFITRANS",
        cotationCount: 2,
      }),
    ).toBe(12.34);
  });

  it("a measured zero and an absence stay different", () => {
    // NF = 0 is a counted fact (the query ran) and still scores; a missing CDP
    // is an absence and does not score at all.
    expect(
      computeIctdDossier({
        invoiceCount: 0,
        shPositionCount: 0,
        tariffOrigin: "CLIENT",
        declarationType: "SIMPLE",
        dpiRegime: "SANS_DPI",
        exemptionTitleOrigin: "SANS_OBJET",
        cotationCount: 0,
      }),
    ).toBe(1.0);
    expect(
      computeIctdDossier({
        invoiceCount: 0,
        shPositionCount: 0,
        tariffOrigin: "CLIENT",
        declarationType: null,
        dpiRegime: "SANS_DPI",
        exemptionTitleOrigin: "SANS_OBJET",
        cotationCount: 0,
      }),
    ).toBeNull();
  });
});

// ========================================================= period model ====

describe("periods — month, quarter, year, custom", () => {
  it("month boundaries, including a leap February", () => {
    expect(monthPeriod("2026-08-14")).toMatchObject({
      startISO: "2026-08-01",
      endISO: "2026-08-31",
      label: "août 2026",
    });
    expect(monthPeriod("2024-02-10").endISO).toBe("2024-02-29");
    expect(monthPeriod("2026-02-10").endISO).toBe("2026-02-28");
  });

  it("quarter boundaries", () => {
    expect(quarterPeriod("2026-08-14")).toMatchObject({
      startISO: "2026-07-01",
      endISO: "2026-09-30",
      label: "T3 2026",
    });
    expect(quarterPeriod("2026-01-01").startISO).toBe("2026-01-01");
    expect(quarterPeriod("2026-12-31").endISO).toBe("2026-12-31");
  });

  it("year boundaries", () => {
    expect(yearPeriod("2026-08-14")).toMatchObject({
      startISO: "2026-01-01",
      endISO: "2026-12-31",
      label: "2026",
    });
  });

  it("a custom span is inclusive, and a reversed one throws rather than reading empty", () => {
    expect(customPeriod("2026-08-03", "2026-08-07").kind).toBe("CUSTOM");
    expect(() => customPeriod("2026-08-07", "2026-08-03")).toThrow();
  });

  it("resolvePeriod falls back to the month rather than throwing at a page boundary", () => {
    expect(resolvePeriod({ type: "CUSTOM", from: "nonsense", to: "2026-08-01" }).kind).toBe("MONTH");
    expect(resolvePeriod({ type: "QUARTER", anchor: "2026-05-05" }).label).toBe("T2 2026");
    expect(resolvePeriod({}).kind).toBe("MONTH");
  });
});

describe("time authority", () => {
  it("the business timezone is recorded, not assumed", () => {
    expect(BUSINESS_TIME_ZONE).toBe("Africa/Dakar");
  });

  it("dakarToday is a business DATE, and is never used for a business timestamp", () => {
    expect(dakarToday(new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-14");
    // Persisted times come from the database. The publish path writes none.
    const publish = actions.slice(actions.indexOf("export async function publishReport"));
    expect(publish).not.toContain("published_at:");
    expect(mCode).toContain("published_at          = now()");
  });

  it("creation and submission timestamps come from the database too", () => {
    expect(mCode).toContain("created_at            timestamptz not null default now()");
    const create = actions.slice(
      actions.indexOf("export async function createReport"),
      actions.indexOf("export async function updateReportNarrative"),
    );
    expect(create, "created_at is a column default, not an application value").not.toContain("created_at");
  });
});

// ======================================================= the ONE engine ====

describe("one engine — a dashboard and a published report cannot disagree", () => {
  it("BI and the report snapshot are the same function", () => {
    const bi = strip(read("lib/performance/bi.ts"));
    expect(bi).toContain("buildSnapshot");
    expect(actions).toContain("buildSnapshot");
  });

  it("neither the BI layer nor the report actions compute an indicator of their own", () => {
    for (const [name, src] of [["bi.ts", strip(read("lib/performance/bi.ts"))], ["report-actions.ts", actions]] as const) {
      expect(src, `${name} must not re-implement ICTD`).not.toContain("computeIctdDossier");
      expect(src, `${name} must not re-implement the délai`).not.toContain("delaiJoursOuvres(");
      expect(src, `${name} must not re-implement reliability`).not.toContain("reliabilityStatus(");
    }
  });

  it("the PDF renderer takes the snapshot and cannot reach the database", () => {
    const pdf = strip(read("lib/performance/report-pdf.ts"));
    expect(pdf).not.toContain("getAdminSupabaseClient");
    expect(pdf).not.toContain(".from(");
    expect(pdf).not.toContain("await ");
  });

  it("the PDF route serves the STORED artifact and never re-renders", () => {
    const route = strip(read("app/performance/rapports/[id]/pdf/route.ts"));
    expect(route).toContain("downloadObject");
    expect(route, "re-rendering would recompute from today's data").not.toContain("renderPerformanceReport");
    expect(route).toContain('report.status !== "PUBLIE"');
  });
});

describe("the snapshot carries its own provenance", () => {
  const snap = buildSnapshot({
    period: monthPeriod("2026-08-10"),
    collaborators: [],
    dossiers: [],
    clientNames: new Map(),
    calendarDays: 0,
    unavailable: [{ indicator: "ICAM", missing: ["registre des réclamations"] }],
  });

  it("it stamps the parameter set and the engine", () => {
    expect(snap.parameterSetVersion).toBe(PARAMETER_SET_VERSION);
    expect(snap.engineVersion).toBe(PERFORMANCE_ENGINE_VERSION);
  });

  it("an empty period yields blanks, never zeros, for the indicators", () => {
    expect(snap.activity.ictdTotal).toBeNull();
    expect(snap.activity.ictdAverage).toBeNull();
    expect(snap.delays.averageWorkingDays).toBeNull();
    // Counts of THINGS are legitimately zero — nobody worked, and that is a
    // measured fact rather than an unmeasured one.
    expect(snap.activity.dossierCount).toBe(0);
  });

  it("it names the indicators it cannot compute", () => {
    expect(snap.methodology.unavailableIndicators[0].indicator).toBe("ICAM");
  });

  it("an empty calendar is called out rather than silently shortening delays", () => {
    expect(snap.methodology.notes.join(" ")).toMatch(/calendrier de travail/i);
  });

  it("the PDF renders from it and produces a real document", () => {
    const bytes = renderPerformanceReport({
      title: "Rapport de Performance — août 2026",
      snapshot: snap,
      provenance: {
        preparedBy: "fary@effitrans.sn",
        createdAt: "2026-09-01T09:00:00.000Z",
        publishedBy: "direction@effitrans.sn",
        publishedAt: "2026-09-01T10:00:00.000Z",
        parameterSetVersion: PARAMETER_SET_VERSION,
        engineVersion: PERFORMANCE_ENGINE_VERSION,
      },
      executiveSummary: "Activité stable sur la période.",
      managementCommentary: "Renforcer la saisie douanière.",
    });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

// ========================================================= immutability ====

describe("a published report is frozen — in the DATABASE", () => {
  it("the trigger refuses an update and a delete once published", () => {
    expect(mCode).toContain("create trigger performance_report_immutable");
    expect(mCode).toContain("before update or delete on public.performance_report");
    expect(mCode).toContain("may never be deleted");
    expect(mCode).toContain("is frozen: reopen the period as a new report");
  });

  it("the ONE permitted post-publication write is the artifact, and only once", () => {
    const fn = mCode.slice(mCode.indexOf("function public.performance_report_immutable"));
    expect(fn).toContain("old.artifact_storage_path is null");
    // Everything a reader was briefed on must be unchanged for that path to open.
    for (const col of ["snapshot", "title", "published_at", "published_by", "parameter_set_version"]) {
      expect(fn, col).toContain(`new.${col}`);
    }
  });

  it("a published report cannot exist without its evidence", () => {
    expect(mCode).toContain("status <> 'PUBLIE'");
    expect(mCode).toContain("snapshot is not null and published_by is not null");
  });

  it("the table has no write policy — the actions are the boundary", () => {
    expect(mCode).toContain("for select to authenticated");
    expect(mCode).toContain("must have NO write policy");
  });

  it("the action refuses to edit a published report before the trigger has to", () => {
    expect(actions).toContain('return { ok: false, error: "published_is_frozen" };');
  });

  it("the table is registered as tenant-scoped", () => {
    expect(TENANT_SCOPED_TABLES.has("performance_report")).toBe(true);
  });
});

describe("publication is atomic, authorized in the database, and once", () => {
  it("it goes through an RPC, not an ordinary update", () => {
    expect(actions).toContain('admin.rpc("publish_performance_report"');
  });

  it("the RPC re-proves the caller's authority (INV-7)", () => {
    expect(mCode).toContain("assert_actor_authority(p_actor, v_tenant, 'performance:report:publish', 'SERVICE')");
  });

  it("it refuses any state but « prêt pour revue », and refuses a second publication", () => {
    expect(mCode).toContain("this report is already published");
    expect(mCode).toContain("only a report marked « prêt pour revue » may be published");
  });

  it("it is never browser-executable", () => {
    for (const who of ["public", "anon", "authenticated"]) {
      expect(mCode).toContain(
        `revoke execute on function public.publish_performance_report(uuid, uuid, jsonb, text, text) from ${who}`,
      );
    }
    expect(mCode).toContain("to service_role");
  });

  it("a failed PDF render cannot un-publish the decision", () => {
    const publish = actions.slice(actions.indexOf("export async function publishReport"));
    expect(publish).toContain("try {");
    expect(publish).toContain("} catch {");
  });
});

// =============================================================== RBAC ====

describe("drafting and publishing are separate authorities", () => {
  it("PERFORMANCE_MANAGEMENT may draft, and may not publish", () => {
    const t = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PERFORMANCE_MANAGEMENT")!;
    expect(t.permissions).toContain("performance:report:create");
    expect(t.permissions).not.toContain("performance:report:publish");
  });

  it("PERFORMANCE_PUBLISHER exists, with the ratified French name", () => {
    const t = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PERFORMANCE_PUBLISHER");
    expect(t).toBeDefined();
    expect(t!.labelFr).toBe("Publication des rapports de performance");
  });

  it("…and it holds publication and the profile baseline, and nothing else", () => {
    const t = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PERFORMANCE_PUBLISHER")!;
    expect([...t.permissions].sort()).toEqual([
      "performance:report:publish",
      "profile:read:self",
      "profile:update:self",
    ]);
  });

  it("publishing is held by that role alone", () => {
    expect(holders("performance:report:publish")).toEqual(["PERFORMANCE_PUBLISHER"]);
    expect(holders("performance:report:create")).toEqual(["PERFORMANCE_MANAGEMENT"]);
  });

  it("the publisher role grants no operational, HR, customs or finance authority", () => {
    const t = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PERFORMANCE_PUBLISHER")!;
    for (const p of [
      "hr:read", "hr:manage", "customs:read", "customs:update", "customs:validate",
      "finance:read", "collections:manage", "process:read", "process:close",
      "admin:users:manage", "admin:roles:manage", "analytics:read",
      // Not even reading the module: a publisher who should also study the
      // figures holds BOTH roles, which is the question the model puts to
      // whoever assigns them.
      "performance:read",
    ]) {
      expect(t.permissions, p).not.toContain(p);
    }
  });

  it("nobody is granted the publisher role automatically", () => {
    // The migration creates the role and grants it to no user. Assignment is an
    // explicit act through ordinary user administration.
    expect(mCode).not.toContain("insert into public.user_role");
  });

  it("each action asserts its own capability server-side", () => {
    expect(actions).toContain('assertPermission("performance:report:create")');
    const publish = actions.slice(actions.indexOf("export async function publishReport"));
    expect(publish).toContain('assertPermission("performance:report:publish")');
  });

  it("templates, migration and seed agree on both new capabilities", () => {
    const seed = read("supabase/seed.sql");
    for (const src of [m, seed]) {
      expect(strip(src)).toContain("'performance:report:create'");
      expect(strip(src)).toContain("'performance:report:publish'");
      expect(strip(src)).toContain("PERFORMANCE_PUBLISHER");
    }
  });
});

describe("Rapports & BI is a tab of the module, under its gate", () => {
  it("it is registered and populated", () => {
    const tab = PERFORMANCE_TABS.find((t) => t.key === "reports");
    expect(tab).toBeDefined();
    expect(tab!.href).toBe("/performance/rapports");
    expect(tab!.populated).toBe(true);
  });

  it("its routes sit under the segment layout that enforces performance:read", () => {
    for (const p of [
      "app/performance/rapports/page.tsx",
      "app/performance/rapports/[id]/page.tsx",
    ]) {
      expect(read(p).length).toBeGreaterThan(0);
    }
    expect(strip(read("app/performance/layout.tsx"))).toContain(
      'hasPermission(permissions, "performance:read")',
    );
  });

  it("the PDF route carries its own gate — a route handler has no layout above it", () => {
    const route = strip(read("app/performance/rapports/[id]/pdf/route.ts"));
    expect(route).toContain('hasPermission(permissions, "performance:read")');
    // Tenant scoping is delegated to getReport, which applies it — ONE place
    // does it, and the route passes the session's tenant rather than anything
    // from the URL. The storage path likewise comes from the row.
    expect(route).toContain("getReport(user.tenantId, id)");
    expect(strip(read("lib/performance/report-read.ts"))).toContain('.eq("tenant_id", tenantId)');
    expect(route).toContain("report.artifactStoragePath");
  });
});

// ============================ Slice-1 hardening: the briefing and its lineage ====

describe("the management briefing derives from the snapshot and concludes nothing", () => {
  const snapOf = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
    buildSnapshot({
      period: monthPeriod("2026-08-10"),
      collaborators: [],
      dossiers: [],
      clientNames: new Map(),
      calendarDays: 0,
      unavailable: [],
      ...over,
    });

  it("it is a pure function of the snapshot — no database, no recomputation", () => {
    const src = strip(read("lib/performance/briefing.ts"));
    expect(src).not.toContain("getAdminSupabaseClient");
    expect(src).not.toContain(".from(");
    expect(src).not.toContain("await ");
    // …and it must not re-derive an indicator either.
    expect(src).not.toContain("computeIctdDossier");
    expect(src).not.toContain("reliabilityStatus(");
  });

  it("the page and the PDF use the SAME derivation", () => {
    expect(strip(read("app/performance/rapports/[id]/page.tsx"))).toContain("buildBriefing(");
    expect(strip(read("lib/performance/report-pdf.ts"))).toContain("buildBriefing(");
  });

  it("the executive summary surfaces the facts management asked for", () => {
    const b = buildBriefing(snapOf());
    const labels = b.kpis.map((k) => k.label).join(" | ");
    for (const required of [
      "Période", "Dossiers analysés", "Collaborateurs évalués",
      "Délai moyen", "ICTD total", "Fiabilité",
    ]) {
      expect(labels, required).toContain(required);
    }
  });

  it("an unmeasurable figure says so instead of reading zero", () => {
    const b = buildBriefing(snapOf());
    const ictd = b.kpis.find((k) => k.label.startsWith("ICTD"))!;
    expect(ictd.value).toBe("non calculable");
    const delay = b.kpis.find((k) => k.label.startsWith("Délai"))!;
    expect(delay.value).toBe("non calculable");
  });

  it("every attention finding carries a deterministic count or an explicit state", () => {
    const b = buildBriefing(
      snapOf({
        dossiers: [
          {
            fileId: "f1", fileNumber: "EFT-1", clientId: null, declarantId: "u1",
            ictd: null, inputsCaptured: 5, invoiceCount: 0, cotationCount: 0,
            declarationType: null, shPositionCount: null, delaiJoursOuvres: null,
            validated: false, awaitingRevalidation: true,
          },
        ],
      }),
    );
    const byLabel = new Map(b.findings.map((f) => [f.label, f]));
    expect(byLabel.get("Dossiers non calculables")?.count).toBe(1);
    expect(byLabel.get("Dossiers à revalider")?.count).toBe(1);
    // The calendar finding is a STATE, so its count is explicitly null rather
    // than a misleading zero.
    expect(byLabel.get("Calendrier de travail non renseigné")?.count).toBeNull();
  });

  it("attention counts equal the snapshot's own figures — no independent tally", () => {
    const snap = snapOf({
      dossiers: [
        {
          fileId: "f1", fileNumber: "EFT-1", clientId: null, declarantId: "u1",
          ictd: null, inputsCaptured: 5, invoiceCount: 0, cotationCount: 0,
          declarationType: null, shPositionCount: null, delaiJoursOuvres: null,
          validated: false, awaitingRevalidation: false,
        },
      ],
    });
    const b = buildBriefing(snap);
    expect(b.findings.find((f) => f.label === "Dossiers non calculables")?.count).toBe(
      snap.attention.nonCalculable,
    );
  });

  it("it draws no conclusion and issues no recommendation", () => {
    const src = read("lib/performance/briefing.ts");
    for (const word of ["recommand", "il faudrait", "suggère", "devrait être"]) {
      expect(src.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe("capacity basis — the 66,0 lineage, pinned", () => {
  const EMPTY = new Set<string>();

  it("T3 2026 is 66 weekdays: 23 juillet + 21 août + 22 septembre", () => {
    expect(networkDays("2026-07-01", "2026-07-31", EMPTY)).toBe(23);
    expect(networkDays("2026-08-01", "2026-08-31", EMPTY)).toBe(21);
    expect(networkDays("2026-09-01", "2026-09-30", EMPTY)).toBe(22);
    const q = quarterPeriod("2026-08-14");
    expect(q.startISO).toBe("2026-07-01");
    expect(q.endISO).toBe("2026-09-30");
    expect(networkDays(q.startISO, q.endISO, EMPTY)).toBe(66);
  });

  it("…and with an empty calendar and no leave, workedDays IS that number", () => {
    const q = quarterPeriod("2026-08-14");
    expect(workedDaysInPeriod(q.startISO, q.endISO, EMPTY, [])).toBe(66);
    // August independently, which is why the two views differ legitimately.
    const a = monthPeriod("2026-08-14");
    expect(workedDaysInPeriod(a.startISO, a.endISO, EMPTY, [])).toBe(21);
  });

  it("a populated calendar and leave move it exactly as ratified", () => {
    const q = quarterPeriod("2026-08-14");
    const holidays = new Set(["2026-08-20"]); // a Thursday
    expect(workedDaysInPeriod(q.startISO, q.endISO, holidays, [])).toBe(65);
    // Full day of leave.
    expect(
      workedDaysInPeriod(q.startISO, q.endISO, holidays, [
        { startISO: "2026-08-05", endISO: "2026-08-05", dayTenths: 10 },
      ]),
    ).toBe(64);
    // HALF day = 0,5.
    expect(
      workedDaysInPeriod(q.startISO, q.endISO, holidays, [
        { startISO: "2026-08-06", endISO: "2026-08-06", dayTenths: 5 },
      ]),
    ).toBe(64.5);
    // Leave ON the holiday must NOT deduct twice.
    expect(
      workedDaysInPeriod(q.startISO, q.endISO, holidays, [
        { startISO: "2026-08-20", endISO: "2026-08-20", dayTenths: 10 },
      ]),
    ).toBe(65);
  });

  it("the briefing states which of the two the number means", () => {
    const empty = buildBriefing(
      buildSnapshot({
        period: quarterPeriod("2026-08-14"),
        collaborators: [], dossiers: [], clientNames: new Map(),
        calendarDays: 0, unavailable: [],
      }),
    );
    expect(empty.capacityBasis.calendarPopulated).toBe(false);
    expect(empty.capacityBasis.label).toMatch(/non renseigné/);
    expect(empty.capacityBasis.explanation).toMatch(/jours de semaine/);

    const populated = buildBriefing(
      buildSnapshot({
        period: quarterPeriod("2026-08-14"),
        collaborators: [], dossiers: [], clientNames: new Map(),
        calendarDays: 4, unavailable: [],
      }),
    );
    expect(populated.capacityBasis.calendarPopulated).toBe(true);
    expect(populated.capacityBasis.label).toMatch(/fériés/);
  });

  it("the délai formula still refuses to see leave — the ratified separation", () => {
    // THE function itself, not a restatement of it: three parameters —
    // complete, BAE, calendar — so employee leave has no way in. A fourth
    // parameter would fail here, which is the point.
    expect(delaiJoursOuvres.length).toBe(3);
    expect(workedDaysInPeriod.length, "capacity DOES take leave, as its fourth").toBe(4);
  });
});

// ================================================ provenance and lifecycle ====

describe("provenance is persisted, never derived from a browser", () => {
  const prov = strip(read("components/performance/report-provenance.tsx"));

  it("every displayed fact comes from the report row", () => {
    for (const field of [
      "createdByEmail", "createdAt", "periodLabel", "status",
      "parameterSetVersion", "publishedByEmail", "publishedAt",
      "engineVersion", "artifactSha256",
    ]) {
      expect(prov, field).toContain(field);
    }
  });

  it("it computes no timestamp of its own", () => {
    expect(prov).not.toContain("Date.now()");
    expect(prov).not.toContain("new Date()");
  });

  it("a draft shows the version IN FORCE, a published report the FROZEN one", () => {
    expect(prov).toContain("en vigueur");
    expect(prov).toContain("figée");
  });

  it("the read service exposes those columns", () => {
    const rr = strip(read("lib/performance/report-read.ts"));
    for (const col of [
      "created_by", "created_at", "published_by", "published_at",
      "parameter_set_version", "engine_version", "artifact_sha256",
    ]) {
      expect(rr, col).toContain(col);
    }
  });

  it("the PDF carries provenance too, sourced from the frozen row", () => {
    const pdf = strip(read("lib/performance/report-pdf.ts"));
    expect(pdf).toContain("provenance.preparedBy");
    expect(pdf).toContain("provenance.publishedBy");
    expect(pdf).toContain("provenance.parameterSetVersion");
    expect(pdf).toContain("PERFORMANCE_REPORT_RENDERER_VERSION");
    const publish = actions.slice(actions.indexOf("export async function publishReport"));
    expect(publish).toContain("preparedBy:");
    expect(publish).toContain("createdAt: row.created_at");
  });
});

describe("lifecycle, as the existing contract defines it", () => {
  it("the narrative stays editable through PRÊT POUR REVUE — refused only once published", () => {
    // Read from the implementation rather than invented: the guard names PUBLIE
    // and nothing else, and the database trigger agrees.
    const upd = actions.slice(
      actions.indexOf("export async function updateReportNarrative"),
      actions.indexOf("export async function submitReportForReview"),
    );
    expect(upd).toContain('if (row.status === "PUBLIE") return { ok: false, error: "published_is_frozen" };');
    expect(upd).not.toContain("PRET_POUR_REVUE");
    expect(mCode).toContain("if old.status <> 'PUBLIE' then");
  });

  it("each transition is CAS-guarded on the state it comes from", () => {
    expect(actions).toContain('.eq("status", "BROUILLON")');
    expect(actions).toContain('.eq("status", "PRET_POUR_REVUE")');
  });

  it("a draft cannot masquerade as published — the page says which it is", () => {
    const page = read("app/performance/rapports/[id]/page.tsx");
    expect(page).toContain("Brouillon — les chiffres ci-dessous sont calculés en direct");
    expect(page).toContain("report.snapshot ??");
  });

  it("the creator cannot gain publication authority by drafting", () => {
    const t = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PERFORMANCE_MANAGEMENT")!;
    expect(t.permissions).toContain("performance:report:create");
    expect(t.permissions).not.toContain("performance:report:publish");
  });

  it("SYSTEM_ADMIN still gains no automatic performance visibility", () => {
    const sa = TENANT_ROLE_TEMPLATES.find((r) => r.key === "SYSTEM_ADMIN")!;
    for (const p of sa.permissions) {
      expect(p.startsWith("performance:"), `SYSTEM_ADMIN must not hold ${p}`).toBe(false);
    }
  });
});
