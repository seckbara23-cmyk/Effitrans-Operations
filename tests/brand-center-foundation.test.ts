/**
 * DBC-1 — Brand Center foundation: pure model, validation, assets, completeness.
 * The DB/storage isolation is proven by supabase/tests/rls_brand_center_test.sql in CI;
 * this covers the pure logic + structural guards on the migration.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  isAllowedFont, isHttpsUrl, normalizePhone, resolveComplianceCopy, LOCKED_BRAND_DEFAULTS,
  deriveBrandCompleteness, isAssetKind, isSignatureVariant, validateBrandText, type CompletenessInput,
} from "@/lib/brand/model";
import { sanitizeFilename, buildAssetPath, isPngSignature, validateAssetUpload, MAX_ASSET_BYTES } from "@/lib/brand/assets";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const migration = read("../supabase/migrations/20260716000001_brand_center.sql");

// ---------------------------------------------------------------- validation ----

describe("brand validation reuses the existing safe primitives", () => {
  it("fonts are an allowlist (Montserrat/Open Sans/Calibri) — no arbitrary family", () => {
    expect(isAllowedFont("Montserrat")).toBe(true);
    expect(isAllowedFont("Comic Sans")).toBe(false);
    expect(isAllowedFont("Arial'; background:url(x)")).toBe(false);
  });
  it("compliance/social/website URLs must be https", () => {
    expect(isHttpsUrl("https://whistleblowersoftware.com/secure/x")).toBe(true);
    expect(isHttpsUrl("http://insecure.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });
  it("phones accept only phone-shaped values", () => {
    expect(normalizePhone("+221 76 356 58 59").ok).toBe(true);
    expect(normalizePhone("").ok).toBe(true); // empty → null
    expect(normalizePhone("DROP TABLE").ok).toBe(false);
  });
  it("text rejects markup for safe later escaping", () => {
    expect(validateBrandText("Performance in Motion")).toBe("Performance in Motion");
    expect(validateBrandText("<script>x</script>")).toBe("ERR");
    expect(validateBrandText("")).toBeNull();
  });
  it("closed vocabularies", () => {
    expect(isAssetKind("LOGO_EMAIL_PNG")).toBe(true);
    expect(isAssetKind("SVG")).toBe(false);
    expect(isSignatureVariant("EXECUTIVE")).toBe(true);
    expect(isSignatureVariant("ADMIN")).toBe(false);
  });
});

// ---------------------------------------------------------------- locked defaults ----

describe("locked compliance copy resolves defaults, never blank", () => {
  it("uses the memorandum's approved strings when no override", () => {
    const c = resolveComplianceCopy({});
    expect(c.compliance_title).toBe("Ethics & Compliance");
    expect(c.sustainability_statement).toBe("Committed to Sustainable Logistics");
    expect(c.footer_line).toContain("Integrated Logistics");
    expect(LOCKED_BRAND_DEFAULTS.compliance_button_label).toBe("Report Confidentially");
  });
  it("a tenant override wins; a blank override falls back to the default", () => {
    expect(resolveComplianceCopy({ compliance_title: "Éthique" }).compliance_title).toBe("Éthique");
    expect(resolveComplianceCopy({ compliance_title: "  " }).compliance_title).toBe("Ethics & Compliance");
  });
});

// ---------------------------------------------------------------- completeness ----

const emptyInput: CompletenessInput = {
  colors: { green: null, gold: null, anthracite: null },
  fonts: { heading: null, body: null, fallback: null },
  slogan: null, valueProposition: null, website: null, address: null, whistleblowerUrl: null,
  publishedKinds: [], activeMembershipCount: 0, workforceWithTitleCount: 0,
};

describe("completeness is honest, evidence-based, no false percentage", () => {
  it("a fresh tenant is 0/11", () => {
    const c = deriveBrandCompleteness(emptyInput);
    expect(c.completed).toBe(0);
    expect(c.total).toBe(11);
    expect(c.summary).toBe("0 éléments sur 11 complétés");
  });
  it("counts exactly the evidenced items", () => {
    const c = deriveBrandCompleteness({
      ...emptyInput,
      colors: { green: "#0a5", gold: "#fc0", anthracite: "#333" },
      slogan: "Performance in Motion",
      publishedKinds: ["LOGO_PRIMARY", "LOGO_EMAIL_PNG"],
      activeMembershipCount: 2,
    });
    const done = new Set(c.items.filter((i) => i.complete).map((i) => i.key));
    expect(done).toEqual(new Set(["colors", "slogan", "logo_primary", "logo_email", "memberships"]));
    expect(c.completed).toBe(5);
  });
  it("colors incomplete until ALL three are supplied (never invented)", () => {
    const c = deriveBrandCompleteness({ ...emptyInput, colors: { green: "#0a5", gold: "#fc0", anthracite: null } });
    expect(c.items.find((i) => i.key === "colors")!.complete).toBe(false);
  });
});

// ---------------------------------------------------------------- assets ----

describe("asset paths are server-built, tenant-scoped, immutable", () => {
  it("path = tenant/folder/assetId/vN/file — no client path trusted", () => {
    const p = buildAssetPath({ tenantId: "t1", kind: "LOGO_EMAIL_PNG", assetId: "a9", version: 2, filename: "logo.png" });
    expect(p).toBe("t1/logos/a9/v2/logo.png");
    expect(buildAssetPath({ tenantId: "t1", kind: "NETWORK_LOGO", assetId: "n1", version: 1, filename: "wca.png" })).toBe("t1/networks/n1/v1/wca.png");
  });
  it("filenames are sanitized (no traversal, no unsafe chars)", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a b;rm -rf.png")).toBe("a-b-rm--rf.png");
    expect(buildAssetPath({ tenantId: "t", kind: "LOGO_PRIMARY", assetId: "x", version: 1, filename: "../../evil" })).toBe("t/logos/x/v1/evil.png");
  });
});

describe("asset upload validation — PNG only, ≤100 KB, real signature, alt required", () => {
  const ok = { kind: "LOGO_PRIMARY", mime: "image/png", filename: "logo.png", byteLength: 5000, signatureOk: true, altText: "Logo" };
  it("accepts a valid PNG", () => expect(validateAssetUpload(ok).ok).toBe(true));
  it("rejects SVG / wrong mime / wrong extension", () => {
    expect(validateAssetUpload({ ...ok, mime: "image/svg+xml" }).ok).toBe(false);
    expect(validateAssetUpload({ ...ok, mime: "image/png", filename: "logo.svg" }).ok).toBe(false);
  });
  it("rejects oversize and empty", () => {
    expect(validateAssetUpload({ ...ok, byteLength: MAX_ASSET_BYTES + 1 })).toEqual({ ok: false, error: "too_large" });
    expect(validateAssetUpload({ ...ok, byteLength: 0 }).ok).toBe(false);
  });
  it("rejects a disguised non-PNG (bad signature) and missing alt", () => {
    expect(validateAssetUpload({ ...ok, signatureOk: false })).toEqual({ ok: false, error: "not_a_png" });
    expect(validateAssetUpload({ ...ok, altText: "  " })).toEqual({ ok: false, error: "alt_required" });
  });
  it("the PNG magic-number check works (does not trust file.type)", () => {
    expect(isPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))).toBe(true);
    expect(isPngSignature(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBe(false); // "<svg"
  });
});

// ---------------------------------------------------------------- migration guards ----

describe("the migration follows the isolation + storage doctrine", () => {
  it("every table is RLS-scoped by auth_tenant_id + the admin permission, service-role writes", () => {
    for (const t of ["brand_asset", "tenant_brand_profile", "tenant_membership_registry", "workforce_profile"]) {
      expect(migration).toContain(`alter table public.${t} enable row level security`);
    }
    expect(migration).toContain("public.auth_tenant_id()");
    expect(migration).toContain("public.has_permission('admin:config:manage')");
    expect(migration).toContain("public.has_permission('admin:users:manage')");
    // No authenticated write policy anywhere — writes are service-role only.
    expect(migration).not.toMatch(/for (insert|update|delete) to authenticated/);
  });
  it("creates a PUBLIC brand-assets bucket, PNG-only, ≤100 KB", () => {
    expect(migration).toContain("insert into storage.buckets");
    expect(migration).toContain("'brand-assets', 'brand-assets', true, 102400, array['image/png']");
  });
  it("does NOT reuse the private documents bucket and seeds no invented colors", () => {
    expect(migration).not.toContain("'documents'");
    expect(migration).not.toMatch(/color_green\s+text[^;]*default/i); // colors nullable, no default
  });
  it("workforce tenant must match app_user (defence in depth)", () => {
    expect(migration).toContain("brand_workforce_tenant_match");
  });
  it("audit codes are defined", () => {
    expect(AuditActions.BRAND_PROFILE_UPDATED).toBe("brand.profile.updated");
    expect(AuditActions.BRAND_ASSET_UPLOADED).toBe("brand.asset.uploaded");
    expect(AuditActions.BRAND_WORKFORCE_PROFILE_UPDATED).toBe("brand.workforce_profile.updated");
  });
});
