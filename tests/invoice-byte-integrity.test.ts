/**
 * B1 — official invoice BYTE INTEGRITY, end to end.
 *
 * Production evidence (2026-07-31): a download advertised
 * `Content-Length: 3073` with `X-Invoice-Sha256: a144…` while the file saved
 * from the browser's PDF viewer was 1641 bytes hashing to `d6ed…`.
 *
 * The investigation cleared every server-side layer, and these tests pin the
 * reasons so they stay cleared:
 *
 *   - ONE buffer is hashed, uploaded and later served — never re-rendered;
 *   - `Content-Length` is derived from that buffer's own byteLength;
 *   - the bytes never pass through a text codec;
 *   - the service worker does not intervene on `/api/*` at all;
 *   - staff and portal resolve to the SAME artifact through the SAME route.
 *
 * The remaining variable was the client: the browser's PDF viewer re-serialises
 * the document when its own Save button is used, producing a smaller,
 * byte-different file. That is why B1 must capture the bytes as delivered
 * (« Enregistrer la cible du lien sous » / curl), never the viewer's re-save.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderOfficialInvoice, INVOICE_RENDERER_VERSION, type InvoiceSnapshot } from "@/lib/finance/invoice-pdf";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — assertions must bind to CODE, not prose. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const ROUTE = "app/api/invoices/[id]/pdf/route.ts";
const ARTIFACT = "lib/finance/invoice-artifact.ts";
const SW = "public/sw.js";
const MIGRATION = "supabase/migrations/20260728000001_invoice_artifact_and_charge_uniqueness.sql";

const SNAP: InvoiceSnapshot = {
  organizationName: "Effitrans SARL",
  invoiceNumber: "EFT-INV-2026-00001",
  issueDate: "2026-07-28",
  dueDate: "2026-08-27",
  currency: "XOF",
  customerName: "SENEGAL DISTRIBUTION DEMO SARL",
  fileNumber: "EFT-IMP-2026-00003",
  lines: [{ description: "Dedouanement et transport", quantity: 1, unitAmount: 750_000, taxRate: 0 }],
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------------------
describe("one buffer is hashed, stored and served", () => {
  it("hashes exactly the bytes it uploads — same identifier, no re-render between", () => {
    const src = code(ARTIFACT);
    const render = src.indexOf("const bytes = renderOfficialInvoice(snapshot)");
    const hash = src.indexOf("const contentSha256 = sha256Hex(bytes)");
    const upload = src.indexOf("uploadObject(storagePath, bytes");
    expect(render).toBeGreaterThan(-1);
    expect(hash).toBeGreaterThan(render);
    expect(upload).toBeGreaterThan(hash);
    // Nothing may re-render between the hash and the upload.
    expect(src.slice(hash, upload)).not.toContain("renderOfficialInvoice(");
  });

  it("records the renderer version on the artifact, so bytes are traceable to a renderer", () => {
    expect(code(ARTIFACT)).toContain("p_renderer_version: INVOICE_RENDERER_VERSION");
    expect(INVOICE_RENDERER_VERSION).toBe("uat2b-2");
  });

  it("returns the stored artifact before rendering anything, on every repeat call", () => {
    const src = code(ARTIFACT);
    expect(src.indexOf("if (existing)")).toBeLessThan(src.indexOf("renderOfficialInvoice("));
  });

  it("renders byte-identical output for the same snapshot (repeat download = same bytes)", () => {
    expect(sha(renderOfficialInvoice(SNAP))).toBe(sha(renderOfficialInvoice(SNAP)));
  });
});

// ---------------------------------------------------------------------------
describe("the HTTP response describes its own body", () => {
  const src = code(ROUTE);

  it("derives Content-Length from the served buffer, not from a stored number", () => {
    expect(src).toContain('"Content-Length": String(bytes.byteLength)');
  });

  it("sends the raw Uint8Array as the body", () => {
    expect(src).toContain("const bytes = new Uint8Array(await blob.arrayBuffer())");
    expect(src).toContain("new NextResponse(bytes");
  });

  it("never puts the PDF through a text codec", () => {
    for (const forbidden of ["TextDecoder", "TextEncoder", "toString(", ".text()", 'from(bytes, "utf']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("publishes the artifact's recorded hash, and renders nothing itself", () => {
    expect(src).toContain('"X-Invoice-Sha256": artifact.contentSha256');
    expect(src).not.toContain("renderOfficialInvoice");
  });

  it("forbids shared caching — authorization is per request even though bytes are immutable", () => {
    expect(src).toContain('"Cache-Control": "private, no-store"');
  });
});

// ---------------------------------------------------------------------------
describe("the service worker does not touch private invoice responses", () => {
  const swSrc = read(SW);

  /** Evaluate the real predicate from sw.js rather than pattern-matching it. */
  const cacheableStatic = (() => {
    const m = swSrc.match(/function cacheableStatic\(url, request\) \{([\s\S]*?)\n\}/);
    if (!m) throw new Error("cacheableStatic not found in public/sw.js");
    return new Function("self", "url", "request", m[1]) as (
      self: unknown,
      url: URL,
      request: { method: string },
    ) => boolean;
  })();

  const SELF = { location: { origin: "https://effitrans-operations.vercel.app" } };
  const get = { method: "GET" };

  it("refuses to cache the invoice PDF route", () => {
    const url = new URL("https://effitrans-operations.vercel.app/api/invoices/abc/pdf");
    expect(cacheableStatic(SELF, url, get)).toBe(false);
  });

  it("refuses to cache any /api route", () => {
    for (const p of ["/api/version", "/api/invoices/x/pdf", "/api/operations/copilot"]) {
      const url = new URL(`https://effitrans-operations.vercel.app${p}`);
      expect(cacheableStatic(SELF, url, get)).toBe(false);
    }
  });

  it("still caches only the immutable build assets it was designed for", () => {
    const o = SELF.location.origin;
    expect(cacheableStatic(SELF, new URL(`${o}/_next/static/chunk.js`), get)).toBe(true);
    expect(cacheableStatic(SELF, new URL(`${o}/icons/icon-192.png`), get)).toBe(true);
    expect(cacheableStatic(SELF, new URL(`${o}/favicon.ico`), get)).toBe(true);
  });

  it("hands non-cacheable requests to the network untouched — no respondWith at all", () => {
    // The branch must RETURN before any respondWith: the SW cannot transform,
    // truncate or replace a response it never claims.
    const branch = swSrc.match(/if \(!cacheableStatic\(url, request\)\) \{([\s\S]*?)\n  \}/);
    expect(branch).not.toBeNull();
    expect(branch![1]).not.toContain("respondWith");
    expect(branch![1]).toContain("return");
  });

  it("writes to the cache only inside the static branches", () => {
    // Every cache.put must be downstream of the cacheableStatic gate.
    const gate = swSrc.indexOf("if (!cacheableStatic(url, request))");
    for (const idx of [...swSrc.matchAll(/cache\.put\(/g)].map((m) => m.index ?? -1)) {
      expect(idx).toBeGreaterThan(gate);
    }
  });
});

