/**
 * EFF-STAGING-ISOLATION-02 — the deployment may only touch its own database.
 * ---------------------------------------------------------------------------
 * EFF-PR33-PREVIEW-DATA-ISOLATION-01 established that Vercel Previews and
 * Production resolve to the same Supabase project, so a preview writes real
 * operational data with a key that bypasses RLS. These tests pin the guard that
 * makes that impossible, and — just as important — pin the three places it must
 * NOT fire, because a guard that breaks CI, local development or Production is
 * not a safeguard, it is an outage:
 *
 *   * CI builds with NO Supabase variables at all (`lib/env.ts` is not imported
 *     at build time) → "unconfigured" must pass;
 *   * local development points at 127.0.0.1 → "local" must pass;
 *   * Production, TODAY, has no PRODUCTION_SUPABASE_PROJECT_REF installed →
 *     must pass, reported as unverified rather than silently assumed isolated.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LOCAL_DB_HOSTS,
  VERIFIED_STATUSES,
  bindingRefusalMessage,
  bindingSummary,
  classifyEnvironment,
  classifyTarget,
  evaluateBinding,
  isVerified,
} from "@/lib/env/project-binding.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PROD = "abcdefghijklmnopqrst"; // 20 chars, the shape of a real ref
const STAGING = "zyxwvutsrqponmlkjihg";
const prodUrl = `https://${PROD}.supabase.co`;
const stagingUrl = `https://${STAGING}.supabase.co`;

const pureRaw = read("lib/env/project-binding.mjs");
// Structural bans must read CODE, not the prose that explains it: this module's
// own documentation says the words "bypasses RLS" and "process.env".
const pure = strip(pureRaw);
const runtime = strip(read("lib/env/binding-runtime.ts"));
const admin = strip(read("lib/supabase/admin.ts"));
const serverClient = strip(read("lib/supabase/server.ts"));
const browserClient = read("lib/supabase/client.ts");
const mw = read("lib/supabase/middleware.ts");
const nextConfig = read("next.config.mjs");
const versionRoute = read("app/api/version/route.ts");
const checkScript = read("scripts/check-env-binding.mjs");
const envExample = read(".env.example");
const pkg = JSON.parse(read("package.json"));

afterEach(() => vi.unstubAllEnvs());

// ═══════════ the rule ══════════════════════════════════════════════════════

describe("BINDING-01 — a non-production deployment may not touch Production", () => {
  it("01 — preview bound to the production project is REFUSED", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "preview", productionRef: PROD });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("non_production_bound_to_production_project");
  });

  it("02 — development (CI, local, `vercel dev`) bound to Production is REFUSED", () => {
    for (const vercelEnv of ["development", undefined, "", "staging", "nonsense"]) {
      const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv, productionRef: PROD });
      expect(v.ok, String(vercelEnv)).toBe(false);
    }
  });

  it("03 — preview bound to a DIFFERENT project is allowed, and says so positively", () => {
    const v = evaluateBinding({ supabaseUrl: stagingUrl, vercelEnv: "preview", productionRef: PROD });
    expect(v.ok).toBe(true);
    expect(v.status).toBe("verified_isolated");
    expect(isVerified(v)).toBe(true);
  });

  it("04 — production bound to the approved project is allowed", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "production", productionRef: PROD });
    expect(v.ok).toBe(true);
    expect(v.status).toBe("verified_production");
  });

  it("05 — production bound to a FOREIGN project is REFUSED (staging data to real customers)", () => {
    const v = evaluateBinding({ supabaseUrl: stagingUrl, vercelEnv: "production", productionRef: PROD });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("production_bound_to_foreign_project");
  });

  it("06 — an unrecognised host that MENTIONS the production ref is refused off production", () => {
    const pooler = `https://db.${PROD}.pooler.example.net:6543`;
    expect(evaluateBinding({ supabaseUrl: pooler, vercelEnv: "preview", productionRef: PROD }).ok).toBe(false);
    expect(evaluateBinding({ supabaseUrl: pooler, vercelEnv: "production", productionRef: PROD }).ok).toBe(true);
  });
});

// ═══════════ the three places it must not fire ═════════════════════════════

describe("BINDING-01 — legitimate CI, local and pre-configuration states survive", () => {
  it("07 — CI: no Supabase variables at all → allowed, 'unconfigured'", () => {
    for (const supabaseUrl of [undefined, "", "   "]) {
      const v = evaluateBinding({ supabaseUrl, vercelEnv: undefined, productionRef: PROD });
      expect(v.ok, JSON.stringify(supabaseUrl)).toBe(true);
      expect(v.status).toBe("unconfigured");
    }
  });

  it("08 — local development: every loopback host is allowed and counts as verified", () => {
    for (const host of LOCAL_DB_HOSTS) {
      const url = host.includes(":") ? `http://[${host.replace(/[[\]]/g, "")}]:54321` : `http://${host}:54321`;
      const v = evaluateBinding({ supabaseUrl: url, vercelEnv: undefined, productionRef: PROD });
      expect(v.ok, host).toBe(true);
      expect(v.status, host).toBe("local");
      expect(isVerified(v), host).toBe(true);
    }
  });

  it("09 — TODAY's production, with no expectation installed, keeps working", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "production", productionRef: undefined });
    expect(v.ok).toBe(true);
    expect(v.status).toBe("unverified_no_expectation");
    // …but it is NOT reported as proven isolated — absence of evidence is visible.
    expect(isVerified(v)).toBe(false);
  });

  it("10 — and so does today's preview, which is the state the audit found", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "preview", productionRef: undefined });
    expect(v.ok).toBe(true);
    expect(isVerified(v)).toBe(false);
  });
});

// ═══════════ strict mode only ever tightens ════════════════════════════════

describe("BINDING-01 — strict mode", () => {
  it("11 — turns every unverifiable state into a refusal", () => {
    for (const input of [
      { supabaseUrl: prodUrl, vercelEnv: "production", productionRef: undefined },
      { supabaseUrl: "https://gateway.example.test", vercelEnv: "preview", productionRef: PROD },
    ]) {
      expect(evaluateBinding({ ...input, strict: false }).ok).toBe(true);
      const v = evaluateBinding({ ...input, strict: true });
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toBe("unverified_binding_in_strict_mode");
    }
  });

  it("12 — never loosens: no flag lets a preview reach production", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "preview", productionRef: PROD, strict: false });
    expect(v.ok).toBe(false);
    // and the verified / local states are unaffected by strictness
    expect(evaluateBinding({ supabaseUrl: stagingUrl, vercelEnv: "preview", productionRef: PROD, strict: true }).ok).toBe(true);
    expect(evaluateBinding({ supabaseUrl: "http://127.0.0.1:54321", vercelEnv: undefined, productionRef: PROD, strict: true }).ok).toBe(true);
    expect(evaluateBinding({ supabaseUrl: undefined, vercelEnv: "preview", productionRef: PROD, strict: true }).ok).toBe(true);
    expect(pure).not.toMatch(/ALLOW_PRODUCTION|FORCE_BINDING|SKIP_BINDING|BYPASS_BINDING/i);
  });
});

// ═══════════ classification ════════════════════════════════════════════════

describe("BINDING-01 — classification is conservative", () => {
  it("13 — only Vercel's three words are honoured; anything else is development", () => {
    expect(classifyEnvironment("production")).toBe("production");
    expect(classifyEnvironment("PRODUCTION ")).toBe("production");
    expect(classifyEnvironment("preview")).toBe("preview");
    for (const v of [undefined, null, "", "prod", "staging", "live", "test"]) {
      expect(classifyEnvironment(v as string), String(v)).toBe("development");
    }
  });

  it("14 — targets are named, never guessed", () => {
    expect(classifyTarget(prodUrl)).toEqual({ kind: "cloud", ref: PROD, host: `${PROD}.supabase.co` });
    expect(classifyTarget("http://127.0.0.1:54321").kind).toBe("local");
    expect(classifyTarget("https://self-hosted.example.test").kind).toBe("unknown");
    expect(classifyTarget("not a url").kind).toBe("unknown");
    expect(classifyTarget(undefined).kind).toBe("unconfigured");
    // a ref is matched only as the whole first label of a supabase host
    expect(classifyTarget(`https://${PROD}.supabase.co.evil.test`).kind).toBe("unknown");
    expect(classifyTarget(`https://api.${PROD}.supabase.co`).kind).toBe("unknown");
  });

  it("15 — VERIFIED_STATUSES are exactly the three that prove something", () => {
    expect([...VERIFIED_STATUSES]).toEqual(["verified_production", "verified_isolated", "local"]);
  });
});

// ═══════════ messages and the public report leak nothing ═══════════════════

describe("BINDING-01 — nothing printed is a secret", () => {
  it("16 — a refusal explains and instructs without quoting a URL or a ref", () => {
    const v = evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "preview", productionRef: PROD });
    const msg = bindingRefusalMessage(v);
    expect(msg).toContain("REFUSED");
    expect(msg).toContain("staging");
    expect(msg).not.toContain(PROD);
    expect(msg).not.toContain(prodUrl);
    // Naming the VARIABLES the operator must set is the point of the message;
    // what must never appear is a VALUE — a JWT, a connection string, a host.
    expect(msg).not.toMatch(/eyJ[A-Za-z0-9_-]{10}|postgres(ql)?:\/\/|\.supabase\.co/);
  });

  it("17 — the build-log summary shows a 4+4 hint, never the whole ref", () => {
    const s = bindingSummary(evaluateBinding({ supabaseUrl: prodUrl, vercelEnv: "production", productionRef: PROD }));
    expect(s).toContain(`${PROD.slice(0, 4)}…${PROD.slice(-4)}`);
    expect(s).not.toContain(PROD);
  });

  it("18 — the /api/version report carries a hint, a hash and a verdict — no host, no key, no full ref", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", prodUrl);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_SUPABASE_PROJECT_REF", PROD);
    vi.resetModules();
    const { bindingReport, refFingerprint } = await import("@/lib/env/binding-runtime");
    const r = bindingReport();
    expect(r).toEqual({
      envClass: "production",
      target: "cloud",
      refHint: `${PROD.slice(0, 4)}…${PROD.slice(-4)}`,
      refFingerprint: refFingerprint(PROD),
      status: "verified_production",
      verified: true,
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(PROD);
    expect(serialized).not.toContain("supabase.co");
    expect(r.refFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(refFingerprint(PROD)).not.toBe(refFingerprint(STAGING));
    expect(refFingerprint(PROD)).toBe(refFingerprint(PROD)); // stable
  });
});

// ═══════════ the runtime actually refuses ══════════════════════════════════

describe("BINDING-01 — the client factories refuse a forbidden binding", () => {
  async function freshRuntime(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
    vi.resetModules();
    return import("@/lib/env/binding-runtime");
  }

  it("19 — assertSupabaseBinding throws for a preview bound to Production", async () => {
    const { assertSupabaseBinding } = await freshRuntime({
      NEXT_PUBLIC_SUPABASE_URL: prodUrl,
      VERCEL_ENV: "preview",
      PRODUCTION_SUPABASE_PROJECT_REF: PROD,
    });
    expect(() => assertSupabaseBinding()).toThrow(/REFUSED/);
  });

  it("20 — and does nothing for an isolated preview, a local run, or Production", async () => {
    for (const env of [
      { NEXT_PUBLIC_SUPABASE_URL: stagingUrl, VERCEL_ENV: "preview", PRODUCTION_SUPABASE_PROJECT_REF: PROD },
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", VERCEL_ENV: undefined, PRODUCTION_SUPABASE_PROJECT_REF: PROD },
      { NEXT_PUBLIC_SUPABASE_URL: prodUrl, VERCEL_ENV: "production", PRODUCTION_SUPABASE_PROJECT_REF: PROD },
      { NEXT_PUBLIC_SUPABASE_URL: prodUrl, VERCEL_ENV: "production", PRODUCTION_SUPABASE_PROJECT_REF: undefined },
    ]) {
      const { assertSupabaseBinding } = await freshRuntime(env);
      expect(() => assertSupabaseBinding(), JSON.stringify(env.VERCEL_ENV)).not.toThrow();
    }
  });
});

// ═══════════ where the guard is wired, and where it must NOT be ════════════

describe("BINDING-01 — wiring", () => {
  it("21 — the privileged client asserts BEFORE it is constructed", () => {
    expect(admin).toContain("assertSupabaseBinding();");
    expect(admin.indexOf("assertSupabaseBinding();")).toBeLessThan(admin.indexOf("createClient<Database>"));
  });

  it("22 — so does the user-context client, which six modules write through", () => {
    expect(serverClient).toContain("assertSupabaseBinding();");
    expect(serverClient.indexOf("assertSupabaseBinding();")).toBeLessThan(serverClient.indexOf("createServerClient<Database>"));
  });

  it("23 — the BROWSER client is deliberately NOT guarded (VERCEL_ENV is not public)", () => {
    // A client-side copy would read "development" on a production page and
    // refuse the production project — an outage, not a safeguard. The browser is
    // protected at build time instead (test 25).
    expect(browserClient).not.toContain("binding-runtime");
    expect(browserClient).not.toContain("assertSupabaseBinding");
    expect(mw).not.toContain("assertSupabaseBinding");
    expect(runtime).toContain('import "server-only"');
  });

  it("24 — the pure module stays pure: no env, no I/O, no node builtins", () => {
    expect(pure).not.toContain("process.env");
    expect(pure).not.toMatch(/from "node:|require\(/);
    expect(pure).not.toMatch(/\bfetch\(|createClient/);
  });

  it("25 — the build refuses, in next.config (immune to a changed build command)", () => {
    expect(nextConfig).toContain('from "./lib/env/project-binding.mjs"');
    expect(nextConfig).toContain("evaluateBinding({");
    expect(nextConfig).toContain("if (!binding.ok) {");
    expect(nextConfig).toContain("throw new Error(bindingSummary(binding));");
  });

  it("26 — and in the npm lifecycle, before every build and every dev run", () => {
    expect(pkg.scripts.prebuild).toBe("node scripts/check-env-binding.mjs");
    expect(pkg.scripts.predev).toBe("node scripts/check-env-binding.mjs --dotenv");
    expect(pkg.scripts["check:binding"]).toBe("node scripts/check-env-binding.mjs");
    expect(pkg.scripts.build).toBe("next build"); // unchanged
    expect(checkScript).toContain('from "../lib/env/project-binding.mjs"');
    expect(checkScript).toContain("process.exit(1)");
  });

  it("27 — /api/version publishes the report and still no configuration", () => {
    expect(versionRoute).toContain("db: bindingReport(),");
    expect(versionRoute).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|ANON_KEY|NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("28 — the external probe is read-only and needs no credential", () => {
    const probe = read("scripts/gate/verify-deployment-binding.mjs");
    expect(probe).toContain("/api/version");
    expect(probe).toContain("refFingerprint");
    expect(probe).toMatch(/method:\s*["']GET|fetch\(target/);
    expect(probe).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(probe).not.toMatch(/SERVICE_ROLE|Authorization/i);
  });
});

// ═══════════ documentation and hygiene ═════════════════════════════════════

describe("BINDING-01 — documented, and no real identifier committed", () => {
  it("29 — both new variables are documented, with the unset behaviour stated", () => {
    expect(envExample).toMatch(/^PRODUCTION_SUPABASE_PROJECT_REF=$/m);
    expect(envExample).toMatch(/^ENV_BINDING_STRICT=false$/m);
    expect(envExample).toContain("unverified");
    expect(envExample).toContain("docs/production/staging-isolation-plan.md");
  });

  it("30 — the missing EC inbound flag is now documented too", () => {
    expect(envExample).toMatch(/^EFFITRANS_EC_INBOUND_ENABLED=false$/m);
    expect(envExample).toContain("lib/ec/inbound/providers.ts");
  });

  it("31 — no real Supabase project ref is committed in anything this slice added", () => {
    const refLike = /\b[a-z]{16,40}\b/g;
    const allow = new Set(["supabase", "production", "development", "unconfigured", "verification", "configuration"]);
    for (const [name, src] of [
      ["project-binding.mjs", pureRaw],
      ["binding-runtime.ts", runtime],
      ["check-env-binding.mjs", checkScript],
      [".env.example", envExample.slice(envExample.indexOf("--- Environment / database binding guard"), envExample.indexOf("--- Communications Hub"))],
    ] as const) {
      for (const m of src.match(refLike) ?? []) {
        if (allow.has(m)) continue;
        expect(`${name}:${m}`, "a 16+ char lowercase token looks like a project ref").not.toMatch(/^[a-z]{20}$/);
      }
    }
    expect(pureRaw).not.toContain("supabase.co/");
  });
});
