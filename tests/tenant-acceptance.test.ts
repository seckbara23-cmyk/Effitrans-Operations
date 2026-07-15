/**
 * Phase 6.0F — multi-tenant acceptance (logic level).
 *
 * The DB-level bidirectional isolation is proven by supabase/tests/
 * rls_multitenant_acceptance_test.sql in CI. This file proves the two-tenant ACCEPTANCE
 * logic that runs in node: lifecycle independence, identity routing, per-tenant branding
 * and onboarding derivation with no shared state, and the platform/tenant permission
 * boundary. Two fixtures stand in for Tenant A and Tenant B.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { postLoginPath } from "@/lib/auth/session-class";
import { isDriverOnly, narrowStaffIdentity } from "@/lib/auth/staff-identity";
import { tenantBlockReason, canTransition } from "@/lib/platform/company-metadata";
import { deriveOnboardingChecklist } from "@/lib/platform/console/onboarding";
import { validateBrandingDraft } from "@/lib/branding/edit";
import { mergeBranding } from "@/lib/branding/resolve";
import { isPlatformPermission } from "@/lib/platform/roles";
import type { CompanySummary } from "@/lib/platform/companies";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const NOW = Date.parse("2026-07-15T00:00:00Z");
const day = 86_400_000;

function company(over: Partial<CompanySummary>): CompanySummary {
  return {
    id: "a", displayName: "Tenant A", slug: "tenant-a", lifecycleStatus: "ACTIVE",
    productProfile: "LOGISTICS_COMPANY", planKey: "PROFESSIONAL", country: "SN", locale: "fr",
    currency: "XOF", timezone: "Africa/Dakar", onboardingStatus: "complete", brandingComplete: true,
    userCount: 6, activeDossierCount: 3, lastTenantLoginAt: "2026-07-14T00:00:00Z", enabledModules: [],
    createdAt: "2026-07-01T00:00:00Z", trialStartedAt: null, trialEndsAt: null, administratorEmail: "a@x.sn",
    ...over,
  };
}

const tenantA = company({ id: "a", displayName: "Tenant A", lifecycleStatus: "ACTIVE" });
const tenantB = company({
  id: "b", displayName: "Tenant B", slug: "effitrans-acceptance-2", lifecycleStatus: "TRIAL",
  trialEndsAt: new Date(NOW + 10 * day).toISOString(), onboardingStatus: "in_progress",
  brandingComplete: false, userCount: 1, activeDossierCount: 0, lastTenantLoginAt: null, administratorEmail: "b@x.sn",
});

// ---------------------------------------------------------------- lifecycle ----

describe("lifecycle acts on each tenant independently", () => {
  it("suspending A does not block B; B's trial (in-window) stays operable", () => {
    // A suspended → blocked; B TRIAL in-window → allowed. Independent inputs, no shared state.
    expect(tenantBlockReason("SUSPENDED", null, NOW)).toBe("SUSPENDED"); // A
    expect(tenantBlockReason("TRIAL", tenantB.trialEndsAt, NOW)).toBeNull(); // B
  });

  it("reactivation is a per-tenant transition (SUSPENDED→ACTIVE only)", () => {
    expect(canTransition("reactivate", "SUSPENDED")).toBe(true);
    expect(canTransition("reactivate", "ACTIVE")).toBe(false);
    // Archive preserves the ability to read (block reason ARCHIVED, no delete implied here).
    expect(tenantBlockReason("ARCHIVED", null, NOW)).toBe("ARCHIVED");
  });
});

// ---------------------------------------------------------------- identity ----

describe("identity routing holds for the acceptance tenant's users", () => {
  it("SYSTEM_ADMIN + DRIVER → full workspace, never /driver", () => {
    expect(postLoginPath("staff", ["SYSTEM_ADMIN", "DRIVER"])).toBe("/dashboard");
    expect(isDriverOnly(["SYSTEM_ADMIN", "DRIVER"])).toBe(false);
  });
  it("driver-only → /driver; courier-only → narrow courier identity", () => {
    expect(postLoginPath("staff", ["DRIVER"])).toBe("/driver");
    expect(narrowStaffIdentity(["DRIVER"])).toBe("driver");
    expect(narrowStaffIdentity(["COURIER"])).toBe("courier");
  });
  it("multi-role priority is deterministic (an operational role beats DRIVER)", () => {
    expect(postLoginPath("staff", ["DRIVER", "BILLING_OFFICER"])).toBe("/dashboard");
    expect(postLoginPath("staff", ["BILLING_OFFICER", "DRIVER"])).toBe("/dashboard");
  });
});

// ---------------------------------------------------------------- branding ----

describe("branding is per-tenant and cannot cross", () => {
  it("mergeBranding reads only the tenant's own identity + row (single argument set)", () => {
    const a = mergeBranding({ name: "Tenant A" }, { display_name: "Marque A", primary_color: "#111111" });
    const b = mergeBranding({ name: "Tenant B" }, { display_name: "Marque B", primary_color: "#222222" });
    expect(a.displayName).toBe("Marque A");
    expect(b.displayName).toBe("Marque B");
    expect(a.primaryColor).not.toBe(b.primaryColor); // no shared/leaked state
  });
  it("rejects unsafe HTML in a branding value", () => {
    const res = validateBrandingDraft({ display_name: "<script>x</script>" });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- onboarding ----

describe("onboarding derives from the correct tenant's facts, no cross-leak", () => {
  it("A (complete) and B (in-progress) yield different, tenant-specific progress", () => {
    const a = deriveOnboardingChecklist(tenantA, { rowExists: true, live: true });
    const b = deriveOnboardingChecklist(tenantB, { rowExists: false, live: false });
    expect(a.completed).toBeGreaterThan(b.completed);
    // B's counts reflect B only — never A's userCount/dossiers.
    const bTeam = b.items.find((i) => i.key === "team");
    expect(bTeam?.complete).toBe(false); // B has 1 user
    const aTeam = a.items.find((i) => i.key === "team");
    expect(aTeam?.complete).toBe(true); // A has 6
  });
});

// ---------------------------------------------------------------- boundary ----

describe("tenant roles never grant platform permissions", () => {
  it("no tenant-style permission code is a platform permission", () => {
    for (const code of ["admin:users:manage", "file:read", "finance:read", "process:read", "collections:manage"]) {
      expect(isPlatformPermission(code)).toBe(false);
    }
  });

  it("platform reads are cross-tenant BY DESIGN and gated (listCompanies asserts a platform permission)", () => {
    const companies = read("../lib/platform/companies.ts");
    expect(companies).toContain('assertPlatformPermission("platform:companies:read")');
  });
});

// ---------------------------------------------------------------- DB proof present ----

describe("the DB-level bidirectional isolation proof exists and runs in CI", () => {
  it("the acceptance RLS test is wired into the CI rls-tests job", () => {
    const ci = read("../.github/workflows/ci.yml");
    expect(ci).toContain("rls_multitenant_acceptance_test.sql");
    const sql = read("../supabase/tests/rls_multitenant_acceptance_test.sql");
    // Proves BOTH directions and mutation isolation.
    expect(sql).toContain("Direction A→B");
    expect(sql).toContain("Direction B→A");
    expect(sql).toContain("CROSS-TENANT WRITE");
  });
});
