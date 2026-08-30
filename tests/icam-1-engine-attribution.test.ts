/**
 * ICAM-1 — the frozen engine, act-time attribution, and the closure population.
 * ---------------------------------------------------------------------------
 * Three things are proven here, and the second is the one the ruling turns on:
 *
 *   1. the formula, its eight coefficients and its caps, against the frozen
 *      fixtures F-ICAM-01..05;
 *   2. Q9 — each qualifying act belongs to whoever owned the dossier WHEN IT
 *      HAPPENED, and a later reassignment never moves history;
 *   3. completeness — a term with no source is never dressed up as a measured
 *      zero, on any surface.
 *
 * The database-facing half (which column supplies each activity instant, the
 * closure population query, tenant isolation) is asserted against the source,
 * because those are joins rather than arithmetic. ICAM-2 added the NINC
 * register, whose behaviour — four eyes, the correction door, and the
 * eligibility gate — is proven against real Postgres in
 * supabase/tests/operational_incident_test.sql.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { fileURLToPath } from "node:url";
import {
  computeIcamDossier,
  ICAM_BASE,
  ICAM_MAX,
  ICAM_COEFFICIENTS,
  ICAM_TERMS,
  type IcamCounts,
} from "@/lib/performance/icam";
import {
  buildTimelines,
  ownerAt,
  attributeByActTime,
  type OwnershipEvent,
} from "@/lib/performance/attribution";
import { ICAM1_SOURCED_TERMS, ICAM1_UNSOURCED_TERMS } from "@/lib/performance/icam-read";
import { monthPeriod, quarterPeriod } from "@/lib/performance/period";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const icamRead = strip(read("lib/performance/icam-read.ts"));
const attribution = strip(read("lib/performance/attribution.ts"));

/** Counts for all eight terms — a COMPLETE basis, for formula fixtures. */
const all = (n: Partial<Record<(typeof ICAM_TERMS)[number], number>>): IcamCounts => {
  const c: IcamCounts = {};
  for (const t of ICAM_TERMS) c[t] = n[t] ?? 0;
  return c;
};

// ═══════════════════════════════ 1. THE FROZEN FORMULA ═══════════════════════

