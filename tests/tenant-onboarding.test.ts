/**
 * Phase 6.0E-2 — the DERIVED tenant onboarding checklist.
 *
 * The derivation is a pure function over facts already read (CompanySummary + the
 * tenant's rollout row). It is tested exhaustively; the wiring (bounded read, no
 * mutation of onboarding_status, links to real tabs) is asserted structurally.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { deriveOnboardingChecklist, type OnboardingTab } from "@/lib/platform/console/onboarding";
import type { CompanySummary } from "@/lib/platform/companies";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const onboardingSrc = read("../lib/platform/console/onboarding.ts");
const detail = read("../app/platform/companies/[id]/page.tsx");

function company(over: Partial<CompanySummary> = {}): CompanySummary {
  return {
    id: "t1",
    displayName: "Acme",
    slug: "acme",
    lifecycleStatus: "ACTIVE",
    productProfile: "LOGISTICS_COMPANY",
    planKey: "PROFESSIONAL",
    country: "SN",
    locale: "fr",
    currency: "XOF",
    timezone: "Africa/Dakar",
    onboardingStatus: "in_progress",
    brandingComplete: false,
    userCount: 1,
    activeDossierCount: 0,
    lastTenantLoginAt: null,
    enabledModules: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    trialStartedAt: null,
    trialEndsAt: null,
    administratorEmail: "admin@acme.sn",
    ...over,
  };
}

// ---------------------------------------------------------------- derivation ----

describe("deriveOnboardingChecklist — honest, derived progress", () => {
  it("a brand-new tenant (admin only) completes exactly the facts that are true", () => {
    const c = company();
    const cl = deriveOnboardingChecklist(c, { rowExists: false, live: false });
    const done = new Set(cl.items.filter((i) => i.complete).map((i) => i.key));
    // provisioned (always) + administrator (has admin) = 2 of 8.
    expect(done).toEqual(new Set(["provisioned", "administrator"]));
    expect(cl.completed).toBe(2);
    expect(cl.total).toBe(8);
    expect(cl.summary).toBe("2 sur 8 étapes terminées");
  });

  it("a fully-onboarded tenant completes every item", () => {
    const c = company({
      brandingComplete: true,
      userCount: 6,
      activeDossierCount: 3,
      lastTenantLoginAt: "2026-07-10T09:00:00.000Z",
    });
    const cl = deriveOnboardingChecklist(c, { rowExists: true, live: true });
    expect(cl.completed).toBe(cl.total);
    expect(cl.items.every((i) => i.complete)).toBe(true);
  });

  it("no administrator → the administrator + team + activity items are incomplete", () => {
    const c = company({ administratorEmail: null, userCount: 0 });
    const cl = deriveOnboardingChecklist(c, { rowExists: false, live: false });
    const byKey = Object.fromEntries(cl.items.map((i) => [i.key, i.complete]));
    expect(byKey.administrator).toBe(false);
    expect(byKey.team).toBe(false);
    // Only "provisioned" is true.
    expect(cl.completed).toBe(1);
  });

  it("rollout facts flow through unchanged (never recomputed)", () => {
    const c = company();
    const off = deriveOnboardingChecklist(c, { rowExists: true, live: false });
    const byKey = Object.fromEntries(off.items.map((i) => [i.key, i.complete]));
    expect(byKey.rollout_row).toBe(true);
    expect(byKey.rollout_live).toBe(false);
  });

  it("is deterministic — same input, same output", () => {
    const c = company({ userCount: 3, activeDossierCount: 1 });
    const a = deriveOnboardingChecklist(c, { rowExists: true, live: true });
    const b = deriveOnboardingChecklist(c, { rowExists: true, live: true });
    expect(a).toEqual(b);
  });

  it("the first-dossier item carries NO link (no platform page resolves it)", () => {
    const cl = deriveOnboardingChecklist(company(), { rowExists: false, live: false });
    const dossier = cl.items.find((i) => i.key === "first_dossier");
    expect(dossier?.tab).toBeNull();
  });

  it("every linked item points at a real console tab", () => {
    const valid: OnboardingTab[] = ["overview", "users", "branding", "rollout", null];
    const cl = deriveOnboardingChecklist(company(), { rowExists: true, live: true });
    for (const item of cl.items) expect(valid).toContain(item.tab);
  });
});

// ---------------------------------------------------------------- wiring ----

describe("the checklist is read-derived — no second onboarding system", () => {
  it("the module performs NO I/O and defines no mutable completion", () => {
    // Pure: no server-only, no supabase, no 'use server'. No mark-complete write.
    for (const forbidden of ["use server", "getAdminSupabaseClient", "supabase", ".update(", ".upsert(", "mark_complete"]) {
      expect(code("../lib/platform/console/onboarding.ts"), forbidden).not.toContain(forbidden);
    }
    expect(onboardingSrc).toContain("export function deriveOnboardingChecklist");
  });

  it("the detail tab derives it from a bounded rollout read and never writes onboarding_status", () => {
    expect(detail).toContain("deriveOnboardingChecklist");
    expect(detail).toContain("getRolloutOverview()");
    // The Onboarding tab must not mutate the descriptive onboarding_status field.
    expect(code("../app/platform/companies/[id]/page.tsx")).not.toContain("onboarding_status:");
  });
});
