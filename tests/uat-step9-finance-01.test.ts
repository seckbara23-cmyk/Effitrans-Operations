/**
 * UAT-STEP9-FINANCE-01 — Finance pays AGAINST a declaration, it does not
 * register a second one.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it executed on EFT-IMP-2026-00011. Finance (fonction douane)
 * claimed step 9, filled in the quittance, the payment date and the six tax
 * lines, submitted with the dossier's existing GAINDE reference — and read
 * « Cette référence GAINDE est déjà enregistrée. » The card stayed « Non
 * enregistré », `gainde_registered_at` was null and the payment ledger held
 * zero rows.
 *
 * WHY. `record_gainde_registration` still carried the guard it was born with:
 *
 *     if v_prev is not distinct from v_ref then
 *       raise exception 'reference_unchanged: …';
 *
 * …where `v_prev` is `customs_record.external_ref`. That guard was correct for
 * the act this function used to perform: before migration 20261001000001, step
 * 9 WAS a reference registration, and re-submitting the stored string meant
 * nothing had changed. #139 turned the act into an actual PAYMENT — paid_at,
 * quittance, a per-tax breakdown, a ledger row — and left the guard pointing
 * at the reference. It then refused on a fact that no longer decides anything.
 *
 * AND IT WAS NOT A CHANCE COLLISION. The Finance form defaulted its reference
 * field to the stored `external_ref`, so on any dossier where that column held
 * a value the default submission was guaranteed to equal it. Step 9 was
 * unperformable, and the only way through was to type a reference that was NOT
 * the declaration's — that is, to falsify it.
 *
 * WHAT THIS SUITE PINS: the guard is gone from the payment act, an equivalent
 * guard exists on the fact that does decide (an identical live payment), and
 * every promise this slice made not to weaken is still standing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getStep } from "@/lib/process/effitrans-process";
import { CONTROL_OWNING_STEP } from "@/lib/process/control-gate";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";
import { getQueue } from "@/lib/process/queues/registry";
import { t } from "@/lib/i18n";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20261004000001_gainde_payment_registration.sql";
const VERIFIER = "supabase/verifiers/20261004000001_gainde_payment_registration.verify.sql";
const OLD_MIGRATION = "supabase/migrations/20261001000001_gainde_declaration_and_tax_payment.sql";

const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
const verifier = read(VERIFIER);
const panel = read("components/customs/customs-panel.tsx");

/** One SQL function body, bounded so a neighbour cannot satisfy a pin. */
function fnOf(src: string, name: string): string {
  const i = src.indexOf(`function public.${name}(`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const rest = src.slice(i);
  const end = rest.indexOf("$$;");
  expect(end, `${name} has no terminator`).toBeGreaterThan(0);
  return rest.slice(0, end);
}

/** The step-9 server action, and nothing around it. */
function registrationAction(): string {
  const s = code("lib/customs/actions.ts");
  const start = s.indexOf("export async function recordGaindeRegistration");
  expect(start, "recordGaindeRegistration must exist").toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

const payment = fnOf(sql, "record_gainde_registration");

// ===========================================================================
describe("the reference is not what step 9 guards", () => {
  it("the payment RPC no longer refuses a reused declaration reference", () => {
    // THE BLOCKER. While this predicate is present, Finance cannot pay on any
    // dossier whose external_ref already holds the reference it must use.
    expect(payment).not.toMatch(/v_prev\s+is\s+not\s+distinct\s+from\s+v_ref/);
    expect(payment).not.toContain("reference_unchanged");
    // The old definition really did carry it — so this suite is pinning a
    // change, not describing something that was always true.
    expect(fnOf(read(OLD_MIGRATION).replace(/^\s*--.*$/gm, ""), "record_gainde_registration"))
      .toMatch(/v_prev\s+is\s+not\s+distinct\s+from\s+v_ref/);
  });

  it("the server action dropped its mirror of that refusal", () => {
    const fn = registrationAction();
    expect(fn).not.toContain('rec.external_ref === ref');
    // …and still forwards the RPC's precise tokens rather than flattening them.
    for (const token of [
      "reference_required", "quittance_required", "paid_at_required",
      "tax_lines_required", "tax_total_mismatch", "payment_unchanged",
    ]) {
      expect(fn, `${token} must survive as a distinct refusal`).toContain(`"${token}"`);
    }
  });

  it("the form no longer defaults to the column the guard compared against", () => {
    // The mechanical half of the blocker: `defaultReference={record.externalRef}`
    // guaranteed ref === external_ref on the default submission.
    expect(panel).not.toContain('defaultReference={record.externalRef ?? ""}');
    expect(panel).toMatch(
      /defaultReference=\{\s*record\.gaindeDeclarationReference \?\? record\.externalRef \?\? ""\s*\}/,
    );
  });
});

// ===========================================================================
describe("…the PAYMENT is", () => {
  it("an identical live payment is refused", () => {
    expect(payment).toContain("payment_unchanged");
    expect(payment).toMatch(/voided_at\s+is\s+null/);
  });

  it("identity is the receipt, the instant and the total — not the reference", () => {
    const guard = payment.slice(
      payment.indexOf("if exists ("),
      payment.indexOf("payment_unchanged"),
    );
    expect(guard).toContain("gp.quittance_reference = v_quit");
    expect(guard).toContain("gp.paid_at = p_paid_at");
    expect(guard).toContain("gp.total_paid_minor = v_total");
    expect(guard).toContain("gp.customs_record_id = p_customs_id");
    expect(guard, "a voided payment is not a live one").toMatch(/gp\.voided_at\s+is\s+null/);
  });

  it("the total is computed BEFORE the guard, or the guard compares nothing", () => {
    expect(payment.indexOf("into v_total")).toBeLessThan(payment.indexOf("if exists ("));
    expect(payment).toMatch(/sum\(\(e ->> 'amountMinor'\)::bigint\)/);
  });

  it("a payment with DIFFERENT figures is still a correction, not a second payment", () => {
    // One live payment per record stays the rule; the previous is voided with
    // its motif, never edited and never deleted.
    expect(payment).toMatch(/update public\.gainde_tax_payment[\s\S]{0,200}set voided_at\s*=\s*now\(\)/);
    expect(payment).toContain("void_reason");
    expect(payment).toContain("Remplacé par un nouvel enregistrement GAINDE");
  });

  it("and the correction door survives as its own audited act", () => {
    expect(read(OLD_MIGRATION)).toContain("function public.void_gainde_tax_payment(");
  });
});

// ===========================================================================
describe("nothing that mattered was weakened", () => {
  it("declaration-reference uniqueness is untouched", () => {
    const declaration = fnOf(read(OLD_MIGRATION).replace(/^\s*--.*$/gm, ""), "record_declaration_reference");
    expect(declaration).toContain("reference_unchanged");
    // …and this migration redefines only the payment function.
    expect(sql).not.toContain("function public.record_declaration_reference(");
    expect(sql.match(/create or replace function/g) ?? []).toHaveLength(1);
  });

  it("the two acts still have two columns, two owners and two owning steps", () => {
    expect(payment, "the payment never writes the Déclarant's column")
      .not.toMatch(/gainde_declaration_reference\s*=/);
    expect(payment, "and still writes its own").toMatch(/external_ref\s*=\s*v_ref/);
    expect(CONTROL_OWNING_STEP["customs.declaration_reference"]).toBe("customs_preparation");
    expect(CONTROL_OWNING_STEP["customs.gainde_registration"]).toBe("gainde_registration");
  });

  it("Finance-only write authority, established by the database itself", () => {
    expect(payment).toContain("assert_actor_authority");
    expect(payment).toContain("customs:register");
    expect(payment).not.toMatch(/customs:update|customs:validate|process:manage/);
    expect(getStep("gainde_registration")!.permissions).toEqual(["customs:register"]);
    // The action asks for the same capability, and the role that holds it is
    // the Finance customs officer — no role gained anything here.
    expect(registrationAction()).toContain('assertPermission("customs:register")');
    const holders = TENANT_ROLE_TEMPLATES
      .filter((r) => r.permissions.includes("customs:register"))
      .map((r) => r.key);
    expect(holders).toContain("CUSTOMS_FINANCE_OFFICER");
    expect(holders).not.toContain("CUSTOMS_DECLARANT");
    expect(holders).not.toContain("CHIEF_OF_TRANSIT");
    expect(holders).not.toContain("COORDINATOR");
  });

  it("tenant isolation: the record is loaded scoped, before anything is written", () => {
    const fn = registrationAction();
    expect(fn).toContain("loadCustoms(supabase, id, user.tenantId)");
    expect(fn).toContain('if (!rec) return { ok: false, error: "not_found" };');
    expect(fn).toContain("isFileVisible(user.id, user.tenantId, rec.file_id)");
    expect(
      fn.indexOf("loadCustoms(supabase, id, user.tenantId)"),
      "the scoped load precedes the RPC call",
    ).toBeLessThan(fn.indexOf('supabase.rpc("record_gainde_registration"'));
    // The database backstop: the tenant is derived from the record, never
    // accepted from the caller, and authority is checked against THAT tenant.
    expect(payment).toMatch(/into v_tenant[\s\S]{0,120}from public\.customs_record/);
    expect(payment).toMatch(/assert_actor_authority\(p_actor, v_tenant/);
  });

  it("the money still has to add up, and the ledger still has to balance", () => {
    const fn = registrationAction();
    for (const refusal of ["quittance_required", "paid_at_required", "tax_lines_required"]) {
      expect(fn, `${refusal} is still required`).toContain(`"${refusal}"`);
    }
    expect(fn).toContain('return { ok: false, error: "invalid_amount" }');
    // The arithmetic is the trigger's job and this migration does not touch it.
    expect(sql).not.toContain("assert_gainde_tax_payment_balances()");
    expect(verifier).toContain("the lines-equal-total trigger function still exists");
  });

  it("auditability: the milestone, the event and the app audit all survive", () => {
    expect(payment).toContain("emit_business_event");
    expect(payment).toContain("GAINDE_REGISTRATION_RECORDED");
    // WES-9C — no money in the event ledger; the figures live in the payment.
    expect(payment).not.toMatch(/jsonb_build_object\([^)]*total|amount_minor'/);
    expect(payment).toMatch(/gainde_registered_at\s*=\s*now\(\)/);
    expect(payment).toMatch(/gainde_registered_by\s*=\s*p_actor/);
    expect(registrationAction()).toContain("writeAudit");
  });

  it("EXECUTE is service_role only — anon holds every grant platform-wide", () => {
    for (const who of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from ${who}`,
      );
    }
    expect(sql).toContain(
      "grant  execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) to service_role",
    );
  });

  it("the official 26-step graph is unchanged", () => {
    const s9 = getStep("gainde_registration")!;
    expect(s9.stepNumber).toBe(9);
    expect(s9.key).toBe("gainde_registration");
    expect(s9.prerequisites).toEqual(["coordinator_to_finance"]);
    expect(s9.nextSteps).toEqual(["coordinator_to_declarant"]);
    expect(s9.department).toBe("finance_customs");
    expect(s9.role).toBe("CUSTOMS_FINANCE_OFFICER");
  });
});

// ===========================================================================
describe("step 9 completes on the Finance fact, and only then does step 10 open", () => {
  it("the ratified completion contract is the milestone AND a live payment", () => {
    const rule = FACT_RULES["gainde_registration"];
    expect(rule, "step 9 is fact-provable").toBeTruthy();
    // Milestone alone is not enough: a registration with no live payment does
    // not satisfy the step, which is what makes the payment the evidence.
    expect(rule.satisfied({ customs: { gaindeRegisteredAt: null, gaindeTaxPaid: true } } as never)).toBe(false);
    expect(rule.satisfied({ customs: { gaindeRegisteredAt: "2026-09-09", gaindeTaxPaid: false } } as never)).toBe(false);
    expect(rule.satisfied({ customs: { gaindeRegisteredAt: "2026-09-09", gaindeTaxPaid: true } } as never)).toBe(true);
  });

  it("step 10 waits on step 9 and on nothing else", () => {
    expect(getStep("coordinator_to_declarant")!.prerequisites).toEqual(["gainde_registration"]);
  });
});

// ===========================================================================
describe("the wording says what the act is", () => {
  it("step 9 no longer claims Finance registers the declaration", () => {
    const s9 = getStep("gainde_registration")!;
    expect(s9.labelFr).not.toMatch(/enregistrer la déclaration dans GAINDE/i);
    expect(s9.labelFr).toMatch(/paiement des droits et taxes/i);
    expect(s9.description).toMatch(/étape 6/);
    expect(s9.description).toMatch(/jamais recréée/i);
    // …and the queue that staffs it says the same thing.
    expect(getQueue("finance_customs")!.description).toMatch(/paiement des droits et taxes/i);
    expect(getQueue("finance_customs")!.description).not.toMatch(/déclaration dans GAINDE/i);
  });

  it("the panel card is about a payment, and names the declaration it attaches to", () => {
    const g = t.customs.gainde;
    expect(g.title).toMatch(/paiement/i);
    expect(g.action).toMatch(/paiement/i);
    expect(g.notRegistered).toMatch(/paiement/i);
    expect(g.registeredOn).toMatch(/paiement/i);
    expect(g.referenceLabel).toMatch(/déclaration/i);
    expect(g.againstDeclaration).toMatch(/déclaration/i);
    expect(panel).toContain("{c.gainde.againstDeclaration}");
    expect(panel).toContain("record.gaindeDeclarationReference");
  });

  it("and still refuses to imply a live GAINDE link", () => {
    const g = t.customs.gainde;
    expect(g.hint).toMatch(/Aucune connexion GAINDE n'est en service/);
    expect(g.hint).toMatch(/elle ne la synchronise pas/);
    expect(g.hint).toMatch(/étape 6/);
    expect(code("lib/customs/actions.ts")).not.toMatch(/synchronis[ée]\s+(avec\s+)?GAINDE|GAINDE\s+API/i);
  });

  it("the refusal an operator can now hit says the payment landed, not the reference", () => {
    const errors = t.customs.errors as Record<string, string>;
    expect(errors.payment_unchanged).toMatch(/paiement/i);
    expect(errors.payment_unchanged).toMatch(/quittance/i);
    // The old sentence still exists for the act it belongs to: the Déclarant's.
    expect(errors.reference_unchanged).toMatch(/référence GAINDE/i);
  });
});

// ===========================================================================
describe("the migration ships under the #139+ policy", () => {
  it("it exists, it is the newest, and build-info tracks it", () => {
    // ATTR-CUSTOMS-01 added #143 after this one: the guarantee is that #142
    // ships and build-info tracks the directory, never that it stays newest.
    expect(MIGRATION_COUNT).toBeGreaterThanOrEqual(142);
    expect(LATEST_MIGRATION >= "20261004000001_gainde_payment_registration").toBe(true);
    expect(readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url))))
      .toContain("20261004000001_gainde_payment_registration.sql");
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toHaveLength(MIGRATION_COUNT);
    expect(files.at(-1)).toBe(`${LATEST_MIGRATION}.sql`);
  });

  it("it declares its executor and carries no transaction-hostile SQL", () => {
    expect(read(MIGRATION)).toContain("-- migrate:executor db-query");
    expect(sql).not.toMatch(/create\s+(unique\s+)?index\s+concurrently|^\s*begin\s*;|^\s*commit\s*;/im);
  });

  it("it changes ONE function and no table, column, constraint or row", () => {
    expect(sql).not.toMatch(/\balter table\b|\bcreate table\b|\bdrop table\b/i);
    // The DML this file contains is INSIDE the function body — rows Finance's
    // own act writes when it runs. Nothing at migration level touches data, so
    // every statement of it must sit after the body opens.
    const bodyStart = sql.indexOf("as $$");
    for (const dml of [
      "insert into public.gainde_tax_payment",
      "update public.gainde_tax_payment",
      "update public.customs_record",
    ]) {
      expect(sql.indexOf(dml), `${dml} must be inside the function body`)
        .toBeGreaterThan(bodyStart);
    }
    expect(sql).not.toMatch(/\bdelete from\b|\btruncate\b/i);
    // …and no INSERT beyond the two ledger writes the act itself performs.
    expect(sql.match(/insert into/gi) ?? []).toHaveLength(2);
  });

  it("its verifier checks meaning, not names", () => {
    expect(verifier).toContain("Read-only");
    expect(verifier).toContain("does NOT refuse a reused declaration reference");
    expect(verifier).toContain("refuses an identical live payment");
    expect(verifier).toContain("still refuses its own duplicate");
    expect(verifier).toContain("EXECUTE is service_role only");
    expect(verifier).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b|\bcreate\b|\balter\b/i);
  });

  it("the migration asserts its own postconditions at the moment it applies", () => {
    const m = read(MIGRATION);
    expect(m).toContain("STEP9: the payment RPC still refuses a reused declaration reference");
    expect(m).toContain("STEP9: the payment RPC has no duplicate-payment guard");
    expect(m).toContain("STEP9: declaration-reference uniqueness must NOT be weakened");
    expect(m).toContain("STEP9: the payment RPC must assert actor authority (INV-7)");
  });
});
