/**
 * OPS-CUSTOMS-GAINDE-04 slices 8-10 — two GAINDE acts, told apart.
 * ---------------------------------------------------------------------------
 * THE RATIFIED FACTS (DEC-C37..C39). The Déclarant prepares the declaration,
 * performs the saisie in GAINDE, receives a declaration/reference number, and
 * records THAT (step 6). Finance then performs a different act: the GAINDE
 * registration WITH the duties and taxes — an actual PAYMENT, with a breakdown
 * of the individual taxes.
 *
 * WHY ONE COLUMN COULD NOT CARRY BOTH, which is the load-bearing fact of this
 * whole slice and not a matter of taste. `record_gainde_registration` refuses a
 * reference identical to the one already stored. So a Déclarant who typed the
 * true GAINDE number into `external_ref` at step 6 would make Finance's step 9
 * PERMANENTLY unperformable, and `gainde_registration` permanently
 * unsatisfiable. The two acts needed two columns because one of them refuses to
 * repeat the other.
 *
 * MIGRATION 20261001000001 IS WRITTEN AND NOT APPLIED. These assertions are on
 * the SQL and the application layer, both of which ship now; the schema is
 * applied under the #139+ policy, on approval, with its verifier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTROL_OWNING_STEP } from "@/lib/process/control-gate";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIG = "supabase/migrations/20261001000001_gainde_declaration_and_tax_payment.sql";
const VERIFY = "supabase/verifiers/20261001000001_gainde_declaration_and_tax_payment.verify.sql";
const sql = read(MIG);
const sqlCode = sql.replace(/^\s*--.*$/gm, "");
const actions = code("lib/customs/actions.ts");

/** One function of the migration, bounded so a neighbour cannot satisfy a pin. */
function fn(name: string): string {
  const i = sqlCode.indexOf(`function public.${name}(`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const rest = sqlCode.slice(i);
  const end = rest.indexOf("$$;");
  expect(end, `${name} has no terminator`).toBeGreaterThan(0);
  return rest.slice(0, end);
}

// ===========================================================================
// THE INVARIANT
// ===========================================================================

describe("capture is not registration, and they do not share a column", () => {
  it("01 — the Déclarant's reference has a column of its own", () => {
    expect(sqlCode).toContain("add column if not exists gainde_declaration_reference");
    expect(sqlCode).toContain("add column if not exists gainde_declaration_recorded_by");
    expect(sqlCode).toContain("add column if not exists gainde_declaration_recorded_at");
  });

  it("02 — and it is NOT external_ref, which stays Finance's", () => {
    // The mechanical reason, restated where it can fail: the registration RPC
    // refuses a duplicate reference, so sharing the column would disable step 9.
    // Whitespace-tolerant: the payload is column-aligned, and pinning where the
    // spaces fall would test the formatter.
    const flat = (x: string) => x.replace(/\s+/g, " ");
    expect(flat(fn("record_declaration_reference"))).toContain("gainde_declaration_reference = v_ref");
    expect(flat(fn("record_declaration_reference"))).not.toContain("external_ref =");
    expect(flat(fn("record_gainde_registration"))).toContain("external_ref = v_ref");
    expect(fn("record_gainde_registration")).toContain("reference_unchanged");
  });

  it("03 — half a fact is refused: reference, author and date travel together", () => {
    expect(sqlCode).toContain("customs_declaration_reference_complete");
  });

  it("04 — the two acts have two owning steps, and two owners", () => {
    expect(CONTROL_OWNING_STEP["customs.declaration_reference"]).toBe("customs_preparation");
    expect(CONTROL_OWNING_STEP["customs.gainde_registration"]).toBe("gainde_registration");
  });

  it("05 — and two permissions: `customs:register` is NOT widened to the Déclarant", () => {
    expect(fn("record_declaration_reference")).toContain("'customs:update'");
    expect(fn("record_gainde_registration")).toContain("'customs:register'");
    const declarant = code("lib/platform/role-templates.ts");
    const block = declarant.slice(declarant.indexOf('key: "CUSTOMS_DECLARANT"'));
    expect(block.slice(0, 1400)).not.toContain('"customs:register"');
  });
});

// ===========================================================================
// SLICE 8 — the Déclarant's act
// ===========================================================================

describe("the Déclarant records his reference, through a gated action", () => {
  it("06 — the action exists and reuses customs:update", () => {
    expect(actions).toContain("export async function recordDeclarationReference(");
    const slice = actions.slice(actions.indexOf("export async function recordDeclarationReference"));
    expect(slice.slice(0, 2500)).toContain('assertPermission("customs:update")');
  });

  it("07 — behind BOTH the step gate and the ownership rule", () => {
    const slice = actions.slice(actions.indexOf("export async function recordDeclarationReference"));
    expect(slice.slice(0, 2500))
      .toContain('customsControlGate("customs.declaration_reference", rec.file_id, user)');
  });

  it("08 — and the panel draws it on the server's verdict, never on permission alone", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toContain('{canUpdate && owns("customs.declaration_reference") && (');
    expect(panel).toContain('disabled={pending || !gateOpen("customs.declaration_reference")}');
    // A control absent from the page's verdict array is drawn UNGATED by the
    // panel's `?? true` fallback — the exact drift the array exists to end.
    expect(code("app/files/[id]/page.tsx")).toContain('"customs.declaration_reference",');
  });

  it("09 — a typo is correctable, and a correction after validation needs a motif", () => {
    // D4 is not weakened: the five governed elements keep their own door, and
    // this column is not one of them. But a reference that became permanently
    // unfixable at validation would repeat the defect D4 was written about.
    const f = fn("record_declaration_reference");
    expect(f).toContain("v_reviewed is not null and v_reason is null");
    expect(f).toContain("reason_required");
    expect(f).toContain("CUSTOMS_DECLARATION_REFERENCE_CORRECTED");
  });

  it("10 — the reader who cannot edit still SEES it (UI-5)", () => {
    const panel = read("components/customs/customs-panel.tsx");
    const view = panel.slice(panel.indexOf("function ReadOnlyMetadata("), panel.indexOf("function Field("));
    expect(view).toContain("record.gaindeDeclarationReference");
  });
});

