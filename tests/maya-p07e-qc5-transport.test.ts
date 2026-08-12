/**
 * MAYA-P0.7-E — Contrôle Qualité N°5 (Transport).
 * ---------------------------------------------------------------------------
 * Five controls. Three derive from authoritative actual timestamps and the
 * document authority; two report honest gaps — there is no vehicle-conformity
 * fact anywhere in the schema, and no signature fact behind « POD signé ».
 *
 * Four properties this suite defends:
 *
 *   1. IDENTIFIED IS NOT CONFORME. A plate never becomes a conformity verdict.
 *   2. PLANNED IS NEVER PROMOTED TO ACTUAL. A planned pickup or delivery can
 *      never make a control `observed`.
 *   3. VERIFIED IS NOT SIGNED. Four POD states stay distinct, and the absence
 *      of a signature fact is stated rather than glossed.
 *   4. RESTRICTED IS NOT ABSENT — for all three gates independently.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveQC5, podState, departureEvent,
  QC5_NO_VEHICLE_CONFORMITY, QC5_NO_SIGNATURE_FACT, QC5_NO_DEPARTURE_WITHOUT_TRACKING,
  type QC5Input,
} from "@/lib/files/qc5";
import type { DocumentItem } from "@/lib/documents/types";
import type { TransportRecord } from "@/lib/transport/types";
import type { TrackingEventEntry } from "@/lib/tracking/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PURE = "lib/files/qc5.ts";
const PANEL = "components/files/qc5-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

const doc = (typeCode: string, status: string, id = String(Math.random())): DocumentItem => ({
  id, fileId: "f1", typeCode, typeLabel: typeCode, title: null,
  status: status as DocumentItem["status"], version: 1, expiryDate: null,
  expiryState: "none" as DocumentItem["expiryState"], mimeType: null, sizeBytes: null,
  uploadedByEmail: null, reviewedByEmail: null, reviewNote: null, sharedWithClient: false,
  createdAt: "2026-08-12T09:00:00.000Z",
});

const transport = (over: Partial<TransportRecord> = {}): TransportRecord => ({
  id: "t1", fileId: "f1", status: "DELIVERED" as TransportRecord["status"],
  pickupLocation: "Dakar Port", deliveryLocation: "Thiès",
  pickupPlanned: "2026-08-12T06:00:00.000Z", pickupActual: "2026-08-12T07:15:00.000Z",
  deliveryPlanned: "2026-08-12T14:00:00.000Z", deliveryActual: "2026-08-12T15:40:00.000Z",
  driverName: "M. Diop", driverPhone: null, vehiclePlate: "DK-4471-AA",
  trailerOrContainer: "TESU1234567", transportCompany: "Effitrans", deliveryReference: "BL-99",
  customsOverride: false, notes: null, driverUserId: null,
  updatedAt: "2026-08-12T16:00:00.000Z", ...over,
});

const ev = (type: string, occurredAt: string): TrackingEventEntry =>
  ({ type, occurredAt } as unknown as TrackingEventEntry);

const input = (over: Partial<QC5Input> = {}): QC5Input => ({
  canReadTransport: true, canReadDocuments: true, canReadTracking: true,
  transport: transport(), documents: [], trackingEvents: [], timeZone: TZ, ...over,
});

const byKey = (e: ReturnType<typeof deriveQC5>, k: string) => e.controls.find((c) => c.key === k)!;

// ===========================================================================
describe("the five controls of the manual are all accounted for", () => {
  it("each control is present, in the manual's wording", () => {
    const labels = deriveQC5(input()).controls.map((c) => c.labelFr);
    for (const l of ["Camion conforme", "Heure de chargement", "Heure de départ",
                     "Heure de livraison", "POD signé"]) {
      expect(labels, l).toContain(l);
    }
  });
});

// ===========================================================================
describe("identified is not conforme", () => {
  it("a plate identifies the truck and never certifies it", () => {
    const c = byKey(deriveQC5(input()), "vehicle");
    expect(c.state).toBe("not_represented");
    expect(c.value).toBeNull();
    expect(c.reason).toContain("DK-4471-AA");
    expect(c.reason).toContain("Conformité non représentée");
  });

  it("stays unrepresented even with no plate at all", () => {
    const c = byKey(deriveQC5(input({ transport: transport({ vehiclePlate: null }) })), "vehicle");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC5_NO_VEHICLE_CONFORMITY);
  });

  it("no vehicle or conformity authority exists to reuse — pinned", () => {
    // If a vehicle table ever lands, this test fails and QC5 must be revisited.
    const tables = new Set<string>();
    for (const f of readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))) {
      if (!f.endsWith(".sql")) continue;
      for (const m of read(`supabase/migrations/${f}`).matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
        tables.add(m[1]);
      }
    }
    expect([...tables].filter((t) => /vehicle|truck|fleet/i.test(t))).toEqual([]);
    // And no conformity verdict is computed anywhere in the slice.
    expect(code(PURE)).not.toMatch(/isConform|conformityOk|vehicleValid/i);
  });
});

// ===========================================================================
describe("planned is never promoted to actual", () => {
  it("an actual pickup is the loading fact", () => {
    const c = byKey(deriveQC5(input()), "loadingTime");
    expect(c.state).toBe("observed");
    expect(c.value).toBe("12/08/2026 07:15");
  });

  it("a PLANNED pickup with no actual reads ABSENT, with the plan as context only", () => {
    const c = byKey(deriveQC5(input({ transport: transport({ pickupActual: null }) })), "loadingTime");
    expect(c.state).toBe("absent");
    expect(c.value).toBeNull();
    expect(c.reason).toContain("Planifié");
    expect(c.reason).toContain("non confirmé");
  });

  it("the same rule holds for delivery", () => {
    expect(byKey(deriveQC5(input()), "deliveryTime").value).toBe("12/08/2026 15:40");
    const c = byKey(deriveQC5(input({ transport: transport({ deliveryActual: null }) })), "deliveryTime");
    expect(c.state).toBe("absent");
    expect(c.value).toBeNull();
  });

  it("no planned field is ever used as the observed VALUE", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/value:[^,\n]*Planned/);
    // Delivery is never inferred from a status label or from the POD.
    expect(s).not.toMatch(/status === "DELIVERED"|status === "POD_RECEIVED"/);
  });
});

// ===========================================================================
describe("departure comes from the tracking authority or not at all", () => {
  it("derives from the DEPARTED event", () => {
    const c = byKey(deriveQC5(input({ trackingEvents: [ev("DEPARTED", "2026-08-12T08:05:00.000Z")] })), "departureTime");
    expect(c.state).toBe("observed");
    expect(c.value).toBe("12/08/2026 08:05");
  });

  it("takes the EARLIEST departure when several exist", () => {
    const e = [ev("DEPARTED", "2026-08-12T11:00:00.000Z"), ev("DEPARTED", "2026-08-12T08:05:00.000Z")];
    expect(departureEvent(e)!.occurredAt).toBe("2026-08-12T08:05:00.000Z");
  });

  it("ignores every other tracking event type", () => {
    expect(departureEvent([ev("PICKUP_CONFIRMED", "2026-08-12T07:15:00.000Z"), ev("DELIVERED", "2026-08-12T15:40:00.000Z")])).toBeNull();
  });

  it("without tracking, departure is NOT REPRESENTED — not merely missing", () => {
    const c = byKey(deriveQC5(input({ canReadTracking: false })), "departureTime");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC5_NO_DEPARTURE_WITHOUT_TRACKING);
  });

  it("with tracking on but no departure recorded, it reads ABSENT", () => {
    const c = byKey(deriveQC5(input({ canReadTracking: true, trackingEvents: [] })), "departureTime");
    expect(c.state).toBe("absent");
  });

  it("departure is never inferred from the pickup time or a status", () => {
    const c = byKey(deriveQC5(input({ trackingEvents: [] })), "departureTime");
    expect(c.value).toBeNull();
    expect(code(PURE)).not.toMatch(/departure[^;\n]*pickupActual/i);
  });
});

// ===========================================================================
describe("verified is not signed", () => {
  it("distinguishes all four POD states", () => {
    expect(podState([])).toBe("absent");
    expect(podState([doc("DELIVERY_NOTE", "UPLOADED")])).toBe("uploaded");
    expect(podState([doc("DELIVERY_NOTE", "PENDING_REVIEW")])).toBe("awaiting_verification");
    expect(podState([doc("DELIVERY_NOTE", "VERIFIED")])).toBe("verified");
    // The legacy APPROVED alias canonicalises to verified.
    expect(podState([doc("DELIVERY_NOTE", "APPROVED")])).toBe("verified");
  });

  it("only the DELIVERY_NOTE type is the POD", () => {
    expect(podState([doc("BAE", "VERIFIED"), doc("INVOICE", "VERIFIED")])).toBe("absent");
  });

  it("states plainly that a signature is not a recorded fact", () => {
    const c = byKey(deriveQC5(input({ documents: [doc("DELIVERY_NOTE", "VERIFIED")] })), "podSigned");
    expect(c.state).toBe("observed");
    expect(c.value).toBe("Pièce vérifiée");
    expect(c.reason).toBe(QC5_NO_SIGNATURE_FACT);
    expect(QC5_NO_SIGNATURE_FACT).toMatch(/jamais la présence d'une signature/);
  });

  it("never renders « signé » as an achieved state", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      expect(s, f).not.toMatch(/isSigned|signatureOk|podSignedAt/i);
      expect(s, f).not.toMatch(/["'>]\s*Sign[ée]\s*["'<]/);
    }
  });

  it("no duplicate POD store is created", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/quality_pod|podStore|recordPod/i);
    expect(s).toContain("DELIVERY_NOTE");
    expect(s).toContain("isVerified");
  });
});

// ===========================================================================
describe("restricted is not absent — three independent gates", () => {
  it("without transport:read, no transport fact is disclosed", () => {
    const e = deriveQC5(input({ canReadTransport: false }));
    for (const k of ["vehicle", "loadingTime", "departureTime", "deliveryTime", "podSigned"]) {
      expect(byKey(e, k).state, k).toBe("restricted");
      expect(byKey(e, k).value, k).toBeNull();
    }
    const rendered = JSON.stringify(e);
    expect(rendered).not.toContain("DK-4471-AA");
    expect(rendered).not.toContain("07:15");
    expect(rendered).not.toContain("15:40");
  });

  it("without document:read, the POD is restricted while transport facts remain", () => {
    const e = deriveQC5(input({ canReadDocuments: false, documents: [doc("DELIVERY_NOTE", "VERIFIED")] }));
    expect(e.podState).toBeNull();
    expect(byKey(e, "podSigned").state).toBe("restricted");
    // Transport timestamps are still legitimately visible.
    expect(byKey(e, "loadingTime").state).toBe("observed");
  });

  it("the page passes all three real gates through", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canReadTransport,/);
    expect(p).toMatch(/canReadDocuments: canReadDocs/);
    expect(p).toMatch(/canReadTracking: trackingOn && canReadTracking/);
  });

  it("the panel renders the four states distinctly", () => {
    const p = read(PANEL);
    expect(p).toContain("Non renseigné");
    expect(p).toContain("Non visible avec vos accès");
    expect(p).toContain("Non suivi par la plateforme");
  });
});

// ===========================================================================
describe("no invented SLA, no second transport system, no migration", () => {
  it("no threshold or timeliness verdict exists", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      // NOT a word ban: « Camion conforme » is the manual's own label and is
      // preserved verbatim. What must be absent is a rendered VERDICT.
      expect(s, f).not.toMatch(/["'>]\s*(Non )?[Cc]onforme\s*["'<]/);
      expect(s, f).not.toMatch(/onTime|isLate|maxDelay|slaHours|withinTarget/i);
      expect(s, f).not.toMatch(/\b(2|4|24|48|72)\s*\*\s*60/);
    }
  });

  it("the module is PURE and names no table", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/supabase|\.from\(|\.rpc\(|await |server-only/);
    for (const t of ["transport_record", "tracking_event", "document"]) {
      expect(s, t).not.toContain(`"${t}"`);
    }
  });

  it("QC5 adds no query — the tenant zone is still read once", () => {
    const p = code(PAGE);
    expect((p.match(/getTenantTimezone\(\)/g) ?? []).length).toBe(1);
    expect(p).toMatch(/deriveQC5\(\{/);
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    expect(migrations).toHaveLength(declared);
    expect(declared).toBe(102);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("no transport state machine, workflow or closure change", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/changeTransportStatus|process_instance|emitBusinessEvent|transition/i);
    for (const f of ["lib/process/applicability.ts", "lib/workflow/projection.ts",
                     "lib/files/status.ts", "lib/files/closure.ts"]) {
      expect(code(f), f).not.toMatch(/qc5|deriveQC5/i);
    }
  });

  it("QC1–QC4 remain intact, with their gaps still open", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    expect(code("lib/files/qc2.ts")).toContain("QC2_TRANSMISSION_CONFLICT");
    expect(code("lib/files/qc4.ts")).toContain("QC4_NO_VALIDATION_RECORD");
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
    // The known unresolved items are NOT silently closed here.
    expect(code("lib/files/actions.ts")).toContain("account_manager_id: admin.id");
    expect(read("lib/process/sla-policies.ts")).toMatch(/bae_followup[\s\S]{0,120}unconfigured/);
    expect(code("lib/customs/actions.ts")).not.toContain('assertPermission("customs:validate")');
  });

  it("QC3's trust contract survives", () => {
    expect(read("supabase/migrations/20260824000001_customs_receivability.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
  });

  it("no Q5, Sage, client import or MAYA APPLY", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      expect(s.toLowerCase(), f).not.toContain("groupage");
      expect(s, f).not.toMatch(/parent_file_id|dossiermere|maya_import|ninea|\bsage\b/i);
    }
  });

  it("no new permission was introduced", () => {
    expect(code(PURE)).not.toMatch(/assertPermission|hasPermission/);
  });
});
