/**
 * CALLBACK-MIDDLEWARE-F1 — the scanner's verdict must reach its handler.
 * ---------------------------------------------------------------------------
 * THE DEFECT. `isPublicPath` did not list the scanner callback, and the
 * middleware matcher covers every non-static route, so an unauthenticated
 * machine POST was answered with 307 → /login. A 307 preserves method and
 * body, `fetch` follows redirects by default, and /login answers 200 with an
 * HTML page — so the worker read `res.ok` as true and logged a DELIVERED
 * verdict that the database was never told about. Every log said success while
 * no document could ever leave SCANNING.
 *
 * WHY THESE TESTS EXECUTE THE MIDDLEWARE INSTEAD OF READING IT.
 * tests/middleware-session.test.ts verifies this module structurally, and says
 * so: "needs a live Supabase client to exercise". That is precisely how this
 * defect survived — every structural claim about the file was true, and the
 * routing was still broken. A test that asserts a path appears in a list
 * cannot tell you what the middleware DOES with it. So `createServerClient` is
 * mocked to report "signed out" and `updateSession` is actually called, which
 * is the only form of this test that would have failed before the fix.
 *
 * Only the UNAUTHENTICATED path is exercised, deliberately: a scanner has no
 * cookie, so that is the case the defect lives in, and it needs no session
 * fixtures to reproduce.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Signed out, with no network. Returning `{ data: { user: null } }` is what a
// cookieless machine request produces in production.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

const { updateSession } = await import("@/lib/supabase/middleware");

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CALLBACK = "/api/customs/reference/scan-callback";

/** Run the real middleware against one path, signed out. */
async function visit(pathname: string, method = "POST") {
  const res = await updateSession(
    new NextRequest(new URL(`http://localhost${pathname}`), { method }),
  );
  return {
    status: res.status,
    location: res.headers.get("location"),
    redirected: res.status >= 300 && res.status < 400,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54399";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-not-a-credential";
});

describe("F1 — the scanner callback reaches its handler", () => {
  it("1 — a signed-out POST to the callback is NOT redirected", async () => {
    // THE REGRESSION TEST. Before the fix this was 307 → /login.
    const r = await visit(CALLBACK);
    expect(r.redirected, `status ${r.status}`).toBe(false);
    expect(r.status).toBe(200); // NextResponse.next() — the handler will run
  });

  it("2 — and no login redirect is returned, by any spelling", async () => {
    const r = await visit(CALLBACK);
    expect(r.location).toBeNull();
  });

  it("3 — the method does not matter; middleware must not gate it", async () => {
    for (const m of ["POST", "GET", "PUT"]) {
      const r = await visit(CALLBACK, m);
      expect(r.redirected, `${m} was redirected`).toBe(false);
    }
  });
});

describe("F1 — every other protected route still requires a session", () => {
  it("4 — ordinary application pages still redirect to /login", async () => {
    for (const p of ["/dashboard", "/customs", "/customs/reference", "/finance", "/users"]) {
      const r = await visit(p, "GET");
      expect(r.redirected, `${p} did NOT redirect`).toBe(true);
      expect(r.location, p).toContain("/login");
    }
  });

  it("5 — portal routes still redirect to the PORTAL login", async () => {
    const r = await visit("/portal/dossiers", "GET");
    expect(r.redirected).toBe(true);
    expect(r.location).toContain("/portal/login");
    // Not `not.toMatch(/\/login$/)`: "/portal/login" ends with "/login" too.
    // What matters is that a portal visitor is not sent to the STAFF login.
    expect(new URL(r.location!).pathname).toBe("/portal/login");
  });

  it("6 — the library's own session-bearing API routes still require a session", async () => {
    // The fix opened ONE path, not the prefix. These three carry a staff
    // session in the browser and must stay gated.
    for (const p of [
      "/api/customs/reference/upload",
      "/api/customs/reference/upload-url",
      "/api/customs/reference/finalize",
    ]) {
      const r = await visit(p);
      expect(r.redirected, `${p} became public`).toBe(true);
      expect(r.location, p).toContain("/login");
    }
  });

  it("7 — the allowlist entry is EXACT: no sibling or suffix is public", async () => {
    // `startsWith` on this prefix would have exposed anything added later.
    for (const p of [
      `${CALLBACK}/extra`,
      `${CALLBACK}X`,
      `${CALLBACK}/../upload`,
      "/api/customs/reference/scan-callbacks",
    ]) {
      const r = await visit(p);
      expect(r.redirected, `${p} became public`).toBe(true);
    }
  });

  it("8 — the other machine-facing webhooks are UNCHANGED by this fix", async () => {
    // Reported, not corrected: CALLBACK-MIDDLEWARE-F1 authorised one path. This
    // test records the current state so the decision is visible rather than
    // implied, and will fail the day somebody opens them without saying so.
    for (const p of ["/api/ec/inbound/mailgun", "/api/payments/webhook/mock"]) {
      const r = await visit(p);
      expect(r.redirected, `${p} changed`).toBe(true);
      expect(r.location, p).toContain("/login");
    }
  });

  it("9 — the control: an already-public API route passes, proving the mechanism", async () => {
    const r = await visit("/api/version", "GET");
    expect(r.redirected).toBe(false);
  });

  it("10 — the pre-existing public paths still pass", async () => {
    for (const p of ["/login", "/portal/login", "/auth/callback", "/card/abc", "/offline"]) {
      const r = await visit(p, "GET");
      expect(r.redirected, `${p} stopped being public`).toBe(false);
    }
  });

  it("11 — with no Supabase env the middleware still no-ops rather than redirecting", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const r = await visit("/dashboard", "GET");
    expect(r.redirected).toBe(false); // degraded pre-config rendering, unchanged
  });
});