// ===========================================================================
// SLICE 9 — Finance's act, with the taxes
// ===========================================================================

describe("step 9 is a payment with a breakdown, not a reference", () => {
  it("11 — the ledger exists, with lines rather than hard-coded taxes", () => {
    expect(sqlCode).toContain("create table if not exists public.gainde_tax_payment (");
    expect(sqlCode).toContain("create table if not exists public.gainde_tax_payment_line (");
    // « Do not hard-code DD/TVA/PCS/PCC/COSEC/RS as schema columns. »
    for (const tax of ["dd_amount", "tva_amount", "pcs_amount", "cosec_amount"]) {
      expect(sqlCode, tax).not.toContain(tax);
    }
    expect(sqlCode).toContain("tax_code     text   not null");
  });

  it("12 — money is integer minor units, per the platform's doctrine", () => {
    expect(sqlCode).toContain("total_paid_minor    bigint not null check (total_paid_minor > 0)");
    expect(sqlCode).toContain("amount_minor bigint not null check (amount_minor > 0)");
    expect(sqlCode).not.toMatch(/numeric\(\d+, ?\d+\)[^\n]*amount/);
  });

  it("12b — the shared balance trigger reads each table by its own shape", () => {
    // CI found this the hard way. ONE function serves two tables with different
    // shapes, and `coalesce(new.payment_id, new.id, …)` reads plausibly while
    // raising « record "new" has no field "payment_id" » the moment it fires on
    // the HEADER table: PL/pgSQL resolves record fields at runtime, so a field
    // that does not exist is an error, not a null. NEW is also null on DELETE
    // and OLD on INSERT.
    const f = fn("assert_gainde_tax_payment_balances");
    expect(f).toContain("tg_table_name = 'gainde_tax_payment'");
    expect(f).toContain("tg_op = 'DELETE'");
    expect(f).not.toContain("coalesce(new.payment_id, old.payment_id, new.id, old.id)");
  });

  it("13 — the lines must add up to the total, checked at COMMIT", () => {
    // Deferred on purpose: the header is inserted before its lines, so an
    // immediate check would refuse every legitimate payment.
    expect(sqlCode).toContain("deferrable initially deferred");
    expect(sqlCode).toContain("tax_total_mismatch");
    // A total with no breakdown is what the ratification replaced.
    expect(sqlCode).toContain("tax_lines_required");
  });

  it("14 — one LIVE payment per record, and a void keeps the wrong figure visible", () => {
    expect(sqlCode).toContain("uq_gainde_tax_payment_live");
    expect(sqlCode).toContain("where voided_at is null");
    expect(sqlCode).toContain("gainde_tax_payment_void_complete");
    expect(fn("void_gainde_tax_payment")).toContain("reason_required");
  });

  it("15 — and voiding the last payment retracts the milestone", () => {
    // Leaving `gainde_registered_at` behind would keep step 9 satisfied by a
    // payment that no longer stands.
    const f = fn("void_gainde_tax_payment");
    expect(f).toContain("gainde_registered_at = null");
    expect(f).toContain("not exists");
  });

  it("16 — the action demands the breakdown before the RPC does", () => {
    const slice = actions.slice(actions.indexOf("export async function recordGaindeRegistration"));
    const body = slice.slice(0, 3000);
    for (const refusal of ["quittance_required", "paid_at_required", "tax_lines_required", "invalid_amount"]) {
      expect(body, refusal).toContain(refusal);
    }
  });

  it("17 — and the panel asks for it, because a prompt cannot express a breakdown", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toContain("function GaindeRegistrationForm(");
    expect(panel).toContain("recordGaindeRegistration(record.id, input.reference, input.payment)");
    // The six taxes Effitrans names — offered, not enforced: they are governed
    // LINES, so a seventh needs no migration.
    for (const t of ["DD", "TVA", "PCS", "PCC", "COSEC", "RS"]) {
      expect(panel, t).toContain(`code: "${t}"`);
    }
  });
});

