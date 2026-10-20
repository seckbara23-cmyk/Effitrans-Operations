/**
 * 01B-B2 / B3 / B4 — fan-out, workflow types, mission notifications.
 * ---------------------------------------------------------------------------
 * The FAN-OUT half is EXECUTED: "every authorized recipient is attempted",
 * "concurrency is bounded" and "one failure cannot stop the rest" are outcomes,
 * not shapes, so the real `createNotifications` runs against an in-memory
 * stand-in whose insert can be told to fail or to hold itself open.
 *
 * The TYPE and MISSION halves are structural, and one of them matters more than
 * it looks: test 9 cross-checks every notification type literal emitted
 * anywhere in `lib/` against the CHECK constraint in the migration. A producer
 * emitting a value the constraint does not permit fails the insert, and
 * `createNotification` swallows that by design — so without this test the
 * notification would vanish in production and nothing would say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TENANT = "00000000-0000-0000-0000-000000000001";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Assert on CODE, never on prose: these modules discuss their own tokens. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const migration = read("supabase/migrations/20261020000001_notification_workflow_types.sql");
const verifier = read("supabase/verifiers/20261020000001_notification_workflow_types.verify.sql");
const driverActions = strip(read("lib/driver/actions.ts"));
const missionAuth = strip(read("lib/driver/mission-auth.ts"));
const handoffs = strip(read("lib/handoffs/service.ts"));
const createSrc = strip(read("lib/notifications/create.ts"));

/** What the fake world saw. */
const world: {
  inserts: Array<Record<string, unknown>>;
  failOn: (row: Record<string, unknown>) => boolean;
  inFlight: number;
  maxInFlight: number;
  hold: boolean;
} = { inserts: [], failOn: () => false, inFlight: 0, maxInFlight: 0, hold: false };

vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabaseClient: () => ({
    from: () => ({
      insert(row: Record<string, unknown>) {
        return {
          select: () => ({
            async single() {
              world.inserts.push(row);
              world.inFlight += 1;
              world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
              // Yield twice so genuinely parallel calls overlap here.
              await Promise.resolve();
              await Promise.resolve();
              world.inFlight -= 1;
              if (world.failOn(row)) return { data: null, error: { message: "check violation" } };
              return { data: { id: `n-${world.inserts.length}` }, error: null };
            },
          }),
        };
      },
    }),
  }),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  dispatchNotification: async () => {},
}));

async function fanOut(count: number) {
  const { createNotifications } = await import("@/lib/notifications/create");
  return createNotifications(
    Array.from({ length: count }, (_, i) => ({
      tenantId: TENANT,
      userId: `user-${i}`,
      type: "FILE_ASSIGNED" as const,
      title: "t",
      body: "b",
    })),
  );
}

