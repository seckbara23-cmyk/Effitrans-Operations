/**
 * TMS-2 — chauffeur live mission tracking (the primary tracking architecture).
 * ---------------------------------------------------------------------------
 * The Effitrans flow: Transport assigns → the chauffeur drives → Effitrans
 * tracks from the driver's own phone → Transport watches → delivery → return to
 * base → tracking ends. No provider URL is typed anywhere in that sentence.
 *
 * What must never drift, and is pinned here:
 *   * tracking is TELEMETRY — it completes no pickup, no delivery, no POD, no
 *     process step, no Finance handoff and no closure;
 *   * mission ownership is DB-enforced (driver_user_id / is_assigned_driver),
 *     never UI trust;
 *   * the tracked driver cannot open the fleet-wide map;
 *   * the customer portal never sees a live position;
 *   * the return leg keeps tracking alive after delivery, and the vehicle stays
 *     engaged until it is back;
 *   * the map draws only positions that were actually recorded.
 *
 * Real-Postgres behaviour: supabase/tests/tms_2_driver_tracking_test.sql.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  missionLeg,
  MISSION_LEG_LABEL_FR,
  type TrackingSessionStatus,
} from "@/lib/tracking/types";
import { classifyTrackingHealth, DEFAULT_HEALTH_THRESHOLDS } from "@/lib/tracking/health";
import {
  shouldRecordPosition,
  validatePosition,
  classifyFreshness,
  filterNewByKey,
  DEFAULT_POSITION_THRESHOLDS,
} from "@/lib/tracking/position";
import { summarizeLiveMissions, type LiveMission } from "@/lib/tracking/live-model";
import { AuditActions } from "@/lib/audit/events";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260928000001_mission_return_leg.sql";
const mRaw = read(MIGRATION);
const m = strip(mRaw);
const driverActions = strip(read("lib/driver/actions.ts"));
const liveServiceRaw = read("lib/tracking/live-service.ts");
const liveService = strip(liveServiceRaw);
const tracker = read("components/driver/mission-tracker.tsx");
const mapUi = read("components/transport/live-map.tsx");
const livePage = read("app/transport/suivi/page.tsx");
const fleetService = read("lib/fleet/service.ts");

const fn = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const rest = src.slice(i);
  const next = rest.indexOf("export async function", 10);
  return next === -1 ? rest : rest.slice(0, next);
};

const mission = (over: Partial<LiveMission> = {}): LiveMission => ({
  transportId: "t1", fileId: "f1", fileNumber: "EFT-IMP-2026-00001",
  vehicleLabel: "AA460MV", driverName: "Mamadou Diop", transportStatus: "IN_TRANSIT",
  sessionStatus: "ACTIVE", leg: "OUTBOUND", health: "live",
  lastPosition: { lat: 14.7, lng: -17.45, at: "2026-09-03T10:00:00Z" },
  pickupLocation: "Port de Dakar", deliveryLocation: "Thiès",
  returnLocation: null, returnPoint: null, returnStartedAt: null,
  ...over,
});

// ═══════════ 1/2/3/15 — mission ownership is DB-enforced ═══════════════════

describe("TMS-2 — the chauffeur may track their OWN assigned mission, and only that", () => {
  it("startMission refuses anyone who is not the assigned driver", () => {
    const start = fn(driverActions, "startMission");
    expect(start).toContain('tr.driver_user_id !== user.id');
    expect(start).toContain('return { ok: false, error: "forbidden" }');
  });

  it("every session act resolves the session through the driver's own ownership", () => {
    for (const name of ["pauseTracking", "resumeTracking", "stopMission", "startReturnLeg"]) {
      const body = fn(driverActions, name);
      expect(body, name).toContain("loadOwnSession(supabase, user, sessionId)");
      expect(body, name).toContain('return { ok: false, error: "forbidden" }');
    }
  });

  it("ownership is enforced in the DATABASE too, not merely in an action", () => {
    // is_assigned_driver(transport) === driver_user_id = auth.uid(), used by
    // the tracking RLS policies that predate this slice.
    const create = read("supabase/migrations/20260710000002_create_tracking.sql");
    expect(create).toContain("is_assigned_driver");
    expect(create).toContain("driver_user_id = auth.uid()");
  });

  it("no action trusts a client-supplied tenant or driver identity", () => {
    expect(driverActions).not.toContain("input.tenantId");
    expect(driverActions).not.toContain("input.driverId");
    expect((driverActions.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════ 4/5/6/7 — capture, validation, dedup ═════════════════════════

describe("TMS-2 — position capture is real, validated and deduplicated", () => {
  it("the driver client uses device geolocation — no fabricated GPS", () => {
    expect(tracker).toContain("navigator.geolocation.watchPosition");
    expect(tracker).not.toMatch(/Math\.random|fakePosition|mockPosition/);
  });

  it("permission denial is a handled state, not a crash", () => {
    expect(tracker).toContain('"denied"');
    expect(tracker).toContain('"unsupported"');
    expect(tracker).toContain("permissionDenied");
  });

  it("invalid coordinates, future stamps and unusable accuracy are refused", () => {
    const now = new Date("2026-09-03T10:00:00Z");
    expect(validatePosition({ latitude: 0, longitude: 0, recordedAt: now.toISOString() }, now).ok).toBe(false);
    expect(validatePosition({ latitude: 91, longitude: 0, recordedAt: now.toISOString() }, now).ok).toBe(false);
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, recordedAt: "2026-09-03T10:30:00Z" }, now))
      .toEqual({ ok: false, reason: "future_timestamp" });
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, accuracyMeters: 5000, recordedAt: now.toISOString() }, now))
      .toEqual({ ok: false, reason: "poor_accuracy" });
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, accuracyMeters: 12, recordedAt: now.toISOString() }, now).ok).toBe(true);
  });

  it("repeated near-identical samples are dropped — the database is not flooded", () => {
    const prev = { latitude: 14.7, longitude: -17.45, recordedAt: "2026-09-03T10:00:00Z" };
    // 10 s later, 3 m away: below BOTH thresholds ⇒ not recorded.
    expect(shouldRecordPosition(prev, { latitude: 14.70002, longitude: -17.45, recordedAt: "2026-09-03T10:00:10Z" })).toBe(false);
    // enough time elapsed ⇒ recorded
    expect(shouldRecordPosition(prev, { latitude: 14.70002, longitude: -17.45, recordedAt: "2026-09-03T10:02:00Z" })).toBe(true);
    // barely any time, but moved far ⇒ recorded (granularity preserved)
    expect(shouldRecordPosition(prev, { latitude: 14.75, longitude: -17.45, recordedAt: "2026-09-03T10:00:10Z" })).toBe(true);
    expect(shouldRecordPosition(null, { latitude: 14.7, longitude: -17.45, recordedAt: "2026-09-03T10:00:00Z" })).toBe(true);
    expect(DEFAULT_POSITION_THRESHOLDS.minIntervalSeconds).toBe(60);
    expect(DEFAULT_POSITION_THRESHOLDS.minDistanceMeters).toBe(250);
  });

  it("the client applies the same batching rule before sending", () => {
    expect(tracker).toContain("shouldRecordPosition");
    expect(tracker).toContain("DEFAULT_POSITION_THRESHOLDS");
  });

  it("an offline replay never double-writes: idempotency keys are de-duplicated", () => {
    const seen = new Set<string>();
    const batch = [{ key: "a" }, { key: "b" }, { key: "a" }];
    expect(filterNewByKey(batch, seen).map((x) => x.key)).toEqual(["a", "b"]);
    expect(filterNewByKey([{ key: "a" }], seen)).toEqual([]);
  });

  it("connectivity loss is tolerated — a bounded queue flushes later", () => {
    expect(tracker).toContain("navigator.onLine");
    expect(tracker).toContain("flush(");
  });
});

// ═══════════ 7/11/12/13 — the round trip ══════════════════════════════════

describe("TMS-2 — tracking does not stop at delivery", () => {
  it("RETURNING exists in the session vocabulary, in code and in the database", () => {
    const statuses: TrackingSessionStatus[] = ["ACTIVE", "PAUSED", "RETURNING", "COMPLETED", "CANCELLED"];
    expect(statuses).toContain("RETURNING");
    expect(m).toContain("check (status in ('ACTIVE', 'PAUSED', 'RETURNING', 'COMPLETED', 'CANCELLED'))");
  });

  it("the leg is derived from the session alone — no workflow state is read", () => {
    expect(missionLeg(null)).toBe("NOT_STARTED");
    expect(missionLeg("ACTIVE")).toBe("OUTBOUND");
    expect(missionLeg("PAUSED")).toBe("OUTBOUND");
    expect(missionLeg("RETURNING")).toBe("RETURN");
    expect(missionLeg("COMPLETED")).toBe("ENDED");
    expect(missionLeg("CANCELLED")).toBe("NOT_STARTED");
    expect(MISSION_LEG_LABEL_FR.RETURN).toBe("Retour base");
  });

  it("a DELIVERED mission may still be tracking — the two are independent", () => {
    const m1 = mission({ transportStatus: "DELIVERED", sessionStatus: "RETURNING", leg: "RETURN" });
    expect(m1.leg).toBe("RETURN");
    expect(classifyTrackingHealth({ sessionStatus: "RETURNING", lastPositionAt: "2026-09-03T10:00:00Z", now: new Date("2026-09-03T10:01:00Z") })).toBe("live");
  });

  it("the return leg keeps transmitting: the client keeps its watch open", () => {
    expect(tracker).toContain('(status === "ACTIVE" || status === "RETURNING")');
    expect(tracker).toContain("Démarrer le retour vers la base");
    expect(tracker).toContain("Arrivé à la base — terminer le suivi");
  });

  it("the round trip ends FROM the return leg", () => {
    const stop = fn(driverActions, "stopMission");
    expect(stop).toContain('s.status !== "RETURNING"');
    expect(stop).toContain('status: "COMPLETED"');
  });

  it("only an outbound session turns around — no resurrection", () => {
    const ret = fn(driverActions, "startReturnLeg");
    expect(ret).toContain('s.status !== "ACTIVE" && s.status !== "PAUSED"');
    expect(ret).toContain('return { ok: false, error: "invalid_state" }');
  });
});

// ═══════════ 14 — tracking is NOT workflow authority ══════════════════════

describe("TMS-2 — GPS completes nothing", () => {
  it("no driver session act WRITES transport state, a step, a POD or closure", () => {
    // The rule is about WRITES. Reading transport status is legitimate and in
    // fact protective — tracking refuses to start on a CANCELLED or
    // POD_RECEIVED mission — so a crude substring ban would have failed for
    // exactly the wrong reason. Every transport_record chain must be a read.
    const chains = driverActions.split('from("transport_record")').slice(1);
    expect(chains.length, "the driver lane does touch transport_record").toBeGreaterThan(0);
    for (const c of chains) {
      // Bound to THIS statement: a 400-char window runs into the next one,
      // which legitimately updates tracking_session.
      const head = c.slice(0, c.indexOf(";") + 1);
      expect(head, "transport_record must only be READ here").not.toMatch(/[.](update|insert|delete|upsert)[(]/);
      expect(head).toContain(".select(");
    }
    for (const forbidden of [
      "pod_document_id", "process_step_execution", "submitStep",
      "sendHandoff", "transitionFile", "closureBlockers",
    ]) {
      expect(driverActions, forbidden).not.toContain(forbidden);
    }
  });

  it("reading the mission's terminal state is what STOPS tracking, not starts it", () => {
    const start = fn(driverActions, "startMission");
    expect(start).toContain('tr.status === "CANCELLED" || tr.status === "POD_RECEIVED"');
    expect(start).toContain('return { ok: false, error: "invalid_state" }');
  });

  it("declaring the return leg touches only the session's own columns", () => {
    const ret = fn(driverActions, "startReturnLeg");
    expect(ret).toContain('status: "RETURNING"');
    expect(ret).toContain("return_started_at");
    expect(ret).not.toContain("transport_record");
  });

  it("the live map read model never writes anything", () => {
    for (const forbidden of [".update(", ".insert(", ".delete(", ".upsert("]) {
      expect(liveService, forbidden).not.toContain(forbidden);
    }
  });

  it("the closure guard and the process registry never consult tracking", () => {
    expect(strip(read("lib/files/closure.ts"))).not.toContain("tracking_session");
    expect(strip(read("lib/process/effitrans-process.ts"))).not.toContain("tracking_session");
  });

  it("the migration says so, and grants nothing", () => {
    expect(mRaw).toContain("NON-AUTHORITATIVE");
    expect(m).not.toMatch(/^\s*grant\s/im);
    expect(m).toContain("an invented tracking permission exists");
  });

  it("the operator is told, on the page, that GPS decides nothing", () => {
    expect(livePage).toContain("Il ne déclenche jamais un enlèvement, une");
    expect(livePage).toContain("clôture de dossier");
  });
});

// ═══════════ 8/9/16 — live map authorization and content ══════════════════

describe("TMS-2 — the fleet map is Transport's, not the driver's", () => {
  it("the map is gated on transport:read, which DRIVER does not hold", () => {
    expect(liveService).toContain('assertPermission("transport:read")');
    expect(liveService).not.toContain('assertPermission("tracking:read")');
    expect(livePage).toContain('hasPermission(permissions, "transport:read")');
  });

  it("no new role or permission was invented for TMS-2", () => {
    expect(liveService).not.toMatch(/tracking:map|driver:track|tracking:driver/);
    expect(m).toContain("'tracking:driver', 'driver:track', 'tracking:map'");
  });

  it("EVERY query in the read model is tenant-scoped — counting is not enough", () => {
    // A count-based assertion survived a probe that removed one filter, because
    // enough others remained. The rule is per-query: each .from() chain must
    // carry the tenant predicate.
    const chains = liveService.split(".from(").slice(1);
    expect(chains.length, "the read model does query").toBeGreaterThan(0);
    for (const c of chains) {
      // Split at .from() already ends each segment where the NEXT query
      // begins, so a segment carries its own filter and no other's. A `;`
      // bound would be empty inside Promise.all, where statements end in ",".
      const stmt = c.slice(0, 400);
      expect(stmt, `untenanted query: ${c.slice(0, 40)}`).toContain('.eq("tenant_id", user.tenantId)');
    }
  });

  it("the map shows mission, vehicle, driver, leg, freshness and the dossier link", () => {
    for (const field of ["fileNumber", "vehicleLabel", "driverName", "leg", "health", "lastPosition"]) {
      expect(liveService, field).toContain(field);
    }
    expect(livePage).toContain("Ouvrir la mission");
    expect(mapUi).toContain("MISSION_LEG_LABEL_FR");
  });

  it("only OBSERVED geometry is drawn — no interpolation, no road snapping", () => {
    expect(mapUi).toContain("ONLY OBSERVED GEOMETRY IS DRAWN");
    expect(mapUi).toContain("Aucun trajet n&apos;est");
    expect(liveServiceRaw).toContain("no interpolation");
    const route = fn(liveService, "getObservedRoute");
    expect(route).toContain('.order("recorded_at", { ascending: true })');
  });

  it("a mission with no fix has no marker, and the map says so instead", () => {
    expect(mapUi).toContain("m.lastPosition != null");
    expect(mapUi).toContain("Aucune position enregistrée");
  });

  it("the map uses the stack already present — no paid vendor, no key", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.leaflet, "leaflet already present").toBeTruthy();
    expect(deps["react-leaflet"]).toBeTruthy();
    expect(mapUi).toContain("openstreetmap.org");
    expect(mapUi).not.toMatch(/api[_-]?key|accessToken|mapbox|VITE_|process\.env/i);
  });
});

// ═══════════ 10 — KPIs, never fabricated ══════════════════════════════════

describe("TMS-2 — KPIs count what exists and nothing else", () => {
  it("an empty fleet yields zeros, not invented activity", () => {
    expect(summarizeLiveMissions([], 0)).toEqual({
      tracked: 0, outbound: 0, returning: 0, staleOrOffline: 0, endedToday: 0,
    });
  });

  it("legs and signal health are counted from the real rows", () => {
    const k = summarizeLiveMissions([
      mission({ leg: "OUTBOUND", health: "live" }),
      mission({ transportId: "t2", leg: "RETURN", health: "stale" }),
      mission({ transportId: "t3", leg: "RETURN", health: "offline" }),
    ], 4);
    expect(k).toEqual({ tracked: 3, outbound: 1, returning: 2, staleOrOffline: 2, endedToday: 4 });
  });
});

// ═══════════ 12/17/18 — freshness, never claiming live ════════════════════

describe("TMS-2 — stale telemetry is never shown as live", () => {
  it("health degrades live → stale → offline with the documented thresholds", () => {
    const base = new Date("2026-09-03T12:00:00Z");
    const at = (secAgo: number) => new Date(base.getTime() - secAgo * 1000).toISOString();
    const h = (secAgo: number) => classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: at(secAgo), now: base });
    expect(h(60)).toBe("live");
    expect(h(600)).toBe("stale");
    expect(h(4000)).toBe("offline");
    expect(DEFAULT_HEALTH_THRESHOLDS).toEqual({ liveSeconds: 180, offlineSeconds: 900 });
  });

  it("an active session with no fix at all is offline, not live", () => {
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: null, now: new Date() })).toBe("offline");
  });

  it("a returning mission is classified by age too — not assumed live", () => {
    const base = new Date("2026-09-03T12:00:00Z");
    expect(classifyTrackingHealth({
      sessionStatus: "RETURNING",
      lastPositionAt: new Date(base.getTime() - 4000 * 1000).toISOString(),
      now: base,
    })).toBe("offline");
  });

  it("freshness has its own documented defaults for display", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    expect(classifyFreshness(null, now)).toBe("none");
    expect(classifyFreshness(new Date(now.getTime() - 60_000).toISOString(), now)).toBe("live");
    expect(classifyFreshness(new Date(now.getTime() - 600_000).toISOString(), now)).toBe("recent");
    expect(classifyFreshness(new Date(now.getTime() - 4_000_000).toISOString(), now)).toBe("stale");
  });

  it("every freshness state has operator wording, and « en direct » is only for live", () => {
    for (const s of ["live", "stale", "offline", "paused", "completed", "not_started"]) {
      expect(livePage, s).toContain(`${s}:`);
    }
    expect(livePage).toContain('label: "En direct"');
    expect(livePage).toContain('label: "Signal ancien"');
    expect(livePage).toContain('label: "Signal perdu"');
  });
});

// ═══════════ 13 — privacy ═════════════════════════════════════════════════

describe("TMS-2 — mission tracking, not employee surveillance", () => {
  it("a session exists only for a mission: sessions without one are dropped", () => {
    expect(liveService).toContain("filter((s) => s.transport_id)");
    // …and the fleet's return-leg engagement query says the same in SQL.
    expect(fleetService).toContain('.not("transport_id", "is", null)');
    const start = fn(driverActions, "startMission");
    expect(start).toContain("transport_id");
  });

  it("the live model never queries employees or people directly", () => {
    for (const forbidden of ["employee", "hr_", "app_user\")"]) {
      expect(liveService, forbidden).not.toContain(forbidden);
    }
  });

  it("no customer surface reaches live positions or the map", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = fileURLToPath(new URL(`../${dir}`, import.meta.url));
      if (!existsSync(abs)) return;
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (/TransportLiveMap|listLiveMissions|getObservedRoute|startReturnLeg/.test(read(rel))) offenders.push(rel);
      }
    };
    ["app/portal", "components/portal"].forEach(walk);
    expect(offenders, "the customer portal must never reach live tracking").toEqual([]);
  });

  it("the portal's own position policy still requires an explicit customer_visible flag", () => {
    const create = read("supabase/migrations/20260710000002_create_tracking.sql");
    expect(create).toContain("customer_visible = true");
  });
});

// ═══════════ 21 — audit events, without flooding ══════════════════════════

describe("TMS-2 — meaningful events are audited; coordinates are not", () => {
  it("the session lifecycle has distinct events, including the return leg", () => {
    expect(AuditActions.TRACKING_SESSION_STARTED).toBe("tracking.session.started");
    expect(AuditActions.TRACKING_SESSION_RETURN_STARTED).toBe("tracking.session.return_started");
    expect(AuditActions.TRACKING_SESSION_COMPLETED).toBe("tracking.session.completed");
    expect(AuditActions.TRACKING_SESSION_PAUSED).toBe("tracking.session.paused");
  });

  it("the return act is audited with its before/after status", () => {
    const ret = fn(driverActions, "startReturnLeg");
    expect(ret).toContain("AuditActions.TRACKING_SESSION_RETURN_STARTED");
    expect(ret).toContain("before: { status: s.status }");
  });

  it("the ingest audits BATCH ACCEPTANCE, never one row per coordinate", () => {
    const ingest = strip(read("app/api/driver/positions/route.ts"));
    // Exactly one audit call for a whole batch, carrying the batch action —
    // the coordinates themselves live in tracking_position.
    expect((ingest.match(/writeAudit[(]/g) || []).length).toBe(1);
    expect(ingest).toContain("TRACKING_BATCH_RECEIVED");
    expect(ingest).not.toContain("TRACKING_POSITION_MANUAL_RECORDED");
  });
});

// ═══════════ 22 — fleet availability during the return leg ════════════════

describe("TMS-2 — a vehicle driving back is not available", () => {
  it("engagement gains a second source: a still-open tracking session", () => {
    expect(fleetService).toContain("OPEN_TRACKING_SESSION_STATUSES");
    expect(fleetService).toContain('["ACTIVE", "PAUSED", "RETURNING"]');
    expect(fleetService).toContain('.from("tracking_session")');
  });

  it("the shared ENGAGED_TRANSPORT_STATUSES contract was NOT widened", () => {
    // Migration 132's retirement guard names the same four; widening this list
    // would silently change who may be retired mid-mission.
    const list = /ENGAGED_TRANSPORT_STATUSES = \[\s*([^\]]+)\]/.exec(fleetService)![1];
    const parsed = list.split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
    expect(parsed).toEqual(["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT"]);
    expect(fleetService).toContain("THIS LIST IS A SHARED CONTRACT");
  });

  it("a dossier named by both sources is listed once", () => {
    expect(fleetService).toContain("!list.includes(r.file.file_number)");
  });
});

// ═══════════ 18/20/24 — TMS-1C demoted, not deleted ═══════════════════════

describe("TMS-2 — the external provider link survives as an optional fallback", () => {
  it("migration 135 and its table are untouched", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
    expect(migrations).toContain("20260927000001_transport_tracking_reference.sql");
    expect(read("supabase/migrations/20260927000001_transport_tracking_reference.sql"))
      .toContain("create table if not exists public.transport_tracking_reference");
  });

  it("its security properties are intact: still staff-only, still no write policy", () => {
    const m135 = read("supabase/migrations/20260927000001_transport_tracking_reference.sql");
    expect(m135).toContain("public.has_permission('transport:read')");
    expect(m135).toContain("must have NO write policy");
    expect(m135).toContain("a customer/driver clause reached the tracking reference policy");
  });

  it("the panel is demoted to a collapsed optional disclosure", () => {
    const ui = read("components/transport/mission-tracking.tsx");
    expect(ui).toContain("<details");
    expect(ui).toContain("Suivi externe (optionnel)");
    expect(ui).toContain("DEMOTED, NOT DELETED");
  });

  it("the driver flow requires NO provider field at all", () => {
    for (const forbidden of ["provider", "tracking_url", "externalReference"]) {
      expect(driverActions, forbidden).not.toContain(forbidden);
      expect(tracker, forbidden).not.toContain(forbidden);
    }
  });
});

// ═══════════ 17/23 — scope compatibility & slice discipline ═══════════════

describe("TMS-2 — compatible with the coming service-scope model", () => {
  it("tracking hangs off the MISSION, so 'no transport contracted' means no tracking", () => {
    expect(liveService).toContain("transport_id");
    expect(m).toContain("the return point belongs to the mission");
  });

  it("the return point is optional and NEVER inferred from pickup", () => {
    expect(mRaw.replace(/\n--\s*/g, " ")).toContain("Nothing is inferred from pickup_location");
    expect(m).toContain("return_location  text");
    const liveFn = fn(liveService, "listLiveMissions");
    expect(liveFn).not.toContain("?? m.pickup_location");
  });

  it("the return point lives on the mission, not on the vehicle", () => {
    expect(m).toContain("a return point reached the VEHICLE");
  });

  it("00009's workflow logic is untouched: no dossier is named anywhere", () => {
    for (const f of [m, driverActions, liveService, mapUi, livePage]) {
      expect(f).not.toMatch(/EFT-IMP-2026-00009|00009/);
    }
  });

  it("the SQL suite exists and CI runs it before the journey harness", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/tms_2_driver_tracking_test.sql");
    expect(ci.indexOf("tms_2_driver_tracking_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
  });
});