// ===========================================================================
// ONE money authority, and one registration action
// ===========================================================================

describe("nothing became a second authority", () => {
  it("18 — the payment ledger records an execution; it never authorizes one", () => {
    const table = sqlCode.slice(
      sqlCode.indexOf("create table if not exists public.gainde_tax_payment ("),
      sqlCode.indexOf("create table if not exists public.gainde_tax_payment_line ("),
    );
    for (const forbidden of ["status", "reviewed_by", "approved_by", "billing_charge_id"]) {
      expect(table, forbidden).not.toMatch(new RegExp(`^\\s+${forbidden}\\b`, "m"));
    }
  });

  it("19 — but it can be settled against a finance_request when one exists", () => {
    expect(sqlCode).toContain("finance_request_id  uuid references public.finance_request (id)");
  });

  it("20 — and there is exactly ONE Finance registration path", () => {
    // Leaving the 3-arg version alive would let the incomplete act — a
    // reference with no taxes — keep happening beside its replacement.
    expect(sqlCode).toContain("drop function if exists public.record_gainde_registration(uuid, text, uuid);");
    expect(read(VERIFY)).toContain("the 3-arg record_gainde_registration is GONE");
  });
});

// ===========================================================================
// SLICE 10 — what satisfies step 9
// ===========================================================================

describe("step 9 is satisfied by Finance's payment, never by a reference", () => {
  const src = read("lib/process/reconcile/satisfaction.ts");
  const rule = src.slice(src.indexOf("gainde_registration: {"), src.indexOf("gainde_document_submission: {"));

  it("21 — the rule reads the milestone AND the payment", () => {
    expect(rule).toContain("f.customs?.gaindeRegisteredAt");
    expect(rule).toContain("f.customs?.gaindeTaxPaid !== false");
  });

  it("22 — and never external_ref, nor the Déclarant's reference", () => {
    // The MAYA-P1.2 proxy, in its two possible new forms.
    expect(rule).not.toContain("externalRef");
    expect(rule).not.toContain("declarationNumber");
    expect(rule).not.toContain("gaindeDeclarationReference");
  });

  it("23 — `null` means NOT KNOWABLE, so nothing changes before the schema does", () => {
    // `!== false` and not `=== true`: before migration 20261001000001 the
    // ledger does not exist, the loader reports null, and the rule reads
    // exactly as it did. Shipping the code ahead of the schema must not flip
    // live dossiers to CONFLICT.
    const f = FACT_RULES.gainde_registration;
    const base = {
      status: "DECLARED", required: true, declarationNumber: null, baeReference: null,
      attachmentCompletedAt: null,
    };
    const facts = (over: Record<string, unknown>) =>
      ({ fileType: "IMP", fileStatus: "IN_PROGRESS", customs: { ...base, ...over },
         transport: null, verifiedPodDocumentId: null, verifiedBaeDocumentId: null }) as never;

    expect(f.satisfied(facts({ gaindeRegisteredAt: "2026-09-01T00:00:00Z", gaindeTaxPaid: null })))
      .toBe(true);
    expect(f.satisfied(facts({ gaindeRegisteredAt: "2026-09-01T00:00:00Z", gaindeTaxPaid: true })))
      .toBe(true);
    // …and once the ledger IS there, a milestone with no live payment stops
    // satisfying. That reports CONFLICT, which is the truth about it.
    expect(f.satisfied(facts({ gaindeRegisteredAt: "2026-09-01T00:00:00Z", gaindeTaxPaid: false })))
      .toBe(false);
    expect(f.satisfied(facts({ gaindeRegisteredAt: null, gaindeTaxPaid: true }))).toBe(false);
  });

  it("24 — the loader fails OPEN on a database without the ledger", () => {
    // Folding this read into the main fact query would take the WHOLE fact load
    // down — every step on every dossier — over a table that is legitimately
    // absent before the migration.
    const svc = code("lib/process/reconcile/service.ts");
    expect(svc).toContain("let gaindeTaxPaid: boolean | null = null;");
    expect(svc).toContain("if (!paid.error) gaindeTaxPaid = (paid.data ?? []).length > 0;");
    expect(svc).toContain('.is("voided_at", null)');
  });

  it("25 — and the fact sentence says what the act now is", () => {
    expect(FACT_RULES.gainde_registration.factFr).toContain("droits et taxes");
  });
});

