/**
 * Phase 6.0B — the provisioning wizard.
 *
 * This repo runs vitest in node with no jsdom, so the wizard's LOGIC is extracted to
 * a pure module and tested directly, and the React shell's security-critical shape is
 * asserted structurally against its source — the same split the rest of the codebase
 * uses. Between the two, every item on the brief's test list is covered without a
 * snapshot in sight.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  WIZARD_STEPS,
  STEP_COUNT,
  stepIndex,
  emptyDraft,
  draftReducer,
  draftToInput,
  validateStep,
  draftReadyToProvision,
  rolesForDraft,
  modulesForDraft,
  returnStepForError,
  ERROR_MESSAGES,
  BUSINESS_PROFILE_LABELS,
  type WizardDraft,
} from "@/lib/platform/provisioning/wizard";
import { validateProvisionInput } from "@/lib/platform/provisioning/validate";
import { selectTenantRoleTemplates } from "@/lib/platform/role-templates";
import { defaultModulesForPlan } from "@/lib/platform/entitlements";
import { PROVISION_ERRORS } from "@/lib/platform/provisioning/errors";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const component = read("../components/platform/provisioning-wizard.tsx");
const page = read("../app/platform/companies/new/page.tsx");
const listPage = read("../app/platform/companies/page.tsx");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const componentCode = codeOnly(component);

/** A complete, valid draft. */
function filledDraft(over: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...emptyDraft(),
    legalName: "Northwind Logistics SA",
    tradeName: "Northwind",
    slug: "northwind",
    adminFullName: "Awa Ba",
    adminEmail: "awa@northwind.sn",
    ...over,
  };
}

// --------------------------------------------------------- seven steps ----

describe("the wizard is exactly seven steps, in order", () => {
  it("has 7 steps ending in review", () => {
    expect(STEP_COUNT).toBe(7);
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      "identity",
      "profile",
      "branding",
      "modules",
      "roles",
      "administrator",
      "review",
    ]);
  });

  it("resolves step indices", () => {
    expect(stepIndex("identity")).toBe(0);
    expect(stepIndex("review")).toBe(6);
  });
});

// --------------------------------------------------------- the reducer ----

describe("the draft reducer preserves everything it is not changing", () => {
  it("sets one field and leaves the rest", () => {
    const d0 = filledDraft();
    const d1 = draftReducer(d0, { type: "set", field: "legalName", value: "Acme" });
    expect(d1.legalName).toBe("Acme");
    expect(d1.slug).toBe(d0.slug);
    expect(d1.adminEmail).toBe(d0.adminEmail);
  });

  it("toggles a business profile without disturbing others", () => {
    const d0 = emptyDraft();
    const d1 = draftReducer(d0, { type: "toggleProfile", key: "customsBroker" });
    expect(d1.businessProfile.customsBroker).toBe(true);
    expect(d1.businessProfile.freightForwarder).toBe(false);
    const d2 = draftReducer(d1, { type: "toggleProfile", key: "customsBroker" });
    expect(d2.businessProfile.customsBroker).toBe(false);
  });

  it("changes the plan", () => {
    expect(draftReducer(emptyDraft(), { type: "setPlan", plan: "ENTERPRISE" }).plan).toBe("ENTERPRISE");
  });

  it("reset returns a pristine draft", () => {
    const dirty = filledDraft();
    expect(draftReducer(dirty, { type: "reset" })).toEqual(emptyDraft());
  });

  it("defaults to the Senegalese market and no profiles selected", () => {
    const d = emptyDraft();
    expect(d.country).toBe("SN");
    expect(d.currency).toBe("XOF");
    expect(Object.values(d.businessProfile).every((v) => v === false)).toBe(true);
  });
});

// --------------------------------------------------------- validation ----

describe("per-step validation gates Next (UX only)", () => {
  it("requires legal name and a valid slug at identity", () => {
    expect(validateStep(emptyDraft(), "identity").length).toBeGreaterThan(0);
    expect(validateStep(filledDraft(), "identity")).toEqual([]);
  });

  it("rejects reserved and malformed slugs", () => {
    expect(validateStep(filledDraft({ slug: "platform" }), "identity").length).toBeGreaterThan(0);
    expect(validateStep(filledDraft({ slug: "AB" }), "identity").length).toBeGreaterThan(0);
  });

  it("accepts a maximum-length slug (40 chars)", () => {
    const slug = "a" + "b".repeat(38) + "c"; // 40 chars, no leading/trailing hyphen
    expect(slug.length).toBe(40);
    expect(validateStep(filledDraft({ slug }), "identity")).toEqual([]);
  });

  it("requires a valid administrator email", () => {
    expect(validateStep(filledDraft({ adminEmail: "nope" }), "administrator").length).toBeGreaterThan(0);
    expect(validateStep(filledDraft(), "administrator")).toEqual([]);
  });

  it("imposes no hard requirement on profile / branding / modules / roles", () => {
    for (const step of ["profile", "branding", "modules", "roles"] as const) {
      expect(validateStep(emptyDraft(), step)).toEqual([]);
    }
  });
});

