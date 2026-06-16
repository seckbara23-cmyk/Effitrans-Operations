import { describe, it, expect } from "vitest";
import { staffWelcomeVars } from "@/lib/users/welcome";
import { renderTemplate } from "@/lib/comms/render";

describe("staff welcome onboarding email (Phase 1.19)", () => {
  const base = {
    name: "Awa Diop",
    email: "awa@effitrans.test",
    loginUrl: "https://app.effitrans.test/login",
    setupLink: "https://app.effitrans.test/auth/update-password?token=abc",
  };

  it("builds the template vars and falls back to the email local part for the name", () => {
    expect(staffWelcomeVars(base)).toMatchObject({
      name: "Awa Diop",
      email: "awa@effitrans.test",
      loginUrl: base.loginUrl,
      setupLink: base.setupLink,
    });
    expect(staffWelcomeVars({ ...base, name: null }).name).toBe("awa");
    expect(staffWelcomeVars({ ...base, name: "  " }).name).toBe("awa");
  });

  it("NEVER carries a password field (Option A: secure link, no plaintext credential)", () => {
    const vars = staffWelcomeVars(base);
    expect(vars).not.toHaveProperty("password");
    // Even if a password were somehow passed through the caller, it must not leak.
    const rendered = renderTemplate("staff_welcome", { ...vars, password: "S3cretPW!" });
    expect(rendered.html).not.toContain("S3cretPW!");
    expect(rendered.text).not.toContain("S3cretPW!");
  });

  it("renders the welcome subject + login URL, identifier and setup link", () => {
    const rendered = renderTemplate("staff_welcome", staffWelcomeVars(base));
    expect(rendered.subject).toBe("Bienvenue sur Effitrans Operations");
    for (const out of [rendered.html, rendered.text]) {
      expect(out).toContain(base.loginUrl);
      expect(out).toContain(base.email);
      expect(out).toContain(base.setupLink);
    }
    // Google Sign-In guidance is present.
    expect(rendered.text).toContain("Google");
  });
});
