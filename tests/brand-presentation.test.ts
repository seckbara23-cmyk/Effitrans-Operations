/**
 * DBC-5 — presentation + communication platform: registries, deck model, SVG slide/banner
 * renderers, PPTX (OOXML) validity, brand injection, escaping, permissions, audit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveComplianceCopy } from "@/lib/brand/model";
import {
  buildCorporateDeck, presentationReadiness, buildCommunicationModel, type DeckInput,
} from "@/lib/brand/presentation/model";
import { renderSlideSvg, renderCommunicationSvg } from "@/lib/brand/presentation/svg";
import { buildPptx } from "@/lib/brand/pptx/ooxml";
import { PRESENTATION_TYPES, ACTIVE_PRESENTATIONS, SLIDE_TYPES, COMMUNICATION_META, isPresentationType } from "@/lib/brand/presentation/registry";
import { AuditActions } from "@/lib/audit/events";
import type { BrandProfile, MembershipView } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

function profile(over: Partial<BrandProfile> = {}): BrandProfile {
  return {
    colorGreen: "#0A7D3B", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: "Montserrat", fontBody: "Open Sans", fontEmailFallback: "Calibri",
    slogan: "Performance in Motion", valueProposition: "Integrated Logistics", address: "Dakar",
    legalIdentifiers: null, websiteUrl: "https://www.effitrans.com", linkedinUrl: null,
    whistleblowerUrl: "https://wb.example/secret", compliance: resolveComplianceCopy({}), ...over,
  };
}
function membership(over: Partial<MembershipView> = {}): MembershipView {
  return { id: "m1", organizationName: "WCA First", membershipId: "1", officialUrl: null, status: "active", validFrom: null, expiresAt: null, displayOrder: 0, logoAssetId: null, assetUseNotes: null, ...over };
}
function deck(over: Partial<DeckInput> = {}) {
  const input: DeckInput = { presentationType: "CORPORATE", title: "Deck Effitrans", subtitle: "S", presenter: "A. NIANG", agenda: ["Intro", "Offre"], sections: [{ title: "Notre offre", bullets: ["Transit", "Douane"] }], ...over };
  return buildCorporateDeck({ deck: input, companyName: "Effitrans", profile: profile(), memberships: [membership()] });
}

// ---------------------------------------------------------------- registries ----

describe("registries", () => {
  it("CORPORATE is the only active presentation type; slides + kinds defined", () => {
    expect(ACTIVE_PRESENTATIONS).toEqual(["CORPORATE"]);
    expect([...PRESENTATION_TYPES]).toContain("EXECUTIVE"); // future, present in registry
    expect([...SLIDE_TYPES]).toEqual(["TITLE", "AGENDA", "SECTION", "CONTENT", "IMAGE", "TABLE", "CHART", "TIMELINE", "QUOTE", "THANK_YOU"]);
    expect(COMMUNICATION_META.COMPANY_BANNER).toEqual({ label: expect.any(String), width: 1128, height: 191 });
    expect(COMMUNICATION_META.CEO_BANNER.width).toBe(1584);
    expect(isPresentationType("CORPORATE")).toBe(true);
  });
});

// ---------------------------------------------------------------- deck model ----

describe("deck model is brand-driven", () => {
  const d = deck();
  it("builds Cover/Agenda/Section+Content/Table/Chart/Closing", () => {
    const types = d.slides.map((s) => s.type);
    expect(types[0]).toBe("TITLE");
    expect(types).toContain("AGENDA");
    expect(types).toContain("SECTION");
    expect(types).toContain("CONTENT");
    expect(types).toContain("TABLE");
    expect(types).toContain("CHART");
    expect(types[types.length - 1]).toBe("THANK_YOU");
  });
  it("injects brand colours + active ordered memberships (from Brand Center)", () => {
    expect(d.brand.green).toBe("#0A7D3B");
    expect(d.brand.memberships).toEqual(["WCA First"]);
  });
  it("readiness gates on green + address", () => {
    expect(presentationReadiness(profile()).ready).toBe(true);
    expect(presentationReadiness(profile({ colorGreen: null })).missing).toContain("Couleur verte officielle");
  });
});

// ---------------------------------------------------------------- SVG ----

describe("slide + communication SVG renderers", () => {
  const d = deck();
  it("each slide renders a valid, brand-coloured SVG with no script", () => {
    d.slides.forEach((s, i) => {
      const svg = renderSlideSvg(s, d.brand, i, d.slides.length);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("0A7D3B"); // brand green present
      expect(svg).not.toContain("<script");
    });
  });
  it("escapes injected markup in slide text", () => {
    const svg = renderSlideSvg({ type: "CONTENT", title: "<script>x</script>", bullets: ["a & b <i>"] }, d.brand, 0, 1);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>x");
  });
  it("communication SVG has correct dimensions + escapes; CEO banner shows the person", () => {
    const m = buildCommunicationModel({ kind: "CEO_BANNER", width: 1584, height: 396, companyName: "Effitrans", profile: profile(), headline: "H & <b>", person: { name: "A. NIANG", title: "CEO" } });
    const svg = renderCommunicationSvg(m);
    expect(svg).toContain('viewBox="0 0 1584 396"');
    expect(svg).toContain("A. NIANG");
    expect(svg).toContain("H &amp; &lt;b&gt;");
    expect(svg).not.toContain("<script");
  });
});

// ---------------------------------------------------------------- PPTX (OOXML) ----

describe("PPTX is a valid, editable OOXML package (reuses the ZIP writer, not HTML)", () => {
  const bytes = buildPptx(deck());
  const s = latin1(bytes);
  it("is a ZIP with the required presentation parts", () => {
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b); // 'PK'
    for (const part of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide1.xml"]) {
      expect(s, part).toContain(part);
    }
    expect(s).toContain("<p:presentation");
    expect(s).not.toContain("<html");
  });
  it("has one slide part per deck slide + injects the brand colour into the theme", () => {
    const d = deck();
    for (let i = 1; i <= d.slides.length; i++) expect(s).toContain(`ppt/slides/slide${i}.xml`);
    expect(s).toContain("0A7D3B"); // brand green in theme/slides
    expect(s).toContain("Effitrans");
  });
  it("XML-escapes injected slide text (no injection)", () => {
    const evil = latin1(buildPptx(buildCorporateDeck({ deck: { presentationType: "CORPORATE", title: "<script>&\"x", agenda: ["a & b"] }, companyName: "Z", profile: profile(), memberships: [] })));
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).not.toContain("<script>&");
  });
  it("is deterministic", () => {
    expect(latin1(buildPptx(deck()))).toBe(latin1(buildPptx(deck())));
  });
});

// ---------------------------------------------------------------- server action ----

describe("generation is server-side, gated, safely audited", () => {
  const actions = read("../lib/brand/server/presentation-actions.ts");
  it("gates on admin:config:manage (no new permission) and refuses incomplete branding", () => {
    expect(actions).toContain('assertPermission("admin:config:manage")');
    expect(actions).toContain("presentationReadiness(core.profile)");
    expect(actions).toContain("ready: false, missing: readiness.missing");
  });
  it("reuses readBrandCore + the pure builders (React never generates)", () => {
    expect(actions).toContain("readBrandCore(admin.tenantId)");
    expect(actions).toContain("buildPptx(deck)");
    expect(actions).toContain("renderSlideSvg(");
    expect(actions).toContain("renderCommunicationSvg(model)");
  });
  it("audits type/kind only — never the slides, PPTX, or content", () => {
    const audits = code("../lib/brand/server/presentation-actions.ts").split("writeAudit(").slice(1).map((x) => x.slice(0, x.indexOf("});")));
    for (const a of audits) for (const bad of ["svg", "pptx", "base64", "headline", "bullets", "slidesSvg"]) expect(a, bad).not.toContain(bad);
    expect(AuditActions.BRAND_PRESENTATION_GENERATED).toBe("brand.presentation.generated");
    expect(AuditActions.BRAND_COMMUNICATION_GENERATED).toBe("brand.communication.generated");
  });
});

// ---------------------------------------------------------------- UI ----

describe("studios + overview", () => {
  it("studios hold no admin client / service role and render server output", () => {
    for (const c of ["../components/brand/presentation-studio.tsx", "../components/brand/communication-studio.tsx"]) {
      for (const forbidden of ["getAdminSupabaseClient", "service_role", "readBrandCore", "buildPptx"]) {
        expect(code(c), `${c}:${forbidden}`).not.toContain(forbidden);
      }
    }
    expect(read("../components/brand/presentation-studio.tsx")).toContain("generateDeck(");
  });
  it("the overview surfaces Présentations + Réseaux sociaux (phases shipped)", () => {
    const ov = read("../app/brand-center/page.tsx");
    expect(ov).toContain("/brand-center/presentations");
    expect(ov).toContain("/brand-center/social");
  });
});
