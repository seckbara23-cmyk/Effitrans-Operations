/**
 * D1 / D2 / D3 — the ratified rulings, as executable proofs.
 * ---------------------------------------------------------------------------
 * Every case cites the ruling or frozen contract it pins. Parity fixtures come
 * from docs/performance/formula-parity-fixtures.md and are reproduced to the
 * cent — the rounding ORDER is part of the contract.
 */
import { describe, it, expect } from "vitest";
import {
  DECLARATION_TYPES,
  CDP_COEFFICIENTS,
  normalizeDeclarationType,
  isDeclarationType,
} from "@/lib/performance/declaration-type";
import { computeIctdDossier, round2 } from "@/lib/performance/ictd";
import { reliabilityStatus, isRankable, MIN_DOSSIERS } from "@/lib/performance/reliability";
import {
  networkDays,
  delaiJoursOuvres,
  workedDaysInPeriod,
} from "@/lib/performance/working-days";

// ============================================================== D1 — DEP ====

describe("D1 — DEP only, coefficient 1,30", () => {
  it("the production vocabulary is exactly four types, and DPE is not among them", () => {
    expect([...DECLARATION_TYPES]).toEqual(["SIMPLE", "APE", "DEP", "OG"]);
    expect(isDeclarationType("DPE")).toBe(false);
    expect(Object.keys(CDP_COEFFICIENTS)).not.toContain("DPE");
  });

  it("DEP = 1,30 — and the other ratified coefficients hold", () => {
    expect(CDP_COEFFICIENTS.DEP).toBe(1.3);
    expect(CDP_COEFFICIENTS.SIMPLE).toBe(1.0);
    expect(CDP_COEFFICIENTS.APE).toBe(1.4);
    expect(CDP_COEFFICIENTS.OG).toBe(1.5);
  });

  it("the import boundary normalizes the historical label DPE → DEP", () => {
    expect(normalizeDeclarationType("DPE")).toBe("DEP");
    expect(normalizeDeclarationType("  dpe ")).toBe("DEP");
    expect(normalizeDeclarationType("DEP")).toBe("DEP");
    expect(normalizeDeclarationType("simple")).toBe("SIMPLE");
  });

  it("…and refuses to guess at anything else", () => {
    for (const junk of ["DP", "DEPE", "D.P.E", "", "  ", "EXPORT"]) {
      expect(normalizeDeclarationType(junk), junk).toBeNull();
    }
  });

  it("F-ICTD-05 / F-ICTD-06 — a historical DPE row computes exactly what a DEP row computes: 4,94", () => {
    const asDep = computeIctdDossier({
      invoiceCount: 2,
      shPositionCount: 5,
      tariffOrigin: "EFFITRANS",
      declarationType: "DEP",
      dpiRegime: "SANS_DPI",
      exemptionTitleOrigin: "SANS_OBJET",
      cotationCount: 0,
    });
    expect(asDep).toBe(4.94);

    // The normalization fixture: the value arrives labelled DPE.
    const normalized = normalizeDeclarationType("DPE");
    expect(normalized).toBe("DEP");
    const asHistoricalDpe = computeIctdDossier({
      invoiceCount: 2,
      shPositionCount: 5,
      tariffOrigin: "EFFITRANS",
      declarationType: normalized,
      dpiRegime: "SANS_DPI",
      exemptionTitleOrigin: "SANS_OBJET",
      cotationCount: 0,
    });
    expect(asHistoricalDpe).toBe(asDep);
  });
});

describe("D1 — the frozen ICTD parity fixtures still reproduce", () => {
  const base = {
    invoiceCount: 2,
    shPositionCount: 5,
    tariffOrigin: "EFFITRANS",
    dpiRegime: "SANS_DPI",
    exemptionTitleOrigin: "SANS_OBJET",
    cotationCount: 0,
  } as const;

  it("F-ICTD-01 — the methodology §5.4 example: 12,34 UTD, in the frozen rounding order", () => {
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
    ).toBe(12.34); // bloc 6,10 → ×1,40 = 8,54 → +3,80
  });

  it("F-ICTD-02 — simple minimal: 1,68", () => {
    expect(
      computeIctdDossier({
        invoiceCount: 1,
        shPositionCount: 1,
        tariffOrigin: "CLIENT",
        declarationType: "SIMPLE",
        dpiRegime: "SANS_DPI",
        exemptionTitleOrigin: "SANS_OBJET",
        cotationCount: 0,
      }),
    ).toBe(1.68);
  });

  it("F-ICTD-03/04/07 — SIMPLE 3,80 · APE 5,32 · OG 5,70", () => {
    expect(computeIctdDossier({ ...base, declarationType: "SIMPLE" })).toBe(3.8);
    expect(computeIctdDossier({ ...base, declarationType: "APE" })).toBe(5.32);
    expect(computeIctdDossier({ ...base, declarationType: "OG" })).toBe(5.7);
  });

  it("blank rules — missing CDP or DPI makes the dossier BLANK, never zero; empty counts coerce to 0", () => {
    expect(computeIctdDossier({ ...base, declarationType: null })).toBeNull();
    expect(computeIctdDossier({ ...base, declarationType: "DEP", dpiRegime: null as never })).toBeNull();
    expect(
      computeIctdDossier({
        ...base,
        declarationType: "SIMPLE",
        invoiceCount: null,
        shPositionCount: null,
      }),
    ).toBe(1.0); // ROUND(1 + 0 + 0) × 1,00
  });

  it("round2 is Excel ROUND — half away from zero", () => {
    expect(round2(6.105)).toBe(6.11);
    expect(round2(-6.105)).toBe(-6.11);
    expect(round2(6.1)).toBe(6.1);
  });
});

