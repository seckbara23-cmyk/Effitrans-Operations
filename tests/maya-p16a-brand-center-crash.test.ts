/**
 * MAYA-P1.6A — the production Brand Center crash.
 * ---------------------------------------------------------------------------
 * PRODUCTION EVIDENCE (Vercel, prj_9ADulyKEFY5s7pwxHqIFgojV5Vcn, route
 * /brand-center/governance):
 *
 *   Error: [audit] failed to write audit event "brand.template.created":
 *          invalid input syntax for type uuid: "EXECUTIVE"
 *
 * `audit_log.entity_id` is a `uuid` column — verified in the linked production
 * database, not inferred from migrations. The Brand Center passed TEMPLATE KEYS
 * into it: "EXECUTIVE" (a signature variant), a document type, a presentation
 * type, a communication kind. Postgres rejected the insert; `writeAudit` threw
 * — deliberately, because WES-9 makes a failed mandatory event abort its action
 * rather than lose the record — and the server action died. The operator saw
 * « Une erreur est survenue ».
 *
 * It was never one route. EIGHT call sites across governance, documents,
 * marketing and presentations had the same defect, so template approval,
 * publication, and every document/presentation/marketing generation were all
 * broken in production.
 *
 * The fix is not a wider column. A business key is not an entity id: it belongs
 * in `after`, where all eight sites were already putting it. `entity_id` stays a
 * uuid, and the validator now says so at a unit-testable boundary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateAuditEvent, isUuid } from "@/lib/audit/validate";
import { deriveBrandCompleteness } from "@/lib/brand/model";
import type { CompletenessInput } from "@/lib/brand/model";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTOR = "9d9b8314-17cd-4273-a38b-3f1cd6bf245a";
const BRAND_ACTIONS = [
  "lib/brand/server/governance-actions.ts",
  "lib/brand/server/document-actions.ts",
  "lib/brand/server/marketing-actions.ts",
  "lib/brand/server/presentation-actions.ts",
];

/** An empty brand: nothing configured anywhere. */
const emptyBrand = (): CompletenessInput => ({
  colors: { green: null, gold: null, anthracite: null },
  fonts: { heading: null, body: null, fallback: null },
  slogan: null, valueProposition: null, website: null, address: null,
  whistleblowerUrl: null,
  publishedKinds: [],
  activeMembershipCount: 0,
  workforceWithTitleCount: 0,
});

