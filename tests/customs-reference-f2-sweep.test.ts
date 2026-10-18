/**
 * REF-2 F-2 — the staging sweep. EXECUTED, not read.
 * ---------------------------------------------------------------------------
 * Two halves, and both are necessary.
 *
 * The RULE is pure, so its boundaries are tested directly: an object exactly at
 * the threshold, one in the future, one whose timestamp is missing or
 * unparseable, one whose name this code did not write. Every uncertainty must
 * answer "keep it" — a sweep that deletes what it cannot date is worse than the
 * debris it removes.
 *
 * The BEHAVIOUR is an outcome, not a shape: "a publisher can still get a ticket
 * when the sweep fails" cannot be asserted by reading source. So the module
 * boundaries are mocked — the session, the permissions and the admin client —
 * and the REAL route runs against an in-memory stand-in whose storage can be
 * told to fail. The pattern is `tests/customs-reference-audit-compensation.test.ts`'s.
 *
 * `@/lib/observability/report` is deliberately NOT mocked: its sanitisation is
 * part of what these tests check, so the real reporter runs and its output is
 * captured from the console.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STAGING_TTL_HOURS,
  MAX_SWEEP_DELETIONS,
  SWEEP_LIST_LIMIT,
  isAbandonedStagingObject,
  stagingPrefix,
  stagingTtlHours,
} from "@/lib/customs/reference/staging-sweep";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-00000000aa03";
/** Deliberately not a uuid the tenant shares, so log assertions can tell them apart. */
const OBJECT_A = "11111111-2222-4333-8444-555555555551";
const OBJECT_B = "11111111-2222-4333-8444-555555555552";
const FAKE_TOKEN = "FAKE-UPLOAD-TOKEN-NOT-A-CREDENTIAL";

type Entry = { name: string; created_at: string | null; metadata: { size: number } | null };

/** What the fake world holds and recorded. */
const world: {
  staged: Entry[];
  listCalls: Array<{ prefix: string; limit?: number; sortBy?: { column?: string; order?: string } }>;
  removeCalls: string[][];
  listThrows: boolean;
  removeThrows: boolean;
  listReturnsError: boolean;
  auditCalls: number;
  /** The caller's effective permissions, so a reader can be tried at this door. */
  permissions: string[];
} = {
  staged: [], listCalls: [], removeCalls: [],
  listThrows: false, removeThrows: false, listReturnsError: false, auditCalls: 0,
  permissions: ["customs:reference:read", "customs:reference:publish"],
};

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    id: ACTOR, tenantId: TENANT, email: "chief@test.local", isSystemAdmin: false,
    roles: ["CHIEF_OF_TRANSIT"],
  }),
}));

vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => world.permissions,
  hasPermission: (perms: string[], code: string) => perms.includes(code),
}));

// Mocked only so an unexpected audit write can be DETECTED. The sweep must not
// write one, and REF-2 test 38 already forbids one in this route.
vi.mock("@/lib/audit/log", () => ({
  writeAudit: async () => {
    world.auditCalls += 1;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabaseClient: () => ({
    storage: {
      from: () => ({
        async list(prefix: string, options?: { limit?: number; sortBy?: { column?: string; order?: string } }) {
          world.listCalls.push({ prefix, limit: options?.limit, sortBy: options?.sortBy });
          if (world.listThrows) throw new Error("storage list unavailable");
          if (world.listReturnsError) return { data: null, error: { message: "list refused" } };
          const rows = [...world.staged];
          // Faithful to the request: honour the sort the sweep asks for.
          if (options?.sortBy?.column === "created_at") {
            rows.sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
          }
          return { data: rows.slice(0, options?.limit ?? 100), error: null };
        },
        async remove(paths: string[]) {
          world.removeCalls.push(paths);
          if (world.removeThrows) throw new Error("storage remove unavailable");
          world.staged = world.staged.filter((o) => !paths.includes(`${TENANT}/_staging/${o.name}`));
          return { data: [], error: null };
        },
        async createSignedUploadUrl(path: string) {
          return {
            data: { path, token: FAKE_TOKEN, signedUrl: `http://localhost/upload/${path}?token=${FAKE_TOKEN}` },
            error: null,
          };
        },
      }),
    },
  }),
}));

function entry(id: string, ageHours: number, name?: string): Entry {
  return {
    name: name ?? `${id}.pdf`,
    created_at: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    metadata: { size: 4096 },
  };
}

/** Ask for a ticket through the real route. */
async function ticket(): Promise<Response> {
  const { POST } = await import("@/app/api/customs/reference/upload-url/route");
  return POST(new Request("http://localhost/api/customs/reference/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "LEGISLATION",
      title: "Tarif Extérieur Commun",
      sourceAuthority: "Direction Générale des Douanes",
      referenceCode: "TEC-F2",
      declaredSize: 4096,
    }),
  }));
}

