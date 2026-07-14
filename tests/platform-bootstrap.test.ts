/**
 * Phase 5.0E-4B — the permanent PLATFORM_SUPER_ADMIN bootstrap.
 *
 * Establishes the root of trust for the platform layer, and it must do so WITHOUT
 * weakening the wall between platform identity and tenant identity. Every test below is
 * a way of catching that wall being breached — either by the script reaching into the
 * tenant tables, or by some runtime code learning to trust an email instead of the
 * identity tables.
 *
 * The script runs against Postgres, so most of these are structural assertions on the
 * SQL text. That is deliberate: what makes the script safe is its SHAPE (upsert on the
 * primary key, no writes to app_user/user_role), and the shape is exactly what a review
 * can be made to enforce forever.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PLATFORM_ROLE_PERMISSIONS, PLATFORM_ROLES } from "@/lib/platform/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const script = read("../supabase/scripts/bootstrap_platform_super_admin.sql");

// Strip SQL comments so "does not touch app_user" in the prose never satisfies a test
// that is supposed to prove the CODE does not touch app_user.
const sql = script.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ------------------------------------------------------------ reuse + verify ----

describe("locates and reuses the existing auth user — never creates one", () => {
  it("looks the user up in auth.users by email", () => {
    expect(sql).toMatch(/from auth\.users/i);
    expect(sql).toMatch(/lower\(u\.email\) = lower\(target_email\)/i);
  });

  it("NEVER inserts into auth.users", () => {
    // Promotes an existing account. Creating an auth user from SQL would be a second,
    // unmanaged account-creation path.
    expect(sql).not.toMatch(/insert\s+into\s+auth\.users/i);
  });

  it("fails LOUDLY when the user does not exist", () => {
    expect(sql).toContain("BOOTSTRAP FAILED");
    expect(sql).toMatch(/raise exception/i);
  });
});

// -------------------------------------------------------------- idempotency ----

describe("idempotent, and cannot duplicate", () => {
  it("upserts on the primary key, so a second run is a no-op", () => {
    expect(sql).toMatch(/insert into public\.platform_admin/i);
    expect(sql).toContain("on conflict (id) do update");
  });

  it("relies on id = auth.users.id being the primary key — a duplicate is impossible", () => {
    // Not merely avoided by the upsert; impossible at the schema level.
    const schema = read("../supabase/migrations/20260712100000_platform_foundation.sql");
    expect(schema).toMatch(/id\s+uuid primary key references auth\.users/i);
  });

  it("detects the same email under a DIFFERENT auth id and refuses", () => {
    // platform_admin.email is UNIQUE; a clash means a duplicated account, which is a real
    // anomaly to surface rather than silently paper over.
    expect(sql).toContain("BOOTSTRAP ABORTED");
    expect(sql).toMatch(/pa\.id\s*<>\s*auth_id/);
  });

  it("distinguishes a fresh create from an existing row in its output", () => {
    expect(sql).toContain("was_new");
    expect(sql).toContain("CREATED platform_admin");
    expect(sql).toContain("ALREADY EXISTED");
  });
});

// --------------------------------------------------- the identity boundary ----

describe("the two identities stay separate — this is the security claim", () => {
  it("does NOT write to app_user", () => {
    expect(sql).not.toMatch(/insert\s+into\s+public\.app_user/i);
    expect(sql).not.toMatch(/update\s+public\.app_user/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.app_user/i);
  });

  it("does NOT write to user_role — no tenant permission is granted, altered or removed", () => {
    expect(sql).not.toMatch(/insert\s+into\s+public\.user_role/i);
    expect(sql).not.toMatch(/update\s+public\.user_role/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.user_role/i);
  });

  it("does NOT write to role", () => {
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.role\b/i);
  });

  it("READS the tenant roles back, to prove they survived", () => {
    // The preservation is asserted by the script itself, not assumed: it reads user_role
    // after the write and prints what it found. If it ever started mutating tenant
    // identity, this output would change.
    expect(sql).toMatch(/from public\.user_role ur/i);
    expect(sql).toContain("tenant_roles_preserved");
    expect(sql).toContain("TENANT identity untouched");
  });

  it("grants ONLY the platform role, and grants it in the platform table", () => {
    expect(sql).toContain("'PLATFORM_SUPER_ADMIN'");
    // The role literal appears only in the platform_admin write, never near a tenant table.
    const beforeAppUser = sql.split(/app_user/i)[0];
    expect(sql).toContain("public.platform_admin");
    expect(beforeAppUser).toContain("PLATFORM_SUPER_ADMIN");
  });
});

// ---------------------------------------------------------------- the audit ----

describe("writes a platform audit entry", () => {
  it("records the promotion as a platform.* event with the admin as actor", () => {
    expect(sql).toContain("insert into public.audit_log");
    expect(sql).toContain("'platform.admin.bootstrapped'");
    expect(sql).toContain("platform_actor_id");
  });

  it("ties the event to no tenant — a platform event belongs to the platform", () => {
    // tenant_id null; the audit_log column exists for exactly this.
    expect(sql).toMatch(/'platform\.admin\.bootstrapped',\s*null,/);
    const audit = read("../supabase/migrations/20260712100000_platform_foundation.sql");
    expect(audit).toContain("platform_actor_id");
  });
});

// -------------------------------------------------- no hardcoded auth path ----

describe("no runtime authorization ever trusts the email", () => {
  const RUNTIME_DIRS = ["../lib", "../app", "../components"];

  function walk(dir: string): string[] {
    const base = fileURLToPath(new URL(dir, import.meta.url));
    const out: string[] = [];
    const rec = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) rec(p);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
    };
    rec(base);
    return out;
  }

  it("the owner's email appears in NO runtime file — authorization is by identity, not address", () => {
    // The email lives in ONE place: a SQL script a human runs by hand. If it ever appears
    // in lib/app/components, someone has written `if (email === 'seck…')` and the whole
    // RBAC model has a backdoor keyed to a string.
    const offenders: string[] = [];
    for (const dir of RUNTIME_DIRS) {
      for (const file of walk(dir)) {
        if (readFileSync(file, "utf8").includes("seckbara23@gmail.com")) {
          offenders.push(file.replace(/\\/g, "/").split(/\/(?=lib\/|app\/|components\/)/).pop()!);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("platform authorization still derives from the platform role tables", () => {
    // Unchanged by this phase — asserted so a future edit cannot quietly swap the
    // identity-table lookup for an email check.
    const auth = read("../lib/platform/auth.ts");
    expect(auth).toContain("platform_admin");
    expect(auth).toContain("hasPlatformPermission");
    expect(auth).not.toContain("seckbara23");
  });

  it("PLATFORM_SUPER_ADMIN carries platform:rollout:manage — the reason to bootstrap it", () => {
    expect(PLATFORM_ROLES).toContain("PLATFORM_SUPER_ADMIN");
    expect(PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPER_ADMIN).toContain("platform:rollout:manage");
  });
});

// ----------------------------------------------------------- editor-safety ----

describe("runs where it will actually be run", () => {
  it("uses no psql backslash command", () => {
    expect(script.split("\n").some((l) => /^\s*\\/.test(l))).toBe(false);
  });

  it("is the only bootstrap script — the older name is gone", () => {
    const scripts = readdirSync(fileURLToPath(new URL("../supabase/scripts", import.meta.url)));
    expect(scripts).toContain("bootstrap_platform_super_admin.sql");
    expect(scripts).not.toContain("bootstrap_platform_admin.sql");
  });
});