describe("ICAM — the frozen coefficients and caps", () => {
  it("the eight terms are exactly the register's, in its order", () => {
    expect([...ICAM_TERMS]).toEqual([
      "NDOC", "NREP", "NAD", "NPAY", "NFACT", "NCOORD", "NINC", "NCOUR",
    ]);
  });

  it("every coefficient and plafond matches §7.2 to the cent", () => {
    expect(ICAM_COEFFICIENTS.NDOC).toMatchObject({ coef: 0.1, cap: 1.0 });
    expect(ICAM_COEFFICIENTS.NREP).toMatchObject({ coef: 0.15, cap: 0.75 });
    expect(ICAM_COEFFICIENTS.NAD).toMatchObject({ coef: 0.25, cap: 1.0 });
    expect(ICAM_COEFFICIENTS.NPAY).toMatchObject({ coef: 0.3, cap: 0.9 });
    expect(ICAM_COEFFICIENTS.NFACT).toMatchObject({ coef: 0.15, cap: 0.75 });
    expect(ICAM_COEFFICIENTS.NCOORD).toMatchObject({ coef: 0.3, cap: 1.2 });
    expect(ICAM_COEFFICIENTS.NINC).toMatchObject({ coef: 0.5, cap: 1.0 });
    expect(ICAM_COEFFICIENTS.NCOUR).toMatchObject({ coef: 0.2, cap: 0.4 });
  });

  it("base is 1,00 and the ceiling is 8,00 — base plus every cap, exactly", () => {
    expect(ICAM_BASE).toBe(1.0);
    const capSum = ICAM_TERMS.reduce((a, t) => a + ICAM_COEFFICIENTS[t].cap, 0);
    expect(Math.round((ICAM_BASE + capSum) * 100) / 100).toBe(ICAM_MAX);
    expect(ICAM_MAX).toBe(8.0);
  });

  it("F-ICAM-01 — the methodology §7.4 example: 6,3,2,1,2,2,1,1 → 4,45", () => {
    const r = computeIcamDossier(
      all({ NDOC: 6, NREP: 3, NAD: 2, NPAY: 1, NFACT: 2, NCOORD: 2, NINC: 1, NCOUR: 1 }),
    );
    expect(r.icam).toBe(4.45);
    expect(r.basisComplete).toBe(true);
  });

  it("F-ICAM-02 — base only: every count zero → 1,00", () => {
    const r = computeIcamDossier(all({}));
    expect(r.icam).toBe(1.0);
    // Measured zeros, not absences.
    expect(r.terms.every((t) => t.state === "COUNTED" && t.count === 0)).toBe(true);
    expect(r.basisComplete).toBe(true);
  });

  it("F-ICAM-03 — every cap saturated → 8,00, the hard ceiling", () => {
    const r = computeIcamDossier(
      all({ NDOC: 15, NREP: 6, NAD: 5, NPAY: 4, NFACT: 6, NCOORD: 5, NINC: 3, NCOUR: 3 }),
    );
    expect(r.icam).toBe(8.0);
  });

  it("…and no count, however large, exceeds it", () => {
    const r = computeIcamDossier(
      all({ NDOC: 999, NREP: 999, NAD: 999, NPAY: 999, NFACT: 999, NCOORD: 999, NINC: 999, NCOUR: 999 }),
    );
    expect(r.icam).toBe(8.0);
  });

  it("F-ICAM-04 — each component caps individually", () => {
    expect(computeIcamDossier(all({ NDOC: 11 })).terms.find((t) => t.term === "NDOC")!.contribution)
      .toBe(1.0); // not 1,10
    expect(computeIcamDossier(all({ NREP: 6 })).terms.find((t) => t.term === "NREP")!.contribution)
      .toBe(0.75);
    expect(computeIcamDossier(all({ NCOUR: 3 })).terms.find((t) => t.term === "NCOUR")!.contribution)
      .toBe(0.4);
  });

  it("a single count below its cap contributes coef × n", () => {
    expect(computeIcamDossier(all({ NDOC: 4 })).icam).toBe(1.4);
    expect(computeIcamDossier(all({ NINC: 1 })).icam).toBe(1.5);
  });

  it("it is a WORKLOAD score — nothing subtracts, and it never falls below base", () => {
    for (const t of ICAM_TERMS) {
      const r = computeIcamDossier(all({ [t]: 3 }));
      expect(r.icam, t).toBeGreaterThanOrEqual(ICAM_BASE);
    }
    // A negative count is a bug, not a penalty: coerced, never subtracted.
    expect(computeIcamDossier(all({ NDOC: -5 })).icam).toBe(1.0);
  });
});

// ══════════════════════════════ 2. COMPLETENESS ══════════════════════════════

describe("a missing source is never a measured zero", () => {
  it("an omitted term reports SOURCE_UNAVAILABLE with a NULL count", () => {
    const r = computeIcamDossier({ NDOC: 2 }); // only NDOC is known
    const ndoc = r.terms.find((t) => t.term === "NDOC")!;
    const nrep = r.terms.find((t) => t.term === "NREP")!;

    expect(ndoc.state).toBe("COUNTED");
    expect(ndoc.count).toBe(2);

    expect(nrep.state).toBe("SOURCE_UNAVAILABLE");
    expect(nrep.count, "the platform must not assert a number it has not measured").toBeNull();
    expect(nrep.contribution, "arithmetically it can only be 0").toBe(0);
  });

  it("…and the dossier says its basis is incomplete, naming the terms", () => {
    const r = computeIcamDossier({ NDOC: 2, NFACT: 0, NAD: 0, NCOUR: 0 });
    expect(r.basisComplete).toBe(false);
    expect([...r.unavailableTerms].sort()).toEqual(["NCOORD", "NINC", "NPAY", "NREP"]);
  });

  it("an explicit 0 is a MEASURED zero and keeps the basis complete", () => {
    const r = computeIcamDossier(all({}));
    expect(r.basisComplete).toBe(true);
    expect(r.unavailableTerms).toEqual([]);
  });

  it("five terms are sourced and three are disclosed — NINC joined in ICAM-2", () => {
    expect([...ICAM1_SOURCED_TERMS].sort()).toEqual(["NAD", "NCOUR", "NDOC", "NFACT", "NINC"]);
    expect([...ICAM1_UNSOURCED_TERMS].sort()).toEqual(["NCOORD", "NPAY", "NREP"]);
    // Together they are the whole register, so no term can be forgotten.
    expect([...ICAM1_SOURCED_TERMS, ...ICAM1_UNSOURCED_TERMS].sort()).toEqual([...ICAM_TERMS].sort());
  });

  it("the read service NEVER names an unsourced term outside its disclosure list", () => {
    // The engine's contract is absent ⇒ SOURCE_UNAVAILABLE, so the only safe
    // rule is that the read service cannot mention NREP/NPAY/NCOORD/NINC at
    // all except in the constant that declares them unsourced. An earlier
    // version of this case grepped for `NREP: 0` and a mutation writing
    // `icamCounts.NREP = 0` walked straight past it — a fabricated zero is the
    // single worst outcome in this slice, so the assertion is now shape-blind.
    expect(icamRead).toContain("for (const t of ICAM1_SOURCED_TERMS)");
    const decl = icamRead.slice(
      icamRead.indexOf("ICAM1_UNSOURCED_TERMS"),
      icamRead.indexOf("];", icamRead.indexOf("ICAM1_UNSOURCED_TERMS")) + 2,
    );
    const rest = icamRead.replace(decl, "");
    for (const term of ["NREP", "NPAY", "NCOORD"]) {
      expect(rest, `${term} must not be assigned a count by the read service`).not.toContain(term);
    }
  });

  it("acts whose instant is unknown are NOT_ATTRIBUTABLE, not silently dropped", () => {
    const r = computeIcamDossier({ NDOC: null, unattributable: { NDOC: 3 } });
    const ndoc = r.terms.find((t) => t.term === "NDOC")!;
    expect(ndoc.state).toBe("NOT_ATTRIBUTABLE");
    expect(ndoc.unattributable).toBe(3);
    expect(r.basisComplete).toBe(false);
  });
});

