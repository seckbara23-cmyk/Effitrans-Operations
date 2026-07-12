/**
 * Phase 4.0A — tenant-isolation hardening tests.
 * ---------------------------------------------------------------------------
 * Two guarantees for the multi-tenant transformation:
 *
 *  1. The scoping WRAPPER (lib/db/tenant-scope.ts) asserts a valid tenant and
 *     injects `.eq("tenant_id", …)` — verified against a fake client.
 *
 *  2. The LEAK GUARD statically proves every service-role (RLS-bypassing) read
 *     of a tenant-scoped table is tenant-filtered. The service role has NO RLS
 *     backstop, so a forgotten `.eq("tenant_id", …)` is a silent cross-tenant
 *     leak. This test fails CI the moment such a read is introduced.
 *
 * The guard is deliberately conservative: it only inspects `.select()` READS on
 * the admin client (writes filter by UUID pk; RLS-client reads are backstopped
 * by RLS). Legitimate unscoped reads (e.g. fetch-by-unique-id) are enumerated in
 * KNOWN_UNSCOPED_READS with a reason, so every exception is explicit + reviewed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertTenantId, scopedFrom } from "@/lib/db/tenant-scope";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";

const TENANT_A = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// 1. Wrapper behaviour
// ---------------------------------------------------------------------------
describe("assertTenantId", () => {
  it("accepts a well-formed uuid", () => {
    expect(() => assertTenantId(TENANT_A)).not.toThrow();
  });
  it.each([undefined, null, "", "   ", "not-a-uuid", "1234"])("throws on %p", (bad) => {
    expect(() => assertTenantId(bad as string | null | undefined)).toThrow(/tenant id/);
  });
});

describe("scopedFrom", () => {
  function fakeAdmin() {
    const calls: Array<{ table: string; columns?: string; eqCol?: string; eqVal?: unknown }> = [];
    const admin = {
      from(table: string) {
        return {
          select(columns?: string) {
            const q = {
              eq(eqCol: string, eqVal: unknown) {
                calls.push({ table, columns, eqCol, eqVal });
                return q;
              },
            };
            return q;
          },
        };
      },
    };
    return { admin, calls };
  }

  it("injects .eq('tenant_id', tenantId) on the select", () => {
    const { admin, calls } = fakeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scopedFrom(admin as any, "invoice", TENANT_A).select("id, status");
    expect(calls).toEqual([{ table: "invoice", columns: "id, status", eqCol: "tenant_id", eqVal: TENANT_A }]);
  });

  it("refuses a non-tenant-scoped table", () => {
    const { admin } = fakeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => scopedFrom(admin as any, "permission" as never, TENANT_A)).toThrow(/tenant-scoped table/);
  });

  it("refuses a missing tenant id before querying", () => {
    const { admin, calls } = fakeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => scopedFrom(admin as any, "invoice", "").select("id")).toThrow(/tenant id/);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Static leak guard
// ---------------------------------------------------------------------------

/**
 * Legitimate admin-client reads of a tenant-scoped table that are NOT filtered
 * by tenant_id, with the reason each is safe. Keyed by `<relPath>::<table>`.
 * Adding an entry is a deliberate, reviewable exception — prefer scoping the
 * read (or `scopedFrom`) instead.
 */
