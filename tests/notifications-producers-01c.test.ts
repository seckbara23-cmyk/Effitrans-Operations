/**
 * 01C — the three workflow notification producers.
 * ---------------------------------------------------------------------------
 * Migration #156 widened `notification.type` to nine values. This slice is the
 * other half: the code that actually emits the three new ones. The ordering
 * mattered because `createNotification` swallows insert errors by design, so a
 * producer shipped first would have lost notifications SILENTLY rather than
 * failing loudly.
 *
 * WHAT IS PINNED HERE, AND WHY STRUCTURALLY. These producers live inside
 * `"use server"` actions that resolve an authenticated driver, a service-role
 * client and a dossier before they reach the notification. Rendering or
 * invoking them would prove nothing without a database; what CAN be proved
 * from source is the thing most likely to regress — WHERE in each function the
 * emission sits, which is what decides whether a retry notifies twice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveVehicleIdentity } from "@/lib/transport/vehicle-identity";
import { notificationHref } from "@/lib/notifications/links";
import type { NotificationType } from "@/lib/notifications/types";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const driverActions = read("lib/driver/actions.ts");
const missionAuth = read("lib/driver/mission-auth.ts");
const handoffs = read("lib/handoffs/service.ts");
const intake = read("lib/process/engine/intake-actions.ts");
const create = read("lib/notifications/create.ts");

/** The body of one exported function, from its signature to the next one. */
function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const rest = src.slice(i + 1);
  const j = rest.indexOf("\nexport ");
  return j < 0 ? rest : rest.slice(0, j);
}

const NEW_TYPES = ["HANDOFF_RECEIVED", "MISSION_STARTED", "MISSION_COMPLETED"] as const;

