/**
 * REF-1-HARDEN (F3) — a failed audit write must not leave an uploaded document
 * behind. EXECUTED, not read.
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS PINS. `writeAudit` throws when the event cannot be written
 * (WES-9: a failed mandatory event aborts its action). The upload route called
 * it AFTER the insert and did not catch, so a thrown audit returned 500 while
 * the row and the stored object both survived — an uploaded document with no
 * record of who put it there, which is exactly what the audit trail exists to
 * make impossible.
 *
 * WHY THIS TEST EXECUTES RATHER THAN GREPS. Compensation is an outcome, not a
 * shape: "the row is gone and the object is gone" cannot be asserted by reading
 * source. So the module boundaries are mocked — the session, the permissions,
 * the admin client and the audit writer — and the REAL route runs against an
 * in-memory stand-in. Every claim below is the route's own behaviour. The
 * pattern is `tests/step20-billing-atomicity-01.test.ts`'s.
 *
 * ORDER MATTERS, AND IS ASSERTED. The row is deleted before the object: a row
 * with no object is a broken link an operator can see and fix, while an object
 * with no row is a file nobody can see, delete or account for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-00000000aa02";

/** What the fake world recorded. */
const world: {
  rows: Array<Record<string, unknown>>;
  objects: string[];
  deletedRowIds: string[];
  removedPaths: string[];
  auditCalls: number;
  auditThrows: boolean;
  /** Every mutation, in order, so the compensation sequence is checkable. */
  log: string[];
} = {
  rows: [], objects: [], deletedRowIds: [], removedPaths: [],
  auditCalls: 0, auditThrows: false, log: [],
};

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    id: ACTOR, tenantId: TENANT, email: "chief@test.local", isSystemAdmin: false,
    roles: ["CHIEF_OF_TRANSIT"],
  }),
}));

vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => ["customs:reference:read", "customs:reference:publish"],
  hasPermission: (perms: string[], code: string) => perms.includes(code),
}));

vi.mock("@/lib/audit/log", () => ({
  writeAudit: async () => {
    world.auditCalls += 1;
    world.log.push("audit");
    if (world.auditThrows) throw new Error("[audit] failed to write audit event");
  },
}));

vi.mock("@/lib/supabase/admin", () => {
  const table = (name: string) => ({
    insert(row: Record<string, unknown>) {
      return {
        select: () => ({
          single: async () => {
            world.rows.push(row);
            world.log.push(`insert:${name}`);
            return { data: { id: row.id }, error: null };
          },
        }),
      };
    },
    delete() {
      const filters: Record<string, unknown> = {};
      // A PLAIN THENABLE, not a Promise carrying an overridden `then`.
      // `await` resolves a native promise through PromiseResolve, which returns
      // it unchanged and never consults an own `then` — so the first version of
      // this mock silently skipped the delete. PostgREST's real builder is a
      // plain thenable too, so this is the faithful shape.
      const self: Record<string, unknown> = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return self;
        },
        then(res: (v: unknown) => unknown) {
          const id = String(filters.id ?? "");
          if (!world.deletedRowIds.includes(id)) {
            world.deletedRowIds.push(id);
            world.rows = world.rows.filter((r) => r.id !== id);
            world.log.push(`delete:${name}`);
          }
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return self;
    },
  });

  return {
    getAdminSupabaseClient: () => ({
      from: (name: string) => table(name),
      storage: {
        from: () => ({
          async upload(path: string) {
            world.objects.push(path);
            world.log.push("upload");
            return { error: null };
          },
          async remove(paths: string[]) {
            world.removedPaths.push(...paths);
            world.objects = world.objects.filter((o) => !paths.includes(o));
            world.log.push("remove");
            return { error: null };
          },
        }),
      },
    }),
  };
});

/** A valid PDF: the route validates the magic number for real. */
function pdf(size = 4096): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 0);
  return b;
}

async function post(): Promise<Response> {
  const { POST } = await import("@/app/api/customs/reference/upload/route");
  const form = new FormData();
  form.set("category", "LEGISLATION");
  form.set("title", "Code des douanes");
  form.set("sourceAuthority", "Direction Générale des Douanes");
  form.set("referenceCode", "CODE-DOUANES");
  form.set("file", new File([pdf()], "doc.pdf", { type: "application/pdf" }));
  return POST(new Request("http://localhost/api/customs/reference/upload", {
    method: "POST",
    body: form,
  }));
}

beforeEach(() => {
  world.rows = []; world.objects = []; world.deletedRowIds = [];
  world.removedPaths = []; world.auditCalls = 0; world.auditThrows = false; world.log = [];
});
afterEach(() => vi.clearAllMocks());

describe("F3 — the audit failure path", () => {
  it("1 — when the audit lands, the document is kept and nothing is removed", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    // Quarantined, as always: a successful upload grants no consultability.
    expect(body.status).toBe("QUARANTINE");

    expect(world.rows).toHaveLength(1);
    expect(world.objects).toHaveLength(1);
    expect(world.auditCalls).toBe(1);
    expect(world.deletedRowIds).toEqual([]);
    expect(world.removedPaths).toEqual([]);
    expect(world.log).toEqual(["upload", "insert:customs_reference_document", "audit"]);
  });

  it("2 — when the audit throws, the row AND the object are removed", async () => {
    world.auditThrows = true;
    const res = await post();

    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toEqual({ error: "audit_failed" });

    // Nothing survives: no document anyone could consult, and no orphan blob.
    expect(world.rows).toHaveLength(0);
    expect(world.objects).toHaveLength(0);
    expect(world.deletedRowIds).toHaveLength(1);
    expect(world.removedPaths).toHaveLength(1);
  });

  it("3 — the row is deleted BEFORE the object", async () => {
    world.auditThrows = true;
    await post();
    // A row with no object is visible and fixable; an object with no row is
    // unaccountable. So the order is not incidental.
    expect(world.log).toEqual([
      "upload",
      "insert:customs_reference_document",
      "audit",
      "delete:customs_reference_document",
      "remove",
    ]);
  });

  it("4 — the compensated path never reports success to the caller", async () => {
    world.auditThrows = true;
    const res = await post();
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBeUndefined();
    expect(body.error).toBe("audit_failed");
  });

  it("5 — the stored object is keyed by tenant and document id, never the filename", async () => {
    await post();
    expect(world.objects).toHaveLength(1);
    expect(world.objects[0]).toMatch(
      new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(world.objects[0]).not.toContain("doc.pdf");
  });
});
