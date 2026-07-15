/**
 * Phase 6.0E-1 — the platform tenant-branding editor.
 *
 * The validation is a pure function tested exhaustively. The wiring (platform-gated
 * write, safe audit, one persisted source, no admin client in the client chunk, logo
 * upload deferred) is asserted structurally against source — no jsdom, no live DB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  validateBrandingDraft,
  changedBrandingFields,
  EDITABLE_BRANDING_FIELDS,
  type EditableBrandingField,
} from "@/lib/branding/edit";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = read("../lib/platform/branding-actions.ts");
const editor = read("../components/platform/branding-editor.tsx");
const detail = read("../app/platform/companies/[id]/page.tsx");

// ---------------------------------------------------------------- validation ----

describe("validateBrandingDraft — supported values only, errors surfaced", () => {
  it("accepts a valid draft and returns only the editable columns", () => {
    const res = validateBrandingDraft({
      display_name: "  Acme Transit  ",
      primary_color: "#0F766E",
      secondary_color: "#334155",
      support_email: "support@acme.sn",
      tagline: "Transit • Douane",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.display_name).toBe("Acme Transit"); // trimmed
    expect(res.row.primary_color).toBe("#0F766E");
    // Absent fields normalize to null (cleared back to the resolver fallback).
    expect(res.row.support_phone).toBeNull();
    // The row NEVER carries logo columns — upload is deferred.
    expect(Object.keys(res.row)).not.toContain("logo_url");
    expect(Object.keys(res.row)).not.toContain("portal_logo_url");
  });

  it("an empty string clears the field to null", () => {
    const res = validateBrandingDraft({ display_name: "   " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.display_name).toBeNull();
  });

  it("rejects a non-hex color", () => {
    const res = validateBrandingDraft({ primary_color: "teal" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.primary_color).toBe("invalid_color");
  });

  it("rejects markup in a text value (email/PDF/portal safety)", () => {
    const res = validateBrandingDraft({ email_footer: "<script>x</script>" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.email_footer).toBe("invalid_text");
  });

  it("rejects a malformed support email", () => {
    const res = validateBrandingDraft({ support_email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.support_email).toBe("invalid_email");
  });

  it("does NOT introduce unsupported branding fields", () => {
    // The editable set is exactly the safe text + theme columns — no favicon, no dark
    // mode, no accent (those columns do not exist), no logo (upload deferred).
    expect([...EDITABLE_BRANDING_FIELDS].sort()).toEqual(
      [
        "display_name",
        "email_footer",
        "invoice_footer_text",
        "pdf_header_text",
        "primary_color",
        "secondary_color",
        "support_email",
        "support_phone",
        "tagline",
      ].sort(),
    );
  });
});

describe("changedBrandingFields — names only, for the audit diff", () => {
  it("reports exactly the columns whose value changed", () => {
    const next = validateBrandingDraft({ display_name: "New", primary_color: "#111111" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const changed = changedBrandingFields(next.row, { display_name: "Old", primary_color: "#111111" });
    expect(changed).toContain("display_name");
    expect(changed).not.toContain("primary_color"); // unchanged
  });

  it("treats a first-ever save (no current row) as changing the set fields", () => {
    const next = validateBrandingDraft({ tagline: "Hello" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const changed = changedBrandingFields(next.row, null);
    expect(changed).toContain("tagline");
    // Untouched empty fields are not "changed".
    expect(changed).not.toContain("display_name" as EditableBrandingField);
  });
});

// ---------------------------------------------------------------- wiring ----

describe("the branding write is platform-gated, validated and safely audited", () => {
  it("gates on the platform company-management permission", () => {
    expect(actions).toContain('assertPlatformPermission("platform:companies:update")');
    expect(actions).toContain('return { ok: false, error: "unauthorized" }');
  });

  it("validates the tenant and the draft server-side", () => {
    expect(actions).toContain('.from("organization")');
    expect(actions).toContain("validateBrandingDraft(draft)");
    expect(actions).toContain('error: "not_found"');
  });

  it("preserves logo columns — the upsert writes only the validated editable row", () => {
    // logo_url / portal_logo_url are never in the write payload, so an existing logo
    // survives. Upload is deferred (no public storage bucket).
    expect(code("../lib/platform/branding-actions.ts")).not.toContain("logo_url");
    expect(actions).toContain(".upsert({ tenant_id: tenantId, ...validation.row }");
  });

  it("audits with changed field NAMES only — never the values", () => {
    expect(AuditActions.PLATFORM_BRANDING_UPDATED).toBe("platform.branding.updated");
    expect(actions).toContain("AuditActions.PLATFORM_BRANDING_UPDATED");
    expect(actions).toContain("after: { changedFields: changed }");
  });

  it("marks branding_complete so onboarding reflects reality", () => {
    expect(actions).toContain("branding_complete: true");
  });
});

describe("the client editor holds no authority and does not persist a preview", () => {
  it("no admin client, no service role, no direct DB access in the client chunk", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "SUPABASE_SERVICE", ".from("]) {
      expect(code("../components/platform/branding-editor.tsx"), forbidden).not.toContain(forbidden);
    }
  });

  it("the preview is local state; Cancel restores the persisted values", () => {
    expect(editor).toContain("const persisted = useMemo");
    expect(editor).toContain("setDraft(persisted)"); // onCancel restores
    // A change performs no tenant operation — the only write is the explicit Save action.
    expect(editor).toContain("updateTenantBranding(tenantId, draft)");
    expect(editor).toContain('aria-live="polite"');
  });

  it("the detail page renders the editor from the raw persisted row (one source)", () => {
    expect(detail).toContain("getTenantBrandingRow");
    expect(detail).toContain("BrandingEditor");
  });
});