// ---------------------------------------------------------------------------
describe("staff and portal resolve to the same immutable artifact", () => {
  it("both link to the one download route", () => {
    expect(code("components/finance/invoice-card.tsx")).toContain("/api/invoices/${invoice.id}/pdf");
    expect(code("app/portal/(app)/invoices/[id]/page.tsx")).toContain("/api/invoices/${inv.id}/pdf");
  });

  it("the route serves both callers from the same stored object", () => {
    const src = code(ROUTE);
    expect(src).toContain("ensureOfficialInvoiceArtifact");
    expect(src).toContain("supabase.storage");
    // One download path — not a staff branch and a portal branch.
    expect(src.match(/\.download\(/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("issued artifacts are immutable — the correction cannot rewrite history", () => {
  it("no application code updates a recorded content hash", () => {
    for (const p of [ARTIFACT, ROUTE, "lib/finance/invoice-send.ts"]) {
      expect(code(p)).not.toMatch(/update\([^)]*content_sha256/);
    }
  });

  it("the database function returns the existing artifact instead of superseding it", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("if v_existing is not null then");
    expect(sql).toContain("'already', true");
    expect(sql).not.toMatch(/update public\.document[\s\S]{0,200}content_sha256/);
  });

  it("a renderer change therefore reaches only invoices issued afterwards", () => {
    // The guard is the early return, proven above; this pins the intent so a
    // future "just regenerate them all" cannot land quietly.
    expect(code(ARTIFACT)).toContain("already");
  });
});
