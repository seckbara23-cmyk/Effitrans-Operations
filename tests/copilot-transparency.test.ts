import { describe, it, expect } from "vitest";
import { buildTransparency } from "@/lib/copilot/transparency";
import { makeSanitizedContext } from "@/lib/ai/eval/harness";

const NOW = new Date("2099-02-01T00:00:00.000Z");

describe("buildTransparency — deterministic sources / restricted / unknown / confidence", () => {
  it("cites present sections by section NAME (not DB fields) and lists no restrictions when full access", () => {
    const ctx = makeSanitizedContext(NOW);
    const tr = buildTransparency(ctx, "shipment_summary");
    expect(tr.sources).toContain("Dossier");
    expect(tr.sources).toContain("Risque");
    expect(tr.sources).toContain("Documents");
    expect(tr.sources).toContain("Douane");
    expect(tr.sources).toContain("Transport");
    expect(tr.sources).toContain("Suivi");
    expect(tr.sources).toContain("Finance");
    expect(tr.restricted).toEqual([]);
    expect(tr.confidence).toBe("high");
  });

  it("reports a permission-restricted section (finance) without leaking it", () => {
    const ctx = makeSanitizedContext(NOW, { hideFinance: true });
    const tr = buildTransparency(ctx, "shipment_summary");
    expect(tr.restricted).toContain("Finance");
    expect(tr.sources).not.toContain("Finance");
  });

  it("lowers confidence to low when the skill's primary section is restricted", () => {
    expect(buildTransparency(makeSanitizedContext(NOW, { hideCustoms: true }), "customs_status").confidence).toBe("low");
    expect(buildTransparency(makeSanitizedContext(NOW, { hideTracking: true }), "tracking_status").confidence).toBe("low");
  });

  it("keeps high confidence for the skill's primary section when present", () => {
    expect(buildTransparency(makeSanitizedContext(NOW), "customs_status").confidence).toBe("high");
    expect(buildTransparency(makeSanitizedContext(NOW), "missing_documents").confidence).toBe("high");
  });

  it("surfaces genuinely-unknown facts (unknown ≠ hidden)", () => {
    const tr = buildTransparency(makeSanitizedContext(NOW), "tracking_status");
    // Sanitized fixture: no scheduled delivery, no ETA → both are 'unknown', not 'restricted'.
    expect(tr.unknown).toContain("Livraison non planifiée");
    expect(tr.unknown).toContain("ETA indisponible");
    expect(tr.unknown.length).toBeLessThanOrEqual(4);
  });

  it("marks tracking restricted when the caller lacks tracking:read", () => {
    const tr = buildTransparency(makeSanitizedContext(NOW, { hideTracking: true }), "shipment_summary");
    expect(tr.restricted).toContain("Suivi");
    expect(tr.sources).not.toContain("Suivi");
  });
});
