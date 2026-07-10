import { describe, it, expect } from "vitest";
import { generateTempPassword, hasRequiredComplexity } from "@/lib/portal/temp-password";
import { buildPortalCredentialsEmail, passwordEmailAllowed } from "@/lib/portal/credentials-email";
import { canResetPortalPassword, canAccessPortal } from "@/lib/portal/access";
import { AuditActions } from "@/lib/audit/events";
import { validateAuditEvent } from "@/lib/audit/validate";

describe("temporary password generation (Phase 3.2B)", () => {
  it("always satisfies the strength contract (≥12, upper/lower/digit/special)", () => {
    for (let i = 0; i < 300; i++) {
      const pw = generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(12);
      expect(hasRequiredComplexity(pw)).toBe(true);
    }
  });

  it("honours a requested length but never below the 12-char minimum", () => {
    expect(generateTempPassword(20).length).toBe(20);
    expect(generateTempPassword(4).length).toBe(12);
  });

  it("excludes ambiguous glyphs (0 O 1 l I) for safe out-of-band sharing", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it("is not deterministic (cryptographically random)", () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(set.size).toBe(200);
  });

  it("hasRequiredComplexity rejects weak passwords", () => {
    expect(hasRequiredComplexity("short1!A")).toBe(false); // too short
    expect(hasRequiredComplexity("alllowercase1!")).toBe(false); // no uppercase
    expect(hasRequiredComplexity("ALLUPPERCASE1!")).toBe(false); // no lowercase
    expect(hasRequiredComplexity("NoDigitsHere!!")).toBe(false); // no digit
    expect(hasRequiredComplexity("NoSpecial1234A")).toBe(false); // no special
    expect(hasRequiredComplexity("Abcdef12!@#xyz")).toBe(true);
  });
});

describe("credentials email never leaks the password by default (Deliverable 6/11)", () => {
  const pw = generateTempPassword();
  const base = { loginUrl: "https://app.effitrans/portal/login", email: "client@example.com", clientName: "ACME" };

  it("omits the password when includePassword is false — even if one is passed", () => {
    const mail = buildPortalCredentialsEmail({ ...base, includePassword: false, tempPassword: pw });
    const blob = `${mail.subject}\n${mail.html}\n${mail.text}`;
    expect(blob).not.toContain(pw);
    expect(mail.text).toContain("communiqué séparément");
    expect(mail.text).toContain(base.email); // login identifier is fine
    expect(mail.text).toContain(base.loginUrl);
  });

  it("includes the password ONLY when explicitly allowed", () => {
    const mail = buildPortalCredentialsEmail({ ...base, includePassword: true, tempPassword: pw });
    expect(mail.text).toContain(pw);
  });

  it("passwordEmailAllowed requires BOTH the flag and the admin opt-in", () => {
    expect(passwordEmailAllowed("true", true)).toBe(true);
    expect(passwordEmailAllowed("true", false)).toBe(false);
    expect(passwordEmailAllowed("false", true)).toBe(false);
    expect(passwordEmailAllowed(undefined, true)).toBe(false);
  });
});

describe("portal access predicates (Phase 3.2B)", () => {
  it("a DISABLED user cannot be issued a temporary password (reactivate first)", () => {
    expect(canResetPortalPassword("ACTIVE")).toBe(true);
    expect(canResetPortalPassword("INVITED")).toBe(true);
    expect(canResetPortalPassword("DISABLED")).toBe(false);
  });

  it("only ACTIVE users may access the portal", () => {
    expect(canAccessPortal("ACTIVE")).toBe(true);
    expect(canAccessPortal("INVITED")).toBe(false);
    expect(canAccessPortal("DISABLED")).toBe(false);
  });
});

describe("temporary-password audit events (Phase 3.2B)", () => {
  it("exposes the three attributed portal action codes", () => {
    expect(AuditActions.PORTAL_USER_CREATED_WITH_TEMP_PASSWORD).toBe("portal.user.created_with_temp_password");
    expect(AuditActions.PORTAL_USER_TEMP_PASSWORD_RESET).toBe("portal.user.temp_password_reset");
    expect(AuditActions.PORTAL_USER_PASSWORD_CHANGED).toBe("portal.user.password_changed");
  });

  it("requires an actor (staff actorId or portal clientUserId) — never anonymous", () => {
    // staff-created / reset → actorId; self password change → clientUserId
    expect(() => validateAuditEvent({ action: AuditActions.PORTAL_USER_CREATED_WITH_TEMP_PASSWORD })).toThrow();
    expect(() => validateAuditEvent({ action: AuditActions.PORTAL_USER_CREATED_WITH_TEMP_PASSWORD, actorId: "staff-1" })).not.toThrow();
    expect(() => validateAuditEvent({ action: AuditActions.PORTAL_USER_PASSWORD_CHANGED, clientUserId: "cu-1" })).not.toThrow();
  });
});
