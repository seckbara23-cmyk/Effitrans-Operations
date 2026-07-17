/**
 * Phase 8.0A (F-7) — middleware session hardening. Production runtime errors showed
 * `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` surfacing from
 * lib/supabase/middleware.ts when a browser presents a stale refresh cookie. The contract:
 * an auth failure during session refresh means "not signed in" — the request must take the
 * EXISTING unauthenticated path (redirect to the matching login), never surface an error.
 * Verified structurally (the module is edge/server-only and needs a live Supabase client to
 * exercise; the guarantee is the guard's presence + the preserved redirect logic).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("middleware session refresh — stale cookies degrade to signed-out, never an error", () => {
  const src = code("../lib/supabase/middleware.ts");

  it("wraps getUser() so an AuthApiError cannot escape the middleware", () => {
    // The refresh call must be inside a try/catch whose catch treats the user as null.
    expect(src).toMatch(/try\s*\{[\s\S]{0,200}await supabase\.auth\.getUser\(\)[\s\S]{0,200}\}\s*catch\s*\{[\s\S]{0,120}user = null/);
  });

  it("keeps the unauthenticated redirect path (stale cookie → login, not 500)", () => {
    expect(src).toContain("if (!user && !isPublicPath(pathname))");
    expect(src).toMatch(/pathname\.startsWith\("\/portal"\) \? "\/portal\/login" : "\/login"/);
  });

  it("keeps the public paths public (no redirect loop for login/auth/card routes)", () => {
    for (const p of ['"/login"', '"/portal/login"', '"/auth"', '"/portal/auth"', '"/card"']) {
      expect(src).toContain(p);
    }
  });

  it("still no-ops gracefully when Supabase env is absent (pre-config rendering)", () => {
    expect(src).toMatch(/if \(!url \|\| !anon\)[\s\S]{0,80}NextResponse\.next\(\{ request \}\)/);
  });
});