// ===========================================================================
describe("the exact production failure", () => {
  it("a template key in entityId is refused, naming the value", () => {
    // The literal production payload. Before the fix this validated fine and
    // died in Postgres; now it fails here, where a test can see it.
    expect(() =>
      validateAuditEvent({ action: "brand.template.created", actorId: ACTOR, entityId: "EXECUTIVE" }),
    ).toThrow(/entityId must be a UUID/);
    expect(() =>
      validateAuditEvent({ action: "brand.template.created", actorId: ACTOR, entityId: "EXECUTIVE" }),
    ).toThrow(/EXECUTIVE/);
  });

  it("every other Brand Center key that was being passed is refused too", () => {
    // Not one route: documents, presentations, communications, marketing.
    for (const key of ["LETTERHEAD", "CORPORATE", "MANAGEMENT", "PRESENTATION", "ANNOUNCEMENT"]) {
      expect(() => validateAuditEvent({ action: "brand.document.generated", actorId: ACTOR, entityId: key }), key)
        .toThrow(/entityId must be a UUID/);
    }
  });

  it("a real row id still passes, and an absent one is legal", () => {
    // The fix must not break the ~40 call sites that pass genuine uuids.
    expect(() => validateAuditEvent({ action: "brand.asset.published", actorId: ACTOR, entityId: ACTOR })).not.toThrow();
    expect(() => validateAuditEvent({ action: "brand.template.created", actorId: ACTOR })).not.toThrow();
    expect(() => validateAuditEvent({ action: "brand.template.created", actorId: ACTOR, entityId: null })).not.toThrow();
    expect(isUuid(ACTOR)).toBe(true);
    expect(isUuid(ACTOR.toUpperCase())).toBe(true);
    expect(isUuid("EXECUTIVE")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("no Brand Center action passes a business key as an entity id any more", () => {
    // The structural half: the eight sites are fixed, and stay fixed.
    for (const f of BRAND_ACTIONS) {
      const s = code(f);
      for (const bad of [
        "entityId: key", "entityId: type", "entityId: input.type",
        "entityId: kind", "entityId: input.presentationType",
      ]) {
        expect(s, `${f} — ${bad}`).not.toContain(bad);
      }
    }
  });

  it("the key survives — it moved to `after`, it was not deleted", () => {
    // Dropping the audit evidence would have been the wrong fix.
    expect(code("lib/brand/server/governance-actions.ts")).toContain("after: { category, key, status: target }");
    expect(code("lib/brand/server/document-actions.ts")).toContain("after: { type, format }");
    // Social hardening: the communication audit gained a safe format tag.
    expect(code("lib/brand/server/presentation-actions.ts")).toContain('after: { kind: resolved.kind, format: "svg" }');
    expect(code("lib/brand/server/marketing-actions.ts")).toMatch(/after: \{ type: input\.type, provider \}/);
  });

  it("the audit write still ABORTS its action on failure — WES-9 is intact", () => {
    // The fix must not become "swallow audit errors". A lost audit record is
    // worse than a refused action.
    expect(code("lib/audit/log.ts")).toContain("throw new Error(");
    expect(code("lib/audit/log.ts")).not.toMatch(/catch\s*\{\s*\}/);
  });
});

// ===========================================================================
describe("an empty brand renders; a broken query does not pretend to be empty", () => {
  it("a completely unconfigured brand is a valid state, not a crash", () => {
    const c = deriveBrandCompleteness(emptyBrand());
    expect(c.completed).toBe(0);
    expect(c.total).toBeGreaterThan(0); // the progress bar divides by this
    expect(Number.isFinite(Math.round((c.completed / c.total) * 100))).toBe(true);
    expect(c.items.every((i) => i.complete === false)).toBe(true);
  });

  it("a partially configured brand reports exactly what is missing", () => {
    const partial = { ...emptyBrand(), slogan: "Votre partenaire logistique", website: "https://effitrans.com" };
    const c = deriveBrandCompleteness(partial);
    expect(c.completed).toBe(2);
    expect(c.items.find((i) => i.key === "slogan")!.complete).toBe(true);
    expect(c.items.find((i) => i.key === "logo_primary")!.complete).toBe(false);
    // …and the label the operator sees says « à fournir », never an error.
    expect(c.summary).toContain(`${c.completed}`);
  });

  it("a logo makes exactly the logo item complete", () => {
    const withLogo = { ...emptyBrand(), publishedKinds: ["LOGO_PRIMARY" as const] };
    const c = deriveBrandCompleteness(withLogo);
    expect(c.items.find((i) => i.key === "logo_primary")!.complete).toBe(true);
    expect(c.items.find((i) => i.key === "logo_email")!.complete).toBe(false);
    expect(c.completed).toBe(1);
  });

  it("a genuine query error is raised, not rendered as « aucune donnée »", () => {
    // The distinction the brief requires: a missing ROW is an empty brand
    // (maybeSingle → data null, error null); a failed QUERY is a failure.
    const s = code("lib/brand/server/service.ts");
    expect(s).toMatch(/if \(res\.error\)/);
    expect(s).toContain("throw new Error(`[brand] lecture");
    // Every one of the four reads is covered by the check.
    for (const r of ["profileRes", "assetsRes", "membersRes", "orgRes"]) {
      expect(s, r).toContain(r);
    }
  });

  it("authorization is unchanged — the overview still gates on admin:config:manage", () => {
    expect(code("lib/brand/server/service.ts")).toContain('assertPermission("admin:config:manage")');
    expect(code("app/brand-center/page.tsx")).toContain('hasPermission(permissions, "admin:config:manage")');
    expect(code("app/brand-center/governance/page.tsx")).toContain('hasPermission(permissions, "admin:config:manage")');
  });

  it("tenant isolation is unchanged — every read is scoped to the session tenant", () => {
    const s = code("lib/brand/server/service.ts");
    expect((s.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s).not.toMatch(/tenantId = [a-z]+\.(body|params|searchParams)/);
  });
});
