/**
 * EFF-POD-FINANCE-CONVERGENCE-01 — verified POD evidence reaches Finance by the
 * same route whichever side recorded the delivery.
 * ===========================================================================
 * THE DEFECT. Two paths reach transport DELIVERED: the office through
 * `changeTransportStatus`, the assigned driver through `confirmDelivery ->
 * deliverTransport`. Only the office branch carried the CONSEQUENCES of that
 * fact — the dossier advance and the POD-receipt retry — so with the same
 * verified delivery note and the same delivery, Finance was reached when the
 * office recorded it and never when the driver did, and a driver-confirmed
 * delivery left `operational_file` at IN_PROGRESS while the lifecycle, which
 * reads transport, already offered closure.
 *
 * WHAT THIS SUITE DEFENDS. Not the convergence for its own sake: the SHAPE of
 * it. The consequences run after the delivery has committed and been audited,
 * in the office's order, through the SAME services, with the evidence gate left
 * exactly where it was. A later edit that reorders them, duplicates a service,
 * or lets the shared transition decide for itself what qualifies as POD
 * evidence has to come through here first.
 *
 * The behavioural half lives in tests/journey/driver-delivery.journey.ts (M1.6,
 * M8.1–M8.4) against a real database: both orderings, and repeated calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Assert on CODE, never on prose: this file's own comments name every token. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const shared = strip(read("lib/transport/transition.ts"));
const staff = strip(read("lib/transport/actions.ts"));
const receipt = strip(read("lib/transport/pod-receipt.ts"));
const advance = strip(read("lib/files/auto-advance.ts"));
const delivery = strip(read("lib/driver/delivery.ts"));

const ADVANCE = "advanceFileToDeliveredFromTransport({";
const RECEIPT = "recordPodReceiptFromVerifiedEvidence({";

describe("CONVERGENCE — the shared DELIVERED transition carries its consequences", () => {
  it("1 — it advances the dossier and retries the POD receipt", () => {
    expect(shared).toContain(ADVANCE);
    expect(shared).toContain(RECEIPT);
    expect(shared).toContain('import { advanceFileToDeliveredFromTransport } from "@/lib/files/auto-advance";');
    expect(shared).toContain('import { recordPodReceiptFromVerifiedEvidence } from "./pod-receipt";');
  });

  it("2 — in the office's order: the dossier follows, then the receipt is retried", () => {
    expect(shared.indexOf(ADVANCE)).toBeGreaterThan(-1);
    expect(shared.indexOf(ADVANCE)).toBeLessThan(shared.indexOf(RECEIPT));
    // the same order on the staff branch, so the two cannot drift apart
    expect(staff.indexOf(ADVANCE)).toBeGreaterThan(-1);
    expect(staff.indexOf(ADVANCE)).toBeLessThan(staff.indexOf(RECEIPT));
  });

  it("3 — the DELIVERY commits and is audited BEFORE either consequence runs", () => {
    const update = shared.indexOf('status: "DELIVERED", delivery_actual');
    const audit = shared.indexOf("AuditActions.TRANSPORT_DELIVERED");
    expect(update).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(update);
    expect(audit).toBeLessThan(shared.indexOf(ADVANCE));
    // and the refusal still precedes everything
    expect(shared.indexOf('canTransition(from, "DELIVERED")')).toBeLessThan(update);
  });

  it("4 — and before the re-render, so no screen reads a status that just moved", () => {
    expect(shared.indexOf(RECEIPT)).toBeLessThan(shared.indexOf("revalidatePath("));
  });

  it("5 — ONE implementation of each, reused — not a driver copy", () => {
    const files = ["lib/transport/transition.ts", "lib/transport/actions.ts", "lib/driver/delivery.ts"];
    for (const f of files) {
      expect(strip(read(f)), f).not.toContain("export async function recordPodReceiptFromVerifiedEvidence");
      expect(strip(read(f)), f).not.toContain("export async function advanceFileToDeliveredFromTransport");
    }
    expect(receipt).toContain("export async function recordPodReceiptFromVerifiedEvidence(");
    expect(advance).toContain("export async function advanceFileToDeliveredFromTransport(");
  });
});

describe("CONVERGENCE — no governance control moved", () => {
  it("6 — the shared transition asserts no permission and decides no evidence", () => {
    expect(shared).not.toContain("assertPermission");
    expect(shared).not.toContain("canReceivePod");
    expect(shared).not.toContain("DELIVERY_NOTE");
    expect(shared).not.toContain("isVerified");
    // it never writes the receipt itself, nor touches a document
    expect(shared).not.toContain('status: "POD_RECEIVED"');
    expect(shared).not.toContain("pod_document_id");
    expect(shared).not.toContain('from("document")');
  });

  it("7 — the gate still lives in ONE place, and is still re-applied there", () => {
    expect(receipt).toContain('if (transport.status !== "DELIVERED") return "not_delivered";');
    expect(receipt).toContain('if (!canReceivePod(verifiedCodes)) return "evidence_missing";');
    // compare-and-set, so two arrivals produce exactly one transition
    expect(receipt).toContain('.eq("status", "DELIVERED")');
    expect(receipt).toContain('if ((moved?.length ?? 0) !== 1) return "already";');
    // and the handoff is the existing one
    expect(receipt).toContain("onPodReceived(supabase, ctx, fileId)");
  });

  it("8 — a driver still cannot verify evidence or reach the receipt directly", () => {
    expect(delivery).not.toContain("recordPodReceipt");
    expect(delivery).not.toContain("advanceFileToDelivered");
    expect(delivery).not.toContain("verifyDocument");
    expect(delivery).not.toContain('status: "VERIFIED"');
    expect(delivery).not.toContain("transport:complete");
    // the one door the driver lane goes through
    expect(delivery).toContain("deliverTransport(supabase,");
  });

  it("9 — neither consequence can undo the delivery: both return, never throw", () => {
    for (const [name, src] of [["pod-receipt", receipt], ["auto-advance", advance]] as const) {
      expect(src, name).toMatch(/\} catch \{\s*\n\s*return "failed";/);
    }
    // the shared transition therefore does not guard them, and does not care
    expect(shared).not.toContain("try {");
  });

  it("10 — the correction ships no migration", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
    expect(files.filter((f) => f.endsWith(".sql"))).toHaveLength(151);
  });
});

describe("ATOMICITY — one delivery, however many ask at once", () => {
  const CAS = '.eq("status", from)';
  const LOSES = 'if ((moved?.length ?? 0) !== 1) return { ok: false, error: "invalid_transition" };';

  it("11 — the delivery write is a compare-and-set on the status it read", () => {
    expect(shared).toContain(CAS);
    // observable: PostgREST reports no error for an UPDATE that matched nothing
    const update = shared.indexOf('status: "DELIVERED", delivery_actual');
    const select = shared.indexOf('.select("id")', update);
    expect(select).toBeGreaterThan(update);
    expect(shared.indexOf(CAS)).toBeGreaterThan(update);
    expect(shared.indexOf(CAS)).toBeLessThan(select);
  });

  it("12 — the loser is refused BEFORE anything claims a delivery happened", () => {
    expect(shared).toContain(LOSES);
    const refusal = shared.indexOf(LOSES);
    expect(refusal).toBeGreaterThan(-1);
    for (const claim of [
      "AuditActions.TRANSPORT_DELIVERED",
      "custDelivered(",
      ADVANCE,
      RECEIPT,
      "revalidatePath(",
    ]) {
      expect(shared.indexOf(claim), claim).toBeGreaterThan(refusal);
    }
  });

  it("13 — and the caller writes no event and closes no session for a refusal", () => {
    const guard = delivery.indexOf("if (!delivered.ok) return delivered;");
    expect(guard).toBeGreaterThan(-1);
    // the DELIVERED evidence event and the session completion are both after it
    expect(delivery.indexOf('type: "DELIVERED"')).toBeGreaterThan(guard);
    expect(delivery.indexOf('status: "COMPLETED"')).toBeGreaterThan(guard);
    expect(delivery.indexOf("TRACKING_SESSION_COMPLETED")).toBeGreaterThan(guard);
    expect(delivery.indexOf("TRACKING_STOPPED")).toBeGreaterThan(guard);
    // and the transition is still what decides, not the in-memory gate
    expect(delivery.indexOf("deliverTransport(supabase,")).toBeLessThan(guard);
  });

  it("14 — the session completion is itself gated on a row having moved", () => {
    // EFF-LOCAL-UAT-04 kept: the completion audit and TRACKING_STOPPED are
    // written only inside the `completed?.length === 1` branch, so a session
    // that matched nothing leaves no trail claiming it closed.
    expect(delivery).toContain("if ((completed?.length ?? 0) === 1) {");
    const gated = delivery.indexOf("if ((completed?.length ?? 0) === 1) {");
    expect(delivery.indexOf("TRACKING_SESSION_COMPLETED")).toBeGreaterThan(gated);
    expect(delivery.indexOf("TRACKING_STOPPED")).toBeGreaterThan(gated);
  });
});