// --------------------------------------------- draft -> engine input ----

describe("draftToInput builds exactly the 6.0A contract", () => {
  it("maps every field and is accepted by the engine's own validator", () => {
    const input = draftToInput(filledDraft(), "key-123");
    expect(input.company.legalName).toBe("Northwind Logistics SA");
    expect(input.company.slug).toBe("northwind");
    expect(input.administrator.email).toBe("awa@northwind.sn");
    expect(input.plan).toBe("PROFESSIONAL");
    expect(input.idempotencyKey).toBe("key-123");
    expect(validateProvisionInput(input).ok).toBe(true);
  });

  it("lower-cases the slug and admin email, upper-cases the currency", () => {
    const input = draftToInput(filledDraft({ slug: "NorthWind", adminEmail: "Awa@Northwind.SN", currency: "xof" }), "k");
    expect(input.company.slug).toBe("northwind");
    expect(input.administrator.email).toBe("awa@northwind.sn");
    expect(input.company.currency).toBe("XOF");
  });

  it("omits blank optionals rather than sending empty strings", () => {
    const input = draftToInput(filledDraft({ tradeName: "", companyEmail: "", ninea: "" }), "k");
    expect(input.company.tradeName).toBeUndefined();
    expect(input.company.email).toBeUndefined();
    expect(input.company.ninea).toBeUndefined();
  });

  it("never carries a platform actor id — the engine resolves that server-side", () => {
    const input = draftToInput(filledDraft(), "k") as Record<string, unknown>;
    expect(input.actorId).toBeUndefined();
    expect(input.platformActorId).toBeUndefined();
    expect(JSON.stringify(input)).not.toMatch(/actor/i);
  });

  it("leaves modules empty so the engine applies plan defaults, and never toggles rollout", () => {
    const input = draftToInput(filledDraft(), "k");
    expect(input.modules).toEqual({});
    // No rollout field exists on the input at all — a fresh tenant is dark by construction.
    expect(JSON.stringify(input)).not.toMatch(/rollout|process_engine/i);
  });

  it("carries Unicode and French accents intact", () => {
    const input = draftToInput(filledDraft({ legalName: "Société Générale de Transit — Dakar", adminFullName: "Ámàdou Ndèye" }), "k");
    expect(input.company.legalName).toContain("Société Générale");
    expect(input.administrator.fullName).toBe("Ámàdou Ndèye");
  });

  it("gates final submission on the shared 4.0B validator", () => {
    expect(draftReadyToProvision(filledDraft(), "k")).toBe(true);
    expect(draftReadyToProvision(emptyDraft(), "k")).toBe(false);
  });
});

// --------------------------------------------- roles from the registry ----

describe("roles are sourced from the registry, never redefined", () => {
  it("mirrors selectTenantRoleTemplates exactly for the current profile", () => {
    const draft = filledDraft({
      businessProfile: { ...emptyDraft().businessProfile, customsBroker: true },
    });
    const shown = rolesForDraft(draft).map((r) => r.key);
    const expected = selectTenantRoleTemplates(draft.businessProfile).map((t) => t.key);
    expect(shown).toEqual(expected);
  });

  it("always includes SYSTEM_ADMIN, even with no profile selected", () => {
    expect(rolesForDraft(emptyDraft()).some((r) => r.key === "SYSTEM_ADMIN")).toBe(true);
  });

  it("shows the plan's default modules from the entitlement engine", () => {
    const d = filledDraft({ plan: "STARTER" });
    expect(modulesForDraft(d)).toEqual([...defaultModulesForPlan("STARTER")]);
  });

  it("labels every business profile in French — no registry key on screen", () => {
    for (const label of Object.values(BUSINESS_PROFILE_LABELS)) {
      expect(label).not.toMatch(/^[a-z][a-zA-Z]+$/); // not a camelCase key
    }
  });
});

// --------------------------------------------- outcome mapping ----

describe("outcome → view mapping", () => {
  it("has a friendly message for every engine error, exposing no internals", () => {
    for (const code of PROVISION_ERRORS) {
      const msg = ERROR_MESSAGES[code];
      expect(msg, code).toBeTruthy();
      expect(msg).not.toMatch(/sql|rpc|service_role|stack|null|undefined|provision_tenant/i);
    }
  });

  it("sends duplicate_slug back to identity and admin conflict to the admin step", () => {
    expect(returnStepForError("duplicate_slug")).toBe("identity");
    expect(returnStepForError("admin_email_conflict")).toBe("administrator");
    expect(returnStepForError("relational_provisioning_failed")).toBe("review");
  });
});