const savedEnv = { ...process.env };

beforeEach(() => {
  world.staged = []; world.listCalls = []; world.removeCalls = [];
  world.listThrows = false; world.removeThrows = false; world.listReturnsError = false;
  world.auditCalls = 0;
  world.permissions = ["customs:reference:read", "customs:reference:publish"];
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

// ===========================================================================
describe("F-2 — the retention threshold cannot be shortened by accident", () => {
  it("1 — defaults to 24 hours when the variable is absent, blank or nonsense", () => {
    expect(DEFAULT_STAGING_TTL_HOURS).toBe(24);
    expect(stagingTtlHours({})).toBe(24);
    for (const raw of ["", "   ", "soon", "24h", "NaN", "-1", "1.5", "1e3x"]) {
      expect(stagingTtlHours({ CUSTOMS_STAGING_TTL_HOURS: raw }), raw).toBe(24);
    }
  });

  it("2 — honours an explicit integer, including the 0 that CI needs", () => {
    expect(stagingTtlHours({ CUSTOMS_STAGING_TTL_HOURS: "0" })).toBe(0);
    expect(stagingTtlHours({ CUSTOMS_STAGING_TTL_HOURS: "1" })).toBe(1);
    expect(stagingTtlHours({ CUSTOMS_STAGING_TTL_HOURS: " 72 " })).toBe(72);
  });
});

// ===========================================================================
describe("F-2 — every uncertainty answers 'keep it'", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z");
  const aged = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

  it("3 — an object past the threshold is abandoned; one short of it is not", () => {
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: aged(25) }, now, 24)).toBe(true);
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: aged(23) }, now, 24)).toBe(false);
  });

  it("4 — the boundary is inclusive, and exact", () => {
    // Exactly 24h old at a 24h threshold: old enough. One millisecond younger
    // is not, so the comparison cannot be a sloppy `>` or a rounded hour.
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: new Date(now - 24 * 3_600_000).toISOString() }, now, 24)).toBe(true);
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: new Date(now - 24 * 3_600_000 + 1).toISOString() }, now, 24)).toBe(false);
  });

  it("5 — a missing, blank or unparseable timestamp NEVER authorizes deletion", () => {
    for (const created of [null, undefined, "", "   ", "not-a-date", "yesterday"]) {
      expect(
        isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: created as string | null }, now, 0),
        String(created),
      ).toBe(false);
    }
  });

  it("6 — a timestamp in the future is a clock disagreement, not an old file", () => {
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: aged(-48) }, now, 0)).toBe(false);
    // …and it stays false even when the THRESHOLD is itself nonsense.
    // `stagingTtlHours` can never return a negative, but this function has to
    // be total: without its own age guard, `-30min >= -1h` is true and a
    // future-dated object would be deleted. This is the case that makes the
    // guard load-bearing rather than decorative.
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: aged(-0.5) }, now, -1)).toBe(false);
  });

  it("7 — only the name shape this code writes is ever considered", () => {
    const old = aged(99);
    for (const name of [
      undefined, null, "", "..", "../secret.pdf", "sub/dir.pdf",
      `${OBJECT_A}.PDF.exe`, `${OBJECT_A}`, `${OBJECT_A}.txt`,
      `${TENANT}/_staging/${OBJECT_A}.pdf`, "not-a-uuid.pdf",
    ]) {
      expect(
        isAbandonedStagingObject({ name: name as string | null, created_at: old }, now, 0),
        String(name),
      ).toBe(false);
    }
    // …and the shape it does write is accepted, upper or lower case.
    expect(isAbandonedStagingObject({ name: `${OBJECT_A}.pdf`, created_at: old }, now, 0)).toBe(true);
    expect(isAbandonedStagingObject({ name: `${OBJECT_A.toUpperCase()}.pdf`, created_at: old }, now, 0)).toBe(true);
  });
});

