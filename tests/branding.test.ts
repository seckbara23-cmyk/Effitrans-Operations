/**
 * Phase 4.0B-3 — tenant branding: validation + resolution (fallback, safety).
 */
import { describe, it, expect } from "vitest";
import { isValidHexColor, isSafeUrl, containsHtml, safeText } from "@/lib/branding/validate";
import { mergeBranding } from "@/lib/branding/resolve";
import { PLATFORM_BRANDING } from "@/lib/branding/platform";

describe("branding validation", () => {
  it("accepts only #rgb / #rrggbb colors", () => {
    expect(isValidHexColor("#0B1F33")).toBe(true);
    expect(isValidHexColor("#abc")).toBe(true);
    expect(isValidHexColor("navy")).toBe(false);
    expect(isValidHexColor("#12")).toBe(false);
    expect(isValidHexColor("rgb(0,0,0)")).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
  });

  it("accepts only http(s) URLs", () => {
    expect(isSafeUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isSafeUrl("http://x.io/a.png")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeUrl("/relative")).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
  });

  it("rejects HTML in plain-text fields, keeps ampersands", () => {
    expect(containsHtml("<b>x</b>")).toBe(true);
    expect(safeText("<script>x</script>")).toBeUndefined();
    expect(safeText("  Effitrans Operations  ")).toBe("Effitrans Operations");
    expect(safeText("Transit & Logistique")).toBe("Transit & Logistique");
    expect(safeText("")).toBeUndefined();
  });
});

describe("mergeBranding — fallbacks and injection safety", () => {
  it("uses valid tenant values when present", () => {
    const b = mergeBranding(
      { name: "Org Legal", tradeName: "Trade", legalName: "Legal Co" },
      { display_name: "Brand Co", primary_color: "#123456", logo_url: "https://x.io/l.png", email_footer: "Footer" },
    );
    expect(b.displayName).toBe("Brand Co");
    expect(b.legalName).toBe("Legal Co");
    expect(b.primaryColor).toBe("#123456");
    expect(b.logoUrl).toBe("https://x.io/l.png");
    expect(b.emailFooter).toBe("Footer");
    expect(b.pdfHeaderText).toBe("BRAND CO");
  });

  it("falls back trade_name → name → platform when branding missing", () => {
    expect(mergeBranding({ name: "Only Name" }).displayName).toBe("Only Name");
    expect(mergeBranding({ name: "N", tradeName: "TradeX" }).displayName).toBe("TradeX");
    expect(mergeBranding({ name: "" }).displayName).toBe(PLATFORM_BRANDING.displayName);
  });

  it("drops unsafe values and falls back (no injection, no arbitrary color/url)", () => {
    const b = mergeBranding(
      { name: "Org" },
      { display_name: "<script>x</script>", primary_color: "red", logo_url: "javascript:alert(1)", email_footer: "<b>hi</b>" },
    );
    expect(b.displayName).toBe("Org");
    expect(b.primaryColor).toBe(PLATFORM_BRANDING.primaryColor);
    expect(b.logoUrl).toBeUndefined();
    expect(b.emailFooter).toBe("Org");
  });

  it("resolves the Effitrans backfill to its current identity (keeps outputs stable)", () => {
    const b = mergeBranding(
      { name: "Effitrans", tradeName: "Effitrans", legalName: "Effitrans" },
      {
        display_name: "Effitrans Operations",
        email_footer: "Effitrans Operations · Dakar, Sénégal",
        pdf_header_text: "EFFITRANS OPERATIONS",
        primary_color: "#0B1F33",
        secondary_color: "#0F766E",
      },
    );
    expect(b.displayName).toBe("Effitrans Operations");
    expect(b.emailFooter).toBe("Effitrans Operations · Dakar, Sénégal");
    expect(b.pdfHeaderText).toBe("EFFITRANS OPERATIONS");
  });

  it("merges only the single tenant's input — no cross-tenant leak", () => {
    const a = mergeBranding({ name: "Tenant A" }, { display_name: "A Corp" });
    const c = mergeBranding({ name: "Tenant B" }, { display_name: "B Corp" });
    expect(a.displayName).toBe("A Corp");
    expect(c.displayName).toBe("B Corp");
  });

  it("resolves a safe tagline (HTML rejected, absent → undefined)", () => {
    expect(mergeBranding({ name: "X" }, { display_name: "X", tagline: "Fret & Douane" }).tagline).toBe("Fret & Douane");
    expect(mergeBranding({ name: "X" }).tagline).toBeUndefined();
    expect(mergeBranding({ name: "X" }, { tagline: "<b>x</b>" }).tagline).toBeUndefined();
  });
});
