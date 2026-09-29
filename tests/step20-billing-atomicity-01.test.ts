/**
 * STEP20-BILLING-ATOMICITY-01 — a failed workflow transition must not leave the
 * invoice authoritatively marked as successfully submitted, validated or
 * reopened.
 * ---------------------------------------------------------------------------
 * THE THREE DEFECTS THIS PINS.
 *
 *   1. `submitInvoiceToFinance` stamped `submitted_at` and, when `submitStep`
 *      refused, LEFT THE STAMP. The invoice was then unsubmittable for ever
 *      (`canSubmitInvoice` answers `duplicate_submission`) while step 20 said
 *      nobody had submitted anything.
 *   2. `approveInvoice` DISCARDED `approveStep`'s result — `ok: true` over a
 *      stalled dossier, with the invoice VALIDATED and steps 20/21 unfinished.
 *      Unrecoverable, because a non-DRAFT invoice cannot re-enter the lane.
 *   3. `rejectInvoice` discarded `rejectStep`'s result the same way.
 *
 * Both discarded results date to the day the lane was written; only the
 * submission path had ever been made honest, and being honest was not the same
 * as being recoverable.
 *
 * WHY THESE TESTS EXECUTE RATHER THAN READ. Every previous round of this work
 * was caught out by a structural assertion: BILLING-BYPASS-01's ninth probe
 * survived inside a server-only module, and CI-STEP20-01 shipped a `toMatch`
 * that PINNED a defect instead of catching it. Compensation cannot be asserted
 * by grep at all — "applied", "declined_row_changed" and "failed" are outcomes,
 * not shapes — so the module boundaries are mocked and the real actions run
 * against an in-memory table. Every claim below is the action's own behaviour.
 *
 * WHAT IS DELIBERATELY NOT COMPENSATED. `emailValidatedInvoice` consumes an
 * official number and sends an email. Those escaped; undoing them would be, in
 * its own words, "a lie of a different kind". Pinned at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "tenant-1";
const FILE = "file-1";
const INVOICE = "inv-1";
const MAKER = "user-maker";
const CHECKER = "user-checker";

type Row = Record<string, unknown>;

/** The one invoice row under test, plus a switch to fail a chosen write. */
const db: {
  invoice: Row | null;
  lineCount: number;
  /** Return an error from the NEXT update whose patch matches this predicate. */
  failUpdateWhen: ((patch: Row) => boolean) | null;
  /** Run just before an update is applied — used to stage a concurrent change. */
  beforeUpdate: ((patch: Row) => void) | null;
  updates: Row[];
} = { invoice: null, lineCount: 1, failUpdateWhen: null, beforeUpdate: null, updates: [] };

/** A deliberately small PostgREST stand-in: filters, update, select, count. */
function makeClient() {
  const build = (table: string) => ({
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      return query(table, "select", undefined, opts);
    },
    update(patch: Row) {
      return query(table, "update", patch);
    },
    insert(_v: Row) {
      return query(table, "insert");
    },
  });

  function query(table: string, op: string, patch?: Row, opts?: { count?: string; head?: boolean }) {
    const filters: Array<(r: Row) => boolean> = [];
    const self = {
      eq(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return self;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return self;
      },
      not(col: string, _op: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) !== val);
        return self;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return self;
      },
      order() {
        return self;
      },
      limit() {
        return self;
      },
      select() {
        return self;
      },
      maybeSingle() {
        return self.then((r: { data: Row[] | null }) => ({
          data: (r.data ?? [])[0] ?? null,
          error: null,
        }));
      },
      then(resolve: (v: { data: Row[] | null; error: unknown; count?: number }) => unknown) {
        const rows: Row[] =
          table === "invoice" && db.invoice ? [db.invoice] : table === "invoice_line" ? Array(db.lineCount).fill({}) : [];
        const matched = table === "invoice_line" ? rows : rows.filter((r) => filters.every((f) => f(r)));

        if (op === "update" && patch) {
          if (db.failUpdateWhen?.(patch)) {
            db.updates.push(patch);
            return Promise.resolve(resolve({ data: null, error: { message: "write failed" } }));
          }
          db.beforeUpdate?.(patch);
          // Re-filter AFTER the concurrent change: that is what a real CAS does.
          const nowMatched = (db.invoice ? [db.invoice] : []).filter((r) => filters.every((f) => f(r)));
          db.updates.push(patch);
          nowMatched.forEach((r) => Object.assign(r, patch));
          return Promise.resolve(resolve({ data: nowMatched, error: null }));
        }
        if (opts?.count) {
          return Promise.resolve(resolve({ data: null, error: null, count: matched.length }));
        }
        return Promise.resolve(resolve({ data: matched, error: null }));
      },
    };
    return self;
  }

  return { from: build, rpc: async () => ({ data: null, error: null }) };
}

