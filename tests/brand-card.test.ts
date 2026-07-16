/**
 * DBC-3 — digital business card: vCard 3.0, card model/readiness, public resolution 404
 * gates, QR-target, token rotation, security, permissions, audit. Pure logic tested
 * directly; the token-scoped public resolution + routes asserted structurally.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveComplianceCopy } from "@/lib/brand/model";
import { buildCardModel, cardReadiness, type CardEmployee } from "@/lib/brand/card/model";
import { buildVCard } from "@/lib/brand/card/vcard";
import { AuditActions } from "@/lib/audit/events";
import type { BrandProfile, BrandAssetView, MembershipView } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const WB = "https://whistleblowersoftware.com/secure/xyz";

function profile(over: Partial<BrandProfile> = {}): BrandProfile {
  return {
    colorGreen: "#0A7D3B", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: null, fontBody: null, fontEmailFallback: null,
    slogan: "Performance in Motion", valueProposition: "Integrated Logistics",
    address: "Rue X, Dakar, Sénégal", legalIdentifiers: null, websiteUrl: "https://www.effitrans.com", linkedinUrl: null,
    whistleblowerUrl: WB, compliance: resolveComplianceCopy({}), ...over,
  };
}
function asset(over: Partial<BrandAssetView> = {}): BrandAssetView {
  return { id: "a1", kind: "LOGO_EMAIL_PNG", title: null, publicUrl: "https://cdn/brand-assets/t/logos/a1/v1/logo.png", version: 1, mime: "image/png", bytes: 5000, width: 120, height: 48, altText: "Effitrans", status: "PUBLISHED", createdAt: "2026-07-16", ...over };
}
function membership(over: Partial<MembershipView> = {}): MembershipView {
  return { id: "m1", organizationName: "WCA First", membershipId: "93972", officialUrl: null, status: "active", validFrom: null, expiresAt: null, displayOrder: 0, logoAssetId: null, assetUseNotes: null, ...over };
}
const employee: CardEmployee = { name: "Abdoul Lahad NIANG", title: "Managing Director | CEO", department: null, email: "abdoul@effitrans.com", phoneOffice: "+221338670267", phoneMobile: "+221763565859", whatsapp: "+221763565859", photoAssetId: null };

function model() {
  return buildCardModel({ companyName: "Effitrans", profileUrl: "https://app.effitrans.com/card/TOKEN123456789012", profile: profile(), assets: [asset()], memberships: [membership()], employee });
}

// ---------------------------------------------------------------- readiness ----

describe("card readiness gates publication (no incomplete branding)", () => {
  it("ready with logo + green + compliance URL + address", () => {
    expect(cardReadiness(profile(), [asset()]).ready).toBe(true);
  });
  it("lists each missing brand input honestly", () => {
    const r = cardReadiness(profile({ colorGreen: null, whistleblowerUrl: null, address: null }), []);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["Logo officiel (PNG)", "Couleur verte officielle", "URL du portail de signalement", "Adresse de l'entreprise"]));
  });
});

// ---------------------------------------------------------------- model (public-safe) ----

describe("the card model is public-safe and Brand-Center-sourced", () => {
  const m = model();
  it("orders active memberships; excludes inactive", () => {
    const m2 = buildCardModel({ companyName: "Effitrans", profileUrl: "x", profile: profile(), assets: [asset()], memberships: [membership({ displayOrder: 1, organizationName: "FIATA" }), membership({ displayOrder: 0 }), membership({ status: "inactive", organizationName: "OLD" })], employee });
    expect(m2.memberships.map((x) => x.name)).toEqual(["WCA First", "FIATA"]);
  });
  it("exposes NO tenant/user/db id field (the token lives only inside profileUrl)", () => {
    const json = JSON.stringify(m);
    expect(json).not.toContain("tenant");
    expect(json).not.toContain("user_id");
    // The model has no standalone token/id key; the token appears only within the URL.
    expect(Object.keys(m)).not.toContain("token");
    expect(Object.keys(m.employee)).not.toContain("id");
    expect(m.profileUrl).toContain("/card/");
  });
});

// ---------------------------------------------------------------- vCard 3.0 ----

describe("vCard 3.0 is spec-correct and leaks no compliance URL", () => {
  const v = buildVCard(model());
  it("declares version 3.0 with FN/N/ORG/TITLE and CRLF lines", () => {
    expect(v).toContain("BEGIN:VCARD");
    expect(v).toContain("VERSION:3.0");
    expect(v).toContain("FN:Abdoul Lahad NIANG");
    expect(v).toContain("N:NIANG;Abdoul Lahad;;;");
    expect(v).toContain("ORG:Effitrans");
    expect(v).toContain("TITLE:Managing Director | CEO");
    expect(v).toContain("\r\n");
    expect(v.trimEnd().endsWith("END:VCARD")).toBe(true);
  });
  it("includes the profile URL but NEVER the whistleblower URL", () => {
    expect(v).toContain("card/TOKEN123456789012");
    expect(v).not.toContain(WB);
    expect(v).not.toContain("whistleblower");
  });
  it("escapes special characters (; , \\ and newlines)", () => {
    const evil = buildVCard(buildCardModel({ companyName: "A;B,C\\D", profileUrl: "x", profile: profile(), assets: [asset()], memberships: [], employee: { ...employee, title: "Line1\nLine2;x" } }));
    expect(evil).toContain("ORG:A\\;B\\,C\\\\D");
    expect(evil).toContain("TITLE:Line1\\nLine2\\;x");
  });
  it("folds long lines at 75 octets", () => {
    const long = buildVCard(buildCardModel({ companyName: "X".repeat(200), profileUrl: "x", profile: profile(), assets: [asset()], memberships: [], employee }));
    const orgLine = long.split("\r\n").find((l) => l.startsWith("ORG:"))!;
    expect(Buffer.from(orgLine, "utf8").length).toBeLessThanOrEqual(75);
  });
});

// ---------------------------------------------------------------- public resolution (404 gates) ----

describe("public resolution returns a uniform 404 for every non-published state", () => {
  const svc = read("../lib/brand/server/card-service.ts");
  it("null (→404) for: token unknown/short, not opted-in, inactive employee, blocked tenant, incomplete brand", () => {
    expect(svc).toContain("token.length < 16");
    expect(svc).toContain("!row.public_card_enabled) return null");
    expect(svc).toContain('user.status !== "active") return null');
    expect(svc).toContain("tenantBlockReason(");
    expect(svc).toContain("cardReadiness(core.profile, core.assets).ready) return null");
  });
  it("reads by token via the service role (no session), and is request-memoized", () => {
    expect(svc).toContain('.eq("public_card_token", token)');
    expect(svc).toContain("getAdminSupabaseClient()");
    expect(svc).toContain("cache(async (token: string)");
  });
  it("the page + routes 404 uniformly and never index", () => {
    expect(read("../app/card/[token]/page.tsx")).toContain("notFound()");
    expect(read("../app/card/[token]/page.tsx")).toContain("index: false, follow: false");
    for (const r of ["../app/card/[token]/vcard/route.ts", "../app/card/[token]/qr.png/route.ts"]) {
      expect(read(r)).toContain('status: 404');
      expect(read(r)).toContain('"X-Robots-Tag": "noindex, nofollow"');
    }
  });
  it("middleware treats /card as public + noindex; AppShell renders no tenant chrome", () => {
    const mw = read("../lib/supabase/middleware.ts");
    expect(mw).toContain('pathname.startsWith("/card")');
    expect(mw).toContain('response.headers.set("X-Robots-Tag"');
    expect(read("../components/shell/app-shell.tsx")).toContain('if (pathname.startsWith("/card"))');
  });
});

// ---------------------------------------------------------------- QR ----

describe("QR encodes the URL only, behind the provider adapter", () => {
  it("the provider is the ONLY user of the qrcode dependency and takes a URL", () => {
    const prov = read("../lib/brand/qr/provider.ts");
    expect(prov).toContain('import QRCode from "qrcode"');
    expect(prov).toContain("svg(url: string)");
    // No contact data in the provider — QR always encodes a URL.
    for (const bad of ["phone", "email", "vcard", "BEGIN:VCARD"]) expect(code("../lib/brand/qr/provider.ts").toLowerCase()).not.toContain(bad);
  });
  it("the QR target is the card profile URL (survives profile changes; only rotation changes it)", () => {
    expect(read("../app/card/[token]/qr.png/route.ts")).toContain("BrandQrProvider.png(card.profileUrl)");
    expect(read("../app/card/[token]/page.tsx")).toContain("BrandQrProvider.svg(card.profileUrl)");
  });
});

// ---------------------------------------------------------------- admin actions ----

describe("admin actions: gated, tenant-scoped, safely audited; secure token", () => {
  const actions = read("../lib/brand/server/card-actions.ts");
  it("enable/disable/rotate gate on admin:users:manage and verify the target tenant", () => {
    expect(actions).toContain('assertPermission("admin:users:manage")');
    expect(actions).toContain("data.tenant_id === tenantId");
    expect(actions).toContain("export async function setPublicCard");
    expect(actions).toContain("export async function rotateCardToken");
  });
  it("enabling refuses an incomplete brand (no publish of incomplete branding)", () => {
    expect(actions).toContain("cardReadiness(core.profile, core.assets)");
    expect(actions).toContain('error: "brand_incomplete", missing: readiness.missing');
  });
  it("the token is CSPRNG, not derived from ids; rotation issues a new one", () => {
    expect(actions).toContain("randomBytes(24).toString");
    expect(actions).not.toContain("public_card_token: userId");
    expect(actions).toContain("public_card_token: newToken()");
  });
  it("audits carry NO token / URL / contact value (only the action name references 'token')", () => {
    const audits = code("../lib/brand/server/card-actions.ts").split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
    for (const a of audits) for (const bad of ["public_card_token", "newToken", "profileUrl", "phone", "url:"]) expect(a, bad).not.toContain(bad);
    expect(AuditActions.BRAND_CARD_TOKEN_ROTATED).toBe("brand.card.token_rotated");
  });
});

// ---------------------------------------------------------------- client bundle ----

describe("no authority / secrets in client code", () => {
  it("the card studio holds no admin client / service role", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "readBrandCore"]) {
      expect(code("../components/brand/card-studio.tsx"), forbidden).not.toContain(forbidden);
    }
  });
  it("the public card renders no token/id and has no trackers/script", () => {
    const card = read("../components/brand/public-card.tsx");
    expect(card).not.toContain("tenantId");
    expect(card).not.toContain("<script");
    expect(card).not.toMatch(/analytics|gtag|fbq/i);
  });
});
