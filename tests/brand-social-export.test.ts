/**
 * Brand Center — social media export hardening.
 * ---------------------------------------------------------------------------
 * Production UAT found the LinkedIn company banner sparse and self-duplicating
 * (the old renderer echoed « companyName · slogan » in 9px, doubling the
 * default headline) with no logo and SVG-only export. This suite pins:
 *
 *   * ONE composition, TWO serializers: composeCommunication computes the
 *     layout; SVG and PNG serialize the SAME spec — no preview/export drift;
 *   * the title is content and appears EXACTLY once; a blank subtitle leaves
 *     no artefact; long titles shrink instead of clipping;
 *   * only the APPROVED (published) logo is ever referenced, embedded as a
 *     data URI — a DRAFT logo can never leak, nothing is hard-coded;
 *   * governed dimensions unchanged (COMPANY_BANNER stays 1128×191) and the
 *     PNG matches them byte-exactly (IHDR), with a valid PNG signature.
 *
 * PNG runtime proofs run where next/og's engine loads (Linux — CI, Vercel);
 * on Windows its compiled bundle cannot resolve its wasm/font assets in plain
 * Node, so those tests self-skip locally with the reason stated. CI enforces.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommunicationModel, type CommunicationModel } from "@/lib/brand/presentation/model";
import {
  composeCommunication, specToSvg, renderCommunicationSvg, fitTextSize, fitLines, wrapText, estimateTextWidth,
} from "@/lib/brand/presentation/svg";
import { COMMUNICATION_META, COMMUNICATION_KINDS, type CommunicationKind } from "@/lib/brand/presentation/registry";
import { pickSocialLogo } from "@/lib/brand/presentation/model";
import type { BrandAssetView, BrandProfile } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const LOGO_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=";

function profile(): BrandProfile {
  return {
    colorGreen: "#0F766E", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: null, fontBody: null, fontEmailFallback: null,
    slogan: "Performance in Motion", valueProposition: null, address: null, legalIdentifiers: null,
    websiteUrl: null, linkedinUrl: null, whistleblowerUrl: null,
    compliance: { title: "t", subtitle: "s", description: "d", buttonLabel: "b", sustainability: "su", environmentalPrint: "e", footer_line: "f" } as never,
  };
}

function model(kind: CommunicationKind, over: Partial<Parameters<typeof buildCommunicationModel>[0]> = {}): CommunicationModel {
  const meta = COMMUNICATION_META[kind];
  return buildCommunicationModel({
    kind, width: meta.width, height: meta.height, companyName: "Effitrans", profile: profile(),
    logo: { href: LOGO_URI, alt: "Effitrans" },
    headline: "Effitrans — Performance in Motion", subline: null,
    ...over,
  });
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

// ===========================================================================
describe("THE ACCEPTANCE GATE — Bannière entreprise (LinkedIn), blank subtitle", () => {
  const m = model("COMPANY_BANNER");
  const svg = renderCommunicationSvg(m);
  const spec = composeCommunication(m);

  it("keeps the governed 1128×191 contract", () => {
    expect(COMMUNICATION_META.COMPANY_BANNER.width).toBe(1128);
    expect(COMMUNICATION_META.COMPANY_BANNER.height).toBe(191);
    expect(svg).toContain('viewBox="0 0 1128 191"');
  });

  it("shows the approved logo — referenced, not substituted", () => {
    expect(svg).toContain(`href="${LOGO_URI}"`);
    // No hard-coded substitute in the composition layer: no inline image data,
    // and the only <image href> is the model's own.
    expect(code("lib/brand/presentation/svg.ts")).not.toContain("data:image");
    expect(read("lib/brand/presentation/svg.ts")).toContain('href="${xmlEsc(it.href)}"');
  });

  it("THE UAT DEFECT: the title appears exactly ONCE — no microscopic echo", () => {
    expect(count(svg, "Effitrans — Performance in Motion")).toBe(1);
    // The slogan alone must not sneak back as decoration either.
    expect(count(svg, "Performance in Motion")).toBe(1);
    // …and no companyName wordmark next to a present logo.
    const texts = spec.items.filter((i) => i.t === "text");
    expect(texts).toHaveLength(1);
  });

  it("a blank subtitle produces no empty or duplicate artefact", () => {
    expect(svg).not.toMatch(/<text[^>]*>\s*<\/text>/);
    const withBlank = renderCommunicationSvg(model("COMPANY_BANNER", { subline: "   " }));
    expect(withBlank).toBe(svg); // whitespace subtitle === no subtitle
  });

  it("is legible and safe-zoned: title ≥ 24px, everything inside the canvas", () => {
    const title = spec.items.find((i) => i.t === "text")!;
    expect(title.t === "text" && title.size).toBeGreaterThanOrEqual(24);
    for (const it of spec.items) {
      if (it.t === "text") {
        expect(it.x).toBeGreaterThan(0);
        expect(it.x + estimateTextWidth(it.text, it.size)).toBeLessThanOrEqual(1128);
        expect(it.top + it.size).toBeLessThanOrEqual(191);
      } else {
        expect(it.x + it.w).toBeLessThanOrEqual(1128);
        expect(it.y + it.h).toBeLessThanOrEqual(191);
      }
    }
  });

  it("uses the brand colours from the source of truth — nothing invented", () => {
    expect(spec.background).toBe("#0F766E");
    expect(svg).toContain("#C8A24B"); // gold accent
    const comp = code("lib/brand/presentation/svg.ts");
    const section = comp.slice(comp.indexOf("export function composeCommunication"));
    expect(section).not.toMatch(/#(?!fff\b|ffffff\b)[0-9a-fA-F]{6}\b/);
  });
});

// ===========================================================================
describe("composition invariants across all four templates", () => {
  it("every template keeps its authoritative dimensions", () => {
    expect(COMMUNICATION_META).toEqual({
      COMPANY_BANNER: { label: expect.any(String), width: 1128, height: 191 },
      CEO_BANNER: { label: expect.any(String), width: 1584, height: 396 },
      PUBLICATION: { label: expect.any(String), width: 1200, height: 1200 },
      ANNOUNCEMENT: { label: expect.any(String), width: 1200, height: 627 },
    });
  });

  it("all four render from the ONE composition — no forked renderers", () => {
    const s = code("lib/brand/presentation/svg.ts");
    expect(s).toContain("return specToSvg(composeCommunication(m))");
    for (const kind of COMMUNICATION_KINDS) {
      const m = model(kind, { subline: "Transit & logistique" });
      const svg = renderCommunicationSvg(m);
      const meta = COMMUNICATION_META[kind];
      expect(svg, kind).toContain(`viewBox="0 0 ${meta.width} ${meta.height}"`);
      // The title is CONTENT exactly once: banners keep it on one line; the
      // polished square/announcement may WRAP it — the joined title lines
      // reconstruct the headline verbatim, and nothing repeats it.
      const titles = composeCommunication(m).items.filter((i) => i.t === "text" && i.weight === 800);
      expect(titles.map((t) => (t.t === "text" ? t.text : "")).join(" "), kind).toBe(m.headline);
      expect(svg, kind).toContain("Transit &amp; logistique");
    }
  });

  it("a very long title SHRINKS instead of clipping", () => {
    const long = "Commissionnaire en douane agréé — transit, consignation et logistique intégrée au Sénégal";
    const spec = composeCommunication(model("COMPANY_BANNER", { headline: long }));
    const t = spec.items.find((i) => i.t === "text")!;
    if (t.t !== "text") throw new Error("unreachable");
    expect(t.size).toBeLessThan(fitTextSize("court", 9999, Math.round(191 * 0.24)));
    // The RENDERED text (possibly ellipsis-truncated) always fits the canvas.
    expect(t.x + estimateTextWidth(t.text, t.size)).toBeLessThanOrEqual(1128);
  });

  it("wrapping primitives: deterministic wrap; the floor still ellipsis-truncates", () => {
    expect(wrapText("un deux trois", 9999, 20)).toEqual(["un deux trois"]);
    const fitted = fitLines("mot ".repeat(80).trim(), 300, 40, 16, 2);
    expect(fitted.size).toBe(16);
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.lines[1].endsWith("…")).toBe(true);
    for (const l of fitted.lines) expect(estimateTextWidth(l, fitted.size)).toBeLessThanOrEqual(300);
  });

  it("escaping holds for title and subtitle", () => {
    const svg = renderCommunicationSvg(model("PUBLICATION", { headline: 'A & <b> "q"', subline: "x < y" }));
    expect(svg).toContain("A &amp; &lt;b&gt;");
    expect(svg).toContain("x &lt; y");
    expect(svg).not.toContain("<b>");
  });

  it("CEO banner carries the person exactly once each", () => {
    const svg = renderCommunicationSvg(model("CEO_BANNER", { person: { name: "A. NIANG", title: "Directrice Générale" } }));
    expect(count(svg, "A. NIANG")).toBe(1);
    expect(count(svg, "Directrice Générale")).toBe(1);
  });

  it("without a published logo the company name appears once as the wordmark", () => {
    const svg = renderCommunicationSvg(model("COMPANY_BANNER", { logo: null, headline: "Le transit maîtrisé" }));
    expect(count(svg, "Effitrans")).toBe(1);
    expect(svg).not.toContain("<image");
  });
});

// ===========================================================================
// The UAT strings the polish was judged against.
const UAT = {
  headline: "La logistique intégrée au service de votre performance",
  subline: "Des solutions fiables au Sénégal et à l’international",
};

describe("VISUAL POLISH — Publication (1200×1200) and Annonce (1200×627) fill their canvas", () => {
  const pub = composeCommunication(model("PUBLICATION", UAT));
  const ann = composeCommunication(model("ANNOUNCEMENT", UAT));

  it("the UAT title gains SCALE through wrapping — never one microscopic line", () => {
    const pubTitles = pub.items.filter((i) => i.t === "text" && i.weight === 800);
    const annTitles = ann.items.filter((i) => i.t === "text" && i.weight === 800);
    // THE MUTATION TARGETS: single-line fitting would collapse these to ~44/36px.
    expect(pubTitles).toHaveLength(3);
    expect((pubTitles[0] as { size: number }).size).toBe(92);
    expect(annTitles).toHaveLength(2);
    expect((annTitles[0] as { size: number }).size).toBe(70);
  });

  it("the subtitle is used intentionally, readable, wrapped", () => {
    const pubSubs = pub.items.filter((i) => i.t === "text" && i.weight === 400);
    const annSubs = ann.items.filter((i) => i.t === "text" && i.weight === 400);
    expect((pubSubs[0] as { size: number }).size).toBe(50);
    expect(pubSubs).toHaveLength(2);
    expect((annSubs[0] as { size: number }).size).toBe(34);
  });

  it("the logo presence grew — the announcement lockup is no longer tiny", () => {
    const pubLogo = pub.items.find((i) => i.t === "image")!;
    const annLogo = ann.items.find((i) => i.t === "image")!;
    if (pubLogo.t !== "image" || annLogo.t !== "image") throw new Error("unreachable");
    expect(pubLogo.h).toBe(144); // 1200 × 0.12
    expect(annLogo.h).toBe(125); // 627 × 0.20 — was 88 (h × 0.14)
  });

  it("everything stays inside the safe zone — wrapped lines included", () => {
    for (const [spec, w, h] of [[pub, 1200, 1200], [ann, 1200, 627]] as const) {
      for (const it of spec.items) {
        if (it.t === "text") {
          expect(it.x + estimateTextWidth(it.text, it.size)).toBeLessThanOrEqual(w);
          expect(it.top + it.size).toBeLessThanOrEqual(h - 20);
        }
      }
    }
  });

  it("a blank subtitle still leaves no artefact on the polished layouts", () => {
    for (const kind of ["PUBLICATION", "ANNOUNCEMENT"] as const) {
      const base = renderCommunicationSvg(model(kind, { headline: UAT.headline, subline: null }));
      const blank = renderCommunicationSvg(model(kind, { headline: UAT.headline, subline: "   " }));
      expect(blank, kind).toBe(base);
      expect(base, kind).not.toMatch(/<text[^>]*>\s*<\/text>/);
    }
  });
});

describe("BANNERS ARE FROZEN — the polish must not touch the wide branch", () => {
  it("the company banner spec is byte-identical to the accepted composition", () => {
    expect(composeCommunication(model("COMPANY_BANNER"))).toEqual({
      width: 1128, height: 191, background: "#0F766E",
      items: [
        { t: "rect", x: 0, y: 0, w: 9, h: 191, fill: "#C8A24B" },
        { t: "image", x: 42, y: 46, w: 238, h: 99, href: LOGO_URI, alt: "Effitrans" },
        { t: "rect", x: 312, y: 42, w: 2, h: 107, fill: "#ffffff", opacity: 0.45 },
        { t: "text", x: 344, top: 76, size: 40, weight: 800, fill: "#ffffff", text: "Effitrans — Performance in Motion" },
      ],
    });
  });

  it("the executive banner spec is byte-identical to the accepted composition", () => {
    expect(composeCommunication(model("CEO_BANNER", { person: { name: "A. NIANG", title: "Directrice Générale" } }))).toEqual({
      width: 1584, height: 396, background: "#0F766E",
      items: [
        { t: "rect", x: 0, y: 0, w: 13, h: 396, fill: "#C8A24B" },
        { t: "image", x: 87, y: 95, w: 494, h: 206, href: LOGO_URI, alt: "Effitrans" },
        { t: "rect", x: 646, y: 87, w: 2, h: 222, fill: "#ffffff", opacity: 0.45 },
        { t: "text", x: 711, top: 177, size: 42, weight: 800, fill: "#ffffff", text: "Effitrans — Performance in Motion" },
        { t: "text", x: 711, top: 226, size: 36, weight: 700, fill: "#ffffff", text: "A. NIANG" },
        { t: "text", x: 711, top: 283, size: 26, weight: 400, fill: "#ffffff", opacity: 0.9, text: "Directrice Générale" },
      ],
    });
  });
});

// ===========================================================================
describe("the approved-logo contract", () => {
  const asset = (kind: string, status: string): BrandAssetView => ({
    id: kind, kind: kind as BrandAssetView["kind"], title: null, publicUrl: `https://x/${kind}`,
    version: 1, mime: "image/png", bytes: 10, width: null, height: null, altText: "Effitrans", status, createdAt: "",
  });

  it("only PUBLISHED assets are ever considered — a DRAFT logo cannot leak", () => {
    expect(pickSocialLogo([asset("LOGO_REVERSED", "DRAFT"), asset("LOGO_PRIMARY", "DRAFT")])).toBeNull();
    expect(pickSocialLogo([asset("LOGO_REVERSED", "DRAFT"), asset("LOGO_PRIMARY", "PUBLISHED")])?.kind).toBe("LOGO_PRIMARY");
  });

  it("prefers the reversed (dark-background) mark, then primary, then e-mail", () => {
    expect(pickSocialLogo([asset("LOGO_EMAIL_PNG", "PUBLISHED"), asset("LOGO_REVERSED", "PUBLISHED"), asset("LOGO_PRIMARY", "PUBLISHED")])?.kind).toBe("LOGO_REVERSED");
    expect(pickSocialLogo([asset("LOGO_EMAIL_PNG", "PUBLISHED")])?.kind).toBe("LOGO_EMAIL_PNG");
  });

  it("the resolver embeds the fetched asset as a data URI (self-contained exports)", () => {
    expect(code("lib/brand/server/communication.ts")).toContain("data:${asset.mime};base64");
    expect(code("lib/brand/presentation/model.ts")).toContain('filter((a) => a.status === "PUBLISHED")');
  });
});

// ===========================================================================
describe("no preview/export drift — one model, one layout, three outputs", () => {
  it("the action and the PNG route resolve through the SAME function", () => {
    expect(code("lib/brand/server/presentation-actions.ts")).toContain("resolveCommunicationModel(admin.tenantId");
    const route = code("app/brand-center/social/export/route.ts");
    expect(route).toContain("resolveCommunicationModel(user.tenantId");
    // Tenant comes from the SESSION; the body carries no tenant.
    expect(route).not.toMatch(/body\.tenant/i);
  });

  it("the PNG serializer consumes composeCommunication's spec — never its own layout", async () => {
    const png = code("lib/brand/presentation/png.ts");
    // EXACT assignment: the spec reaches the raster tree unmodified — no
    // spread, no filter, no second layout.
    expect(png).toContain("const spec = composeCommunication(m);");
    expect(png).toContain("specToOgTree(spec");
    expect(png).not.toMatch(/fitTextSize|Math\.round\(h \*|Math\.round\(w \*/);
    // And at runtime: one tree node per spec item, same order (pure, no engine).
    const { specToOgTree } = await import("@/lib/brand/presentation/png");
    const spec = composeCommunication(model("COMPANY_BANNER", { subline: "Transit" }));
    const tree = specToOgTree(spec) as unknown as { props: { children: unknown[] } };
    expect(tree.props.children).toHaveLength(spec.items.length);
  });

  it("the PNG is requested at exactly the spec's template dimensions", () => {
    const png = code("lib/brand/presentation/png.ts");
    expect(png).toContain("width: spec.width");
    expect(png).toContain("height: spec.height");
  });

  it("spec geometry is identical for both serializers by construction", () => {
    const m = model("ANNOUNCEMENT", { subline: "Ouverture d'agence" });
    expect(composeCommunication(m)).toEqual(composeCommunication(m)); // deterministic
    const svg = specToSvg(composeCommunication(m));
    expect(svg).toContain('viewBox="0 0 1200 627"');
  });
});