let ACTOR = MAKER;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => makeClient() }));
vi.mock("@/lib/auth/require-permission", () => ({
  assertPermission: async () => ({ id: ACTOR, tenantId: TENANT }),
}));
vi.mock("@/lib/authz/visibility", () => ({ isFileVisible: async () => true }));
vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => ["finance:create", "finance:validate", "finance:issue"],
  hasPermission: (p: string[], k: string) => p.includes(k),
}));
const audits: Row[] = [];
vi.mock("@/lib/audit/log", () => ({ writeAudit: async (a: Row) => void audits.push(a) }));
vi.mock("@/lib/comms/queue", () => ({ queueAndSend: async () => ({ id: "m", status: "SENT" }) }));
vi.mock("@/lib/process/rollout-server", () => ({
  globalKillSwitch: () => ({ enabled: true }),
  getTenantProcessFlags: async () => ({ enabled: true }),
}));
vi.mock("@/lib/process/engine/gate-authority", () => ({ authoritativeBillingReady: async () => true }));
vi.mock("@/lib/process/engine/snapshot", () => ({
  loadProcessSnapshot: async () => ({
    instance: { id: "pi-1" },
    executions: [{ stepKey: "billing_draft", state: "ACTIVE", assignedUserId: null }],
    handoffs: [],
  }),
  toViews: () => [],
}));

/** Exactly the engine's own result shape, so a refusal is expressible. */
type EngineOutcome = { ok: true; id: string } | { ok: false; error: string };

const engine = {
  submitStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  approveStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  rejectStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
  activateStep: vi.fn(async (): Promise<EngineOutcome> => ({ ok: true, id: "x" })),
};
vi.mock("@/lib/process/engine/actions", () => ({
  submitStep: (...a: unknown[]) => engine.submitStep(...(a as [])),
  approveStep: (...a: unknown[]) => engine.approveStep(...(a as [])),
  rejectStep: (...a: unknown[]) => engine.rejectStep(...(a as [])),
  activateStep: (...a: unknown[]) => engine.activateStep(...(a as [])),
}));

const { submitInvoiceToFinance, approveInvoice, rejectInvoice } = await import(
  "@/lib/process/billing/actions"
);
const { canSubmitInvoice, canValidateInvoice, isAwaitingValidation, isEditableDraft } = await import(
  "@/lib/process/billing/state"
);

const view = () => ({
  id: INVOICE,
  status: db.invoice!.status as "DRAFT",
  submittedBy: (db.invoice!.submitted_by ?? null) as string | null,
  submittedAt: (db.invoice!.submitted_at ?? null) as string | null,
  validatedBy: (db.invoice!.validated_by ?? null) as string | null,
  validatedAt: (db.invoice!.validated_at ?? null) as string | null,
  rejectionReason: (db.invoice!.rejection_reason ?? null) as string | null,
  revision: db.invoice!.revision as number,
  lineCount: db.lineCount,
});

const lastStall = () =>
  [...audits].reverse().find((a) => a.action === "process.dispatch.not_advanced")?.after as Row | undefined;

