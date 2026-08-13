/**
 * MAYA-P1.6B — the Brand Center visual-asset upload never worked in production.
 * ---------------------------------------------------------------------------
 * PRODUCTION EVIDENCE, all read-only:
 *
 *   brand_asset rows ............................ 0
 *   objects in the `brand-assets` bucket ........ 0
 *   `brand.asset.uploaded` audit events, ever ... 0   (since DBC-1, 2026-07-16)
 *   `brand.profile.updated` audit events ........ 3   (the same screen, working)
 *   server errors on /brand-center/assets ....... none
 *   POST logged to /brand-center/assets ......... none
 *   GET /brand-center/assets .................... 200
 *
 * The action was never reached. Nothing partially persisted — no orphan row, no
 * orphan object — so there is nothing in production to repair.
 *
 * `uploadBrandAsset` took `{ kind, altText, title, file: File }`: a File nested
 * inside a plain object argument, the ONLY upload in the codebase shaped that
 * way. The two that work in production — `uploadDocument` and
 * `uploadProofOfDeposit` — both take FormData. This one now matches them, and
 * every server-side check it already performed is unchanged.
 *
 * NOTE ON EVIDENCE. No client-side exception was captured: the platform has no
 * browser error telemetry, which is why the server-side proof above (the action
 * was never invoked, ever) is what this diagnosis rests on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_ASSET_BYTES, ALLOWED_ASSET_MIME, buildAssetPath, isPngSignature,
  sanitizeFilename, validateAssetUpload,
} from "@/lib/brand/assets";
import { validateAuditEvent } from "@/lib/audit/validate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTION = "lib/brand/server/actions.ts";
const CLIENT = "components/brand/asset-manager.tsx";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ASSET_ID = "9d9b8314-17cd-4273-a38b-3f1cd6bf245a";

/** The real PNG magic number, followed by filler. */
const png = (bytes = 4096) => {
  const b = new Uint8Array(bytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return b;
};

const upload = (over: Partial<Parameters<typeof validateAssetUpload>[0]> = {}) =>
  validateAssetUpload({
    kind: "LOGO_PRIMARY", mime: "image/png", filename: "effitrans-logo.png",
    byteLength: 40_000, signatureOk: true, altText: "Logo Effitrans", ...over,
  });

// ===========================================================================
describe("the transport is FormData — the root cause", () => {
  it("the action takes FormData, not a File nested in an object", () => {
    // THE MUTATION TARGET. Reverting the signature fails here.
    const s = code(ACTION);
    expect(s).toContain("export async function uploadBrandAsset(formData: FormData)");
    expect(s).not.toMatch(/uploadBrandAsset\(form: \{/);
    expect(s).not.toContain("form.file");
    // Read through the FormData API, and the file re-checked as a real File.
    expect(s).toContain('formData.get("file")');
    expect(s).toContain("file instanceof File");
  });

  it("the client sends FormData with every field the action reads", () => {
    const c = code(CLIENT);
    expect(c).toContain("new FormData()");
    for (const field of ["kind", "altText", "title", "file"]) {
      expect(c, field).toContain(`fd.set("${field}"`);
      expect(code(ACTION), field).toContain(`formData.get("${field}")`);
    }
    expect(c).toContain("uploadBrandAsset(fd)");
  });

  it("it now matches the two uploads with a production record of working", () => {
    // uploadDocument and uploadProofOfDeposit both take FormData and both have
    // real objects in storage. Consistency here is the point, not a preference.
    expect(code("lib/documents/actions.ts")).toContain("formData: FormData");
    expect(code("lib/deposit/actions.ts")).toContain("formData: FormData");
  });

  it("every server error code the action can return is legible to the operator", () => {
    // A refusal the operator cannot read is indistinguishable from a crash.
    const s = code(ACTION);
    const fn = s.slice(s.indexOf("export async function uploadBrandAsset"), s.indexOf("export async function retireBrandAsset"));
    const codes = [...fn.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]);
    const err = code(CLIENT);
    for (const c of new Set(codes)) {
      if (c === "check.error") continue;
      expect(err, `ERR_FR is missing "${c}"`).toContain(`${c}:`);
    }
  });
});

// ===========================================================================
describe("the upload contract is unchanged — nothing was loosened", () => {
  it("a valid Effitrans logo under 100 KB is accepted", () => {
    expect(upload()).toEqual({ ok: true });
    expect(MAX_ASSET_BYTES).toBe(100 * 1024);
    expect([...ALLOWED_ASSET_MIME]).toEqual(["image/png"]);
  });

  it("the 100 KB ceiling still refuses, at the boundary", () => {
    expect(upload({ byteLength: MAX_ASSET_BYTES })).toEqual({ ok: true });
    expect(upload({ byteLength: MAX_ASSET_BYTES + 1 })).toEqual({ ok: false, error: "too_large" });
    expect(upload({ byteLength: 0 })).toEqual({ ok: false, error: "empty" });
  });

  it("PNG-only is enforced on mime, extension AND real bytes", () => {
    expect(upload({ mime: "image/svg+xml" })).toEqual({ ok: false, error: "mime_not_allowed" });
    expect(upload({ filename: "logo.svg" })).toEqual({ ok: false, error: "extension_not_allowed" });
    // A renamed SVG with a PNG mime is still refused — by its bytes.
    expect(upload({ signatureOk: false })).toEqual({ ok: false, error: "not_a_png" });
    expect(isPngSignature(png())).toBe(true);
    expect(isPngSignature(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBe(false);
    expect(isPngSignature(new Uint8Array([]))).toBe(false);
  });

  it("alt text stays mandatory, and the kind stays allowlisted", () => {
    expect(upload({ altText: "   " })).toEqual({ ok: false, error: "alt_required" });
    expect(upload({ kind: "SOMETHING_ELSE" })).toEqual({ ok: false, error: "invalid_kind" });
  });

  it("the storage path is server-built, tenant-scoped and versioned", () => {
    const p = buildAssetPath({ tenantId: TENANT, kind: "LOGO_PRIMARY", assetId: ASSET_ID, version: 1, filename: "Logo Effitrans.png" });
    expect(p).toBe(`${TENANT}/logos/${ASSET_ID}/v1/Logo-Effitrans.png`);
    // Version 2 is a NEW object — a published URL is never overwritten in place.
    const v2 = buildAssetPath({ tenantId: TENANT, kind: "LOGO_PRIMARY", assetId: ASSET_ID, version: 2, filename: "logo.png" });
    expect(v2).not.toBe(p);
    expect(v2).toContain("/v2/");
  });

  it("a hostile filename cannot escape the tenant folder", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(buildAssetPath({ tenantId: TENANT, kind: "LOGO_PRIMARY", assetId: ASSET_ID, version: 1, filename: "../../evil.png" }))
      .toBe(`${TENANT}/logos/${ASSET_ID}/v1/evil.png`);
    expect(sanitizeFilename("")).toBe("asset.png");
  });
});

// ===========================================================================
describe("persistence, versioning, audit and failure compensation", () => {
  it("a replacement versions and retires the prior asset — it never overwrites", () => {
    const fn = code(ACTION);
    expect(fn).toContain('.eq("status", "PUBLISHED")');
    expect(fn).toContain("const version = (prior?.version ?? 0) + 1");
    expect(fn).toMatch(/status: "RETIRED", retired_at/);
    expect(fn).not.toMatch(/\.remove\(|\.delete\(\)[\s\S]{0,40}storage/);
  });

  it("a storage failure compensates the row it just created", () => {
    // This is why production is clean rather than half-written.
    const fn = code(ACTION);
    const block = fn.slice(fn.indexOf("if (up.error)"), fn.indexOf("const replacing"));
    expect(block).toContain('.from("brand_asset").delete().eq("id", inserted.id)');
    expect(block).toContain('.eq("tenant_id", admin.tenantId)');
    expect(block).toContain('error: "storage_failed"');
  });

  it("a metadata failure returns write_failed and reports it", () => {
    expect(code(ACTION)).toContain('reportError(insErr, { scope: "action", event: "brand.asset.insert" })');
    expect(code(ACTION)).toContain('return { ok: false, error: "write_failed" }');
  });

  it("the audit is mandatory and its entityId is a real UUID (P1.6A contract)", () => {
    expect(code(ACTION)).toContain('entity: "brand_asset", entityId: inserted.id');
    // The row id is a uuid, so the P1.6A validator accepts it.
    expect(() => validateAuditEvent({
      action: "brand.asset.uploaded", actorId: ACTOR_UUID, entityId: ASSET_ID,
    })).not.toThrow();
    // …and a kind would NOT be accepted, which is the trap P1.6A closed.
    expect(() => validateAuditEvent({
      action: "brand.asset.uploaded", actorId: ACTOR_UUID, entityId: "LOGO_PRIMARY",
    })).toThrow(/entityId must be a UUID/);
    // Bytes are never audited.
    expect(code(ACTION)).toMatch(/after: \{ kind, version, bytes: buf\.byteLength, mime: "image\/png" \}/);
  });

  it("authorization and tenant scoping are unchanged", () => {
    const fn = code(ACTION);
    expect(fn).toContain('assertPermission("admin:config:manage")');
    // Never client-supplied: the tenant comes from the resolved session.
    expect(fn).toContain("tenant_id: admin.tenantId");
    expect(fn).not.toMatch(/formData\.get\("tenant/);
    expect(fn).toContain("tenantId: admin.tenantId");
  });

  it("the read path still distinguishes a broken query from an empty brand", () => {
    // P1.6A. An asset list that fails must not render as « aucune ressource ».
    expect(code("lib/brand/server/service.ts")).toContain("throw new Error(`[brand] lecture");
  });
});

const ACTOR_UUID = "9d9b8314-17cd-4273-a38b-3f1cd6bf245b";
