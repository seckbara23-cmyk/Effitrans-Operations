import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classifyTrackingHealth } from "@/lib/tracking/health";
import { validatePositionBatch, MAX_POSITION_BATCH } from "@/lib/driver/batch";
import { postLoginPath } from "@/lib/auth/session-class";
import { enqueue, loadQueue, removeKeys, MAX_QUEUE, type QueuedPosition } from "@/components/driver/queue";

const NOW = new Date("2099-07-11T12:00:00.000Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("tracking health classification", () => {
  it("maps session status + position age to a health state", () => {
    expect(classifyTrackingHealth({ sessionStatus: null, lastPositionAt: null, now: NOW })).toBe("not_started");
    expect(classifyTrackingHealth({ sessionStatus: "CANCELLED", lastPositionAt: null, now: NOW })).toBe("not_started");
    expect(classifyTrackingHealth({ sessionStatus: "COMPLETED", lastPositionAt: iso(-100), now: NOW })).toBe("completed");
    expect(classifyTrackingHealth({ sessionStatus: "PAUSED", lastPositionAt: iso(-100), now: NOW })).toBe("paused");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: iso(-60_000), now: NOW })).toBe("live");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: iso(-500_000), now: NOW })).toBe("stale");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: iso(-2_000_000), now: NOW })).toBe("offline");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: null, now: NOW })).toBe("offline");
  });
});

describe("driver position batch validation", () => {
  const pos = (over: Partial<QueuedPosition>): QueuedPosition => ({ latitude: 14.7, longitude: -17.4, recordedAt: iso(-1000), idempotencyKey: "k1", ...over });

  it("accepts a valid position", () => {
    const r = validatePositionBatch([pos({})], NOW);
    expect(r.accepted).toHaveLength(1);
    expect(r.tooLarge).toBe(false);
  });
  it("rejects invalid coordinate / future / too-old / missing key", () => {
    const r = validatePositionBatch(
      [
        pos({ latitude: 0, longitude: 0, idempotencyKey: "a" }),
        pos({ recordedAt: iso(10 * 60_000), idempotencyKey: "b" }),
        pos({ recordedAt: iso(-2 * 86_400_000), idempotencyKey: "c" }),
        pos({ idempotencyKey: "" }),
      ],
      NOW,
    );
    expect(r.accepted).toHaveLength(0);
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.idempotencyKey, x.reason]));
    expect(reasons["a"]).toBe("invalid_coordinate");
    expect(reasons["b"]).toBe("future_timestamp");
    expect(reasons["c"]).toBe("too_old");
    expect(r.rejected.some((x) => x.reason === "missing_idempotency_key")).toBe(true);
  });
  it("de-duplicates repeated idempotency keys within a batch", () => {
    const r = validatePositionBatch([pos({ idempotencyKey: "dup" }), pos({ idempotencyKey: "dup" })], NOW);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([{ idempotencyKey: "dup", reason: "duplicate_in_batch" }]);
  });
  it("flags an oversized batch and caps processing", () => {
    const many = Array.from({ length: MAX_POSITION_BATCH + 5 }, (_, i) => pos({ idempotencyKey: `k${i}` }));
    const r = validatePositionBatch(many, NOW);
    expect(r.tooLarge).toBe(true);
    expect(r.accepted.length).toBeLessThanOrEqual(MAX_POSITION_BATCH);
  });
});

describe("post-login redirect selection (DRIVER routing)", () => {
  it("routes portal, staff-driver, and other staff correctly", () => {
    expect(postLoginPath("portal", [])).toBe("/portal");
    expect(postLoginPath("staff", ["DRIVER"])).toBe("/driver");
    expect(postLoginPath("staff", ["DRIVER", "SYSTEM_ADMIN"])).toBe("/driver");
    expect(postLoginPath("staff", ["OPS_SUPERVISOR"])).toBe("/dashboard");
    expect(postLoginPath("none", [])).toBe("/dashboard");
    // Phase 4.0B — a pure platform admin (no tenant identity) lands on /platform.
    expect(postLoginPath("none", [], true)).toBe("/platform");
    expect(postLoginPath("staff", ["OPS_SUPERVISOR"], true)).toBe("/dashboard"); // staff home wins
  });
});

describe("offline queue (bounded, keyed)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  const p = (key: string): QueuedPosition => ({ latitude: 14.7, longitude: -17.4, recordedAt: iso(0), idempotencyKey: key });

  it("enqueues and removes by key", () => {
    enqueue("s1", p("a"));
    enqueue("s1", p("b"));
    expect(loadQueue("s1").map((x) => x.idempotencyKey)).toEqual(["a", "b"]);
    removeKeys("s1", ["a"]);
    expect(loadQueue("s1").map((x) => x.idempotencyKey)).toEqual(["b"]);
  });
  it("is bounded — oldest positions drop past the cap", () => {
    const full = Array.from({ length: MAX_QUEUE }, (_, i) => p(`k${i}`));
    store.set("effitrans.driver.queue.s2", JSON.stringify(full));
    enqueue("s2", p("newest"));
    const q = loadQueue("s2");
    expect(q).toHaveLength(MAX_QUEUE);
    expect(q[q.length - 1].idempotencyKey).toBe("newest");
    expect(q[0].idempotencyKey).toBe("k1"); // k0 (oldest) dropped
  });
});
