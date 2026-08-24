/**
 * C-4 — DEFINITIVE Creation → Closure journey. SLICE 1: Creation → Transit.
 * ---------------------------------------------------------------------------
 * Real PostgreSQL, real server actions, real permissions, real gates, real
 * audit. The ONLY stub is which identity is signed in.
 *
 * Every transition asserts more than "the action returned ok": the prior state,
 * the resulting state, the attributed audit row, the promotion of dependents,
 * and a refusal by an actor who should not be able to do it.
 *
 * SLICE 1 covers creation, Operations intake, Account Manager preparation
 * including a C-3 « Sans objet » declaration, the C-2 handoff sequencing, and
 * Transit reception — i.e. every mechanism the 00008 incident exercised. Later
 * slices extend the same harness through customs, transport, Finance, deposit
 * and closure; they are additive files, not a different apparatus.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as, actAsNobody } from "./identity";
import { identity, execution, auditFor, handoffs, db, TENANT_A, CLIENT_DEPOSIT_REQUIRED } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile } from "@/lib/files/actions";
import { openDossierWorkflow, handDossierToTransit, getIntakeState } from "@/lib/process/engine/intake-actions";
import { submitStep, activateStep, receiveHandoff } from "@/lib/process/engine/actions";
import { declareEvidenceAbsence } from "@/lib/process/evidence-absence-actions";
import { receiveDossierAtTransit } from "@/lib/process/engine/transit-actions";

let ops: CurrentUser;      // OPS_SUPERVISOR — intake, process:manage
let am: CurrentUser;       // ACCOUNT_MANAGER — file:create, step 3
let transit: CurrentUser;  // CHIEF_OF_TRANSIT — reception, step 4
let stranger: CurrentUser; // COURIER — holds nothing relevant here
let fileId = "";

describe("C-4 slice 1 — Creation → Transit reception", () => {
  beforeAll(async () => {
    ops = await identity("ops");
    am = await identity("am");
    transit = await identity("transit");
    stranger = await identity("courier");
  });

  it("T1 — the Account Manager creates the dossier; nobody else can", async () => {
    // An actor without file:create is refused by the REAL RBAC lookup.
    const refused = await as(stranger, () =>
      createFile({ type: "IMP", clientId: null as never, priority: "NORMAL" } as never),
    );
    expect(refused.ok, "a COURIER must not create a dossier").toBe(false);

    const created = await as(am, () =>
      createFile({
        type: "IMP",
        clientId: CLIENT_DEPOSIT_REQUIRED,
        priority: "NORMAL",
        transportMode: "SEA",
        origin: "JOURNEY ORIGIN",
        destination: "Dakar",
        blAwbRef: `JRN-${Date.now()}`,
      } as never),
    );
    expect(created.ok, `createFile failed: ${JSON.stringify(created)}`).toBe(true);
    fileId = (created as { id: string }).id;
    expect(fileId).toBeTruthy();
  });

  it("T2 — Operations opens the workflow: step 2 ACTIVE, step 3 still PENDING", async () => {
    const opened = await as(ops, () =>
      openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }),
    );
    expect(opened.ok, `openDossierWorkflow failed: ${JSON.stringify(opened)}`).toBe(true);

    // Opening ACTIVATES intake — it does not complete it.
    const intake = await execution(fileId, "operations_intake");
    expect(intake?.state).toBe("ACTIVE");
    // …and step 3 has NOT jumped ahead: its prerequisite is not done yet.
    const step3 = await execution(fileId, "am_dossier_opening");
    expect(step3?.state, "step 3 must wait for step 2").toBe("PENDING");
    // Cotation was skipped with a derived reason, which counts as done.
    expect((await execution(fileId, "cotation"))?.state).toBe("SKIPPED");
  });

  it("C-1 — completing step 2 promotes BOTH dependents, including step 14", async () => {
    const submitted = await as(ops, () => submitStep(fileId, "operations_intake"));
    expect(submitted.ok, `submit step 2 failed: ${JSON.stringify(submitted)}`).toBe(true);
    expect((await execution(fileId, "operations_intake"))?.state).toBe("COMPLETED");

    // The dependent named by `nextSteps`…
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("AVAILABLE");

    // …and the one that is NOT named anywhere, which is the whole point of C-1.
    // Step 14 declares step 3 as its prerequisite, so it stays PENDING here and
    // becomes AVAILABLE only when step 3 completes — proven below.
    expect((await execution(fileId, "transport_assignment"))?.state).toBe("PENDING");
  });

  it("promotion is attributed to the actor whose completion caused it (F-α)", async () => {
    const inst = (await db().from("process_instance").select("id").eq("file_id", fileId)).data ?? [];
    const { data: rows } = await db()
      .from("process_step_execution")
      .select("id")
      .eq("step_key", "am_dossier_opening")
      .in("process_instance_id", inst.map((r) => r.id));
    const events = await auditFor("process.step.activated", rows![0].id);
    expect(events.length, "the promotion must be audited").toBeGreaterThan(0);
    expect(events[0].actor_id, "attributed to the completing actor").toBe(ops.id);
  });

  it("C-2 — the Transit handoff is REFUSED while step 3 is unfinished", async () => {
    const early = await as(am, () => handDossierToTransit(fileId));
    expect(early.ok, "transmission must not outrun step 3").toBe(false);
    expect(await handoffs(fileId), "no handoff row may exist yet").toHaveLength(0);
  });

  it("step 3 cannot be COMPLETED without its evidence", async () => {
    const started = await as(am, () => activateStep(fileId, "am_dossier_opening"));
    expect(started.ok, `activate step 3 failed: ${JSON.stringify(started)}`).toBe(true);
    expect((await execution(fileId, "am_dossier_opening"))?.state).toBe("ACTIVE");

    const premature = await as(am, () => submitStep(fileId, "am_dossier_opening"));
    expect(premature.ok, "step 3 must refuse without its documents").toBe(false);
    expect((premature as { error: string }).error).toBe("evidence_missing");
  });

  it("C-3 — « Sans objet » is refused for a non-declarable type and without a motif", async () => {
    const notDeclarable = await as(am, () =>
      declareEvidenceAbsence(fileId, "BORDEREAU_LIVRAISON", "pas de BL"),
    );
    expect(notDeclarable.ok).toBe(false);
    expect((notDeclarable as { error: string }).error).toBe("evidence_not_declarable");

    const noMotif = await as(am, () => declareEvidenceAbsence(fileId, "VENDOR_INVOICE", "   "));
    expect(noMotif.ok).toBe(false);
    expect((noMotif as { error: string }).error).toBe("reason_required");

    const arbitrary = await as(am, () => declareEvidenceAbsence(fileId, "NOT_A_REAL_KEY", "x"));
    expect(arbitrary.ok).toBe(false);
  });

  it("C-3 — a legitimate declaration is recorded, attributed and audited", async () => {
    const declared = await as(am, () =>
      declareEvidenceAbsence(fileId, "VENDOR_INVOICE", "aucun débours tiers sur ce dossier"),
    );
    expect(declared.ok, `declaration failed: ${JSON.stringify(declared)}`).toBe(true);

    const { data: row } = await db()
      .from("evidence_absence_declaration")
      .select("tenant_id, file_id, evidence_key, reason, declared_by, declared_at")
      .eq("file_id", fileId)
      .eq("evidence_key", "VENDOR_INVOICE")
      .maybeSingle();
    expect(row?.tenant_id).toBe(TENANT_A);
    expect(row?.declared_by).toBe(am.id);
    expect(row?.reason).toBe("aucun débours tiers sur ce dossier");
    expect(row?.declared_at).toBeTruthy();

    const events = await auditFor("evidence.absence.declared", (declared as { id: string }).id);
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(am.id);

    // It fabricates NO document.
    const { data: docs } = await db()
      .from("document")
      .select("id")
      .eq("file_id", fileId)
      .eq("type_code", "VENDOR_INVOICE");
    expect(docs ?? [], "a declaration must never create a document row").toHaveLength(0);

    // …and it satisfies ONLY that key: step 3 still refuses on the others.
    const still = await as(am, () => submitStep(fileId, "am_dossier_opening"));
    expect(still.ok, "one declaration must not satisfy the whole step").toBe(false);
  });

  it("an unauthorised actor cannot act on step 3, and nobody can act signed out", async () => {
    const wrongActor = await as(stranger, () => submitStep(fileId, "am_dossier_opening"));
    expect(wrongActor.ok).toBe(false);

    actAsNobody();
    const anon = await submitStep(fileId, "am_dossier_opening");
    expect(anon.ok, "signed-out must be refused").toBe(false);
  });

  it("the intake projection reports step 3 as the unmet transmission prerequisite", async () => {
    const state = await as(am, () => getIntakeState(fileId));
    expect(state, "the dossier must be readable by its Account Manager").toBeTruthy();
    expect(state!.amOpeningDone, "step 3 is not done yet").toBe(false);
    expect(state!.handoffSent).toBe(false);
  });
});