// ===========================================================================
describe("F-2 — the sweep runs at the door, bounded and tenant-scoped", () => {
  it("8 — it lists ONE page of this tenant's own prefix, oldest first", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [entry(OBJECT_A, 50), entry(OBJECT_B, 10)];

    expect((await ticket()).status).toBe(201);

    expect(world.listCalls).toHaveLength(1);
    expect(world.listCalls[0].prefix).toBe(stagingPrefix(TENANT));
    expect(world.listCalls[0].prefix).toBe(`${TENANT}/_staging`);
    expect(world.listCalls[0].limit).toBe(SWEEP_LIST_LIMIT);
    expect(world.listCalls[0].sortBy).toEqual({ column: "created_at", order: "asc" });
  });

  it("9 — every path it removes is rebuilt under this tenant's staging prefix", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    // A name that is NOT ours sits alongside two that are.
    world.staged = [entry(OBJECT_A, 50), entry("x", 50, "../../elsewhere.pdf"), entry(OBJECT_B, 40)];

    expect((await ticket()).status).toBe(201);

    expect(world.removeCalls).toHaveLength(1);
    const removed = world.removeCalls[0];
    expect(removed).toEqual([
      `${TENANT}/_staging/${OBJECT_A}.pdf`,
      `${TENANT}/_staging/${OBJECT_B}.pdf`,
    ]);
    for (const path of removed) expect(path.startsWith(`${TENANT}/_staging/`)).toBe(true);
    // The unrecognised name was left where it was, not guessed at.
    expect(removed.some((p) => p.includes("elsewhere"))).toBe(false);
    expect(removed.some((p) => p.includes(".."))).toBe(false);
  });

  it("10 — a fresh object is never swept, so a live upload is safe", async () => {
    delete process.env.CUSTOMS_STAGING_TTL_HOURS;   // the production default
    world.staged = [entry(OBJECT_A, 1), entry(OBJECT_B, 23)];

    expect((await ticket()).status).toBe(201);

    // Listed, considered, and kept.
    expect(world.listCalls).toHaveLength(1);
    expect(world.removeCalls).toEqual([]);
    expect(world.staged).toHaveLength(2);
  });

  it("11 — `remove` is never called with an empty array", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [];
    expect((await ticket()).status).toBe(201);
    expect(world.removeCalls).toEqual([]);
  });

  it("12 — no more than 50 objects go in one request, oldest first", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    // 60 candidates, each an hour older than the last.
    world.staged = Array.from({ length: 60 }, (_, i) =>
      entry(`11111111-2222-4333-8444-5555555555${String(i).padStart(2, "0")}`, 100 + i),
    );

    expect((await ticket()).status).toBe(201);

    expect(MAX_SWEEP_DELETIONS).toBe(50);
    expect(world.removeCalls).toHaveLength(1);
    expect(world.removeCalls[0]).toHaveLength(50);
    // The 50 OLDEST went: the last-created ten are the ones left behind.
    expect(world.staged).toHaveLength(10);
    const survivors = world.staged.map((o) => o.name);
    expect(survivors).toContain("11111111-2222-4333-8444-555555555500.pdf");
    expect(survivors).not.toContain("11111111-2222-4333-8444-555555555559.pdf");
  });
});