function seed(over: Row = {}) {
  db.invoice = {
    id: INVOICE,
    file_id: FILE,
    tenant_id: TENANT,
    client_id: "client-1",
    status: "DRAFT",
    submitted_by: null,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    revision: 1,
    ...over,
  };
}

beforeEach(() => {
  seed();
  db.lineCount = 1;
  db.failUpdateWhen = null;
  db.beforeUpdate = null;
  db.updates = [];
  audits.length = 0;
  ACTOR = MAKER;
  for (const f of Object.values(engine)) f.mockClear();
  engine.submitStep.mockResolvedValue({ ok: true, id: "x" });
  engine.approveStep.mockResolvedValue({ ok: true, id: "x" });
  engine.rejectStep.mockResolvedValue({ ok: true, id: "x" });
  engine.activateStep.mockResolvedValue({ ok: true, id: "x" });
});
afterEach(() => vi.restoreAllMocks());

const submitted = (over: Row = {}) => seed({ submitted_by: MAKER, submitted_at: "2026-09-29T10:00:00Z", ...over });

// ======================================================= step 20 — submit ====

describe("submitInvoiceToFinance", () => {
  it("normal success: the stamp stands and nothing is compensated", async () => {
    const res = await submitInvoiceToFinance(INVOICE);
    expect(res.ok).toBe(true);
    expect(db.invoice!.submitted_by).toBe(MAKER);
    expect(db.invoice!.submitted_at).toBeTruthy();
    expect(lastStall()).toBeUndefined();
    expect(audits.some((a) => a.action === "invoice.draft.submitted")).toBe(true);
  });

  it("transition failure: the stamp is REVERTED and the failure is returned", async () => {
    engine.submitStep.mockResolvedValue({ ok: false, error: "invalid_state" });

    const res = await submitInvoiceToFinance(INVOICE);

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("step_completion_failed");
    expect(db.invoice!.submitted_at, "the mark must not survive a failed transition").toBeNull();
    expect(db.invoice!.submitted_by).toBeNull();

    const stall = lastStall()!;
    expect(stall.compensation).toBe("applied");
    expect(stall.invoice_submitted).toBe(false);
    expect(stall.reason, "the ORIGINAL workflow failure is preserved").toBe("invalid_state");
  });

  it("…and the invoice is retryable afterwards", async () => {
    engine.submitStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    await submitInvoiceToFinance(INVOICE);

    expect(isEditableDraft(view())).toBe(true);
    expect(canSubmitInvoice(view()).ok).toBe(true);

    engine.submitStep.mockResolvedValue({ ok: true, id: "x" });
    const retry = await submitInvoiceToFinance(INVOICE);
    expect(retry.ok, "a second attempt must succeed, not answer duplicate_submission").toBe(true);
    expect(db.invoice!.submitted_by).toBe(MAKER);
  });

  it("concurrent row change: compensation DECLINES and erases nothing", async () => {
    engine.submitStep.mockImplementation(async () => {
      // Somebody else validated the invoice while the transition was in flight.
      Object.assign(db.invoice!, { status: "VALIDATED", validated_by: CHECKER, validated_at: "t" });
      return { ok: false, error: "invalid_state" };
    });

    const res = await submitInvoiceToFinance(INVOICE);

    expect(res.ok).toBe(false);
    expect(lastStall()!.compensation).toBe("declined_row_changed");
    expect(lastStall()!.invoice_submitted).toBe(true);
    expect(db.invoice!.status, "the other actor's work is untouched").toBe("VALIDATED");
    expect(db.invoice!.validated_by).toBe(CHECKER);
    expect(db.invoice!.submitted_at, "and their submission mark stands").toBeTruthy();
  });

  it("a revision bump alone is enough to decline", async () => {
    engine.submitStep.mockImplementation(async () => {
      db.invoice!.revision = 2;
      return { ok: false, error: "invalid_state" };
    });
    await submitInvoiceToFinance(INVOICE);
    expect(lastStall()!.compensation).toBe("declined_row_changed");
    expect(db.invoice!.submitted_at).toBeTruthy();
  });

  it("compensation failure: reported as failed, never as success", async () => {
    engine.submitStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    db.failUpdateWhen = (patch) => patch.submitted_at === null;

    const res = await submitInvoiceToFinance(INVOICE);

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("step_completion_failed");
    expect(lastStall()!.compensation).toBe("failed");
    expect(lastStall()!.invoice_submitted, "nothing was proven, so the mark is reported as standing").toBe(true);
  });
});