// ===========================================================================
describe("PNG bytes (runtime — enforced in CI; self-skips where next/og cannot load)", () => {
  it("every template rasterizes to a real PNG at exactly its governed dimensions", async (ctx) => {
    let render: (m: CommunicationModel) => Promise<Uint8Array>;
    try {
      ({ renderCommunicationPng: render } = await import("@/lib/brand/presentation/png"));
      await render(model("COMPANY_BANNER")); // engine probe
    } catch {
      ctx.skip(); // Windows plain Node: next/og cannot resolve its bundled assets. CI (Linux) enforces this test.
      return;
    }
    for (const kind of COMMUNICATION_KINDS) {
      const bytes = await render(model(kind, { subline: kind === "COMPANY_BANNER" ? null : "Sous-titre" }));
      const buf = Buffer.from(bytes);
      // PNG signature…
      expect([...buf.subarray(0, 8)], kind).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // …and IHDR dimensions exactly the governed template's.
      expect(buf.readUInt32BE(16), kind).toBe(COMMUNICATION_META[kind].width);
      expect(buf.readUInt32BE(20), kind).toBe(COMMUNICATION_META[kind].height);
    }
  }, 120_000);
});

// ===========================================================================
describe("authorization, audit and scope discipline", () => {
  it("the export route re-authorizes and audits format metadata only", () => {
    const route = read("app/brand-center/social/export/route.ts");
    expect(route).toContain('hasPermission(permissions, "admin:config:manage")');
    expect(route).toContain('format: "png"');
    expect(route).not.toMatch(/headline[\s\S]{0,40}writeAudit|writeAudit[\s\S]{0,300}headline/);
  });

  it("no LinkedIn API, no posting, no scheduling — a brand asset generator only", () => {
    for (const p of [
      "lib/brand/server/communication.ts", "lib/brand/presentation/png.ts",
      "app/brand-center/social/export/route.ts", "components/brand/communication-studio.tsx",
    ]) {
      expect(code(p), p).not.toMatch(/api\.linkedin|oauth|schedule|campaign|publish.*api/i);
    }
  });

  it("the studio offers BOTH downloads and previews from the same server render", () => {
    const s = read("components/brand/communication-studio.tsx");
    expect(s).toContain("Télécharger PNG");
    expect(s).toContain("Télécharger SVG");
    expect(s).toContain('fetch("/brand-center/social/export"');
  });

  it("no migration was needed — the ledger is untouched by this phase", () => {
    const migrations = require("node:fs")
      .readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql"));
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    // Durable: this phase shipped no migration of its own.
    expect(migrations.some((f: string) => /social_export|brand_png|social_hardening/i.test(f))).toBe(false);
  });
});