// --------------------------------------------- the React shell (structural) ----

describe("the shell provisions exactly once and cannot double-fire", () => {
  it("calls provisionTenant in exactly one place", () => {
    const calls = componentCode.match(/provisionTenant\(/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it("guards submission three ways: a ref latch, a pending transition, a terminal state", () => {
    expect(componentCode).toContain("inFlight.current");
    expect(componentCode).toContain("if (inFlight.current || outcome?.ok) return;");
    expect(componentCode).toContain("useTransition");
    // The provision button is disabled while pending.
    expect(componentCode).toMatch(/disabled=\{pending/);
  });

  it("mints ONE idempotency key per run and regenerates it only on reset", () => {
    expect(componentCode).toContain("keyRef = useRef");
    expect(componentCode).toContain("crypto.randomUUID()");
    // Two randomUUID calls: initial mint + the reset. Never inside doProvision.
    const provisionBody = componentCode.slice(
      componentCode.indexOf("function doProvision"),
      componentCode.indexOf("function resetWizard"),
    );
    expect(provisionBody).not.toContain("randomUUID");
    expect(provisionBody).toContain("keyRef.current"); // reuse, not regenerate
  });

  it("requires an explicit confirmation dialog before provisioning — never alert()", () => {
    expect(componentCode).toContain("ConfirmDialog");
    expect(componentCode).toContain('role="dialog"');
    expect(componentCode).not.toContain("window.alert");
    expect(componentCode).not.toMatch(/\balert\(/);
  });
});

describe("the setup link never leaks or persists", () => {
  it("is never written to storage, the URL, or any persistent sink", () => {
    for (const sink of [
      "localStorage",
      "sessionStorage",
      "history.pushState",
      "history.replaceState",
      "location.hash",
      "location.search",
      "document.cookie",
    ]) {
      expect(componentCode, sink).not.toContain(sink);
    }
  });

  it("logs only the allowed operational events — never the link or a secret", () => {
    const logs = [...componentCode.matchAll(/console\.\w+\(([^;]*)\)/g)].map((m) => m[1]);
    for (const log of logs) {
      expect(log).not.toMatch(/setupLink|invitation|link|token|password|recovery/i);
    }
    // The allowed events are present.
    expect(componentCode).toContain('"[provisioning] started"');
    expect(componentCode).toContain('"[provisioning] completed"');
    expect(componentCode).toContain('"[provisioning] failed"');
  });

  it("keeps the link in React state only, cleared on reset", () => {
    // outcome (which may hold the link) is a useState, wiped by setOutcome(null) on reset.
    expect(componentCode).toContain("setOutcome(null)");
    // The copy button uses the in-memory value, never a stored one.
    expect(componentCode).toContain("navigator.clipboard?.writeText(invitation.setupLink)");
  });

  it("labels link_returned honestly — never as email_sent", () => {
    expect(componentCode).toContain('invitation.kind === "email_sent"');
    expect(componentCode).toContain("usage unique"); // the one-time-link panel
    expect(componentCode).toContain("n'a <strong>pas</strong> été envoyé");
  });
});

// --------------------------------------------- authorization ----

describe("only a platform admin can reach the wizard", () => {
  it("the route asserts platform:companies:create server-side, before rendering", () => {
    expect(page).toContain('assertPlatformPermission("platform:companies:create")');
    // The assertion precedes the wizard render.
    const assertAt = page.indexOf("assertPlatformPermission");
    const renderAt = page.indexOf("<ProvisioningWizard");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(renderAt);
  });

  it("no service-role credential is present in the client component", () => {
    for (const secret of ["SERVICE_ROLE", "SUPABASE_SERVICE", "service_role", "getAdminSupabaseClient"]) {
      expect(componentCode, secret).not.toContain(secret);
    }
  });

  it("the client never calls the SQL RPC directly — only the server action", () => {
    expect(componentCode).not.toContain(".rpc(");
    expect(componentCode).not.toContain("provision_tenant");
    expect(componentCode).toContain("provisionTenant"); // the action, not the SQL
  });
});

// --------------------------------------------- the list page still works ----

describe("the companies list still renders and gains one entry point", () => {
  it("adds a single 'Nouvelle entreprise' link to /platform/companies/new", () => {
    expect(listPage).toContain("Nouvelle entreprise");
    expect(listPage).toContain('href="/platform/companies/new"');
    // The existing table is untouched.
    expect(listPage).toContain("listCompanies");
    expect(listPage).toContain("Dossiers actifs");
  });
});
