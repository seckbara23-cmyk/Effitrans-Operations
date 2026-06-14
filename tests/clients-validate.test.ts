import { describe, it, expect } from "vitest";
import { validateClient, normalizeNinea } from "@/lib/clients/validate";

describe("validateClient", () => {
  it("requires a name", () => {
    expect(validateClient({ name: "" })).toBe("name_required");
    expect(validateClient({ name: "   " })).toBe("name_required");
    expect(validateClient({ name: "Kosmos Energy" })).toBeNull();
  });

  it("validates NINEA format (7–13 digits, spaces ignored)", () => {
    expect(validateClient({ name: "X", ninea: "1234567" })).toBeNull();
    expect(validateClient({ name: "X", ninea: "123 456 7890" })).toBeNull();
    expect(validateClient({ name: "X", ninea: "12345" })).toBe("invalid_ninea");
    expect(validateClient({ name: "X", ninea: "ABC1234" })).toBe("invalid_ninea");
    expect(validateClient({ name: "X", ninea: "" })).toBeNull(); // optional
  });

  it("validates email + phone when present", () => {
    expect(validateClient({ name: "X", email: "a@b.co" })).toBeNull();
    expect(validateClient({ name: "X", email: "nope" })).toBe("invalid_email");
    expect(validateClient({ name: "X", phone: "+221 77 123 45 67" })).toBeNull();
    expect(validateClient({ name: "X", phone: "abc" })).toBe("invalid_phone");
  });

  it("validates contacts", () => {
    expect(validateClient({ name: "X", contacts: [{ name: "" }] })).toBe("contact_name_required");
    expect(validateClient({ name: "X", contacts: [{ name: "Awa", email: "bad" }] })).toBe("invalid_email");
    expect(validateClient({ name: "X", contacts: [{ name: "Awa", email: "awa@x.sn" }] })).toBeNull();
  });

  it("normalizeNinea strips whitespace and empties to null", () => {
    expect(normalizeNinea("123 456")).toBe("123456");
    expect(normalizeNinea("   ")).toBeNull();
    expect(normalizeNinea(null)).toBeNull();
  });
});
