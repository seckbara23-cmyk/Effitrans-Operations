/**
 * Phase 11.0D — Autorisation de Dépenses: the approval (visa) chain.
 * ---------------------------------------------------------------------------
 * The chain evaluator is PURE, so the workflow rules are tested as BEHAVIOUR
 * (call it, assert the verdict) rather than as source text — a real regression
 * net, not a spelling check. Source assertions are used only where importing the
 * server chain is impossible (the actions module) or where the guarantee lives
 * in SQL (the unique index, the grants).
 *
 * The chain under test is the ratified one (DEC-C08): Demandeur → Chef de
 * Transit → Coordonnateur → Opération(UNBOUND) → Trésorière → DAF → DG.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AUTHORIZATION_SIGNER_MAP,
  REQUESTER_STEP,
  SIGN_REFUSAL_LABELS_FR,
  chainStateView,
  evaluateSign,
  isBlockedStep,
  isChainComplete,
  nextRequiredStep,
  signerRoleFor,
  visaLabelFr,
  type ChainVisa,
  type RecordedVisa,
} from "@/lib/finance/expense/visa";
import { AUTHORIZATION_VISA_STEPS, VISA_DECISIONS, isUnboundVisaStep } from "@/lib/finance/expense/types";
import { AUTHORIZATION_VISA_BOXES } from "@/lib/finance/expense/template-map";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const ACTIONS = read("../lib/finance/expense/actions.ts");
const READERS = read("../lib/finance/expense/readers.ts");
const MIGRATION = read("../supabase/migrations/20260726000002_expense_approval_chain.sql");
const SEED = read("../supabase/seed.sql");
const QUEUE_PAGE = read("../app/finance/autorisations-depenses/approbations/page.tsx");
const DETAIL_PAGE = read("../app/finance/autorisations-depenses/[id]/page.tsx");
const VISA_UI = read("../components/finance/expense/visa-actions.tsx");
const CI = read("../.github/workflows/ci.yml");

/** recordExpenseVisa's source, bounded at the next exported function. */
const visaFn = () =>
  ACTIONS.slice(
    ACTIONS.indexOf("export async function recordExpenseVisa"),
    ACTIONS.indexOf("export async function createExpenseVoucherFromAuthorization"),
  );

// Actors used throughout.
const REQUESTER = "user-requester";
const CHEF = "user-chef";
const COORD = "user-coord";
const TRESO = "user-treso";

const approved = (ordinal: number, signerUserId: string): RecordedVisa => ({
  stepOrdinal: ordinal,
  decision: "APPROVED",
  signerUserId,
});

/** Sign as the requester (step 1) then as the named role holders, in order. */
const AFTER_STEP_1 = [approved(1, REQUESTER)];
const AFTER_STEP_2 = [...AFTER_STEP_1, approved(2, CHEF)];
const AFTER_STEP_3 = [...AFTER_STEP_2, approved(3, COORD)];

const attempt = (over: Partial<Parameters<typeof evaluateSign>[0]> = {}) =>
  evaluateSign({
    visas: [],
    actorUserId: REQUESTER,
    actorRoleCodes: [],
    requesterUserId: REQUESTER,
    ...over,
  });

// ===================================== A. The chain itself (1-8) ============