const KNOWN_UNSCOPED_READS: Record<string, string> = {
  // --- Self-identity lookups by auth.users id (globally unique; no tenant
  //     context to filter on — the read RESOLVES which identity/tenant the
  //     caller is). Safe: an auth id maps to exactly one identity row.
  "lib/auth/oauth.ts::client_user": "self identity lookup by auth id (orphan-cleanup gate)",
  "lib/auth/password-reset.ts::app_user": "self staff lookup by auth id to gate recovery",
  "lib/portal/actions.ts::client_user": "self portal identity lookup by auth id",
  "lib/portal/oauth.ts::app_user": "self identity lookup by auth id (orphan-cleanup gate)",
  "lib/portal/password-change.ts::client_user": "self portal identity lookup by auth id",
  "lib/portal/password-reset.ts::client_user": "self portal identity lookup by auth id",
  "lib/customer-notify/actions.ts::client_user": "self portal identity lookup by auth id (prefs)",

  // --- Child/related row fetched by unique id AFTER its parent was tenant-
  //     verified in the same action. Safe: the id is a UUID FK to a row already
  //     proven to belong to the caller's tenant.
  "lib/comms/actions.ts::invoice_line": "invoice_id already tenant-verified above (invoice fetched with tenant filter)",
  "lib/comms/actions.ts::client": "client_id from a tenant-verified client_user",
  "lib/customs/actions.ts::customs_record": "file_id tenant-verified above; customs_record is 1:1 by file_id",
  "lib/customs/service.ts::shipment": "fileId gated by isFileVisible (tenant-scoped); shipment is 1:1 by file_id",
  "lib/driver/actions.ts::transport_record": "transport_id from the driver's own loaded session; lookup by unique id",
  "lib/files/actions.ts::customs_record": "file id tenant-verified above; customs_record by file_id",
  "lib/finance/intent-actions.ts::invoice": "invoice_id from a tenant-verified payment_intent",
  "lib/tasks/actions.ts::task": "task id already authorized/updated above; unique-id read for notification meta",
  "lib/transport/actions.ts::transport_record": "fileId tenant-verified above; transport_record is 1:1 by file_id",
  "lib/portal/self-service-actions.ts::audit_log": "rate-limit read scoped by owned fileId + own client_user_id (ownership verified)",

  // --- Dual-identity guard: an intentional GLOBAL staff-email lookup (auth
  //     emails are globally unique; a staff email in ANY tenant blocks portal
  //     creation). Tenant-scoping this would defeat its purpose.
  "lib/portal/admin-actions.ts::app_user": "dual-identity guard: intentional global staff-email lookup",
};

const LIB_DIR = fileURLToPath(new URL("../lib", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Replace comment characters with spaces, preserving offsets + newlines. */
function blankComments(src: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1] ?? "";
    if (state === "code") {
      if (c === "/" && d === "/") { out += "  "; i++; state = "line"; continue; }
      if (c === "/" && d === "*") { out += "  "; i++; state = "block"; continue; }
      if (c === "'") { out += c; state = "sq"; continue; }
      if (c === '"') { out += c; state = "dq"; continue; }
      if (c === "`") { out += c; state = "tpl"; continue; }
      out += c; continue;
    }
    if (state === "line") { out += c === "\n" ? "\n" : " "; if (c === "\n") state = "code"; continue; }
    if (state === "block") {
      if (c === "*" && d === "/") { out += "  "; i++; state = "code"; continue; }
      out += c === "\n" ? "\n" : " "; continue;
    }
    // string states: keep content so table literals survive; skip escapes.
    out += c;
    if (c === "\\") { out += d; i++; continue; }
    if (state === "sq" && c === "'") state = "code";
    else if (state === "dq" && c === '"') state = "code";
    else if (state === "tpl" && c === "`") state = "code";
  }
  return out;
}

/** From index of "(", return index just past the matching ")", string-aware. */
function skipParens(text: string, i: number): number {
  let depth = 0;
  let state: "code" | "sq" | "dq" | "tpl" = "code";
  for (; i < text.length; i++) {
    const c = text[i];
    if (state === "code") {
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      else if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) return i + 1; }
    } else {
      if (c === "\\") { i++; continue; }
      if (state === "sq" && c === "'") state = "code";
      else if (state === "dq" && c === '"') state = "code";
      else if (state === "tpl" && c === "`") state = "code";
    }
  }
  return text.length;
}

/** From index of "<", return index just past the matching ">". */
function skipAngles(text: string, i: number): number {
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") { depth--; if (depth === 0) return i + 1; }
  }
  return text.length;
}

