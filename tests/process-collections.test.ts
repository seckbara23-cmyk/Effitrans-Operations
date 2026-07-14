/**
 * Phase 5.0D-4 — Collections, aging, promises, disputes, and EXPLICIT closure.
 * Official step 26.
 *
 * These carry the six critical principles: collections is not payment processing,
 * payment is not closure, and full payment alone must never close a dossier.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AGING_BUCKETS,
  evaluateAging,
  todayInTimezone,
  type AgingInput,
} from "@/lib/collections/aging";
import {
  DISPUTE_CATEGORIES,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  derivePromise,
  disputeBlocksClosure,
  evaluateCollectionsPriority,
  isChannel,
  isOutcome,
  sanitizeNote,
  MAX_NOTE,
  type CollectionsSignals,
  type FollowUp,
} from "@/lib/collections/model";
import { evaluateClosure, type ClosureInput } from "@/lib/process/engine/closure";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";
import { resolveProcessFlags } from "@/lib/process/flags";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const actions = read("../lib/collections/actions.ts");
const service = read("../lib/collections/service.ts");

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

// ---------------------------------------------------------------------- aging ----

const aging = (o: Partial<AgingInput> = {}): AgingInput => ({
  status: "ISSUED",
  dueDate: "2026-06-01",
  total: 100,
  paid: 0,
  disputed: false,
  today: "2026-07-14",
  ...o,
});

describe("aging model (Deliverable 6)", () => {
  it("declares all nine official buckets", () => {
    expect(AGING_BUCKETS).toHaveLength(9);
    for (const b of ["NOT_DUE", "DUE_TODAY", "1_TO_30_DAYS", "31_TO_60_DAYS", "61_TO_90_DAYS", "OVER_90_DAYS", "PAID", "DISPUTED", "DUE_DATE_MISSING"]) {
      expect(AGING_BUCKETS).toContain(b);
    }
  });

  it("NEVER calls an invoice overdue without a due date", () => {
    const r = evaluateAging(aging({ dueDate: null }));
    expect(r.bucket).toBe("DUE_DATE_MISSING");
    expect(r.overdue).toBe(false);
    expect(r.daysOutstanding).toBeNull();
  });

  it("treats DUE TODAY as not yet overdue — the client still has the day", () => {
    const r = evaluateAging(aging({ dueDate: "2026-07-14", today: "2026-07-14" }));
    expect(r.bucket).toBe("DUE_TODAY");
    expect(r.overdue).toBe(false);
  });

  it("buckets by days past due", () => {
    expect(evaluateAging(aging({ dueDate: "2026-08-01" })).bucket).toBe("NOT_DUE");
    expect(evaluateAging(aging({ dueDate: "2026-07-01" })).bucket).toBe("1_TO_30_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-06-01" })).bucket).toBe("31_TO_60_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-05-01" })).bucket).toBe("61_TO_90_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-01-01" })).bucket).toBe("OVER_90_DAYS");
  });

  it("reduces the outstanding balance by partial payments", () => {
    const r = evaluateAging(aging({ total: 100, paid: 40 }));
    expect(r.outstanding).toBe(60);
    expect(r.partiallyPaid).toBe(true);
    expect(r.fullyPaid).toBe(false);
  });

  it("marks PAID at zero balance and never overdue", () => {
    const r = evaluateAging(aging({ total: 100, paid: 100, dueDate: "2020-01-01" }));
    expect(r.bucket).toBe("PAID");
    expect(r.overdue).toBe(false);
  });

  it("FREEZES aging on a dispute without erasing the amount due", () => {
    const r = evaluateAging(aging({ disputed: true, dueDate: "2020-01-01", total: 100, paid: 20 }));
    expect(r.bucket).toBe("DISPUTED");
    expect(r.overdue).toBe(false);
    // The debt is still 80 — a dispute does not make money disappear.
    expect(r.outstanding).toBe(80);
  });

  it("ages in the TENANT'S timezone, not the server's UTC day", () => {
    // 23:30 UTC on 14 July is still 23:30 on 14 July in Dakar (UTC+0)...
    const dakar = todayInTimezone("Africa/Dakar", new Date("2026-07-14T23:30:00Z"));
    expect(dakar).toBe("2026-07-14");
    // ...but it is already 15 July in Dubai. An invoice due today must not silently
    // become overdue because a server ticked over first.
    const dubai = todayInTimezone("Asia/Dubai", new Date("2026-07-14T23:30:00Z"));
    expect(dubai).toBe("2026-07-15");
  });

  it("survives an invalid tenant timezone rather than crashing the queue", () => {
    expect(todayInTimezone("Not/AZone", new Date("2026-07-14T10:00:00Z"))).toBe("2026-07-14");
  });

  it("is deterministic", () => {
    expect(evaluateAging(aging({}))).toEqual(evaluateAging(aging({})));
  });
});

// ------------------------------------------------------------------- promises ----

const fu = (o: Partial<FollowUp>): FollowUp => ({
  id: "f1",
  channel: "PHONE",
  outcome: "PAYMENT_PROMISED",
  note: null,
  promisedPaymentDate: null,
  promisedAmount: null,
  nextFollowUpAt: null,
  performedBy: "u1",
  createdAt: "2026-07-01T10:00:00Z",
  ...o,
});

describe("promise to pay (Deliverable 4)", () => {
  it("is DERIVED from the append-only history — no promise entity", () => {
    expect(derivePromise([], 100, "2026-07-14").status).toBe("none");
  });

  it("is ACTIVE while the promised date is ahead", () => {
    const p = derivePromise([fu({ promisedPaymentDate: "2026-07-20" })], 100, "2026-07-14");
    expect(p.status).toBe("active");
  });

  it("is MISSED once the promised date has passed with a balance", () => {
    const p = derivePromise([fu({ promisedPaymentDate: "2026-07-01" })], 100, "2026-07-14");
    expect(p.status).toBe("missed");
  });

  it("is MET when the balance reaches zero", () => {
    const p = derivePromise([fu({ promisedPaymentDate: "2026-07-01" })], 0, "2026-07-14");
    expect(p.status).toBe("met");
  });

  it("SUPERSEDES an earlier promise without erasing it", () => {
    const p = derivePromise(
      [
        fu({ id: "f1", promisedPaymentDate: "2026-07-05", createdAt: "2026-07-01T10:00:00Z" }),
        fu({ id: "f2", promisedPaymentDate: "2026-07-25", createdAt: "2026-07-06T10:00:00Z" }),
      ],
      100,
      "2026-07-14",
    );
    expect(p.status).toBe("active");
    expect(p.promisedDate).toBe("2026-07-25");
    // The earlier promise is COUNTED, not deleted.
    expect(p.supersededCount).toBe(1);
  });

  it("a promise NEVER changes the invoice payment state", () => {
    expect(actions).not.toContain('.from("payment")');
    expect(actions).not.toContain('status: "PAID"');
    expect(actions).not.toContain('status: "PARTIALLY_PAID"');
  });
});

// -------------------------------------------------------------------- disputes ----

describe("disputes (Deliverable 5)", () => {
  it("declares the official categories", () => {
    expect(DISPUTE_CATEGORIES).toHaveLength(8);
    expect(DISPUTE_CATEGORIES).toContain("PAYMENT_ALREADY_MADE");
    expect(DISPUTE_CATEGORIES).toContain("DUPLICATE_INVOICE");
  });

  it("BLOCKS closure while open", () => {
    expect(disputeBlocksClosure({ open: true, category: "AMOUNT", reason: "r", openedAt: "t", resolvedAt: null, resolution: null })).toBe(true);
    expect(disputeBlocksClosure({ open: false, category: "AMOUNT", reason: "r", openedAt: "t", resolvedAt: "t2", resolution: "ok" })).toBe(false);
  });

  it("requires a category AND a reason to open", () => {
    expect(actions).toContain('if (!isDisputeCategory(category)) return fail("invalid_category")');
    expect(actions).toContain('if (!r) return fail("reason_required")');
  });

  it("never silently converts a disputed invoice to overdue", () => {
    const r = evaluateAging(aging({ disputed: true, dueDate: "2020-01-01" }));
    expect(r.overdue).toBe(false);
    expect(r.bucket).not.toBe("OVER_90_DAYS");
  });
});

// ------------------------------------------------------------------ follow-ups ----

describe("follow-ups (Deliverable 3)", () => {
  it("declares the official channels and outcomes", () => {
    expect(FOLLOW_UP_CHANNELS).toContain("WHATSAPP");
    expect(FOLLOW_UP_CHANNELS).toContain("IN_PERSON");
    for (const o of ["CLIENT_CONTACTED", "NO_RESPONSE", "PAYMENT_PROMISED", "PAYMENT_RECEIVED", "DISPUTED", "ESCALATED", "WRONG_CONTACT", "RESCHEDULED"]) {
      expect(FOLLOW_UP_OUTCOMES).toContain(o);
    }
    expect(isChannel("WHATSAPP")).toBe(true);
    expect(isOutcome("NOPE")).toBe(false);
  });

  it("widens the DB constraint while keeping the 5.0D-1 vocabulary valid", () => {
    expect(migrations).toContain("'WHATSAPP', 'IN_PERSON'");
    // Existing rows must stay valid — this is additive, not a breaking rewrite.
    expect(migrations).toContain("'REACHED', 'NO_ANSWER', 'PROMISE_TO_PAY', 'PARTIAL_PAYMENT_AGREED', 'OTHER'");
  });

  it("is APPEND-ONLY at the database — a follow-up can never be rewritten", () => {
    expect(migrations).toContain("trg_collection_followup_no_update");
  });

  it("bounds the note and never stores a transcript", () => {
    expect(sanitizeNote("  ")).toBeNull();
    expect(sanitizeNote("x".repeat(MAX_NOTE + 200))!.length).toBe(MAX_NOTE);
  });

  it("NEVER notifies the client from an internal follow-up", () => {
    expect(actions).toContain("This NEVER notifies the client");
    expect(actions).not.toContain("queueAndSend");
  });
});

// -------------------------------------------------------------------- priority ----

const signals = (o: Partial<CollectionsSignals> = {}): CollectionsSignals => ({
  aging: evaluateAging(aging({ dueDate: "2026-08-01" })), // NOT_DUE
  promise: { status: "none", promisedDate: null, promisedAmount: null, supersededCount: 0 },
  dispute: { open: false, category: null, reason: null, openedAt: null, resolvedAt: null, resolution: null },
  hoursSinceLastFollowUp: 1,
  paymentAwaitingVerification: false,
  escalated: false,
  processBlocked: false,
  ...o,
});

describe("collections priority (Deliverable 8)", () => {
  it("is deterministic and always explains itself", () => {
    const r = evaluateCollectionsPriority(
      signals({ aging: evaluateAging(aging({ dueDate: "2026-01-01" })) }),
    );
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.every((x) => x.labelFr.length > 0)).toBe(true);
    expect(evaluateCollectionsPriority(signals())).toEqual(evaluateCollectionsPriority(signals()));
  });

  it("ranks a missed promise highly", () => {
    const missed = evaluateCollectionsPriority(
      signals({ promise: { status: "missed", promisedDate: "2026-07-01", promisedAmount: null, supersededCount: 0 } }),
    );
    expect(missed.reasons.some((r) => r.code === "promise_missed")).toBe(true);
  });

  it("DE-prioritizes a live promise — chasing a client who committed is counterproductive", () => {
    const active = evaluateCollectionsPriority(
      signals({ promise: { status: "active", promisedDate: "2026-07-25", promisedAmount: null, supersededCount: 0 } }),
    );
    expect(active.reasons.find((r) => r.code === "promise_active")!.weight).toBeLessThan(0);
  });

  it("chases FINANCE (not the client) when a payment awaits verification", () => {
    const r = evaluateCollectionsPriority(signals({ paymentAwaitingVerification: true }));
    const reason = r.reasons.find((x) => x.code === "payment_awaiting_verification");
    expect(reason).toBeDefined();
    expect(reason!.labelFr).toContain("Finance");
  });

  it("labels the follow-up interval as INTERNAL, never a contractual SLA", () => {
    const r = evaluateCollectionsPriority(
      signals({
        hoursSinceLastFollowUp: null,
        aging: evaluateAging(aging({ dueDate: "2026-07-01" })),
      }),
    );
    const reason = r.reasons.find((x) => x.code === "no_recent_follow_up");
    expect(reason).toBeDefined();
    expect(reason!.labelFr).toContain("non contractuel");
  });
});

// ----------------------------------------------------- NO SECOND LEDGER ----

describe("collections is NOT payment processing (principles 1, 7, 8)", () => {
  it("never inserts, verifies or reverses a payment", () => {
    expect(actions).not.toContain('.from("payment").insert');
    expect(actions).not.toContain("verifyPayment");
    expect(actions).not.toContain("recordPayment");
  });

  it("reuses the EXACT balance derivation finance uses — no second ledger", () => {
    expect(service).toContain("invoiceTotals");
    expect(service).toContain("paidAmount");
    expect(service).toContain("balanceDue");
    // NOT a verified-only sum: that would disagree with invoice.status.
    expect(service).toContain("THE SAME sum that drives invoice.status");
  });

  it("surfaces unverified payments as a SIGNAL rather than changing the number", () => {
    expect(service).toContain("paymentAwaitingVerification");
    expect(service).toContain("chase Finance, don't silently change the number");
  });
});

// --------------------------------------------------------- CLOSURE (the point) ----

const closure = (o: Partial<ClosureInput> = {}): ClosureInput => ({
  evaluatedAt: "2026-07-14T12:00:00Z",
  access: { finance: true, documents: true, transport: true },
  transportDelivered: true,
  podApproved: true,
  podDocumentId: "doc-pod",
  coordinatorCompletenessDone: true,
  amCompletenessDone: true,
  invoiceId: "inv-1",
  invoiceValidated: true,
  invoiceEmailed: true,
  depositRequired: true,
  depositProofAccepted: true,
  depositProofDocumentId: "doc-proof",
  handedToCollections: true,
  outstandingBalance: 0,
  disputeOpen: false,
  collectionsCompleted: true,
  stepStates: [{ stepKey: "collections", state: "COMPLETED" }],
  unresolvedCorrections: 0,
  ...o,
});

describe("explicit closure (Deliverables 12-13) — the six principles", () => {
  it("closes when EVERY requirement is satisfied", () => {
    const e = evaluateClosure(closure());
    expect(e.ready).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it("FULL PAYMENT ALONE does not close — money cannot bypass the workflow", () => {
    const e = evaluateClosure(
      closure({
        outstandingBalance: 0,
        transportDelivered: false,
        podApproved: false,
        coordinatorCompletenessDone: false,
        amCompletenessDone: false,
        invoiceValidated: false,
        invoiceEmailed: false,
        depositProofAccepted: false,
        handedToCollections: false,
        collectionsCompleted: false,
      }),
    );
    expect(e.ready).toBe(false);
    expect(e.satisfied).toContain("balance_zero"); // paid...
    expect(e.blockers.length).toBeGreaterThan(5); // ...and still very much not closable
  });

  it("DELIVERY alone does not close", () => {
    const e = evaluateClosure(closure({ transportDelivered: true, outstandingBalance: 500, collectionsCompleted: false }));
    expect(e.ready).toBe(false);
    expect(e.blockers).toContain("balance_zero");
  });

  it("a POD alone does not close", () => {
    const e = evaluateClosure(closure({ outstandingBalance: 500 }));
    expect(e.ready).toBe(false);
  });

  it("an emailed invoice alone does not close", () => {
    const e = evaluateClosure(closure({ invoiceEmailed: true, outstandingBalance: 500 }));
    expect(e.ready).toBe(false);
  });

  it("an accepted deposit proof alone does not close", () => {
    const e = evaluateClosure(closure({ depositProofAccepted: true, outstandingBalance: 500 }));
    expect(e.ready).toBe(false);
  });

  it("an OPEN DISPUTE blocks closure", () => {
    const e = evaluateClosure(closure({ disputeOpen: true }));
    expect(e.ready).toBe(false);
    expect(e.blockers).toEqual(["no_open_dispute"]);
  });

  it("an unresolved correction blocks closure", () => {
    const e = evaluateClosure(closure({ unresolvedCorrections: 1 }));
    expect(e.ready).toBe(false);
    expect(e.blockers).toEqual(["no_unresolved_corrections"]);
  });

  it("an UNVERIFIED_HISTORICAL step never counts as done", () => {
    const e = evaluateClosure(
      closure({ stepStates: [{ stepKey: "collections", state: "UNVERIFIED_HISTORICAL" }] }),
    );
    expect(e.ready).toBe(false);
    expect(e.requirements.find((r) => r.key === "process_complete")!.detail).toBe(
      "unverified_historical_steps",
    );
  });

  it("reports EVERY requirement independently, with the complete blocker list", () => {
    const e = evaluateClosure(closure({ outstandingBalance: 500, disputeOpen: true }));
    expect(e.blockers).toEqual(["balance_zero", "no_open_dispute"]);
    expect(e.satisfied.length).toBeGreaterThan(5);
    expect(e.requirements.every((r) => !!r.key && !!r.labelFr)).toBe(true);
  });

  it("skips the deposit ONLY through explicit configuration, never implicitly", () => {
    const e = evaluateClosure(closure({ depositRequired: false, depositProofAccepted: false, handedToCollections: false }));
    expect(e.ready).toBe(true);
    expect(e.notApplicable).toContain("deposit_proof_accepted");
    // NOT reported as satisfied — reported as not applicable.
    expect(e.satisfied).not.toContain("deposit_proof_accepted");
  });

  it("an UNAUTHORIZED requirement is never a pass", () => {
    // A caller who cannot see finance cannot close on the strength of what they
    // cannot check.
    const e = evaluateClosure(closure({ access: { finance: false, documents: true, transport: true } }));
    expect(e.ready).toBe(false);
    expect(e.unauthorized).toContain("balance_zero");
  });

  it("carries an evaluation timestamp and evidence references, not document bodies", () => {
    const e = evaluateClosure(closure());
    expect(e.evaluatedAt).toBe("2026-07-14T12:00:00Z");
    expect(e.requirements.find((r) => r.key === "pod_received")!.evidence).toBe("doc-pod");
  });
});

describe("closure authorization + mechanics (Deliverables 13-14)", () => {
  it("requires the tenant permission process:close", () => {
    expect(actions).toContain('await assertPermission("process:close")');
    expect(migrations).toContain("'process:close'");
  });

  it("grants closure to SUPERVISORS only — never to a collector, courier or biller", () => {
    for (const role of ["SYSTEM_ADMIN", "OPS_SUPERVISOR"]) {
      expect(getTenantRoleTemplate(role)!.permissions, role).toContain("process:close");
    }
    for (const role of ["COLLECTIONS_OFFICER", "BILLING_OFFICER", "COURIER", "DRIVER", "FINANCE_OFFICER", "CLIENT_USER"]) {
      expect(getTenantRoleTemplate(role)!.permissions, role).not.toContain("process:close");
    }
  });

  it("keeps it TENANT-scoped — there is no platform closure permission", () => {
    for (const role of ["SYSTEM_ADMIN", "OPS_SUPERVISOR"]) {
      expect(getTenantRoleTemplate(role)!.permissions.some((p) => p.startsWith("platform:"))).toBe(false);
    }
  });

  it("keeps step 26 (recovery complete) DISTINCT from dossier closure", () => {
    // completeCollections advances step 26 and explicitly does NOT close.
    expect(actions).toContain("dossier_closed: false");
    expect(actions).toContain("This is deliberately NOT closure");
  });

  it("refuses with the COMPLETE blocker list, never an opaque 'not ready'", () => {
    expect(actions).toContain('return fail("closure_blocked", [...evaluation.blockers, ...evaluation.unauthorized])');
  });

  it("is idempotent on a duplicate close", () => {
    expect(actions).toContain('if (instance.status === "CLOSED") return { ok: true, id: fileId };');
    expect(actions).toContain('.neq("status", "CLOSED")');
  });

  it("moves the dossier through the EXISTING lifecycle seam — never a direct status write", () => {
    expect(actions).toContain('await transitionFile(fileId, "CLOSED")');
    expect(actions).not.toMatch(/\.from\("operational_file"\)\s*\.update/);
  });

  it("deletes nothing and hides nothing", () => {
    expect(actions).not.toContain(".delete()");
    expect(actions).not.toContain("anonymize");
  });
});

// --------------------------------------------------------------- flags + audit ----

describe("rollout and audit safety", () => {
  it("is dark by default and inert without the engine flag", () => {
    expect(resolveProcessFlags({}).collections).toBe(false);
    expect(resolveProcessFlags({ EFFITRANS_COLLECTIONS_ENABLED: "true" }).collections).toBe(false);
    expect(
      resolveProcessFlags({
        EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
        EFFITRANS_COLLECTIONS_ENABLED: "true",
      }).collections,
    ).toBe(true);
  });

  it("never audits a follow-up note's content or a conversation transcript", () => {
    const payloads = [...actions.matchAll(/after:\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(payloads.length).toBeGreaterThan(4);
    for (const p of payloads) {
      // `has_note` (a boolean presence flag) is fine; the note's CONTENT is not.
      expect(p).not.toMatch(/(?<!has_)note:\s*(input\.note|sanitizeNote|r\.note)/);
      expect(p).not.toContain("transcript");
    }
    // The note is audited as a boolean presence flag only.
    expect(actions).toContain("has_note: !!sanitizeNote(input.note)");
  });

  it("never logs bank or provider credentials", () => {
    for (const f of ["api_key", "iban", "swift", "provider_key", "password"]) {
      expect(actions, f).not.toContain(f);
    }
  });
});
