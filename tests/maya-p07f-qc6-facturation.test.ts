/**
 * MAYA-P0.7-F — Contrôle Qualité N°6 (Facturation).
 * ---------------------------------------------------------------------------
 * Five controls. One is authoritative, one is a countable fact whose
 * verification is NOT recorded, and three have no criterion at all.
 *
 * This suite also pins the Finance census findings that decided that split, so
 * a later phase discovers when the ground changes rather than inheriting a
 * stale conclusion.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveQC6, isValidated, validatedInvoice,
  QC6_NO_CHARGE_VERIFICATION, QC6_NO_ARCHIVE_AUTHORITY,
  QC6_NO_COMPLETENESS_CRITERION, QC6_NO_PROCEDURE_CRITERIA,
  type QC6Input,
} from "@/lib/files/qc6";
import { VOUCHER_VISA_STEPS, AUTHORIZATION_VISA_STEPS, UNBOUND_VISA_STEPS } from "@/lib/finance/expense/types";
import type { InvoiceDetail, Charge } from "@/lib/finance/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PURE = "lib/files/qc6.ts";
const PANEL = "components/files/qc6-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

const charge = (id = String(Math.random())): Charge =>
  ({ id, fileId: "f1", description: "Transit", quantity: 1, unitAmount: 1000, taxRate: 18, currency: "XOF" });

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: "i1", fileId: "f1", invoiceNumber: "EFT-INV-2026-00007", status: "DRAFT",
  currency: "XOF", issueDate: null, dueDate: null, notes: null, lines: [], payments: [],
  subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0, overdue: false, ...over,
});

const input = (over: Partial<QC6Input> = {}): QC6Input => ({
  canReadFinance: true, charges: [], invoices: [], timeZone: TZ, ...over,
});

const byKey = (e: ReturnType<typeof deriveQC6>, k: string) => e.controls.find((c) => c.key === k)!;

// ===========================================================================
describe("the five controls of the manual are all accounted for", () => {
  it("each control is present, in the manual's wording", () => {
    const labels = deriveQC6(input()).controls.map((c) => c.labelFr);
    for (const l of ["Vérification des frais", "Validation de la facture", "Archivage",
                     "Dossier complet", "Respect procédure"]) {
      expect(labels, l).toContain(l);
    }
  });
});

// ===========================================================================
describe("invoice validation is an authoritative state, not an inference", () => {
  it("VALIDATED is a real state in the invoice lifecycle", () => {
    expect(isValidated("VALIDATED")).toBe(true);
    expect(isValidated("DRAFT")).toBe(false);
  });

  it("an ISSUED or PAID invoice was necessarily validated first", () => {
    for (const s of ["ISSUED", "PARTIALLY_PAID", "PAID"]) expect(isValidated(s), s).toBe(true);
  });

  it("a VOID invoice proves nothing", () => {
    expect(isValidated("VOID")).toBe(false);
    expect(byKey(deriveQC6(input({ invoices: [invoice({ status: "VOID" })] })), "invoiceValidation").state).toBe("absent");
  });

  it("an existing DRAFT invoice is NOT validation, and says why", () => {
    const c = byKey(deriveQC6(input({ invoices: [invoice({ status: "DRAFT" })] })), "invoiceValidation");
    expect(c.state).toBe("absent");
    expect(c.value).toBeNull();
    expect(c.reason).toContain("n'a pas atteint");
  });

  it("reports the validated invoice with its number and state", () => {
    const c = byKey(deriveQC6(input({
      invoices: [invoice({ status: "ISSUED", issueDate: "2026-08-12T10:00:00.000Z" })],
    })), "invoiceValidation");
    expect(c.state).toBe("observed");
    expect(c.value).toContain("EFT-INV-2026-00007");
    expect(c.value).toContain("émise");
    expect(c.value).toContain("12/08/2026");
  });

  it("picks the earliest validated invoice when several exist", () => {
    const a = invoice({ id: "a", status: "ISSUED", issueDate: "2026-08-20T10:00:00.000Z" });
    const b = invoice({ id: "b", status: "PAID", issueDate: "2026-08-12T10:00:00.000Z" });
    expect(validatedInvoice([a, b])!.id).toBe("b");
  });
});

// ===========================================================================
describe("charges are countable; their verification is not a fact", () => {
  it("counts the charge lines", () => {
    const c = byKey(deriveQC6(input({ charges: [charge(), charge()] })), "chargeVerification");
    expect(c.state).toBe("observed");
    expect(c.value).toContain("2 lignes de frais");
  });

  it("states that no verification is recorded, and never implies one", () => {
    expect(byKey(deriveQC6(input({ charges: [charge()] })), "chargeVerification").reason)
      .toBe(QC6_NO_CHARGE_VERIFICATION);
    expect(code(PURE)).not.toMatch(/chargesVerified|verifiedCharges|isChecked/i);
  });

  it("a dossier with no charges reads ABSENT, never « vérifié »", () => {
    expect(byKey(deriveQC6(input({ charges: [] })), "chargeVerification").state).toBe("absent");
  });

  it("the charge projection really has no verification field — pinned", () => {
    const t = read("lib/finance/types.ts");
    const chargeType = t.slice(t.indexOf("export type Charge = {"), t.indexOf("};", t.indexOf("export type Charge = {")));
    expect(chargeType).not.toMatch(/status|verified|reviewed|checkedBy/i);
  });
});

// ===========================================================================
describe("three controls have no authority, and say so", () => {
  it("archiving is not represented — a reserved column is not a feature", () => {
    const c = byKey(deriveQC6(input()), "archiving");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC6_NO_ARCHIVE_AUTHORITY);
    // The census finding, pinned: archived_at is documented as reserved.
    expect(read("supabase/migrations/20260614000002_create_operational_file.sql"))
      .toMatch(/archived_at[\s\S]{0,80}reserved/);
  });

  it("archiving is never inferred from issued, paid or closed", () => {
    const e = deriveQC6(input({ invoices: [invoice({ status: "PAID" })] }));
    expect(byKey(e, "archiving").state).toBe("not_represented");
    expect(code(PURE)).not.toMatch(/archivedAt|isArchived|archived_at/);
  });

  it("dossier completeness has no ratified criterion", () => {
    const c = byKey(deriveQC6(input()), "dossierComplete");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC6_NO_COMPLETENESS_CRITERION);
    // NOT a word ban — the constant that RECORDS the absence is legitimately
    // named QC6_NO_COMPLETENESS_CRITERION. What must be absent is a computed
    // completeness rule: no document list, no required-count, no verdict.
    expect(code(PURE)).not.toMatch(/missingRequired|isComplete\b|requiredDocs|completenessScore/i);
    expect(byKey(deriveQC6(input()), "dossierComplete").value).toBeNull();
  });

  it("procedure compliance is not evaluated", () => {
    expect(byKey(deriveQC6(input()), "procedures").reason).toBe(QC6_NO_PROCEDURE_CRITERIA);
  });

  it("never renders a conformity verdict", () => {
    for (const f of [PURE, PANEL]) {
      expect(code(f), f).not.toMatch(/["'>]\s*(Non )?[Cc]onforme\s*["'<]/);
      expect(code(f), f).not.toMatch(/isCompliant|passed|verdict/i);
    }
  });
});

// ===========================================================================
describe("restricted is not absent", () => {
  it("without finance:read, no finance fact is disclosed", () => {
    const e = deriveQC6(input({
      canReadFinance: false,
      charges: [charge(), charge()],
      invoices: [invoice({ status: "PAID" })],
    }));
    expect(e.chargeCount).toBeNull();
    for (const k of ["chargeVerification", "invoiceValidation", "archiving"]) {
      expect(byKey(e, k).state, k).toBe("restricted");
      expect(byKey(e, k).value, k).toBeNull();
    }
    const rendered = JSON.stringify(e);
    expect(rendered).not.toContain("EFT-INV-2026-00007");
    expect(rendered).not.toContain("2 lignes");
  });

  it("the page passes the real finance gate through", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canReadFinance,/);
    expect(p).toMatch(/const canReadFinance = hasPermission\(permissions, "finance:read"\)/);
  });
});

// ===========================================================================
describe("Finance census findings, pinned so a later phase sees the ground shift", () => {
  it("Bon de Dépenses ALREADY EXISTS as the expense voucher, with the paper's six visas", () => {
    // The supplied form's boxes — Agent, Réception, Comptable, DAF, DGA, DG —
    // are already the ordered voucher chain. QC6 must not rebuild it.
    expect(VOUCHER_VISA_STEPS.map((v) => v.code)).toEqual([
      "VISA_AGENT", "VISA_RECEPTION", "VISA_COMPTABLE", "VISA_DAF", "VISA_DGA", "VISA_DG",
    ]);
    // Ordinals: the chain is SEQUENTIAL, not a set of independent boxes.
    expect(VOUCHER_VISA_STEPS.map((v) => v.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    // The authorization chain is a DIFFERENT document with a different chain.
    expect(AUTHORIZATION_VISA_STEPS.map((v) => v.code)).not.toEqual(VOUCHER_VISA_STEPS.map((v) => v.code));
  });

  it("two visa signers remain deliberately unmapped business blockers", () => {
    expect([...UNBOUND_VISA_STEPS].sort()).toEqual(["VISA_OPERATIONS", "VISA_RECEPTION"]);
  });

  it("no Bon de Recettes authority exists anywhere — the gap is real", () => {
    // Searched across the finance library: no receipt-voucher object.
    for (const f of ["lib/finance/types.ts", "lib/finance/expense/types.ts"]) {
      expect(code(f).toLowerCase(), f).not.toContain("recette");
    }
    const tables = new Set<string>();
    for (const f of readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))) {
      if (!f.endsWith(".sql")) continue;
      for (const m of read(`supabase/migrations/${f}`).matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
        tables.add(m[1]);
      }
    }
    expect([...tables].filter((t) => /recette|receipt_voucher/i.test(t))).toEqual([]);
  });

  it("QC6 creates no second finance authority", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/supabase|\.from\(|\.rpc\(|await |server-only/);
    for (const t of ["invoice", "billing_charge", "payment", "expense_voucher"]) {
      expect(s, t).not.toContain(`"${t}"`);
    }
    expect(s).not.toMatch(/quality_invoice|qc6_status|recordArchive/i);
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    expect(migrations).toHaveLength(declared);
    expect(declared).toBe(102);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("QC1–QC5 remain intact, with every open item still open", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    expect(code("lib/files/qc2.ts")).toContain("QC2_TRANSMISSION_CONFLICT");
    expect(code("lib/files/qc4.ts")).toContain("QC4_NO_VALIDATION_RECORD");
    expect(code("lib/files/qc5.ts")).toContain("QC5_NO_VEHICLE_CONFORMITY");
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
    expect(code("lib/files/actions.ts")).toContain("account_manager_id: admin.id");
    expect(code("lib/customs/actions.ts")).not.toContain('assertPermission("customs:validate")');
  });

  it("the Finance dashboard and workflow are untouched", () => {
    for (const f of ["lib/finance/actions.ts", "lib/finance/service.ts", "lib/finance/expense/actions.ts"]) {
      expect(code(f), f).not.toMatch(/qc6|deriveQC6/i);
    }
  });

  it("no Sage, MAYA APPLY, client import or Q5", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      expect(s, f).not.toMatch(/\bsage\b|maya_import|ninea/i);
      expect(s.toLowerCase(), f).not.toContain("groupage");
    }
  });

  it("no new permission was introduced", () => {
    expect(code(PURE)).not.toMatch(/assertPermission|hasPermission/);
  });
});
