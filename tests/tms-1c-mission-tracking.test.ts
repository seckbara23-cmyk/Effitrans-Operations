/**
 * TMS-1C — external live-tracking reference for a transport mission.
 * ---------------------------------------------------------------------------
 * Effitrans Operations is the system of record; the provider platform remains
 * the live telemetry authority. What must never drift:
 *
 *   * the reference belongs to the MISSION — never to a vehicle, a driver or
 *     a dossier — so the same truck tracked twice carries two references and
 *     changing a driver rewrites nothing;
 *   * tracking is NOT authoritative for the workflow: ending it does not
 *     deliver, and delivery does not require it;
 *   * the link is staff-only — the customer portal and the tracked driver both
 *     see nothing;
 *   * https only, parsed not pattern-matched, because the href is rendered;
 *   * the full URL never leaves the anchor: audit and display carry the host.
 *
 * Real-Postgres behaviour: supabase/tests/tms_1c_mission_tracking_test.sql.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateTrackingUrl,
  validateProvider,
  normalizeExternalReference,
  trackingState,
  canFollowLive,
  trackingDisplayHost,
  TRACKING_STATE_LABEL_FR,
  type TrackingReference,
} from "@/lib/transport/tracking-reference";
import { AuditActions } from "@/lib/audit/events";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260927000001_transport_tracking_reference.sql";
const mRaw = read(MIGRATION);
const m = strip(mRaw);
const actions = strip(read("lib/transport/tracking-actions.ts"));
const service = strip(read("lib/transport/tracking-service.ts"));
const pure = read("lib/transport/tracking-reference.ts");
const ui = read("components/transport/mission-tracking.tsx");
const page = read("app/files/[id]/page.tsx");

const ref = (over: Partial<TrackingReference> = {}): TrackingReference => ({
  id: "r1", transportId: "t1", provider: "Suivi Flotte SN",
  externalReference: null, trackingUrl: "https://tracker.example.sn/m/abc",
  attachedAt: "2026-09-02T10:00:00Z", updatedAt: null, endedAt: null, endReason: null,
  ...over,
});

// ═══════════════ 4/5 — URL validation ══════════════════════════════════════

describe("TMS-1C — the tracking URL is validated server-side", () => {
  it("accepts a valid https URL", () => {
    const r = validateTrackingUrl("https://tracker.example.sn/mission/42?sig=abc");
    expect(r.ok && r.url).toBe("https://tracker.example.sn/mission/42?sig=abc");
  });

  it("refuses empty and whitespace-only", () => {
    expect(validateTrackingUrl("")).toEqual({ ok: false, error: "url_required" });
    expect(validateTrackingUrl("   ")).toEqual({ ok: false, error: "url_required" });
    expect(validateTrackingUrl(null)).toEqual({ ok: false, error: "url_required" });
  });

  it("refuses every non-https protocol — including the ones that would execute", () => {
    for (const bad of [
      "http://tracker.example.sn/m/1",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "ftp://tracker.example.sn",
    ]) {
      const r = validateTrackingUrl(bad);
      expect(r.ok, bad).toBe(false);
    }
    // http is refused for its scheme, not merely for being unparseable.
    expect(validateTrackingUrl("http://x.example")).toEqual({ ok: false, error: "url_not_https" });
  });

  it("refuses a malformed URL and a hostless one", () => {
    expect(validateTrackingUrl("not a url")).toEqual({ ok: false, error: "url_invalid" });
    expect(validateTrackingUrl("https://")).toEqual({ ok: false, error: "url_invalid" });
  });

  it("is PARSED, never pattern-matched — the href is rendered into a page", () => {
    expect(pure).toContain("new URL(trimmed)");
    const fn = pure.slice(pure.indexOf("export function validateTrackingUrl"));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).not.toMatch(/\/\^https/);
  });

  it("bounds the length, and requires a provider name", () => {
    expect(validateTrackingUrl(`https://x.example/${"a".repeat(3000)}`))
      .toEqual({ ok: false, error: "url_too_long" });
    expect(validateProvider("  ")).toEqual({ ok: false, error: "provider_required" });
    expect(validateProvider("  Suivi   Flotte  ")).toEqual({ ok: true, provider: "Suivi Flotte" });
    expect(normalizeExternalReference("  ")).toBeNull();
  });

  it("the database refuses a non-https URL too — the app gate is not the only one", () => {
    expect(m).toContain("tracking_url ~ '^https://[^ ]+$'");
  });
});

// ═══════════════ 7 — derived state, and the honesty of AVAILABLE ═══════════

describe("TMS-1C — state is derived, and never claims to know more", () => {
  it("no reference is NOT_CONFIGURED, and the neutral sentence says so", () => {
    expect(trackingState(null)).toBe("NOT_CONFIGURED");
    expect(TRACKING_STATE_LABEL_FR.NOT_CONFIGURED).toBe("Suivi en direct non configuré pour cette mission.");
    expect(canFollowLive(null)).toBe(false);
  });

  it("a live reference is AVAILABLE; a closed one is ENDED and not followable", () => {
    expect(trackingState(ref())).toBe("AVAILABLE");
    expect(canFollowLive(ref())).toBe(true);
    expect(trackingState(ref({ endedAt: "2026-09-02T18:00:00Z" }))).toBe("ENDED");
    expect(canFollowLive(ref({ endedAt: "2026-09-02T18:00:00Z" }))).toBe(false);
  });

  it("there is NO ACTIVE state — without a provider API nothing can observe it", () => {
    expect(Object.keys(TRACKING_STATE_LABEL_FR).sort()).toEqual(["AVAILABLE", "ENDED", "NOT_CONFIGURED"]);
    expect(pure).toContain("ACTIVE IS ABSENT ON PURPOSE");
    expect(mRaw).toContain("NO `status` COLUMN, DELIBERATELY");
    // …and no status column was created either.
    expect(m.slice(m.indexOf("create table"), m.indexOf("create index"))).not.toContain("status");
  });
});

// ═══════════════ 1/2/3 — authority and tenant ══════════════════════════════

describe("TMS-1C — authority is the ratified transport one", () => {
  it("every mutation asserts transport:assign", () => {
    const count = (actions.match(/assertPermission\("transport:assign"\)/g) ?? []).length;
    expect(count, "attach + end + remove").toBe(3);
    expect(actions).not.toContain('assertPermission("tracking:');
  });

  it("reading asserts transport:read — NOT tracking:read, which DRIVER holds", () => {
    expect(service).toContain('assertPermission("transport:read")');
    expect(service).not.toContain("tracking:read");
    expect(m).toContain("public.has_permission('transport:read')");
    expect(m).not.toContain("has_permission('tracking:read')");
  });

  it("no new permission was invented — the migration refuses one", () => {
    expect(m).toContain("'tracking:attach', 'transport:tracking', 'tracking:link'");
    expect(m).toContain("an invented tracking permission exists");
  });

  it("cross-tenant is refused: the mission is re-resolved under the caller's tenant", () => {
    const load = actions.slice(actions.indexOf("async function loadMission"));
    const body = load.slice(0, load.indexOf("\n}\n"));
    expect(body).toContain('.eq("tenant_id", tenantId)');
    // and every write re-filters on tenant
    expect((actions.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("the dossier and tenant are SERVER-resolved, never taken from the client", () => {
    expect(actions).toContain("file_id: mission.file_id");
    expect(actions).not.toContain("input.fileId");
    expect(actions).not.toContain("input.tenantId");
    // …and the database re-checks both.
    expect(m).toContain("tracking reference tenant mismatch");
    expect(m).toContain("tracking reference dossier mismatch");
  });
});

// ═══════════════ 10/11/12 — the reference belongs to the MISSION ═══════════

describe("TMS-1C — tracking belongs to the mission, not the asset or the person", () => {
  it("the row is keyed to transport_id, uniquely", () => {
    expect(m).toContain("transport_id       uuid not null unique references public.transport_record (id)");
  });

  it("it carries no vehicle and no driver column at all", () => {
    const table = m.slice(m.indexOf("create table if not exists public.transport_tracking_reference"), m.indexOf("create index"));
    for (const forbidden of ["vehicle_id", "vehicle_plate", "driver_id", "driver_user_id", "driver_name"]) {
      expect(table, `${forbidden} must not exist — the same truck runs many missions`).not.toContain(forbidden);
    }
  });

  it("so the same vehicle tracked on two missions carries two references", () => {
    // Structural: uniqueness is per transport_id, so two missions of one
    // vehicle are two rows by construction. Proven live in the SQL suite.
    const sql = read("supabase/tests/tms_1c_mission_tracking_test.sql");
    expect(sql).toContain("same_vehicle_two_missions_two_references");
  });

  it("changing the driver rewrites nothing — no action touches the reference", () => {
    const driverActions = strip(read("lib/transport/actions.ts"));
    expect(driverActions).not.toContain("transport_tracking_reference");
  });
});

// ═══════════════ 13/14/15 — tracking is NOT workflow authority ═════════════

describe("TMS-1C — tracking never moves the mission", () => {
  it("no action writes transport status, POD, or any step", () => {
    for (const forbidden of [
      "transport_record\")\n    .update",
      "POD_RECEIVED", "DELIVERED", "pod_document_id",
      "process_step_execution", "submitStep", "sendHandoff",
    ]) {
      expect(actions, forbidden).not.toContain(forbidden);
    }
  });

  it("ending tracking is a bookkeeping act — it sets only its own columns", () => {
    const fn = actions.slice(actions.indexOf("export async function endMissionTracking"));
    const body = fn.slice(0, fn.indexOf("export async function", 10));
    expect(body).toContain("ended_by: user.id");
    expect(body).toContain("AuditActions.TRANSPORT_TRACKING_ENDED");
    expect(body).not.toContain("status");
  });

  it("the closure guard and the pickup gate never consult the reference", () => {
    expect(strip(read("lib/files/closure.ts"))).not.toContain("tracking_reference");
    expect(strip(read("lib/process/effitrans-process.ts"))).not.toContain("tracking_reference");
    expect(strip(read("lib/files/actions.ts"))).not.toContain("transport_tracking_reference");
  });

  it("delivery does not require tracking — the POD path is untouched", () => {
    const pod = strip(read("lib/transport/pod-receipt.ts"));
    expect(pod).not.toContain("tracking_reference");
    expect(pod).toContain("POD_RECEIVED");
  });

  it("the migration says so, so a later reader cannot mistake it", () => {
    expect(mRaw).toContain("NOT AUTHORITATIVE FOR WORKFLOW");
  });
});

// ═══════════════ 6/8/9/17 — the UI doorway ═════════════════════════════════

describe("TMS-1C — the link opens the provider, in a new tab, for staff only", () => {
  it("target=_blank with rel=noopener noreferrer and an accessible new-tab label", () => {
    expect(ui).toContain('target="_blank"');
    expect(ui).toContain('rel="noopener noreferrer"');
    expect(ui).toContain("ouvre le site du prestataire dans un nouvel onglet");
  });

  it("the anchor renders ONLY when a live reference exists", () => {
    expect(ui).toContain("canFollowLive(reference) && reference ?");
    expect(ui).toContain("TRACKING_STATE_LABEL_FR[state]");
  });

  it("the full URL exists only as the href — the page shows the host", () => {
    expect(ui).toContain("href={reference.trackingUrl}");
    expect(ui).toContain("trackingDisplayHost");
    // never rendered as text or a tooltip
    expect(ui).not.toContain("{reference.trackingUrl}<");
    expect(ui).not.toContain("title={reference.trackingUrl}");
  });

  it("the audit records the HOST, never a signed link", () => {
    expect(actions).toContain("host: hostOf(");
    expect(actions).not.toMatch(/tracking_url:\s*url\.url\s*,?\s*\}\s*\)\s*;?\s*$/m);
    const auditBlocks = actions.split("writeAudit(").slice(1);
    for (const b of auditBlocks) {
      expect(b.slice(0, 400), "no raw URL in an audit payload").not.toContain("trackingUrl");
    }
  });

  it("it renders IMMEDIATELY AFTER the Transport card — where a reviewer looks", () => {
    // The production UI audit found it two panels lower (after QC5Panel and
    // DriverAssign), which made it unfindable for anyone inspecting the
    // transport panel. Order is pinned so it cannot drift back.
    const iTransport = page.indexOf('<div id="transport"');
    const iTracking = page.indexOf('<div id="mission-tracking"');
    const iQc5 = page.indexOf("<QC5Panel");
    const iDriver = page.indexOf("<DriverAssign");
    for (const [name, i] of [["#transport", iTransport], ["#mission-tracking", iTracking],
                             ["QC5Panel", iQc5], ["DriverAssign", iDriver]] as const) {
      expect(i, `${name} not found`).toBeGreaterThan(-1);
    }
    expect(iTracking, "tracking must follow the Transport card").toBeGreaterThan(iTransport);
    expect(iTracking, "…and precede QC5Panel").toBeLessThan(iQc5);
    expect(iTracking, "…and precede DriverAssign").toBeLessThan(iDriver);
  });

  it("the neutral state does NOT require transport:assign", () => {
    // The section's render condition names transport:read and the mission —
    // never canManage — so a reader without dispatch authority still sees it.
    const block = page.slice(page.indexOf('<div id="mission-tracking"') - 200,
                             page.indexOf('<div id="mission-tracking"'));
    expect(block).toContain("canReadTransport && transportRecord");
    expect(block).not.toContain("canAssignDriver &&");
    // …and inside the component only the MANAGEMENT block is gated.
    const heading = ui.indexOf("Suivi en direct de la mission");
    const manage = ui.indexOf("{canManage && (");
    expect(heading).toBeGreaterThan(-1);
    expect(manage, "management is gated").toBeGreaterThan(heading);
    // The neutral sentence must not be CONDITIONED on canManage either — an
    // ordering check alone let a `canManage ? … : null` mutation survive.
    const start = ui.indexOf("canFollowLive(reference) && reference ?");
    expect(start).toBeGreaterThan(-1);
    const neutralBranch = ui.slice(ui.indexOf(") : (", start), ui.indexOf('state === "ENDED"'));
    expect(neutralBranch).toContain("TRACKING_STATE_LABEL_FR[state]");
    expect(neutralBranch, "the neutral state must render for a reader with no dispatch authority")
      .not.toContain("canManage");
    expect(ui.indexOf("TRACKING_STATE_LABEL_FR[state]")).toBeLessThan(manage);
  });

  it("management controls still require transport:assign", () => {
    expect(page).toContain("canManage={canAssignDriver}");
    expect(page).toContain('const canAssignDriver = hasPermission(permissions, "transport:assign")');
    expect(ui).toContain("{canManage && (");
  });

  it("the zero-row lookup stays maybeSingle — a missing reference is normal", () => {
    expect(service).toContain(".maybeSingle<Row>()");
    expect(service, "a .single() would throw on the neutral state").not.toContain(".single()");
    expect(service).toContain("if (!data) return null;");
  });

  it("it is gated on transport:read in the page, and management on transport:assign", () => {
    expect(page).toContain("canReadTransport && transportRecord && (");
    expect(page).toContain("<MissionTracking");
    expect(page).toContain("canManage={canAssignDriver}");   // transport:assign
  });

  it("management controls render only for an authorized actor", () => {
    expect(ui).toContain("{canManage && (");
  });

  it("no customer surface references the component or the URL — checked by walking the tree", () => {
    const roots = ["app/portal", "components/portal"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = fileURLToPath(new URL(`../${dir}`, import.meta.url));
      if (!existsSync(abs)) return; // directory absent: nothing to leak
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const src = read(rel);
        if (/MissionTracking|transport_tracking_reference|trackingUrl/.test(src)) offenders.push(rel);
      }
    };
    roots.forEach(walk);
    expect(offenders, "the customer portal must never reach the tracking link").toEqual([]);
    expect(trackingDisplayHost("https://tracker.example.sn/x")).toBe("tracker.example.sn");
  });
});

// ═══════════════ 16/18 — audit and isolation ═══════════════════════════════

describe("TMS-1C — every reference change is audited", () => {
  it("four distinct domain events exist", () => {
    expect(AuditActions.TRANSPORT_TRACKING_ATTACHED).toBe("transport.tracking_attached");
    expect(AuditActions.TRANSPORT_TRACKING_UPDATED).toBe("transport.tracking_updated");
    expect(AuditActions.TRANSPORT_TRACKING_ENDED).toBe("transport.tracking_ended");
    expect(AuditActions.TRANSPORT_TRACKING_REMOVED).toBe("transport.tracking_removed");
  });

  it("attach and update are distinguishable — the trail says which act happened", () => {
    expect(actions).toContain("AuditActions.TRANSPORT_TRACKING_ATTACHED");
    expect(actions).toContain("AuditActions.TRANSPORT_TRACKING_UPDATED");
    expect(actions).toContain("AuditActions.TRANSPORT_TRACKING_REMOVED");
  });

  it("each audit names the mission", () => {
    const blocks = actions.split("writeAudit(").slice(1);
    expect(blocks.length).toBe(4);
    for (const b of blocks) expect(b.slice(0, 300)).toContain("entityId: mission.id");
  });
});

describe("TMS-1C — the table is staff-only and holds no secrets", () => {
  it("no portal policy and no driver policy exist, and the migration asserts it", () => {
    expect(m).not.toContain("portal_can_read_file(file_id)");
    expect(m).toContain("a customer/driver clause reached the tracking reference policy");
  });

  it("no write policy — the actions are the boundary", () => {
    expect(m).toContain("must have NO write policy");
    expect(m).not.toMatch(/for\s+(insert|update|delete)\b/i);
  });

  it("no credential-shaped column, asserted by the migration itself", () => {
    expect(m).toContain("credential-shaped column(s) — secrets never live in operational tables");
    for (const bad of ["api_key", "secret", "token", "password"]) {
      expect(m.slice(m.indexOf("create table"), m.indexOf("create index")), bad).not.toContain(bad);
    }
  });

  it("the table is registered as tenant-scoped", () => {
    expect(read("lib/db/tenant-tables.ts")).toContain('"transport_tracking_reference"');
  });

  it("it is provider-neutral: no vendor is named anywhere", () => {
    for (const src of [m, pure, actions, service]) {
      for (const vendor of ["wialon", "geotab", "samsara", "traccar", "webfleet", "google.com/maps"]) {
        expect(src.toLowerCase(), vendor).not.toContain(vendor);
      }
    }
  });
});

// ═══════════════ 9 (brief §9) — service-scope compatibility ════════════════

describe("TMS-1C — nothing here blocks the coming service-scope model", () => {
  it("the reference hangs off the mission, so 'no transport contracted' means no mission and no reference", () => {
    expect(m).toContain("references public.transport_record (id) on delete cascade");
  });

  it("it introduces no assumption that every dossier is tracked", () => {
    expect(pure).toContain('"NOT_CONFIGURED"');
    // The neutral state is a first-class outcome, not an error path.
    expect(ui).toContain("TRACKING_STATE_LABEL_FR[state]");
  });
});

// ═══════════════ 19 — the SQL suite exists and CI runs it ══════════════════

describe("TMS-1C — real-Postgres coverage", () => {
  it("CI runs the suite, before the journey harness", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/tms_1c_mission_tracking_test.sql");
    expect(ci.indexOf("tms_1c_mission_tracking_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });
});
