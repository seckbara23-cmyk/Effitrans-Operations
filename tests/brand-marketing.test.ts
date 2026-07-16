/**
 * DBC-6 — marketing email engine, merge-tag abstraction, brand governance + lifecycle,
 * unified registry, download center, guides. Pure logic direct; wiring structural.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveComplianceCopy } from "@/lib/brand/model";
import { applyMergeTags, MERGE_TAGS } from "@/lib/brand/marketing/merge";
import { buildMarketingModel, compileMarketingHtml, marketingReadiness, validateMarketingHtml, type MarketingInput } from "@/lib/brand/marketing/compiler";
import { ACTIVE_MARKETING, MARKETING_TEMPLATE_TYPES, EMAIL_PROVIDERS } from "@/lib/brand/marketing/registry";
import { canTransition, LIFECYCLE_STATES, TEMPLATE_CATEGORIES, isPublishable } from "@/lib/brand/governance/lifecycle";
import { UNIFIED_TEMPLATES, findTemplate } from "@/lib/brand/governance/registry";
import { AuditActions } from "@/lib/audit/events";
import type { BrandProfile } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const WB = "https://wb.example/secret";

function profile(over: Partial<BrandProfile> = {}): BrandProfile {
  return {
    colorGreen: "#0A7D3B", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: null, fontBody: null, fontEmailFallback: null,
    slogan: "Performance in Motion", valueProposition: "IL", address: "Dakar", legalIdentifiers: null,
    websiteUrl: "https://www.effitrans.com", linkedinUrl: null, whistleblowerUrl: WB, compliance: resolveComplianceCopy({}), ...over,
  };
}
function model() {
  const input: MarketingInput = { type: "ANNOUNCEMENT", subject: "Sujet", preheader: "Aperçu", headline: "Grande nouvelle", paragraphs: ["Bonjour à tous.", "Voici notre annonce."], cta: { label: "En savoir plus", url: "https://x" } };
  return buildMarketingModel({ marketing: input, companyName: "Effitrans", profile: profile(), logoUrl: "https://cdn/logo.png", logoAlt: "Effitrans" });
}

// ---------------------------------------------------------------- merge tags ----

describe("merge-tag abstraction translates per provider (never hardcoded)", () => {
  it("translates canonical {{FIRST_NAME}} to each ESP's syntax", () => {
    const t = "Bonjour {{FIRST_NAME}}, {{UNSUBSCRIBE_URL}}";
    expect(applyMergeTags(t, "mailchimp")).toBe("Bonjour *|FNAME|*, *|UNSUB|*");
    expect(applyMergeTags(t, "hubspot")).toContain("{{ contact.firstname }}");
    expect(applyMergeTags(t, "dynamics")).toContain("{{FirstName}}");
    expect(applyMergeTags(t, "generic")).toBe(t); // canonical unchanged
  });
  it("leaves unknown tags alone", () => {
    expect(applyMergeTags("{{NOT_A_TAG}}", "mailchimp")).toBe("{{NOT_A_TAG}}");
    expect([...MERGE_TAGS]).toContain("FIRST_NAME");
  });
});

// ---------------------------------------------------------------- compiler ----

describe("marketing compiler emits portable, safe HTML", () => {
  const html = compileMarketingHtml(model(), "mailchimp");
  it("is table-based, inline CSS, no script/flex/grid/external-css", () => {
    expect(validateMarketingHtml(html)).toEqual({ ok: true });
    expect(html).toContain("<table");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });
  it("applies the provider merge tags + keeps an unsubscribe footer", () => {
    expect(html).toContain("*|FNAME|*");
    expect(html).toContain("*|UNSUB|*");
  });
  it("renders the whistleblower URL only as a button href, never as text", () => {
    expect(html).toContain(`href="${WB}"`);
    expect(html).not.toContain(`>${WB}<`);
  });
  it("escapes injected markup + is deterministic", () => {
    const evil = compileMarketingHtml(buildMarketingModel({ marketing: { type: "ANNOUNCEMENT", subject: "s", headline: "<script>x</script>", paragraphs: ["a & b"] }, companyName: "Z", profile: profile(), logoUrl: null, logoAlt: "Z" }), "generic");
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).not.toContain("<script>x");
    expect(compileMarketingHtml(model(), "hubspot")).toBe(compileMarketingHtml(model(), "hubspot"));
  });
  it("readiness gates on green + address + compliance URL", () => {
    expect(marketingReadiness(profile()).ready).toBe(true);
    expect(marketingReadiness(profile({ whistleblowerUrl: null })).missing).toContain("URL du portail de signalement");
  });
  it("only Announcement + Corporate Update are active (others in registry)", () => {
    expect(ACTIVE_MARKETING).toEqual(["ANNOUNCEMENT", "CORPORATE_UPDATE"]);
    expect([...MARKETING_TEMPLATE_TYPES]).toContain("NEWSLETTER");
    expect([...EMAIL_PROVIDERS]).toEqual(["generic", "mailchimp", "hubspot", "dynamics"]);
  });
});

// ---------------------------------------------------------------- governance ----

describe("template lifecycle state machine", () => {
  it("DRAFT→APPROVED→PUBLISHED→RETIRED; illegal transitions rejected", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("APPROVED", "PUBLISHED")).toBe(true);
    expect(canTransition("PUBLISHED", "RETIRED")).toBe(true);
    expect(canTransition("RETIRED", "PUBLISHED")).toBe(false);
    expect(isPublishable("PUBLISHED")).toBe(true);
    expect([...LIFECYCLE_STATES]).toEqual(["DRAFT", "APPROVED", "PUBLISHED", "RETIRED"]);
  });
  it("the unified registry spans every category", () => {
    const cats = new Set(UNIFIED_TEMPLATES.map((t) => t.category));
    for (const c of TEMPLATE_CATEGORIES) expect(cats.has(c)).toBe(true);
    expect(findTemplate("MARKETING_EMAIL", "ANNOUNCEMENT")).toBeDefined();
    expect(findTemplate("SIGNATURE", "NOPE")).toBeUndefined();
  });
});

describe("governance + marketing actions are gated and safely audited", () => {
  const gov = read("../lib/brand/server/governance-actions.ts");
  const mkt = read("../lib/brand/server/marketing-actions.ts");
  it("lifecycle change gates config:manage, validates transition + publish readiness", () => {
    expect(gov).toContain('assertPermission("admin:config:manage")');
    expect(gov).toContain("canTransition(from, target)");
    expect(gov).toContain("isPublishable(target)");
    expect(gov).toContain('error: "brand_incomplete"');
  });
  it("marketing generation gates config:manage, compiles + validates server-side", () => {
    expect(mkt).toContain('assertPermission("admin:config:manage")');
    expect(mkt).toContain("compileMarketingHtml(model, provider)");
    expect(mkt).toContain("validateMarketingHtml(html)");
    expect(mkt).toContain("marketingReadiness(core.profile)");
  });
  it("audits carry metadata only — never the HTML/content", () => {
    for (const src of [gov, mkt]) {
      const audits = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
      for (const a of audits) for (const bad of ["html", "paragraphs", "headline", "subject"]) expect(a, bad).not.toContain(bad);
    }
    expect(AuditActions.BRAND_TEMPLATE_LIFECYCLE_CHANGED).toBe("brand.template.lifecycle_changed");
    expect(AuditActions.BRAND_DOWNLOAD_GENERATED).toBe("brand.download.generated");
  });
});

// ---------------------------------------------------------------- migration + UI ----

describe("governance table + UI wiring", () => {
  it("the brand_template migration follows the isolation doctrine", () => {
    const m = read("../supabase/migrations/20260716000002_brand_template.sql");
    expect(m).toContain("alter table public.brand_template enable row level security");
    expect(m).toContain("public.auth_tenant_id()");
    expect(m).toContain("public.has_permission('admin:config:manage')");
    expect(m).not.toMatch(/for (insert|update|delete) to authenticated/);
    expect(read("../.github/workflows/ci.yml")).toContain("rls_brand_template_test.sql");
  });
  it("studios hold no admin client; overview + downloads + guides complete v1.0", () => {
    for (const c of ["../components/brand/marketing-studio.tsx", "../components/brand/governance-dashboard.tsx"]) {
      for (const forbidden of ["getAdminSupabaseClient", "service_role", "compileMarketingHtml"]) {
        expect(code(c), `${c}:${forbidden}`).not.toContain(forbidden);
      }
    }
    const ov = read("../app/brand-center/page.tsx");
    for (const href of ["/brand-center/marketing", "/brand-center/governance", "/brand-center/downloads"]) expect(ov).toContain(href);
    const guides = read("../app/brand-center/guides/page.tsx");
    for (const esp of ["Mailchimp", "HubSpot", "Microsoft Dynamics"]) expect(guides).toContain(esp);
    expect(guides).toContain("BRAND_GUIDE_VIEWED");
    expect(read("../app/brand-center/downloads/page.tsx")).toContain("Centre de téléchargement");
  });
});
