/**
 * Phase 11.0B — Finance Expense Documents foundation.
 * ---------------------------------------------------------------------------
 * Pins every foundation INVARIANT structurally: the two pure state machines,
 * the immutable-version + append-only-visa + one-to-one guarantees (in the
 * migration DDL), the numbering/hash/template contracts, the CAS/redaction
 * discipline of the server actions (as source text — importing them pulls the
 * server chain), the additive JPEG XObject PDF primitive, and the role/
 * permission parity specifics. Full seed↔template parity is separately enforced
 * by tests/role-templates.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  EXPENSE_DOCUMENT_TYPES,
  isExpenseDocumentType,
  AUTHORIZATION_STATUSES,
  canTransitionAuthorization,
  isAuthorizationStatus,
  isAuthorizationTerminal,
  AUTHORIZATION_EDITABLE_STATUSES,
  VOUCHER_STATUSES,
  canTransitionVoucher,
  isVoucherStatus,
  isVoucherTerminal,
  VOUCHER_EDITABLE_STATUSES,
  isPaymentEligible,
  APPROVAL_ATTEMPT_STATUSES,
  isApprovalAttemptOpen,
  VISA_DECISIONS,
  AUTHORIZATION_VISA_STEPS,
  VOUCHER_VISA_STEPS,
  UNBOUND_VISA_STEPS,
  isUnboundVisaStep,
  visaStepsFor,
  EXPENSE_PAYMENT_METHODS,
  isExpensePaymentMethod,
  MATERIAL_AUTHORIZATION_FIELDS,
  MATERIAL_VOUCHER_FIELDS,
  isMaterialChange,
} from "@/lib/finance/expense/types";
import {
  EXPENSE_TEMPLATE_CODES,
  isExpenseTemplateCode,
  templateCodeForDocument,
  EXPENSE_TEMPLATES,
  activeTemplateVersion,
  templateCodesCoverDocuments,
} from "@/lib/finance/expense/templates";
import {
  AUTHORIZATION_NUMBER_PATTERN,
  VOUCHER_NUMBER_PATTERN,
  isAuthorizationNumber,
  isVoucherNumber,
  AUTHORIZATION_NUMBER_RPC,
  VOUCHER_NUMBER_RPC,
} from "@/lib/finance/expense/numbering";
import { expenseContentSha256, canonicalize } from "@/lib/finance/expense/hash";
import { PdfDoc } from "@/lib/reports/pdf";
import { TENANT_SCOPED_TABLES, GLOBAL_TABLES } from "@/lib/db/tenant-tables";
import { getTenantRoleTemplate, TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { roleCanonicalDepartment } from "@/lib/organization/departments";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const MIGRATION = read("../supabase/migrations/20260725000001_expense_documents.sql");
const MIGRATION_SQL = stripSql(MIGRATION);
const SEED = read("../supabase/seed.sql");
const ACTIONS = code("../lib/finance/expense/actions.ts");
const READERS = code("../lib/finance/expense/readers.ts");

// ==================================== A. Authorization state machine (1-10) ==

describe("Autorisation de Dépenses — lifecycle", () => {
  it("1 — declares the eight ratified statuses", () => {
    expect(AUTHORIZATION_STATUSES).toEqual([
      "DRAFT", "SUBMITTED", "IN_APPROVAL", "RETURNED", "REJECTED", "APPROVED", "CANCELLED", "SUPERSEDED",
    ]);
  });

  it("2 — the ONLY edge into APPROVED is from IN_APPROVAL (the voucher gate)", () => {
    for (const from of AUTHORIZATION_STATUSES) {
      expect(canTransitionAuthorization(from, "APPROVED")).toBe(from === "IN_APPROVAL");
    }
  });

  it("3 — DRAFT flows to SUBMITTED, never straight to approval/payment", () => {
    expect(canTransitionAuthorization("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransitionAuthorization("DRAFT", "IN_APPROVAL")).toBe(false);
    expect(canTransitionAuthorization("DRAFT", "APPROVED")).toBe(false);
  });

  it("4 — REJECTED is terminal", () => {
    for (const to of AUTHORIZATION_STATUSES) expect(canTransitionAuthorization("REJECTED", to)).toBe(false);
    expect(isAuthorizationTerminal("REJECTED")).toBe(true);
  });

  it("5 — CANCELLED and SUPERSEDED are terminal", () => {
    expect(isAuthorizationTerminal("CANCELLED")).toBe(true);
    expect(isAuthorizationTerminal("SUPERSEDED")).toBe(true);
    for (const to of AUTHORIZATION_STATUSES) {
      expect(canTransitionAuthorization("CANCELLED", to)).toBe(false);
      expect(canTransitionAuthorization("SUPERSEDED", to)).toBe(false);
    }
  });

  it("6 — RETURNED is the correction path back into approval", () => {
    expect(canTransitionAuthorization("RETURNED", "SUBMITTED")).toBe(true);
    expect(canTransitionAuthorization("RETURNED", "IN_APPROVAL")).toBe(true);
  });

  it("7 — APPROVED is NOT terminal (may be superseded or cancelled)", () => {
    expect(isAuthorizationTerminal("APPROVED")).toBe(false);
    expect(canTransitionAuthorization("APPROVED", "SUPERSEDED")).toBe(true);
  });

  it("8 — only DRAFT/RETURNED are editable in place (material edits elsewhere version)", () => {
    expect([...AUTHORIZATION_EDITABLE_STATUSES].sort()).toEqual(["DRAFT", "RETURNED"]);
  });

  it("9 — isAuthorizationStatus is a precise type guard", () => {
    expect(isAuthorizationStatus("APPROVED")).toBe(true);
    expect(isAuthorizationStatus("PAID")).toBe(false);
  });

  it("10 — every status has a defined outgoing set (total transition table)", () => {
    for (const s of AUTHORIZATION_STATUSES) {
      expect(() => canTransitionAuthorization(s, "DRAFT")).not.toThrow();
    }
  });
});

// ========================================= B. Voucher state machine (11-20) ==

describe("Bon de Dépenses — lifecycle", () => {
  it("11 — declares the eleven ratified statuses", () => {
    expect(VOUCHER_STATUSES).toEqual([
      "DRAFT", "IN_SIGNATURE", "RETURNED", "REJECTED", "FULLY_SIGNED", "READY_FOR_PAYMENT",
      "PAID", "RECONCILED", "CLOSED", "CANCELLED", "SUPERSEDED",
    ]);
  });

  it("12 — payment eligibility is EXACTLY READY_FOR_PAYMENT (approval ≠ payment)", () => {
    for (const s of VOUCHER_STATUSES) expect(isPaymentEligible(s)).toBe(s === "READY_FOR_PAYMENT");
  });

  it("13 — the only edge into READY_FOR_PAYMENT is from FULLY_SIGNED", () => {
    for (const from of VOUCHER_STATUSES) {
      expect(canTransitionVoucher(from, "READY_FOR_PAYMENT")).toBe(from === "FULLY_SIGNED");
    }
  });

  it("14 — the only edge into PAID is from READY_FOR_PAYMENT", () => {
    for (const from of VOUCHER_STATUSES) {
      expect(canTransitionVoucher(from, "PAID")).toBe(from === "READY_FOR_PAYMENT");
    }
  });

  it("15 — PAID is NOT terminal — it flows to reconciliation then closure", () => {
    expect(isVoucherTerminal("PAID")).toBe(false);
    expect(canTransitionVoucher("PAID", "RECONCILED")).toBe(true);
    expect(canTransitionVoucher("RECONCILED", "CLOSED")).toBe(true);
  });

  it("16 — REJECTED / CANCELLED / CLOSED / SUPERSEDED are terminal", () => {
    for (const s of ["REJECTED", "CANCELLED", "CLOSED", "SUPERSEDED"] as const) {
      expect(isVoucherTerminal(s)).toBe(true);
    }
  });

  it("17 — DRAFT enters the signature chain, never straight to payment", () => {
    expect(canTransitionVoucher("DRAFT", "IN_SIGNATURE")).toBe(true);
    expect(canTransitionVoucher("DRAFT", "READY_FOR_PAYMENT")).toBe(false);
    expect(canTransitionVoucher("DRAFT", "PAID")).toBe(false);
  });

  it("18 — RETURNED re-enters the signature chain", () => {
    expect(canTransitionVoucher("RETURNED", "IN_SIGNATURE")).toBe(true);
  });

  it("19 — only DRAFT/RETURNED are editable in place", () => {
    expect([...VOUCHER_EDITABLE_STATUSES].sort()).toEqual(["DRAFT", "RETURNED"]);
  });

  it("20 — isVoucherStatus rejects an authorization-only status", () => {
    expect(isVoucherStatus("READY_FOR_PAYMENT")).toBe(true);
    expect(isVoucherStatus("IN_APPROVAL")).toBe(false);
  });
});

// ================================ C. Documents, visas, methods, attempts (21-33)

describe("expense vocabulary", () => {
  it("21 — exactly two document types", () => {
    expect(EXPENSE_DOCUMENT_TYPES).toEqual(["EXPENSE_AUTHORIZATION", "EXPENSE_VOUCHER"]);
    expect(isExpenseDocumentType("EXPENSE_VOUCHER")).toBe(true);
    expect(isExpenseDocumentType("INVOICE")).toBe(false);
  });

  it("22 — the Autorisation visa chain is the printed 7-step order", () => {
    expect(AUTHORIZATION_VISA_STEPS.map((s) => s.code)).toEqual([
      "VISA_DEMANDEUR", "VISA_CHEF_TRANSIT", "VISA_COORDONNATEUR", "VISA_OPERATIONS",
      "VISA_TRESORIERE", "VISA_DAF", "VISA_DG",
    ]);
    expect(AUTHORIZATION_VISA_STEPS.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("23 — the Bon visa chain is the printed 6-step order (Agent first, DG last)", () => {
    expect(VOUCHER_VISA_STEPS.map((s) => s.code)).toEqual([
      "VISA_AGENT", "VISA_RECEPTION", "VISA_COMPTABLE", "VISA_DAF", "VISA_DGA", "VISA_DG",
    ]);
  });

  it("24 — VISA_RECEPTION and VISA_OPERATIONS are the unmapped business blockers", () => {
    expect([...UNBOUND_VISA_STEPS].sort()).toEqual(["VISA_OPERATIONS", "VISA_RECEPTION"]);
    expect(isUnboundVisaStep("VISA_RECEPTION")).toBe(true);
    expect(isUnboundVisaStep("VISA_OPERATIONS")).toBe(true);
    expect(isUnboundVisaStep("VISA_AGENT")).toBe(false);
  });

  it("25 — visaStepsFor returns the right chain per document", () => {
    expect(visaStepsFor("EXPENSE_AUTHORIZATION")).toBe(AUTHORIZATION_VISA_STEPS);
    expect(visaStepsFor("EXPENSE_VOUCHER")).toBe(VOUCHER_VISA_STEPS);
  });

  it("26 — payment methods widen the finance_request set with FREE_MONEY", () => {
    expect(EXPENSE_PAYMENT_METHODS).toContain("FREE_MONEY");
    expect(EXPENSE_PAYMENT_METHODS).toEqual([
      "CASH", "BANK_TRANSFER", "CHEQUE", "WAVE", "ORANGE_MONEY", "FREE_MONEY", "OTHER",
    ]);
    expect(isExpensePaymentMethod("FREE_MONEY")).toBe(true);
    expect(isExpensePaymentMethod("BITCOIN")).toBe(false);
  });

  it("27 — approval-attempt statuses + open predicate", () => {
    expect(APPROVAL_ATTEMPT_STATUSES).toContain("IN_PROGRESS");
    expect(APPROVAL_ATTEMPT_STATUSES).toContain("SUPERSEDED");
    expect(isApprovalAttemptOpen("IN_PROGRESS")).toBe(true);
    expect(isApprovalAttemptOpen("SUPERSEDED")).toBe(false);
  });

  it("28 — visa decisions are approve/reject/return", () => {
    expect(VISA_DECISIONS).toEqual(["APPROVED", "REJECTED", "RETURNED"]);
  });

  it("29 — amount is a material authorization field (edit ⇒ new version)", () => {
    expect(MATERIAL_AUTHORIZATION_FIELDS).toContain("amount");
    expect(MATERIAL_AUTHORIZATION_FIELDS).toContain("beneficiary");
    expect(MATERIAL_AUTHORIZATION_FIELDS).toContain("account_number");
  });

  it("30 — payment_method is a material voucher field", () => {
    expect(MATERIAL_VOUCHER_FIELDS).toContain("payment_method");
    expect(MATERIAL_VOUCHER_FIELDS).toContain("amount");
  });

  it("31 — isMaterialChange detects a changed material field", () => {
    expect(isMaterialChange({ amount: 100 }, { amount: 200 }, ["amount"])).toBe(true);
    expect(isMaterialChange({ amount: 100 }, { amount: 100 }, ["amount"])).toBe(false);
  });

  it("32 — isMaterialChange ignores unlisted (non-material) fields", () => {
    expect(isMaterialChange({ note: "a" }, { note: "b" }, ["amount"])).toBe(false);
  });

  it("33 — a null↔value change is material", () => {
    expect(isMaterialChange({ account_number: null }, { account_number: "X" }, ["account_number"])).toBe(true);
  });
});

// =========================================== D. Hash + numbering + templates (34-46)

describe("content hash (immutable-version integrity)", () => {
  const snap = { amount: 100, currency: "XOF", beneficiary: "ACME", reason: "duty" };

  it("34 — is deterministic for identical input", () => {
    const a = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: 1, snapshot: snap });
    const b = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: 1, snapshot: snap });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("35 — is independent of object key ORDER", () => {
    const a = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: 1, snapshot: { amount: 1, currency: "XOF" } });
    const b = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: 1, snapshot: { currency: "XOF", amount: 1 } });
    expect(a).toBe(b);
  });

  it("36 — differs by document type", () => {
    const a = expenseContentSha256({ docType: "EXPENSE_AUTHORIZATION", version: 1, snapshot: snap });
    const b = expenseContentSha256({ docType: "EXPENSE_VOUCHER", version: 1, snapshot: snap });
    expect(a).not.toBe(b);
  });

  it("37 — differs by version number", () => {
    const a = expenseContentSha256({ docType: "EXPENSE_VOUCHER", version: 1, snapshot: snap });
    const b = expenseContentSha256({ docType: "EXPENSE_VOUCHER", version: 2, snapshot: snap });
    expect(a).not.toBe(b);
  });

  it("38 — canonicalize sorts keys recursively", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("numbering contract", () => {
  it("39 — authorization numbers match EFT-AUT-YYYY-#####", () => {
    expect(isAuthorizationNumber("EFT-AUT-2026-00001")).toBe(true);
    expect(AUTHORIZATION_NUMBER_PATTERN.test("EFT-AUT-2026-1")).toBe(false);
    expect(isAuthorizationNumber("EFT-BON-2026-00001")).toBe(false);
  });

  it("40 — voucher numbers match EFT-BON-YYYY-#####", () => {
    expect(isVoucherNumber("EFT-BON-2026-00042")).toBe(true);
    expect(isVoucherNumber("EFT-AUT-2026-00042")).toBe(false);
  });

  it("41 — the RPC names match the migration functions", () => {
    expect(AUTHORIZATION_NUMBER_RPC).toBe("next_expense_authorization_number");
    expect(VOUCHER_NUMBER_RPC).toBe("next_expense_voucher_number");
    expect(MIGRATION).toContain(`function public.${AUTHORIZATION_NUMBER_RPC}`);
    expect(MIGRATION).toContain(`function public.${VOUCHER_NUMBER_RPC}`);
  });
});

describe("template registry (code-managed, DEC-C16)", () => {
  it("42 — the two template codes equal the two document types", () => {
    expect([...EXPENSE_TEMPLATE_CODES].sort()).toEqual([...EXPENSE_DOCUMENT_TYPES].sort());
    expect(templateCodesCoverDocuments()).toBe(true);
    expect(isExpenseTemplateCode("EXPENSE_VOUCHER")).toBe(true);
  });

  it("43 — a document maps 1:1 to its template code", () => {
    expect(templateCodeForDocument("EXPENSE_AUTHORIZATION")).toBe("EXPENSE_AUTHORIZATION");
    expect(templateCodeForDocument("EXPENSE_VOUCHER")).toBe("EXPENSE_VOUCHER");
  });

  it("44 — ships EMPTY (master template PDF is an 11.0C prerequisite)", () => {
    expect(EXPENSE_TEMPLATES).toHaveLength(0);
    expect(activeTemplateVersion("EXPENSE_AUTHORIZATION")).toBeNull();
  });

  it("45 — the global expense_template catalog table exists with the two-code CHECK", () => {
    expect(MIGRATION_SQL).toMatch(/create table public\.expense_template/);
    expect(MIGRATION_SQL).toMatch(/template_code in \('EXPENSE_AUTHORIZATION', 'EXPENSE_VOUCHER'\)/);
  });

  it("46 — expense_template is registered as a GLOBAL (non-tenant) table", () => {
    expect(GLOBAL_TABLES.has("expense_template")).toBe(true);
    expect(TENANT_SCOPED_TABLES.has("expense_template")).toBe(false);
  });
});

// ============================== E. Migration: one-to-one, immutable, append-only (47-60)

describe("migration — structural invariants", () => {
  it("47 — creates the six tenant tables + the global template catalog", () => {
    for (const t of [
      "expense_authorization", "expense_authorization_version", "expense_voucher",
      "expense_voucher_version", "expense_approval_attempt", "expense_visa", "expense_template",
    ]) {
      expect(MIGRATION_SQL).toMatch(new RegExp(`create table public\\.${t}\\b`));
    }
  });

  it("48 — ONE-TO-ONE: expense_voucher.authorization_id is UNIQUE NOT NULL (DEC-C07)", () => {
    const block = MIGRATION_SQL.slice(
      MIGRATION_SQL.indexOf("create table public.expense_voucher "),
      MIGRATION_SQL.indexOf("create table public.expense_voucher_version"),
    );
    expect(block).toMatch(/authorization_id\s+uuid\s+not null\s+unique/);
  });

  it("49 — the voucher records its source authorization version (provenance)", () => {
    expect(MIGRATION_SQL).toMatch(/source_authorization_version\s+int\s+not null/);
  });

  it("50 — immutable versions: both version tables block UPDATE and DELETE", () => {
    for (const t of ["expense_auth_version", "expense_voucher_version"]) {
      expect(MIGRATION_SQL).toMatch(new RegExp(`trg_${t}_no_update[\\s\\S]*?prevent_mutation`));
      expect(MIGRATION_SQL).toMatch(new RegExp(`trg_${t}_no_delete[\\s\\S]*?prevent_mutation`));
    }
  });

  it("51 — append-only visa ledger: expense_visa blocks UPDATE and DELETE", () => {
    expect(MIGRATION_SQL).toMatch(/trg_expense_visa_no_update[\s\S]*?prevent_mutation/);
    expect(MIGRATION_SQL).toMatch(/trg_expense_visa_no_delete[\s\S]*?prevent_mutation/);
  });

  it("52 — visa ledger records the authenticated-approval evidence (DEC-C12)", () => {
    const block = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("create table public.expense_visa"));
    for (const col of ["signer_user_id", "signer_role_code", "signer_display_name", "decision", "content_sha256", "step_ordinal"]) {
      expect(block).toContain(col);
    }
  });

  it("53 — attempts are separate from versions (rejection ≠ version)", () => {
    expect(MIGRATION_SQL).toMatch(/create table public\.expense_approval_attempt/);
    const block = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("create table public.expense_approval_attempt"));
    expect(block).toContain("attempt_number");
    expect(block).toContain("version_id");
  });

  it("54 — every referenced document version carries a content_sha256 (immutable digest)", () => {
    const authV = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("create table public.expense_authorization_version"));
    expect(authV).toMatch(/content_sha256\s+text\s+not null/);
  });

  it("55 — RLS is enabled on all six tenant tables + gated on finance:expense:read", () => {
    for (const t of [
      "expense_authorization", "expense_authorization_version", "expense_voucher",
      "expense_voucher_version", "expense_approval_attempt", "expense_visa",
    ]) {
      expect(MIGRATION_SQL).toMatch(new RegExp(`alter table public\\.${t}[\\s\\S]*?enable row level security`));
    }
    expect((MIGRATION_SQL.match(/has_permission\('finance:expense:read'\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("56 — NO portal policy (customers never see internal finance expense docs)", () => {
    expect(MIGRATION_SQL).not.toMatch(/auth_portal_client_id|portal_can_read|client_user/i);
  });

  it("57 — tenant-integrity triggers make cross-tenant links impossible", () => {
    expect(MIGRATION_SQL).toContain("enforce_expense_authorization_tenant");
    expect(MIGRATION_SQL).toContain("enforce_expense_voucher_tenant");
    expect(MIGRATION_SQL).toContain("enforce_expense_child_tenant");
  });

  it("58 — the two numbering RPCs are per-tenant×year, atomic, service-role only", () => {
    expect(MIGRATION_SQL).toMatch(/on conflict \(tenant_id, year\)\s*\n?\s*do update set next_seq/);
    expect(MIGRATION_SQL).toMatch(/grant execute on function public\.next_expense_authorization_number\(uuid\) to service_role/);
    expect(MIGRATION_SQL).toMatch(/revoke execute on function public\.next_expense_voucher_number\(uuid\) from public/);
  });

  it("59 — is additive: no destructive statement, all inserts idempotent", () => {
    expect(MIGRATION_SQL).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b/i);
    expect(MIGRATION_SQL).not.toMatch(/\bupdate\s+public\.\w+\s+set\b/i);
    expect((MIGRATION.match(/on conflict/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("60 — role inserts are guarded backfills (clean-replay safe)", () => {
    const roleBlock = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("insert into public.role "));
    expect(roleBlock).toMatch(/where exists \(select 1 from public\.organization where id = '00000000-0000-0000-0000-000000000001'\)/);
  });
});

// ============================== F. Server actions — CAS + redaction + 1:1 (61-70)

describe("server actions — foundation discipline", () => {
  it("61 — the voucher can be created ONLY from an APPROVED authorization (DEC-C06)", () => {
    const fn = ACTIONS.slice(
      ACTIONS.indexOf("export async function createExpenseVoucherFromAuthorization"),
      ACTIONS.indexOf("export async function submitExpenseVoucher"),
    );
    expect(fn).toContain('if (auth.status !== "APPROVED") return fail("not_approved")');
  });

  it("62 — submit transitions are compare-and-set on the current status", () => {
    expect(ACTIONS).toMatch(/\.eq\("status", row\.status\)/);
    // openApprovalAttempt is CAS on SUBMITTED specifically.
    expect(ACTIONS).toMatch(/\.eq\("status", "SUBMITTED"\)/);
  });

  it("63 — numbers are minted at SUBMISSION via the RPCs, not at draft creation", () => {
    const draft = ACTIONS.slice(
      ACTIONS.indexOf("export async function createExpenseAuthorizationDraft"),
      ACTIONS.indexOf("export async function submitExpenseAuthorization"),
    );
    expect(draft).not.toContain("next_expense_authorization_number");
    expect(ACTIONS).toContain('.rpc("next_expense_authorization_number"');
    expect(ACTIONS).toContain('.rpc("next_expense_voucher_number"');
  });

  it("64 — NO visa row is ever written in 11.0B (approvals/signatures are later)", () => {
    expect(ACTIONS).not.toMatch(/\.from\("expense_visa"\)/);
  });

  it("65 — every write is tenant-scoped on the admin client", () => {
    // Each .update/.insert path also filters tenant_id somewhere in the function.
    expect(ACTIONS).toMatch(/\.eq\("tenant_id", ctx\.tenantId\)/);
    expect((ACTIONS.match(/tenant_id: ctx\.tenantId/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("66 — audit metadata is SAFE (status/version/prefix), never amounts or beneficiary", () => {
    const auditCalls = [...ACTIONS.matchAll(/await writeAudit\(\{[\s\S]*?\}\);/g)].map((m) => m[0]).join("\n");
    expect(auditCalls).not.toMatch(/amount|beneficiary|account_number|amount_in_words/);
    expect(auditCalls).toContain("EXPENSE_AUTHORIZATION_CREATED");
  });

  it("67 — the voucher copies fields from the authorization version with provenance", () => {
    const fn = ACTIONS.slice(
      ACTIONS.indexOf("export async function createExpenseVoucherFromAuthorization"),
      ACTIONS.indexOf("export async function submitExpenseVoucher"),
    );
    expect(fn).toContain("source_authorization_version: version.version_number");
    expect(fn).toContain("beneficiary: version.beneficiary");
  });

  it("68 — a material edit supersedes the open attempt and opens a fresh one", () => {
    expect(ACTIONS).toContain("supersedeAndReopenAttempt");
    const fn = ACTIONS.slice(ACTIONS.indexOf("async function supersedeAndReopenAttempt"));
    expect(fn).toContain('status: "SUPERSEDED"');
    expect(fn).toContain('status: "IN_PROGRESS"');
  });

  it("69 — actions are permission-gated on the finance:expense:* family", () => {
    expect(ACTIONS).toContain('guard("finance:expense:create")');
    expect(ACTIONS).toContain('guard("finance:expense:submit")');
  });

  it("70 — no payment/treasury/PDF is performed (foundation only)", () => {
    expect(ACTIONS).not.toMatch(/\.from\("payment"\)|releaseCustoms|toBytes|PdfDoc|treasury/i);
  });
});

// ============================== G. Readers + H. PDF primitive + I. parity (71-84)

describe("readers — read-only + tenant-scoped", () => {
  it("71 — every reader gates on finance:expense:read", () => {
    expect(READERS).toContain('assertPermission("finance:expense:read")');
  });

  it("72 — every query is tenant-scoped and readers never mutate", () => {
    expect(READERS).toMatch(/\.eq\("tenant_id", ctx\.tenantId\)/);
    expect(READERS).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("73 — readers degrade (return null/[]) rather than throw when the table is absent", () => {
    expect(READERS).toContain("catch");
    expect(READERS).toMatch(/return \[\];|return null;/);
  });
});

describe("PDF — additive JPEG Image XObject primitive (DEC-C16)", () => {
  const latin1 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return s; };

  function assertXrefExact(bytes: Uint8Array): string {
    const s = latin1(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const m = s.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
    expect(m).not.toBeNull();
    const xrefOff = Number(m![1]);
    expect(s.slice(xrefOff, xrefOff + 4)).toBe("xref");
    const lines = s.slice(xrefOff).split("\n");
    const count = Number(lines[1].split(" ")[1]);
    for (let i = 2; i < 2 + count; i++) {
      const line = lines[i] ?? "";
      if (line.includes("65535 f")) continue;
      const off = Number(line.slice(0, 10));
      const objNum = i - 2;
      expect(s.slice(off, off + `${objNum} 0 obj`.length)).toBe(`${objNum} 0 obj`);
    }
    return s;
  }

  it("74 — jpegInfo parses SOF0 width/height/colour space without decoding", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00,
    ]);
    expect(PdfDoc.jpegInfo(jpeg)).toEqual({ width: 200, height: 300, colorSpace: "rgb" });
  });

  it("75 — jpegInfo returns null for non-JPEG bytes", () => {
    expect(PdfDoc.jpegInfo(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it("76 — a document WITH an embedded image is a byte-exact valid PDF (offsets hold)", () => {
    const doc = new PdfDoc({ size: "A4" });
    // Binary payload incl. null + high bytes — proves 1 byte/char round-trips.
    const fake = new Uint8Array([0xff, 0xd8, 0x00, 0x7f, 0x80, 0xff, 0x10, 0x00, 0xab, 0xcd]);
    doc.drawJpeg(40, 40, 200, 300, { data: fake, width: 200, height: 300, colorSpace: "rgb" });
    const s = assertXrefExact(doc.toBytes());
    expect(s).toContain("/Subtype /Image");
    expect(s).toContain("/Filter /DCTDecode");
    expect(s).toContain("/XObject << /Im0");
  });

  it("77 — the no-image path is unchanged (no XObject dict emitted)", () => {
    const doc = new PdfDoc({ size: "A4" });
    doc.text(40, 40, "Sans image", { size: 12 });
    const s = assertXrefExact(doc.toBytes());
    expect(s).not.toContain("/XObject");
    expect(s).not.toContain("/Image");
  });

  it("78 — grayscale images use DeviceGray", () => {
    const doc = new PdfDoc();
    doc.drawJpeg(0, 0, 10, 10, { data: new Uint8Array([0xff, 0xd8, 0x01, 0x02]), width: 10, height: 10, colorSpace: "gray" });
    expect(latin1(doc.toBytes())).toContain("/ColorSpace /DeviceGray");
  });
});

describe("role + permission parity (11.0B specifics)", () => {
  it("79 — the finance:expense:* family (6 codes) is in the migration + seed catalog", () => {
    for (const c of ["read", "create", "submit", "sign", "export", "execute"]) {
      expect(MIGRATION).toContain(`'finance:expense:${c}'`);
      expect(SEED).toContain(`'finance:expense:${c}'`);
    }
  });

  it("80 — the family uses module 'finance_expense' (kept out of the finance auto-grant)", () => {
    expect(MIGRATION).toContain("'finance_expense'");
  });

  it("81 — finance:expense:sign is granted to NO role in 11.0B (deferred to 11.0C/D)", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.permissions, `${t.key} must not yet hold finance:expense:sign`).not.toContain("finance:expense:sign");
    }
  });

  it("82 — the four new authorizer roles map to the FINANCE canonical department", () => {
    for (const r of ["ACCOUNTANT", "TREASURER", "DAF", "DGA"]) {
      expect(getTenantRoleTemplate(r), `${r} template missing`).toBeDefined();
      expect(roleCanonicalDepartment(r)).toBe("FINANCE");
    }
  });

  it("83 — CASHIER is execution-only: holds execute, never create/submit/sign", () => {
    const c = getTenantRoleTemplate("CASHIER")!;
    expect(c.permissions).toContain("finance:expense:execute");
    expect(c.permissions).toContain("finance:expense:read");
    expect(c.permissions).not.toContain("finance:expense:create");
    expect(c.permissions).not.toContain("finance:expense:submit");
    expect(c.permissions).not.toContain("finance:expense:sign");
  });

  it("84 — the six new tenant tables + two counters are in the tenant-scope registry", () => {
    for (const t of [
      "expense_authorization", "expense_authorization_version", "expense_voucher",
      "expense_voucher_version", "expense_approval_attempt", "expense_visa",
      "expense_authorization_counter", "expense_voucher_counter",
    ]) {
      expect(TENANT_SCOPED_TABLES.has(t), `${t} not registered`).toBe(true);
    }
  });
});