describe("the chain is the ratified Autorisation chain (DEC-C08)", () => {
  it("1 — seven steps, in the printed order", () => {
    expect(AUTHORIZATION_VISA_STEPS.map((s) => s.code)).toEqual([
      "VISA_DEMANDEUR",
      "VISA_CHEF_TRANSIT",
      "VISA_COORDONNATEUR",
      "VISA_OPERATIONS",
      "VISA_TRESORIERE",
      "VISA_DAF",
      "VISA_DG",
    ]);
  });

  it("2 — the chain contains NO step belonging to the Bon's chain", () => {
    // Agent / Réception / Comptable / DGA sign the Bon (DEC-C09), never this form.
    for (const foreign of ["VISA_AGENT", "VISA_RECEPTION", "VISA_COMPTABLE", "VISA_DGA"]) {
      expect(AUTHORIZATION_VISA_STEPS.map((s) => s.code)).not.toContain(foreign);
    }
  });

  it("3 — the evaluated chain and the PRINTED visa boxes are the same seven steps", () => {
    // The form and the workflow cannot disagree: one vocabulary, one order.
    expect(AUTHORIZATION_VISA_BOXES.map((b) => b.code)).toEqual(AUTHORIZATION_VISA_STEPS.map((s) => s.code));
    expect(AUTHORIZATION_VISA_BOXES.map((b) => b.label)).toEqual(
      AUTHORIZATION_VISA_STEPS.map((s) => visaLabelFr(s.code)),
    );
  });

  it("4 — the signer map binds every step except the two by design", () => {
    expect(signerRoleFor("VISA_CHEF_TRANSIT")).toBe("CHIEF_OF_TRANSIT");
    expect(signerRoleFor("VISA_COORDONNATEUR")).toBe("COORDINATOR");
    expect(signerRoleFor("VISA_TRESORIERE")).toBe("TREASURER");
    expect(signerRoleFor("VISA_DAF")).toBe("DAF");
    expect(signerRoleFor("VISA_DG")).toBe("CEO");
    // Demandeur = identity-bound; Opération = unresolved business blocker.
    expect(signerRoleFor("VISA_DEMANDEUR")).toBeNull();
    expect(signerRoleFor("VISA_OPERATIONS")).toBeNull();
  });

  it("5 — every mapped role actually exists as a tenant role", () => {
    const keys = TENANT_ROLE_TEMPLATES.map((t) => t.key);
    for (const role of Object.values(AUTHORIZATION_SIGNER_MAP)) {
      if (role) expect(keys, role).toContain(role);
    }
  });

  it("6 — VISA_OPERATIONS is BLOCKED; the requester step is NOT (identity-bound)", () => {
    expect(isBlockedStep("VISA_OPERATIONS")).toBe(true);
    expect(isBlockedStep(REQUESTER_STEP)).toBe(false);
    // Both are "unbound" in the 11.0B vocabulary, for different reasons.
    expect(isUnboundVisaStep("VISA_OPERATIONS")).toBe(true);
  });

  it("7 — no signer is invented for the blocked step", () => {
    expect(AUTHORIZATION_SIGNER_MAP.VISA_OPERATIONS).toBeNull();
    expect(MIGRATION).not.toMatch(/VISA_OPERATIONS.*role|OPS_SUPERVISOR/);
  });

  it("8 — the decision vocabulary is the ledger's three values", () => {
    expect([...VISA_DECISIONS]).toEqual(["APPROVED", "REJECTED", "RETURNED"]);
  });
});

// ============================ B. Sequential enforcement (9-20) ==============

