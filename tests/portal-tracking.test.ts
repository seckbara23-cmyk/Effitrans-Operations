import { describe, it, expect } from "vitest";
import { derivePortalEta } from "@/lib/portal/eta";
import {
  resolveRoute,
  deriveDelay,
  deriveNextStep,
  documentRequirements,
  buildTimeline,
  departmentLabel,
} from "@/lib/portal/tracking-derive";
import { customerSafeRoleLabel, isGenericStaffIdentity, TEAM_FALLBACK_NAME } from "@/lib/portal/officer-view";
import { resolveLocation, buildMapPoints } from "@/lib/portal/map-points";

const NOW = new Date("2026-06-20T12:00:00.000Z");

// ------------------------------------------------------------------ route (D2)
describe("resolveRoute — never '— → —'", () => {
  it("uses shipment origin/destination when present", () => {
    const r = resolveRoute({ shipmentOrigin: "Shanghai", shipmentDestination: "Dakar", pickupLocation: null, deliveryLocation: null });
    expect(r.display).toBe("Shanghai → Dakar");
    expect(r.confirmed).toBe(true);
  });
  it("falls back to transport pickup/delivery locations", () => {
    const r = resolveRoute({ shipmentOrigin: null, shipmentDestination: null, pickupLocation: "Port de Dakar", deliveryLocation: "Bamako" });
    expect(r.display).toBe("Port de Dakar → Bamako");
  });
  it("partial data yields meaningful fallbacks, never empty arrows", () => {
    expect(resolveRoute({ shipmentOrigin: "Dakar", shipmentDestination: null, pickupLocation: null, deliveryLocation: null }).display).toBe("Dakar → Destination à confirmer");
    expect(resolveRoute({ shipmentOrigin: null, shipmentDestination: "Conakry", pickupLocation: null, deliveryLocation: null }).display).toBe("Port de Dakar → Conakry");
  });
  it("genuinely unavailable → confirmation message, never '— → —'", () => {
    const r = resolveRoute({ shipmentOrigin: null, shipmentDestination: null, pickupLocation: null, deliveryLocation: null });
    expect(r.display).toBe("Itinéraire en cours de confirmation");
    expect(r.display).not.toContain("—");
  });
});

// ------------------------------------------------------------------ delay (D6)
describe("deriveDelay — customer-safe labels + explanation, no internal leak", () => {
  it("maps the 4 internal levels to customer labels", () => {
    expect(deriveDelay("low", { missingDocs: 0, customsInspection: false, awaitingPod: false }).label).toBe("Dans les délais");
    expect(deriveDelay("medium", { missingDocs: 0, customsInspection: false, awaitingPod: false }).label).toBe("Suivi recommandé");
    expect(deriveDelay("high", { missingDocs: 0, customsInspection: false, awaitingPod: false }).label).toBe("Retard possible");
    expect(deriveDelay("critical", { missingDocs: 0, customsInspection: false, awaitingPod: false }).label).toBe("Intervention en cours");
  });
  it("normal has no explanation; non-normal explains from visible facts only", () => {
    expect(deriveDelay("low", { missingDocs: 2, customsInspection: true, awaitingPod: true }).explanation).toBeNull();
    expect(deriveDelay("high", { missingDocs: 0, customsInspection: true, awaitingPod: false }).explanation).toContain("douanier");
    expect(deriveDelay("medium", { missingDocs: 1, customsInspection: false, awaitingPod: false }).explanation).toContain("documents");
    expect(deriveDelay("critical", { missingDocs: 0, customsInspection: false, awaitingPod: true }).explanation).toContain("preuve de livraison");
  });
  it("never leaks internal terms (SLA, risk score, blocker codes)", () => {
    const all = (["low", "medium", "high", "critical"] as const).map((lvl) =>
      deriveDelay(lvl, { missingDocs: 1, customsInspection: true, awaitingPod: true }),
    );
    const blob = JSON.stringify(all).toLowerCase();
    for (const term of ["sla", "risk", "score", "blocker", "critical_", "reasoncode"]) expect(blob).not.toContain(term);
  });
});

