import { describe, it, expect } from "vitest";
import {
  DRIVER_EVENT_KINDS,
  isDriverEventKind,
  isDelayCategory,
  isIncidentCategory,
  isIncidentSeverity,
  isEvidenceKind,
  EVIDENCE_TYPE_CODE,
  isAllowedEvidenceMime,
  delayDedupKey,
  deliveredDedupKey,
  DELAY_DEDUP_WINDOW_MS,
  type EvidenceKind,
} from "@/lib/driver/event-kinds";
import { canTransition } from "@/lib/transport/status";

describe("driver operational event kinds", () => {
  it("accepts the allowed driver events", () => {
    for (const k of DRIVER_EVENT_KINDS) expect(isDriverEventKind(k)).toBe(true);
  });
  it("rejects events a driver may NOT self-record (lifecycle / staff-only)", () => {
    // DELIVERED goes through confirmDelivery, not a raw event; these are not driver-recordable.
    for (const forbidden of ["DELIVERED", "TRACKING_STARTED", "TRACKING_STOPPED", "CUSTOMS_STOP", "DELAY_REPORTED", "INCIDENT_REPORTED", "POD_RECEIVED", "hack", ""]) {
      expect(isDriverEventKind(forbidden)).toBe(false);
    }
  });
});

describe("delay / incident category + severity guards", () => {
  it("validates delay categories", () => {
    expect(isDelayCategory("customs_delay")).toBe(true);
    expect(isDelayCategory("client_unavailable")).toBe(true);
    expect(isDelayCategory("nope")).toBe(false);
  });
  it("validates incident categories", () => {
    expect(isIncidentCategory("accident")).toBe(true);
    expect(isIncidentCategory("cargo_damage")).toBe(true);
    expect(isIncidentCategory("traffic")).toBe(false); // that's a delay, not an incident
  });
  it("validates incident severities", () => {
    for (const s of ["low", "medium", "high", "critical"]) expect(isIncidentSeverity(s)).toBe(true);
    expect(isIncidentSeverity("catastrophic")).toBe(false);
  });
});

describe("evidence kind → document_type mapping + MIME allow-list", () => {
  it("maps every evidence kind to a document_type code", () => {
    expect(EVIDENCE_TYPE_CODE.pickup).toBe("PICKUP_PHOTO");
    expect(EVIDENCE_TYPE_CODE.pod).toBe("DELIVERY_NOTE"); // reuses the existing POD type
    expect(EVIDENCE_TYPE_CODE.signature).toBe("DRIVER_SIGNATURE");
    for (const k of Object.keys(EVIDENCE_TYPE_CODE) as EvidenceKind[]) expect(isEvidenceKind(k)).toBe(true);
    expect(isEvidenceKind("passport")).toBe(false);
  });
  it("photos accept only jpeg/png; POD also accepts pdf", () => {
    expect(isAllowedEvidenceMime("pickup", "image/jpeg")).toBe(true);
    expect(isAllowedEvidenceMime("delivery", "image/png")).toBe(true);
    expect(isAllowedEvidenceMime("cargo", "application/pdf")).toBe(false); // no PDF for photos
    expect(isAllowedEvidenceMime("cargo", "image/gif")).toBe(false);
    expect(isAllowedEvidenceMime("cargo", "image/svg+xml")).toBe(false);
    expect(isAllowedEvidenceMime("pod", "application/pdf")).toBe(true);
    expect(isAllowedEvidenceMime("pod", "image/jpeg")).toBe(true);
    expect(isAllowedEvidenceMime("pickup", null)).toBe(false);
    expect(isAllowedEvidenceMime("pickup", undefined)).toBe(false);
  });
});

describe("dedup keys", () => {
  const t0 = 1_666_666 * DELAY_DEDUP_WINDOW_MS; // bucket-aligned base
  it("collapses repeated delays of the same category within the window", () => {
    const a = delayDedupKey("trp1", "traffic", t0);
    const b = delayDedupKey("trp1", "traffic", t0 + DELAY_DEDUP_WINDOW_MS - 1); // same bucket
    expect(a).toBe(b);
  });
  it("separates delays across the window boundary, categories, and transports", () => {
    expect(delayDedupKey("trp1", "traffic", t0)).not.toBe(delayDedupKey("trp1", "traffic", t0 + DELAY_DEDUP_WINDOW_MS));
    expect(delayDedupKey("trp1", "traffic", t0)).not.toBe(delayDedupKey("trp1", "weather", t0));
    expect(delayDedupKey("trp1", "traffic", t0)).not.toBe(delayDedupKey("trp2", "traffic", t0));
  });
  it("allows exactly one DELIVERED evidence event per transport", () => {
    expect(deliveredDedupKey("trp1")).toBe("delivered:trp1");
    expect(deliveredDedupKey("trp1")).not.toBe(deliveredDedupKey("trp2"));
  });
});

describe("delivery transition guard (reused by confirmDelivery)", () => {
  it("allows DELIVERED only from an in-progress transport", () => {
    expect(canTransition("PICKED_UP", "DELIVERED")).toBe(true);
    expect(canTransition("IN_TRANSIT", "DELIVERED")).toBe(true);
  });
  it("blocks a second/late delivery (duplicate protection at the state machine)", () => {
    expect(canTransition("DELIVERED", "DELIVERED")).toBe(false);
    expect(canTransition("POD_RECEIVED", "DELIVERED")).toBe(false);
    expect(canTransition("CANCELLED", "DELIVERED")).toBe(false);
    expect(canTransition("NOT_STARTED", "DELIVERED")).toBe(false);
    expect(canTransition("PLANNED", "DELIVERED")).toBe(false);
  });
});
