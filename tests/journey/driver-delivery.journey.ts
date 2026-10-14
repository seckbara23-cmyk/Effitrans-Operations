/**
 * EFF-LOCAL-UAT-02 — the driver's delivery, against a REAL database.
 * ---------------------------------------------------------------------------
 * On 2026-10-10 a driver drove dossier EFT-IMP-2026-00014, confirmed the pickup
 * she had made, tapped « Démarrer le retour », and from that second the
 * platform refused everything she tried. UAT-TRANSPORT-POD-FIX-01 corrected it
 * — and proved the correction by reading its own source: pure predicates and
 * structural assertions, not one row written to Postgres.
 *
 * That is the gap this file closes. Every claim below is made by CAUSING the
 * thing: real server actions, real RBAC resolved from the database for whichever
 * identity is acting, real audit rows, real documents in real storage. The only
 * stub is which identity is signed in.
 *
 * WHY THE SETUP LOOKS NOTHING LIKE THE DOSSIER THAT BROKE. The incident's
 * mission sat behind the whole customs chain, and reproducing that here would
 * make these tests depend on thirteen steps that have nothing to do with the
 * defect. `canPickup` is gated on a customs record EXISTING and being required;
 * a dossier with no customs leg opened is never customs-gated, which is the
 * platform's own rule (`lib/transport/gates.ts`), not a bypass. So the fixtures
 * reach `PICKED_UP` through the ordinary transport actions, performed by people
 * who really hold the permissions, and the driver path is then exercised in the
 * exact session states that broke.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. The position ingest
 * (`POST /api/driver/positions`) is an HTTP route, not a server action; proving
 * its 409-on-PAUSED / 200-on-RETURNING behaviour needs the handler invoked with
 * a crafted Request, which is a different apparatus. It remains structural, and
 * is reported as an open gap rather than quietly implied by this file.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { as } from "./identity";
import { identity, db, auditFor, fileRow, transportFor, TENANT_A, CLIENT_DEPOSIT_REQUIRED } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { createFile, assignCommercialOwner } from "@/lib/files/actions";
import { openDossierWorkflow } from "@/lib/process/engine/intake-actions";
import { resolveDocumentGovernance } from "@/lib/documents/governance";
import { isVerified } from "@/lib/documents/doctrine";
import { createTransport, changeTransportStatus } from "@/lib/transport/actions";
import { assignDriverUser } from "@/lib/transport/driver-actions";
import { startMission, pauseTracking, resumeTracking, startReturnLeg, stopMission } from "@/lib/driver/actions";
import { confirmDelivery } from "@/lib/driver/delivery";
import { uploadDriverEvidence } from "@/lib/driver/upload";
import { recordDriverEvent } from "@/lib/driver/ops";
import { verifyDocument } from "@/lib/documents/actions";

let ops: CurrentUser; // OPS_SUPERVISOR — file:read:all + every transport permission + document:approve
let am: CurrentUser; // ACCOUNT_MANAGER — the only journey identity holding file:create
let driver: CurrentUser; // DRIVER — the assignee
let driver2: CurrentUser; // DRIVER — a second one, so « somebody else's mission » is a real person
let courier: CurrentUser; // COURIER — holds no driver identity at all
/**
 * The staff identities a bound verifier seat might name. The journey reads the
 * policy and picks from these rather than hardcoding one, so a change to the
 * seat binding retargets the test instead of breaking it.
 */
let candidates: CurrentUser[];

/** One mission, built through the ordinary actions by people who may perform them. */
type Mission = { fileId: string; transportId: string };

