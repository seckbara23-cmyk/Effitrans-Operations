/**
 * Phase 4.0B-2 — provisioning contract: validation + one-time-password safety.
 */
import { describe, it, expect } from "vitest";
import { redactProvisionResult, type ProvisionTenantInput, type ProvisionTenantResult } from "@/lib/platform/provisioning/contract";
import { validateProvisionInput, validateSlug, RESERVED_SLUGS } from "@/lib/platform/provisioning/validate";

function validInput(): ProvisionTenantInput {
  return {
    company: {
      legalName: "Baobab Trading SARL",
      tradeName: "Baobab",
      slug: "baobab-trading",
      country: "SN",
      currency: "XOF",
      timezone: "Africa/Dakar",
      language: "fr",
      email: "ops@baobab.example",
      ninea: "1234567",
    },
    administrator: { fullName: "Awa Ndiaye", email: "awa@baobab.example" },
    businessProfile: {
      customsBroker: true, freightForwarder: true, roadTransport: true, seaFreight: false,
      airFreight: false, warehousing: false, importOperations: true, exportOperations: false,
    },
    modules: { "module.ai": true },
    plan: "PROFESSIONAL",
    idempotencyKey: "idem-123",
  };
}

describe("provisioning input validation", () => {
  it("accepts a well-formed input", () => {
    expect(validateProvisionInput(validInput())).toEqual({ ok: true, errors: [] });
  });

  it("rejects a reserved / malformed slug", () => {
    for (const s of ["platform", "portal", "admin"]) {
      expect(validateSlug(s).ok).toBe(false);
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
    expect(validateSlug("ab").ok).toBe(false); // too short
    expect(validateSlug("-lead").ok).toBe(false); // leading hyphen
    expect(validateSlug("Trailing").ok).toBe(false); // uppercase
    expect(validateSlug("ok-slug").ok).toBe(true);
  });

  it("flags invalid currency, locale, plan, and idempotency key", () => {
    const bad = validInput();
    bad.company.currency = "cfa";
    bad.company.language = "french";
    // @ts-expect-error — testing an invalid plan value at runtime
    bad.plan = "GOLD";
    bad.idempotencyKey = "  ";
    const res = validateProvisionInput(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/currency/);
    expect(res.errors.join("\n")).toMatch(/language/);
    expect(res.errors.join("\n")).toMatch(/plan/);
    expect(res.errors.join("\n")).toMatch(/idempotencyKey/);
  });

  it("requires a valid administrator email", () => {
    const bad = validInput();
    bad.administrator.email = "not-an-email";
    expect(validateProvisionInput(bad).ok).toBe(false);
  });
});

describe("one-time temporary password never leaks", () => {
  const result: ProvisionTenantResult = {
    organizationId: "org-1",
    tenantId: "org-1",
    administratorUserId: "user-1",
    administratorLogin: "awa@baobab.example",
    temporaryPassword: "S3cr3t-Temp-Pw!",
    createdRoles: ["SYSTEM_ADMIN"],
    createdDepartments: [],
    enabledModules: ["module.finance"],
    status: "provisioned",
  };

  it("redactProvisionResult removes temporaryPassword", () => {
    const safe = redactProvisionResult(result);
    expect("temporaryPassword" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("S3cr3t-Temp-Pw!");
  });

  it("the raw result still carries it once (for one-time display)", () => {
    expect(result.temporaryPassword).toBe("S3cr3t-Temp-Pw!");
  });
});
