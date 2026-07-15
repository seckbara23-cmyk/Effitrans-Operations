/**
 * Phase 5.0E-4 — user-creation reliability, temporary credentials, email audit.
 *
 * The pure logic (welcome classification, password generation, error/outcome
 * vocabularies) is tested directly; the server action's repair (reconcile, compensate,
 * closed error codes, secret discipline) and the client's one-time-secret handling are
 * asserted structurally — the codebase's split, no jsdom, no live GoTrue in node.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { classifyWelcome, isDelivered, returnsLink } from "@/lib/users/welcome-outcome";
import { generateTempPassword, hasRequiredComplexity } from "@/lib/portal/temp-password";
import { t } from "@/lib/i18n";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const actions = read("../lib/users/actions.ts");
const actionsCode = code("../lib/users/actions.ts");
// Phase 6.0E-3 — the welcome/recovery send was extracted (unchanged) into a shared module
// reused by the platform invitation action; the honesty assertions follow it there.
const welcomeSend = read("../lib/users/welcome-send.ts");
const welcomeSendCode = code("../lib/users/welcome-send.ts");
const component = read("../components/users/users-admin.tsx");
const componentCode = code("../components/users/users-admin.tsx");

const WELCOME_OUTCOMES = [
  "email_sent",
  "link_returned",
  "provider_unavailable",
  "link_generation_failed",
  "delivery_failed",
  "skipped",
] as const;
const ERROR_CODES = [
  "forbidden",
  "invalid_email",
  "weak_password",
  "invalid_role",
  "email_conflict",
  "auth_failed",
  "profile_failed",
  "not_found",
  "cannot_disable_self",
  "cannot_revoke_own_admin",
  "welcome_failed",
  "generic",
] as const;

// -------------------------------------------------- welcome classification ----

describe("welcome outcome is honest — never claims a send that did not happen", () => {
  it("no provider + a link → link_returned (never email_sent)", () => {
    expect(classifyWelcome({ providerConfigured: false, linkGenerated: true, deliveryAccepted: false })).toBe("link_returned");
  });
  it("no provider + no link → provider_unavailable", () => {
    expect(classifyWelcome({ providerConfigured: false, linkGenerated: false, deliveryAccepted: false })).toBe("provider_unavailable");
  });
  it("provider + no link → link_generation_failed", () => {
    expect(classifyWelcome({ providerConfigured: true, linkGenerated: false, deliveryAccepted: false })).toBe("link_generation_failed");
  });
  it("provider + link + delivered → email_sent", () => {
    expect(classifyWelcome({ providerConfigured: true, linkGenerated: true, deliveryAccepted: true })).toBe("email_sent");
  });
  it("provider + link + NOT delivered → delivery_failed", () => {
    expect(classifyWelcome({ providerConfigured: true, linkGenerated: true, deliveryAccepted: false })).toBe("delivery_failed");
  });
  it("ONLY email_sent counts as delivered; ONLY link_returned hands back a link", () => {
    expect(isDelivered("email_sent")).toBe(true);
    for (const o of WELCOME_OUTCOMES) if (o !== "email_sent") expect(isDelivered(o)).toBe(false);
    expect(returnsLink("link_returned")).toBe(true);
    for (const o of WELCOME_OUTCOMES) if (o !== "link_returned") expect(returnsLink(o)).toBe(false);
  });
});

// -------------------------------------------------- password generator ----

describe("generated temporary password is cryptographically strong (reused generator)", () => {
  it("meets the complexity contract and is not Math.random", () => {
    for (let i = 0; i < 50; i++) expect(hasRequiredComplexity(generateTempPassword())).toBe(true);
    // The generator this flow uses is CSPRNG-based; it must not be Math.random.
    const src = read("../lib/portal/temp-password.ts");
    expect(src).toContain("crypto.getRandomValues");
    expect(src).not.toContain("Math.random");
  });
  it("the action uses that generator, not an ad-hoc one", () => {
    expect(actions).toContain('import { generateTempPassword } from "@/lib/portal/temp-password"');
    expect(actionsCode).not.toContain("Math.random");
  });
});

// -------------------------------------------------- reconcile + compensate ----

describe("createUser reconciles and compensates — the root-cause fix", () => {
  it("reuses an orphan auth user instead of failing forever on 'already registered'", () => {
    expect(actionsCode).toContain("findAuthUserByEmail");
    // An existing auth user with NO app_user is reused (createdHere = false).
    expect(actionsCode).toContain("createdHere = false");
    // ...but an existing auth user WITH an app_user is a real duplicate.
    expect(actionsCode).toContain('return { ok: false, error: "email_conflict" }');
  });

  it("compensates a partial failure by deleting ONLY a user this call created", () => {
    expect(actionsCode).toContain("if (createdHere) {");
    expect(actionsCode).toContain("deleteUser(authId)");
    // The guard sits inside the profile-insert failure branch.
    const insBlock = actionsCode.slice(actionsCode.indexOf("if (insErr)"), actionsCode.indexOf('return { ok: false, error: "profile_failed" }'));
    expect(insBlock).toContain("if (createdHere)");
    expect(insBlock).toContain("deleteUser");
  });

  it("returns ONLY closed, safe error codes — never a raw provider string", () => {
    // No path returns error.message / a Supabase/GoTrue string.
    expect(actionsCode).not.toMatch(/error:\s*error\.message/);
    expect(actionsCode).not.toMatch(/error:\s*insErr\.message/);
    expect(actionsCode).not.toContain('?? "create_failed"');
  });

  it("REJECTS an invalid role rather than silently dropping it", () => {
    expect(actionsCode).toContain("requestedRoles.some((id) => !validRoleIds.has(id))");
    expect(actionsCode).toContain('return { ok: false, error: "invalid_role" }');
  });
});

// -------------------------------------------------- credential modes ----

describe("credential modes", () => {
  it("supports setup_email (no password), generate (CSPRNG), manual (validated)", () => {
    expect(actionsCode).toContain('mode === "generate" ? generateTempPassword()');
    expect(actionsCode).toContain('mode === "manual"');
    // setup_email creates the auth user WITHOUT a password (they set it via the link).
    expect(actionsCode).toContain("...(password ? { password } : {})");
  });

  it("defaults to setup_email — no always-required password field", () => {
    expect(actionsCode).toContain('form.credentialMode ?? "setup_email"');
    // The client shows the password input ONLY in manual mode.
    expect(componentCode).toContain('credentialMode === "manual" ?');
  });
});

// -------------------------------------------------- the secret discipline ----

describe("the temporary password never leaks", () => {
  it("is returned ONCE in the result, and nowhere else in the action", () => {
    expect(actionsCode).toContain("...(generated ? { temporaryPassword: generated } : {})");
  });

  it("is NEVER in an audit payload", () => {
    // The audit records that a temp password was ISSUED (the action name), never its value.
    expect(actions).toContain("USER_CREATED_WITH_TEMP_PASSWORD");
    // Inspect the after: PAYLOADS (not the action NAME, which legitimately says
    // "temp_password" to mean a temp password was ISSUED). No payload carries the value.
    const payloads = [...actionsCode.matchAll(/after:\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(payloads.length).toBeGreaterThan(0);
    for (const pl of payloads) {
      expect(pl).not.toMatch(/temporaryPassword|generated|:\s*password/i);
    }
  });

  it("is NEVER logged", () => {
    const logs = [...actionsCode.matchAll(/reportError\([^;]*\)/g)].map((m) => m[0]);
    for (const log of logs) expect(log).not.toMatch(/password|generated|temporaryPassword/i);
    expect(actionsCode).not.toMatch(/console\.\w+\([^)]*password/i);
  });

  it("is NEVER persisted to an application table (only handed to GoTrue)", () => {
    // No app_user / any insert/update carries the password. GoTrue's createUser/
    // updateUserById is the only consumer.
    expect(actionsCode).not.toMatch(/\.insert\([^)]*password/i);
    expect(actionsCode).not.toMatch(/\.update\([^)]*password/i);
  });

  it("the client keeps it in React state only — never storage, URL, or a cookie", () => {
    for (const sink of ["localStorage", "sessionStorage", "document.cookie", "location.hash", "location.search", "history.pushState"]) {
      expect(componentCode, sink).not.toContain(sink);
    }
    // It lives in the `credential` state and is dropped on dismiss.
    expect(componentCode).toContain("setCredential(null)");
    expect(componentCode).toContain("CredentialPanel");
  });

  it("the create request never sends the password as a query param or in the URL", () => {
    // createUser is a server action invoked with an object; no URL construction here.
    expect(componentCode).not.toMatch(/\?password=|&password=/);
  });
});

// -------------------------------------------------- email honesty + audit ----

describe("welcome email is honest and audited", () => {
  it("marks the user as emailed ONLY on a true, provider-backed delivery", () => {
    expect(welcomeSendCode).toContain("if (isDelivered(outcome)) {");
    const deliverBlock = welcomeSendCode.slice(welcomeSendCode.indexOf("if (isDelivered(outcome))"), welcomeSendCode.indexOf("return { outcome };"));
    expect(deliverBlock).toContain("onboarding_email_sent_at");
  });

  it("audits the link-returned and resend paths, without the link", () => {
    expect(welcomeSend).toContain("USER_WELCOME_LINK_RETURNED");
    // The resend request is still audited by the tenant action itself.
    expect(actions).toContain("USER_WELCOME_RESEND_REQUESTED");
    // The link-returned audit records BOOLEANS (linkGenerated: !!setupLink), never the
    // link value or action_link.
    const block = welcomeSendCode.slice(welcomeSendCode.indexOf("USER_WELCOME_LINK_RETURNED"));
    const after = block.slice(0, block.indexOf("});") + 3); // the writeAudit close
    expect(after).toContain("!!setupLink");
    expect(after).not.toContain("action_link");
    expect(after).not.toMatch(/setupLink:\s/); // never stored as a value
  });

  it("never emails a password — only a recovery link travels", () => {
    expect(welcomeSendCode).toContain('type: "recovery"');
    // No path passes a password into the email pipeline (the /auth/update-password
    // redirect URL is not a password value).
    const welcomeFn = welcomeSendCode
      .slice(welcomeSendCode.indexOf("export async function sendStaffWelcome"), welcomeSendCode.indexOf("catch (e)"))
      .replace(/auth\/update-password/g, "");
    expect(welcomeFn).not.toMatch(/password/i);
  });
});

// -------------------------------------------------- authorization ----

describe("authorization stays server-side", () => {
  it("every action re-checks its permission; nothing trusts the client", () => {
    expect(actionsCode).toContain('assertPermission("admin:users:manage")');
    // The tenant + actor come from the resolved admin, never the form.
    expect(actionsCode).toContain("admin.tenantId");
    expect(actionsCode).toContain("admin.id");
    expect(actionsCode).not.toMatch(/form\.(tenantId|actorId)/);
  });

  it("the client component holds no service-role credential or admin client", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "SERVICE_ROLE", ".rpc("]) {
      expect(componentCode, forbidden).not.toContain(forbidden);
    }
  });

  it("resend cannot double-fire — it is disabled while a transition is pending", () => {
    expect(componentCode).toContain("sendWelcomeEmail(user.id)");
    expect(component).toMatch(/disabled=\{pending\}/);
  });
});

// -------------------------------------------------- French vocabulary ----

describe("every code maps to a safe French message", () => {
  it("covers every error code", () => {
    const map = t.users.errors as Record<string, string>;
    for (const c of ERROR_CODES) expect(map[c], c).toBeTruthy();
  });
  it("covers every welcome outcome that surfaces to the user", () => {
    const map = t.users.welcome as Record<string, string>;
    for (const o of WELCOME_OUTCOMES) if (o !== "skipped") expect(map[o], o).toBeTruthy();
  });
  it("no message exposes SQL / provider / service-role internals", () => {
    const all = [...Object.values(t.users.errors as Record<string, string>), ...Object.values(t.users.welcome as Record<string, string>)];
    for (const m of all) expect(m).not.toMatch(/sql|supabase|gotrue|service_role|null|undefined/i);
  });
});
