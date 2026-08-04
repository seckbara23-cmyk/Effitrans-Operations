/**
 * UT-3B — the ledger honesty marker, the one application-level emitter.
 *
 * Its behaviour in the database (that the call shape is valid and lands a
 * well-formed row) is proven by `rls_decision_plane_emitters_test.sql`. What
 * lives only in TypeScript, and therefore only here, is the guard around it:
 * who may record it, that it is recorded once, and that it says nothing it
 * cannot support.
 *
 * These are structural contracts rather than an executed call, because the
 * module is a `"use server"` action over a session and a service-role client.
 * Mocking that whole surface would test the mock; reading the guard proves the
 * guard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getEventType } from "@/lib/workflow/events/types";
import { validateEventMetadata } from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MARKER = "lib/workflow/events/ledger-marker.ts";

describe("the ledger marker is the seventh emitter, and the only app-level one", () => {
  it("is registered as rpc-emitted — the statement IS the act", () => {
    // Every other approved emitter is `trigger`, because it joins an existing
    // act's transaction. This one has no prior act to join: emitting it is the
    // thing being recorded, so a single call is the whole transaction.
    expect(getEventType("HISTORICAL_EVENTS_NOT_BACKFILLED")?.emission).toBe("rpc");
    expect(getEventType("HISTORICAL_EVENTS_NOT_BACKFILLED")?.domain).toBe("ledger");
  });

  it("emits through the sanctioned path, not a direct insert", () => {
    const src = code(MARKER);
    expect(src).toMatch(/\.rpc\("emit_business_event"/);
    expect(src).not.toMatch(/from\("business_event"\)[\s\S]{0,60}\.insert\(/);
  });
});

describe("who may record it", () => {
  it("is gated on an EXISTING permission — none was created for it", () => {
    const src = code(MARKER);
    expect(src).toMatch(/assertPermission\("admin:config:manage"\)/);
    // The same authority that already reads configuration history, which is
    // exactly who this statement addresses.
    expect(src).not.toMatch(/ledger:[a-z]+|tracking:[a-z]+/);
  });

  it("refuses before touching the client, and returns rather than throws", () => {
    const src = code(MARKER);
    const gate = src.indexOf("assertPermission");
    const client = src.indexOf("getAdminSupabaseClient()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(client);
    expect(src).toMatch(/return \{ ok: false, error: "forbidden" \}/);
  });
});

describe("a ledger has ONE beginning", () => {
  it("reads the ledger first and refuses a second marker", () => {
    const src = code(MARKER);
    // The guard is a read, not a unique constraint: a second marker would
    // claim a second beginning, which is a statement about history, not a
    // storage conflict.
    expect(src).toMatch(/eq\("event_type", "HISTORICAL_EVENTS_NOT_BACKFILLED"\)/);
    expect(src).toMatch(/if \(\(count \?\? 0\) > 0\) return \{ ok: true, alreadyRecorded: true \}/);
  });

  it("the second call changes nothing — it reports, it does not re-emit", () => {
    const src = code(MARKER);
    const guard = src.indexOf("alreadyRecorded: true");
    const emit = src.indexOf('rpc("emit_business_event"');
    expect(guard).toBeLessThan(emit);
  });

  it("is scoped to the caller's tenant on every read and on the emit", () => {
    const src = code(MARKER);
    expect((src.match(/user\.tenantId/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("it says only what it can support", () => {
  it("carries exactly the one metadata key the registry allows", () => {
    const src = code(MARKER);
    expect(src).toMatch(/ledger_started_at:/);
    const ok = validateEventMetadata("HISTORICAL_EVENTS_NOT_BACKFILLED", {
      ledger_started_at: "2026-08-11T00:00:00Z",
    });
    expect(ok.ok).toBe(true);
    // Anything else is refused by the platform's own validator.
    const bad = validateEventMetadata("HISTORICAL_EVENTS_NOT_BACKFILLED", {
      ledger_started_at: "2026-08-11T00:00:00Z", note: "why",
    });
    expect(bad.ok).toBe(false);
  });

  it("dates the boundary from the EARLIEST recorded event, not from 'now'", () => {
    // The marker's claim is "recorded history starts here". Stamping it with
    // the moment the button was pressed would date the claim to the click.
    const src = code(MARKER);
    expect(src).toMatch(/order\("occurred_at", \{ ascending: true \}\)/);
    expect(src).toMatch(/earliest[\s\S]{0,120}occurred_at/);
  });

  it("backfills nothing and rewrites nothing", () => {
    const src = code(MARKER);
    // Mutation calls only. "backfill" cannot be matched as a word here: the
    // event type is literally HISTORICAL_EVENTS_NOT_BACKFILLED.
    expect(src).not.toMatch(/\.update\(|\.upsert\(|\.delete\(/);
  });

  it("records the act in the audit log without putting the audit in the ledger", () => {
    const src = code(MARKER);
    expect(src).toMatch(/writeAudit\(/);
    // audit_log is forensic; it is never a timeline source (DEC-B88).
    expect(src).not.toMatch(/from\("audit_log"\)/);
  });
});

describe("registry completeness is unchanged by adding coverage", () => {
  it("still exactly two reserved types, and they are the acts that do not exist", () => {
    const src = code("lib/workflow/events/types.ts");
    expect([...src.matchAll(/emission: "reserved"/g)]).toHaveLength(2);
    for (const t of ["ADMIN_OVERRIDE_EXECUTED", "WORKFLOW_REVERSED"]) {
      expect(getEventType(t)?.emission, t).toBe("reserved");
    }
  });

  it("all seven approved types are emitted — six by trigger, one by rpc", () => {
    const trigger = ["CORRESPONDENCE_RECEIVED", "HANDOFF_SENT", "HANDOFF_RECEIVED",
                     "DOCUMENT_SHARED_WITH_CLIENT", "EXPENSE_AUTHORIZED", "DOSSIER_POLICY_PINNED"];
    for (const t of trigger) expect(getEventType(t)?.emission, t).toBe("trigger");
    expect(getEventType("HISTORICAL_EVENTS_NOT_BACKFILLED")?.emission).toBe("rpc");
  });
});