// ═══════════════════ 3. Q9 — ACT-TIME ATTRIBUTION (the ruling) ═══════════════

const AM_A = "aaaaaaaa-0000-0000-0000-000000000001";
const AM_B = "bbbbbbbb-0000-0000-0000-000000000002";
const FILE = "ffffffff-0000-0000-0000-00000000000f";

/** A dossier owned by A from the start, handed to B on 2026-08-15T12:00Z. */
const reassigned: OwnershipEvent[] = [
  { fileId: FILE, previousUserId: null, newUserId: AM_A, atISO: "2026-08-01T08:00:00.000Z" },
  { fileId: FILE, previousUserId: AM_A, newUserId: AM_B, atISO: "2026-08-15T12:00:00.000Z" },
];

describe("Q9 — act-time attribution, reassignment cases", () => {
  const timelines = buildTimelines(reassigned);

  it("1 — no reassignment: every act belongs to the single owner", () => {
    const only = buildTimelines([reassigned[0]]);
    const { byOwner, unattributable } = attributeByActTime(
      [
        { fileId: FILE, atISO: "2026-08-05T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-20T09:00:00.000Z" },
      ],
      only,
    );
    expect(byOwner.get(AM_A)).toHaveLength(2);
    expect(unattributable).toEqual([]);
  });

  it("2 — historical work stays with AM-A after the dossier moves to AM-B", () => {
    const { byOwner } = attributeByActTime(
      [
        { fileId: FILE, atISO: "2026-08-02T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-10T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-14T09:00:00.000Z" },
      ],
      timelines,
    );
    expect(byOwner.get(AM_A)).toHaveLength(3);
    expect(byOwner.get(AM_B)).toBeUndefined();
  });

  it("3 — work after the handover belongs to AM-B", () => {
    const { byOwner } = attributeByActTime(
      [
        { fileId: FILE, atISO: "2026-08-16T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-20T09:00:00.000Z" },
      ],
      timelines,
    );
    expect(byOwner.get(AM_B)).toHaveLength(2);
    expect(byOwner.get(AM_A)).toBeUndefined();
  });

  it("4 — the closing owner does NOT inherit AM-A's history (the ratified example)", () => {
    // A1,A2,A3 then handover then B1,B2 — expect 3 / 2, not 0 / 5.
    const { byOwner } = attributeByActTime(
      [
        { fileId: FILE, atISO: "2026-08-02T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-05T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-09T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-18T09:00:00.000Z" },
        { fileId: FILE, atISO: "2026-08-25T09:00:00.000Z" },
      ],
      timelines,
    );
    expect(byOwner.get(AM_A)).toHaveLength(3);
    expect(byOwner.get(AM_B)).toHaveLength(2);
  });

  it("5 — the CURRENT account_manager_id cannot rewrite history: it is never read", () => {
    // Structural, and the strongest form of this assertion: the module that
    // resolves ownership cannot consult the column at all.
    expect(attribution).not.toContain("account_manager_id");
    expect(attribution).not.toContain("operational_file");
    // …and the read service resolves owners only through the timeline.
    expect(icamRead).toContain("attributeByActTime");
    expect(icamRead).not.toMatch(/account_manager_id/);
  });

  it("6 — the dossier CREATOR has no effect on attribution", () => {
    expect(attribution).not.toContain("created_by");
    expect(icamRead).not.toContain("created_by");
  });

  it("7 — boundary: an act immediately BEFORE the handover goes to the old owner", () => {
    expect(ownerAt(timelines.get(FILE), "2026-08-15T11:59:59.999Z")).toBe(AM_A);
  });

  it("8 — boundary: an act AT or after the handover goes to the new owner", () => {
    expect(ownerAt(timelines.get(FILE), "2026-08-15T12:00:00.000Z")).toBe(AM_B);
    expect(ownerAt(timelines.get(FILE), "2026-08-15T12:00:00.001Z")).toBe(AM_B);
  });

  it("9 — a foreign dossier's timeline cannot attribute this dossier's work", () => {
    const other = buildTimelines([
      { fileId: "other-file", previousUserId: null, newUserId: AM_B, atISO: "2026-01-01T00:00:00.000Z" },
    ]);
    const { byOwner, unattributable } = attributeByActTime(
      [{ fileId: FILE, atISO: "2026-08-10T09:00:00.000Z" }],
      other,
    );
    expect(byOwner.size).toBe(0);
    expect(unattributable).toHaveLength(1);
    // The query is tenant-scoped at source too.
    expect(icamRead).toContain('.eq("tenant_id", tenantId)');
  });

  it("10 — missing history does NOT silently assign to the current owner", () => {
    const { byOwner, unattributable } = attributeByActTime(
      [{ fileId: FILE, atISO: "2026-08-10T09:00:00.000Z" }],
      new Map(), // no timeline at all
    );
    expect(byOwner.size).toBe(0);
    expect(unattributable).toHaveLength(1);
    expect(ownerAt(undefined, "2026-08-10T09:00:00.000Z")).toBeNull();
  });

  it("an act with NO instant is unattributable — never guessed", () => {
    const { byOwner, unattributable } = attributeByActTime(
      [{ fileId: FILE, atISO: null }],
      timelines,
    );
    expect(byOwner.size).toBe(0);
    expect(unattributable).toHaveLength(1);
  });

  it("an act predating every recorded change falls to what the first replaced", () => {
    const withPrior = buildTimelines([
      { fileId: FILE, previousUserId: AM_A, newUserId: AM_B, atISO: "2026-08-15T12:00:00.000Z" },
    ]);
    expect(ownerAt(withPrior.get(FILE), "2026-08-01T09:00:00.000Z")).toBe(AM_A);
  });
});

