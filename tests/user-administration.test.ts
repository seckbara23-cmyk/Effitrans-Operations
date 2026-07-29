/**
 * Granular user administration + the staff password lifecycle (2026-07-29).
 *
 * Two defects, one of vocabulary and one of absence:
 *
 *   * ONE permission, `admin:users:manage`, gated everything — reading the
 *     directory, creating, archiving, and resending credentials. "May look at
 *     the staff list" could not be expressed without also granting "may archive
 *     users", so in practice only SYSTEM_ADMIN could hold any of it. Worst of
 *     all, the most dangerous act in the module — invalidating a live credential
 *     and minting a replacement — rode on the same token as listing users.
 *
 *   * `must_change_password` existed only for the customer portal. A staff
 *     member handed a temporary password could use it forever: nothing forced a
 *     change, nothing expired, and nothing recorded when the password last
 *     changed — so the directory could not answer the one question a Password
 *     Management panel exists to answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import {
  USER_ADMIN_PERMISSIONS,
  DEPRECATED_USER_ADMIN_UMBRELLA,
  userAdminCodes,
  canUserAdmin,
} from "@/lib/users/permissions";
import {
  TEMP_PASSWORD_REASONS,
  TEMP_PASSWORD_REASON_LABEL_FR,
  TEMP_PASSWORD_NOTE_MAX,
  DEFAULT_TEMP_PASSWORD_TTL_HOURS,
  PASSWORD_STATUS_LABEL_FR,
  validateTempPasswordReason,
  formatTempPasswordReason,
  tempPasswordTtlHours,
  tempPasswordExpiry,
  isTempPasswordExpired,
  evaluatePasswordGate,
  passwordStatus,
} from "@/lib/users/password-lifecycle";
import {
  ROLE_DEPARTMENTS,
  departmentOfRole,
  groupRolesByDepartment,
} from "@/lib/users/departments";
import { parseForwardedFor } from "@/lib/audit/request-ip";
import { followRedirects, type RouteContext } from "@/lib/auth/route-contract";
import { t } from "@/lib/i18n";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260729000001_user_administration_and_password_lifecycle.sql";
const GRANULAR = Object.values(USER_ADMIN_PERMISSIONS);
const perms = (key: string) => TENANT_ROLE_TEMPLATES.find((r) => r.key === key)?.permissions ?? [];

// ===========================================================================
describe("the permission family", () => {
  it("has exactly the seven ratified capabilities", () => {
    expect([...GRANULAR].sort()).toEqual([
      "admin:users:create",
      "admin:users:disable",
      "admin:users:read",
      "admin:users:reset_password",
      "admin:users:temp_password",
      "admin:users:unlock",
      "admin:users:update",
    ]);
  });

  it("every code is well-formed module:action[:scope] — the enforced convention", () => {
    // The repo's own gate permits [a-z_] only, which is why the ratified
    // hyphenated names became reset_password / temp_password.
    for (const p of GRANULAR) expect(p, p).toMatch(/^[a-z_]+:[a-z_]+(:[a-z_]+)?$/);
  });

  it("SYSTEM_ADMIN holds all seven", () => {
    for (const p of GRANULAR) expect(perms("SYSTEM_ADMIN"), p).toContain(p);
  });

  it("NO other role holds any of them — ratified: SYSTEM_ADMIN only at this stage", () => {
    for (const tpl of TENANT_ROLE_TEMPLATES) {
      if (tpl.key === "SYSTEM_ADMIN") continue;
      for (const p of GRANULAR) expect(tpl.permissions, `${tpl.key} / ${p}`).not.toContain(p);
    }
  });

  it("HR_OFFICER specifically does NOT get read access — explicitly deferred", () => {
    expect(perms("HR_OFFICER")).not.toContain("admin:users:read");
    // Its own registry permissions are untouched.
    expect(perms("HR_OFFICER")).toContain("hr:read");
  });
});

// ===========================================================================
describe("the deprecated umbrella is honoured, never revoked", () => {
  it("SYSTEM_ADMIN still holds admin:users:manage", () => {
    expect(perms("SYSTEM_ADMIN")).toContain(DEPRECATED_USER_ADMIN_UMBRELLA);
  });

  it("every capability accepts the granular code OR the umbrella, granular first", () => {
    for (const cap of Object.keys(USER_ADMIN_PERMISSIONS) as (keyof typeof USER_ADMIN_PERMISSIONS)[]) {
      expect(userAdminCodes(cap)).toEqual([USER_ADMIN_PERMISSIONS[cap], DEPRECATED_USER_ADMIN_UMBRELLA]);
    }
  });

  it("a tenant holding ONLY the umbrella still passes every gate", () => {
    // This is the whole point: migrations are applied by an operator, separately
    // from the deploy. Demanding the granular codes would lock an administrator
    // out of the very screen used to fix it.
    const legacy = [DEPRECATED_USER_ADMIN_UMBRELLA];
    for (const cap of Object.keys(USER_ADMIN_PERMISSIONS) as (keyof typeof USER_ADMIN_PERMISSIONS)[]) {
      expect(canUserAdmin(legacy, cap), cap).toBe(true);
    }
  });

  it("a tenant holding ONLY the granular codes also passes", () => {
    expect(canUserAdmin(["admin:users:temp_password"], "tempPassword")).toBe(true);
    expect(canUserAdmin(["admin:users:temp_password"], "unlock")).toBe(false);
  });

  it("holding nothing passes nothing — deny by default", () => {
    for (const cap of Object.keys(USER_ADMIN_PERMISSIONS) as (keyof typeof USER_ADMIN_PERMISSIONS)[]) {
      expect(canUserAdmin([], cap), cap).toBe(false);
    }
  });
});

// ===========================================================================
describe("the migration", () => {
  const sql = () => sqlCode(MIGRATION);

  it("adds all seven to the catalogue", () => {
    const s = sql();
    for (const p of GRANULAR) expect(s, p).toContain(`'${p}'`);
    expect(s).toContain("on conflict (code) do nothing");
  });

  it("grants WITHOUT a tenant filter, so every provisioned tenant receives them", () => {
    const s = sql();
    const grant = s.slice(s.indexOf("insert into public.role_permission"));
    expect(grant).toContain("where r.code = 'SYSTEM_ADMIN'");
    expect(grant).not.toMatch(/r\.tenant_id\s*=/);
  });

  it("revokes nothing and drops nothing", () => {
    const s = sql();
    expect(s).not.toMatch(/\brevoke\b/i);
    expect(s).not.toMatch(/\bdrop\b/i);
    expect(s).not.toMatch(/delete from public\.role_permission/i);
    expect(s).not.toMatch(/delete from public\.permission/i);
  });

  it("adds the three lifecycle columns, additively and idempotently", () => {
    const s = sql();
    for (const col of ["password_changed_at", "must_change_password", "temp_password_expires_at"]) {
      expect(s, col).toMatch(new RegExp(`add column if not exists\\s+${col}`));
    }
    expect(s).toContain("alter table public.app_user");
  });

  it("must_change_password defaults FALSE — the migration locks nobody out", () => {
    expect(sql()).toMatch(/must_change_password\s+boolean not null default false/);
  });

  it("does NOT backfill password_changed_at — an honest unknown, not a fabricated date", () => {
    const s = sql();
    expect(s).not.toMatch(/set\s+password_changed_at/i);
    expect(s).not.toMatch(/password_changed_at[^;]*default\s+now\(\)/i);
  });

  it("seed and templates agree — provisioning parity", () => {
    const seed = read("supabase/seed.sql");
    for (const p of GRANULAR) expect(seed, p).toContain(`'${p}'`);
  });
});

// ===========================================================================
describe("temporary-password expiry", () => {
  const now = new Date("2026-07-29T10:00:00.000Z");

  it("defaults to 24 hours", () => {
    expect(DEFAULT_TEMP_PASSWORD_TTL_HOURS).toBe(24);
    expect(tempPasswordTtlHours(undefined)).toBe(24);
    expect(tempPasswordTtlHours("")).toBe(24);
  });

  it("accepts a configured value", () => {
    expect(tempPasswordTtlHours("4")).toBe(4);
    expect(tempPasswordTtlHours(" 72 ")).toBe(72);
  });

  it("falls back rather than throwing or accepting nonsense", () => {
    // A typo in an env var must not take down authentication, and must never
    // silently produce a temporary password that lives for a year.
    for (const bad of ["abc", "0", "-5", "100000", "NaN"]) {
      expect(tempPasswordTtlHours(bad), bad).toBe(24);
    }
  });

  it("computes the expiry instant from the issue time", () => {
    expect(tempPasswordExpiry(now, 24)).toBe("2026-07-30T10:00:00.000Z");
    expect(tempPasswordExpiry(now, 1)).toBe("2026-07-29T11:00:00.000Z");
  });

  it("expires AT the boundary, not after it", () => {
    expect(isTempPasswordExpired("2026-07-29T10:00:00.000Z", now)).toBe(true);
    expect(isTempPasswordExpired("2026-07-29T10:00:00.001Z", now)).toBe(false);
  });

  it("a null expiry never expires — no temporary password is outstanding", () => {
    expect(isTempPasswordExpired(null, now)).toBe(false);
    expect(isTempPasswordExpired(undefined, now)).toBe(false);
  });

  it("an unreadable value never locks anyone out", () => {
    expect(isTempPasswordExpired("not-a-date", now)).toBe(false);
  });
});

// ===========================================================================
describe("the login gate", () => {
  const now = new Date("2026-07-29T10:00:00.000Z");

  it("passes an ordinary user through", () => {
    expect(evaluatePasswordGate({ mustChangePassword: false, tempPasswordExpiresAt: null, now })).toBe("ok");
    expect(evaluatePasswordGate({ now })).toBe("ok");
  });

  it("forces a change while the flag is set", () => {
    expect(
      evaluatePasswordGate({
        mustChangePassword: true,
        tempPasswordExpiresAt: "2026-07-30T10:00:00.000Z",
        now,
      }),
    ).toBe("must_change");
  });

  it("EXPIRY WINS over must_change — an expired credential is not exchangeable", () => {
    // Otherwise the change screen would let a dead temporary password be traded
    // for a permanent one, and the expiry would be decorative.
    expect(
      evaluatePasswordGate({
        mustChangePassword: true,
        tempPasswordExpiresAt: "2026-07-29T09:59:59.000Z",
        now,
      }),
    ).toBe("temp_expired");
  });

  it("the gate is its OWN query and fails open", () => {
    const g = code("lib/users/password-gate.ts");
    // A failure here must never present as a lockout: the gate adds a policy, it
    // does not authenticate. GoTrue already verified the password.
    expect(g).toContain('if (error || !data) return "ok"');
    expect(g).toMatch(/catch\s*\{\s*return "ok";/);
  });

  it("is NOT folded into getCurrentUser — an unapplied migration would lock out the tenant", () => {
    const cu = code("lib/auth/current-user.ts");
    for (const col of ["must_change_password", "temp_password_expires_at"]) {
      expect(cu, col).not.toContain(col);
    }
  });

  it("the staff guard consults it, after the driver check and before rendering", () => {
    const g = code("lib/auth/require-user.ts");
    expect(g).toContain("getStaffPasswordGate(user.id)");
    expect(g).toContain("passwordGateRedirect(");
    expect(g.indexOf("isDriverOnly")).toBeLessThan(g.indexOf("getStaffPasswordGate"));
  });

  it("routes to /auth paths, which are public — so the redirect cannot loop", () => {
    const g = code("lib/users/password-gate.ts");
    expect(g).toContain('"/auth/change-password"');
    expect(g).toContain('"/auth/password-expired"');
    const mw = code("lib/supabase/middleware.ts");
    expect(mw).toContain('pathname.startsWith("/auth")');
  });
});

// ===========================================================================
describe("no redirect loop, proven by the contract", () => {
  const STAFF_MUST_CHANGE: RouteContext = { identity: "staff", staffMustChangePassword: true };
  const STAFF_EXPIRED: RouteContext = { identity: "staff", staffPasswordExpired: true };

  it("a flagged staff user reaching /dashboard lands on the change screen", () => {
    const r = followRedirects("/dashboard", STAFF_MUST_CHANGE);
    expect(r.looped).toBe(false);
    expect(r.terminal).toBe("/auth/change-password");
  });

  it("an expired staff user lands on the terminal notice, not the change screen", () => {
    const r = followRedirects("/dashboard", STAFF_EXPIRED);
    expect(r.looped).toBe(false);
    expect(r.terminal).toBe("/auth/password-expired");
  });

  it("expiry wins even when both flags are set", () => {
    const r = followRedirects("/files", {
      identity: "staff",
      staffMustChangePassword: true,
      staffPasswordExpired: true,
    });
    expect(r.terminal).toBe("/auth/password-expired");
  });

  it("no staff × path combination loops", () => {
    const paths = ["/", "/login", "/dashboard", "/files", "/users", "/auth/change-password", "/auth/password-expired", "/auth/callback"];
    for (const path of paths) {
      for (const ctx of [STAFF_MUST_CHANGE, STAFF_EXPIRED]) {
        const r = followRedirects(path, ctx, 12);
        expect(r.looped, `LOOP: ${path} → ${r.chain.join(" → ")}`).toBe(false);
      }
    }
  });

  it("an ordinary staff user is unaffected", () => {
    expect(followRedirects("/dashboard", { identity: "staff" }).terminal).toBe("/dashboard");
  });
});

// ===========================================================================
describe("the mandatory reason", () => {
  it("offers exactly the four ratified motives, each with a French label", () => {
    expect([...TEMP_PASSWORD_REASONS]).toEqual([
      "FORGOT_PASSWORD", "LOCKED_ACCOUNT", "NEW_WORKSTATION", "OTHER",
    ]);
    for (const r of TEMP_PASSWORD_REASONS) {
      expect(TEMP_PASSWORD_REASON_LABEL_FR[r].length, r).toBeGreaterThan(4);
    }
  });

  it("refuses a missing or unrecognised reason", () => {
    expect(validateTempPasswordReason({})).toBe("reason_required");
    expect(validateTempPasswordReason({ reason: "  " })).toBe("reason_required");
    expect(validateTempPasswordReason({ reason: "BECAUSE" })).toBe("reason_invalid");
  });

  it("OTHER without a note is refused — it looks like an answer but is not one", () => {
    expect(validateTempPasswordReason({ reason: "OTHER" })).toBe("reason_note_required");
    expect(validateTempPasswordReason({ reason: "OTHER", note: "   " })).toBe("reason_note_required");
    expect(validateTempPasswordReason({ reason: "OTHER", note: "poste volé" })).toBeNull();
  });

  it("a listed reason needs no note", () => {
    for (const r of ["FORGOT_PASSWORD", "LOCKED_ACCOUNT", "NEW_WORKSTATION"]) {
      expect(validateTempPasswordReason({ reason: r }), r).toBeNull();
    }
  });

  it("bounds the note so it cannot become a data sink", () => {
    expect(validateTempPasswordReason({ reason: "FORGOT_PASSWORD", note: "x".repeat(TEMP_PASSWORD_NOTE_MAX) })).toBeNull();
    expect(validateTempPasswordReason({ reason: "FORGOT_PASSWORD", note: "x".repeat(TEMP_PASSWORD_NOTE_MAX + 1) }))
      .toBe("reason_note_too_long");
  });

  it("formats the audit string with the code, plus the note when given", () => {
    expect(formatTempPasswordReason("FORGOT_PASSWORD")).toBe("FORGOT_PASSWORD");
    expect(formatTempPasswordReason("OTHER", " poste volé ")).toBe("OTHER: poste volé");
  });

  it("every reason error is translated for the operator", () => {
    const errors = t.users.errors as Record<string, string>;
    for (const c of ["reason_required", "reason_invalid", "reason_note_required", "reason_note_too_long", "reset_failed"]) {
      expect(errors[c], c).toBeTruthy();
    }
  });
});

// ===========================================================================
describe("password status, as an administrator reads it", () => {
  const now = new Date("2026-07-29T10:00:00.000Z");

  it("no recorded change reads UNKNOWN, never « jamais modifié »", () => {
    // Every user predating the columns is here. Saying "unknown" is more useful
    // — and more honest — than asserting a change that may never have happened.
    expect(passwordStatus({ passwordChangedAt: null, now })).toBe("unknown");
    expect(PASSWORD_STATUS_LABEL_FR.unknown).toMatch(/[Ii]nconnu/);
  });

  it("a recorded change reads SET", () => {
    expect(passwordStatus({ passwordChangedAt: "2026-07-01T00:00:00.000Z", now })).toBe("set");
  });

  it("an outstanding temporary password reads TEMPORARY", () => {
    expect(
      passwordStatus({
        passwordChangedAt: "2026-07-29T09:00:00.000Z",
        mustChangePassword: true,
        tempPasswordExpiresAt: "2026-07-30T09:00:00.000Z",
        now,
      }),
    ).toBe("temporary");
  });

  it("a lapsed one reads EXPIRED and says to generate a new one", () => {
    expect(
      passwordStatus({
        passwordChangedAt: "2026-07-28T09:00:00.000Z",
        mustChangePassword: true,
        tempPasswordExpiresAt: "2026-07-29T09:00:00.000Z",
        now,
      }),
    ).toBe("expired");
    expect(PASSWORD_STATUS_LABEL_FR.expired).toMatch(/nouveau/);
  });
});

// ===========================================================================
describe("the department taxonomy is presentation ONLY", () => {
  const assignable = TENANT_ROLE_TEMPLATES.map((r) => r.key).filter((k) => k !== "CLIENT_USER");
  const mapped = ROLE_DEPARTMENTS.flatMap((d) => d.roleCodes);

  it("covers every assignable role", () => {
    for (const key of assignable) expect(departmentOfRole(key), key).not.toBeNull();
  });

  it("places each role under exactly ONE heading", () => {
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it("claims no role that does not exist", () => {
    const known = new Set(TENANT_ROLE_TEMPLATES.map((r) => r.key));
    for (const c of mapped) expect(known.has(c), c).toBe(true);
  });

  it("excludes CLIENT_USER — never assignable to a staff account", () => {
    expect(departmentOfRole("CLIENT_USER")).toBeNull();
  });

  it("grants nothing — no permission code appears anywhere in the module", () => {
    const d = code("lib/users/departments.ts");
    expect(d).not.toMatch(/permission/i);
    expect(d).not.toMatch(/[a-z_]+:[a-z_]+:[a-z_]+/);
  });

  it("does not touch the canonical organization registry", () => {
    // lib/organization/departments.ts is the Phase 9.0A registry from which WES-3
    // derives dossier ownership. This module must not import it, extend it, or be
    // mistaken for it — changing THAT changes who can see which dossiers.
    const d = read("lib/users/departments.ts");
    expect(d).not.toContain('from "@/lib/organization');
    expect(d).not.toContain('from "@/lib/workflow/access');
    const registry = read("lib/organization/departments.ts");
    for (const canonical of ["OPERATIONS", "TRANSIT", "FINANCE", "HUMAN_RESOURCES"]) {
      expect(registry, canonical).toContain(canonical);
    }
  });

  it("NEVER hides a role the map does not claim", () => {
    // A grouping that silently dropped the unrecognised would make a role added
    // tomorrow unassignable through the UI, with no error and no clue.
    const groups = groupRolesByDepartment([
      { id: "1", code: "FINANCE_OFFICER", labelFr: "Agent financier" },
      { id: "2", code: "SOME_FUTURE_ROLE", labelFr: "Rôle futur" },
    ]);
    const all = groups.flatMap((g) => g.roles.map((r) => r.id));
    expect(all.sort()).toEqual(["1", "2"]);
    expect(groups.find((g) => g.key === "OTHER")?.roles.map((r) => r.id)).toEqual(["2"]);
  });

  it("drops EMPTY headings — a tenant without customs sees no empty « Transit & Douane »", () => {
    const groups = groupRolesByDepartment([{ id: "1", code: "HR_OFFICER", labelFr: "RH" }]);
    expect(groups.map((g) => g.key)).toEqual(["HR"]);
  });

  it("adds no OTHER bucket when everything is claimed", () => {
    const groups = groupRolesByDepartment([{ id: "1", code: "CASHIER", labelFr: "Caissier" }]);
    expect(groups.some((g) => g.key === "OTHER")).toBe(false);
  });
});

// ===========================================================================
describe("generating a temporary password", () => {
  const src = () => code("lib/users/password-actions.ts");
  const fn = () => {
    const s = src();
    const start = s.indexOf("export async function generateStaffTempPassword");
    return s.slice(start, s.indexOf("export async function sendStaffPasswordReset"));
  };

  it("gates on admin:users:temp_password", () => {
    expect(fn()).toContain('assertAnyPermission(userAdminCodes("tempPassword"))');
  });

  it("validates the reason BEFORE anything is written", () => {
    const b = fn();
    const reason = b.indexOf("validateTempPasswordReason");
    const client = b.indexOf("getAdminSupabaseClient()");
    expect(reason).toBeGreaterThan(-1);
    expect(reason).toBeLessThan(client);
  });

  it("is tenant-scoped — a cross-tenant target reads as not found", () => {
    expect(fn()).toContain('.eq("tenant_id", admin.tenantId)');
    expect(fn()).toContain('return { ok: false, error: "not_found" }');
  });

  it("refuses self and refuses an archived user", () => {
    expect(fn()).toContain("userId === admin.id");
    expect(fn()).toMatch(/toStaffStatus\(target\.status\) === "archived"/);
  });

  it("changes the password FIRST, then sets the flags", () => {
    // The reverse order would leave a user flagged for a forced change whose
    // password never actually changed.
    const b = fn();
    expect(b.indexOf("updateUserById")).toBeLessThan(b.indexOf("must_change_password: true"));
  });

  it("forces a change and sets an expiry in the same operation", () => {
    const b = fn();
    expect(b).toContain("must_change_password: true");
    expect(b).toContain("temp_password_expires_at: expiresAt");
    expect(b).toContain("tempPasswordTtlHours(process.env.EFFITRANS_TEMP_PASSWORD_TTL_HOURS)");
  });

  it("audits the actor, the target, the reason, the expiry and the IP", () => {
    const b = fn();
    expect(b).toContain("AuditActions.USER_TEMP_PASSWORD_GENERATED");
    expect(b).toContain("actorId: admin.id");
    expect(b).toContain("entityId: userId");
    expect(b).toContain("reason: formatTempPasswordReason(");
    expect(b).toContain("expiresAt,");
    expect(b).toContain("ip: getRequestIp()");
  });

  it("NEVER puts the password in the audit payload, a log, or a table", () => {
    const b = fn();
    const audit = b.slice(b.indexOf("writeAudit"), b.indexOf("revalidatePath"));
    expect(audit).not.toContain("temporaryPassword");
    // The only place it is written is the auth provider and the returned result.
    const persisted = b.slice(b.indexOf(".update({"), b.indexOf("writeAudit"));
    expect(persisted).not.toContain("temporaryPassword");
    expect(b).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("returns the secret exactly once, in the result", () => {
    expect(fn()).toContain("temporaryPassword,");
    expect(src()).toContain("generateTempPassword()");
  });
});

// ===========================================================================
describe("the other password levers", () => {
  const src = () => code("lib/users/password-actions.ts");

  it("the reset email gates on admin:users:reset_password and reuses ONE pipeline", () => {
    const s = src();
    expect(s).toContain('assertAnyPermission(userAdminCodes("resetPassword"))');
    expect(s).toContain("sendStaffWelcome(");
    // A recovery link, never a password in an email.
    expect(s).not.toMatch(/password.*:.*tempPassword.*email/i);
  });

  it("unlock gates on admin:users:unlock and only ever LIFTS the ban", () => {
    const s = src();
    const fn = s.slice(s.indexOf("export async function unlockStaffAccount"));
    expect(fn).toContain('assertAnyPermission(userAdminCodes("unlock"))');
    expect(fn).toContain("setUserAuthBan(supabase, userId, false)");
    expect(fn).not.toContain("setUserAuthBan(supabase, userId, true)");
  });

  it("unlock refuses an archived user — their ban IS the archive", () => {
    const s = src();
    const fn = s.slice(s.indexOf("export async function unlockStaffAccount"));
    expect(fn).toMatch(/archived[\s\S]{0,80}user_archived/);
  });

  it("completing a change clears the flag AND the expiry, and stamps the date", () => {
    const s = src();
    const fn = s.slice(s.indexOf("export async function completeStaffPasswordChange"));
    expect(fn).toContain("must_change_password: false");
    // Leaving the expiry set would expire a password the user chose themselves.
    expect(fn).toContain("temp_password_expires_at: null");
    expect(fn).toContain("password_changed_at:");
    expect(fn).toContain("AuditActions.USER_PASSWORD_CHANGED");
  });

  it("the user's own change requires NO permission — it is not an administrative act", () => {
    const s = src();
    const fn = s.slice(s.indexOf("export async function completeStaffPasswordChange"));
    expect(fn).not.toContain("assertAnyPermission");
    expect(fn).not.toContain("assertPermission");
    // It resolves BY the session's own id, so another user is unreachable.
    expect(fn).toContain('.eq("id", user.id)');
  });

  it("no action ever receives the plaintext password from the client", () => {
    const s = src();
    expect(s).not.toMatch(/export async function \w+\([^)]*password:\s*string/);
  });
});

// ===========================================================================
describe("IP capture is best-effort and honest", () => {
  it("takes the ORIGINAL client from x-forwarded-for", () => {
    expect(parseForwardedFor("41.82.1.9, 10.0.0.1, 10.0.0.2", null)).toBe("41.82.1.9");
  });

  it("falls back to x-real-ip", () => {
    expect(parseForwardedFor(null, "41.82.1.9")).toBe("41.82.1.9");
    expect(parseForwardedFor("  ", "41.82.1.9")).toBe("41.82.1.9");
  });

  it("records ABSENT rather than fabricating", () => {
    expect(parseForwardedFor(null, null)).toBeNull();
    expect(parseForwardedFor("", "")).toBeNull();
  });

  it("never throws outside a request scope", () => {
    const c = code("lib/audit/request-ip.ts");
    expect(c).toMatch(/catch\s*\{\s*return null;/);
  });

  it("no audit_log column was added for it — it rides in the event payload", () => {
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/audit_log/i);
  });
});

// ===========================================================================
describe("the create form", () => {
  const ui = () => code("components/users/users-admin.tsx");

  it("offers Department → Role, not a wall of checkboxes", () => {
    const s = ui();
    expect(s).toContain("groupRolesByDepartment(roles)");
    expect(s).toContain("t.users.form.department");
    expect(s).toContain("t.users.form.role");
    // The old always-on checkbox list is gone.
    expect(s).not.toMatch(/roles\.map\(\(r\) => \([\s\S]{0,120}type="checkbox"/);
  });

  it("the role dropdown is filtered by the chosen department", () => {
    const s = ui();
    expect(s).toContain("groups.find((g) => g.key === department)?.roles");
    expect(s).toContain("rolesInDepartment.map");
  });

  it("clearing the department clears a stale role selection", () => {
    expect(ui()).toMatch(/setDepartment\([\s\S]{0,80}setRoleToAdd\(""\)/);
  });

  it("the department is a filter — it is never submitted", () => {
    const s = ui();
    const call = s.slice(s.indexOf("createUser({"), s.indexOf("createUser({") + 400);
    expect(call).toContain("roleIds: newRoleIds");
    expect(call).not.toContain("department");
  });

  it("carries the Status field through to the server", () => {
    expect(ui()).toContain("status: newStatus");
    expect(code("lib/users/actions.ts")).toContain('form.status === "inactive" ? "inactive" : "active"');
  });

  it("each credential option explains what the system does", () => {
    const f = t.users.form;
    expect(f.modeSetupEmail).toMatch(/recommandé/i);
    for (const hint of [f.modeSetupEmailHint, f.modeGenerateHint, f.modeManualHint]) {
      expect(hint.length).toBeGreaterThan(30);
    }
    expect(ui()).toContain("t.users.form.modeSetupEmailHint");
  });
});

// ===========================================================================
describe("the Password Management panel", () => {
  const panel = () => code("components/users/user-password-panel.tsx");
  const page = () => code("app/users/[id]/page.tsx");

  it("displays the last change, the status and the expiry", () => {
    const s = panel();
    expect(s).toContain("c.lastChange");
    expect(s).toContain("PASSWORD_STATUS_LABEL_FR[user.passwordStatus]");
    expect(s).toContain("c.expiresAt");
  });

  it("renders « inconnue » rather than a manufactured date", () => {
    expect(panel()).toContain("c.lastChangeUnknown");
    expect(t.users.password.lastChangeUnknown).toMatch(/[Ii]nconnue/);
  });

  it("gates each lever on its OWN capability", () => {
    const p = page();
    expect(p).toContain('canUserAdmin(permissions, "resetPassword")');
    expect(p).toContain('canUserAdmin(permissions, "tempPassword")');
    expect(p).toContain('canUserAdmin(permissions, "unlock")');
    // Reading the page needs only read.
    expect(p).toContain('canUserAdmin(permissions, "read")');
  });

  it("confirms before generating, and says what will happen", () => {
    const s = panel();
    expect(s).toContain("c.confirmTitle");
    expect(s).toContain("c.confirmBody.map");
    const body = t.users.password.confirmBody;
    expect(body.join(" ")).toMatch(/immédiatement invalidé/);
    expect(body.join(" ")).toMatch(/une seule fois/);
    expect(body.join(" ")).toMatch(/prochaine connexion/);
  });

  it("requires a reason in the dialog", () => {
    const s = panel();
    expect(s).toContain("TEMP_PASSWORD_REASONS.map");
    expect(s).toContain("generateStaffTempPassword(user.id, { reason, note })");
  });

  it("shows the secret ONCE, from React state, with a copy button", () => {
    const s = panel();
    expect(s).toContain("issued.temporaryPassword");
    expect(s).toContain("navigator.clipboard");
    // Never anywhere durable.
    for (const sink of ["localStorage", "sessionStorage", "document.cookie", "URLSearchParams"]) {
      expect(s, sink).not.toContain(sink);
    }
  });

  it("states plainly that it cannot be retrieved again", () => {
    expect(t.users.password.resultWarning).toMatch(/une seule fois/);
    expect(t.users.password.resultWarning).toMatch(/irrécupérable|générez-en un nouveau/);
  });

  it("declares the forced first-login change and the expiry", () => {
    const s = panel();
    expect(s).toContain("c.resultForceChange");
    expect(s).toContain("c.resultExpires");
    expect(s).toContain("issued.ttlHours");
  });

  it("holds no service-role credential — every authority is a server action", () => {
    const s = panel();
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "SERVICE_ROLE", ".rpc("]) {
      expect(s, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
describe("the forced-change flag is not self-clearable — proven in CI, not asserted", () => {
  const suite = "supabase/tests/rls_staff_password_test.sql";

  it("the RLS suite exists and is wired into CI", () => {
    // A suite that is not in the workflow proves nothing. (And the workflow is
    // never edited via a heredoc — a broken ci.yml fails with ZERO jobs.)
    expect(() => read(suite)).not.toThrow();
    expect(read(".github/workflows/ci.yml")).toContain(`-f ${suite}`);
  });

  it("proves the READ half: a user sees their own flags and nobody else's row", () => {
    const s = read(suite);
    expect(s).toContain("s1_reads_own_flags");
    expect(s).toContain("s1_sees_colleague");
    expect(s).toContain("s1_sees_tenant_b");
  });

  it("proves the WRITE half: self-clearing and self-extending change NOTHING", () => {
    const s = read(suite);
    expect(s).toMatch(/update public\.app_user set must_change_password = false/);
    expect(s).toMatch(/update public\.app_user set temp_password_expires_at/);
    expect(s).toContain("cleared<>0 or expiry_moved<>0");
    // The PROPERTY is asserted, not the mechanism.
    expect(s).toContain("flag_after is not true");
    expect(s).toMatch(/expiry_after >= '2100-01-01T00:00:00Z'/);
  });

  it("accepts EITHER refusal mechanism — the missing grant or the missing policy", () => {
    // `authenticated` holds SELECT ONLY on app_user, so the UPDATE is rejected at
    // the PRIVILEGE layer (an exception), before RLS is consulted. Were that grant
    // ever added, the absence of an UPDATE policy would still reduce it to zero
    // rows. The suite records which one fired instead of assuming.
    const s = read(suite);
    expect(s).toContain("exception when others then");
    expect(s).toContain("clear_refusal := 'privilege_' || sqlstate");
    expect(s).toContain("clear_refused_by");
    const grants = read("supabase/migrations/20260613000004_grant_table_privileges.sql");
    expect(grants).toMatch(/grant select on[\s\S]{0,200}public\.app_user/);
    expect(grants).not.toMatch(/grant (update|all)[^;]*public\.app_user/);
  });

  it("runs AFTER every suite that predates it — a new suite must not skip established ones", () => {
    // A failing step aborts the job: when this suite sat mid-list, its own bug
    // skipped 33 downstream RLS suites. The rule is "append", not "be last" —
    // later phases append after this one, so claiming the final slot forever
    // would just make the next phase's suite fail this assertion.
    const ci = read(".github/workflows/ci.yml");
    const mine = ci.indexOf("rls_staff_password_test.sql");
    // The Douane suite was the final one when this suite was added.
    const lastPredecessor = ci.indexOf("rls_customs_discovery_test.sql");
    expect(mine).toBeGreaterThan(lastPredecessor);
  });

  it("surfaces the real SQL error, not a bare exit code", () => {
    // psql prints the failing statement AFTER the error, so a tail would hide it.
    const ci = read(".github/workflows/ci.yml");
    const step = ci.slice(ci.indexOf("Run RLS staff password lifecycle test"));
    expect(step).toContain("ERROR:");
    expect(step).toContain("::error::");
  });

  it("is non-destructive", () => {
    const s = read(suite);
    expect(s).toContain("begin;");
    expect(s.trimEnd().endsWith("rollback;")).toBe(true);
  });

  it("app_user still has no UPDATE policy — that absence IS the control", () => {
    const migrations = read("supabase/migrations/20260613000001_create_foundation_tables.sql");
    expect(migrations).toContain("create policy app_user_select_self");
    // And this migration did not add one.
    expect(sqlCode(MIGRATION)).not.toMatch(/create policy/i);
  });
});

// ===========================================================================
describe("nothing else was weakened", () => {
  it("the directory read is gated, and the umbrella still opens it", () => {
    const s = code("lib/users/service.ts");
    expect(s).toContain('assertAnyPermission(userAdminCodes("read"))');
    expect(s).not.toContain('assertPermission("admin:users:manage")');
  });

  it("the lifecycle columns are read SEPARATELY and fail soft", () => {
    // Folding them into the main select would blank the whole directory in the
    // window before the operator applies the migration.
    const s = code("lib/users/service.ts");
    const main = s.slice(s.indexOf("let query = supabase"), s.indexOf("if (!opts.includeArchived)"));
    expect(main).not.toContain("must_change_password");
    expect(s).toMatch(/readPasswordLifecycle[\s\S]{0,400}if \(error\) return new Map\(\);/);
  });

  it("role assignment keeps admin:roles:manage as an accepted authority", () => {
    expect(code("lib/users/actions.ts")).toContain('"admin:roles:manage", "admin:users:update", "admin:users:manage"');
  });

  it("CLIENT_USER remains non-assignable to a staff account", () => {
    expect(code("lib/users/service.ts")).toContain('NON_ASSIGNABLE_STAFF_ROLE_CODES = ["CLIENT_USER"]');
  });

  it("there is still NO delete action anywhere in user management", () => {
    for (const f of ["lib/users/actions.ts", "lib/users/password-actions.ts"]) {
      expect(code(f), f).not.toMatch(/export async function delete/i);
    }
  });

  it("the portal's own forced-change flow is untouched", () => {
    const p = code("lib/portal/password-change.ts");
    expect(p).toContain("must_change_password: false");
    expect(p).toContain("AuditActions.PORTAL_USER_PASSWORD_CHANGED");
  });
});