// -------------------------------------------------------------- next step (D7)
describe("deriveNextStep", () => {
  it("requests client action when required documents are missing", () => {
    const ns = deriveNextStep("documents_received", { missingDocLabels: ["Certificat d'origine"] });
    expect(ns.party).toBe("client");
    expect(ns.clientAction).toContain("Certificat d'origine");
  });
  it("customs stage → customs authorities, no client action", () => {
    const ns = deriveNextStep("customs_in_progress", { missingDocLabels: [] });
    expect(ns.party).toBe("customs");
    expect(ns.clientAction).toBeNull();
  });
  it("in transit → carrier; finalised → no next milestone", () => {
    expect(deriveNextStep("in_transit", { missingDocLabels: [] }).party).toBe("carrier");
    expect(deriveNextStep("paid", { missingDocLabels: [] }).milestoneKey).toBeNull();
  });
});

// ------------------------------------------------- document requirements (D5)
describe("documentRequirements — customer-safe states", () => {
  it("maps internal statuses to customer states", () => {
    const reqs = documentRequirements({
      requiredCodes: ["INVOICE", "PACKING", "COO", "BL"],
      bestStatusByCode: new Map([["INVOICE", "APPROVED"], ["PACKING", "PENDING_REVIEW"], ["COO", "REJECTED"]]),
      labelByCode: new Map([["INVOICE", "Facture"]]),
    });
    expect(reqs.find((r) => r.code === "INVOICE")).toMatchObject({ label: "Facture", state: "valide" });
    expect(reqs.find((r) => r.code === "PACKING")?.state).toBe("en_verification");
    expect(reqs.find((r) => r.code === "COO")?.state).toBe("a_remplacer");
    expect(reqs.find((r) => r.code === "BL")?.state).toBe("requis"); // no doc yet
  });
});

// ------------------------------------------------------------- timeline (D4)
describe("buildTimeline — dated, deduped, newest-first, never empty", () => {
  it("always includes the creation milestone", () => {
    const tl = buildTimeline({ createdAt: "2026-06-01T08:00:00.000Z", createdLabel: "Dossier créé", notifications: [] });
    expect(tl).toHaveLength(1);
    expect(tl[0].title).toBe("Dossier créé");
  });
  it("dedupes equivalent milestone/notification events and sorts newest first", () => {
    const tl = buildTimeline({
      createdAt: "2026-06-01T08:00:00.000Z",
      createdLabel: "Dossier créé",
      notifications: [
        { id: "a", title: "Marchandise dédouanée", category: "CUSTOMS", createdAt: "2026-06-05T10:00:00.000Z" },
        { id: "b", title: "Marchandise dédouanée", category: "CUSTOMS", createdAt: "2026-06-05T11:00:00.000Z" }, // dup
        { id: "c", title: "Livraison effectuée", category: "DELIVERY", createdAt: "2026-06-08T09:00:00.000Z" },
      ],
    });
    expect(tl.map((e) => e.title)).toEqual(["Livraison effectuée", "Marchandise dédouanée", "Dossier créé"]);
  });
});

describe("departmentLabel — no internal codes", () => {
  it("maps to customer French names", () => {
    expect(departmentLabel("customs")).toBe("Douane");
    expect(departmentLabel("transport")).toBe("Transport");
    expect(departmentLabel(null)).toBe("Traitement en cours");
    expect(departmentLabel("customs")).not.toBe("customs");
  });
});