beforeEach(() => {
  world.inserts = [];
  world.failOn = () => false;
  world.inFlight = 0;
  world.maxInFlight = 0;
  world.hold = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ===========================================================================
describe("B2 — every authorized recipient is attempted", () => {
  it("1 — 25 recipients means 25 attempts, not a capped subset", async () => {
    // THE REQUIREMENT. Bounding concurrency must never become a silent cap on
    // who gets told: a workflow that notifies fewer people than it should is a
    // worse defect than the latency it saved.
    const res = await fanOut(25);
    expect(world.inserts).toHaveLength(25);
    expect(res).toEqual({ attempted: 25, created: 25, failed: 0 });
    expect(new Set(world.inserts.map((r) => r.user_id)).size).toBe(25);
  });

  it("2 — a list longer than one chunk still reaches everybody", async () => {
    const res = await fanOut(103);
    expect(res.attempted).toBe(103);
    expect(res.created).toBe(103);
    expect(world.inserts).toHaveLength(103);
  });

  it("3 — an empty recipient list does nothing at all, quietly", async () => {
    const res = await fanOut(0);
    expect(res).toEqual({ attempted: 0, created: 0, failed: 0 });
    expect(world.inserts).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("B2 — concurrency is bounded", () => {
  it("4 — no more than NOTIFICATION_FANOUT_CONCURRENCY are ever in flight", async () => {
    const { NOTIFICATION_FANOUT_CONCURRENCY } = await import("@/lib/notifications/create");
    await fanOut(40);
    expect(NOTIFICATION_FANOUT_CONCURRENCY).toBe(5);
    expect(world.maxInFlight).toBeGreaterThan(1);               // genuinely parallel…
    expect(world.maxInFlight).toBeLessThanOrEqual(NOTIFICATION_FANOUT_CONCURRENCY); // …and capped
  });

  it("5 — it is actually faster than sequential: more than one at a time", async () => {
    await fanOut(10);
    // A sequential loop would never show two in flight. This is the whole point
    // of the slice, so it is asserted rather than assumed.
    expect(world.maxInFlight).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
describe("B2 — one failure cannot stop the rest, and is observable", () => {
  it("6 — a single rejected recipient does not abort the fan-out", async () => {
    world.failOn = (row) => row.user_id === "user-7";
    const res = await fanOut(20);
    expect(world.inserts).toHaveLength(20);
    expect(res).toEqual({ attempted: 20, created: 19, failed: 1 });
  });

  it("7 — failures in every chunk still leave the others delivered", async () => {
    world.failOn = (row) => String(row.user_id).endsWith("3");
    const res = await fanOut(30);
    expect(res.attempted).toBe(30);
    expect(res.created).toBe(27);
    expect(res.failed).toBe(3);
  });

  it("8 — an incomplete fan-out is reported, and still does not throw", async () => {
    world.failOn = () => true;
    const res = await fanOut(4);
    expect(res).toEqual({ attempted: 4, created: 0, failed: 4 });
    expect(console.error).toHaveBeenCalled();
    const logged = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => String(c[0])).join("\n");
    expect(logged).toContain("fan-out incomplete: 4/4");
  });
});

// ===========================================================================
describe("B3 — the emitted vocabulary cannot drift from the constraint", () => {
  it("9 — the TypeScript union and the CHECK constraint permit exactly the same set", () => {
    // THE TEST THAT MATTERS, and this is the precise form of it. TypeScript
    // already refuses a `type:` literal outside `NotificationType`, so a
    // producer cannot emit an unknown value. The one place drift can hide is
    // between the union and the constraint — and a value in the union but not
    // in the CHECK fails the insert, which create.ts swallows BY DESIGN, so the
    // notification would vanish in production with nothing to show why.
    const permitted = new Set(
      [...migration.matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]),
    );
    const union = new Set(
      [...strip(read("lib/notifications/types.ts")).matchAll(/\|\s*"([A-Z][A-Z_]+)"/g)]
        .map((m) => m[1]),
    );

    expect(permitted.size).toBe(9);
    expect([...union].sort()).toEqual([...permitted].sort());
  });

  it("9b — the mission types passed to notifyDispatchers are in that set", () => {
    // The 6th argument is a type but is not written as `type:`, so TypeScript
    // checks it and this pins the two literals this gate introduced.
    const permitted = new Set(
      [...migration.matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]),
    );
    for (const literal of ["MISSION_STARTED", "MISSION_COMPLETED"]) {
      expect(driverActions, literal).toContain(`"${literal}"`);
      expect([...permitted], literal).toContain(literal);
    }
  });

  it("10 — the six pre-existing values are all still permitted", () => {
    for (const legacy of [
      "TASK_ASSIGNED", "TASK_DUE_SOON", "TASK_OVERDUE",
      "FILE_ASSIGNED", "MESSAGE_RECEIVED", "CONVERSATION_ASSIGNED",
    ]) {
      expect(migration, legacy).toContain(`'${legacy}'`);
    }
  });

  it("11 — the migration is additive only: it drops no constraint but the one it replaces", () => {
    expect(migration).toContain("drop constraint if exists notification_type_check");
    expect(migration).toContain("add constraint notification_type_check");
    // No column, index, policy, trigger, function, grant or data change.
    for (const forbidden of [
      "add column", "drop column", "create index", "create policy", "drop policy",
      "create trigger", "create or replace function", "grant ", "revoke ",
      "update public.notification", "delete from",
    ]) {
      expect(migration.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("12 — the verifier exists, returns one row, and coalesces before bool_and", () => {
    expect(verifier).toContain("bool_and(coalesce(c.ok, false)) as ok");
    expect(verifier).toContain("from checks c;");
    // It must assert the pre-existing values too — backward compatibility is
    // the claim most worth defending.
    expect(verifier).toContain("every PRE-EXISTING value is still legal");
    expect(verifier).toContain("no live row holds a type outside the permitted set");
    // And it must NOT assert security via grants on Supabase.
    expect(verifier).toContain("DELIBERATELY NOT A GRANT CHECK");
  });
});

// ===========================================================================
describe("B4 — mission notifications, once each, without touching transport", () => {
  it("13 — start notifies MISSION_STARTED and completion notifies MISSION_COMPLETED", () => {
    expect(driverActions).toContain('"MISSION_STARTED"');
    expect(driverActions).toContain('"MISSION_COMPLETED"');
    expect(driverActions).toContain('from "./mission-auth"');
  });

  it("14 — the start notification sits AFTER the insert, not before the idempotent return", () => {
    // Notifying before the early return would re-notify on every repeated tap.
    const earlyReturn = driverActions.indexOf("status: existing.status as TrackingSessionStatus");
    const started = driverActions.indexOf('"MISSION_STARTED"');
    const insertEvent = driverActions.indexOf('type: "TRACKING_STARTED"');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(started).toBeGreaterThan(earlyReturn);
    expect(started).toBeGreaterThan(insertEvent);
  });

  it("15 — completion is notified after the state-guarded update", () => {
    const guard = driverActions.indexOf('s.status !== "ACTIVE"');
    const completed = driverActions.indexOf('"MISSION_COMPLETED"');
    expect(guard).toBeGreaterThan(-1);
    expect(completed).toBeGreaterThan(guard);
  });

  it("16 — it changes no transport transition, pickup gate or customs control", () => {
    // The whole point: B4 writes a notification, nothing else. It READS the
    // transport record to find the dossier and the plate — reading is not
    // transitioning — so the assertion is about WRITES.
    expect(driverActions).not.toContain('"PICKED_UP"');
    expect(driverActions).not.toContain("RELEASED");
    expect(driverActions).not.toContain("setTransportStatus");
    expect(driverActions).not.toMatch(/from\("transport_record"\)[\s\S]{0,120}\.update\(/);
    expect(driverActions).not.toMatch(/from\("transport_record"\)[\s\S]{0,120}\.insert\(/);
  });

  it("17 — the office resolver is reused, not reinvented, and stays server-side", () => {
    expect(missionAuth).toContain("export async function notifyDispatchers");
    expect(missionAuth).toContain("account_manager_id, coordinator_id, created_by");
    // De-duplicated, and the type defaults so delay/incident callers are intact.
    expect(missionAuth).toContain("new Set<string>(");
    expect(missionAuth).toContain('type: NotificationType = "FILE_ASSIGNED"');
  });
});

// ===========================================================================
describe("01B — the non-blocking contract is intact", () => {
  it("18 — a create failure still returns instead of throwing", () => {
    expect(createSrc).toContain("return { ok: false };");
    expect(createSrc).not.toContain("throw new Error");
  });

  it("19 — the fan-out settles every attempt, so it cannot throw into a business action", () => {
    expect(createSrc).toContain("Promise.allSettled(");
  });

  it("20 — a handoff is now labelled as one, and still carries its task", () => {
    expect(handoffs).toContain('type: "HANDOFF_RECEIVED" as const');
    expect(handoffs).toContain("taskId: msg.taskId");
    expect(handoffs).toContain("createNotifications(");
  });
});