// ===========================================================================
describe("F-2 — a janitorial failure can never deny an authorized upload", () => {
  it("13 — the ticket is still issued when `list` throws", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.listThrows = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await ticket();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token).toBe(FAKE_TOKEN);

    // It did not pretend the failure away either: it reported it.
    expect(errors).toHaveBeenCalled();
    expect(world.removeCalls).toEqual([]);
  });

  it("14 — the ticket is still issued when `list` answers with an error", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.listReturnsError = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await ticket()).status).toBe(201);
    expect(world.removeCalls).toEqual([]);
  });

  it("15 — the ticket is still issued when `remove` throws", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [entry(OBJECT_A, 50)];
    world.removeThrows = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await ticket();
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(errors).toHaveBeenCalled();
    // The object survives a failed delete, which is the safe direction.
    expect(world.staged).toHaveLength(1);
  });
});

// ===========================================================================
describe("F-2 — the sweep leaks nothing and records nothing", () => {
  it("16 — it writes no audit event, and the route still writes none", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [entry(OBJECT_A, 50)];
    vi.spyOn(console, "info").mockImplementation(() => {});

    expect((await ticket()).status).toBe(201);
    expect(world.removeCalls[0]).toHaveLength(1);
    // A staging object is not a document. There is no entity to attach an event
    // to, and REF-2 test 38 forbids `writeAudit` in this route.
    expect(world.auditCalls).toBe(0);
  });

  it("17 — no token, signed URL or object name reaches the logs", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [entry(OBJECT_A, 50), entry(OBJECT_B, 30)];

    const lines: string[] = [];
    const sink = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    vi.spyOn(console, "info").mockImplementation(sink);
    vi.spyOn(console, "warn").mockImplementation(sink);
    vi.spyOn(console, "error").mockImplementation(sink);

    expect((await ticket()).status).toBe(201);

    const logged = lines.join("\n");
    // It said something useful…
    expect(logged).toContain("[customs-ref] staging sweep");
    expect(logged).toContain("removed=2");
    expect(logged).toContain(`tenant=${TENANT}`);
    // …without naming a single object, id, token or URL.
    expect(logged).not.toContain(OBJECT_A);
    expect(logged).not.toContain(OBJECT_B);
    expect(logged).not.toContain(".pdf");
    expect(logged).not.toContain(FAKE_TOKEN);
    expect(logged).not.toContain("http://localhost/upload/");
    expect(logged).not.toContain("_staging/");
  });

  it("18 — a clean prefix logs nothing at all", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.staged = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect((await ticket()).status).toBe(201);
    // A sweep that reclaimed nothing is not an operational event; a line on
    // every ticket request would bury the ones that matter.
    expect(info).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("F-2 — only a publisher can make the system delete anything", () => {
  it("19 — a READER is refused, and no listing or deletion is even attempted", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.permissions = ["customs:reference:read"];
    world.staged = [entry(OBJECT_A, 99)];

    const res = await ticket();
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([403, "forbidden"]);

    // The sweep sits BEHIND the publish check: a read-only account cannot
    // trigger a delete, not even indirectly and not even a harmless one.
    expect(world.listCalls).toEqual([]);
    expect(world.removeCalls).toEqual([]);
    expect(world.staged).toHaveLength(1);
  });

  it("20 — a DRIVER, holding neither permission, is refused the same way", async () => {
    process.env.CUSTOMS_STAGING_TTL_HOURS = "0";
    world.permissions = ["transport:execute"];
    world.staged = [entry(OBJECT_A, 99)];

    expect((await ticket()).status).toBe(403);
    expect(world.listCalls).toEqual([]);
    expect(world.removeCalls).toEqual([]);
    expect(world.staged).toHaveLength(1);
  });
});