/** Given the start of a `.from(...)` read, return the whole method chain text. */
function extractChain(text: string, fromStart: number): string {
  // advance to the "(" of `.from(` and skip its balanced parens
  const openParen = text.indexOf("(", fromStart);
  let p = skipParens(text, openParen);
  // consume subsequent `.method<generics>(args)` links across whitespace/newlines
  for (;;) {
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== ".") break;
    p++;
    while (p < text.length && /[\w$]/.test(text[p])) p++;
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] === "<") { p = skipAngles(text, p); while (p < text.length && /\s/.test(text[p])) p++; }
    if (text[p] === "(") p = skipParens(text, p);
    else break;
  }
  return text.slice(fromStart, p);
}

const CLIENT_GETTERS = /(getAdminSupabaseClient|getServerSupabaseClient|getBrowserSupabaseClient)/;

type Violation = { file: string; line: number; table: string };

function scanFile(absPath: string): Violation[] {
  const raw = readFileSync(absPath, "utf8");
  if (!raw.includes("getAdminSupabaseClient")) return [];
  const rel = relative(REPO_DIR, absPath).replace(/\\/g, "/");
  const text = blankComments(raw);

  // All client-var assignments, in order: which var holds which client kind.
  const assigns: Array<{ index: number; name: string; admin: boolean }> = [];
  const aRe = /const\s+(\w+)\s*=\s*(?:await\s+)?(getAdminSupabaseClient|getServerSupabaseClient|getBrowserSupabaseClient)\s*\(/g;
  for (let m = aRe.exec(text); m; m = aRe.exec(text)) {
    assigns.push({ index: m.index, name: m[1], admin: m[2] === "getAdminSupabaseClient" });
  }
  const nearestIsAdmin = (name: string, at: number): boolean => {
    let best: { index: number; admin: boolean } | null = null;
    for (const a of assigns) if (a.name === name && a.index < at && (!best || a.index > best.index)) best = a;
    return best?.admin ?? false;
  };

  const violations: Violation[] = [];
  const consider = (fromStart: number, receiverAdmin: boolean, table: string) => {
    if (!TENANT_SCOPED_TABLES.has(table)) return;
    if (!receiverAdmin) return;
    const chain = extractChain(text, fromStart);
    if (!/\.select\s*\(/.test(chain)) return; // not a read (write/rpc)
    if (/\.(insert|update|delete|upsert)\s*\(/.test(chain)) return; // write-with-returning, not a read
    if (/tenant_id/.test(chain)) return; // tenant-scoped
    if (KNOWN_UNSCOPED_READS[`${rel}::${table}`]) return; // reviewed exception
    const line = text.slice(0, fromStart).split("\n").length;
    violations.push({ file: rel, line, table });
  };

  // `<var>.from("table")`
  const vRe = /\b(\w+)\s*\.from\(\s*["']([a-z_]+)["']\s*\)/g;
  for (let m = vRe.exec(text); m; m = vRe.exec(text)) {
    if (CLIENT_GETTERS.test(m[1])) continue; // handled by the inline pass
    consider(m.index, nearestIsAdmin(m[1], m.index), m[2]);
  }
  // inline `getAdminSupabaseClient().from("table")`
  const iRe = /getAdminSupabaseClient\(\)\s*\.from\(\s*["']([a-z_]+)["']\s*\)/g;
  for (let m = iRe.exec(text); m; m = iRe.exec(text)) consider(m.index, true, m[1]);

  return violations;
}

describe("service-role tenant-scope guard", () => {
  const violations = walk(LIB_DIR).flatMap(scanFile);

  it("every admin-client read of a tenant-scoped table is tenant-filtered", () => {
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  reads "${v.table}" without a tenant_id filter`)
      .join("\n");
    expect(
      violations,
      violations.length === 0
        ? ""
        : `\nUnscoped service-role reads (potential cross-tenant leak):\n${report}\n\n` +
            `Fix: add .eq("tenant_id", tenant) or use scopedFrom(). If genuinely safe ` +
            `(e.g. fetch-by-unique-id), add "<file>::<table>": "<reason>" to KNOWN_UNSCOPED_READS.\n`,
    ).toHaveLength(0);
  });

  it("keeps the tenant-scoped table registry non-empty (sanity)", () => {
    expect(TENANT_SCOPED_TABLES.size).toBeGreaterThan(20);
  });
});
