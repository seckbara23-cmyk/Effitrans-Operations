import { describe, it, expect } from "vitest";
import { validateCreateUser } from "@/lib/users/validate";

describe("validateCreateUser", () => {
  it("accepts a valid email + 8+ char password", () => {
    expect(validateCreateUser({ email: "a@effitrans.sn", password: "secret12" })).toBeNull();
  });

  it("rejects an invalid email", () => {
    expect(validateCreateUser({ email: "not-an-email", password: "secret12" })).toBe("invalid_email");
    expect(validateCreateUser({ email: "", password: "secret12" })).toBe("invalid_email");
    expect(validateCreateUser({ email: "  ", password: "secret12" })).toBe("invalid_email");
  });

  it("rejects a weak password (< 8 chars)", () => {
    expect(validateCreateUser({ email: "a@b.co", password: "short" })).toBe("weak_password");
    expect(validateCreateUser({ email: "a@b.co", password: "" })).toBe("weak_password");
  });
});
