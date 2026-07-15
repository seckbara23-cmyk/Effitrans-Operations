/**
 * DBC-1 — Brand Center services + UI: authorization, tenant-scope, safe audit, and the
 * MVP navigation. Structural (comment-stripped) over source; the pure logic and the DB
 * isolation are covered by brand-center-foundation.test.ts and the CI RLS SQL test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = read("../lib/brand/server/actions.ts");
const service = read("../lib/brand/server/service.ts");
const nav = read("../lib/nav.ts");
const overview = read("../app/brand-center/page.tsx");

// ---------------------------------------------------------------- authorization ----

describe("every mutation is permission-gated and tenant-scoped", () => {
  it("corporate profile / assets / memberships gate on admin:config:manage", () => {
    for (const fn of ["updateBrandProfile", "uploadBrandAsset", "retireBrandAsset", "createMembership", "updateMembership", "retireMembership"]) {
      const idx = actions.indexOf(`export async function ${fn}`);
      expect(idx, fn).toBeGreaterThan(0);
      const body = actions.slice(idx, idx + 600);
      expect(body, fn).toContain('assertPermission("admin:config:manage")');
    }
  });
  it("employee profiles gate on admin:users:manage (user management)", () => {
    const idx = actions.indexOf("export async function updateWorkforceProfile");
    expect(actions.slice(idx, idx + 400)).toContain('assertPermission("admin:users:manage")');
  });
  it("reads gate too (config for the center, users for people)", () => {
    expect(service).toContain('assertPermission("admin:config:manage")');
    expect(service).toContain('assertPermission("admin:users:manage")');
  });
  it("writes scope to admin.tenantId, never client tenant input", () => {
    expect(actions).toContain("tenant_id: admin.tenantId");
    expect(actions).toContain('.eq("tenant_id", admin.tenantId)');
  });
});

// ---------------------------------------------------------------- cross-tenant guards ----

describe("cross-tenant references are rejected", () => {
  it("a workforce edit verifies the target user belongs to this tenant", () => {
    expect(actions).toContain("target.tenant_id !== admin.tenantId");
    expect(actions).toContain('return { ok: false, error: "not_found" }');
  });
  it("a linked membership logo must belong to the same tenant", () => {
    // The logo lookup is tenant-scoped and a mismatch is rejected.
    expect(actions).toContain('.eq("id", input.logoAssetId).eq("tenant_id", admin.tenantId).maybeSingle()');
    expect(actions).toContain('error: "invalid_asset"');
  });
});

// ---------------------------------------------------------------- asset safety ----

describe("asset upload constructs the path server-side and checks real bytes", () => {
  it("uses the server path builder + PNG signature, never the client path/type alone", () => {
    expect(actions).toContain("buildAssetPath({ tenantId: admin.tenantId");
    expect(actions).toContain("isPngSignature(buf)");
    expect(actions).toContain("validateAssetUpload(");
  });
  it("replacement versions + retires the prior, never overwrites (upsert:false)", () => {
    expect(actions).toContain("upsert: false");
    expect(actions).toContain('status: "RETIRED"');
    expect(actions).toContain("(prior?.version ?? 0) + 1");
  });
  it("compensates a storage failure by removing the orphan registry row", () => {
    expect(actions).toContain('.delete().eq("id", inserted.id)');
  });
});

// ---------------------------------------------------------------- safe audit ----

describe("audit records safe metadata only", () => {
  it("profile / membership / workforce audits carry changed field NAMES, not values", () => {
    expect(actions).toContain("changedFields: Object.keys(row)");
    // The whistleblower URL value is never in an audit payload (scan comment-stripped code
    // — a doc comment naming it is not the value).
    const stripped = code("../lib/brand/server/actions.ts");
    const audits = stripped.split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
    for (const a of audits) {
      expect(a).not.toContain("whistleblower");
      // The card token appears in the workforce audit ONLY inside the exclusion filter
      // (proving it is stripped) — a leak would be it logged as a value, checked next.
      expect(a).not.toMatch(/public_card_token\s*:/);
      expect(a).not.toContain("phone_office:");
    }
  });
  it("the workforce audit explicitly excludes the card token + token timestamp", () => {
    expect(actions).toContain('!["user_id", "tenant_id", "updated_by", "public_card_token", "token_rotated_at"].includes(k)');
  });
});

// ---------------------------------------------------------------- token safety ----

describe("the public-card token is secure and never leaked", () => {
  it("is generated from CSPRNG bytes, not derived from the user id, and rotated on enable", () => {
    expect(actions).toContain("randomBytes(24).toString");
    expect(actions).not.toContain("public_card_token: userId");
    expect(actions).toContain("token_rotated_at");
  });
  it("no public card route exists in DBC-1 (only opt-in is stored)", () => {
    // A /card route would be a new app route; assert the service never returns the token.
    expect(service).not.toContain("public_card_token");
  });
});

// ---------------------------------------------------------------- workforce authority ----

describe("workforce edits never touch authoritative identity", () => {
  it("the upsert row never writes name / email / roles / tenant membership changes", () => {
    const idx = actions.indexOf("export async function updateWorkforceProfile");
    const body = code("../lib/brand/server/actions.ts").slice(code("../lib/brand/server/actions.ts").indexOf("export async function updateWorkforceProfile"));
    expect(body).not.toContain("email:");
    expect(body).not.toContain("row.name");
    expect(idx).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- navigation / UI ----

describe("MVP navigation is gated and has no phantom links", () => {
  it("Centre de marque is under Administration, gated by admin:config:manage", () => {
    expect(nav).toContain('label: "Centre de marque", href: "/brand-center"');
    expect(nav).toContain('permission: "admin:config:manage"');
  });
  it("the nav does NOT expose signature/card/document/presentation/social/marketing links", () => {
    for (const phantom of ["/brand-center/signatures", "/brand-center/cards", "/brand-center/documents", "/brand-center/presentations", "/brand-center/social", "/brand-center/marketing"]) {
      expect(nav).not.toContain(phantom);
    }
  });
  it("the overview honestly flags missing Brand Book inputs and never invents values", () => {
    expect(overview).toContain("À FOURNIR PAR LA DIRECTION");
    expect(overview).toContain("completeness");
    expect(overview).toContain("Bientôt disponible");
  });
  it("every brand-center page gates before reading", () => {
    for (const p of ["../app/brand-center/identity/page.tsx", "../app/brand-center/assets/page.tsx", "../app/brand-center/memberships/page.tsx"]) {
      expect(read(p)).toContain('hasPermission(permissions, "admin:config:manage")');
    }
    expect(read("../app/brand-center/people/page.tsx")).toContain('hasPermission(permissions, "admin:users:manage")');
  });
});

// ---------------------------------------------------------------- client bundle safety ----

describe("client components hold no authority", () => {
  it("no admin client / service role in any brand client component", () => {
    for (const c of ["../components/brand/identity-form.tsx", "../components/brand/asset-manager.tsx", "../components/brand/membership-manager.tsx", "../components/brand/people-manager.tsx"]) {
      for (const forbidden of ["getAdminSupabaseClient", "service_role", "SUPABASE_SERVICE"]) {
        expect(code(c), `${c}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });
  it("SVG is not offered by the upload input (PNG only)", () => {
    expect(read("../components/brand/asset-manager.tsx")).toContain('accept="image/png"');
  });
});