// ==================================================== D2 — reliability ====

describe("D2 — coverage no longer determines status; volume reliability stays", () => {
  it("< 80 % coverage cannot produce a status: coverage is not even an input", () => {
    // Structural retirement. The function's whole input surface is volume and
    // incident — reintroducing the mechanism means changing this signature.
    const status = reliabilityStatus({ dossierCount: 50, criticalIncident: false });
    expect(status).toBe("CLASSE");
    expect(reliabilityStatus.length).toBe(1);
  });

  it("« Non classé » no longer exists — its only producer was the retired coverage rung", () => {
    const all = new Set<string>();
    for (let n = 0; n <= 30; n++) {
      all.add(reliabilityStatus({ dossierCount: n, criticalIncident: false }));
      all.add(reliabilityStatus({ dossierCount: n, criticalIncident: true }));
    }
    expect([...all].sort()).toEqual(["AUCUNE_DONNEE", "CLASSE", "PROVISOIRE", "REVUE_MANAGERIALE"]);
  });

  it("< 10 dossiers remains PROVISOIRE — kept by the ruling, it is reliability, not completeness", () => {
    expect(MIN_DOSSIERS).toBe(10);
    expect(reliabilityStatus({ dossierCount: 9, criticalIncident: false })).toBe("PROVISOIRE");
    expect(reliabilityStatus({ dossierCount: 10, criticalIncident: false })).toBe("CLASSE");
    expect(reliabilityStatus({ dossierCount: 1, criticalIncident: false })).toBe("PROVISOIRE");
  });

  it("critical incident → Revue managériale, whatever the volume (GOV-09 preserved)", () => {
    expect(reliabilityStatus({ dossierCount: 100, criticalIncident: true })).toBe("REVUE_MANAGERIALE");
    expect(reliabilityStatus({ dossierCount: 3, criticalIncident: true })).toBe("REVUE_MANAGERIALE");
  });

  it("no dossiers → AUCUNE_DONNEE; only CLASSE is rankable (GOV-10 preserved)", () => {
    expect(reliabilityStatus({ dossierCount: 0, criticalIncident: false })).toBe("AUCUNE_DONNEE");
    expect(isRankable("CLASSE")).toBe(true);
    for (const s of ["AUCUNE_DONNEE", "PROVISOIRE", "REVUE_MANAGERIALE"] as const) {
      expect(isRankable(s), s).toBe(false);
    }
  });
});

// ==================================================== D3 — working days ====

describe("D3 — the frozen per-dossier délai (ICTD-D11)", () => {
  const NO_HOLIDAYS = new Set<string>();

  it("F-SLA-06 — holiday sensitivity: Fri→Mon is 1 without the férié, 0 with it", () => {
    // complete 2026-08-14 (Fri), BAE 2026-08-17 (Mon)
    expect(delaiJoursOuvres("2026-08-14", "2026-08-17", NO_HOLIDAYS)).toBe(1);
    expect(delaiJoursOuvres("2026-08-14", "2026-08-17", new Set(["2026-08-17"]))).toBe(0);
  });

  it("same-day = 0; weekends never count; floor at 0", () => {
    expect(delaiJoursOuvres("2026-08-14", "2026-08-14", NO_HOLIDAYS)).toBe(0);
    // Sat → Sun: zero working days in span, MAX(0, 0−1) = 0
    expect(delaiJoursOuvres("2026-08-15", "2026-08-16", NO_HOLIDAYS)).toBe(0);
    // Mon → Fri, one full week
    expect(delaiJoursOuvres("2026-08-10", "2026-08-14", NO_HOLIDAYS)).toBe(4);
  });

  it("an Effitrans company closure shortens the délai exactly like a férié — FERIES is the whole calendar", () => {
    const closure = new Set(["2026-08-12"]); // Wed, declared company closure
    expect(delaiJoursOuvres("2026-08-10", "2026-08-14", closure)).toBe(3);
  });

  it("a missing date makes the délai BLANK, never 0", () => {
    expect(delaiJoursOuvres(null, "2026-08-17", NO_HOLIDAYS)).toBeNull();
    expect(delaiJoursOuvres("2026-08-14", null, NO_HOLIDAYS)).toBeNull();
  });

  it("employee leave cannot alter the délai — it is not a parameter of the formula", () => {
    // The ruling, stated structurally: delaiJoursOuvres takes (complete, bae,
    // calendar) and nothing else. The identical inputs give the identical
    // délai whether or not anyone is on leave that week.
    expect(delaiJoursOuvres.length).toBe(3);
    const before = delaiJoursOuvres("2026-08-10", "2026-08-21", NO_HOLIDAYS);
    // …an employee's leave 2026-08-10..14 exists only in capacity space:
    const capacity = workedDaysInPeriod("2026-08-10", "2026-08-21", NO_HOLIDAYS, [
      { startISO: "2026-08-10", endISO: "2026-08-14", dayTenths: 50 },
    ]);
    expect(before).toBe(9);
    expect(capacity).toBe(5);
    expect(delaiJoursOuvres("2026-08-10", "2026-08-21", NO_HOLIDAYS)).toBe(before);
  });
});