// ═════════════════════ 4. SOURCES, COUNTING, F-ICAM-05 ══════════════════════

describe("the four sourced terms take their instant from an authoritative fact", () => {
  it("NAD uses the visa decision instant, and counts an authorization once", () => {
    expect(icamRead).toContain('.from("expense_visa")');
    expect(icamRead).toContain("decided_at");
    expect(icamRead).toContain('String(v.decision) !== "APPROVED"');
    expect(icamRead).toContain("firstApproval");
  });

  it("NCOUR uses the custody event instant, once per deposit", () => {
    expect(icamRead).toContain('.from("invoice_deposit_event")');
    expect(icamRead).toContain("occurred_at");
    expect(icamRead).toContain('.eq("to_status", "DEPOSITED")');
    expect(icamRead).toContain("firstPerDeposit");
  });

  it("NDOC/NFACT use the shared verification doctrine, not a local definition", () => {
    expect(icamRead).toContain("VERIFIED_STORED_STATUSES");
    expect(icamRead).not.toMatch(/status.*===.*"VERIFIED"/);
    expect(icamRead).toContain('.is("deleted_at", null)');
  });

  it("…and split on the document type: VENDOR_INVOICE is NFACT, the rest NDOC", () => {
    expect(icamRead).toContain('d.type_code === "VENDOR_INVOICE" ? "NFACT" : "NDOC"');
  });

  it("…taking the verification instant from the audit trail, earliest approval", () => {
    // `document` has no reviewed_at; the act's instant lives in audit_log.
    expect(icamRead).toContain('.eq("action", "document.approved")');
    expect(icamRead).toContain("approvedAt");
    expect(icamRead).toContain("if (!cur || at < cur) approvedAt.set(id, at)");
  });

  it("a document with no audit row yields a NULL instant, so it is excluded", () => {
    expect(icamRead).toContain("approvedAt.get(d.id as string) ?? null");
  });
});

