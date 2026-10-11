/**
 * UAT-TRANSPORT-POD-FIX-01 — a real delivery must be recordable after the turn.
 * ---------------------------------------------------------------------------
 * On 2026-10-10 a driver drove dossier EFT-IMP-2026-00014, confirmed the pickup
 * she had made, tapped « Démarrer le retour », and from that second the
 * platform refused everything she tried: her GPS fixes (409), her evidence, her
 * delivery. Nothing about the goods had changed; the session had.
 *
 * What must hold from here on:
 *   * the RETURN leg is a live session — positions, evidence and delivery all
 *     keep working through it;
 *   * a PAUSED session still records paperwork but transmits NO position: the
 *     driver who suspends sharing has withdrawn consent, and that is not a bug
 *     to be "fixed";
 *   * a COMPLETED or CANCELLED session accepts nothing, and says which;
 *   * the transport state machine, the customs gate, the POD approval and the
 *     Finance handoff are untouched — the driver still cannot deliver a mission
 *     the office has not picked up, and she learns WHY in a sentence she can
 *     act on;
 *   * every refusal a driver can receive has a French sentence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIVE_SESSION_STATUSES,
  POSITION_SESSION_STATUSES,
  acceptsPositions,
  deliveryBlock,
  isLiveSession,
  sessionBlock,
} from "@/lib/driver/mission-gates";
import { TRANSPORT_STATUSES, canTransition } from "@/lib/transport/status";
import { canPickup, canReceivePod } from "@/lib/transport/gates";
import type { TrackingSessionStatus } from "@/lib/tracking/types";
import type { TransportStatus } from "@/lib/transport/types";
import { t } from "@/lib/i18n";
import { MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const gatesRaw = read("lib/driver/mission-gates.ts");
const ingest = strip(read("app/api/driver/positions/route.ts"));
const missionAuth = strip(read("lib/driver/mission-auth.ts"));
const delivery = strip(read("lib/driver/delivery.ts"));
const upload = strip(read("lib/driver/upload.ts"));
const ops = strip(read("lib/driver/ops.ts"));
const actions = strip(read("lib/driver/actions.ts"));
const driverService = strip(read("lib/driver/service.ts"));
const page = read("app/driver/missions/[transportId]/page.tsx");
const actionsUi = strip(read("components/driver/mission-actions.tsx"));
const tracker = strip(read("components/driver/mission-tracker.tsx"));

const ALL_SESSION_STATUSES: TrackingSessionStatus[] = ["ACTIVE", "PAUSED", "RETURNING", "COMPLETED", "CANCELLED"];
const DRIVER_ERRORS = t.driver.errors as Record<string, string>;

// ═══════════ D1 — the return leg keeps transmitting ════════════════════════

describe("POD-FIX-01 / D1 — which sessions may send GPS", () => {
  it("01 — ACTIVE and RETURNING are accepted; the return leg is no longer refused", () => {
    expect(acceptsPositions("ACTIVE")).toBe(true);
    expect(acceptsPositions("RETURNING")).toBe(true);
    expect([...POSITION_SESSION_STATUSES]).toEqual(["ACTIVE", "RETURNING"]);
  });

  it("02 — PAUSED sends nothing: suspending sharing is a withdrawal of consent", () => {
    expect(acceptsPositions("PAUSED")).toBe(false);
    expect(isLiveSession("PAUSED")).toBe(true); // …but the paperwork still works
  });

  it("03 — a finished or cancelled session, and any nonsense, is refused", () => {
    for (const s of ["COMPLETED", "CANCELLED", "", "active", "returning", "ARCHIVED"]) {
      expect(acceptsPositions(s), s).toBe(false);
    }
    expect(acceptsPositions(null)).toBe(false);
    expect(acceptsPositions(undefined)).toBe(false);
  });

  it("04 — every position-accepting state is a live state (no orphan permission)", () => {
    for (const s of POSITION_SESSION_STATUSES) expect(isLiveSession(s), s).toBe(true);
  });

  it("05 — the ingest asks the shared predicate, not a literal status", () => {
    expect(ingest).toContain("acceptsPositions(session.status)");
    expect(ingest).not.toContain('session.status !== "ACTIVE"');
    // the refusal keeps its wire contract (409 + code), so clients are unaffected
    expect(ingest).toContain('{ error: "session_not_active" }, { status: 409 }');
  });

  it("06 — the ingest keeps every control it already had", () => {
    expect(ingest).toContain("driverMobileTrackingEnabled()");
    expect(ingest).toContain("if (!isDriver(user))");
    expect(ingest).toContain("session.driver_id !== user.id");
    expect(ingest).toContain('.eq("tenant_id", user.tenantId)');
    expect(ingest).toContain("MAX_POSITION_BATCH");
    expect(ingest).toContain("validatePositionBatch(positions, now)");
    expect(ingest).toContain("idempotency_key");
    // trusted associations still come from the session row, never the client
    expect(ingest).toContain("transport_id: session.transport_id");
    expect(ingest).toContain("file_id: session.file_id");
  });

  it("07 — still ONE audit per batch, never one per coordinate (TMS-2 pin)", () => {
    expect((ingest.match(/writeAudit[(]/g) ?? []).length).toBe(1);
    expect(ingest).toContain("TRACKING_BATCH_RECEIVED");
  });
});

// ═══════════ D2 — evidence and delivery during the return leg ══════════════

describe("POD-FIX-01 / D2 — a live session is ACTIVE, PAUSED or RETURNING", () => {
  it("08 — the live set is exactly those three", () => {
    expect([...LIVE_SESSION_STATUSES]).toEqual(["ACTIVE", "PAUSED", "RETURNING"]);
    for (const s of ALL_SESSION_STATUSES) {
      expect(isLiveSession(s), s).toBe(["ACTIVE", "PAUSED", "RETURNING"].includes(s));
    }
  });

  it("09 — 'no session' and 'session over' are different answers", () => {
    expect(sessionBlock(null)).toBe("no_session");
    expect(sessionBlock(undefined)).toBe("no_session");
    expect(sessionBlock("")).toBe("no_session");
    expect(sessionBlock("COMPLETED")).toBe("session_completed");
    expect(sessionBlock("CANCELLED")).toBe("session_completed");
    for (const s of LIVE_SESSION_STATUSES) expect(sessionBlock(s), s).toBeNull();
  });

  it("10 — every driver write resolves the session through the shared lookup", () => {
    for (const [name, src] of [["delivery", delivery], ["upload", upload], ["ops", ops]] as const) {
      expect(src, name).toContain("liveSessionOrError(supabase, user, transportId)");
      expect(src, name).toContain("if (!live.ok) return { ok: false, error: live.error };");
      expect(src, name).not.toContain("currentSession(");
    }
    // three driver events (event / delay / incident) all go through it
    expect((ops.match(/liveSessionOrError\(/g) ?? []).length).toBe(3);
  });

  it("11 — the lookup is tenant- and transport-scoped and prefers a LIVE row", () => {
    expect(missionAuth).toContain('.eq("tenant_id", user.tenantId)');
    expect(missionAuth).toContain('.eq("transport_id", transportId)');
    expect(missionAuth).toContain("rows.find((r) => isLiveSession(r.status))");
    expect(missionAuth).toContain("sessionBlock(rows[0]?.status ?? null)");
    // assignment is still proven separately, per action
    for (const src of [delivery, upload, ops]) {
      expect(src).toContain("loadAssignedTransport(supabase, user, transportId)");
      expect(src).toContain('if (!rec) return { ok: false, error: "forbidden" };');
    }
  });

  it("12 — the read model treats a returning mission as live", () => {
    expect(driverService).toContain("forTransport.find((s) => isLiveSession(s.status))");
    expect(driverService).not.toContain('s.status === "ACTIVE" || s.status === "PAUSED"');
  });

  it("13 — the screen offers actions whenever the session is live", () => {
    expect(page).toContain("sessionActive={isLiveSession(mission.sessionStatus)}");
    expect(page).not.toContain('mission.sessionStatus === "ACTIVE" || mission.sessionStatus === "PAUSED"');
  });
});

// ═══════════ D3 — the official pickup stays the office's act ═══════════════

describe("POD-FIX-01 / D3 — delivery eligibility is explained, never granted", () => {
  it("14 — the block mirrors the state machine for all nine statuses", () => {
    const expected: Record<TransportStatus, ReturnType<typeof deliveryBlock>> = {
      NOT_STARTED: "pickup_not_recorded",
      PLANNED: "pickup_not_recorded",
      DRIVER_ASSIGNED: "pickup_not_recorded", // ← the UAT's mission sat here
      PICKED_UP: null,
      IN_TRANSIT: null,
      DELIVERED: "already_delivered",
      POD_RECEIVED: "already_delivered",
      BLOCKED: null,
      CANCELLED: "mission_cancelled",
    };
    for (const s of TRANSPORT_STATUSES) expect(deliveryBlock(s), s).toBe(expected[s]);
  });

  it("15 — it can never disagree with canTransition: null exactly when legal", () => {
    for (const s of TRANSPORT_STATUSES) {
      expect(deliveryBlock(s) === null, s).toBe(canTransition(s, "DELIVERED"));
    }
    expect(deliveryBlock("NOPE")).toBe("invalid_transition");
    expect(deliveryBlock(null)).toBe("invalid_transition");
  });

  it("16 — confirmDelivery names the refusal and still defers to the transition", () => {
    expect(delivery).toContain("const blocked = deliveryBlock(rec.status);");
    expect(delivery).toContain("if (blocked) return { ok: false, error: blocked };");
    expect(delivery).toContain("deliverTransport(supabase,");
    expect(delivery).toContain('if (!recipientName) return { ok: false, error: "recipient_required" };');
    // the session is completed only AFTER the transition succeeded
    expect(delivery.indexOf("const delivered = await deliverTransport")).toBeLessThan(
      delivery.indexOf('status: "COMPLETED"'),
    );
    expect(delivery).toContain("if (!delivered.ok) return delivered;");
  });

  it("17 — no driver path moves the transport to PICKED_UP or invents a POD", () => {
    for (const [name, src] of [["delivery", delivery], ["upload", upload], ["ops", ops], ["actions", actions]] as const) {
      expect(src, name).not.toContain('"PICKED_UP"');
      expect(src, name).not.toContain("changeTransportStatus");
      expect(src, name).not.toContain("pod_document_id");
      expect(src, name).not.toContain("POD_RECEIVED\",");
      expect(src, name).not.toContain("recordPodReceipt");
      expect(src, name).not.toContain('status: "VERIFIED"');
      expect(src, name).not.toContain("transport:update");
      expect(src, name).not.toContain("transport:complete");
    }
    // a driver POD scan still enters the review queue; it is not self-approved
    expect(upload).toContain('const status = kind === "pod" ? "PENDING_REVIEW" : "UPLOADED";');
  });

  it("18 — the driver's pickup confirmation remains a tracking event", () => {
    // What the tap writes: an event row, nothing else.
    expect(ops).toContain('.from("tracking_event")');
    expect(ops).not.toContain('.from("transport_record")');
    // And where the driver lane DOES reach transport_record (its assignment
    // lookups), every chain must be a read.
    const chains = (missionAuth + actions).split('from("transport_record")').slice(1);
    expect(chains.length, "the driver lane does read transport_record").toBeGreaterThan(0);
    for (const c of chains) {
      const head = c.slice(0, c.indexOf(";") + 1);
      expect(head, "transport_record must only be READ in the driver lane").not.toMatch(/[.](update|insert|upsert|delete)[(]/);
      expect(head).toContain(".select(");
    }
  });

  it("19 — the screen explains a missing official pickup instead of failing blank", () => {
    expect(actionsUi).toContain("const deliveryUnavailable = deliveryBlock(status);");
    expect(actionsUi).toContain('deliveryUnavailable === "pickup_not_recorded"');
    expect(actionsUi).toContain("o.delivery.pickupPending");
    expect(actionsUi).toContain("o.delivery.pickupPendingHelp");
    expect(actionsUi).toContain("deliveryUnavailable === null ? (");
    expect(actionsUi).not.toContain("DELIVERED_STATES");
    expect(t.driver.ops.delivery.pickupPendingHelp).toContain("coordinateur");
  });

  it("20 — a pickup tap never claims the dossier moved", () => {
    expect(actionsUi).toContain('kind === "PICKUP_CONFIRMED" ? o.events.pickupReported : o.events.recorded');
    const msg = t.driver.ops.events.pickupReported;
    expect(msg).toContain("officiel");
    expect(msg.toLowerCase()).not.toContain("livr"); // never implies delivery
  });

  it("21 — the staff gates this correction must not have touched", () => {
    // customs release still gates pickup; an APPROVED delivery note still gates POD
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
    expect(canReceivePod([])).toBe(false);
    expect(canReceivePod(["DELIVERY_NOTE"])).toBe(true);
    // DRIVER_ASSIGNED → DELIVERED is still not an edge of the state machine
    expect(canTransition("DRIVER_ASSIGNED", "DELIVERED")).toBe(false);
    expect(canTransition("DRIVER_ASSIGNED", "PICKED_UP")).toBe(true);
  });
});

// ═══════════ D4 — every refusal has a French sentence ══════════════════════

describe("POD-FIX-01 / D4 — precise, safe French messages", () => {
  it("22 — the six required situations each have their own wording", () => {
    const required = ["no_session", "session_completed", "pickup_not_recorded", "invalid_transition", "forbidden", "network"];
    for (const k of required) {
      expect(DRIVER_ERRORS[k], k).toBeTruthy();
      expect(DRIVER_ERRORS[k].length, k).toBeGreaterThan(12);
    }
    expect(new Set(required.map((k) => DRIVER_ERRORS[k])).size).toBe(required.length);
  });

  it("23 — EVERY literal error code a driver module returns has a message", () => {
    const codes = new Set<string>();
    for (const src of [delivery, upload, ops, actions]) {
      for (const m of src.matchAll(/error:\s*"([a-z_]+)"/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(8);
    for (const c of codes) expect(DRIVER_ERRORS[c], `missing French message for "${c}"`).toBeTruthy();
  });

  it("24 — and so does every member of the two refusal unions", () => {
    // Derived from the module's own declarations: adding a member without a
    // message fails here rather than reaching a driver as "L'action a échoué".
    const decl = (name: string) => {
      const i = gatesRaw.indexOf(`export type ${name} =`);
      expect(i, name).toBeGreaterThan(-1);
      return gatesRaw.slice(i, gatesRaw.indexOf(";", i));
    };
    const members = (name: string) => [...decl(name).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const session = members("SessionBlock");
    const block = members("DeliveryBlock");
    expect(session).toEqual(["no_session", "session_completed"]);
    expect(block).toEqual(["pickup_not_recorded", "already_delivered", "mission_cancelled", "invalid_transition"]);
    for (const c of [...session, ...block]) expect(DRIVER_ERRORS[c], c).toBeTruthy();
  });

  it("25 — no message leaks an internal detail", () => {
    for (const [k, v] of Object.entries(DRIVER_ERRORS)) {
      expect(v, k).not.toMatch(/undefined|null|SQL|supabase|postgres|RLS|tenant_id|auth\.uid|stack|Error:/i);
      expect(v, k).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no identifiers
    }
  });

  it("26 — a dropped connection is reported, not swallowed, on both surfaces", () => {
    expect(actionsUi).toContain("setFeedback({ ok: false, msg: d.errors.network });");
    expect(tracker).toContain("setError(d.errors.network);");
    expect(actionsUi).toContain("} catch {");
    expect(tracker).toContain("} catch {");
  });
});

// ═══════════ D5 — one mission, one live session ════════════════════════════

describe("POD-FIX-01 / D5 — restarting cannot fork the session", () => {
  it("27 — start reuses ANY live session, not only an ACTIVE one", () => {
    const i = actions.indexOf("export async function startMission");
    const body = actions.slice(i, actions.indexOf("export async function", i + 10));
    expect(body).toContain(".in(\"status\", [...LIVE_SESSION_STATUSES])");
    expect(body).not.toContain('.eq("status", "ACTIVE")\n    .maybeSingle()');
    expect(body).toContain("if (existing) {");
    expect(body).toContain("status: existing.status as TrackingSessionStatus");
    // and it still refuses a terminal mission, and still proves assignment
    expect(body).toContain('tr.status === "CANCELLED" || tr.status === "POD_RECEIVED"');
    expect(body).toContain("tr.driver_user_id !== user.id");
  });

  it("28 — the caller is told which state it got, so the UI cannot lie", () => {
    expect(actions).toContain("status?: TrackingSessionStatus");
    expect(tracker).toContain('setStatus(r.status ?? "ACTIVE");');
    expect(tracker).not.toContain('setSessionId(r.sessionId ?? null);\n      setStatus("ACTIVE");');
  });
});

// ═══════════ scope — nothing else moved ════════════════════════════════════

describe("POD-FIX-01 — the correction stays inside the driver lane", () => {
  it("29 — no migration, no schema, no RLS change: the ledger is where it was", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".verify.sql"));
    expect(files).toHaveLength(151);
    expect(MIGRATION_COUNT).toBe(151);
  });

  it("30 — the pure gate module performs no I/O and names no vendor", () => {
    expect(gatesRaw).not.toMatch(/supabase|getAdminSupabaseClient|fetch\(|process\.env/);
    expect(gatesRaw).toContain('import { canTransition } from "@/lib/transport/status";');
  });

  it("31 — the Finance chain is untouched: POD receipt still needs both facts", () => {
    const receipt = strip(read("lib/transport/pod-receipt.ts"));
    expect(receipt).toContain('if (transport.status !== "DELIVERED") return "not_delivered";');
    expect(receipt).toContain("if (!canReceivePod(verifiedCodes)) return \"evidence_missing\";");
    expect(receipt).toContain("onPodReceived(supabase, ctx, fileId)");
  });

  it("32 — the driver lane still writes no step, handoff, closure or invoice", () => {
    for (const src of [delivery, upload, ops, actions, driverService]) {
      for (const forbidden of ["process_step_execution", "process_handoff", "submitStep", "sendHandoff", "transitionFile", "closureBlockers", "invoice"]) {
        expect(src, forbidden).not.toContain(forbidden);
      }
    }
  });
});