// ===================================================== step 21 — approve ====

describe("approveInvoice", () => {
  beforeEach(() => {
    submitted();
    ACTOR = CHECKER;
  });

  it("normal success: VALIDATED stands", async () => {
    const res = await approveInvoice(INVOICE);
    expect(res.ok).toBe(true);
    expect(db.invoice!.status).toBe("VALIDATED");
    expect(db.invoice!.validated_by).toBe(CHECKER);
    expect(lastStall()).toBeUndefined();
  });

  it("REGRESSION: a failed transition is no longer reported as success", async () => {
    engine.approveStep.mockResolvedValue({ ok: false, error: "invalid_state" });

    const res = await approveInvoice(INVOICE);

    expect(res.ok, "this returned ok:true from the day the lane was written").toBe(false);
    expect((res as { error: string }).error).toBe("step_completion_failed");
    expect(lastStall()!.reason).toBe("invalid_state");
  });

  it("…and the validation is reverted to awaiting-validation, retryable", async () => {
    engine.approveStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    await approveInvoice(INVOICE);

    expect(lastStall()!.compensation).toBe("applied");
    expect(lastStall()!.invoice_validated).toBe(false);
    expect(db.invoice!.status).toBe("DRAFT");
    expect(db.invoice!.validated_by).toBeNull();
    expect(db.invoice!.validated_at).toBeNull();
    expect(db.invoice!.submitted_at, "an approval never touched this").toBeTruthy();
    expect(isAwaitingValidation(view())).toBe(true);
    expect(canValidateInvoice(view(), CHECKER).ok, "the same checker may retry").toBe(true);

    engine.approveStep.mockResolvedValue({ ok: true, id: "x" });
    expect((await approveInvoice(INVOICE)).ok).toBe(true);
  });

  it("does NOT resurrect a stale rejection_reason", async () => {
    submitted({ rejection_reason: "motif d'une révision dépassée" });
    engine.approveStep.mockResolvedValue({ ok: false, error: "invalid_state" });

    await approveInvoice(INVOICE);

    expect(lastStall()!.compensation).toBe("applied");
    expect(db.invoice!.rejection_reason, "the superseded motif stays gone").toBeNull();
    expect(isAwaitingValidation(view())).toBe(true);
  });

  it("concurrent row change declines, and compensation failure is reported", async () => {
    engine.approveStep.mockImplementation(async () => {
      db.invoice!.revision = 9;
      return { ok: false, error: "invalid_state" };
    });
    await approveInvoice(INVOICE);
    expect(lastStall()!.compensation).toBe("declined_row_changed");
    expect(db.invoice!.status, "a row we no longer recognise is left alone").toBe("VALIDATED");

    audits.length = 0;
    submitted();
    engine.approveStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    db.failUpdateWhen = (patch) => patch.status === "DRAFT";
    const res = await approveInvoice(INVOICE);
    expect(res.ok).toBe(false);
    expect(lastStall()!.compensation).toBe("failed");
  });

  it("maker != checker is enforced BEFORE anything is written", async () => {
    ACTOR = MAKER; // the maker is also the submitter here
    const res = await approveInvoice(INVOICE);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("self_approval_forbidden");
    expect(db.updates, "a refused review must write nothing at all").toHaveLength(0);
    expect(engine.approveStep).not.toHaveBeenCalled();
    expect(db.invoice!.status).toBe("DRAFT");
  });
});