describe("F-ICAM-05 — the monthly population is CLOSED dossiers only", () => {
  it("the population comes from the CLOSED transition, not from the file row", () => {
    expect(icamRead).toContain('.from("file_state_transition")');
    expect(icamRead).toContain('.eq("to_status", "CLOSED")');
    expect(icamRead).toContain("occurred_at");
  });

  it("no forbidden closure substitute appears anywhere", () => {
    for (const forbidden of [
      "process_instance",
      "closed_at",
      "archived_at",
      "updated_at",
      "declaration_date",
    ]) {
      expect(icamRead, `${forbidden} must not decide the ICAM month`).not.toContain(forbidden);
    }
  });

  it("the provisional path is separate and cannot produce a month", () => {
    const prov = icamRead.slice(icamRead.indexOf("export async function provisionalIcamForFile"));
    expect(prov).toContain("closedAtISO: null");
    expect(prov, "the live view must not consult the closure population").not.toContain(
      "closedDossiers(",
    );
  });

  it("period bounds cover the whole closing day, month and year ends included", () => {
    // The query brackets [start 00:00:00Z, end 23:59:59.999Z], so a dossier
    // closed at 23:30 on the last day is in the month, not the next one.
    expect(icamRead).toContain("T00:00:00Z");
    expect(icamRead).toContain("T23:59:59.999Z");
    expect(monthPeriod("2026-08-14").endISO).toBe("2026-08-31");
    expect(monthPeriod("2026-12-05").endISO).toBe("2026-12-31");
    expect(quarterPeriod("2026-08-14")).toMatchObject({
      startISO: "2026-07-01",
      endISO: "2026-09-30",
    });
  });

  it("an activity in one month and a closure in another lands on the CLOSURE month", () => {
    // Structural: acts are gathered for the dossiers the CLOSURE query returned,
    // so the activity's own date never selects the period.
    const fn = icamRead.slice(icamRead.indexOf("export async function icamDossiers"));
    expect(fn.indexOf("closedDossiers(tenantId, period)")).toBeLessThan(
      fn.indexOf("verifiedDocumentActivities"),
    );
    expect(fn).toContain("const fileIds = [...closedAt.keys()]");
  });
});

describe("ICAM-1 stays inside its slice", () => {
  it("it adds no BI, report, snapshot or PDF integration — that is ICAM-3", () => {
    for (const forbidden of ["buildSnapshot", "buildBriefing", "renderPerformanceReport", "performance_report"]) {
      expect(icamRead, forbidden).not.toContain(forbidden);
    }
  });

  it("it still adds no BI/report integration — ICAM-3 owns that", () => {
    // ICAM-2 opened the incident register; it did not open the presentation.
    expect(icamRead).toContain("operational_incident");
    for (const forbidden of ["buildSnapshot", "buildBriefing", "renderPerformanceReport"]) {
      expect(icamRead, forbidden).not.toContain(forbidden);
    }
  });

  it("there is ONE ICAM formula, and only the engine holds it", () => {
    for (const [name, src] of [["icam-read", icamRead], ["attribution", attribution]] as const) {
      expect(src, `${name} must not re-implement the formula`).not.toContain("ICAM_BASE +");
      expect(src, `${name} must not hold coefficients`).not.toMatch(/0\.15|0\.25|0\.3\b/);
    }
    expect(icamRead).toContain("computeIcamDossier");
  });
});

// ══════════════════════ ICAM-2 — the NINC register and its gate ═════════════

const incidentMigration = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20260923000001_operational_incident.sql", import.meta.url)),
  "utf8",
);
const mIncident = incidentMigration
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

