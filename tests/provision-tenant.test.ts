/**
 * Phase 6.0A — transactional tenant provisioning.
 *
 * The runtime behaviour (does a tenant get created atomically?) is proven against
 * real Postgres in supabase/tests/rls_provision_tenant_test.sql. This file proves the
 * things a SQL suite cannot see: the SHAPE of the engine's two-stage protocol, the
 * error vocabulary, the secret-handling discipline, and the security posture of the
 * migration — all as structural assertions that a review can enforce forever.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validateProvisionInput, validateSlug, RESERVED_SLUGS } from "@/lib/platform/provisioning/validate";
import { redactProvisionResult } from "@/lib/platform/provisioning/contract";
import { PROVISION_ERRORS, isProvisionError, NON_FATAL_WARNINGS } from "@/lib/platform/provisioning/errors";
import { selectTenantRoleTemplates } from "@/lib/platform/role-templates";
import type { ProvisionTenantInput } from "@/lib/platform/provisioning/contract";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const engine = read("../lib/platform/provisioning/engine.ts");
const migration = read("../supabase/migrations/20260715000001_provision_tenant.sql");
const rlsTest = read("../supabase/tests/rls_provision_tenant_test.sql");

const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const engineCode = codeOnly(engine);

const validInput = (over: Partial<ProvisionTenantInput> = {}): ProvisionTenantInput => ({
  company: {
    legalName: "Northwind Logistics SA",
    tradeName: "Northwind",
    slug: "northwind",
    country: "SN",
    currency: "XOF",
    timezone: "Africa/Dakar",
    language: "fr",
    email: "ops@northwind.test",
  },
  administrator: { fullName: "Awa Ba", email: "awa@northwind.test" },
  businessProfile: {} as ProvisionTenantInput["businessProfile"],
  modules: {},
  plan: "PROFESSIONAL",
  idempotencyKey: "key-0001",
  ...over,
});

// --------------------------------------------------------------- error codes ----

describe("the error vocabulary is closed and complete", () => {
  it("defines every code the brief requires", () => {
    for (const code of [
      "invalid_input",
      "duplicate_slug",
      "admin_email_conflict",
      "auth_user_creation_failed",
      "relational_provisioning_failed",
      "compensation_failed",
      "invitation_send_failed",
      "already_provisioned",
      "unauthorized",
    ]) {
      expect(PROVISION_ERRORS, code).toContain(code);
      expect(isProvisionError(code)).toBe(true);
    }
  });

  it("treats a failed invitation as NON-fatal — the tenant already exists", () => {
    expect(NON_FATAL_WARNINGS.has("invitation_send_failed")).toBe(true);
    // ...and nothing else is non-fatal: a duplicate slug IS a hard failure.
    expect(NON_FATAL_WARNINGS.has("duplicate_slug")).toBe(false);
  });
});

// -------------------------------------------------------------- validation ----

describe("input validation (reused from 4.0B)", () => {
  it("accepts a well-formed request", () => {
    expect(validateProvisionInput(validInput()).ok).toBe(true);
  });

  it("rejects a reserved or malformed slug", () => {
    expect(validateSlug("platform").ok).toBe(false);
    expect(RESERVED_SLUGS.has("platform")).toBe(true);
    expect(validateProvisionInput(validInput({ company: { ...validInput().company, slug: "AB" } })).ok).toBe(false);
  });

  it("requires an administrator email", () => {
    const bad = validInput({ administrator: { fullName: "X", email: "not-an-email" } });
    expect(validateProvisionInput(bad).ok).toBe(false);
  });
});

// --------------------------------------------------- the two-stage protocol ----

describe("the engine follows the approved two-stage protocol", () => {
  it("is authorized on platform:companies:create — a tenant user cannot provision", () => {
    expect(engineCode).toContain('assertPlatformPermission("platform:companies:create")');
    expect(engineCode).toContain('return { ok: false, error: "unauthorized" }');
  });

  it("validates BEFORE it touches auth or SQL", () => {
    // Compare CALL SITES in the main function, not raw string positions (the helper
    // DEFINITIONS live below the calls, and "createUser" is a substring of
    // "resolveOrCreateAuthUser").
    const validateCall = engineCode.indexOf("validateProvisionInput(input)");
    const stage1Call = engineCode.indexOf("resolveOrCreateAuthUser(admin");
    expect(validateCall).toBeGreaterThan(-1);
    expect(stage1Call).toBeGreaterThan(-1);
    expect(validateCall).toBeLessThan(stage1Call);
  });

  it("creates the auth user in stage 1, then calls ONE rpc for everything relational", () => {
    expect(engineCode).toContain("admin.auth.admin.createUser");
    expect(engineCode).toContain('admin.rpc("provision_tenant"');
    // Stage 1's CALL precedes stage 2's rpc, in the main function body.
    const stage1Call = engineCode.indexOf("resolveOrCreateAuthUser(admin");
    const rpcCall = engineCode.indexOf('rpc("provision_tenant"');
    expect(stage1Call).toBeLessThan(rpcCall);
  });

  it("reuses an existing auth user rather than creating a second", () => {
    expect(engineCode).toContain("findAuthUserByEmail");
    expect(engineCode).toContain("createdHere: false"); // the reuse branch
  });
});

// ---------------------------------------------------------- compensation ----

describe("compensation deletes ONLY a user this request created", () => {
  it("guards deletion on createdHere", () => {
    // The single most important line: a pre-existing auth user is never deleted.
    expect(engineCode).toContain("if (!ctx.createdHere) return;");
    expect(engineCode).toContain("admin.auth.admin.deleteUser");
  });

  it("compensates on BOTH an rpc error and an expected SQL refusal", () => {
    // A slug taken by someone else still leaves an orphan auth user if we created one.
    const compCalls = engineCode.match(/compensate\(/g) ?? [];
    expect(compCalls.length).toBeGreaterThanOrEqual(3); // definition + 2 call sites
  });

  it("reports a failed compensation honestly rather than swallowing it", () => {
    expect(engineCode).toContain("provision.compensation_failed");
    expect(engineCode).toContain("reportError");
  });

  it("never rolls back the tenant for a mail failure — invitation is stage 3, best effort", () => {
    const rpcAt = engineCode.indexOf('rpc("provision_tenant"');
    const inviteAt = engineCode.indexOf("inviteAdministrator");
    expect(inviteAt).toBeGreaterThan(rpcAt); // invitation happens AFTER the tenant is committed
  });
});

// ----------------------------------------------------- the secret discipline ----

describe("the setup link/token never leaks", () => {
  it("is generated in stage 3 and never passed to SQL", () => {
    // provision_tenant's payload must not contain a password or a link.
    const payloadBlock = engineCode.slice(
      engineCode.indexOf("const payload"),
      engineCode.indexOf('rpc("provision_tenant"'),
    );
    expect(payloadBlock).not.toMatch(/password|setupLink|action_link|token/i);
  });

  it("returns the link ONLY when no email provider is configured", () => {
    expect(engineCode).toContain("isProviderConfigured()");
    // The RUNTIME link-return object (comma, not the semicolon in the type union) lives
    // on the branch gated by !isProviderConfigured — so it must appear AFTER that gate.
    const gate = engineCode.indexOf("if (!isProviderConfigured())");
    const linkReturn = engineCode.indexOf('kind: "link_returned", setupLink');
    expect(gate).toBeGreaterThan(-1);
    expect(linkReturn).toBeGreaterThan(gate);
  });

  it("never claims an email was sent when it was not", () => {
    // email_sent is only reachable through queueAndSend returning an id.
    expect(engineCode).toContain('res.id ? { kind: "email_sent" }');
  });

  it("never logs, audits or persists the setup link", () => {
    // No reportError / audit / db write carries the link. The only place setupLink
    // appears on an outbound path is the link_returned return and the email vars.
    const setupUses = [...engineCode.matchAll(/setupLink/g)];
    expect(setupUses.length).toBeGreaterThan(0);
    expect(engineCode).not.toMatch(/writeAudit\([^)]*setupLink/);
    expect(engineCode).not.toMatch(/reportError\([^)]*setupLink/);
    expect(engineCode).not.toMatch(/\.insert\([^)]*setupLink/);
  });

  it("redactProvisionResult strips the one-time password", () => {
    const redacted = redactProvisionResult({
      organizationId: "o",
      tenantId: "o",
      administratorUserId: "u",
      administratorLogin: "a@b.c",
      temporaryPassword: "SECRET",
      createdRoles: [],
      createdDepartments: [],
      enabledModules: [],
      status: "provisioned",
    });
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
    expect("temporaryPassword" in redacted).toBe(false);
  });
});

// ----------------------------------------------- role materialization (from TS) ----

describe("roles come from the template registry, not from a second SQL copy", () => {
  it("the engine selects templates and passes them to SQL", () => {
    expect(engineCode).toContain("selectTenantRoleTemplates(input.businessProfile)");
    expect(engineCode).toContain("permissions: t.permissions");
  });

  it("a default profile always includes SYSTEM_ADMIN", () => {
    const roles = selectTenantRoleTemplates({});
    expect(roles.some((r) => r.key === "SYSTEM_ADMIN")).toBe(true);
  });

  it("the migration refuses to materialize an unknown permission code", () => {
    // A template drift must fail loudly, not silently drop a permission.
    expect(migration).toContain("unknown permission code");
    expect(migration).toMatch(/raise exception/i);
  });

  it("the migration requires SYSTEM_ADMIN in the role set", () => {
    expect(migration).toContain("did not include SYSTEM_ADMIN");
  });
});

// ------------------------------------------------------------ migration security ----

describe("the SQL function is service_role-only and safe", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
  });

  it("revokes execute from every non-service role and grants ONLY service_role", () => {
    expect(migration).toMatch(/revoke all on function public\.provision_tenant.*from public/i);
    expect(migration).toMatch(/revoke all on function public\.provision_tenant.*from anon/i);
    expect(migration).toMatch(/revoke all on function public\.provision_tenant.*from authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.provision_tenant.*to service_role/i);
  });

  it("creates the rollout row with NO features on — a fresh tenant is dark", () => {
    // The empty insert relies on the table's all-false defaults.
    expect(migration).toContain("insert into public.tenant_process_rollout (tenant_id) values (v_org_id)");
  });

  it("writes an audit row that carries NO secret", () => {
    const auditBlock = migration.slice(migration.indexOf("insert into public.audit_log"));
    expect(auditBlock).toContain("platform.tenant.provisioned");
    expect(auditBlock).not.toMatch(/password|setup_link|action_link|token/i);
  });

  it("is clean-replay safe: no LITERAL tenant uuid is seeded at migration time", () => {
    // The function DOES insert into organization — but with a generated id (v_org_id),
    // as part of its installed body, not as migration-time data. What the clean-replay
    // rule forbids is a literal tenant uuid inserted before seed.sql runs; there is none.
    expect(migration).not.toMatch(/values\s*\(\s*'00000000-0000-0000-0000-/i);
    expect(migration).toContain("returning id into v_org_id");
  });

  it("the RLS suite proves the refusal, the isolation and the idempotency", () => {
    expect(rlsTest).toContain("PROVISION BREACH");
    expect(rlsTest).toContain("ISOLATION BREACH");
    expect(rlsTest).toContain("IDEMPOTENCY FAILED");
    expect(rlsTest).toContain("SLUG GUARD FAILED");
  });
});
