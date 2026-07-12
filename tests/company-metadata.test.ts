/**
 * Phase 4.0B-3 — company metadata vocab + platform company service safety.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_STATUSES,
  PRODUCT_PROFILES,
  isLifecycleStatus,
  isProductProfile,
  isTenantOperable,
  profileGrantsCrossTenantAccess,
} from "@/lib/platform/company-metadata";

describe("company metadata", () => {
  it("defines the lifecycle + product-profile vocabulary", () => {
    expect([...LIFECYCLE_STATUSES]).toEqual(["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
    expect(isLifecycleStatus("ACTIVE")).toBe(true);
    expect(isLifecycleStatus("DELETED")).toBe(false);
    expect(isProductProfile("GOVERNMENT_AGENCY")).toBe(true);
    expect(isProductProfile("SPY_AGENCY")).toBe(false);
  });

  it("a tenant is operable only while ACTIVE or TRIAL", () => {
    expect(isTenantOperable("ACTIVE")).toBe(true);
    expect(isTenantOperable("TRIAL")).toBe(true);
    expect(isTenantOperable("SUSPENDED")).toBe(false);
    expect(isTenantOperable("ARCHIVED")).toBe(false);
  });

  it("NO product profile (incl. GOVERNMENT_AGENCY) grants cross-tenant access", () => {
    for (const p of PRODUCT_PROFILES) expect(profileGrantsCrossTenantAccess(p)).toBe(false);
  });
});

describe("platform company service — safe metadata only (D6)", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/platform/companies.ts", import.meta.url)), "utf8");
  const tablesRead = [...src.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)].map((m) => m[1]);

  it("reads only organization, app_user, operational_file", () => {
    expect([...new Set(tablesRead)].sort()).toEqual(["app_user", "operational_file", "organization"]);
  });

  it("never reads financial / customs / document / client / tracking tables", () => {
    const FORBIDDEN = [
      "invoice", "invoice_line", "payment", "payment_intent", "billing_charge", "customs_record",
      "document", "client", "client_contact", "client_user", "tracking_position", "tracking_event",
      "communication_message", "audit_log",
    ];
    for (const t of FORBIDDEN) expect(tablesRead).not.toContain(t);
  });
});