describe("NINC eligibility — every word of the frozen term is a condition", () => {
  it("the predicate lives in ONE place and reads exactly the frozen conditions", () => {
    expect(icamRead).toContain("NINC_ELIGIBILITY");
    expect(icamRead).toContain('status: "TRAITE"');
    expect(icamRead).toContain('imputability: "NON"');
    // …and finality, which EN_ANALYSE and an open correction both lack.
    expect(icamRead).toContain('.not("imputability_decided_at", "is", null)');
  });

  it("EN_ANALYSE cannot count — it is not a decision, and the DB refuses it as one", () => {
    expect(mIncident).toContain(
      "imputability must be one of OUI, NON, NON_EVALUE",
    );
    // …and an EN_ANALYSE row can never carry a decision instant.
    expect(mIncident).toContain("imputability <> 'EN_ANALYSE' or imputability_decided_at is null");
  });

  it("an untreated incident cannot count: TRAITE is required and implies its instant", () => {
    expect(mIncident).toContain(
      "(status = 'TRAITE') = (treated_at is not null and treated_by is not null)",
    );
  });

  it("OUI never counts — an AM-caused rework must not increment (F-ICAM-06)", () => {
    // The filter admits only NON, so OUI and NON_EVALUE are excluded by
    // construction rather than by a list somebody must maintain.
    const fn = icamRead.slice(icamRead.indexOf("async function incidentActivities"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("NINC_ELIGIBILITY.imputability");
    expect(body).not.toContain('"OUI"');
    expect(body).not.toContain('"NON_EVALUE"');
  });

  it("a cancelled incident never counts — ANNULE is not TRAITE, and treatment is cleared", () => {
    expect(mIncident).toContain("status              = 'ANNULE'");
    expect(mIncident).toContain("treated_at          = null");
  });

  it("each distinct incident counts once; the frozen cap does the bounding (Q10)", () => {
    const fn = icamRead.slice(icamRead.indexOf("async function incidentActivities"));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("seen.has(id)");
    // Two qualifying incidents on one dossier → 2 × 0,50 = 1,00, at the cap.
    expect(computeIcamDossier(all({ NINC: 2 })).icam).toBe(2.0);
    expect(computeIcamDossier(all({ NINC: 3 })).terms.find((t) => t.term === "NINC")!.contribution)
      .toBe(1.0);
  });
});

describe("NINC attribution — R2: the workload instant is TREATMENT completion", () => {
  it("the activity instant is treated_at, not recorded_at and not the adjudication", () => {
    const fn = icamRead.slice(icamRead.indexOf("async function incidentActivities"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("r.treated_at");
    expect(body).not.toContain("recorded_at");
    expect(body).not.toContain("r.imputability_decided_at");
  });

  it("treatment completion is stamped by the DATABASE, never an application", () => {
    const fn = mIncident.slice(mIncident.indexOf("function public.complete_operational_incident_treatment"));
    expect(fn.slice(0, fn.indexOf("$$;"))).toContain("treated_at = now()");
  });

  it("Q9 then resolves the owner AT that instant — the same path as every other term", () => {
    expect(icamRead).toContain("attributeByActTime");
    expect(icamRead).not.toContain("account_manager_id");
  });

  it("treatment in one month and closure in another: the dossier still lands on CLOSURE", () => {
    // Structural: acts are gathered for the dossiers the CLOSURE query returned.
    // A treatment instant can never select the monthly period — it only decides
    // WHO gets the workload.
    const fn = icamRead.slice(icamRead.indexOf("export async function icamDossiers"));
    expect(fn.indexOf("closedDossiers(tenantId, period)")).toBeLessThan(
      fn.indexOf("incidentActivities"),
    );
  });
});

describe("ICAM-2 governance — four eyes, in the database", () => {
  it("the recorder may never adjudicate their own incident", () => {
    expect(mIncident).toContain("the actor who recorded an incident may not adjudicate it");
    expect(mIncident).toContain("if v_recorded = p_actor then");
  });

  it("the corrector may never revalidate their own correction", () => {
    expect(mIncident).toContain("the corrector may not revalidate their own correction");
  });

  it("a final determination cannot be re-adjudicated — only corrected, with a reason", () => {
    expect(mIncident).toContain("this incident is already adjudicated: use the governed correction");
    expect(mIncident).toContain("a correction requires a reason");
    expect(mIncident).toContain("only a final determination passes through the correction door");
  });

  it("a correction preserves the displaced determination and clears finality", () => {
    expect(mIncident).toContain("imputability_before text not null");
    expect(mIncident).toContain("decided_by_before");
    expect(mIncident).toContain("decided_at_before");
    const fn = mIncident.slice(mIncident.indexOf("function public.correct_operational_incident"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("imputability_decided_by = null");
    expect(body).toContain("imputability_decided_at = null");
  });

  it("…so a corrected incident stops counting until somebody else confirms it", () => {
    // Finality is part of the eligibility filter, so this follows by construction.
    expect(icamRead).toContain('.not("imputability_decided_at", "is", null)');
  });

  it("the correction history is append-only", () => {
    expect(mIncident).toContain("create trigger operational_incident_correction_worm");
    expect(mIncident).toContain("before update or delete on public.operational_incident_correction");
  });

  it("every RPC verifies the caller's declared authority (INV-7)", () => {
    const calls = mIncident.split("assert_actor_authority").length - 1;
    expect(calls, "one per governed act").toBeGreaterThanOrEqual(6);
  });

  it("no RPC is browser-executable", () => {
    for (const fn of [
      "record_operational_incident",
      "adjudicate_operational_incident",
      "complete_operational_incident_treatment",
      "cancel_operational_incident",
      "correct_operational_incident",
      "revalidate_operational_incident",
    ]) {
      expect(mIncident, fn).toContain(`revoke execute on function public.${fn}`);
      expect(mIncident, fn).toContain(`grant execute on function public.${fn}`);
    }
    expect(mIncident).toContain("from public, anon, authenticated");
  });
});

describe("ICAM-2 authority — existing roles, and nothing leaks", () => {
  it("recording is the Superviseur's, adjudication the Responsable Qualité's", () => {
    expect(mIncident).toContain("'incident:record'");
    expect(mIncident).toContain("'incident:adjudicate'");
    expect(mIncident).toContain("r.code = 'OPS_SUPERVISOR'");
    expect(mIncident).toContain("r.code = 'COMPLIANCE_HSSE'");
  });

  it("no new role was created", () => {
    expect(mIncident, "the governance matrix already names both actors").not.toContain(
      "insert into public.role (",
    );
  });

  it("PERFORMANCE_MANAGEMENT and SYSTEM_ADMIN hold neither — asserted by the migration", () => {
    expect(mIncident).toContain("'PERFORMANCE_MANAGEMENT', 'PERFORMANCE_PUBLISHER', 'SYSTEM_ADMIN'");
    expect(mIncident).toContain("neither decides who caused an incident");
  });

  it("the register has NO write policy — the RPCs are the boundary", () => {
    expect(mIncident).toContain("must have NO write policy");
    expect(mIncident).toContain("for select to authenticated");
  });

  it("an incident can never point at another tenant's dossier", () => {
    expect(mIncident).toContain("incident tenant mismatch");
    expect(mIncident).toContain("create trigger trg_operational_incident_tenant");
  });

  it("the tables are registered as tenant-scoped", () => {
    const registry = readFileSync(
      fileURLToPath(new URL("../lib/db/tenant-tables.ts", import.meta.url)),
      "utf8",
    );
    expect(registry).toContain('"operational_incident"');
    expect(registry).toContain('"operational_incident_correction"');
  });
});

describe("the basis stays partial, and says so", () => {
  it("NINC now counts, but three terms remain unavailable", () => {
    const r = computeIcamDossier({ NDOC: 1, NFACT: 0, NAD: 0, NCOUR: 0, NINC: 1 });
    expect(r.terms.find((t) => t.term === "NINC")!.state).toBe("COUNTED");
    expect(r.basisComplete, "NREP/NPAY/NCOORD are still unsourced").toBe(false);
    expect([...r.unavailableTerms].sort()).toEqual(["NCOORD", "NPAY", "NREP"]);
  });

  it("a qualifying NINC adds exactly the frozen coefficient", () => {
    const without = computeIcamDossier({ NDOC: 1, NFACT: 0, NAD: 0, NCOUR: 0, NINC: 0 });
    const with1 = computeIcamDossier({ NDOC: 1, NFACT: 0, NAD: 0, NCOUR: 0, NINC: 1 });
    expect(Math.round((with1.icam - without.icam) * 100) / 100).toBe(0.5);
  });

  it("an imputable incident is simply absent from the count, never negative", () => {
    // The register keeps it; the filter excludes it; ICAM is unchanged.
    const r = computeIcamDossier({ NDOC: 1, NFACT: 0, NAD: 0, NCOUR: 0, NINC: 0 });
    expect(r.icam).toBe(1.1);
    expect(r.terms.find((t) => t.term === "NINC")!.contribution).toBe(0);
  });
});

// ═══════════════ ICAM-2 — the three sources must agree on who may act ═══════
//
// A fresh tenant is provisioned from the role TEMPLATES; an existing tenant was
// grandfathered by the MIGRATION; a local `supabase db reset` rebuilds from the
// SEED. If they disagree, two companies running the same release disagree about
// who may decide whether a colleague caused an incident — and nothing fails
// loudly. So all three are pinned here together.

const seedSql = readFileSync(fileURLToPath(new URL("../supabase/seed.sql", import.meta.url)), "utf8");
const holders = (permission: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key).sort();

describe("incident capabilities — migration, seed and role templates agree", () => {
  it("incident:record belongs to OPS_SUPERVISOR alone", () => {
    expect(holders("incident:record")).toEqual(["OPS_SUPERVISOR"]);
    const block = mIncident.slice(mIncident.indexOf("p.code = 'incident:record'"));
    expect(block.slice(0, block.indexOf("on conflict"))).toContain("r.code = 'OPS_SUPERVISOR'");
    const seedBlock = seedSql.slice(seedSql.indexOf("p.code = 'incident:record'"));
    expect(seedBlock.slice(0, seedBlock.indexOf("on conflict"))).toContain("r.code = 'OPS_SUPERVISOR'");
  });

  it("incident:adjudicate belongs to COMPLIANCE_HSSE alone", () => {
    expect(holders("incident:adjudicate")).toEqual(["COMPLIANCE_HSSE"]);
    const block = mIncident.slice(mIncident.indexOf("p.code = 'incident:adjudicate'"));
    expect(block.slice(0, block.indexOf("on conflict"))).toContain("r.code = 'COMPLIANCE_HSSE'");
    const seedBlock = seedSql.slice(seedSql.indexOf("p.code = 'incident:adjudicate'"));
    expect(seedBlock.slice(0, seedBlock.indexOf("on conflict"))).toContain("r.code = 'COMPLIANCE_HSSE'");
  });

  it("the two are SPLIT — no template holds both, so four eyes is the default", () => {
    const both = TENANT_ROLE_TEMPLATES.filter(
      (t) => t.permissions.includes("incident:record") && t.permissions.includes("incident:adjudicate"),
    );
    expect(both.map((t) => t.key)).toEqual([]);
  });

  it("no template gives either capability to Performance or SYSTEM_ADMIN", () => {
    for (const key of ["PERFORMANCE_MANAGEMENT", "PERFORMANCE_PUBLISHER", "SYSTEM_ADMIN"]) {
      const t = TENANT_ROLE_TEMPLATES.find((x) => x.key === key);
      if (!t) continue;
      expect(t.permissions, `${key} must not record incidents`).not.toContain("incident:record");
      expect(t.permissions, `${key} must not adjudicate imputability`).not.toContain("incident:adjudicate");
    }
  });

  it("both capabilities are declared in the seed as well as the migration", () => {
    for (const code of ["incident:record", "incident:adjudicate"]) {
      expect(seedSql, code).toContain(`('${code}', 'incident'`);
      expect(mIncident, code).toContain(`('${code}', 'incident'`);
    }
  });
});

describe("the ICAM-2 behaviour suite exists and is wired into CI", () => {
  const suite = readFileSync(
    fileURLToPath(new URL("../supabase/tests/operational_incident_test.sql", import.meta.url)),
    "utf8",
  );
  const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");

  it("CI runs it", () => {
    expect(ci).toContain("supabase/tests/operational_incident_test.sql");
  });

  it("it runs BEFORE the journey harness, which must stay last", () => {
    expect(ci.indexOf("operational_incident_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });

  it("it proves the person-level rule with an actor holding BOTH capabilities", () => {
    // A probe that lacks incident:adjudicate would be refused for the wrong
    // reason and the four-eyes rule could be deleted without the suite noticing.
    expect(suite).toContain("recorder_holding_BOTH_caps_cannot_adjudicate_own");
    expect(suite).toContain("must hold BOTH capabilities");
    expect(suite).toContain("a_colleague_can_adjudicate_the_same_incident");
  });

  it("it fails when any recorded check is not 1", () => {
    expect(suite).toContain("from _r where value <> 1");
  });

  it("it is non-destructive", () => {
    expect(suite.trimEnd().endsWith("rollback;")).toBe(true);
    expect(suite).not.toContain("commit;");
  });
});

describe("the shipped build knows which migration it carries", () => {
  it("build-info names migration 131", () => {
    const info = readFileSync(
      fileURLToPath(new URL("../lib/platform/ops/build-info.ts", import.meta.url)),
      "utf8",
    );
    expect(info).toContain('LATEST_MIGRATION = "20260923000001_operational_incident"');
    expect(info).toContain("MIGRATION_COUNT = 131");
  });
});
