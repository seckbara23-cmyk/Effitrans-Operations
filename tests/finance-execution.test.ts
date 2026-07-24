/**
 * Phase 9.0E — Finance execution (steps 20–26 seam).
 * ---------------------------------------------------------------------------
 * The pure contracts (request/evidence state machines, categories, clearance
 * evaluator) are tested directly; the server-action guarantees (flag gates,
 * "a decision is not a payment", duplicate-disbursement CAS, evidence ≠
 * verification, customs-clearance boundary, invoice/payment boundary,
 * ownership invariance, tenant scope, no new permission) are asserted
 * structurally against the real source. DB-level guarantees (RLS, tenant
 * trigger, dedup index) are proven by
 * supabase/tests/rls_finance_requests_test.sql in the rls-tests CI job.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  FINANCE_REQUEST_STATUSES,
  canTransitionFinanceRequest,
  canTransitionEvidence,
  evaluateFinancialClearance,
  FINANCE_CATEGORIES,
  isFinanceCategory,
  isDisbursementMethod,
  REQUEST_STATUS_LABELS_FR,
  EVIDENCE_STATUS_LABELS_FR,
  CLEARANCE_MISSING_LABELS_FR,
  FINANCE_BLOCKER_CATEGORIES,
  type ClearanceInput,
} from "@/lib/finance/requests";
import { resolveProcessFlags } from "@/lib/process/flags";
import { resolveEffectiveFlags, FLAGS_ALL_OFF, ROLLOUT_DISABLED } from "@/lib/process/rollout";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("../lib/finance/request-actions.ts");
const panel = code("../components/process/finance-panel.tsx");
const page = code("../app/files/[id]/process/page.tsx");
const migration = read("../supabase/migrations/20260723000002_finance_requests.sql");
const rollout = code("../lib/process/rollout.ts");
const envExample = read("../.env.example");
const ciYml = read("../.github/workflows/ci.yml");

const CLEAR_OK: ClearanceInput = {
  requests: [{ status: "DISBURSED", evidenceStatus: "VERIFIED" }],
  openFinanceBlockers: 0,
  pendingPaymentDecision: false,
  invoiceState: "issued",
  invoiceIntentionallyDeferred: false,
};

// ======================================== request state machine (tests 1-10) ====

describe("finance request state machine — pure", () => {
  it("1 — declares the six statuses", () => {
    expect(FINANCE_REQUEST_STATUSES).toEqual(["REQUESTED", "APPROVED", "REJECTED", "RETURNED", "DISBURSED", "CANCELLED"]);
  });

  it("2 — the ONLY edge into DISBURSED is from APPROVED", () => {
    for (const from of FINANCE_REQUEST_STATUSES) {
      expect(canTransitionFinanceRequest(from, "DISBURSED")).toBe(from === "APPROVED");
    }
  });

  it("3 — a REQUESTED request cannot be disbursed (authorization required)", () => {
    expect(canTransitionFinanceRequest("REQUESTED", "DISBURSED")).toBe(false);
  });

  it("4 — a REJECTED request is terminal — no path back to money", () => {
    for (const to of FINANCE_REQUEST_STATUSES) {
      expect(canTransitionFinanceRequest("REJECTED", to)).toBe(false);
    }
  });

  it("5 — DISBURSED is terminal: no second disbursement transition exists", () => {
    for (const to of FINANCE_REQUEST_STATUSES) {
      expect(canTransitionFinanceRequest("DISBURSED", to)).toBe(false);
    }
  });

  it("6 — RETURNED goes back to the requester and may be resubmitted", () => {
    expect(canTransitionFinanceRequest("REQUESTED", "RETURNED")).toBe(true);
    expect(canTransitionFinanceRequest("RETURNED", "REQUESTED")).toBe(true);
    expect(canTransitionFinanceRequest("RETURNED", "APPROVED")).toBe(false);
  });

  it("7 — review verdicts all depart from REQUESTED", () => {
    expect(canTransitionFinanceRequest("REQUESTED", "APPROVED")).toBe(true);
    expect(canTransitionFinanceRequest("REQUESTED", "REJECTED")).toBe(true);
  });

  it("8 — French labels never overclaim: APPROVED is explicitly not-disbursed", () => {
    expect(REQUEST_STATUS_LABELS_FR.APPROVED).toBe("Approuvé — non décaissé");
    expect(REQUEST_STATUS_LABELS_FR.APPROVED).not.toContain("Payé");
    expect(REQUEST_STATUS_LABELS_FR.DISBURSED).toBe("Décaissé");
  });

  it("9 — method vocabulary is the EXISTING payment vocabulary (no parallel list)", () => {
    expect(isDisbursementMethod("WAVE")).toBe(true);
    expect(isDisbursementMethod("ORANGE_MONEY")).toBe(true);
    expect(isDisbursementMethod("CRYPTO")).toBe(false);
    expect(migration).toContain("('CASH', 'BANK_TRANSFER', 'CHEQUE', 'WAVE', 'ORANGE_MONEY', 'OTHER')");
  });

  it("10 — five expense categories with honest billing defaults (internal costs never billable)", () => {
    expect(FINANCE_CATEGORIES).toHaveLength(5);
    expect(isFinanceCategory("CUSTOMS_DUTY")).toBe(true);
    expect(FINANCE_CATEGORIES.find((c) => c.code === "INTERNAL_COST")!.reimbursableByDefault).toBe(false);
    expect(FINANCE_CATEGORIES.find((c) => c.code === "SUPPLIER_EXPENSE")!.reimbursableByDefault).toBe(false);
  });
});

// ============================================ evidence machine (tests 11-15) ====

describe("evidence state machine — submission is not verification", () => {
  it("11 — upload only ever reaches SUBMITTED", () => {
    expect(canTransitionEvidence("NONE", "SUBMITTED")).toBe(true);
    expect(canTransitionEvidence("NONE", "VERIFIED")).toBe(false);
  });

  it("12 — verification departs only from SUBMITTED", () => {
    expect(canTransitionEvidence("SUBMITTED", "VERIFIED")).toBe(true);
    expect(canTransitionEvidence("SUBMITTED", "REJECTED")).toBe(true);
  });

  it("13 — a rejected proof may be resubmitted; a verified one is final", () => {
    expect(canTransitionEvidence("REJECTED", "SUBMITTED")).toBe(true);
    expect(canTransitionEvidence("VERIFIED", "SUBMITTED")).toBe(false);
  });

  it("14 — labels distinguish transmitted from verified", () => {
    expect(EVIDENCE_STATUS_LABELS_FR.SUBMITTED).toContain("à vérifier");
    expect(EVIDENCE_STATUS_LABELS_FR.SUBMITTED).not.toContain("vérifié.");
    expect(EVIDENCE_STATUS_LABELS_FR.VERIFIED).toBe("Justificatif vérifié");
  });

  it("15 — the finance blocker categories are exactly the payment pair", () => {
    expect([...FINANCE_BLOCKER_CATEGORIES]).toEqual(["PAYMENT_PENDING", "PAYMENT_REJECTED"]);
  });
});

// ======================================= clearance evaluator (tests 16-24) ====

describe("financial clearance — pure evaluator", () => {
  it("16 — a fully settled dossier clears", () => {
    expect(evaluateFinancialClearance(CLEAR_OK)).toEqual({ ready: true, missing: [] });
  });

  it("17 — a request awaiting review blocks clearance", () => {
    const r = evaluateFinancialClearance({ ...CLEAR_OK, requests: [{ status: "REQUESTED", evidenceStatus: "NONE" }] });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("requests_awaiting_review");
  });

  it("18 — an approved-but-undisbursed request blocks clearance", () => {
    const r = evaluateFinancialClearance({ ...CLEAR_OK, requests: [{ status: "APPROVED", evidenceStatus: "NONE" }] });
    expect(r.missing).toContain("approved_not_disbursed");
  });

  it("19 — a disbursement without VERIFIED evidence blocks clearance", () => {
    for (const ev of ["NONE", "SUBMITTED", "REJECTED"] as const) {
      const r = evaluateFinancialClearance({ ...CLEAR_OK, requests: [{ status: "DISBURSED", evidenceStatus: ev }] });
      expect(r.missing, ev).toContain("evidence_missing_or_unverified");
    }
  });

  it("20 — open finance blockers block clearance", () => {
    expect(evaluateFinancialClearance({ ...CLEAR_OK, openFinanceBlockers: 1 }).missing).toContain("open_finance_blockers");
  });

  it("21 — a pending continue-before-payment decision blocks clearance", () => {
    expect(evaluateFinancialClearance({ ...CLEAR_OK, pendingPaymentDecision: true }).missing).toContain("pending_payment_decision");
  });

  it("22 — no invoice and no explicit deferral blocks clearance", () => {
    expect(evaluateFinancialClearance({ ...CLEAR_OK, invoiceState: "none" }).missing).toContain("invoice_not_generated");
  });

  it("23 — an EXPLICIT invoicing deferral satisfies the invoice condition", () => {
    const r = evaluateFinancialClearance({ ...CLEAR_OK, invoiceState: "none", invoiceIntentionallyDeferred: true });
    expect(r.ready).toBe(true);
  });

  it("24 — rejected and cancelled requests do not block (terminal, no money owed)", () => {
    const r = evaluateFinancialClearance({
      ...CLEAR_OK,
      requests: [
        { status: "REJECTED", evidenceStatus: "NONE" },
        { status: "CANCELLED", evidenceStatus: "NONE" },
        { status: "DISBURSED", evidenceStatus: "VERIFIED" },
      ],
    });
    expect(r.ready).toBe(true);
    for (const m of r.missing) expect(CLEARANCE_MISSING_LABELS_FR[m]).toBeTruthy();
  });
});

// ================================================== flag gating (tests 25-31) ====

describe("finance execution flag — dark by default, quintuple-gated", () => {
  it("25 — defaults off", () => {
    expect(resolveProcessFlags({}).financeExecution).toBe(false);
  });

  it("26 — the finance flag alone does nothing", () => {
    expect(resolveProcessFlags({ EFFITRANS_FINANCE_EXECUTION_ENABLED: "true" }).financeExecution).toBe(false);
  });

  it("27 — every prefix of the chain without TRANSIT stays dark", () => {
    expect(resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
      EFFITRANS_FINANCE_EXECUTION_ENABLED: "true",
    }).financeExecution).toBe(false);
  });

  it("28 — the full chain ENGINE+STRUCTURES+INTAKE+TRANSIT+FINANCE => live", () => {
    const f = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
      EFFITRANS_FINANCE_EXECUTION_ENABLED: "true",
    });
    expect(f.transitExecution).toBe(true);
    expect(f.financeExecution).toBe(true);
  });

  it("29 — the tenant rollout ANDs the env chain; FLAGS_ALL_OFF covers it", () => {
    expect(rollout).toContain("enabled && env.structures && env.intake && env.transitExecution && env.financeExecution");
    expect(FLAGS_ALL_OFF.financeExecution).toBe(false);
  });

  it("30 — a disabled tenant is dark even with every env flag on", () => {
    const env = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
      EFFITRANS_OPERATIONS_INTAKE_ENABLED: "true",
      EFFITRANS_TRANSIT_EXECUTION_ENABLED: "true",
      EFFITRANS_FINANCE_EXECUTION_ENABLED: "true",
    });
    expect(resolveEffectiveFlags(env, ROLLOUT_DISABLED).financeExecution).toBe(false);
  });

  it("31 — the flag is documented dark in .env.example", () => {
    expect(envExample).toContain("EFFITRANS_FINANCE_EXECUTION_ENABLED=false");
  });
});

// ============================================== action boundaries (tests 32-47) ====

describe("request-actions — boundaries enforced structurally", () => {
  it("32 — the guard requires kill.financeExecution AND tenant.financeExecution AND visibility", () => {
    const guard = actions.slice(actions.indexOf("async function financeGuard"), actions.indexOf("async function loadFile"));
    expect(guard).toContain("!kill.enabled || !kill.financeExecution");
    expect(guard).toContain("!tenantFlags.enabled || !tenantFlags.financeExecution");
    expect(guard).toContain("isFileVisible(user.id, user.tenantId, fileId)");
  });

  it("33 — APPROVAL NEVER CREATES A PAYMENT: review writes finance_request only", () => {
    const fn = actions.slice(actions.indexOf("export async function reviewFinanceRequest"), actions.indexOf("export async function resubmitFinanceRequest"));
    expect(fn).toContain('from("finance_request")');
    expect(fn).not.toContain('from("payment")');
    expect(fn).not.toContain('from("invoice")');
  });

  it("34 — the whole module never inserts a payment row or writes an invoice", () => {
    expect(actions).not.toContain('from("payment")');
    expect(actions).not.toContain('.from("invoice").insert');
    expect(actions).not.toContain('.from("invoice").update');
  });

  it("35 — maker-checker: the reviewer may never be the requester (identity check)", () => {
    expect(actions).toContain('if (req.requested_by === ctx.userId) return fail("self_review_forbidden")');
  });

  it("36 — disbursement is CAS on the single APPROVED edge (duplicate-proof)", () => {
    const fn = actions.slice(actions.indexOf("export async function recordDisbursement"), actions.indexOf("export async function attachDisbursementEvidence"));
    expect(fn).toContain('.eq("status", "APPROVED")');
    expect(fn).toContain('canTransitionFinanceRequest(req.status as FinanceRequestStatus, "DISBURSED")');
  });

  it("37 — rejection/return require a note; disbursement requires a valid method+amount", () => {
    expect(actions).toContain('input.verdict !== "APPROVED" && !input.note?.trim()');
    expect(actions).toContain("!isDisbursementMethod(input.method)");
    expect(actions).toContain("!Number.isFinite(input.amount) || input.amount <= 0");
  });

  it("38 — CUSTOMS BOUNDARY: the module never writes customs_record and never calls releaseCustoms", () => {
    expect(actions).not.toContain('from("customs_record")');
    expect(actions).not.toContain("releaseCustoms");
    expect(actions).not.toContain("custCustomsCleared");
  });

  it("39 — evidence attach validates same-tenant same-dossier document, sets SUBMITTED only", () => {
    const fn = actions.slice(actions.indexOf("export async function attachDisbursementEvidence"), actions.indexOf("export async function verifyDisbursementEvidence"));
    expect(fn).toContain('.eq("file_id", fileId)');
    expect(fn).toContain('evidence_status: "SUBMITTED"');
    expect(fn).not.toContain('"VERIFIED"');
  });

  it("40 — evidence verification: verifier ≠ executor, CAS on SUBMITTED, note on reject", () => {
    const fn = actions.slice(actions.indexOf("export async function verifyDisbursementEvidence"), actions.indexOf("export async function convertRequestToCharge"));
    expect(fn).toContain('if (req.disbursed_by === ctx.userId) return fail("self_verification_forbidden")');
    expect(fn).toContain('.eq("evidence_status", "SUBMITTED")');
    expect(fn).toContain('input.verdict === "REJECTED" && !input.note?.trim()');
  });

  it("41 — billable conversion: DISBURSED + reimbursable only, existing billing_charge chain, idempotent", () => {
    const fn = actions.slice(actions.indexOf("export async function convertRequestToCharge"), actions.indexOf("export async function clearFinance"));
    expect(fn).toContain('if (req.status !== "DISBURSED") return fail("invalid_state")');
    expect(fn).toContain('if (!req.reimbursable) return fail("not_reimbursable")');
    expect(fn).toContain('from("billing_charge")');
    expect(fn).toContain("if (req.billing_charge_id) return { ok: true, id: req.billing_charge_id }");
    expect(fn).toContain('.is("billing_charge_id", null)');
  });

  it("42 — clearance is evaluated by the PURE rule, refuses with the missing list", () => {
    const fn = actions.slice(actions.indexOf("export async function clearFinance"), actions.indexOf("export type FinanceRequestView"));
    expect(fn).toContain("evaluateClearanceLive(");
    expect(fn).toContain('error: "clearance_not_ready", missing: [...clearance.missing]');
  });

  it("43 — clearance output is the engine's EXISTING handoff; refusal degrades to notification", () => {
    const fn = actions.slice(actions.indexOf("export async function clearFinance"), actions.indexOf("export type FinanceRequestView"));
    expect(fn).toContain('sendHandoff(fileId, "gainde_registration", "coordinator_to_declarant")');
    expect(fn).toContain("if (!handoffSent)");
    expect(actions).not.toContain('from("process_handoff")');
  });

  it("44 — OWNERSHIP INVARIANT: no finance action touches owner/assignee/team columns", () => {
    expect(actions).not.toContain("owner_user_id");
    expect(actions).not.toContain("assigned_user_id");
    expect(actions).not.toContain("assigned_team_code");
    expect(actions).not.toContain("account_manager_id");
    expect(actions).not.toContain('from("operational_file").update');
    expect(actions).not.toContain('from("process_step_execution")');
  });

  it("45 — an explicit invoicing deferral requires a recorded reason", () => {
    expect(actions).toContain("opts?.invoiceIntentionallyDeferred && !opts.deferralReason?.trim()");
  });

  it("46 — the read side degrades to null when the migration is absent", () => {
    const fn = actions.slice(actions.indexOf("export async function getFinanceState"), actions.indexOf("async function evaluateClearanceLive"));
    expect(fn).toContain("if (reqError) return null;");
    expect(fn).toContain("} catch {");
    expect(fn).toContain("return null;");
  });

  it("47 — audit payloads carry safe metadata, never free-text notes", () => {
    const auditBlocks = [...actions.matchAll(/writeAudit\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(auditBlocks.length).toBeGreaterThanOrEqual(6);
    for (const block of auditBlocks) {
      expect(block).not.toContain("review_note");
      expect(block).not.toContain("evidence_note");
      expect(block).not.toContain("input.note");
    }
  });
});

// ======================================= permissions + no-expansion (48-55) ====

describe("Phase 9.0E permission reuse and scope", () => {
  it("48 — actions reuse EXISTING permissions only (no finance-execution permission invented)", () => {
    const perms = [...actions.matchAll(/financeGuard\("([a-z:]+)"/g)].map((m) => m[1]);
    expect(new Set(perms)).toEqual(new Set([
      "process:decision:create", "finance:validate", "finance:payment",
      "finance:update", "finance:void", "finance:create", "finance:read",
    ]));
  });

  it("49 — the migration inserts NO permission and NO role grant", () => {
    expect(migration).not.toContain("insert into public.permission");
    expect(migration).not.toContain("role_permission");
  });

  it("50 — no second payment/invoice table: exactly ONE new table, finance_request", () => {
    const creates = [...migration.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(creates).toEqual(["finance_request"]);
  });

  it("51 — the migration is the new latest, and build-info is bumped in lockstep", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260724000002_hr_employee_registry.sql");
    const buildInfo = read("../lib/platform/ops/build-info.ts");
    expect(buildInfo).toContain('LATEST_MIGRATION = "20260724000002_hr_employee_registry"');
    expect(buildInfo).toContain(`MIGRATION_COUNT = ${files.length}`);
  });

  it("52 — RLS: SELECT-only for finance:read staff with dossier visibility; NO portal policy", () => {
    expect(migration).toContain("has_permission('finance:read')");
    expect(migration).toContain("can_read_file(file_id)");
    expect(migration).toContain("for select to authenticated");
    expect(migration).not.toMatch(/create policy[^;]*portal/i);
    expect((migration.match(/create policy/g) ?? []).length).toBe(1);
  });

  it("53 — tenant trigger validates the dossier and every referenced actor/record", () => {
    for (const probe of ["requested_by", "reviewed_by", "disbursed_by", "evidence_verified_by", "customs_record_id", "evidence_document_id", "billing_charge_id"]) {
      expect(migration).toContain(probe);
    }
    expect(migration).toContain("enforce_finance_request_tenant");
  });

  it("54 — the table is registered in the tenant-scope guard registry", () => {
    expect(read("../lib/db/tenant-tables.ts")).toContain('"finance_request"');
  });

  it("55 — the RLS SQL test exists and is wired into CI", () => {
    expect(read("../supabase/tests/rls_finance_requests_test.sql")).toContain("RLS FINANCE REQUESTS FAIL");
    expect(ciYml).toContain("rls_finance_requests_test.sql");
  });
});

// ==================================================== UI + wiring (tests 56-62) ====

describe("finance panel and page wiring", () => {
  it("56 — the panel never labels an approval as paid, nor a submission as verified", () => {
    expect(panel).not.toContain('"Payé"');
    expect(panel).toContain("REQUEST_STATUS_LABELS_FR");
    expect(panel).toContain("EVIDENCE_STATUS_LABELS_FR");
  });

  it("57 — the panel shows requester/reviewer/executor as names, never a raw UUID", () => {
    expect(panel).toContain("r.requestedByName");
    expect(panel).toContain("r.reviewedByName");
    expect(panel).toContain("r.disbursedByName");
    expect(panel).not.toContain("requested_by");
  });

  it("58 — French-first operational vocabulary", () => {
    expect(panel).toContain("Demande de fonds");
    expect(panel).toContain("Enregistrer le décaissement");
    expect(panel).toContain("Feu vert financier");
    expect(panel).toContain("Refacturer au client");
  });

  it("59 — the billable conversion button shows only for reimbursable, unbilled, disbursed requests", () => {
    expect(panel).toContain('r.status === "DISBURSED" && r.reimbursable && !r.billed && canBill');
  });

  it("60 — clearance shortfalls render as French explanations", () => {
    expect(panel).toContain("CLEARANCE_MISSING_LABELS_FR[m]");
  });

  it("61 — the process page gates the panel on the tenant finance flag and hides on null", () => {
    expect(page).toContain("if (tenantFlags.financeExecution)");
    expect(page).toContain("getFinanceState(params.id)");
    expect(page).toContain("finance ? (");
    expect(page).toContain("{financePanel}");
  });

  it("62 — page permission props map to the existing finance catalog", () => {
    expect(page).toContain('canReview={hasPermission(permissions, "finance:validate")}');
    expect(page).toContain('canDisburse={hasPermission(permissions, "finance:payment")}');
    expect(page).toContain('canVerify={hasPermission(permissions, "finance:void")}');
  });
});
