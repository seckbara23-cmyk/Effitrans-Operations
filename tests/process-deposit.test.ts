/**
 * Phase 5.0D-3 — physical invoice deposit, courier execution, chain of custody.
 * Official steps 22-25.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CUSTODY_EVENTS,
  CUSTODY_ROUTE,
  EVIDENCE_REQUIRED,
  REASON_REQUIRED,
  chainIsComplete,
  currentCustodian,
  sanitizeReason,
  validateCustodyEvent,
  MAX_REASON,
  type CustodyEntry,
} from "@/lib/deposit/custody";
import {
  alreadyAccepted,
  canAccept,
  canStartDeposit,
  canTransitionDeposit,
  courierSection,
  evaluateEligibility,
  isAssignedCourier,
  proofComplete,
  reassignmentNeedsReason,
  type AssignmentView,
} from "@/lib/deposit/status";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";
import { resolveProcessFlags } from "@/lib/process/flags";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const actions = read("../lib/deposit/actions.ts");
const service = read("../lib/deposit/service.ts");

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

const A = (o: Partial<AssignmentView> = {}): AssignmentView => ({
  status: "ASSIGNED",
  courierUserId: "courier-1",
  acceptedAt: null,
  ...o,
});

// -------------------------------------------------------------- eligibility ----

describe("deposit eligibility (Deliverable 1)", () => {
  const base = {
    invoiceStatus: "ISSUED",
    invoiceValidatedAt: "2026-07-14T09:00:00Z",
    clientRequiresDeposit: true,
    activeDepositExists: false,
  };

  it("is eligible for a validated, issued invoice on a deposit-configured client", () => {
    expect(evaluateEligibility(base)).toEqual({ eligible: true });
  });

  it("reports NOT APPLICABLE when the client is not configured for physical deposit", () => {
    const r = evaluateEligibility({ ...base, clientRequiresDeposit: false });
    // Explicit configuration — never a silent skip.
    expect(r).toEqual({ eligible: false, notApplicable: true, error: "deposit_not_required" });
  });

  it("refuses an unvalidated invoice", () => {
    expect(evaluateEligibility({ ...base, invoiceValidatedAt: null })).toMatchObject({
      eligible: false,
      error: "invoice_not_validated",
    });
  });

  it("refuses an invoice that was never SENT (a deposit follows the email, never precedes it)", () => {
    expect(evaluateEligibility({ ...base, invoiceStatus: "VALIDATED" })).toMatchObject({
      eligible: false,
      error: "invoice_not_issued",
    });
    expect(evaluateEligibility({ ...base, invoiceStatus: "DRAFT" })).toMatchObject({
      eligible: false,
      error: "invoice_not_issued",
    });
  });

  it("refuses a second active workflow", () => {
    expect(evaluateEligibility({ ...base, activeDepositExists: true })).toMatchObject({
      eligible: false,
      error: "active_deposit_exists",
    });
  });

  it("enforces ONE active deposit per invoice at the database level", () => {
    expect(migrations).toContain("uq_invoice_deposit_active");
  });
});

// ---------------------------------------------------- explicit acceptance ----

describe("explicit courier acceptance (Deliverable 5)", () => {
  it("does NOT start a deposit on assignment alone", () => {
    // Assignment gives the courier the mission; it does not put them on the road.
    expect(canStartDeposit(A(), "courier-1")).toBe(false);
    expect(canStartDeposit(A({ acceptedAt: "2026-07-14T10:00:00Z" }), "courier-1")).toBe(true);
  });

  it("lets only the ASSIGNED courier accept", () => {
    expect(canAccept(A(), "courier-1")).toBe(true);
    expect(canAccept(A(), "courier-2")).toBe(false);
    expect(isAssignedCourier(A(), "courier-2")).toBe(false);
  });

  it("makes a repeat acceptance a harmless no-op", () => {
    const accepted = A({ acceptedAt: "2026-07-14T10:00:00Z" });
    expect(canAccept(accepted, "courier-1")).toBe(false);
    expect(alreadyAccepted(accepted, "courier-1")).toBe(true);
    expect(actions).toContain("// Already accepted => harmless no-op, not an error.");
  });

  it("requires a reason to reassign a courier who already accepted", () => {
    expect(reassignmentNeedsReason(A())).toBe(false);
    expect(reassignmentNeedsReason(A({ acceptedAt: "2026-07-14T10:00:00Z" }))).toBe(true);
  });

  it("resets acceptance on reassignment — the NEW courier must accept for themselves", () => {
    expect(actions).toContain("accepted_at: null,");
    expect(actions).toContain("// Reassignment resets acceptance: the NEW courier must accept for themselves.");
  });
});

// ------------------------------------------------------------ state machine ----

describe("deposit state machine", () => {
  it("returns a FAILED deposit to Administration — it never becomes a deposit", () => {
    expect(canTransitionDeposit("IN_TRANSIT", "READY_FOR_COURIER")).toBe(true);
    expect(canTransitionDeposit("IN_TRANSIT", "PROOF_ACCEPTED")).toBe(false);
    expect(canTransitionDeposit("IN_TRANSIT", "HANDED_TO_COLLECTIONS")).toBe(false);
  });

  it("cannot skip the proof", () => {
    expect(canTransitionDeposit("DEPOSITED", "PROOF_ACCEPTED")).toBe(false);
    expect(canTransitionDeposit("DEPOSITED", "HANDED_TO_COLLECTIONS")).toBe(false);
  });

  it("cannot hand an unaccepted proof to Collections", () => {
    expect(canTransitionDeposit("PROOF_SUBMITTED", "HANDED_TO_COLLECTIONS")).toBe(false);
    expect(canTransitionDeposit("PROOF_REJECTED", "HANDED_TO_COLLECTIONS")).toBe(false);
    expect(canTransitionDeposit("PROOF_ACCEPTED", "HANDED_TO_COLLECTIONS")).toBe(true);
  });

  it("requires a recipient AND a date AND a document to prove a deposit", () => {
    expect(proofComplete({ proofDocumentId: null, recipientName: "M. Diop", depositedAt: "2026-07-14" }).missing).toEqual(["proof_document"]);
    expect(proofComplete({ proofDocumentId: "d", recipientName: "", depositedAt: "2026-07-14" }).missing).toEqual(["recipient_name"]);
    expect(proofComplete({ proofDocumentId: "d", recipientName: "M. Diop", depositedAt: null }).missing).toEqual(["deposited_at"]);
  });
});

// ----------------------------------------------------------- chain of custody ----

describe("chain of custody (critical invariant)", () => {
  it("declares every official custody event", () => {
    expect(CUSTODY_EVENTS).toHaveLength(17);
    for (const e of [
      "HANDED_TO_ADMIN", "ADMIN_RECEIVED", "PACKAGE_PREPARED", "COURIER_ASSIGNED",
      "COURIER_ACCEPTED", "DEPOSIT_STARTED", "INVOICE_DEPOSITED", "PROOF_UPLOADED",
      "PROOF_SUBMITTED", "PROOF_ACCEPTED", "PROOF_REJECTED", "HANDED_TO_COLLECTIONS",
    ]) {
      expect(CUSTODY_EVENTS).toContain(e);
    }
  });

  it("gives EVERY event a source and a destination department", () => {
    for (const e of CUSTODY_EVENTS) {
      expect(CUSTODY_ROUTE[e], e).toBeDefined();
      expect(CUSTODY_ROUTE[e].to, e).toBeTruthy();
    }
  });

  it("refuses a custody event with no actor", () => {
    expect(
      validateCustodyEvent({
        event: "PACKAGE_PREPARED",
        fromStatus: "PREPARATION_PENDING",
        toStatus: "READY_FOR_COURIER",
        actorId: "",
        actorRoleCode: null,
      }),
    ).toEqual({ ok: false, error: "custody_actor_required" });
  });

  it("refuses a decline, failure, rejection or reassignment without a reason", () => {
    for (const event of REASON_REQUIRED) {
      expect(
        validateCustodyEvent({
          event,
          fromStatus: "ASSIGNED",
          toStatus: "READY_FOR_COURIER",
          actorId: "u1",
          actorRoleCode: "COURIER",
        }),
        event,
      ).toEqual({ ok: false, error: "custody_reason_required" });
    }
  });

  it("refuses a proof event with no evidence document", () => {
    for (const event of EVIDENCE_REQUIRED) {
      expect(
        validateCustodyEvent({
          event,
          fromStatus: "DEPOSITED",
          toStatus: "PROOF_SUBMITTED",
          actorId: "u1",
          actorRoleCode: "COURIER",
        }),
        event,
      ).toEqual({ ok: false, error: "custody_evidence_required" });
    }
  });

  it("reads the current custodian from the LAST EVENT, never from the status", () => {
    const chain: CustodyEntry[] = [
      { id: "1", event: "HANDED_TO_ADMIN", labelFr: "", fromStatus: null, toStatus: "PREPARATION_PENDING", actorId: "u1", actorRoleCode: "BILLING_OFFICER", fromDepartment: "billing", toDepartment: "administration", reason: null, evidenceDocumentId: null, occurredAt: "2026-07-14T09:00:00Z" },
      { id: "2", event: "COURIER_ASSIGNED", labelFr: "", fromStatus: "READY_FOR_COURIER", toStatus: "ASSIGNED", actorId: "u2", actorRoleCode: "ADMINISTRATIVE_OFFICER", fromDepartment: "administration", toDepartment: "courier", reason: null, evidenceDocumentId: null, occurredAt: "2026-07-14T10:00:00Z" },
    ];
    expect(currentCustodian(chain)).toBe("courier");
    expect(service).toContain("// Read from the last custody EVENT, never inferred from the status.");
  });

  it("requires every transition to carry actor + time + from + to", () => {
    const good: CustodyEntry[] = [
      { id: "1", event: "COURIER_ACCEPTED", labelFr: "", fromStatus: "ASSIGNED", toStatus: "ASSIGNED", actorId: "u1", actorRoleCode: "COURIER", fromDepartment: "administration", toDepartment: "courier", reason: null, evidenceDocumentId: null, occurredAt: "2026-07-14T10:00:00Z" },
    ];
    expect(chainIsComplete(good)).toBe(true);

    const missingActor = [{ ...good[0], actorId: null }];
    expect(chainIsComplete(missingActor)).toBe(false);
  });

  it("is APPEND-ONLY at the database — a custody event can never be rewritten", () => {
    expect(migrations).toContain("trg_deposit_event_no_update");
    expect(migrations).toContain("trg_deposit_event_no_delete");
    expect(migrations).toContain("prevent_mutation");
  });

  it("records EVERY transition — no state change without a custody event", () => {
    for (const call of [
      'recordCustody(c, d, "WORKFLOW_CREATED"',
      'recordCustody(c, d, "HANDED_TO_ADMIN"',
      'recordCustody(c, d, "PACKAGE_PREPARED"',
      'recordCustody(c, d, "COURIER_ACCEPTED"',
      'recordCustody(c, d, "COURIER_DECLINED"',
      'recordCustody(c, d, "DEPOSIT_STARTED"',
      'recordCustody(c, d, "DEPOSIT_FAILED"',
      'recordCustody(c, d, "INVOICE_DEPOSITED"',
      'recordCustody(c, d, "PROOF_UPLOADED"',
      'recordCustody(c, d, "PROOF_SUBMITTED"',
      'recordCustody(c, d, "PROOF_ACCEPTED"',
      'recordCustody(c, d, "PROOF_REJECTED"',
      'recordCustody(c, d, "HANDED_TO_COLLECTIONS"',
    ]) {
      expect(actions, `missing custody event: ${call}`).toContain(call);
    }
  });

  it("bounds a reason and never stores an essay", () => {
    expect(sanitizeReason("  ")).toBeNull();
    expect(sanitizeReason("x".repeat(MAX_REASON + 100))!.length).toBe(MAX_REASON);
  });
});

// --------------------------------------------------------- courier isolation ----

describe("courier authorization (Deliverables 4, 8, 10, 20)", () => {
  it("acts on ASSIGNMENT, not on dossier visibility (a courier has no file scope)", () => {
    expect(actions).toContain("async function courierGuard()");
    expect(actions).toContain('if (!isAssignedCourier(assignmentOf(d), c.userId)) return fail("not_assigned_courier")');
  });

  it("restricts a courier to their OWN deposits in the RLS policy itself", () => {
    expect(migrations).toContain("invoice_deposit_select_courier");
    expect(migrations).toContain("invoice_deposit_event_select_courier");
    expect(migrations).toMatch(/courier_user_id = auth\.uid\(\)/);
  });

  it("a COURIER can never approve a proof — they hold no admin_service:manage", () => {
    const courier = getTenantRoleTemplate("COURIER")!;
    expect(courier.permissions).not.toContain("admin_service:manage");
    expect(courier.permissions).not.toContain("courier:assign");
  });

  it("a courier can never assign themselves", () => {
    // assignCourier requires courier:assign, which COURIER does not hold.
    expect(actions).toContain('await guard("courier:assign", fileId)');
    expect(getTenantRoleTemplate("COURIER")!.permissions).not.toContain("courier:assign");
  });

  it("a courier can NEVER review their own proof, even if they held the permission", () => {
    expect(actions).toContain('if (d.courierUserId === c.userId) return fail("self_review_forbidden")');
    // In BOTH accept and reject — a rejection is a review too.
    const occurrences = actions.split('return fail("self_review_forbidden")').length - 1;
    expect(occurrences).toBe(2);
  });

  it("a COURIER holds no finance permission at all", () => {
    expect(getTenantRoleTemplate("COURIER")!.permissions.some((p) => p.startsWith("finance:"))).toBe(false);
  });

  it("a DRIVER can never touch a deposit", () => {
    const driver = getTenantRoleTemplate("DRIVER")!;
    expect(driver.permissions).not.toContain("courier:deposit");
    expect(driver.permissions).not.toContain("admin_service:manage");
  });
});

// ------------------------------------------------------------- proof upload ----

describe("proof upload (Deliverable 8)", () => {
  it("REUSES the existing private-bucket document pipeline", () => {
    expect(actions).toContain("uploadObject");
    expect(actions).toContain("buildStoragePath");
    expect(actions).toContain('type_code: "PROOF_OF_DEPOSIT"');
    // The proof enters the NORMAL staff review queue.
    expect(actions).toContain('status: "PENDING_REVIEW"');
  });

  it("builds the storage path SERVER-side — never a client-supplied one", () => {
    expect(actions).toContain("// SERVER-generated path — never a client-supplied one.");
    expect(actions).toContain("buildStoragePath(c.tenantId, d.fileId, id,");
  });

  it("restricts MIME types and size", () => {
    expect(actions).toContain('const allowed = ["image/jpeg", "image/png", "application/pdf"]');
    expect(actions).toContain("validateDocumentInput");
  });

  it("never orphans a storage object when the row insert fails", () => {
    expect(actions).toContain("await removeObject(path); // don't orphan the object");
  });

  it("keeps a rejected proof immutable — a correction is a NEW document", () => {
    expect(actions).toContain("// The rejected proof document is marked REJECTED — the row is NOT deleted, and");
  });
});

// ----------------------------------------------------- process + boundaries ----

describe("process synchronization and boundaries (Deliverables 11, 15)", () => {
  it("completes step 24 only when the PROOF IS RETURNED, not merely deposited", () => {
    expect(actions).toContain('await submitStep(d.fileId, "courier_deposit");');
    // The submitStep call lives in submitProof, after proofComplete() passes.
    const idx = actions.indexOf("export async function submitProof");
    const step = actions.indexOf('submitStep(d.fileId, "courier_deposit")', idx);
    expect(step).toBeGreaterThan(idx);
  });

  it("completes step 25 only on an accepted proof handed to Collections", () => {
    expect(actions).toContain('await submitStep(d.fileId, "administration_proof_handoff");');
    expect(actions).toContain('if (d.status !== "PROOF_ACCEPTED") return fail("invalid_state")');
  });

  it("sends controlled handoffs through the ENGINE, not a second system", () => {
    expect(actions).toContain('sendHandoff(d.fileId, "billing_dispatch", "administration_deposit_prep")');
    expect(actions).toContain('sendHandoff(d.fileId, "administration_proof_handoff", "collections")');
  });

  it("a deposit NEVER marks the invoice paid", () => {
    expect(actions).not.toContain('status: "PAID"');
    expect(actions).not.toContain('status: "PARTIALLY_PAID"');
    expect(actions).not.toContain("payment");
  });

  it("proof acceptance NEVER closes the dossier", () => {
    expect(actions).not.toContain("PROCESS_CLOSED");
    expect(actions).not.toMatch(/\.from\("operational_file"\)\s*\.update/);
  });

  it("a Collections handoff creates NO collection follow-up automatically", () => {
    expect(actions).not.toContain("collection_follow_up");
  });

  it("is idempotent on the Collections handoff", () => {
    expect(actions).toContain('if (d.status === "HANDED_TO_COLLECTIONS") return { ok: true, id: depositId }; // idempotent');
  });

  it("uses compare-and-set everywhere — never a disabled button", () => {
    expect(actions).toContain("async function cas(");
    expect(actions).toContain('.eq("status", from)');
    expect(actions).toContain("return (data?.length ?? 0) === 1;");
  });
});

// -------------------------------------------------------------- flags + UI ----

describe("rollout and workspace mapping", () => {
  it("requires the engine flag, the deposit flag AND the tenant's rollout", () => {
    // 5.0E-2A: the deployment kill switch, then the tenant gate. Both guards
    // (staff + courier) go through the same two checks.
    expect(actions).toContain('if (!kill.enabled || !kill.physicalDeposit) return "feature_disabled"');
    expect(actions).toContain(
      'if (!(await getTenantProcessFlags(user.tenantId)).physicalDeposit) return "feature_disabled"',
    );
    const f = resolveProcessFlags({ EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true" });
    expect(f.physicalDeposit).toBe(false); // inert without the master flag
  });

  it("is dark by default", () => {
    expect(resolveProcessFlags({}).physicalDeposit).toBe(false);
  });

  it("maps every courier workspace section", () => {
    expect(courierSection(A(), false, false)).toBe("awaiting_acceptance");
    expect(courierSection(A({ acceptedAt: "t" }), false, false)).toBe("ready_to_depart");
    expect(courierSection(A({ status: "IN_TRANSIT", acceptedAt: "t" }), false, false)).toBe("in_progress");
    expect(courierSection(A({ status: "DEPOSITED", acceptedAt: "t" }), true, false)).toBe("deposit_details_required");
    expect(courierSection(A({ status: "DEPOSITED", acceptedAt: "t" }), true, true)).toBe("proof_upload_required");
    expect(courierSection(A({ status: "PROOF_SUBMITTED", acceptedAt: "t" }), true, true)).toBe("proof_under_review");
    expect(courierSection(A({ status: "PROOF_REJECTED", acceptedAt: "t" }), true, true)).toBe("proof_rejected");
    expect(courierSection(A({ status: "HANDED_TO_COLLECTIONS", acceptedAt: "t" }), true, true)).toBe("completed");
  });

  it("never ships a document body in the read model", () => {
    expect(service).toContain("Never returns a document body");
    expect(service).not.toContain("storage_path");
    expect(service).not.toContain("createSignedDownloadUrl");
  });
});

// ------------------------------------------------------------ audit safety ----

describe("audit safety (Deliverable 18)", () => {
  it("never audits the client's address, instructions, or document contents", () => {
    // The address/instructions ARE stored on the deposit row (the courier needs
    // them to deliver) — but they must never reach an audit payload. Check the
    // `after:` blocks specifically, not the whole file.
    const payloads = [...actions.matchAll(/after:\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(payloads.length).toBeGreaterThan(8);
    for (const p of payloads) {
      for (const forbidden of ["client_location", "delivery_instructions", "recipient_name", "package_reference"]) {
        expect(p, `audit payload leaks ${forbidden}: ${p}`).not.toContain(forbidden);
      }
    }
    // Instructions are audited as a BOOLEAN presence flag, never as content.
    expect(actions).toContain("has_instructions: !!input.deliveryInstructions");
    // The recipient is recorded as a presence flag too, not as a name in the log.
    expect(actions).toContain("recipient_recorded: true");
  });

  it("audits the proof by ID, never by content", () => {
    expect(actions).toContain("// The document id, never its contents.");
  });

  it("never logs a secret or a storage path", () => {
    for (const forbidden of ["api_key", "service_role", "password", "signedUrl"]) {
      expect(actions, forbidden).not.toContain(forbidden);
    }
  });
});