// ===========================================================================
describe("1 — the three new types exist and are emitted", () => {
  it("1.1 — the union carries exactly the nine permitted values", () => {
    const union = read("lib/notifications/types.ts");
    const members = [...union.matchAll(/\|\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(members).toHaveLength(9);
    expect(new Set(members)).toEqual(
      new Set([
        "TASK_ASSIGNED", "TASK_DUE_SOON", "TASK_OVERDUE", "FILE_ASSIGNED",
        "MESSAGE_RECEIVED", "CONVERSATION_ASSIGNED",
        "HANDOFF_RECEIVED", "MISSION_STARTED", "MISSION_COMPLETED",
      ]),
    );
  });

  it("1.2 — each new type has at least one real producer", () => {
    const all = driverActions + handoffs + intake;
    for (const t of NEW_TYPES) expect(all, t).toContain(`"${t}"`);
  });

  it("1.3 — the union matches migration #156's CHECK, in both directions", () => {
    const mig = read("supabase/migrations/20261020000001_notification_workflow_types.sql");
    const stmt = mig
      .split(/\r?\n/)
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
      .split(";")
      .find((s) => /add\s+constraint/i.test(s))!;
    const sql = new Set([...stmt.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
    const union = read("lib/notifications/types.ts");
    const ts = new Set([...union.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).filter((v) => sql.has(v) || /^[A-Z_]+$/.test(v)));
    // Every legal database value is representable in TypeScript...
    for (const v of sql) expect(ts.has(v), `${v} missing from NotificationType`).toBe(true);
    // ...and nothing the code can emit is illegal in the database.
    const emittable = [...union.matchAll(/\|\s*"([A-Z_]+)"/g)].map((m) => m[1]).concat("TASK_ASSIGNED");
    for (const v of emittable) expect(sql.has(v), `${v} is not permitted by the CHECK`).toBe(true);
  });
});

// ===========================================================================
describe("2 — MISSION_STARTED fires once, on a session that was actually opened", () => {
  const start = fn(driverActions, "startMission");

  it("2.1 — it emits MISSION_STARTED", () => {
    expect(start).toContain('"MISSION_STARTED"');
  });

  it("2.2 — AFTER the insert succeeded, not before", () => {
    // The whole idempotency argument rests on this ordering: the function
    // returns early for an already-live session, so notifying above the insert
    // would re-notify on every repeated tap of « Démarrer ».
    const insertAt = start.indexOf('.from("tracking_session")');
    const notifyAt = start.indexOf('"MISSION_STARTED"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(insertAt);
  });

  it("2.3 — BELOW the early return for an existing live session", () => {
    const existingAt = start.indexOf("if (existing)");
    expect(existingAt).toBeGreaterThan(-1);
    expect(start.indexOf('"MISSION_STARTED"')).toBeGreaterThan(existingAt);
  });

  it("2.4 — BELOW the duplicate-key race re-read, which also returns early", () => {
    const raceAt = start.indexOf("duplicate|unique");
    expect(raceAt).toBeGreaterThan(-1);
    expect(start.indexOf('"MISSION_STARTED"')).toBeGreaterThan(raceAt);
  });

  it("2.5 — it names the vehicle through the fleet resolver, not the free text", () => {
    // TRN-VEHICLE-01: a fleet mission has vehicle_id set and vehicle_plate
    // correctly NULL, so reading the plate alone would announce
    // « véhicule non renseigné » for the fleet's own trucks.
    expect(start).toContain("resolveVehicleIdentity(");
    expect(start).toContain("vehicle:vehicle_id(registration)");
    expect(start).not.toContain('tr.vehicle_plate ?? "non renseigné"');
  });

  it("2.6 — and the resolver really does prefer the registration", () => {
    expect(resolveVehicleIdentity({ registration: "DK-1234-A", plate: "OLD-TEXT" })).toBe("DK-1234-A");
    expect(resolveVehicleIdentity({ registration: null, plate: "HIRED-77" })).toBe("HIRED-77");
    expect(resolveVehicleIdentity({ registration: "  ", plate: null })).toBeNull();
  });
});

// ===========================================================================
describe("3 — MISSION_COMPLETED cannot notify twice", () => {
  const stop = fn(driverActions, "stopMission");

  it("3.1 — a SEQUENTIAL repeat is refused by the state guard", () => {
    expect(stop).toContain('return { ok: false, error: "invalid_state" }');
    expect(stop.indexOf("invalid_state")).toBeLessThan(stop.indexOf('"MISSION_COMPLETED"'));
  });

  it("3.2 — a CONCURRENT repeat is refused by a compare-and-set", () => {
    // Two taps landing together both read a live session. Without a predicate
    // on the WRITE, both would succeed and both would notify.
    const update = stop.slice(stop.indexOf('.update({ status: "COMPLETED"'));
    expect(update).toContain('.in("status", [...LIVE_SESSION_STATUSES])');
    // PostgREST reports no error for an UPDATE matching nothing, so the
    // predicate is useless without asking which rows it touched.
    expect(update).toContain('.select("id")');
  });

  it("3.3 — the loser of the race notifies nothing and still succeeds", () => {
    expect(stop).toContain("closedItHere");
    expect(stop).toMatch(/if \(!closedItHere\) return \{ ok: true/);
    expect(stop.indexOf("closedItHere")).toBeLessThan(stop.indexOf('"MISSION_COMPLETED"'));
  });

  it("3.4 — the duplicate TRACKING_STOPPED event is fenced by the same check", () => {
    const after = stop.slice(stop.indexOf("closedItHere"));
    expect(after).toContain('type: "TRACKING_STOPPED"');
  });

  it("3.5 — it announces the TRACKING closing, not a delivery", () => {
    // Approved wording. « Mission terminée » would read as the mission itself
    // being complete, which this event does not establish: the driver stopped
    // recording. Delivery is the transport record's own state and a POD is
    // verified by the platform's predicate — neither is implied here.
    expect(stop).toContain('"Suivi de mission terminé"');
    expect(stop).toContain('"Le suivi de la mission est clôturé."');
    expect(stop).not.toContain('"Mission terminée"');
  });

  it("3.6 — and claims nothing about delivery, POD or receipt", () => {
    // Scoped to the two strings the recipient actually reads — the title and
    // body handed to notifyDispatchers — not to every literal in the function,
    // which legitimately mentions POD_RECEIVED and other states.
    const call = stop.slice(stop.indexOf("notifyDispatchers("), stop.indexOf('"MISSION_COMPLETED"'));
    const text = [...call.matchAll(/"([^"\\]+)"/g)].map((m) => m[1]).join(" ").toLowerCase();
    expect(text).toContain("suivi de mission terminé");
    // A guard on the vocabulary, not just on today's string: each of these
    // would assert a fact this event has no evidence for.
    for (const claim of ["livr", "pod", "réceptionn", "bon de livraison", "confirmé"]) {
      expect(text, claim).not.toContain(claim);
    }
  });
});

// ===========================================================================
describe("4 — HANDOFF_RECEIVED, and where it sends the recipient", () => {
  it("4.1 — the department handoff is labelled HANDOFF_RECEIVED, not TASK_ASSIGNED", () => {
    expect(handoffs).toContain('type: "HANDOFF_RECEIVED" as const');
    expect(handoffs).not.toContain('type: "TASK_ASSIGNED"');
  });

  it("4.2 — the Transit handoff too, replacing the FILE_ASSIGNED catch-all", () => {
    const hand = fn(intake, "handDossierToTransit");
    expect(hand).toContain('type: "HANDOFF_RECEIVED" as const');
  });

  it("4.3 — the bell sends HANDOFF_RECEIVED to the DOSSIER, not /tasks", () => {
    // This is the user-visible consequence of 4.1: the recipient's subject is
    // the dossier that just arrived, and the handoff-receiver visibility
    // bridge (migration 121) grants read while the handoff is open.
    const href = notificationHref({
      type: "HANDOFF_RECEIVED" as NotificationType,
      fileId: "11111111-1111-4111-8111-111111111111",
      taskId: "22222222-2222-4222-8222-222222222222",
    });
    expect(href).toBe("/files/11111111-1111-4111-8111-111111111111");
  });

  it("4.4 — the task id is still carried on the row", () => {
    // The task is real; only the destination changed.
    expect(handoffs).toContain("taskId: msg.taskId");
  });

  it("4.5 — MISSION_* notifications open the dossier as well", () => {
    for (const t of ["MISSION_STARTED", "MISSION_COMPLETED"] as NotificationType[]) {
      expect(notificationHref({ type: t, fileId: "abc" }), t).toBe("/files/abc");
    }
  });
});

// ===========================================================================
describe("5 — recipients, tenancy and failure containment", () => {
  it("5.1 — notifyDispatchers scopes the dossier read to the tenant", () => {
    const nd = missionAuth.slice(missionAuth.indexOf("export async function notifyDispatchers"));
    expect(nd).toContain('.eq("tenant_id", tenantId)');
    expect(nd).toContain('.eq("id", fileId)');
  });

  it("5.2 — recipients come from the dossier's own people, de-duplicated", () => {
    const nd = missionAuth.slice(missionAuth.indexOf("export async function notifyDispatchers"));
    expect(nd).toContain("new Set<string>(");
    expect(nd).toContain("account_manager_id");
    expect(nd).toContain("coordinator_id");
    expect(nd).toContain("created_by");
  });

  it("5.3 — a missing dossier notifies nobody", () => {
    const nd = missionAuth.slice(missionAuth.indexOf("export async function notifyDispatchers"));
    expect(nd).toContain("if (!file) return;");
  });

  it("5.4 — the type is a parameter that DEFAULTS to the old label", () => {
    // So the pre-existing delay/incident callers keep behaving exactly as before.
    expect(missionAuth).toContain('type: NotificationType = "FILE_ASSIGNED"');
  });

  it("5.5 — no producer can throw a notification failure into the business action", () => {
    // createNotification swallows and reports; createNotifications settles.
    expect(create).toContain("Promise.allSettled");
    expect(create).toContain("return { ok: false };");
    expect(create).not.toContain("throw new Error");
  });

  it("5.6 — the fan-out log carries counts, never recipients or message text", () => {
    const log = create.slice(create.indexOf("fan-out incomplete"));
    const line = log.slice(0, log.indexOf(")"));
    for (const leak of ["userId", "title", "body", "input.title", "input.body"]) {
      expect(line, leak).not.toContain(leak);
    }
    expect(create).toContain("${failed}/${inputs.length} not created");
  });

  it("5.7 — concurrency is bounded but the recipient list is not truncated", () => {
    expect(create).toContain("NOTIFICATION_FANOUT_CONCURRENCY = 5");
    // No slice/cap on the input list itself — every recipient is attempted.
    expect(create).toContain("i += NOTIFICATION_FANOUT_CONCURRENCY");
    expect(create).not.toMatch(/inputs\.slice\(0,\s*\d+\)/);
  });
});

// ===========================================================================
describe("6 — scope: this slice ships no migration and no schema change", () => {
  it("6.1 — no producer sets a notification type the database forbids", () => {
    const mig = read("supabase/migrations/20261020000001_notification_workflow_types.sql");
    const permitted = new Set([...mig.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
    const emitted = [...(driverActions + handoffs + intake + read("lib/messaging/notify.ts") +
      read("lib/finance/request-actions.ts") + read("lib/process/engine/transit-actions.ts"))
      .matchAll(/type: "([A-Z_]+)" as const|"(MISSION_[A-Z]+|HANDOFF_RECEIVED)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter(Boolean);
    expect(emitted.length).toBeGreaterThan(0);
    for (const t of emitted) expect(permitted.has(t), `${t} not permitted by #156`).toBe(true);
  });

  it("6.2 — the build-info migration pins are untouched at 156", () => {
    const bi = read("lib/platform/ops/build-info.ts");
    expect(bi).toContain("MIGRATION_COUNT = 156");
    expect(bi).toContain('LATEST_MIGRATION = "20261020000001_notification_workflow_types"');
  });
});
