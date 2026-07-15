/**
 * Phase 6.0F — Platform Copilot: safe, read-only, aggregate-first tenant awareness.
 *
 * The prompt/serializer are pure and tested directly; the permission, route, context
 * allowlist and client boundary are asserted structurally against source (no jsdom /
 * no live provider).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  isPlatformPermission,
  hasPlatformPermission,
  platformPermissionsFor,
} from "@/lib/platform/roles";
import {
  serializePlatformContext,
  buildPlatformSystemPrompt,
  buildPlatformMessages,
} from "@/lib/platform/copilot/prompt";
import { PLATFORM_COPILOT_CATEGORIES, type PlatformCopilotContext } from "@/lib/platform/copilot/types";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const route = read("../app/api/platform/copilot/route.ts");
const contextSrc = read("../lib/platform/copilot/context.ts");
const client = read("../components/platform/copilot-panel.tsx");

const ctx: PlatformCopilotContext = {
  generatedAt: "2026-07-15T10:00:00.000Z",
  tenantCount: 2,
  categories: [...PLATFORM_COPILOT_CATEGORIES],
  tenants: [
    {
      id: "t1", displayName: "Acme", slug: "acme", lifecycleStatus: "TRIAL", plan: "PROFESSIONAL",
      trial: { onTrial: true, expired: true, daysLeft: -2 },
      onboarding: { completed: 3, total: 8, incomplete: ["Image de marque configurée", "Premier dossier créé"] },
      userCount: 4, activeDossierCount: 0, rollout: { engineLive: false, features: [] },
      brandingComplete: false, lastTenantLoginAt: null, activityStale: true, hasAdministrator: true,
      invitations: { awaitingSetup: 2, cancelled: 1 }, health: "setup",
    },
    {
      id: "t2", displayName: "Globex", slug: "globex", lifecycleStatus: "ACTIVE", plan: "ENTERPRISE",
      trial: { onTrial: false, expired: false, daysLeft: null },
      onboarding: { completed: 8, total: 8, incomplete: [] },
      userCount: 20, activeDossierCount: 12, rollout: { engineLive: true, features: ["process_engine", "process_workspaces"] },
      brandingComplete: true, lastTenantLoginAt: "2026-07-14T09:00:00.000Z", activityStale: false, hasAdministrator: true,
      invitations: { awaitingSetup: 0, cancelled: 0 }, health: "healthy",
    },
  ],
};

// ---------------------------------------------------------------- permission ----

describe("platform:copilot:read is additive, platform-only, read-capable roles", () => {
  it("is a real platform permission, in the platform namespace", () => {
    expect(isPlatformPermission("platform:copilot:read")).toBe(true);
    expect("platform:copilot:read".startsWith("platform:")).toBe(true);
  });

  it("is granted to the read-capable platform roles, not billing", () => {
    expect(hasPlatformPermission("PLATFORM_SUPER_ADMIN", "platform:copilot:read")).toBe(true);
    expect(hasPlatformPermission("PLATFORM_SUPPORT", "platform:copilot:read")).toBe(true);
    expect(hasPlatformPermission("PLATFORM_READ_ONLY", "platform:copilot:read")).toBe(true);
    expect(platformPermissionsFor("PLATFORM_BILLING")).not.toContain("platform:copilot:read");
  });
});

// ---------------------------------------------------------------- prompt safety ----

describe("the system prompt encodes the non-overridable guardrails", () => {
  const sys = buildPlatformSystemPrompt();
  it("states read-only, platform scope, aggregate-first, and non-overridable", () => {
    expect(sys).toContain("LECTURE SEULE");
    expect(sys).toContain("PÉRIMÈTRE PLATEFORME");
    expect(sys).toContain("NON MODIFIABLES");
    expect(sys).toContain("AGRÉGATS D'ABORD");
  });
  it("forbids secrets, impersonation, invention, and distinguishes missing data from negative", () => {
    expect(sys).toContain("DONNÉE MANQUANTE ≠ RÉSULTAT NÉGATIF");
    expect(sys).toContain("usurpation");
    expect(sys).toContain("N'INVENTE RIEN");
    expect(sys).toContain("ne connais que les AGRÉGATS SÛRS");
  });
});

describe("the serializer emits ONLY safe aggregates", () => {
  const brief = serializePlatformContext(ctx);
  it("renders the safe per-tenant fields", () => {
    expect(brief).toContain("Acme");
    expect(brief).toContain("statut=TRIAL");
    expect(brief).toContain("essai EXPIRÉ");
    expect(brief).toContain("onboarding=3/8");
    expect(brief).toContain("santé=setup");
  });
  it("carries no PII, secrets, or tenant business content", () => {
    for (const forbidden of ["@", "password", "token", "action_link", "invoice", "declaration", "iban", "document"]) {
      expect(brief.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
  it("categories are a fixed safe allowlist (no dossier/finance/customs/document)", () => {
    for (const bad of ["dossier", "finance", "customs", "document", "communication", "audit_payload"]) {
      expect(PLATFORM_COPILOT_CATEGORIES as readonly string[]).not.toContain(bad);
    }
  });
});

describe("buildPlatformMessages assembles system + user with the brief", () => {
  const msgs = buildPlatformMessages(ctx, "Quels tenants sont en onboarding ?");
  it("has exactly one system and one user message", () => {
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(1);
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(1);
  });
  it("puts the guardrails in system and the question + brief in user", () => {
    expect(msgs[0].content).toContain("LECTURE SEULE");
    expect(msgs[1].content).toContain("QUESTION DE L'OPÉRATEUR");
    expect(msgs[1].content).toContain("SYNTHÈSE PLATEFORME");
  });
});

// ---------------------------------------------------------------- the route ----

describe("the route is platform-gated, reuses the shared engine, audits safely", () => {
  it("authorizes via platform:copilot:read and 403s otherwise", () => {
    expect(route).toContain('assertPlatformPermission("platform:copilot:read")');
    expect(route).toContain('new NextResponse("Forbidden", { status: 403 })');
  });
  it("reuses the provider-neutral engine — never calls a provider directly", () => {
    expect(route).toContain("runCopilot(messages)");
    for (const forbidden of ["openai", "anthropic", "ollama", "generateAI", "fetch("]) {
      expect(code("../app/api/platform/copilot/route.ts").toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
  it("performs no mutation / operational action", () => {
    for (const forbidden of ["suspendTenant", "setTenantRollout", "createUser", "updateTenantBranding", "resendTenantInvitation"]) {
      expect(route, forbidden).not.toContain(forbidden);
    }
  });
  it("audits SAFE metadata only — never the prompt or the answer", () => {
    expect(AuditActions.PLATFORM_COPILOT_QUERY).toBe("platform.copilot.query");
    expect(route).toContain("AuditActions.PLATFORM_COPILOT_QUERY");
    const start = route.indexOf("writeAudit(");
    const auditBlock = route.slice(start, route.indexOf("});", start) + 3);
    // Neither the request prompt nor the answer variable (`text`) is logged; only safe
    // metadata (provider/model/tenantCount/categories/outcome). "answered" is a status.
    expect(auditBlock).not.toContain("prompt");
    expect(auditBlock).not.toContain("rawPrompt");
    expect(auditBlock).not.toMatch(/[:\s]text\b/);
    expect(auditBlock).toContain("tenantCount");
    expect(auditBlock).toContain('outcome: "answered"');
  });
});

describe("the context builder is allowlisted and platform-gated", () => {
  it("gates on platform:copilot:read", () => {
    expect(contextSrc).toContain('assertPlatformPermission("platform:copilot:read")');
  });
  it("reduces the administrator to a boolean — no PII, no secrets, no business tables", () => {
    expect(contextSrc).toContain("hasAdministrator");
    // The snapshot output never carries the admin email or any sensitive/business column.
    // (physical_invoice_deposit is a safe rollout FEATURE flag, not financial data.)
    for (const forbidden of ["administratorEmail:", "password", "action_link", "declaration", "document_body", "iban"]) {
      expect(code("../lib/platform/copilot/context.ts"), forbidden).not.toContain(forbidden);
    }
    // Reads are the safe aggregates only.
    expect(contextSrc).toContain("listCompanies()");
    expect(contextSrc).toContain("getRolloutOverview()");
  });
});

describe("the client panel never calls a provider directly", () => {
  it("POSTs to the platform route only; no admin client / provider / service role", () => {
    expect(client).toContain('fetch("/api/platform/copilot"');
    for (const forbidden of ["getAdminSupabaseClient", "generateAI", "service_role", "openai", "anthropic"]) {
      expect(code("../components/platform/copilot-panel.tsx").toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