// ------------------------------------------------------------------- ETA (D8)
describe("derivePortalEta — priority rules, no fabrication", () => {
  const base = { deliveredActual: null, scheduledDelivery: null, transportEta: null, pickupActual: null, currentStageKey: null, now: NOW };
  it("1) scheduled delivery date wins", () => {
    const e = derivePortalEta({ ...base, scheduledDelivery: "2026-06-25", transportEta: "2026-07-01" });
    expect(e.basis).toBe("scheduled_delivery");
    expect(e.estimatedDate).toBe("2026-06-25");
    expect(e.confidence).toBe("high");
  });
  it("2) transport ETA when no scheduled date", () => {
    const e = derivePortalEta({ ...base, transportEta: "2026-06-28" });
    expect(e.basis).toBe("transport_eta");
    expect(e.confidence).toBe("medium");
  });
  it("3) operational estimate ONLY from a real pickup timestamp", () => {
    const e = derivePortalEta({ ...base, pickupActual: "2026-06-15T00:00:00.000Z" });
    expect(e.basis).toBe("operational_estimate");
    expect(e.confidence).toBe("low");
    expect(e.estimatedDate).not.toBeNull(); // pickup + 7d buffer
  });
  it("4) unknown never fabricates a date", () => {
    const e = derivePortalEta(base);
    expect(e.basis).toBe("unknown");
    expect(e.estimatedDate).toBeNull();
  });
  it("delivered → basis delivered, no delay", () => {
    const e = derivePortalEta({ ...base, deliveredActual: "2026-06-18", scheduledDelivery: "2026-06-25" });
    expect(e.basis).toBe("delivered");
    expect(e.delayDays).toBe(0);
  });
  it("past scheduled date not yet delivered → delay days", () => {
    const e = derivePortalEta({ ...base, scheduledDelivery: "2026-06-15" });
    expect(e.delayDays).toBe(5);
  });
});

// -------------------------------------------------------- officer (D3)
describe("customer-safe officer", () => {
  it("maps role codes to customer titles, never raw codes", () => {
    expect(customerSafeRoleLabel("ACCOUNT_MANAGER")).toBe("Chargé de compte");
    expect(customerSafeRoleLabel("OPS_SUPERVISOR")).not.toContain("OPS_");
    expect(customerSafeRoleLabel(null)).toBe("Service des opérations");
  });
  it("removes the 'System Administrator' identity → team fallback", () => {
    expect(isGenericStaffIdentity("System Administrator", false)).toBe(true);
    expect(isGenericStaffIdentity("Administrateur", false)).toBe(true);
    expect(isGenericStaffIdentity(null, false)).toBe(true);
    expect(isGenericStaffIdentity("Aminata Mbaye", true)).toBe(true); // system admin flag
    expect(isGenericStaffIdentity("Aminata Mbaye", false)).toBe(false);
    expect(TEAM_FALLBACK_NAME).toBe("Équipe Opérations Effitrans");
  });
});

// ------------------------------------------------------------- map (D9/D10)
describe("map points — vetted registry only, no invented coordinates", () => {
  it("resolves known locations from the registry", () => {
    expect(resolveLocation("Port de Dakar")?.label).toBe("Port de Dakar");
    expect(resolveLocation("bamako, mali")?.label).toBe("Bamako");
  });
  it("returns null for unknown free text (never geocodes blindly)", () => {
    expect(resolveLocation("123 rue inconnue quelque part")).toBeNull();
    expect(resolveLocation("")).toBeNull();
    expect(resolveLocation(null)).toBeNull();
  });
  it("buildMapPoints marks hasGeo only when both endpoints resolve", () => {
    const geo = buildMapPoints({ origin: "Dakar", destination: "Bamako", progressPercent: 40 });
    expect(geo.hasGeo).toBe(true);
    expect(geo.points[0].coord).not.toBeNull();
    const noGeo = buildMapPoints({ origin: "Somewhere unknown", destination: "Elsewhere unknown", progressPercent: 0 });
    expect(noGeo.hasGeo).toBe(false);
    expect(noGeo.points.every((p) => p.coord === null)).toBe(true);
  });
});