describe("D3 — employee capacity (jours actifs)", () => {
  // August 2026: Sat 1 / Sun 2 … 31 days, 21 working days (Mon–Fri).
  const AUG = ["2026-08-01", "2026-08-31"] as const;
  const NONE = new Set<string>();

  it("base month: 21 working days, weekends already out", () => {
    expect(workedDaysInPeriod(AUG[0], AUG[1], NONE, [])).toBe(21);
  });

  it("a Senegal public holiday is excluded", () => {
    // Assomption — 2026-08-15 is a Saturday; use a weekday holiday instead to
    // prove the exclusion does the work (a weekend holiday must NOT double-count).
    const holidays = new Set(["2026-08-20"]); // Thu, férié
    expect(workedDaysInPeriod(AUG[0], AUG[1], holidays, [])).toBe(20);
    const weekendHoliday = new Set(["2026-08-15"]); // Sat — already non-working
    expect(workedDaysInPeriod(AUG[0], AUG[1], weekendHoliday, [])).toBe(21);
  });

  it("an Effitrans exceptional closure is excluded", () => {
    const closure = new Set(["2026-08-24"]); // Mon, fermeture exceptionnelle
    expect(workedDaysInPeriod(AUG[0], AUG[1], closure, [])).toBe(20);
  });

  it("a full-day leave is excluded", () => {
    expect(
      workedDaysInPeriod(AUG[0], AUG[1], NONE, [
        { startISO: "2026-08-05", endISO: "2026-08-05", dayTenths: 10 },
      ]),
    ).toBe(20);
  });

  it("a half-day of leave contributes 0,5 working day — the ratified value", () => {
    expect(
      workedDaysInPeriod(AUG[0], AUG[1], NONE, [
        { startISO: "2026-08-05", endISO: "2026-08-05", dayTenths: 5 },
      ]),
    ).toBe(20.5);
  });

  it("a leave spanning a weekend deducts only its working days", () => {
    // Thu 06 → Mon 10: Thu, Fri, Mon = 3 working days deducted.
    expect(
      workedDaysInPeriod(AUG[0], AUG[1], NONE, [
        { startISO: "2026-08-06", endISO: "2026-08-10", dayTenths: 50 },
      ]),
    ).toBe(18);
  });

  it("leave on a holiday does not deduct twice", () => {
    const holidays = new Set(["2026-08-20"]);
    // Leave covers the férié: the day is already out of the base.
    expect(
      workedDaysInPeriod(AUG[0], AUG[1], holidays, [
        { startISO: "2026-08-20", endISO: "2026-08-20", dayTenths: 10 },
      ]),
    ).toBe(20);
  });

  it("leave outside the period changes nothing; capacity floors at zero", () => {
    expect(
      workedDaysInPeriod(AUG[0], AUG[1], NONE, [
        { startISO: "2026-09-01", endISO: "2026-09-05", dayTenths: 50 },
      ]),
    ).toBe(21);
    expect(
      workedDaysInPeriod("2026-08-03", "2026-08-07", NONE, [
        { startISO: "2026-08-03", endISO: "2026-08-07", dayTenths: 50 },
        { startISO: "2026-08-03", endISO: "2026-08-07", dayTenths: 50 },
      ]),
    ).toBe(0);
  });

  it("networkDays refuses a reversed span rather than going negative", () => {
    expect(() => networkDays("2026-08-10", "2026-08-01", NONE)).toThrow();
  });
});