async function mission(options: {
  pickedUp: boolean;
  assignTo?: CurrentUser;
  /**
   * Open the governed workflow. Needed wherever a DOCUMENT is verified:
   * document governance resolves the verifier seat from the dossier's process
   * instance and its current step (lib/documents/governance.ts), and an unbound
   * seat is EMPTY rather than permissive — so with no workflow nobody may
   * verify anything, which is the platform behaving correctly.
   */
  openWorkflow?: boolean;
}): Promise<Mission> {
  const created = await as(am, () =>
    createFile({
      type: "IMP",
      clientId: CLIENT_DEPOSIT_REQUIRED,
      priority: "normal",
      shipment: {
        transportMode: "SEA",
        origin: "JOURNEY ORIGIN",
        destination: "Dakar",
        blAwbRef: `DRV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      },
    }),
  );
  expect(created.ok, `createFile failed: ${JSON.stringify(created)}`).toBe(true);
  const fileId = (created as { id: string }).id;

  if (options.openWorkflow) {
    // The ratified sequence (OPS-OWNERSHIP-01 K3, as lifecycle.journey.ts does
    // it): the Responsable client is designated BEFORE the opening act, which
    // is what completes step 2. No SQL, no step forced.
    const owned = await as(ops, () =>
      assignCommercialOwner({ fileId, userId: am.id, reasonCode: "INITIAL" }),
    );
    expect(owned.ok, `assignCommercialOwner failed: ${JSON.stringify(owned)}`).toBe(true);
    const opened = await as(ops, () =>
      openDossierWorkflow(fileId, { ownerUserId: ops.id, skipCotation: true }),
    );
    expect(opened.ok, `openDossierWorkflow failed: ${JSON.stringify(opened)}`).toBe(true);
  }

  const made = await as(ops, () => createTransport(fileId));
  expect(made.ok, `createTransport failed: ${JSON.stringify(made)}`).toBe(true);
  const { id: transportId } = await transportFor(fileId);

  for (const to of ["PLANNED", "DRIVER_ASSIGNED"]) {
    const moved = await as(ops, () => changeTransportStatus(transportId, to));
    expect(moved.ok, `-> ${to} failed: ${JSON.stringify(moved)}`).toBe(true);
  }

  const bound = await as(ops, () => assignDriverUser(transportId, (options.assignTo ?? driver).id));
  expect(bound.ok, `assignDriverUser failed: ${JSON.stringify(bound)}`).toBe(true);

  if (options.pickedUp) {
    const up = await as(ops, () => changeTransportStatus(transportId, "PICKED_UP"));
    expect(up.ok, `-> PICKED_UP failed: ${JSON.stringify(up)}`).toBe(true);
  }
  return { fileId, transportId };
}

/** Every tracking session on a transport, newest first. ASSERTION ONLY. */
async function sessions(transportId: string) {
  const { data } = await db()
    .from("tracking_session")
    .select("id, tenant_id, status, source, driver_id, started_at, ended_at, return_started_at")
    .eq("transport_id", transportId)
    .order("started_at", { ascending: false });
  return data ?? [];
}

/** Tracking events on a transport, oldest first. ASSERTION ONLY. */
async function events(transportId: string) {
  const { data } = await db()
    .from("tracking_event")
    .select("type, source, customer_visible, customer_message, detail, dedup_key, created_by, tenant_id, occurred_at")
    .eq("transport_id", transportId)
    .order("occurred_at", { ascending: true });
  return data ?? [];
}

async function transportRow(transportId: string) {
  const { data } = await db()
    .from("transport_record")
    .select("status, delivery_actual, pickup_actual, pod_document_id, driver_user_id, tenant_id")
    .eq("id", transportId)
    .maybeSingle();
  return data;
}

async function driverDocuments(fileId: string) {
  const { data } = await db()
    .from("document")
    .select("id, type_code, status, uploaded_by, tenant_id, file_id, deleted_at")
    .eq("file_id", fileId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

let A: Mission; // PICKED_UP, assigned to `driver` — the narrative mission
let B: Mission; // DRIVER_ASSIGNED, assigned to `driver` — the incident's shape
let C: Mission; // PICKED_UP — used for the completed-session refusals
let D: Mission; // PICKED_UP + workflow — repeated delivery callbacks
let E: Mission; // PICKED_UP + workflow — delivery BEFORE the note is verified
let sessionA = "";

/**
 * WHO may verify a DELIVERY_NOTE on this dossier, asked of the policy rather
 * than guessed. Same reasoning as M3.2: hardcoding a seat tests the guess.
 */
async function policyVerifier(fileId: string): Promise<CurrentUser> {
  const gov = await resolveDocumentGovernance({ tenantId: TENANT_A, fileId, typeCode: "DELIVERY_NOTE" });
  expect(gov.resolved, "the workflow must resolve a policy for this dossier").toBe(true);
  const v = candidates.find((u) => u.roles.some((r) => gov.verifierRoles.includes(r)));
  expect(v, `no seeded identity holds any of [${gov.verifierRoles.join(", ")}]`).toBeTruthy();
  return v!;
}

/** The dossier's own status history, oldest first. ASSERTION ONLY. */
async function fileTransitions(fileId: string) {
  const { data } = await db()
    .from("file_state_transition")
    .select("from_status, to_status, actor_id, tenant_id")
    .eq("file_id", fileId)
    .order("occurred_at", { ascending: true });
  return data ?? [];
}

beforeAll(async () => {
  // The driver lane is DARK BY DEFAULT and reads its flags at call time
  // (lib/tracking/config.ts), so the harness turns tracking on the way an
  // environment does. Without this every action answers `tracking_disabled`
  // and the suite would "pass" by never reaching the code under test.
  process.env.TRACKING_ENABLED = "true";
  process.env.DRIVER_MOBILE_TRACKING_ENABLED = "true";

  ops = await identity("ops");
  am = await identity("am");
  driver = await identity("driver");
  driver2 = await identity("driver2");
  courier = await identity("courier");
  candidates = [
    ops,
    am,
    await identity("transit"),
    await identity("coordinator"),
    await identity("documentation"),
    await identity("declarantchief"),
  ];

  // A carries the document assertions, so A gets the governed workflow. B and C
  // never verify anything, and are left deliberately lighter.
  A = await mission({ pickedUp: true, openWorkflow: true });
  B = await mission({ pickedUp: false });
  C = await mission({ pickedUp: true });
  // M8 — the convergence orderings. Both need the governed workflow: a dossier
  // left in DRAFT is deliberately NOT advanced by a transport row, and only an
  // open workflow can resolve a verifier seat for the delivery note.
  D = await mission({ pickedUp: true, openWorkflow: true });
  E = await mission({ pickedUp: true, openWorkflow: true });
});

// ═══════════ M4 — one mission, one live session ════════════════════════════

describe("M4 — restarting a mission cannot fork its session", () => {
  it("M4.1 — the driver starts her mission: one ACTIVE session, audited, tenant-scoped", async () => {
    const started = await as(driver, () => startMission(A.transportId));
    expect(started.ok, `startMission failed: ${JSON.stringify(started)}`).toBe(true);
    sessionA = (started as { sessionId: string }).sessionId;
    expect(sessionA).toBeTruthy();
    expect((started as { status?: string }).status).toBe("ACTIVE");

    const rows = await sessions(A.transportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sessionA);
    expect(rows[0].status).toBe("ACTIVE");
    expect(rows[0].source).toBe("driver_mobile");
    expect(rows[0].driver_id).toBe(driver.id);
    expect(rows[0].tenant_id).toBe(TENANT_A);

    const audit = await auditFor("tracking.session.started", sessionA);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(driver.id);
  });

  it("M4.2 — starting again while ACTIVE returns the SAME session, not a second one", async () => {
    const again = await as(driver, () => startMission(A.transportId));
    expect(again.ok).toBe(true);
    expect((again as { sessionId: string }).sessionId).toBe(sessionA);
    expect(await sessions(A.transportId)).toHaveLength(1);
  });

  it("M4.3 — starting while PAUSED reuses it AND reports PAUSED, so the screen cannot claim it is sharing", async () => {
    const paused = await as(driver, () => pauseTracking(sessionA));
    expect(paused.ok, JSON.stringify(paused)).toBe(true);

    const again = await as(driver, () => startMission(A.transportId));
    expect(again.ok).toBe(true);
    expect((again as { sessionId: string }).sessionId).toBe(sessionA);
    // The honesty half of the D5 fix: the caller is told the state it got back.
    expect((again as { status?: string }).status).toBe("PAUSED");

    const rows = await sessions(A.transportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PAUSED");
  });

  it("M4.4 — starting while RETURNING reuses it too; the return leg is recorded", async () => {
    const resumed = await as(driver, () => resumeTracking(sessionA));
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);
    const turned = await as(driver, () => startReturnLeg(sessionA));
    expect(turned.ok, `startReturnLeg failed: ${JSON.stringify(turned)}`).toBe(true);

    const rows = await sessions(A.transportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("RETURNING");
    expect(rows[0].return_started_at).not.toBeNull();

    const again = await as(driver, () => startMission(A.transportId));
    expect(again.ok).toBe(true);
    expect((again as { sessionId: string }).sessionId).toBe(sessionA);
    expect((again as { status?: string }).status).toBe("RETURNING");
    expect(await sessions(A.transportId)).toHaveLength(1);
  });

  it("M4.5 — the database refuses a second ACTIVE session for one transport", async () => {
    // On C the session is ACTIVE, so the partial unique index applies.
    const started = await as(driver, () => startMission(C.transportId));
    expect(started.ok).toBe(true);
    const { error } = await db()
      .from("tracking_session")
      .insert({
        tenant_id: TENANT_A,
        file_id: C.fileId,
        transport_id: C.transportId,
        driver_id: driver.id,
        source: "driver_mobile",
        status: "ACTIVE",
        created_by: driver.id,
      });
    expect(error, "a second ACTIVE session must be rejected by the database").not.toBeNull();
    expect(`${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase()).toMatch(/duplicate|unique|23505/);
    expect(await sessions(C.transportId)).toHaveLength(1);
  });

  it("M4.6 — the index covers ACTIVE ONLY, so M4.3/M4.4 are what protect the other states", () => {
    // Said plainly rather than implied: the partial predicate does NOT cover a
    // PAUSED or RETURNING session, so the database cannot be what prevents a
    // second live session in those states — the application guard is. Widening
    // the index needs a governed migration and is out of this slice's scope.
    const sql = readFileSync(
      new URL("../../supabase/migrations/20260711000001_driver_execution.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("create unique index if not exists uq_tracking_session_active_transport");
    expect(sql).toContain("where status = 'ACTIVE' and transport_id is not null");
  });
});

// ═══════════ M3 — evidence during the return leg ═══════════════════════════

describe("M3 — evidence captured on the return leg is recorded, and never self-approved", () => {
  let podId = "";

  it("M3.1 — the driver uploads the signed delivery note while RETURNING", async () => {
    expect((await sessions(A.transportId))[0].status, "precondition").toBe("RETURNING");

    const fd = new FormData();
    fd.set("kind", "pod");
    fd.set("file", new File(["%PDF-1.4 signed delivery note"], "pod.pdf", { type: "application/pdf" }));
    const up = await as(driver, () => uploadDriverEvidence(A.transportId, fd));
    expect(up.ok, `uploadDriverEvidence failed: ${JSON.stringify(up)}`).toBe(true);
    podId = (up as { id: string }).id;

    const docs = await driverDocuments(A.fileId);
    const pod = docs.find((d) => d.id === podId);
    expect(pod, "the document must exist").toBeTruthy();
    expect(pod!.type_code).toBe("DELIVERY_NOTE");
    // The whole point: a driver's POD enters the REVIEW QUEUE.
    expect(pod!.status).toBe("PENDING_REVIEW");
    expect(pod!.uploaded_by).toBe(driver.id);
    expect(pod!.tenant_id).toBe(TENANT_A);
    expect(pod!.file_id).toBe(A.fileId);
  });

  it("M3.2 — she cannot approve it herself; the person POLICY names can", async () => {
    // Two independent reasons refuse her, and the test does not need to tell
    // them apart: a DRIVER holds no `document:approve`, AND the maker ≠ checker
    // rule forbids the uploader from verifying their own upload (enforced in
    // verifyDocument and again by a trigger on document_review). The isolated
    // maker/checker proof lives in delivery-completeness.journey.ts, where the
    // maker does hold the permission.
    const self = await as(driver, () => verifyDocument(podId));
    expect(self.ok, "a driver must not approve her own POD").toBe(false);

    // WHO may verify is POLICY, bound per step, so the journey ASKS instead of
    // assuming. An earlier version hardcoded the Operations supervisor and was
    // refused `not_a_verifier` — which was the platform being right and the
    // test being wrong. Asserting a guess would only have tested the guess.
    const gov = await resolveDocumentGovernance({
      tenantId: TENANT_A,
      fileId: A.fileId,
      typeCode: "DELIVERY_NOTE",
    });
    expect(gov.resolved, "the workflow must resolve a policy for this dossier").toBe(true);
    expect(gov.processInstanceId, "…which requires the dossier's workflow to be open").not.toBeNull();
    expect(
      gov.verifierRoles.length,
      "policy must bind a verifier seat for this step, or nobody could ever approve a POD",
    ).toBeGreaterThan(0);

    const verifier = candidates.find((u) => u.roles.some((r) => gov.verifierRoles.includes(r)));
    expect(
      verifier,
      `no seeded identity holds any of the bound verifier roles [${gov.verifierRoles.join(", ")}]`,
    ).toBeTruthy();

    const byPolicy = await as(verifier!, () => verifyDocument(podId));
    expect(byPolicy.ok, `verifyDocument failed: ${JSON.stringify(byPolicy)}`).toBe(true);

    // Asserted through the platform's OWN predicate, not a spelling. The
    // verification landed the document on `CONSUMED_AS_EVIDENCE` — a canonical
    // verified status (VERIFIED_CANONICAL_STATUSES), because verifying evidence
    // that satisfies a step consumes that version. `isVerified` is the same
    // check `canReceivePod` and the POD gate apply, so this asserts the fact
    // that matters rather than one of the two words it can wear.
    const pod = (await driverDocuments(A.fileId)).find((d) => d.id === podId);
    expect(pod!.status, "the POD must no longer be awaiting review").not.toBe("PENDING_REVIEW");
    expect(isVerified(pod!.status), `status ${pod!.status} must count as verified`).toBe(true);
  });

  it("M3.3 — verified evidence does NOT advance a transport that has not been delivered", async () => {
    // recordPodReceiptFromVerifiedEvidence refuses `not_delivered`, so the
    // dossier keeps its verified POD on file and invents no delivery.
    const t = await transportRow(A.transportId);
    expect(t!.status).toBe("PICKED_UP");
    expect(t!.delivery_actual).toBeNull();
  });
});

// ═══════════ M7 — only the assignee delivers ═══════════════════════════════

describe("M7 — another driver cannot confirm this driver's delivery", () => {
  it("M7.1 — a DIFFERENT driver is refused, and nothing moves", async () => {
    const theft = await as(driver2, () =>
      confirmDelivery(A.transportId, { recipientName: "Not Her Recipient" }),
    );
    expect(theft.ok).toBe(false);
    expect((theft as { error: string }).error).toBe("forbidden");

    const t = await transportRow(A.transportId);
    expect(t!.status).toBe("PICKED_UP");
    expect((await events(A.transportId)).some((e) => e.type === "DELIVERED")).toBe(false);
  });

  it("M7.2 — and so is somebody who is not a driver at all", async () => {
    const outsider = await as(courier, () =>
      confirmDelivery(A.transportId, { recipientName: "Courier" }),
    );
    expect(outsider.ok).toBe(false);
    expect((outsider as { error: string }).error).toBe("forbidden");
  });
});

// ═══════════ M1 — the delivery the incident lost ═══════════════════════════

describe("M1 — the assigned driver confirms delivery DURING the return leg", () => {
  it("M1.1 — recipient name is required evidence", async () => {
    const empty = await as(driver, () => confirmDelivery(A.transportId, { recipientName: "   " }));
    expect(empty.ok).toBe(false);
    expect((empty as { error: string }).error).toBe("recipient_required");
  });

  it("M1.2 — it SUCCEEDS, which is the whole point of the fix", async () => {
    expect((await sessions(A.transportId))[0].status, "precondition").toBe("RETURNING");

    const done = await as(driver, () =>
      confirmDelivery(A.transportId, {
        recipientName: "Mme Fatou Ndiaye",
        customerMessage: "Livraison effectuée.",
      }),
    );
    expect(done.ok, `confirmDelivery failed: ${JSON.stringify(done)}`).toBe(true);
  });

  it("M1.3 — the delivery is recorded, stamped, and attributed to her", async () => {
    const t = await transportRow(A.transportId);
    // EFF-POD-FINANCE-CONVERGENCE-01. The row reads POD_RECEIVED rather than
    // DELIVERED because this dossier's delivery note was verified back in
    // M3.2, so recording the delivery supplied the one fact the receipt was
    // still missing and it fired at once — see M1.6. The DELIVERY itself is
    // what is asserted here, through its own stamp and its own audit row.
    expect(t!.status).toBe("POD_RECEIVED");
    expect(t!.delivery_actual).not.toBeNull();

    const audit = await auditFor("transport.delivered", A.transportId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(driver.id);
    expect((audit[0].before as { status?: string } | null)?.status).toBe("PICKED_UP");
  });

  it("M1.4 — the DELIVERED evidence event carries the recipient internally and a safe message outwardly", async () => {
    const all = await events(A.transportId);
    const delivered = all.filter((e) => e.type === "DELIVERED");
    expect(delivered).toHaveLength(1);
    expect(delivered[0].source).toBe("driver_mobile");
    expect(delivered[0].customer_visible).toBe(true);
    expect(delivered[0].customer_message).toBe("Livraison effectuée.");
    expect(delivered[0].dedup_key).toBeTruthy();
    expect(delivered[0].created_by).toBe(driver.id);
    expect(delivered[0].tenant_id).toBe(TENANT_A);
    expect((delivered[0].detail as { recipientName?: string } | null)?.recipientName).toBe("Mme Fatou Ndiaye");
  });

  it("M1.5 — the session is completed AFTER the transition, never before", async () => {
    // EFF-LOCAL-UAT-04 — this is the assertion that caught the defect: the
    // completion filter was ["ACTIVE", "PAUSED"] and the session was RETURNING,
    // so it stayed RETURNING while the audit row claimed otherwise.
    const rows = await sessions(A.transportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMPLETED");
    expect(rows[0].ended_at).not.toBeNull();
    expect((await events(A.transportId)).some((e) => e.type === "TRACKING_STOPPED")).toBe(true);

    // …and the trail agrees with the row, exactly once, attributed to her.
    const closed = await auditFor("tracking.session.completed", rows[0].id);
    expect(closed).toHaveLength(1);
    expect(closed[0].actor_id).toBe(driver.id);
    expect((closed[0].after as { reason?: string } | null)?.reason).toBe("delivered");
  });

  it("M1.5b — the vehicle is free again: no open session claims this mission", async () => {
    // The exact input lib/fleet/service.ts reads to decide availability — it
    // counts ACTIVE|PAUSED|RETURNING as « en mission ». While the session stayed
    // RETURNING after delivery, the vehicle was engaged by a mission that had
    // already finished, and nothing would ever have released it.
    const { data: open } = await db()
      .from("tracking_session")
      .select("transport_id")
      .eq("tenant_id", TENANT_A)
      .in("status", ["ACTIVE", "PAUSED", "RETURNING"])
      .not("transport_id", "is", null);
    const engaged = new Set((open ?? []).map((r) => r.transport_id));
    expect(engaged.has(A.transportId), "a delivered mission must not keep its vehicle").toBe(false);
  });

  it("M1.6 — ORDERING 1 (verified first): the receipt she earned is recorded, not lost", async () => {
    // A verified DELIVERY_NOTE has sat on this dossier since M3.2, where the
    // receipt refused `not_delivered` because nothing had been delivered yet
    // (M3.3). Her delivery supplies that missing fact, so the receipt fires on
    // the spot — the same retry the office branch has always performed.
    //
    // THIS ASSERTION WAS INVERTED, deliberately and on the record. It used to
    // pin « delivering produces no POD receipt », which is what the platform
    // did: the same verified evidence plus the same delivery reached Finance
    // when the office recorded it and never when the driver did. The brief
    // EFF-POD-FINANCE-CONVERGENCE-01 corrects that asymmetry. What did NOT
    // change is the gate: see M8.1, where a delivery with the note still in
    // PENDING_REVIEW reaches no receipt at all.
    const t = await transportRow(A.transportId);
    expect(t!.status).toBe("POD_RECEIVED");

    // ONE receipt, carrying honest provenance: a person verified the evidence
    // and the platform recorded the consequence. The actor is the driver
    // because her call supplied the second fact; the source says it was not a
    // click on a Transport screen.
    const receipt = await auditFor("transport.pod_received", A.transportId);
    expect(receipt).toHaveLength(1);
    expect((receipt[0].before as { status?: string } | null)?.status).toBe("DELIVERED");
    expect((receipt[0].after as { source?: string } | null)?.source).toBe("AUTOMATIC_ON_POD_VERIFICATION");
    expect(receipt[0].actor_id).toBe(driver.id);

    // `pod_document_id` stays null on BOTH paths — neither the manual receipt
    // nor the automatic one populates it. Asserted so this reads as a known
    // property of the column rather than a gap this change introduced.
    expect(t!.pod_document_id).toBeNull();

    // And the dossier followed the transport fact instead of being left behind
    // at IN_PROGRESS while the lifecycle already offered « Clôturer ».
    expect((await fileRow(A.fileId))!.status).toBe("DELIVERED");
    const hist = await fileTransitions(A.fileId);
    expect(hist.filter((r) => r.to_status === "DELIVERED")).toHaveLength(1);
    expect(hist.filter((r) => r.to_status === "DELIVERED")[0].actor_id).toBe(driver.id);
  });

  it("M1.7 — a second delivery is refused twice over: first by the ended session…", async () => {
    // Her own delivery completed the session, so the session guard answers
    // first. The ORDER of the guards is itself the claim here.
    const again = await as(driver, () => confirmDelivery(A.transportId, { recipientName: "Again" }));
    expect(again.ok).toBe(false);
    expect((again as { error: string }).error).toBe("session_completed");
  });

  it("M1.8 — …and the finished dossier cannot be reopened to try again", async () => {
    // Her delivery took this transport all the way to POD_RECEIVED (M1.6), and
    // tracking refuses to start on a POD_RECEIVED record — so she cannot even
    // get back to a live session. The state-machine refusal on a second
    // delivery is still proved, on a run that stopped at DELIVERED: M8.3.
    const restarted = await as(driver, () => startMission(A.transportId));
    expect(restarted.ok, JSON.stringify(restarted)).toBe(false);
    expect((restarted as { error: string }).error).toBe("invalid_state");

    // One delivery, one event, one audit row — whatever she tapped.
    expect((await events(A.transportId)).filter((e) => e.type === "DELIVERED")).toHaveLength(1);
    expect(await auditFor("transport.delivered", A.transportId)).toHaveLength(1);

    // And the refused attempts recorded NO completion: the session-completion
    // audit row and the TRACKING_STOPPED event are written only when a session
    // row actually moved, so a refusal cannot leave a false trail behind it.
    const firstSession = (await sessions(A.transportId)).find((s) => s.status === "COMPLETED");
    expect(firstSession, "the delivered session is still the completed one").toBeTruthy();
    expect(await auditFor("tracking.session.completed", firstSession!.id)).toHaveLength(1);
    expect((await events(A.transportId)).filter((e) => e.type === "TRACKING_STOPPED")).toHaveLength(1);
  });
});

// ═══════════ M2 — the refusal the incident actually hit ════════════════════

describe("M2 — without the office's pickup, delivery is refused IN THOSE WORDS", () => {
  it("M2.1 — the driver may start her mission while the record is DRIVER_ASSIGNED", async () => {
    expect((await transportRow(B.transportId))!.status, "precondition").toBe("DRIVER_ASSIGNED");
    const started = await as(driver, () => startMission(B.transportId));
    expect(started.ok, JSON.stringify(started)).toBe(true);
  });

  it("M2.2 — her own « enlèvement » records an event and moves no official status", async () => {
    const ev = await as(driver, () =>
      recordDriverEvent(B.transportId, { type: "PICKUP_CONFIRMED", latitude: 14.7, longitude: -17.45 }),
    );
    expect(ev.ok, `recordDriverEvent failed: ${JSON.stringify(ev)}`).toBe(true);
    expect((await events(B.transportId)).some((e) => e.type === "PICKUP_CONFIRMED")).toBe(true);
    expect((await transportRow(B.transportId))!.status).toBe("DRIVER_ASSIGNED");
    expect((await transportRow(B.transportId))!.pickup_actual).toBeNull();
  });

  it("M2.3 — delivery is refused `pickup_not_recorded`, not `invalid_transition`", async () => {
    const refused = await as(driver, () =>
      confirmDelivery(B.transportId, { recipientName: "Someone Waiting" }),
    );
    expect(refused.ok).toBe(false);
    // The precise code is the deliverable: it is what lets the screen tell her
    // to call the coordinator instead of showing « Transition non autorisée. »
    expect((refused as { error: string }).error).toBe("pickup_not_recorded");
    expect((await transportRow(B.transportId))!.status).toBe("DRIVER_ASSIGNED");
    expect((await events(B.transportId)).some((e) => e.type === "DELIVERED")).toBe(false);
  });

  it("M2.4 — and she cannot fix it herself: the official pickup stays the office's act", async () => {
    const self = await as(driver, () => changeTransportStatus(B.transportId, "PICKED_UP"));
    expect(self.ok, "a DRIVER must not move the transport record").toBe(false);
    expect((await transportRow(B.transportId))!.status).toBe("DRIVER_ASSIGNED");
  });

  it("M2.5 — once the office records the pickup, the very same call succeeds", async () => {
    const office = await as(ops, () => changeTransportStatus(B.transportId, "PICKED_UP"));
    expect(office.ok, JSON.stringify(office)).toBe(true);

    const done = await as(driver, () =>
      confirmDelivery(B.transportId, { recipientName: "Someone Waiting" }),
    );
    expect(done.ok, `the explanation must have been actionable: ${JSON.stringify(done)}`).toBe(true);
    expect((await transportRow(B.transportId))!.status).toBe("DELIVERED");
  });
});

// ═══════════ M5 — a finished mission accepts nothing ═══════════════════════

describe("M5 — a COMPLETED session refuses every driver write, and says which", () => {
  it("M5.1 — the driver ends her mission", async () => {
    const live = (await sessions(C.transportId))[0];
    expect(live.status).toBe("ACTIVE");
    const stopped = await as(driver, () => stopMission(live.id));
    expect(stopped.ok, JSON.stringify(stopped)).toBe(true);
    expect((await sessions(C.transportId))[0].status).toBe("COMPLETED");
  });

  it("M5.2 — delivery, evidence and events are all refused `session_completed`", async () => {
    const delivery = await as(driver, () => confirmDelivery(C.transportId, { recipientName: "Too Late" }));
    expect(delivery.ok).toBe(false);
    expect((delivery as { error: string }).error).toBe("session_completed");

    const fd = new FormData();
    fd.set("kind", "pod");
    fd.set("file", new File(["%PDF-1.4 late"], "late.pdf", { type: "application/pdf" }));
    const upload = await as(driver, () => uploadDriverEvidence(C.transportId, fd));
    expect(upload.ok).toBe(false);
    expect((upload as { error: string }).error).toBe("session_completed");

    const event = await as(driver, () => recordDriverEvent(C.transportId, { type: "DEPARTED" }));
    expect(event.ok).toBe(false);
    expect((event as { error: string }).error).toBe("session_completed");
  });

  it("M5.3 — and nothing moved: no delivery, no document, no event, no false completion", async () => {
    const t = await transportRow(C.transportId);
    expect(t!.status).toBe("PICKED_UP");
    expect(t!.delivery_actual).toBeNull();

    // The refused delivery must not have written a SECOND completion record for
    // a session that `stopMission` had already closed. One close, one audit row.
    const closed = (await sessions(C.transportId)).find((s) => s.status === "COMPLETED");
    expect(await auditFor("tracking.session.completed", closed!.id)).toHaveLength(1);
    expect((await events(C.transportId)).filter((e) => e.type === "TRACKING_STOPPED")).toHaveLength(1);
    expect((await driverDocuments(C.fileId)).filter((d) => d.type_code === "DELIVERY_NOTE")).toHaveLength(0);
    expect((await events(C.transportId)).some((e) => e.type === "DELIVERED")).toBe(false);
  });

  it("M5.4 — restarting is the lawful route back, and it opens a NEW session", async () => {
    const restarted = await as(driver, () => startMission(C.transportId));
    expect(restarted.ok, JSON.stringify(restarted)).toBe(true);
    const rows = await sessions(C.transportId);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("ACTIVE");
    expect(rows[1].status).toBe("COMPLETED");
    // …and the delivery she was refused a moment ago now works.
    const done = await as(driver, () => confirmDelivery(C.transportId, { recipientName: "At Last" }));
    expect(done.ok, JSON.stringify(done)).toBe(true);
  });
});

// ═══════════ M8 — the convergence, in both orderings ══════════════════════

describe("M8 — delivery and POD verification converge, whichever arrives first", () => {
  let podE = "";

  it("M8.1 — ORDERING 2 (delivered first): the dossier follows, an UNVERIFIED note earns nothing", async () => {
    const started = await as(driver, () => startMission(E.transportId));
    expect(started.ok, JSON.stringify(started)).toBe(true);

    const fd = new FormData();
    fd.set("kind", "pod");
    fd.set("file", new File(["%PDF-1.4 signed delivery note"], "pod.pdf", { type: "application/pdf" }));
    const up = await as(driver, () => uploadDriverEvidence(E.transportId, fd));
    expect(up.ok, `uploadDriverEvidence failed: ${JSON.stringify(up)}`).toBe(true);
    podE = (up as { id: string }).id;

    const done = await as(driver, () =>
      confirmDelivery(E.transportId, { recipientName: "M. Amadou Diop" }),
    );
    expect(done.ok, `confirmDelivery failed: ${JSON.stringify(done)}`).toBe(true);

    // THE GATE HELD, and this is the assertion that proves the convergence did
    // not weaken it. Her own scan sits in PENDING_REVIEW, which `isVerified`
    // does not accept, so `canReceivePod` is unsatisfied and the receipt
    // refused `evidence_missing`. A driver cannot hand herself a POD receipt
    // by delivering and uploading — a second person must still verify.
    const pod = (await driverDocuments(E.fileId)).find((d) => d.id === podE);
    expect(pod!.status).toBe("PENDING_REVIEW");
    const t = await transportRow(E.transportId);
    expect(t!.status).toBe("DELIVERED");
    expect(await auditFor("transport.pod_received", E.transportId)).toHaveLength(0);

    // R1 all the same: the dossier follows the delivery on its own, with no
    // POD receipt involved. This is the inconsistent operational-file status a
    // successful driver delivery used to leave behind — the lifecycle reads
    // transport and offered closure while the dossier was still IN_PROGRESS.
    expect((await fileRow(E.fileId))!.status).toBe("DELIVERED");
    expect((await fileTransitions(E.fileId)).filter((r) => r.to_status === "DELIVERED")).toHaveLength(1);
  });

  it("M8.2 — then the verification completes it, through the one existing receipt", async () => {
    const verifier = await policyVerifier(E.fileId);
    const ok = await as(verifier, () => verifyDocument(podE));
    expect(ok.ok, `verifyDocument failed: ${JSON.stringify(ok)}`).toBe(true);

    const t = await transportRow(E.transportId);
    expect(t!.status).toBe("POD_RECEIVED");
    const receipt = await auditFor("transport.pod_received", E.transportId);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].actor_id).toBe(verifier.id);
    expect((receipt[0].after as { source?: string } | null)?.source).toBe("AUTOMATIC_ON_POD_VERIFICATION");

    // THE POINT OF THE WHOLE BRIEF: both orderings end in the same place. A was
    // verified then delivered, E was delivered then verified, and neither
    // needed anyone to press a second button.
    expect((await transportRow(A.transportId))!.status).toBe(t!.status);
    expect((await fileRow(A.fileId))!.status).toBe((await fileRow(E.fileId))!.status);
    expect((await fileTransitions(E.fileId)).filter((r) => r.to_status === "DELIVERED")).toHaveLength(1);
  });

  it("M8.3 — repeated delivery callbacks change nothing after the first", async () => {
    const started = await as(driver, () => startMission(D.transportId));
    expect(started.ok, JSON.stringify(started)).toBe(true);

    const first = await as(driver, () =>
      confirmDelivery(D.transportId, { recipientName: "Mme Aïssatou Fall" }),
    );
    expect(first.ok, JSON.stringify(first)).toBe(true);

    // Her delivery ended the session, so an immediate retry meets that guard.
    const retry = await as(driver, () => confirmDelivery(D.transportId, { recipientName: "Again" }));
    expect(retry.ok).toBe(false);
    expect((retry as { error: string }).error).toBe("session_completed");

    // This run carries NO verified note, so it stopped at DELIVERED — tracking
    // will therefore restart, and the state machine is the guard that answers.
    const again = await as(driver, () => startMission(D.transportId));
    expect(again.ok, JSON.stringify(again)).toBe(true);
    const third = await as(driver, () => confirmDelivery(D.transportId, { recipientName: "Again" }));
    expect(third.ok).toBe(false);
    expect((third as { error: string }).error).toBe("already_delivered");

    // ONE of everything, after three delivery calls.
    expect((await transportRow(D.transportId))!.status).toBe("DELIVERED");
    expect(await auditFor("transport.delivered", D.transportId)).toHaveLength(1);
    expect((await events(D.transportId)).filter((e) => e.type === "DELIVERED")).toHaveLength(1);
    expect(await auditFor("transport.pod_received", D.transportId)).toHaveLength(0);
    expect((await fileTransitions(D.fileId)).filter((r) => r.to_status === "DELIVERED")).toHaveLength(1);
  });

  it("M8.4 — and a repeated verification adds no second receipt", async () => {
    // E is already POD_RECEIVED. Whatever a second verification answers, the
    // receipt is compare-and-set on DELIVERED, so no route produces a second
    // transition, a second audit row or a second dossier advance.
    const verifier = await policyVerifier(E.fileId);
    await as(verifier, () => verifyDocument(podE));
    expect((await transportRow(E.transportId))!.status).toBe("POD_RECEIVED");
    expect(await auditFor("transport.pod_received", E.transportId)).toHaveLength(1);
    expect((await fileTransitions(E.fileId)).filter((r) => r.to_status === "DELIVERED")).toHaveLength(1);
  });
});

// ═══════════ tenancy and scope ═════════════════════════════════════════════

describe("driver writes stay inside one tenant and one mission", () => {
  it("every row the driver lane created carries tenant A", async () => {
    for (const m of [A, B, C, D, E]) {
      for (const row of await sessions(m.transportId)) expect(row.tenant_id).toBe(TENANT_A);
      for (const row of await events(m.transportId)) expect(row.tenant_id).toBe(TENANT_A);
      for (const row of await driverDocuments(m.fileId)) expect(row.tenant_id).toBe(TENANT_A);
      expect((await transportRow(m.transportId))!.tenant_id).toBe(TENANT_A);
    }
  });

  it("the driver never became the assignee of a mission she was not given", async () => {
    expect((await transportRow(A.transportId))!.driver_user_id).toBe(driver.id);
    expect((await transportRow(B.transportId))!.driver_user_id).toBe(driver.id);
  });
});
