/**
 * Phase 8.0B — pilot-gate tooling. The /api/version endpoint is the canonical "verify the served
 * SHA" mechanism (gate C1); it must stay PUBLIC, read-only and secret-free, and the middleware
 * must let it through for anonymous callers. The verification script is checked structurally
 * (it must probe the gate's required routes and never carry credentials).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/api/version — public, read-only, secret-free build attestation", () => {
  const src = code("../app/api/version/route.ts");

  it("returns ONLY the Vercel-provided build identity (sha/ref/env/hosted)", () => {
    expect(src).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(src).toContain("VERCEL_GIT_COMMIT_REF");
    expect(src).toContain("VERCEL_ENV");
    // No config, no provider, no key, no supabase value may ever be returned here.
    expect(src).not.toMatch(/SUPABASE|API_KEY|SERVICE_ROLE|AI_|OPENAI|RESEND|provider|model/i);
  });

  it("is GET-only and performs no reads or writes beyond process.env", () => {
    expect(src).toContain("export async function GET");
    expect(src).not.toMatch(/POST|supabase|from\(|writeAudit|fetch\(/);
  });

  it("middleware exempts exactly /api/version (anonymous callers must reach it)", () => {
    const mw = code("../lib/supabase/middleware.ts");
    expect(mw).toContain('pathname === "/api/version"');
  });
});

describe("RLS fixture suite is local-only (8.0C finding AC-1 — prod fixture pollution)", () => {
  it("test:rls routes through the local-database guard", () => {
    const pkg = read("../package.json");
    expect(pkg).toContain('"test:rls": "node scripts/guard-local-db.mjs && psql');
  });
  it("the guard refuses any non-local DATABASE_URL host", () => {
    const g = read("../scripts/guard-local-db.mjs");
    expect(g).toContain("LOCAL_HOSTS");
    expect(g).toMatch(/process\.exit\(1\)/);
    expect(g).toMatch(/localhost|127\.0\.0\.1/);
  });
});

describe("verify-production script — mechanical C1 sweep, credential-free", () => {
  const src = read("../scripts/gate/verify-production.mjs");

  it("checks the served SHA against the expected SHA (stale-deploy guard, finding F-5)", () => {
    expect(src).toContain("/api/version");
    expect(src).toMatch(/SERVED SHA MISMATCH/);
  });

  it("sweeps every gate-required route from the 8.0B brief", () => {
    for (const route of ["/login", "/dashboard", "/dashboard/executive", "/departments/transport", "/customs/intelligence", "/shipping", "/air", "/portal"]) {
      expect(src).toContain(`"${route}"`);
    }
  });

  it("verifies portal routes redirect to the PORTAL login (identity-wall check)", () => {
    expect(src).toContain('"/portal/login"');
    expect(src).toMatch(/PORTAL_PROTECTED/);
  });

  it("detects the protection wall explicitly instead of failing opaquely", () => {
    expect(src).toContain("sso-api");
    expect(src).toMatch(/SEALED|sealed/);
  });

  it("carries no credential and sends none (anonymous probes only)", () => {
    expect(src).not.toMatch(/Authorization|Bearer|apikey|API_KEY|process\.env\.(?!argv)/i);
  });
});
