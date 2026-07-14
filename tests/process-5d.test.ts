/**
 * Phase 5.0D — post-delivery chain: documents, deposit, collections, aging,
 * closure. These carry the rules 5.0D may not be declared complete without.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AGING_BUCKETS,
  compareAging,
  evaluateAging,
  type AgingInput,
} from "@/lib/collections/aging";
import {
  DEPOSIT_STATUSES,
  canTransitionDeposit,
  courierActionable,
  depositComplete,
  proofComplete,
} from "@/lib/deposit/status";
import { DOCUMENT_MAPPINGS, MISSING_DOCUMENT_TYPES, mapDocument } from "@/lib/process/documents";
import { evaluateClosureGate, type ClosureContext } from "@/lib/process/engine/gates";
import { ALL_NODE_KEYS } from "@/lib/process/engine/state";
import type { EvidenceSnapshot } from "@/lib/process/engine/evidence";
import type { StepState } from "@/lib/process/engine/types";
import { AuditActions } from "@/lib/audit/events";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const allMigrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

// ------------------------------------------------------------------ documents ----

describe("official document catalog is now complete (Deliverable 1)", () => {
  it("has NO remaining missing document types", () => {
    expect(MISSING_DOCUMENT_TYPES).toEqual([]);
  });

  it("backs every official artefact with a real type or a structured record", () => {
    for (const d of DOCUMENT_MAPPINGS) {
      expect(["mapped", "structured"], `${d.key} is still ${d.status}`).toContain(d.status);
    }
  });

  it("SPLITS the delivery slip from the signed POD", () => {
    // The conflation made the pickup gate unsatisfiable: the only type that could
    // satisfy "Bordereau de Livraison" was a POD that cannot exist before delivery.
    const slip = mapDocument("BORDEREAU_LIVRAISON");
    const pod = mapDocument("SIGNED_DELIVERY_NOTE");
    expect(slip.typeCode).toBe("BORDEREAU_LIVRAISON");
    expect(pod.typeCode).toBe("DELIVERY_NOTE");
    expect(slip.typeCode).not.toBe(pod.typeCode);
  });

  it("PRESERVES the driver POD flow: DELIVERY_NOTE still means the signed POD", () => {
    // The driver's `pod` evidence kind and canReceivePod() both point at
    // DELIVERY_NOTE. The split must not have moved that.
    expect(mapDocument("SIGNED_DELIVERY_NOTE").typeCode).toBe("DELIVERY_NOTE");
  });

  it("never duplicates an existing catalog code", () => {
    const codes = [...allMigrations.matchAll(/\(\s*'([A-Z_]+)',\s*'[^']*',\s*'[^']*',\s*'(?:transport|commercial|compliance|customs|operational|financial)'/g)]
      .map((m) => m[1]);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const c of codes) {
      if (seen.has(c)) dupes.push(c);
      seen.add(c);
    }
    expect(dupes, `duplicate document_type codes: ${dupes.join(", ")}`).toEqual([]);
  });

  it("reuses PAYMENT_RECEIPT for receipts and payment proofs — no second type", () => {
    expect(mapDocument("RECEIPT").typeCode).toBe("PAYMENT_RECEIPT");
    expect(mapDocument("PAYMENT_PROOF").typeCode).toBe("PAYMENT_RECEIPT");
  });
});

// -------------------------------------------------------------------- deposit ----

describe("physical deposit workflow (Deliverables 6-9)", () => {
  it("declares the ten official statuses", () => {
    expect(DEPOSIT_STATUSES).toHaveLength(10);
  });

  it("walks the happy path to Collections", () => {
    expect(canTransitionDeposit("PREPARATION_PENDING", "READY_FOR_COURIER")).toBe(true);
    expect(canTransitionDeposit("READY_FOR_COURIER", "ASSIGNED")).toBe(true);
    expect(canTransitionDeposit("ASSIGNED", "IN_TRANSIT")).toBe(true);
    expect(canTransitionDeposit("IN_TRANSIT", "DEPOSITED")).toBe(true);
    expect(canTransitionDeposit("DEPOSITED", "PROOF_SUBMITTED")).toBe(true);
    expect(canTransitionDeposit("PROOF_SUBMITTED", "PROOF_ACCEPTED")).toBe(true);
    expect(canTransitionDeposit("PROOF_ACCEPTED", "HANDED_TO_COLLECTIONS")).toBe(true);
    expect(depositComplete("HANDED_TO_COLLECTIONS")).toBe(true);
  });

  it("returns a REJECTED proof to the courier — a correction loop, not a dead end", () => {
    expect(canTransitionDeposit("PROOF_SUBMITTED", "PROOF_REJECTED")).toBe(true);
    expect(canTransitionDeposit("PROOF_REJECTED", "DEPOSITED")).toBe(true);
    expect(courierActionable("PROOF_REJECTED")).toBe(true);
  });

  it("cannot skip the proof: DEPOSITED never jumps straight to accepted", () => {
    expect(canTransitionDeposit("DEPOSITED", "PROOF_ACCEPTED")).toBe(false);
    expect(canTransitionDeposit("DEPOSITED", "HANDED_TO_COLLECTIONS")).toBe(false);
  });

  it("cannot hand an unaccepted proof to Collections", () => {
    expect(canTransitionDeposit("PROOF_SUBMITTED", "HANDED_TO_COLLECTIONS")).toBe(false);
    expect(canTransitionDeposit("PROOF_REJECTED", "HANDED_TO_COLLECTIONS")).toBe(false);
  });

  it("requires a document, a recipient AND a date — no generic 'done' checkbox", () => {
    expect(proofComplete({ proofDocumentId: null, recipientName: null, depositedAt: null })).toEqual({
      ok: false,
      missing: ["proof_document", "recipient_name", "deposited_at"],
    });
    expect(
      proofComplete({ proofDocumentId: "d1", recipientName: "  ", depositedAt: "2026-07-14" }).missing,
    ).toEqual(["recipient_name"]);
    expect(
      proofComplete({ proofDocumentId: "d1", recipientName: "M. Diop", depositedAt: "2026-07-14" }),
    ).toEqual({ ok: true, missing: [] });
  });

  it("limits courier action to their assigned, actionable states", () => {
    expect(courierActionable("ASSIGNED")).toBe(true);
    expect(courierActionable("IN_TRANSIT")).toBe(true);
    // A courier never validates a proof and never touches a handed-over deposit.
    expect(courierActionable("PROOF_SUBMITTED")).toBe(false);
    expect(courierActionable("PROOF_ACCEPTED")).toBe(false);
    expect(courierActionable("HANDED_TO_COLLECTIONS")).toBe(false);
  });

  it("enforces ONE active deposit workflow per invoice at the database level", () => {
    expect(allMigrations).toContain("uq_invoice_deposit_active");
    expect(allMigrations).toMatch(/on public\.invoice_deposit \(invoice_id\) where status <> 'CANCELLED'/);
  });

  it("never represents a deposit through invoice payment status", () => {
    // The two machines stay strictly separate: an invoice can be emailed, in a
    // courier's bag, deposited — and still entirely unpaid. Conflating them would
    // corrupt the payment model, so no deposit state may appear in the INVOICE
    // status constraint.
    const invoiceStatuses = allMigrations.match(
      /add constraint invoice_status_check\s*check \(status in \(([^)]*)\)\)/,
    )?.[1];
    expect(invoiceStatuses).toBeTruthy();
    for (const depositState of ["DEPOSITED", "PROOF_ACCEPTED", "ASSIGNED", "IN_TRANSIT"]) {
      expect(invoiceStatuses, `invoice status must not carry ${depositState}`).not.toContain(depositState);
    }
    // And the invoice keeps exactly its own six states.
    expect(invoiceStatuses).toContain("VALIDATED");
    expect(invoiceStatuses).toContain("PAID");
  });
});

// --------------------------------------------------------------------- aging ----

const aging = (o: Partial<AgingInput>): AgingInput => ({
  status: "ISSUED",
  dueDate: "2026-06-01",
  total: 100,
  paid: 0,
  disputed: false,
  today: "2026-07-14",
  ...o,
});

describe("aging model (Deliverable 11) — deterministic, no AI", () => {
  it("declares the official buckets", () => {
    expect(AGING_BUCKETS).toContain("NOT_DUE");
    expect(AGING_BUCKETS).toContain("OVER_90_DAYS");
    expect(AGING_BUCKETS).toContain("PAID");
    expect(AGING_BUCKETS).toContain("DISPUTED");
  });

  it("NEVER calls an invoice overdue without a due date", () => {
    const r = evaluateAging(aging({ dueDate: null }));
    expect(r.bucket).toBe("NO_DUE_DATE");
    expect(r.labelFr).toBe("Échéance non définie");
    expect(r.overdue).toBe(false);
    expect(r.daysOutstanding).toBeNull();
  });

  it("buckets by days past due", () => {
    expect(evaluateAging(aging({ dueDate: "2026-08-01" })).bucket).toBe("NOT_DUE");
    expect(evaluateAging(aging({ dueDate: "2026-07-01" })).bucket).toBe("1_TO_30_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-06-01" })).bucket).toBe("31_TO_60_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-05-01" })).bucket).toBe("61_TO_90_DAYS");
    expect(evaluateAging(aging({ dueDate: "2026-01-01" })).bucket).toBe("OVER_90_DAYS");
  });

  it("computes the outstanding balance and supports partial payment", () => {
    const partial = evaluateAging(aging({ total: 100, paid: 40 }));
    expect(partial.outstanding).toBe(60);
    expect(partial.partiallyPaid).toBe(true);
    expect(partial.fullyPaid).toBe(false);
    expect(partial.overdue).toBe(true);
  });

  it("marks a fully paid invoice PAID and never overdue", () => {
    const r = evaluateAging(aging({ total: 100, paid: 100, dueDate: "2020-01-01" }));
    expect(r.bucket).toBe("PAID");
    expect(r.overdue).toBe(false);
    expect(r.outstanding).toBe(0);
  });

  it("freezes aging on a dispute rather than chasing it as 90-days overdue", () => {
    const r = evaluateAging(aging({ disputed: true, dueDate: "2020-01-01" }));
    expect(r.bucket).toBe("DISPUTED");
    expect(r.overdue).toBe(false);
  });

  it("is deterministic — same inputs, same result", () => {
    expect(evaluateAging(aging({}))).toEqual(evaluateAging(aging({})));
  });

  it("sorts oldest debt first, disputes and paid last", () => {
    const mk = (o: Partial<AgingInput>) => evaluateAging(aging(o));
    const rows = [
      mk({ dueDate: "2026-07-01" }), // 1-30
      mk({ dueDate: "2026-01-01" }), // >90
      mk({ disputed: true }),
      mk({ total: 100, paid: 100 }), // paid
    ];
    expect([...rows].sort(compareAging).map((r) => r.bucket)).toEqual([
      "OVER_90_DAYS",
      "1_TO_30_DAYS",
      "DISPUTED",
      "PAID",
    ]);
  });
});

// -------------------------------------------------------------------- closure ----

const snap = (o: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [{ typeCode: "DELIVERY_NOTE", status: "APPROVED" }],
  customs: null,
  transport: null,
  invoices: [{ status: "PAID", balance: 0 }],
  ...o,
});

const allDone = () =>
  ALL_NODE_KEYS.map((stepKey) => ({ stepKey, state: "COMPLETED" as StepState }));

const fullCtx: ClosureContext = {
  invoiceValidated: true,
  invoiceEmailed: true,
  depositRequired: true,
  depositProofAccepted: true,
  handedToCollections: true,
  unresolvedCorrections: 0,
};

describe("final closure gate (Deliverable 12)", () => {
  it("closes when EVERY condition is met", () => {
    const g = evaluateClosureGate(allDone(), snap(), fullCtx);
    expect(g.ready).toBe(true);
    expect(g.missing).toEqual([]);
  });

  it("FULL PAYMENT ALONE does not close — money cannot bypass the workflow", () => {
    // Paid in full, but the operational chain never ran. A payment webhook must
    // never be able to close a dossier as a side effect.
    const g = evaluateClosureGate(
      ALL_NODE_KEYS.map((stepKey) => ({ stepKey, state: "PENDING" as StepState })),
      snap(),
      { ...fullCtx, invoiceValidated: false, invoiceEmailed: false, depositProofAccepted: false, handedToCollections: false },
    );
    expect(g.ready).toBe(false);
    expect(g.missing).toContain("process_complete");
    expect(g.missing).toContain("invoice_validated");
  });

  it("DELIVERY alone does not close", () => {
    const g = evaluateClosureGate(
      ALL_NODE_KEYS.map((stepKey) => ({
        stepKey,
        state: stepKey === "am_delivery_followup" ? ("COMPLETED" as StepState) : ("PENDING" as StepState),
      })),
      snap({ invoices: [] }),
      fullCtx,
    );
    expect(g.ready).toBe(false);
  });

  it("a POD alone does not close", () => {
    const g = evaluateClosureGate(allDone(), snap({ invoices: [{ status: "ISSUED", balance: 500 }] }), fullCtx);
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["fully_paid"]);
  });

  it("an emailed invoice alone does not close", () => {
    const g = evaluateClosureGate(allDone(), snap(), {
      ...fullCtx,
      invoiceValidated: true,
      invoiceEmailed: true,
      depositProofAccepted: false,
      handedToCollections: false,
    });
    expect(g.ready).toBe(false);
    expect(g.missing).toContain("deposit_proof_accepted");
  });

  it("refuses to close while a correction is unresolved", () => {
    const g = evaluateClosureGate(allDone(), snap(), { ...fullCtx, unresolvedCorrections: 1 });
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["no_unresolved_corrections"]);
  });

  it("stays CLOSED when the post-delivery chain cannot be evaluated", () => {
    // No context => the billing/deposit/collections chain is UNPROVEN, not assumed.
    const g = evaluateClosureGate(allDone(), snap());
    expect(g.ready).toBe(false);
    expect(g.missing).toContain("post_delivery_chain");
  });

  it("skips the deposit ONLY through explicit configuration, never implicitly", () => {
    const g = evaluateClosureGate(allDone(), snap(), {
      ...fullCtx,
      depositRequired: false,
      depositProofAccepted: false,
      handedToCollections: false,
    });
    expect(g.ready).toBe(true);
    const dep = g.requirements.find((r) => r.key === "deposit_proof_accepted")!;
    // Reported as NOT APPLICABLE — never silently "satisfied".
    expect(dep.notApplicable).toBe(true);
    expect(dep.satisfied).toBe(false);
  });

  it("never closes on the strength of UNVERIFIED_HISTORICAL steps", () => {
    const execs = allDone();
    execs[3] = { ...execs[3], state: "UNVERIFIED_HISTORICAL" };
    const g = evaluateClosureGate(execs, snap(), fullCtx);
    expect(g.ready).toBe(false);
    expect(g.requirements.find((r) => r.key === "process_complete")!.detail).toBe(
      "unverified_historical_steps",
    );
  });
});

// ---------------------------------------------------------------------- audit ----

describe("audit safety (Deliverable 20)", () => {
  it("declares every post-delivery audit action", () => {
    for (const a of [
      AuditActions.INVOICE_DRAFT_SUBMITTED,
      AuditActions.INVOICE_VALIDATED,
      AuditActions.INVOICE_VALIDATION_REJECTED,
      AuditActions.INVOICE_EMAILED,
      AuditActions.DEPOSIT_PREPARED,
      AuditActions.DEPOSIT_COURIER_ASSIGNED,
      AuditActions.DEPOSIT_PROOF_SUBMITTED,
      AuditActions.DEPOSIT_PROOF_ACCEPTED,
      AuditActions.DEPOSIT_PROOF_REJECTED,
      AuditActions.DEPOSIT_HANDED_TO_COLLECTIONS,
      AuditActions.COLLECTION_FOLLOW_UP,
      AuditActions.COLLECTION_PROMISE_RECORDED,
      AuditActions.CLOSURE_READINESS_EVALUATED,
    ]) {
      expect(typeof a).toBe("string");
    }
  });

  it("keeps collection notes operational — never a conversation transcript", () => {
    // The migration comment is the contract; the column is a single note, not a log.
    expect(allMigrations).toContain("Never a transcript of the conversation");
    expect(allMigrations).not.toContain("conversation_log");
    expect(allMigrations).not.toContain("email_body");
  });
});

// ------------------------------------------------------------------------ RLS ----

describe("RLS + tenant integrity for the new tables (Deliverable 19)", () => {
  it("enables RLS on both new tables", () => {
    expect(allMigrations).toContain("alter table public.invoice_deposit     enable row level security");
    expect(allMigrations).toContain("alter table public.collection_follow_up enable row level security");
  });

  it("restricts a courier to their OWN assignments, in the policy itself", () => {
    expect(allMigrations).toContain("invoice_deposit_select_courier");
    expect(allMigrations).toMatch(/courier_user_id = auth\.uid\(\)/);
  });

  it("gives a courier NO access to collection records at all", () => {
    // The only collection policy requires collections:manage, which COURIER lacks.
    const policy = allMigrations.match(/create policy collection_follow_up_select[\s\S]*?\);/)?.[0] ?? "";
    expect(policy).toContain("collections:manage");
    expect(policy).not.toContain("courier");
  });

  it("blocks a proof document borrowed from another dossier or tenant", () => {
    expect(allMigrations).toContain("proof document belongs to another tenant");
    expect(allMigrations).toContain("proof document belongs to another dossier");
  });

  it("blocks a courier or validator from another tenant", () => {
    expect(allMigrations).toContain("courier belongs to another tenant");
    expect(allMigrations).toContain("deposit validator belongs to another tenant");
  });

  it("blocks an invoice maker/checker from another tenant", () => {
    expect(allMigrations).toContain("invoice submitted_by belongs to another tenant");
    expect(allMigrations).toContain("invoice validated_by belongs to another tenant");
  });

  it("makes collection follow-ups append-only", () => {
    expect(allMigrations).toContain("trg_collection_followup_no_update");
    expect(allMigrations).toContain("prevent_mutation");
  });
});
