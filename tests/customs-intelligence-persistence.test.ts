/**
 * Phase 7.1B — Customs Intelligence persistence, transition service, provider adapter
 * boundary, and console. Pure logic is exercised directly; server-only modules (service,
 * actions) and the client console are verified by structural source assertions (the
 * no-jsdom convention). GAINDE remains a boundary — no live integration is claimed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { mapProviderStatus, GAINDE_STATUS_MAP, normalizeRawStatus } from "@/lib/customs/intelligence/status-map";
import { deriveProviderConfig, GAINDE_READINESS_CHECKLIST, resolveProviderConfig } from "@/lib/customs/intelligence/config";
import { rowToDeclaration, rowToView, coerceDeclarationStatus, INTEL_RECORD_COLS, type IntelRecordRow } from "@/lib/customs/intelligence/persistence";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** Comment-stripped source (full-line + block comments) for structural code assertions. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function row(over: Partial<IntelRecordRow> = {}): IntelRecordRow {
  return {
    id: "d1", file_id: "f1", status: "DECLARED", required: true, declaration_number: "DN-1",
    customs_office: "DKR", regime: "IM4", declaration_date: "2026-07-10", bae_reference: null, release_date: null,
    inspection_status: "PENDING", external_ref: null, notes: null,
    intel_status: "SUBMITTED", provider_code: "manual", provider_reference: "MANUAL-d1",
    provider_synced_at: null, provider_error: null, intel_version: 3,
    submitted_at: "2026-07-10T08:00:00Z", released_at: null, updated_at: "2026-07-11T00:00:00Z", ...over,
  };
}

// ------------------------------------------------------------ provider status map ----

describe("provider status mapping is an allowlist (never guesses)", () => {
  it("GAINDE has NO status rules until the official vocabulary is verified", () => {
    expect(Object.keys(GAINDE_STATUS_MAP)).toHaveLength(0);
  });
  it("an unknown provider status is unmapped — not fuzzy-matched", () => {
    expect(mapProviderStatus("GAINDE", "MAINLEVEE")).toEqual({ confidence: "unmapped", status: null, reason: "unknown_provider_status" });
    expect(mapProviderStatus("manual", "banana")).toMatchObject({ confidence: "unmapped", status: null });
  });
  it("the manual provider already speaks the canonical vocabulary", () => {
    expect(mapProviderStatus("manual", "released")).toMatchObject({ confidence: "exact", status: "RELEASED" });
    expect(normalizeRawStatus("  released ")).toBe("RELEASED");
  });
});

// -------------------------------------------------------------- provider config ------

describe("provider configuration resolver (server-only intent, no secrets)", () => {
  it("manual is configured; nothing to provision", () => {
    expect(deriveProviderConfig("manual", {})).toMatchObject({ status: "configured", live: true });
  });
  it("GAINDE is honestly unsupported, with the readiness checklist", () => {
    const c = deriveProviderConfig("GAINDE", { GAINDE_API_URL: "https://should-be-ignored" });
    expect(c).toMatchObject({ status: "unsupported", live: false });
    expect(c.requiredInputs).toBe(GAINDE_READINESS_CHECKLIST);
    expect(c.requiredInputs).toContain("Official GAINDE API documentation");
    expect(c.presentInputs).toEqual([]); // never reports invented env as present
  });
  it("an unknown provider is unsupported", () => {
    expect(deriveProviderConfig("ORBUS", {}).status).toBe("unsupported");
  });
  it("resolveProviderConfig returns a config shape without leaking values", () => {
    const c = resolveProviderConfig("GAINDE");
    expect(Object.keys(c).sort()).toEqual(["live", "presentInputs", "providerCode", "requiredInputs", "status"]);
  });
});

// ---------------------------------------------------------- persistence mapping ------

describe("rowToDeclaration reuses toDeclaration + reads the 7.1B columns", () => {
  it("maps canonical status, provider ref, and submitted time", () => {
    const d = rowToDeclaration(row());
    expect(d.status).toBe("SUBMITTED");
    expect(d.provider.provider).toBe("manual");
    expect(d.provider.externalReference).toBe("MANUAL-d1");
    expect(d.provider.submittedAt).toBe("2026-07-10T08:00:00Z");
  });
  it("uses a canonical released_at fallback when there is no operational BAE", () => {
    const d = rowToDeclaration(row({ intel_status: "RELEASED", released_at: "2026-07-15T00:00:00Z", bae_reference: null }));
    expect(d.release).toEqual({ reference: "MANUAL-d1", releasedAt: "2026-07-15T00:00:00Z" });
  });
  it("prefers the operational BAE release when present", () => {
    const d = rowToDeclaration(row({ bae_reference: "BAE-9", release_date: "2026-07-14" }));
    expect(d.release).toEqual({ reference: "BAE-9", releasedAt: "2026-07-14" });
  });
  it("coerces an unknown stored status back to DRAFT (never throws)", () => {
    expect(coerceDeclarationStatus("WAT")).toBe("DRAFT");
    expect(rowToDeclaration(row({ intel_status: "not-a-status" })).status).toBe("DRAFT");
  });
  it("rowToView carries persistence metadata (version, operational status, sync)", () => {
    const v = rowToView(row({ provider_error: "not_configured", provider_synced_at: "2026-07-11T09:00:00Z" }));
    expect(v.meta).toMatchObject({ version: 3, operationalStatus: "DECLARED", providerError: "not_configured" });
  });
  it("selects the intel columns it reads", () => {
    for (const col of ["intel_status", "provider_code", "provider_reference", "intel_version", "submitted_at", "released_at"]) {
      expect(INTEL_RECORD_COLS).toContain(col);
    }
  });
});

// ------------------------------------------------ transition service (structural) ----

describe("transition service enforces the safety invariants", () => {
  const src = code("../lib/customs/intelligence/actions.ts");
  it("is a server action module", () => {
    expect(read("../lib/customs/intelligence/actions.ts")).toContain('"use server"');
  });
  it("resolves tenant + actor from the session, never the browser", () => {
    expect(src).toContain("assertPermission");
    expect(src).toContain("user.tenantId");
    expect(src).toContain("user.id");
    // The exported actions take only ids/status/version — no tenantId/actorId parameter.
    expect(src).toMatch(/transitionDeclaration\(\s*id: string,\s*toStatus: string,\s*expectedVersion: number,?\s*\)/);
    expect(src).toMatch(/refreshDeclaration\(id: string\)/);
  });
  it("gates RELEASED on customs:release and other transitions on customs:update (no new perm)", () => {
    expect(src).toContain('"customs:release"');
    expect(src).toContain('"customs:update"');
    expect(src).not.toMatch(/customs:intel|intelligence:|declaration:/);
  });
  it("validates every transition locally via the engine before persisting", () => {
    expect(src).toContain("new CustomsEngine(resolveProvider(");
    expect(src).toContain("engine.transition(");
  });
  it("persists with compare-and-set on intel_version", () => {
    expect(src).toContain('.eq("intel_version", expectedVersion)');
    expect(src).toContain("stale_transition");
  });
  it("normalizes + validates the provider response; unknown never transitions", () => {
    expect(src).toContain("mapProviderStatus(");
    expect(src).toContain('mapped.confidence === "unmapped"');
    expect(src).toContain("providerConfigured");
  });
  it("bounds provider calls with a timeout", () => {
    expect(src).toContain("withTimeout(engine.poll(");
    expect(src).toContain("PROVIDER_TIMEOUT_MS");
  });
  it("audits via the reused customs status-change event, marking the source", () => {
    expect(src).toContain("transitionAuditPayload(");
    expect(src).toContain("writeAudit(");
    expect(src).toContain('reason: "manual"');
    expect(src).toContain('reason: "provider_sync"');
  });
  it("records provider failures as a safe category, never a raw message", () => {
    expect(src).toContain("recordSync(");
    // provider_error is only ever set from the ProviderError union / null.
    expect(src).not.toMatch(/provider_error:\s*(err\.message|String\(|e\.message)/);
  });
});

// -------------------------------------------------------- console reads (structural) ----

describe("console reads are scoped, paginated, and never call a provider", () => {
  const src = code("../lib/customs/intelligence/service.ts");
  it("is server-only and uses the admin client under a permission gate", () => {
    expect(src).toContain('import "server-only"');
    expect(src).toContain('assertPermission("customs:read")');
    expect(src).toContain("resolveFileScope");
  });
  it("tenant-scopes every customs_record read", () => {
    // No admin customs_record read without a tenant_id filter (leak guard also enforces this).
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain('.eq("tenant_id", user.tenantId)');
  });
  it("paginates in SQL and bounds the dashboard working set", () => {
    expect(src).toContain(".range(from, from + size)");
    expect(src).toContain("DASHBOARD_WORKING_SET_CAP");
    expect(src).toContain("capped");
  });
  it("makes NO provider network call on a read path", () => {
    expect(src).not.toContain("CustomsEngine");
    expect(src).not.toContain(".poll(");
    expect(src).not.toContain(".submit(");
  });
  it("reuses the pure 7.1A dashboard contracts", () => {
    expect(src).toContain("buildCustomsDashboard(");
    expect(src).toContain("projectTimeline(");
  });
});

// -------------------------------------------------------------- console UI (structural) ----

describe("the console UI is gated and the client re-validates on the server", () => {
  it("the list page gates on customs:read and paginates without loading all rows", () => {
    const page = read("../app/customs/intelligence/page.tsx");
    expect(page).toContain('hasPermission(permissions, "customs:read")');
    expect(page).toContain("listDeclarations(");
    expect(page).toContain("hasMore");
    expect(page).not.toContain("returns<"); // reads go through the service, not inline in the page
  });
  it("the detail page 404s when the declaration is not visible", () => {
    const page = read("../app/customs/intelligence/[declarationId]/page.tsx");
    expect(page).toContain("getDeclarationDetail(");
    expect(page).toContain("notFound()");
    expect(page).toContain('hasPermission(permissions, "customs:read")');
  });
  it("action buttons render only server-approved transitions and pass the version (CAS)", () => {
    const actions = read("../components/customs/intelligence/declaration-actions.tsx");
    expect(actions).toContain('"use client"');
    expect(actions).toContain("transitionDeclaration(id, s, version)");
    expect(actions).toContain("refreshDeclaration(id)");
    // The client filters by the SAME rule the server enforces (RELEASED needs canRelease).
    expect(actions).toContain('s === "RELEASED" ? canRelease : canUpdate');
  });
  it("the client console never imports the server-only config resolver", () => {
    const actions = read("../components/customs/intelligence/declaration-actions.tsx");
    expect(actions).not.toContain("intelligence/config");
  });
});

// ----------------------------------------------------------- GAINDE boundary honesty ----

describe("GAINDE remains a boundary — no live integration is claimed", () => {
  it("the config module invents no GAINDE endpoint/credential env vars", () => {
    const src = read("../lib/customs/intelligence/config.ts");
    expect(src).not.toMatch(/GAINDE_(API|URL|KEY|SECRET|TOKEN|BASE|CLIENT)/);
  });
  it("the migration is additive on customs_record and adds no new table/permission/grant", () => {
    const mig = read("../supabase/migrations/20260716000003_customs_intelligence_state.sql");
    expect(mig).toContain("alter table public.customs_record");
    expect(mig).not.toMatch(/create table/i);
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).not.toMatch(/create policy/i);
    expect(mig).not.toMatch(/^\s*grant /im);
  });
  it("the RLS test proves intel columns are isolated and cross-tenant writes are rejected", () => {
    const t = read("../supabase/tests/rls_customs_test.sql");
    expect(t).toContain("mgr_intelB_hidden");
    expect(t).toContain("xtenant_write_blocked");
    expect(t).toContain("sametenant_write_blocked");
  });
});