describe("F1 — opening the path did not weaken the callback's own authentication", () => {
  const route = code("../app/api/customs/reference/scan-callback/route.ts");
  const scan = code("../lib/customs/reference/scan.ts");

  it("12 — the handler still authenticates by HMAC over the RAW body", () => {
    expect(route).toContain("await request.text()");
    expect(route).toContain("parseCallback(raw, signature)");
    // Parsing before verifying would change the bytes the signature covers.
    expect(route.indexOf("await request.text()")).toBeLessThan(route.indexOf("parseCallback("));
  });

  it("13 — a bad signature is 401 and a stale callback is 409", () => {
    expect(route).toContain('parsed.error === "bad_signature" ? 401');
    expect(route).toContain('parsed.error === "stale_callback" ? 409');
  });

  it("14 — with no scanner configured it still refuses with 503", () => {
    expect(route).toContain("if (!scanningAvailable())");
    expect(route).toContain('{ error: "scanner_unavailable" }, { status: 503 }');
  });

  it("15 — it still consults NO session, so being public grants nothing", () => {
    // The point of the fix: a cookie was never what protected this route.
    expect(route).not.toContain("getCurrentUser");
    expect(route).not.toContain("getCurrentPortalUser");
  });

  it("16 — the replay nonce is still passed to the recorder", () => {
    expect(route).toContain("p_nonce: p.nonce");
    expect(route).toContain('outcome === "replayed"');
  });

  it("17 — the handler still cannot write the document itself", () => {
    // It calls the definer RPC, which re-checks the verdict against the
    // document's current bytes. No direct table write exists here.
    expect(route).toContain('supabase.rpc("record_customs_reference_scan"');
    expect(route).not.toContain('.from("customs_reference_document")');
  });

  it("18 — constant-time comparison is still what decides a signature", () => {
    // scan.ts delegates to the platform's shared signing helper rather than
    // hand-rolling a compare, so the guarantee is asserted where it lives —
    // and the delegation is asserted here so it cannot be swapped for `===`.
    expect(scan).toContain("verifyHmacSignature");
    expect(scan).toContain("@/lib/finance/providers/sign");
    expect(code("../lib/finance/providers/sign.ts")).toContain("timingSafeEqual");
  });
});

describe("F1 — a redirect can never again be read as a delivered verdict", () => {
  const worker = code("../workers/clamav-scanner/src/pipeline.mjs");
  const stub = code("../workers/dev-scan-stub/src/server.mjs");

  it("19 — the worker does not follow redirects", () => {
    expect(worker).toContain('redirect: "manual"');
  });

  it("20 — a 3xx is a permanent misconfiguration, not a retry", () => {
    expect(worker).toContain("res.status >= 300 && res.status < 400");
    expect(worker).toContain("callback_redirected_to_");
  });

  it("21 — a 2xx that is not JSON is refused as an acknowledgement", () => {
    expect(worker).toContain("application/json");
    expect(worker).toContain("callback_not_json_");
  });

  it("22 — the dev stub is hardened the same way, so it cannot mask the defect", () => {
    expect(stub).toContain('redirect: "manual"');
    expect(stub).toContain("callback.rejected");
  });

  it("23 — behaviour, not just presence: proven by the worker's own suite", () => {
    // The worker is .mjs and outside vitest's `tests/**/*.test.ts` glob, so the
    // executable proof lives in its node:test suite. This pins that the cases
    // exist there, so they cannot be quietly dropped.
    const contract = read("../workers/clamav-scanner/test/contract.test.mjs");
    expect(contract).toContain("a 307 is NOT success");
    expect(contract).toContain("an HTML 200 is NOT success");
    expect(contract).toContain("redirect: manual is actually requested");
  });
});
