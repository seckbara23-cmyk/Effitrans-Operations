/**
 * TMS-3 — Tracking Activation: the truthfulness contract, pinned.
 * ---------------------------------------------------------------------------
 * The audit (docs/tms/tms-3-tracking-activation.md) found the tracking layer
 * BUILT AND LIVE — manual events in all three planes, one French source/
 * confidence vocabulary, per-source freshness, append-only history, a
 * customer projection that omits internal notes. TMS-3's code is two reuse
 * gaps: the referential feeds the manual forms (G1) and the dossier reaches
 * its own studio (G2). These pins protect BOTH what was built and what was
 * deliberately NOT changed.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const oceanActions = read("lib", "shipping", "intelligence", "actions.ts");
const airActions = read("lib", "air", "intelligence", "actions.ts");
const roadActions = read("lib", "tracking", "actions.ts");
const events = read("lib", "shipping", "intelligence", "events.ts");
const freshness = read("lib", "shipping", "intelligence", "freshness.ts");
const carriage = read("lib", "portal", "carriage.ts");
const studio = read("components", "shipping", "tracking-studio.tsx");
const airConsole = read("components", "air", "air-console.tsx");
const shippingManage = read("lib", "shipping", "intelligence", "manage-service.ts");
const airManage = read("lib", "air", "intelligence", "manage-service.ts");
const carriagePanel = read("components", "files", "carriage-panel.tsx");

// ================================================== authority (as built) ====

describe("TMS-3 — recording authority is the EXISTING one, no widening", () => {
  it("ocean and air manual events demand transport:update", () => {
    expect(oceanActions).toContain('assertPermission("transport:update")');
    expect(airActions).toContain('assertPermission("transport:update")');
  });

  it("road manual updates demand tracking:write AND the master flag — on BOTH actions (pins have twins)", () => {
    expect((roadActions.match(/assertPermission\("tracking:write"\)/g) ?? []).length).toBe(2);
    expect(
      (roadActions.match(/if \(!trackingEnabled\(\)\) return \{ ok: false, error: "tracking_disabled" \}/g) ?? []).length,
    ).toBe(2);
  });

  it("no new permission literal was invented for TMS-3", () => {
    const templates = read("lib", "platform", "role-templates.ts");
    for (const invented of ["tracking:activate", "tracking:manual", "geography:"]) {
      expect(templates).not.toContain(invented);
    }
  });
});

// ============================================== truthful stamps & history ====

describe("TMS-3 — a manual entry can never masquerade as telemetry", () => {
  it("ocean events are stamped source=MANUAL confidence=MANUAL at the write", () => {
    expect(oceanActions).toContain('source: "MANUAL", provider_code: s.provider_code,\n      confidence: "MANUAL"');
  });

  it("air events carry the same stamps", () => {
    expect(airActions).toContain('source: "MANUAL", provider_code: s.air_provider_code, confidence: "MANUAL"');
  });

  it("road updates are stamped source='manual' (2 insert payloads + their 2 audit records)", () => {
    expect((roadActions.match(/source: "manual"/g) ?? []).length).toBe(4);
  });

  it("a milestone REGRESSION demands explicit confirmation in both planes", () => {
    expect(oceanActions).toContain('if (verdict.kind === "regress" && !input.confirmCorrection) return { ok: false, error: "confirmation_required" }');
    expect(airActions).toContain('if (verdict.kind === "regress" && !input.confirmCorrection) return { ok: false, error: "confirmation_required" }');
  });

  it("tracking events are APPEND-ONLY — no action updates or deletes an event row", () => {
    for (const src of [oceanActions, airActions, roadActions]) {
      expect(src).not.toMatch(/from\("(?:ocean_|air_)?tracking_event"\)[\s\S]{0,120}?\.(update|delete)\(/);
    }
  });

  it("every manual entry is audited", () => {
    expect(oceanActions).toContain("AuditActions.SHIPPING_TRACKING_MANUAL_EVENT");
    expect(airActions).toContain("AuditActions.AIR_TRACKING_MANUAL_EVENT");
  });

  it("the ONE French vocabulary: MANUAL reads « Saisie manuelle », and no label claims carrier confirmation", () => {
    expect(events).toContain('MANUAL: "Saisie manuelle"');
    expect(events).not.toContain("Confirmé par le transporteur");
  });

  it("freshness is age-language — « En direct » is forbidden until a real-time provider exists", () => {
    expect(freshness).toContain('LIVE: "À jour"');
    // the phrase may appear in the doctrine COMMENT that forbids it — the
    // executable code (comment-stripped) must never emit it as a label
    const code = freshness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("En direct");
    // stale data stays classified, not deleted: VERY_STALE is a label, not a filter
    expect(freshness).toContain('VERY_STALE: "Très ancien"');
  });
});

// ==================================================== customer boundary ====

describe("TMS-3 — the customer projection boundary is unchanged and pinned", () => {
  it("the portal ocean-event read NEVER selects the internal note (description)", () => {
    const sel = carriage.match(/from\("ocean_tracking_event"\)[\s\S]{0,40}?\.select\("([^"]+)"\)/);
    expect(sel).not.toBeNull();
    expect(sel![1]).not.toContain("description");
  });

  it("road positions reach the portal only through the customer_visible RLS row filter", () => {
    const rls = read("supabase", "migrations", "20260710000002_create_tracking.sql");
    expect(rls).toContain("create policy tracking_position_portal_select");
    expect(rls).toContain("portal_can_read_file(file_id) and customer_visible = true");
  });

  it("TMS-3 adds no portal read of the geography referential", () => {
    expect(carriage).not.toContain("listPortLocationOptions");
    expect(carriage).not.toContain("listAirportLocationOptions");
  });
});

// =========================================================== G1 pickers ====

describe("TMS-3 G1 — the referential feeds the manual forms (copied, never invented)", () => {
  it("the location-option reads exist behind the SAME transport:read gate as every studio read", () => {
    expect(shippingManage).toContain("export async function listPortLocationOptions");
    expect(airManage).toContain("export async function listAirportLocationOptions");
    // both live in files whose shared gate() asserts transport:read
    expect(shippingManage).toContain('assertPermission("transport:read")');
    expect(airManage).toContain('assertPermission("transport:read")');
  });

  it("ocean picker PREFILLS from the referential row and a coordinate-less port fills nothing", () => {
    expect(studio).toContain("Lieu depuis le référentiel");
    expect(studio).toContain('setLatitude(p.latitude != null ? String(p.latitude) : "")');
    expect(studio).toContain('setLongitude(p.longitude != null ? String(p.longitude) : "")');
    // no numeric fallback anywhere in the prefill
    expect(studio).not.toMatch(/latitude \?\? 0|longitude \?\? 0/);
  });

  it("air picker behaves identically", () => {
    expect(airConsole).toContain("Lieu depuis le référentiel");
    expect(airConsole).toContain('setLocLat(a.latitude != null ? String(a.latitude) : "")');
    expect(airConsole).toContain('setLocLon(a.longitude != null ? String(a.longitude) : "")');
  });

  it("the prefilled fields remain editable controlled inputs — the operator can override or clear", () => {
    expect(studio).toContain("value={locationName} onChange={(e) => setLocationName(e.target.value)}");
    expect(studio).toContain("value={latitude} onChange={(e) => setLatitude(e.target.value)}");
    expect(airConsole).toContain("value={locIata} onChange={(e) => setLocIata(e.target.value)}");
  });

  it("the events remain MANUAL: the forms still warn, and the pickers never touch the actions", () => {
    expect(studio).toContain("Chaque évènement est étiqueté « Manuel »");
    expect(airConsole).toContain("Chaque évènement est étiqueté « Manuel »");
    expect(studio).not.toContain('confidence: "CONFIRMED"');
    expect(airConsole).not.toContain('confidence: "CONFIRMED"');
  });

  it("the detail pages load locations only for writers", () => {
    const oceanPage = read("app", "shipping", "shipments", "[shipmentId]", "page.tsx");
    const airPage = read("app", "air", "shipments", "[shipmentId]", "page.tsx");
    expect(oceanPage).toContain("canWrite ? listPortLocationOptions() : Promise.resolve([])");
    expect(airPage).toContain("canWrite ? listAirportLocationOptions() : Promise.resolve([])");
  });
});

// ========================================================= G2 deep link ====

describe("TMS-3 G2 — the dossier reaches ITS OWN shipment's studio", () => {
  it("the carriage panel deep-links by mode to the shipment detail", () => {
    expect(carriagePanel).toContain('`${carriage.mode === "SEA" ? "/shipping" : "/air"}/shipments/${shipmentId}`');
    expect(carriagePanel).toContain("Ouvrir le suivi maritime");
    expect(carriagePanel).toContain("Ouvrir le suivi aérien");
  });

  it("the dossier page passes its shipment id", () => {
    const page = read("app", "files", "[id]", "page.tsx");
    expect(page).toContain("<CarriagePanel carriage={carriage} shipmentId={file.shipment?.id ?? null} />");
  });
});

// =========================================================== scope guard ====

describe("TMS-3 — scope guard (activation, not expansion)", () => {
  it("TMS-3 shipped NO migration", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = migrations.indexOf("20260906000001_commercial_owner_assignment.sql");
    expect(migrations[idx + 1]).toBe("20260907000001_shipment_geography.sql");
    expect(migrations.some((f) => /tracking_activation|tms_?3/i.test(f))).toBe(false);
  });

  it("no generic-TMS surface appeared (fleet/vehicle/fuel/maintenance/telematics stay excluded)", () => {
    for (const dir of ["lib", "components"]) {
      const names: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) { names.push(e.name); walk(full); }
        }
      };
      walk(path.join(root, dir));
      expect(names.some((n) => /fleet|vehicle|fuel|maintenance|telematic/i.test(n))).toBe(false);
    }
  });

  it("provider stubs stay honest — every unconfigured operation reports not_configured, nothing fabricated", () => {
    const airProvider = read("lib", "air", "intelligence", "provider.ts");
    expect(airProvider).toContain('return { ok: false, error: "not_configured" }');
    const oceanProvider = read("lib", "shipping", "intelligence", "provider.ts");
    expect(oceanProvider).toContain('"not_configured"');
  });

  it("the road flag model is untouched: dark by default, sub-capabilities require the master", () => {
    const flags = read("lib", "tracking", "flags.ts");
    expect(flags).toContain('const on = (v: string | undefined): boolean => v === "true"');
    expect(flags).toContain("driverMobile: enabled && on(env.DRIVER_MOBILE_TRACKING_ENABLED)");
  });
});