// ====================================================== step 21 — reject ====

describe("rejectInvoice", () => {
  beforeEach(() => {
    submitted();
    ACTOR = CHECKER;
  });

  it("normal success: the draft is reopened with its motif", async () => {
    const res = await rejectInvoice(INVOICE, "TVA erronée");
    expect(res.ok).toBe(true);
    expect(db.invoice!.submitted_at).toBeNull();
    expect(db.invoice!.rejection_reason).toBe("TVA erronée");
    expect(db.invoice!.revision).toBe(2);
    expect(lastStall()).toBeUndefined();
  });

  it("REGRESSION: a failed transition is no longer reported as success", async () => {
    engine.rejectStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    const res = await rejectInvoice(INVOICE, "TVA erronée");
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe("step_completion_failed");
  });

  it("…and the reopening is reverted exactly, leaving it awaiting validation", async () => {
    submitted({ rejection_reason: "motif précédent" });
    engine.rejectStep.mockResolvedValue({ ok: false, error: "invalid_state" });

    await rejectInvoice(INVOICE, "TVA erronée");

    expect(lastStall()!.compensation).toBe("applied");
    expect(lastStall()!.invoice_reopened).toBe(false);
    expect(db.invoice!.submitted_at, "restored to the pre-invocation value").toBe("2026-09-29T10:00:00Z");
    expect(db.invoice!.revision, "the bump is undone").toBe(1);
    expect(db.invoice!.rejected_by).toBeNull();
    expect(db.invoice!.rejected_at).toBeNull();
    expect(db.invoice!.rejection_reason, "exact reversal, not resurrection").toBe("motif précédent");
    expect(isAwaitingValidation(view())).toBe(true);

    engine.rejectStep.mockResolvedValue({ ok: true, id: "x" });
    expect((await rejectInvoice(INVOICE, "TVA erronée")).ok, "retryable").toBe(true);
  });

  it("declines on a concurrent change and reports a failed revert", async () => {
    engine.rejectStep.mockImplementation(async () => {
      db.invoice!.revision = 7;
      return { ok: false, error: "invalid_state" };
    });
    await rejectInvoice(INVOICE, "motif");
    expect(lastStall()!.compensation).toBe("declined_row_changed");

    audits.length = 0;
    submitted();
    engine.rejectStep.mockResolvedValue({ ok: false, error: "invalid_state" });
    db.failUpdateWhen = (patch) => patch.rejected_by === null;
    expect((await rejectInvoice(INVOICE, "motif")).ok).toBe(false);
    expect(lastStall()!.compensation).toBe("failed");
  });

  it("a motif is still mandatory, and refusing writes nothing", async () => {
    const res = await rejectInvoice(INVOICE, "   ");
    expect((res as { error: string }).error).toBe("validation_reason_required");
    expect(db.updates).toHaveLength(0);
    expect(engine.rejectStep).not.toHaveBeenCalled();
  });
});

// ================================================ every fence is load-bearing ====

/**
 * One scenario per fenced column, each changing EXACTLY that column.
 *
 * The scenarios above change several at once — a concurrent validation moves
 * status, validated_by and validated_at together — so any one fence removed
 * from them is still caught by its neighbours, and four probes survived on the
 * first run. A fence is only proven by a row-version that differs in it alone.
 */
