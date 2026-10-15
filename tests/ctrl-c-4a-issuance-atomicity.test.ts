/**
 * CTRL-C-4A — an official invoice number is assigned exactly once.
 * ===========================================================================
 * THE DEFECT. Legacy `issueInvoice` read the invoice, decided eligibility with
 * `canIssue`, drew an official number from `invoice_counter`, and then wrote
 * `status` + `invoice_number` with only an id and tenant predicate. Nothing in
 * that sequence was atomic, so two simultaneous issuances both passed
 * `canIssue`, both drew a number, and both wrote. The second write overwrote
 * the first, so one official number vanished from the invoice while TWO
 * `invoice.issued` audit rows claimed it had been issued, each naming a
 * different number. An official invoice number is immutable and never reused,
 * which is what makes that a record-integrity defect rather than a nuisance.
 *
 * WHAT THIS SUITE DEFENDS. The shape of the fence, not its presence alone: the
 * predicates are on the row version `canIssue` was decided against, the result
 * is observable, and the refusal precedes everything that records an issuance.
 * A later edit that reorders those, or drops `.select("id")` so a zero-row
 * update reads as success, has to come through here first.
 *
 * SCOPE. Atomicity only. The status predicate is `DRAFT`, which is exactly what
 * `canIssue` already required, so eligibility is unchanged. That legacy
 * issuance accepts a DRAFT at all — skipping VALIDATED and its second pair of
 * eyes — is the separate CTRL-C-4B defect, asserted here as still present so
 * this slice cannot be mistaken for having fixed it.
 *
 * The behavioural half runs against real PostgreSQL in
 * tests/journey/invoice-issuance-atomicity.journey.ts (cases A to E).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { t } from "@/lib/i18n";
import { canIssue } from "@/lib/finance/status";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Assert on CODE, never on prose: this file's own comments name every token. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const legacy = strip(read("lib/finance/actions.ts"));
const governed = strip(read("lib/process/billing/actions.ts"));

/** The legacy issuance function only, bounded at the next exported function. */
const issuance = legacy.slice(
  legacy.indexOf("export async function issueInvoice"),
  legacy.indexOf("export async function voidInvoice"),
);

describe("CTRL-C-4A — the legacy issuance write is atomic", () => {
  it("1 — it compare-and-sets on the status it read AND on an unassigned number", () => {
    expect(issuance).toContain('.eq("status", "DRAFT")');
    expect(issuance).toContain('.is("invoice_number", null)');
  });

  it("2 — the outcome is observable: a zero-row update cannot read as success", () => {
    // PostgREST reports no error for an UPDATE that matched nothing, so the
    // row count is the only truthful signal.
    expect(issuance).toContain('.select("id")');
    expect(issuance).toContain('if ((issued?.length ?? 0) !== 1) return { ok: false, error: "already_issued" };');
  });

  it("3 — the predicates sit on the issuance write, not on some other statement", () => {
    const update = issuance.indexOf('.update({ status: "ISSUED", invoice_number: number');
    expect(update).toBeGreaterThan(-1);
    const cas = issuance.indexOf('.eq("status", "DRAFT")', update);
    const nullNum = issuance.indexOf('.is("invoice_number", null)', update);
    const select = issuance.indexOf('.select("id")', update);
    expect(cas).toBeGreaterThan(update);
    expect(nullNum).toBeGreaterThan(cas);
    expect(select).toBeGreaterThan(nullNum);
  });

  it("4 — the loser is refused BEFORE anything records an issuance", () => {
    const refusal = issuance.indexOf('error: "already_issued"');
    expect(refusal).toBeGreaterThan(-1);
    for (const consequence of [
      "AuditActions.INVOICE_ISSUED",
      "ensureOfficialInvoiceArtifact",
      "custInvoiceIssued",
      "revalidate(",
    ]) {
      expect(issuance.indexOf(consequence), consequence).toBeGreaterThan(refusal);
    }
  });

  it("5 — the refusal has its own French sentence, not a generic failure", () => {
    const errors = t.finance.errors as Record<string, string>;
    expect(errors.already_issued).toBeTruthy();
    expect(errors.already_issued.length).toBeGreaterThan(20);
    // and it is distinct from every other finance refusal
    const same = Object.entries(errors).filter(([k, v]) => k !== "already_issued" && v === errors.already_issued);
    expect(same).toEqual([]);
  });
});

describe("CTRL-C-4A — nothing else moved", () => {
  it("6 — eligibility is unchanged: canIssue still accepts exactly DRAFT", () => {
    expect(canIssue("DRAFT")).toBe(true);
    for (const s of ["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"] as const) {
      expect(canIssue(s), s).toBe(false);
    }
    // the fence mirrors that predicate rather than narrowing or widening it
    expect(issuance).toContain('if (!canIssue(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };');
  });

  it("7 — CTRL-C-4B is still open: legacy issuance still bypasses VALIDATED", () => {
    // RECORDED, NOT ENDORSED. The governed lane issues only from VALIDATED,
    // after a different person validated it. The legacy lane still goes
    // straight from DRAFT, which is the segregation-of-duties defect reserved
    // for CTRL-C-4B. This slice deliberately did not touch it, and this
    // assertion exists so that whoever closes it has to change a test here.
    expect(issuance).not.toContain('"VALIDATED"');
    expect(governed).toContain('.eq("status", "VALIDATED")');
  });

  it("8 — the governed lane's own fence is untouched", () => {
    expect(governed).toContain('.eq("status", "VALIDATED")');
    expect(governed).toContain('.is("invoice_number", null)');
    expect(governed).toContain('if ((issuedRows?.length ?? 0) !== 1) return fail("duplicate_submission");');
  });

  it("9 — the ratified ordering of validation, allocation and the PDF is preserved", () => {
    const validate = issuance.indexOf("validateIssuance(");
    const allocate = issuance.indexOf("next_invoice_number");
    const artifact = issuance.indexOf("ensureOfficialInvoiceArtifact");
    expect(allocate).toBeGreaterThan(validate); // refuse while refusing is free
    expect(artifact).toBeGreaterThan(allocate); // the PDF carries the number
  });

  it("10 — no permission, no status value and no numbering format changed", () => {
    expect(issuance).toContain('assertPermission("finance:issue")');
    expect(issuance).toContain('assertControlStep("finance.invoice_issue"');
    // the allocator is untouched; the format lives in SQL, not here
    expect(issuance).toContain('supabase.rpc("next_invoice_number", { p_tenant: user.tenantId })');
    expect(issuance).not.toContain("EFT-INV-");
  });

  it("11 — this slice ships no migration", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
    expect(files.filter((f) => f.endsWith(".sql"))).toHaveLength(151);
  });
});
