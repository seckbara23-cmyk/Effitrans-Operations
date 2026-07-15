/**
 * DBC-2 — email signature engine: model resolution, deterministic compiler, plain text,
 * Outlook-safety, escaping, gating, and the server/UI guarantees.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveComplianceCopy } from "@/lib/brand/model";
import { signatureReadiness, buildSignatureModel, type SignatureEmployee } from "@/lib/brand/signature/model";
import { compileSignatureHtml, compileSignatureText } from "@/lib/brand/signature/compiler";
import { validateSignatureHtml } from "@/lib/brand/signature/validate";
import { AuditActions } from "@/lib/audit/events";
import type { BrandProfile, BrandAssetView, MembershipView } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const WB = "https://whistleblowersoftware.com/secure/abc-123";

function profile(over: Partial<BrandProfile> = {}): BrandProfile {
  return {
    colorGreen: "#0A7D3B", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: "Montserrat", fontBody: "Open Sans", fontEmailFallback: "Calibri",
    slogan: "Performance in Motion", valueProposition: "Integrated Logistics | Customs | Project Cargo",
    address: "Dakar, Sénégal", legalIdentifiers: null, websiteUrl: "https://www.effitrans.com", linkedinUrl: null,
    whistleblowerUrl: WB, compliance: resolveComplianceCopy({}), ...over,
  };
}
function asset(over: Partial<BrandAssetView> = {}): BrandAssetView {
  return { id: "a1", kind: "LOGO_EMAIL_PNG", title: null, publicUrl: "https://cdn/brand-assets/t/logos/a1/v1/logo.png", version: 1, mime: "image/png", bytes: 5000, width: 120, height: 48, altText: "Effitrans", status: "PUBLISHED", createdAt: "2026-07-15", ...over };
}
function membership(over: Partial<MembershipView> = {}): MembershipView {
  return { id: "m1", organizationName: "WCA First", membershipId: "93972", officialUrl: null, status: "active", validFrom: null, expiresAt: null, displayOrder: 0, logoAssetId: null, assetUseNotes: null, ...over };
}
const employee: SignatureEmployee = { name: "Abdoul Lahad NIANG", email: "abdoul@effitrans.com", title: "Managing Director | CEO", variant: "EXECUTIVE", phoneOffice: "+221338670267", phoneMobile: "+221763565859", whatsapp: "+221763565859" };

// ---------------------------------------------------------------- readiness ----

describe("readiness gates production generation — nothing substituted", () => {
  it("is ready with logo + green + address + compliance + title", () => {
    expect(signatureReadiness(profile(), [asset()], employee).ready).toBe(true);
  });
  it("lists each missing required input honestly", () => {
    const r = signatureReadiness(profile({ colorGreen: null, address: null, whistleblowerUrl: null }), [], { ...employee, title: null });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining([
      "Logo e-mail approuvé (PNG)", "Couleur verte officielle", "Adresse de l'entreprise",
      "URL du portail de signalement", "Fonction du collaborateur",
    ]));
  });
});

// ---------------------------------------------------------------- model ----

describe("buildSignatureModel resolves from the Brand Center only", () => {
  const model = buildSignatureModel({ companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [membership({ displayOrder: 1, organizationName: "FIATA" }), membership({ displayOrder: 0, organizationName: "WCA First" })], employee });
  it("orders active memberships by display order; excludes inactive", () => {
    const m2 = buildSignatureModel({ companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [membership({ status: "inactive", organizationName: "OLD" }), membership({ organizationName: "WCA First" })], employee });
    expect(m2.memberships.map((m) => m.name)).toEqual(["WCA First"]);
    expect(model.memberships.map((m) => m.name)).toEqual(["WCA First", "FIATA"]);
  });
  it("carries the compliance portal URL + label from the Brand Center", () => {
    expect(model.compliance.portalUrl).toBe(WB);
    expect(model.compliance.buttonLabel).toBe("Report Confidentially");
    expect(model.sustainability).toBe("Committed to Sustainable Logistics");
  });
});

// ---------------------------------------------------------------- compiler: HTML ----

describe("the HTML compiler is Outlook-safe and deterministic", () => {
  const model = buildSignatureModel({ companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [membership()], employee });
  const html = compileSignatureHtml(model);

  it("passes the safety validator (tables, inline CSS, no script/flex/grid/vml/js-url)", () => {
    expect(validateSignatureHtml(html)).toEqual({ ok: true });
  });
  it("is table-based with inline styles and no <style>/<script>/flex/grid", () => {
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });
  it("is deterministic — same model, same bytes", () => {
    expect(compileSignatureHtml(model)).toBe(html);
  });
  it("renders the whistleblower URL ONLY as a button href, never as visible text", () => {
    expect(html).toContain(`href="${WB}"`);
    // The URL must not appear as text content between tags.
    expect(html).not.toContain(`>${WB}<`);
    expect(html).toContain("Report Confidentially");
  });
  it("images carry alt + explicit dimensions", () => {
    expect(html).toMatch(/<img[^>]+alt="Effitrans"/);
    expect(html).toMatch(/<img[^>]+height="48"/);
  });
  it("escapes injected markup in employee fields", () => {
    const evil = compileSignatureHtml(buildSignatureModel({ companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [], employee: { ...employee, name: '<script>alert(1)</script>', title: 'CEO"><img src=x onerror=alert(1)>' } }));
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;");
    expect(validateSignatureHtml(evil).ok).toBe(true);
  });
});

describe("variants differ (CORPORATE compact; EXECUTIVE/MANAGEMENT full)", () => {
  const base = { companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [membership()] };
  it("CORPORATE omits memberships + compliance button", () => {
    const html = compileSignatureHtml(buildSignatureModel({ ...base, employee: { ...employee, variant: "CORPORATE" } }));
    expect(html).not.toContain("Report Confidentially");
    expect(html).not.toContain("WCA First");
    expect(html).toContain("Committed to Sustainable Logistics"); // still present
  });
  it("EXECUTIVE/MANAGEMENT include memberships + compliance", () => {
    for (const v of ["EXECUTIVE", "MANAGEMENT"] as const) {
      const html = compileSignatureHtml(buildSignatureModel({ ...base, employee: { ...employee, variant: v } }));
      expect(html).toContain("Report Confidentially");
      expect(html).toContain("WCA First");
    }
  });
});

// ---------------------------------------------------------------- compiler: text ----

describe("the plain-text compiler is readable and leaks no URL", () => {
  const model = buildSignatureModel({ companyName: "Effitrans", profile: profile(), assets: [asset()], memberships: [membership()], employee });
  const text = compileSignatureText(model);
  it("has no HTML and no raw compliance URL", () => {
    expect(text).not.toContain("<");
    expect(text).not.toContain(WB);
    expect(text).not.toContain("whistleblower");
  });
  it("represents the reporting portal as a LABEL, includes identity + sustainability", () => {
    expect(text).toContain("Abdoul Lahad NIANG");
    expect(text).toContain("abdoul@effitrans.com");
    expect(text).toContain("Confidential Reporting Portal");
    expect(text).toContain("Committed to Sustainable Logistics");
  });
});

// ---------------------------------------------------------------- validator ----

describe("validateSignatureHtml catches unsafe output", () => {
  it("flags script / flex / external css / js-url", () => {
    expect(validateSignatureHtml("<div>no table</div>").ok).toBe(false);
    expect(validateSignatureHtml("<table><script>x</script></table>")).toMatchObject({ ok: false });
    expect(validateSignatureHtml('<table style="display:flex"></table>')).toMatchObject({ ok: false });
    expect(validateSignatureHtml('<table><a href="javascript:x">y</a></table>')).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------- server action ----

describe("generation is server-side, gated, tenant-scoped, and safely audited", () => {
  const actions = read("../lib/brand/server/signature-actions.ts");
  it("gates on admin:users:manage (no new permission) and scopes to the tenant", () => {
    expect(actions).toContain('assertPermission("admin:users:manage")');
    expect(actions).toContain("u.tenant_id !== tenantId");
  });
  it("refuses when the Brand Center is incomplete (no substitution)", () => {
    expect(actions).toContain("signatureReadiness(");
    expect(actions).toContain("ready: false, missing: readiness.missing");
  });
  it("runs the PURE compiler + validates output — React never generates it", () => {
    expect(actions).toContain("compileSignatureHtml(model)");
    expect(actions).toContain("compileSignatureText(model)");
    expect(actions).toContain("validateSignatureHtml(html)");
  });
  it("audits safe metadata only — never the html/text/urls/phones", () => {
    const audits = code("../lib/brand/server/signature-actions.ts").split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
    for (const a of audits) {
      for (const bad of ["html", "text", "portalUrl", "whistleblower", "phone", "compileSignature"]) expect(a, bad).not.toContain(bad);
    }
    expect(actions).toContain("after: { variant: employee.variant }");
    expect(AuditActions.BRAND_SIGNATURE_GENERATED).toBe("brand.signature.generated");
  });
});

// ---------------------------------------------------------------- UI ----

describe("the studio holds no authority and is honest about the preview", () => {
  const studio = read("../components/brand/signature-studio.tsx");
  it("no admin client / service role; calls the server action for compilation", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "compileSignatureHtml", "readBrandCore"]) {
      expect(code("../components/brand/signature-studio.tsx"), forbidden).not.toContain(forbidden);
    }
    expect(studio).toContain("compileEmployeeSignature(userId");
  });
  it("states the preview is indicative (no pixel-perfect claim) and offers download+copy", () => {
    expect(studio).toContain("indicatif");
    expect(studio).toContain("Télécharger HTML");
    expect(studio).toContain("Copier HTML");
    expect(studio).toContain("Télécharger texte");
  });
  it("the guides page reports compatibility honestly (manual P0, no Litmus)", () => {
    const guides = read("../app/brand-center/guides/page.tsx");
    expect(guides).toContain("validation manuelle P0");
    expect(guides).toContain("Litmus");
  });
});