describe("each compensation fence, isolated", () => {
  const stallAfterMutating = async (mutate: () => void) => {
    engine.submitStep.mockImplementation(async () => {
      mutate();
      return { ok: false, error: "invalid_state" };
    });
    await submitInvoiceToFinance(INVOICE);
    return lastStall()!;
  };

  it("submit / status: a row that left DRAFT is not ours to revert", async () => {
    const stall = await stallAfterMutating(() => void (db.invoice!.status = "VOID"));
    expect(stall.compensation).toBe("declined_row_changed");
    expect(db.invoice!.submitted_at, "the mark is left exactly as found").toBeTruthy();
  });

  it("submit / submitted_by: another actor's mark is never erased", async () => {
    const stall = await stallAfterMutating(() => void (db.invoice!.submitted_by = "somebody-else"));
    expect(stall.compensation).toBe("declined_row_changed");
    expect(db.invoice!.submitted_by).toBe("somebody-else");
    expect(db.invoice!.submitted_at).toBeTruthy();
  });

  it("submit / validated_at: a validation landing at all is enough to decline", async () => {
    const stall = await stallAfterMutating(() => void (db.invoice!.validated_at = "2026-09-29T12:00:00Z"));
    expect(stall.compensation).toBe("declined_row_changed");
    expect(db.invoice!.submitted_at, "a validated submission is never unwound").toBeTruthy();
  });

  it("approve / validated_by: another checker's validation is never unwound", async () => {
    submitted();
    ACTOR = CHECKER;
    engine.approveStep.mockImplementation(async () => {
      db.invoice!.validated_by = "another-checker";
      return { ok: false, error: "invalid_state" };
    });
    await approveInvoice(INVOICE);
    expect(lastStall()!.compensation).toBe("declined_row_changed");
    expect(db.invoice!.status).toBe("VALIDATED");
    expect(db.invoice!.validated_by).toBe("another-checker");
  });
});

// ============================================ what must NEVER be undone ====

const root = join(__dirname, "..");
const code = (p: string) =>
  readFileSync(join(root, p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("issuance is never compensated, and no guard was touched", () => {
  const BILLING = "lib/process/billing/actions.ts";

  it("emailValidatedInvoice compensates nothing: the send and the number escaped", () => {
    const src = code(BILLING);
    const email = src.slice(src.indexOf("export async function emailValidatedInvoice"));
    expect(email).not.toContain("compensationOutcome");
    // It still refuses to call a stalled dispatch a success.
    expect(email).toContain("delivered_workflow_not_advanced");
    expect(email).toContain("const advanced = await submitStep(fileId, \"billing_dispatch\")");
  });

  it("every governed transition result is now KEPT", () => {
    const src = code(BILLING);
    for (const call of [
      'const advanced = await submitStep(fileId, "billing_draft")',
      'const advanced = await approveStep(fileId, "finance_invoice_validation")',
      'const advanced = await rejectStep(fileId, "finance_invoice_validation", r.value!)',
    ]) {
      expect(src, call).toContain(call);
    }
    // …and none is issued as a bare statement any more.
    expect(src).not.toMatch(/^\s*await (submit|approve|reject)Step\(/m);
  });

  it("each compensation is fenced to this invocation's exact row-version", () => {
    const src = code(BILLING);
    const fenceFor = (fn: string) => {
      const start = src.indexOf(`export async function ${fn}`);
      const end = src.indexOf("export async function", start + 10);
      return src.slice(start, end === -1 ? undefined : end);
    };
    expect(fenceFor("submitInvoiceToFinance")).toContain('.eq("submitted_at", stampedAt)');
    expect(fenceFor("submitInvoiceToFinance")).toContain('.eq("revision", loaded.view.revision)');
    expect(fenceFor("approveInvoice")).toContain('.eq("validated_at", now)');
    expect(fenceFor("approveInvoice")).toContain('.eq("revision", loaded.view.revision)');
    expect(fenceFor("rejectInvoice")).toContain('.eq("rejected_at", now)');
    expect(fenceFor("rejectInvoice")).toContain('.eq("revision", loaded.view.revision + 1)');
  });

  it("no schema, numbering or guard change rode along", () => {
    const src = code(BILLING);
    expect((src.match(/next_invoice_number/g) ?? []).length, "still allocated exactly once").toBe(1);
    expect(src).not.toMatch(/\b(alter table|create table|grant )/i);
    expect(src).not.toMatch(/viaDomainAction|bypassToken|skipGuard/);
    // Step 20 is never unclaimed by a compensation.
    expect(src).not.toMatch(/deactivateStep|unclaim/i);
  });
});
