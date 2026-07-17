/**
 * Phase 8.2 — Operations & Support console. Verified structurally: the console is COMPOSITION
 * over existing capabilities (getAIStatus, isProviderConfigured, getPlatformCompanyStats, audit
 * aggregates), gated by EXISTING platform RBAC, degrade-by-card, secret-free, provider-neutral,
 * and honest about what it cannot know (backup state, uncollected metrics, DDL-only migrations).
 * The build-info constants are pinned against the real migrations directory so they cannot drift.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LATEST_MIGRATION, MIGRATION_COUNT, MIGRATION_PROBE } from "@/lib/platform/ops/build-info";
import { platformNav } from "@/lib/platform/nav";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------- build info: drift-proof ----
describe("build-info constants are pinned to the real migrations directory", () => {
  const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
  const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  it("LATEST_MIGRATION is the actual newest migration", () => {
    expect(`${LATEST_MIGRATION}.sql`).toBe(migrations[migrations.length - 1]);
  });
  it("MIGRATION_COUNT is the actual count", () => {
    expect(MIGRATION_COUNT).toBe(migrations.length);
  });
  it("the probe marker migration exists and its permission code is the executive one", () => {
    expect(migrations).toContain(`${MIGRATION_PROBE.migration}.sql`);
    expect(read(`../supabase/migrations/${MIGRATION_PROBE.migration}.sql`)).toContain(MIGRATION_PROBE.permissionCode);
  });
});

// ---------------------------------------------------------------- authorization ----
describe("authorization — existing platform RBAC only, no new permission", () => {
  const src = code("../lib/platform/ops/readers.ts");
  it("the composed reader gates on platform:audit:read", () => {
    expect(src).toContain('assertPlatformPermission("platform:audit:read")');
  });
  it("the page handles the auth error with a notice (no crash, no leak)", () => {
    const page = code("../app/platform/operations/page.tsx");
    expect(page).toContain("PlatformAuthError");
    expect(page).toContain("Accès réservé aux administrateurs plateforme");
  });
  it("no new permission string was invented anywhere", () => {
    expect(src + code("../app/platform/operations/page.tsx")).not.toMatch(/platform:ops|ops:read|operations:read/);
  });
  it("nav gains exactly one item, under the existing platform nav, behind an existing permission", () => {
    const item = platformNav.find((i) => i.href === "/platform/operations");
    expect(item).toBeDefined();
    expect(item!.label).toBe("Opérations & Support");
    expect(item!.permission).toBe("platform:audit:read");
  });
});

// ---------------------------------------------------------------- composition & reuse ----
describe("composition — existing capabilities, no duplicated logic", () => {
  const src = code("../lib/platform/ops/readers.ts");
  it("reuses the existing readers instead of re-deriving", () => {
    expect(src).toContain('from "@/lib/ai/health"');
    expect(src).toContain('from "@/lib/comms/provider"');
    expect(src).toContain("getPlatformCompanyStats");
    expect(src).toContain('from "@/lib/audit/events"');
  });
  it("performs no writes anywhere (read-only console)", () => {
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|writeAudit/);
  });
  it("audit counters are bounded HEAD counts / capped ranges — no unbounded row fetch", () => {
    expect(src).toMatch(/count: "exact", head: true/);
    expect(src).toMatch(/range\(0, 500\)/);
  });
});

// ---------------------------------------------------------------- degradation ----
describe("degrade-by-card — one failing subsystem never breaks the page", () => {
  const src = code("../lib/platform/ops/readers.ts");
  it("all sections load under Promise.allSettled and failures are recorded as unavailable", () => {
    expect(src).toContain("Promise.allSettled");
    expect((src.match(/unavailable\.push\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
  it("the page renders an explicit unavailable notice — never fakes health", () => {
    const page = read("../app/platform/operations/page.tsx");
    expect(page).toContain("indisponible ≠ sain");
  });
  it("a per-bucket storage failure degrades that bucket only", () => {
    expect(src).toMatch(/catch \{\s*buckets\.push\(\{ bucket, objectCount: null/);
  });
});

// ---------------------------------------------------------------- provider neutrality ----
describe("provider-neutral — no hardcoded provider or model names", () => {
  it("neither reader nor page names a provider/model; both render from getAIStatus", () => {
    const both = code("../lib/platform/ops/readers.ts") + code("../app/platform/operations/page.tsx");
    expect(both).not.toMatch(/OpenAI|Anthropic|Ollama|vLLM|gpt-|claude|qwen/i);
  });
  it("the live provider probe runs ONLY on the explicit verify action, never on page load", () => {
    const src = code("../lib/platform/ops/readers.ts");
    expect(src).toMatch(/runHealthCheck: verify/);
    const page = code("../app/platform/operations/page.tsx");
    expect(page).toMatch(/verifyAi: searchParams\?\.verify === "ai"/);
  });
});

// ---------------------------------------------------------------- secrets & honesty ----
describe("secret-free and honest", () => {
  const src = read("../lib/platform/ops/readers.ts");
  const page = read("../app/platform/operations/page.tsx");

  it("never reads raw secret env values into the payload (booleans/hosts only)", () => {
    // The only env reads are Vercel build identity + presence booleans.
    expect(src).not.toMatch(/process\.env\.(SUPABASE_SERVICE_ROLE_KEY|AI_API_KEY|OPENAI_API_KEY|RESEND_API_KEY)\s*(?!\))/);
    expect(src).toMatch(/Boolean\(process\.env\.NEXT_PUBLIC_SUPABASE_URL && process\.env\.SUPABASE_SERVICE_ROLE_KEY\)/);
  });
  it("email card exposes counts only — never a recipient address column", () => {
    // comments stripped: the CODE must never select a recipient column from communication
    expect(code("../lib/platform/ops/readers.ts")).not.toMatch(/recipient|to_email|\bto\b.*select|address/i);
  });
  it("backup status is honestly UNAVAILABLE — never fabricated", () => {
    expect(page).toContain("Statut de sauvegarde indisponible");
    expect(page).not.toMatch(/backupHealthy|lastBackupAt/);
  });
  it("uncollected metrics are stated as uncollected, not invented", () => {
    expect(src).toContain("collected: false");
    expect(page).toContain("ne sont pas collectés dans l'application");
  });
  it("no scheduled-job fabrication — the comms queue is stated as the only queue", () => {
    expect(src).toContain("scheduledJobsExist: false");
    expect(page).toContain("Aucune tâche planifiée");
  });
  it("no destructive action exists on the page (links re-render only)", () => {
    expect(page).not.toMatch(/<form|"use server"|onClick|\.delete|\.update|POST/);
  });
});