// ===========================================================================
// THE MIGRATION IS WRITTEN, VERIFIED — AND NOT APPLIED
// ===========================================================================

describe("migration #139 ships under the #139+ policy", () => {
  it("26 — it exists, it is the newest, and build-info tracks it", () => {
    expect(LATEST_MIGRATION).toBe("20261001000001_gainde_declaration_and_tax_payment");
    expect(MIGRATION_COUNT).toBe(139);
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files).toHaveLength(MIGRATION_COUNT);
    expect(files.at(-1)).toBe(`${LATEST_MIGRATION}.sql`);
  });

  it("27 — it has its companion verifier, as the policy requires", () => {
    const v = read(VERIFY);
    expect(v).toContain("Read-only");
    expect(v).toContain("select");
    // Read-only by construction: a verifier that mutated would be run against
    // production months later by the integrity guard.
    for (const forbidden of ["insert into", "update ", "delete from", "alter table", "drop "]) {
      expect(v.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("28 — it is additive and backfills nothing", () => {
    // Inventing a payment that never happened would be worse than having none.
    expect(sqlCode).not.toMatch(/update public\.customs_record\s+set gainde_registered_at\s*=\s*now\(\)[^;]*where[^;]*is null/i);
    expect(sql).toContain("Nothing is backfilled");
    for (const destructive of ["drop table", "drop column", "truncate"]) {
      expect(sqlCode.toLowerCase(), destructive).not.toContain(destructive);
    }
  });

  it("29 — INV-7: every new definer RPC proves its actor's authority", () => {
    for (const f of ["record_declaration_reference", "record_gainde_registration", "void_gainde_tax_payment"]) {
      expect(fn(f), f).toContain("assert_actor_authority");
    }
  });

  it("30 — OPS-SEC-1: and none of them is browser-executable", () => {
    for (const f of ["record_declaration_reference", "record_gainde_registration", "void_gainde_tax_payment"]) {
      for (const who of ["public", "anon", "authenticated"]) {
        expect(sqlCode, `${f} / ${who}`).toMatch(
          new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from ${who};`),
        );
      }
      expect(sqlCode, f).toMatch(
        new RegExp(`grant  execute on function public\\.${f}\\([^)]*\\) to service_role;`),
      );
    }
  });

  it("31 — DEC-C39: the fiscal detail is staff-only, with no portal policy", () => {
    // The ratified reason the taxes are not columns on `customs_record`: that
    // table's portal policy has no column list, so anything added to it is
    // customer-readable by construction.
    expect(sqlCode).toContain("alter table public.gainde_tax_payment      enable row level security;");
    expect(sqlCode).toContain("alter table public.gainde_tax_payment_line enable row level security;");
    // No POLICY reaches it. `portal_can_read_file` does appear once — in the
    // migration's own application-time assertion, which REFUSES such a policy —
    // so the pin is on the create-policy statements rather than on the word.
    const policies = sqlCode.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const pol of policies) {
      expect(pol, "a portal policy on the fiscal detail").not.toContain("portal_can_read_file");
    }
    // No write policy anywhere: the server actions ARE the boundary.
    expect(sqlCode).not.toMatch(/create policy [a-z_]*gainde_tax[a-z_]*\s+for (insert|update|delete)/);
  });

  it("32 — and both tables are registered with the tenant guard", () => {
    // A table missing from TENANT_SCOPED_TABLES is invisible to the guard.
    const reg = read("lib/db/tenant-tables.ts");
    expect(reg).toContain('"gainde_tax_payment",');
    expect(reg).toContain('"gainde_tax_payment_line",');
  });

  it("33 — no money travels in the event ledger (WES-9C)", () => {
    const f = fn("record_gainde_registration");
    expect(f).toContain("GAINDE_REGISTRATION_RECORDED");
    expect(f).toMatch(/jsonb_build_object\('reference', v_ref, 'corrected'/);
    // The metadata object only. `total_paid_minor` legitimately appears in the
    // ledger write above it, so the pin is on the event payload itself.
    const meta = f.slice(f.indexOf("GAINDE_REGISTRATION_RECORDED"));
    expect(meta).not.toMatch(/amount|minor|total/);
  });
});