describe("sequential approval", () => {
  it("9 — an empty chain starts at step 1", () => {
    expect(nextRequiredStep([])?.code).toBe("VISA_DEMANDEUR");
  });

  it("10 — the requester signs step 1, and only the requester", () => {
    expect(attempt({ actorUserId: REQUESTER })).toEqual({ ok: true, step: AUTHORIZATION_VISA_STEPS[0] });
    const other = attempt({ actorUserId: "someone-else", actorRoleCodes: ["CHIEF_OF_TRANSIT"] });
    expect(other).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("11 — after step 1 the chain advances to step 2", () => {
    expect(nextRequiredStep(AFTER_STEP_1)?.code).toBe("VISA_CHEF_TRANSIT");
  });

  it("12 — step 2 requires CHIEF_OF_TRANSIT", () => {
    const ok = attempt({ visas: AFTER_STEP_1, actorUserId: CHEF, actorRoleCodes: ["CHIEF_OF_TRANSIT"] });
    expect(ok.ok).toBe(true);
    const wrong = attempt({ visas: AFTER_STEP_1, actorUserId: "x", actorRoleCodes: ["COORDINATOR"] });
    expect(wrong).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("13 — a signer holding SEVERAL roles is accepted on any step they cover", () => {
    const multi = attempt({ visas: AFTER_STEP_1, actorUserId: CHEF, actorRoleCodes: ["COORDINATOR", "CHIEF_OF_TRANSIT"] });
    expect(multi.ok).toBe(true);
  });

  it("14 — a step CANNOT be skipped: aiming past the next step is refused", () => {
    const skip = evaluateSign({
      visas: AFTER_STEP_1,
      actorUserId: TRESO,
      actorRoleCodes: ["TREASURER"],
      requesterUserId: REQUESTER,
      intendedStepCode: "VISA_TRESORIERE", // step 5, while step 2 is pending
    });
    expect(skip).toEqual({ ok: false, reason: "out_of_sequence" });
  });

  it("15 — a later signer cannot sign early simply by holding the role", () => {
    // The Treasurer holds TREASURER but step 2 is what is pending.
    const early = attempt({ visas: AFTER_STEP_1, actorUserId: TRESO, actorRoleCodes: ["TREASURER"] });
    expect(early).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("16 — an earlier, already-signed step cannot be re-signed", () => {
    const back = evaluateSign({
      visas: AFTER_STEP_2,
      actorUserId: "another-chef",
      actorRoleCodes: ["CHIEF_OF_TRANSIT"],
      requesterUserId: REQUESTER,
      intendedStepCode: "VISA_CHEF_TRANSIT",
    });
    expect(back).toEqual({ ok: false, reason: "out_of_sequence" });
  });

  it("17 — one signer holds at most ONE visa per version", () => {
    // The requester already signed step 1; they cannot also take step 2.
    const twice = attempt({ visas: AFTER_STEP_1, actorUserId: REQUESTER, actorRoleCodes: ["CHIEF_OF_TRANSIT"] });
    expect(twice).toEqual({ ok: false, reason: "already_signed" });
  });

  it("18 — the chain HALTS at the unbound signer and cannot be passed", () => {
    const atBlocked = nextRequiredStep(AFTER_STEP_3);
    expect(atBlocked?.code).toBe("VISA_OPERATIONS");
    // Nobody can sign it — not even a holder of every other role.
    const anyone = attempt({
      visas: AFTER_STEP_3,
      actorUserId: "power-user",
      actorRoleCodes: ["CHIEF_OF_TRANSIT", "COORDINATOR", "TREASURER", "DAF", "CEO"],
    });
    expect(anyone).toEqual({ ok: false, reason: "signer_not_configured" });
  });

  it("19 — the blocked step is never auto-signed or skipped over", () => {
    // The step after the blocker stays unreachable while it is unsigned.
    expect(nextRequiredStep(AFTER_STEP_3)?.ordinal).toBe(4);
    expect(isChainComplete(AFTER_STEP_3)).toBe(false);
  });

  it("20 — a fully signed chain is complete and refuses further visas", () => {
    const all = AUTHORIZATION_VISA_STEPS.map((s, i) => approved(s.ordinal, `signer-${i}`));
    expect(isChainComplete(all)).toBe(true);
    expect(nextRequiredStep(all)).toBeNull();
    expect(attempt({ visas: all, actorUserId: "z", actorRoleCodes: ["CEO"] })).toEqual({
      ok: false,
      reason: "chain_complete",
    });
  });
});

// ==================================== C. Refusals + attempts (21-26) ========

describe("rejection and return", () => {
  it("21 — a REJECTED visa does NOT advance the chain", () => {
    const rejected: RecordedVisa[] = [...AFTER_STEP_1, { stepOrdinal: 2, decision: "REJECTED", signerUserId: CHEF }];
    // Step 2 is still the required step — a refusal never counts as progress.
    expect(nextRequiredStep(rejected)?.ordinal).toBe(2);
    expect(isChainComplete(rejected)).toBe(false);
  });

  it("22 — a RETURNED visa likewise does not advance the chain", () => {
    const returned: RecordedVisa[] = [...AFTER_STEP_1, { stepOrdinal: 2, decision: "RETURNED", signerUserId: CHEF }];
    expect(nextRequiredStep(returned)?.ordinal).toBe(2);
  });

  it("23 — a refusal must carry a reason (fail-closed audit rule)", () => {
    expect(ACTIONS).toMatch(/decision !== "APPROVED" && !nonEmpty\(comment\)/);
  });

  it("24 — a rejection CLOSES the attempt with the same outcome, never deletes it", () => {
    const fn = visaFn();
    expect(fn).toMatch(/\.update\(\{ status: decision === "APPROVED" \? "APPROVED" : decision, closed_at/);
    expect(fn).not.toMatch(/\.delete\(\)/);
  });

  it("25 — a material edit supersedes the open attempt and opens a fresh one", () => {
    // 11.0B behaviour, still the mechanism 11.0D relies on for restart-after-edit.
    expect(ACTIONS).toContain("supersedeAndReopenAttempt");
    const helper = ACTIONS.slice(ACTIONS.indexOf("async function supersedeAndReopenAttempt"));
    expect(helper).toContain('status: "SUPERSEDED"');
    expect(helper).toContain('attempt_number: (open.attempt_number as number) + 1');
  });

  it("26 — an attempt already open on the current version is REUSED, not stacked", () => {
    const helper = ACTIONS.slice(ACTIONS.indexOf("async function openAttempt"));
    expect(helper).toMatch(/alreadyOpen/);
    expect(helper).toContain('.eq("version_id", versionId)');
  });
});

// =============================== D. Version interaction (27-31) =============

describe("versions and supersession", () => {
  it("27 — a visa records the EXACT version and attempt it signed", () => {
    const fn = visaFn();
    expect(fn).toContain("version_id: versionId");
    expect(fn).toContain("attempt_id: attempt.id");
    expect(fn).toContain("content_sha256: version.content_sha256");
  });

  it("28 — a SUPERSEDED version cannot be approved: a stale attempt is refused", () => {
    const fn = visaFn();
    expect(fn).toMatch(/attempt\.version_id !== versionId[\s\S]{0,80}fail\("invalid_state"\)/);
  });

  it("29 — signing always targets the document's CURRENT version", () => {
    const fn = visaFn();
    expect(fn).toContain("const versionId = row.current_version_id");
  });

  it("30 — only visas of the current version + open attempt drive the chain", () => {
    const fn = visaFn();
    expect(fn).toContain('.eq("version_id", versionId)');
    expect(fn).toContain('.eq("attempt_id", attempt.id)');
  });

  it("31 — prior versions and their visas are never rewritten", () => {
    const fn = visaFn();
    // The ledger is only ever appended to.
    expect(fn).toContain('.from("expense_visa")\n    .insert(');
    expect(fn).not.toMatch(/from\("expense_visa"\)[\s\S]{0,120}\.update\(/);
  });
});

// ================================ E. Chain projection (32-36) ===============

describe("chain projection for display", () => {
  const withNames = (visas: RecordedVisa[]): ChainVisa[] =>
    visas.map((v) => ({
      ...v,
      stepCode: AUTHORIZATION_VISA_STEPS[v.stepOrdinal - 1].code,
      signerDisplayName: `Signer ${v.stepOrdinal}`,
      decidedAt: "2026-07-26T10:00:00.000Z",
      comment: null,
    }));

  it("32 — signed steps are SIGNED, the next is CURRENT, the rest PENDING", () => {
    const view = chainStateView(withNames(AFTER_STEP_2));
    expect(view.map((s) => s.state)).toEqual([
      "SIGNED",
      "SIGNED",
      "CURRENT",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("33 — the unbound step surfaces as BLOCKED, never as CURRENT", () => {
    const view = chainStateView(withNames(AFTER_STEP_3));
    expect(view[3].state).toBe("BLOCKED");
    expect(view.some((s) => s.state === "CURRENT")).toBe(false);
  });

  it("34 — a refusal surfaces as REFUSED and carries its comment", () => {
    const view = chainStateView([
      ...withNames(AFTER_STEP_1),
      {
        stepOrdinal: 2,
        decision: "REJECTED",
        signerUserId: CHEF,
        stepCode: "VISA_CHEF_TRANSIT",
        signerDisplayName: "Chef",
        decidedAt: "2026-07-26T11:00:00.000Z",
        comment: "Montant incorrect",
      },
    ]);
    expect(view[1].state).toBe("REFUSED");
    expect(view[1].comment).toBe("Montant incorrect");
  });

  it("35 — the projection always covers all seven steps in order", () => {
    for (const visas of [[], AFTER_STEP_1, AFTER_STEP_3]) {
      const view = chainStateView(withNames(visas as RecordedVisa[]));
      expect(view).toHaveLength(7);
      expect(view.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("36 — every refusal has a French explanation (no bare error codes in the UI)", () => {
    for (const reason of [
      "chain_complete",
      "signer_not_configured",
      "wrong_signer",
      "already_signed",
      "out_of_sequence",
    ] as const) {
      expect(SIGN_REFUSAL_LABELS_FR[reason]).toBeTruthy();
    }
  });
});

// ================================= F. Action discipline (37-45) =============

describe("the sign action", () => {
  // Bounded at the next exported function — an unbounded slice would drag the
  // voucher actions in and make these assertions meaningless.
  const fn = ACTIONS.slice(
    ACTIONS.indexOf("export async function recordExpenseVisa"),
    ACTIONS.indexOf("export async function createExpenseVoucherFromAuthorization"),
  );

  it("37 — is gated on finance:expense:sign", () => {
    expect(fn).toContain('guard("finance:expense:sign")');
  });

  it("38 — delegates EVERY eligibility decision to the pure evaluator", () => {
    expect(fn).toContain("evaluateSign({");
    expect(fn).toContain("if (!verdict.ok) return fail(verdict.reason)");
    // No second implementation of the rules inside the action.
    expect(fn).not.toMatch(/step_ordinal === 1|ordinal \+ 1|includes\("CHIEF_OF_TRANSIT"\)/);
  });

  it("39 — is tenant-scoped on every query it makes", () => {
    const froms = (fn.match(/\.from\(/g) ?? []).length;
    const scoped = (fn.match(/\.eq\("tenant_id", ctx\.tenantId\)/g) ?? []).length;
    expect(scoped).toBeGreaterThanOrEqual(froms - 1); // the insert carries tenant_id in its payload
    expect(fn).toContain("tenant_id: ctx.tenantId");
  });

  it("40 — freezes the signer's ROLE AT SIGNING, not a live lookup", () => {
    expect(fn).toContain("signer_role_code: signerRoleCode");
    expect(fn).toContain("signer_display_name:");
  });

  it("41 — completes the document only when the chain is complete", () => {
    expect(fn).toMatch(/chainComplete[\s\S]{0,200}nextStatus = "APPROVED"/);
    expect(fn).toContain('isChainComplete(');
  });

  it("42 — every terminal transition is compare-and-set on IN_APPROVAL", () => {
    expect(fn).toMatch(/\.eq\("status", "IN_APPROVAL"\)/);
    expect(fn).toContain("canTransitionAuthorization(\"IN_APPROVAL\", nextStatus)");
  });

  it("43 — a UNIQUE violation is treated as a concurrent signer, not a crash", () => {
    expect(fn).toMatch(/visaError[\s\S]{0,80}fail\("out_of_sequence"\)/);
  });

  it("44 — audits the transition with SAFE metadata only", () => {
    expect(AuditActions.EXPENSE_VISA_RECORDED).toBe("finance.expense.visa.recorded");
    const payload = fn.slice(fn.indexOf("after: {", fn.indexOf("writeAudit")), fn.indexOf("});", fn.indexOf("writeAudit")));
    // actor/action/document/version/attempt/outcome — and nothing financial.
    expect(payload).toContain("step_code");
    expect(payload).toContain("attempt_id");
    expect(payload).toContain("version_id");
    expect(payload).toContain("status");
    expect(payload).not.toMatch(/\bamount\b|beneficiary|account_number|comment/);
  });

  it("45 — the comment TEXT is never written into the audit payload", () => {
    // The comment lives on the immutable visa row; the audit records that a
    // decision happened, not what the signer wrote about the money.
    const payload = fn.slice(fn.indexOf("writeAudit"), fn.indexOf("});", fn.indexOf("writeAudit")));
    expect(payload).not.toContain("comment:");
  });
});

// ================================ G. Queue + surfaces (46-53) ===============

describe("approval queue and surfaces", () => {
  it("46 — the queue reader requires the SIGNING capability, not merely read", () => {
    const fn = READERS.slice(READERS.indexOf("export async function getExpenseApprovalQueue"));
    expect(fn).toContain("!ctx.canSign");
    expect(READERS).toContain('hasPermission(permissions, "finance:expense:sign")');
  });

  it("47 — the queue uses the SAME evaluator, so it cannot list unsignable work", () => {
    const fn = READERS.slice(READERS.indexOf("export async function getExpenseApprovalQueue"));
    expect(fn).toContain("evaluateSign({");
    expect(fn).toContain("if (!verdict.ok) continue");
  });

  it("48 — the queue is tenant-scoped", () => {
    const fn = READERS.slice(READERS.indexOf("export async function getExpenseApprovalQueue"));
    expect((fn.match(/\.eq\("tenant_id", ctx\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("49 — the queue page is permission-gated server-side", () => {
    expect(QUEUE_PAGE).toContain('hasPermission(permissions, "finance:expense:read")');
    expect(QUEUE_PAGE).toContain('hasPermission(permissions, "finance:expense:sign")');
    expect(QUEUE_PAGE).toContain("notFound()");
  });

  it("50 — the detail page renders the LIVE chain, not a static list", () => {
    expect(DETAIL_PAGE).toContain("getExpenseAuthorizationChain");
    expect(DETAIL_PAGE).toContain("<ApprovalTimeline");
    expect(DETAIL_PAGE).toContain("<VisaActions");
  });

  it("51 — the sign UI shows a refusal reason instead of a dead button", () => {
    expect(VISA_UI).toContain("SIGN_REFUSAL_LABELS_FR");
    expect(VISA_UI).toContain("if (!canSign)");
  });

  it("52 — a refusal cannot be submitted without a reason", () => {
    expect(VISA_UI).toMatch(/disabled=\{pending \|\| comment\.trim\(\)\.length === 0\}/);
  });

  it("53 — no payment UI is introduced in this phase", () => {
    const surfaces = [QUEUE_PAGE, DETAIL_PAGE, VISA_UI].join("\n");
    expect(surfaces).not.toMatch(/READY_FOR_PAYMENT|payment_method|Payer|paiement/i);
  });
});

// ============================= H. Schema + grants (54-62) ===================

describe("migration — the concurrency backstop and the signer grants", () => {
  it("54 — a UNIQUE index makes a double-signed step structurally impossible", () => {
    expect(MIGRATION).toMatch(
      /create unique index uq_expense_visa_attempt_step\s+on public\.expense_visa \(attempt_id, step_ordinal\)/,
    );
  });

  it("55 — the migration creates/alters/drops NO table and changes NO policy", () => {
    expect(MIGRATION).not.toMatch(/create table|alter table|drop |truncate /i);
    expect(MIGRATION).not.toMatch(/create policy|drop policy|enable row level security/i);
  });

  it("56 — it invents NO permission", () => {
    expect(MIGRATION).not.toContain("insert into public.permission");
    for (const code of [...MIGRATION.matchAll(/'(finance:expense:[a-z]+)'/g)].map((m) => m[1])) {
      expect(["finance:expense:sign", "finance:expense:read"]).toContain(code);
    }
  });

  it("57 — sign goes to exactly the six seats that sign THIS chain", () => {
    expect(MIGRATION).toMatch(
      /p\.code = 'finance:expense:sign'[\s\S]{0,200}'FINANCE_OFFICER', 'CHIEF_OF_TRANSIT', 'COORDINATOR', 'TREASURER', 'DAF', 'CEO'/,
    );
  });

  it("58 — CASHIER and SYSTEM_ADMIN are NOT granted sign (segregation of duties)", () => {
    const signGrant = MIGRATION.slice(
      MIGRATION.indexOf("p.code = 'finance:expense:sign'"),
      MIGRATION.indexOf("finance:expense:read"),
    );
    expect(signGrant).not.toContain("CASHIER");
    expect(signGrant).not.toContain("SYSTEM_ADMIN");
  });

  it("59 — ACCOUNTANT and DGA do NOT gain sign: they sign the BON's chain", () => {
    const admin = TENANT_ROLE_TEMPLATES.find((t) => t.key === "ACCOUNTANT")!;
    const dga = TENANT_ROLE_TEMPLATES.find((t) => t.key === "DGA")!;
    expect(admin.permissions).not.toContain("finance:expense:sign");
    expect(dga.permissions).not.toContain("finance:expense:sign");
  });

  it("60 — the six signing seats hold BOTH sign and read (they must see what they sign)", () => {
    for (const key of ["FINANCE_OFFICER", "CHIEF_OF_TRANSIT", "COORDINATOR", "TREASURER", "DAF", "CEO"]) {
      const t = TENANT_ROLE_TEMPLATES.find((x) => x.key === key)!;
      expect(t.permissions, `${key} sign`).toContain("finance:expense:sign");
      expect(t.permissions, `${key} read`).toContain("finance:expense:read");
    }
  });

  it("61 — the seed mirrors the migration's grants exactly", () => {
    expect(SEED).toMatch(
      /p\.code = 'finance:expense:sign'[\s\S]{0,200}'FINANCE_OFFICER', 'CHIEF_OF_TRANSIT', 'COORDINATOR', 'TREASURER', 'DAF', 'CEO'/,
    );
    expect(SEED).toMatch(/p\.code = 'finance:expense:read'[\s\S]{0,160}'CHIEF_OF_TRANSIT', 'COORDINATOR', 'CEO'/);
  });

  it("62 — the RLS suite for the chain is wired into CI", () => {
    expect(CI).toContain("supabase/tests/rls_expense_approval_test.sql");
  });
});
