/**
 * FIN-AGING-1 — the pure Aging Balance engine.
 *
 * The rules under test are not this codebase's inventions: they were extracted
 * from the Finance Manager's workbook and verified against all 430 of its rows
 * during FIN-AGING-0, then ratified. What made that worth doing is that two of
 * them are counter-intuitive and would have been got wrong by reasoning from the
 * labels alone:
 *
 *   * an invoice due TODAY is « Non échu » — not overdue, not its own bucket;
 *   * client-level risk has NO « Non échu » level. A client whose average delay
 *     is negative is « Faible ». Eight clients in the reference report proved it.
 *
 * Everything else here defends properties a finance report has to have: the five
 * views must reconcile, shares must sum to exactly 100 %, money must never touch
 * a float, and a transaction dated after the arrêté must not move a historical
 * figure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AGING_BALANCE_V1,
  BUCKET_KEYS,
  MoneyError,
  RISK_LABEL_DASHBOARD_FR,
  RISK_LABEL_FR,
  apportionBasisPoints,
  balanceAsOf,
  buildAgingReport,
  classifyDays,
  clientRisk,
  differenceInDays,
  isCritical,
  isoDate,
  money,
  parseAmount,
  sum,
  type InvoiceInput,
} from "@/lib/finance/aging";
import {
  ARRETE,
  CURRENCY,
  M,
  OTHER_TENANT,
  TENANT,
  boundaryInvoices,
  dueDaysBeforeArrete,
  futureOnlyClient,
  invoice,
  payment,
  portfolio,
  creditNote,
  debitAdjustment,
} from "./fixtures/aging-synthetic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const build = (invoices: readonly InvoiceInput[], overrides = {}) =>
  buildAgingReport(invoices, {
    tenantId: TENANT,
    reportingDate: ARRETE,
    currency: CURRENCY,
    ...overrides,
  });

// ===========================================================================
describe("money never touches a float", () => {
  it("rejects anything that is not a whole number of minor units", () => {
    expect(() => money(1234.56)).toThrow(MoneyError);
    expect(() => money(NaN)).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });

  it("parses decimal strings WITHOUT going through Number()", () => {
    // Number("0.07") * 100 === 7.000000000000001 — the bug this module prevents.
    expect(parseAmount("0.07")).toBe(7);
    expect(parseAmount("1234.56")).toBe(123456);
    expect(parseAmount("1000000")).toBe(100000000);
    expect(parseAmount("-12.30")).toBe(-1230);
  });

  it("refuses to silently drop a centime", () => {
    expect(() => parseAmount("1.005")).toThrow(MoneyError);
    expect(() => parseAmount("abc")).toThrow(MoneyError);
  });

  it("sums exactly where floats would drift", () => {
    const cents = Array.from({ length: 1000 }, () => money(7)); // 0,07 × 1000
    expect(sum(cents)).toBe(7000); // exactly 70,00 — 0.07*1000 in floats is 69.99999999999999
  });

  it("the engine holds no float-money arithmetic", () => {
    for (const f of ["money.ts", "balance.ts", "report.ts", "share.ts"]) {
      const src = code(`lib/finance/aging/${f}`);
      expect(src, f).not.toMatch(/toFixed\(/);
      expect(src, f).not.toMatch(/parseFloat\(/);
    }
  });
});

// ===========================================================================
describe("the reporting date is a parameter, never a clock", () => {
  it("no engine file reads the clock", () => {
    for (const f of ["money.ts", "dates.ts", "buckets.ts", "balance.ts", "share.ts", "report.ts", "types.ts"]) {
      const src = code(`lib/finance/aging/${f}`);
      expect(src, f).not.toMatch(/Date\.now\(\)/);
      expect(src, f).not.toMatch(/new Date\(\)/);
      expect(src, f).not.toMatch(/Math\.random/);
    }
  });

  it("counts whole calendar days, signed", () => {
    expect(differenceInDays(isoDate("2026-06-12"), isoDate("2026-06-12"))).toBe(0);
    expect(differenceInDays(isoDate("2026-06-11"), isoDate("2026-06-12"))).toBe(1);
    expect(differenceInDays(isoDate("2026-07-12"), isoDate("2026-06-12"))).toBe(-30);
    // across a leap day
    expect(differenceInDays(isoDate("2024-02-28"), isoDate("2024-03-01"))).toBe(2);
  });

  it("rejects a date that does not exist", () => {
    expect(() => isoDate("2026-02-30")).toThrow();
    expect(() => isoDate("12/06/2026")).toThrow();
  });
});

// ===========================================================================
describe("bucket boundaries — the ratified ladder", () => {
  const cases: [number, string, string][] = [
    [-122, "NON_ECHU", "Non échu"],
    [-1, "NON_ECHU", "Non échu"],
    [0, "NON_ECHU", "Non échu"], // DUE TODAY IS NOT OVERDUE
    [1, "D1_30", "Faible"],
    [30, "D1_30", "Faible"],
    [31, "D31_60", "Modéré"],
    [60, "D31_60", "Modéré"],
    [61, "D61_90", "Modéré"],
    [90, "D61_90", "Modéré"],
    [91, "D91_180", "Élevé"],
    [180, "D91_180", "Élevé"],
    [181, "D181_365", "Élevé"],
    [365, "D181_365", "Élevé"],
    [366, "OVER_365", "Critique"],
    [2505, "OVER_365", "Critique"],
  ];

  it.each(cases)("%i days → %s (%s)", (days, bucketKey, riskLabel) => {
    const b = classifyDays(days);
    expect(b.key).toBe(bucketKey);
    expect(RISK_LABEL_FR[b.risk]).toBe(riskLabel);
  });

  it("classification is total — every integer lands in exactly one bucket", () => {
    for (let d = -400; d <= 400; d++) {
      const matches = AGING_BALANCE_V1.filter(
        (b) => (b.minDays === null || d >= b.minDays) && (b.maxDays === null || d <= b.maxDays),
      );
      expect(matches, `${d} days`).toHaveLength(1);
    }
  });

  it("carries two label sets for one classification — intentional, not drift", () => {
    expect(RISK_LABEL_FR.MODERE).toBe("Modéré");
    expect(RISK_LABEL_DASHBOARD_FR.MODERE).toBe("🟠 Modéré");
    expect(RISK_LABEL_DASHBOARD_FR.NON_ECHU).toBe("✅ Sain");
    expect(RISK_LABEL_DASHBOARD_FR.CRITIQUE).toBe("⛔ Critique");
  });

  it("uses the workbook's exact bucket labels", () => {
    expect(AGING_BALANCE_V1.map((b) => b.labelFr)).toEqual([
      "Non échu (≤ 0 j)", "1 – 30 jours", "31 – 60 jours", "61 – 90 jours",
      "91 – 180 jours", "181 – 365 jours", "> 365 jours",
    ]);
  });
});

// ===========================================================================
describe("critical selection", () => {
  it("366 is critical, 365 is not — the sole criterion", () => {
    expect(isCritical(365)).toBe(false);
    expect(isCritical(366)).toBe(true);
  });

  it("no amount threshold participates", () => {
    const tiny = invoice({ dueDate: dueDaysBeforeArrete(400), originalAmount: M(1) });
    const vm = build([tiny]);
    expect(vm.critical).toHaveLength(1); // a 1 FCFA invoice 400 days late is still critical
  });

  it("the list is sorted by days overdue, descending", () => {
    const vm = build(boundaryInvoices());
    const days = vm.critical.map((r) => r.daysOverdue);
    expect(days).toEqual([...days].sort((a, b) => b - a));
    expect(days).toEqual([2505, 366]);
  });
});

// ===========================================================================
describe("client risk floors at Faible — the rule the labels do not reveal", () => {
  it("a client whose invoices are ALL in the future is Faible, never Non échu", () => {
    const vm = build(futureOnlyClient());
    const client = vm.clients[0];
    expect(client.averageDaysOverdue).toBeLessThan(0);
    expect(client.risk).toBe("FAIBLE");
    expect(client.riskLabelFr).toBe("Faible");
  });

  it("the floor applies across the whole non-positive range", () => {
    for (const avg of [-500, -44, -1, 0, 1, 30]) {
      expect(clientRisk(avg), `avg ${avg}`).toBe("FAIBLE");
    }
  });

  it("above the floor the client scale follows the bucket risks", () => {
    expect(clientRisk(31)).toBe("MODERE");
    expect(clientRisk(90)).toBe("MODERE");
    expect(clientRisk(91)).toBe("ELEVE");
    expect(clientRisk(365)).toBe("ELEVE");
    expect(clientRisk(366)).toBe("CRITIQUE");
  });

  it("row-level classification is UNaffected by the client floor", () => {
    const vm = build(futureOnlyClient());
    expect(vm.rows.every((r) => r.risk === "NON_ECHU")).toBe(true);
  });
});

// ===========================================================================
describe("outstanding balance as of the reporting date", () => {
  it("a partial payment reduces the amount and does NOT restart the clock", () => {
    const inv = invoice({
      dueDate: dueDaysBeforeArrete(100),
      originalAmount: M(1_000_000),
      allocations: [payment(400_000, "2026-05-01")],
    });
    const vm = build([inv]);
    expect(vm.rows[0].outstanding).toBe(M(600_000));
    expect(vm.rows[0].originalAmount).toBe(M(1_000_000)); // Q-01: both retained
    expect(vm.rows[0].daysOverdue).toBe(100); // clock unchanged by the payment
    expect(vm.rows[0].bucket).toBe("D91_180");
  });

  it("a fully settled invoice is excluded", () => {
    const inv = invoice({
      dueDate: dueDaysBeforeArrete(50),
      originalAmount: M(500_000),
      allocations: [payment(500_000, "2026-05-01")],
    });
    const vm = build([inv]);
    expect(vm.rows).toHaveLength(0);
    expect(vm.exclusions[0].reason).toBe("SETTLED");
  });

  it("a zero balance never appears in the aged population", () => {
    const vm = build(portfolio());
    expect(vm.rows.every((r) => r.outstanding > 0)).toBe(true);
  });

  it("overpayment never creates a negative receivable", () => {
    const inv = invoice({
      dueDate: dueDaysBeforeArrete(20),
      originalAmount: M(100_000),
      allocations: [payment(120_000, "2026-04-01")],
    });
    const vm = build([inv]);
    expect(vm.rows).toHaveLength(0);
    expect(vm.kpis.totalOutstanding).toBe(0);
    // The excess is reported, not netted into the portfolio.
    expect(vm.unappliedCredits).toHaveLength(1);
    expect(vm.unappliedCredits[0].amount).toBe(M(20_000));
  });

  it("credit notes and adjustments move the balance in the right directions", () => {
    const inv = invoice({
      dueDate: dueDaysBeforeArrete(40),
      originalAmount: M(1_000_000),
      allocations: [creditNote(200_000, "2026-05-01"), debitAdjustment(50_000, "2026-05-02")],
    });
    expect(build([inv]).rows[0].outstanding).toBe(M(850_000));
  });

  it("allocation is explicit — the engine never invents a FIFO spread", () => {
    const src = code("lib/finance/aging/balance.ts");
    expect(src).not.toMatch(/fifo/i);
    // Only allocations attached to the invoice are considered.
    const inv = invoice({ dueDate: dueDaysBeforeArrete(40), originalAmount: M(500_000) });
    expect(build([inv]).rows[0].outstanding).toBe(M(500_000));
  });

  it("a negative allocation magnitude is refused rather than double-negated", () => {
    const bad = invoice({
      dueDate: dueDaysBeforeArrete(10),
      allocations: [{ kind: "PAYMENT", amount: money(-5000), effectiveDate: ARRETE, reversedOn: null }],
    });
    expect(() => build([bad])).toThrow(/positive magnitudes/);
  });
});

// ===========================================================================
describe("post-reporting-date transactions do not touch history", () => {
  const base = () =>
    invoice({ dueDate: dueDaysBeforeArrete(100), originalAmount: M(1_000_000) });

  it("a payment dated AFTER the arrêté is ignored", () => {
    const withLate = { ...base(), allocations: [payment(400_000, "2026-07-01")] };
    expect(build([withLate]).rows[0].outstanding).toBe(M(1_000_000));
  });

  it("a payment dated ON the arrêté counts", () => {
    const onDate = { ...base(), allocations: [payment(400_000, "2026-06-12")] };
    expect(build([onDate]).rows[0].outstanding).toBe(M(600_000));
  });

  it("a reversal AFTER the arrêté leaves the historical figure intact", () => {
    // The payment was real on 12 June; that it was reversed in July is later
    // knowledge and must not rewrite June.
    const inv = { ...base(), allocations: [payment(400_000, "2026-05-01", "2026-07-15")] };
    expect(build([inv]).rows[0].outstanding).toBe(M(600_000));
  });

  it("a reversal ON OR BEFORE the arrêté means the payment never counted", () => {
    const inv = { ...base(), allocations: [payment(400_000, "2026-05-01", "2026-06-01")] };
    expect(build([inv]).rows[0].outstanding).toBe(M(1_000_000));
  });

  it("an invoice cancelled after the arrêté is still a receivable at the arrêté", () => {
    const inv = invoice({
      dueDate: dueDaysBeforeArrete(30),
      originalAmount: M(700_000),
      cancelledOn: isoDate("2026-08-01"),
      status: "VOID",
    });
    expect(build([inv]).rows).toHaveLength(1);
  });

  it("an invoice issued after the arrêté does not appear", () => {
    const inv = invoice({ dueDate: dueDaysBeforeArrete(-5), issueDate: isoDate("2026-06-20") });
    const vm = build([inv]);
    expect(vm.rows).toHaveLength(0);
    expect(vm.exclusions[0].reason).toBe("NOT_YET_ISSUED");
  });
});

// ===========================================================================
describe("population rules, each with a stated reason", () => {
  it("classifies every exclusion", () => {
    const vm = build(portfolio());
    const reasons = vm.exclusions.map((e) => e.reason).sort();
    expect(reasons).toEqual(
      ["CANCELLED", "DRAFT", "FOREIGN_CURRENCY", "MISSING_DUE_DATE", "SETTLED", "SETTLED"].sort(),
    );
  });

  it("a missing due date is reported with its amount, never aged, never called overdue", () => {
    const vm = build(portfolio());
    const missing = vm.exclusions.find((e) => e.reason === "MISSING_DUE_DATE")!;
    expect(missing.outstanding).toBe(M(150_000));
    expect(vm.rows.some((r) => r.invoiceId === missing.invoiceId)).toBe(false);
  });

  it("a foreign currency is excluded, never converted", () => {
    const vm = build(portfolio());
    const foreign = vm.exclusions.find((e) => e.reason === "FOREIGN_CURRENCY")!;
    expect(foreign.currency).toBe("EUR");
    expect(code("lib/finance/aging/report.ts")).not.toMatch(/exchangeRate|convert/i);
  });

  it("a disputed invoice stays visible with its balance unchanged", () => {
    const vm = build(portfolio());
    const disputed = vm.rows.find((r) => r.disputed)!;
    expect(disputed).toBeDefined();
    expect(disputed.outstanding).toBe(M(250_000));
    expect(disputed.bucket).toBe("D61_90"); // aged normally — dispute is a marker, not a freeze
  });

  it("refuses to mix tenants", () => {
    const foreign = { ...invoice({ dueDate: dueDaysBeforeArrete(10) }), tenantId: OTHER_TENANT };
    expect(() => build([foreign])).toThrow(/belongs to tenant/);
  });

  it("carries the tenant through every row of the output", () => {
    const vm = build(portfolio());
    expect(vm.tenantId).toBe(TENANT);
    expect(vm.rows.every((r) => r.tenantId === TENANT)).toBe(true);
  });
});

// ===========================================================================
describe("shares sum to exactly 100 %", () => {
  it("apportions basis points with no drift", () => {
    const shares = apportionBasisPoints([1, 1, 1]); // the classic 33.33 % problem
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(shares).toEqual([3334, 3333, 3333]);
  });

  it("holds for a large ragged portfolio", () => {
    const amounts = Array.from({ length: 70 }, (_, i) => (i + 1) * 7919);
    expect(apportionBasisPoints(amounts).reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("an empty or zero portfolio has no shares — 0/0 is not 100 %", () => {
    expect(apportionBasisPoints([])).toEqual([]);
    expect(apportionBasisPoints([0, 0])).toEqual([0, 0]);
  });

  it("is deterministic for equal inputs", () => {
    expect(apportionBasisPoints([5, 5, 5, 5, 5, 5, 5])).toEqual(
      apportionBasisPoints([5, 5, 5, 5, 5, 5, 5]),
    );
  });
});

// ===========================================================================
describe("the five views reconcile — proven on every build", () => {
  it("every reconciliation check passes for the boundary dataset", () => {
    const vm = build(boundaryInvoices());
    expect(vm.reconciliation.every((c) => c.ok)).toBe(true);
    expect(vm.reconciliation.length).toBeGreaterThanOrEqual(12);
  });

  it("raw rows, dashboard, client analysis and charts state one number", () => {
    const vm = build(portfolio());
    const rowTotal = sum(vm.rows.map((r) => r.outstanding));
    expect(vm.kpis.totalOutstanding).toBe(rowTotal);
    expect(sum(vm.buckets.map((b) => b.amount))).toBe(rowTotal);
    expect(sum(vm.clients.map((c) => c.amount))).toBe(rowTotal);
    expect(sum(vm.charts.bucketAmounts.values.map((v) => money(v)))).toBe(rowTotal);
  });

  it("the critical list, the > 365 bucket and « Montant > 1 an » agree", () => {
    const vm = build(portfolio());
    const over365 = vm.buckets.find((b) => b.bucket === "OVER_365")!;
    expect(vm.criticalTotal.amount).toBe(over365.amount);
    expect(vm.criticalTotal.invoiceCount).toBe(over365.invoiceCount);
    expect(vm.kpis.amountOverOneYear).toBe(vm.criticalTotal.amount);
  });

  it("counts agree across tabs", () => {
    const vm = build(portfolio());
    expect(vm.buckets.reduce((n, b) => n + b.invoiceCount, 0)).toBe(vm.rows.length);
    expect(vm.clients.reduce((n, c) => n + c.invoiceCount, 0)).toBe(vm.rows.length);
    expect(vm.kpis.invoiceCount).toBe(vm.rows.length);
    expect(vm.kpis.clientCount).toBe(vm.clients.length);
  });

  it("the Top-10 chart is the head of the client ranking", () => {
    const vm = build(portfolio());
    expect(vm.charts.topClients.categories).toEqual(
      vm.clients.slice(0, 10).map((c) => c.clientName),
    );
  });

  it("all seven buckets are always present, zeros included", () => {
    const vm = build([invoice({ dueDate: dueDaysBeforeArrete(5) })]);
    expect(vm.buckets.map((b) => b.bucket)).toEqual([...BUCKET_KEYS]);
    expect(vm.buckets.filter((b) => b.invoiceCount === 0)).toHaveLength(6);
  });

  it("an empty report is coherent rather than a crash", () => {
    const vm = build([]);
    expect(vm.rows).toHaveLength(0);
    expect(vm.kpis.totalOutstanding).toBe(0);
    expect(vm.kpis.averageDaysOverdue).toBeNull();
    expect(vm.reconciliation.every((c) => c.ok)).toBe(true);
  });
});

// ===========================================================================
describe("client aggregation", () => {
  it("ranks descending by outstanding", () => {
    const vm = build(portfolio());
    const amounts = vm.clients.map((c) => c.amount as number);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it("computes average and maximum delay per client", () => {
    const vm = build(boundaryInvoices());
    const c = vm.clients[0];
    expect(c.invoiceCount).toBe(15);
    expect(c.maxDaysOverdue).toBe(2505);
    const expectedAvg = Math.round(
      vm.rows.reduce((n, r) => n + r.daysOverdue, 0) / vm.rows.length,
    );
    expect(c.averageDaysOverdue).toBe(expectedAvg);
  });
});

// ===========================================================================
describe("determinism", () => {
  it("identical inputs produce an identical view model", () => {
    const a = JSON.stringify(build(portfolio()));
    const b = JSON.stringify(build(portfolio()));
    expect(a).toBe(b);
  });

  it("input order does not change the output", () => {
    const p = portfolio();
    const straight = build(p);
    const shuffled = build([...p].reverse());
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(straight));
  });

  it("the arrêté drives the figures — a different date gives different aging", () => {
    const p = portfolio();
    const june = build(p);
    const july = build(p, { reportingDate: isoDate("2026-07-12") });
    expect(july.rows[0].daysOverdue).toBe(june.rows[0].daysOverdue + 30);
  });
});

// ===========================================================================
describe("« Retard moyen » population is an input, not a guess (Q-04 open)", () => {
  it("defaults to all rows and says so in the view model", () => {
    const vm = build(portfolio());
    expect(vm.kpis.averageDelayPopulation).toBe("ALL_ROWS");
  });

  it("OVERDUE_ONLY excludes not-yet-due rows from the mean", () => {
    const invoices = [
      invoice({ dueDate: dueDaysBeforeArrete(-100), originalAmount: M(100_000) }),
      invoice({ dueDate: dueDaysBeforeArrete(100), originalAmount: M(100_000) }),
    ];
    expect(build(invoices).kpis.averageDaysOverdue).toBe(0); // mean(-100, 100)
    expect(build(invoices, { averageDelayPopulation: "OVERDUE_ONLY" }).kpis.averageDaysOverdue).toBe(100);
  });
});

// ===========================================================================
describe("the phase stays DARK and the layers stay independent", () => {
  const FILES = ["money.ts", "dates.ts", "buckets.ts", "balance.ts", "share.ts", "report.ts", "types.ts", "index.ts"];

  it("the engine imports no Excel, PDF, UI, Supabase, Next or storage code", () => {
    for (const f of FILES) {
      const src = read(`lib/finance/aging/${f}`);
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec.startsWith("./"), `${f} imports ${spec} — engine must be self-contained`).toBe(true);
      }
    }
  });

  it("declares no server-only, no client component, no server action", () => {
    for (const f of FILES) {
      const src = read(`lib/finance/aging/${f}`);
      expect(src, f).not.toContain('"use server"');
      expect(src, f).not.toContain('"use client"');
      expect(src, f).not.toContain("server-only");
    }
  });

  it("no RENDERER ships — the engine feeds a screen, not a file", () => {
    // FIN-AGING-3 gave the engine a read-only route, so this no longer claims
    // that nothing consumes it; that route's own guarantees are proven in
    // tests/fin-aging-workspace.test.ts. What this phase still owns is that no
    // Excel or PDF renderer exists to turn a report into a distributable
    // artifact — that is FIN-AGING-6/7 and it has not happened.
    for (const p of ["lib/finance/aging/xlsx.ts", "lib/finance/aging/pdf.ts"]) {
      let exists = true;
      try { read(p); } catch { exists = false; }
      expect(exists, p).toBe(false);
    }
  });

  it("the engine has exactly ONE data-layer consumer — the read service", () => {
    // The engine must not sprout callers that assemble AR inputs their own way;
    // every route reaches it through lib/finance/aging/server/read-service.ts,
    // which is the single place that knows how to turn canonical Finance rows
    // into engine inputs. Existing finance and collections code is untouched.
    for (const p of ["lib/finance/actions.ts", "lib/finance/service.ts", "lib/collections/service.ts"]) {
      expect(read(p), p).not.toContain("finance/aging");
    }
    expect(read("lib/finance/aging/server/read-service.ts")).toContain("buildAgingReport");
  });
});

// ===========================================================================
describe("fixtures carry no real Effitrans data", () => {
  // The reference workbook reached us partially anonymized — its Graphiques tab
  // still listed real clients with amounts — and this repository is public.
  //
  // This guard is a WHITELIST, deliberately. The obvious implementation lists the
  // real client names and asserts their absence, which would publish those very
  // names in a public test file — the leak it was written to prevent. A whitelist
  // also catches data nobody thought to blacklist.
  const TEMPLATE_VOCABULARY = new Set([
    "Tranche d'ancienneté", "Nb factures", "Montant (FCFA)", "Part encours", "Nb clients",
    "Retard moyen", "Niveau de risque", "Non échu (≤ 0 j)", "1 – 30 jours", "31 – 60 jours",
    "61 – 90 jours", "91 – 180 jours", "181 – 365 jours", "> 365 jours", "TOTAL GÉNÉRAL",
    "✅ Sain", "🟡 Faible", "🟠 Modéré", "🔴 Élevé", "⛔ Critique", "Total encours",
    "Montant en retard", "Montant > 1 an", "Facture", "Date édition", "Échéance", "Dossier",
    "Client", "Jours retard", "Tranche", "Risque", "Montant total (FCFA)", "Retard moy. (j)",
    "Retard max (j)", "Part encours (%)", "Niveau risque", "TOTAL", "Commentaires",
    "TOTAL – Dossiers critiques", "% Montant", "TOP 10 CLIENTS", "% Total",
    "TABLEAU DE BORD – RECOUVREMENT  |  Balance âgée arrêtée au {ARRETE_LONG}",
    "Service Recouvrement & Finance  —  Arrêté au {ARRETE_SHORT}",
    "DONNÉES BRUTES – Recouvrement en cours – Arrêté au {ARRETE_SHORT}",
    "ANALYSE PAR CLIENT – Classement décroissant par encours",
    "DOSSIERS CRITIQUES – Factures avec retard > 365 jours",
    "GRAPHIQUES – Analyse de la Balance Âgée",
  ]);

  it("every cell value in the structural fixture is fixed template vocabulary", () => {
    const fixture = JSON.parse(read("tests/fixtures/aging-workbook-structure.json"));
    for (const [sheetName, sheet] of Object.entries<Record<string, unknown>>(fixture.sheets)) {
      const cells = sheet.cells as Record<string, { v?: unknown }>;
      for (const [ref, cell] of Object.entries(cells)) {
        if (cell.v === undefined) continue; // value stripped — the normal case
        expect(
          TEMPLATE_VOCABULARY.has(String(cell.v)),
          `${sheetName}!${ref} holds ${JSON.stringify(cell.v)}, which is not template vocabulary`,
        ).toBe(true);
      }
    }
  });

  it("the structural fixture carries no numeric cell values at all", () => {
    const fixture = JSON.parse(read("tests/fixtures/aging-workbook-structure.json"));
    for (const sheet of Object.values<Record<string, unknown>>(fixture.sheets)) {
      for (const cell of Object.values(sheet.cells as Record<string, { v?: unknown }>)) {
        expect(typeof cell.v === "number").toBe(false);
      }
    }
  });

  it("synthetic client names are obvious placeholders", () => {
    const src = read("tests/fixtures/aging-synthetic.ts");
    const names = [...src.matchAll(/clientName:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n, n).toMatch(/^Client /);
  });

  it("the structural fixture keeps formatting metadata and drops business values", () => {
    const fixture = JSON.parse(read("tests/fixtures/aging-workbook-structure.json"));
    // Structure survives…
    expect(fixture.sheetNamesWithEmoji).toEqual([
      "📊 Tableau de Bord", "📋 Données Brutes", "👥 Analyse Clients",
      "⛔ Dossiers Critiques", "📈 Graphiques",
    ]);
    expect(fixture.customNumberFormats["164"]).toBe("#,##0\\ [$FCFA]");
    expect(fixture.charts).toHaveLength(3);
    expect(fixture.charts.map((c: { type: string }) => c.type)).toEqual([
      "barChart", "pieChart", "barChart",
    ]);
    // …and the arrêté date is tokenised out of the titles rather than baked in.
    const dashboard = fixture.sheets["Tableau de Bord"];
    expect(JSON.stringify(dashboard.cells)).toContain("{ARRETE_LONG}");
    expect(JSON.stringify(dashboard.cells)).not.toContain("12/06/2026");
  });

  it("no spreadsheet is tracked, and the ignore rule keeps it that way", () => {
    expect(read(".gitignore")).toMatch(/^\*\.xlsx$/m);
  });
});

// ===========================================================================
describe("engine rules match the ratified specification document", () => {
  const spec = read("docs/finance/aging/aging-calculation-spec.md");

  it("the spec and the code agree on the seven labels", () => {
    for (const b of AGING_BALANCE_V1) expect(spec, b.labelFr).toContain(b.labelFr);
  });

  it("the spec records the critical threshold the code enforces", () => {
    expect(spec).toContain("d ≥ 366");
    expect(spec).toContain("366 included, d = 365 excluded");
  });

  it("balanceAsOf implements the ratified formula", () => {
    const src = code("lib/finance/aging/balance.ts");
    expect(src).toContain("isEffectiveAsOf");
    expect(src).toContain("clampAtZero");
  });
});
