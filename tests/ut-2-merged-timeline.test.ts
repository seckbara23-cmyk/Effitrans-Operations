/**
 * UT-2 — merged two-plane Unified Timeline read model.
 *
 * The load-bearing claim is again a negative one: **no cross-plane chronology is
 * invented.** Most of what follows tests the instant where two facts cannot be
 * ordered, because that is where a timeline is tempted to guess.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  compareUnified, assignChronology, truncateAtGroupBoundary, toClientSafe,
  fromDecisionEntry, encodeUnifiedCursor, decodeUnifiedCursor, isBeforeUnifiedCursor,
  CLIENT_SAFE_OBSERVATIONS, PLANES, CONFIDENCE, type UnifiedEntry,
} from "@/lib/unified-timeline/merged";
import type { TimelineEntry } from "@/lib/unified-timeline/contract";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MERGED = "lib/unified-timeline/merged.ts";
const OBS = "lib/unified-timeline/observation-plane.ts";
const UNI = "lib/unified-timeline/unified.ts";

function entry(p: Partial<UnifiedEntry> & { entryId: string; occurredAt: string }): UnifiedEntry {
  return {
    tenantId: "t1", dossierId: "d1", subjectType: "operational_file", subjectId: "d1",
    plane: "decision", nature: "decision", origin: "system", eventType: "X",
    ordinal: null, observationSource: null, confidence: null, freshness: null,
    label: "X", summary: {}, locationName: null, domain: null,
    actorId: null, actorName: null, chronologyGroup: "", chronologyProvable: false,
    clientSafe: false, paginationToken: "", ...p,
  };
}
const A = (id: string, t: string, ord: number | null) =>
  entry({ entryId: `A:${id}`, occurredAt: t, ordinal: ord, plane: "decision" });
const B = (id: string, t: string) =>
  entry({ entryId: `B:${id}`, occurredAt: t, plane: "observation", nature: "observation", origin: "external" });

// ---------------------------------------------------------------------------
describe("single-plane behaviour is preserved", () => {
  it("Plane A only: ordinals order same-instant events, and each is provable", () => {
    const out = assignChronology([A("2", "T", 7), A("1", "T", 5)]);
    expect(out.map((e) => e.entryId)).toEqual(["A:1", "A:2"]);
    expect(out.every((e) => e.chronologyProvable)).toBe(true);
    expect(new Set(out.map((e) => e.chronologyGroup)).size).toBe(2);
  });

  it("Plane B only: ordered by observation time, each alone at its instant", () => {
    const out = assignChronology([B("2", "2026-01-02T00:00:00Z"), B("1", "2026-01-01T00:00:00Z")]);
    expect(out.map((e) => e.entryId)).toEqual(["B:1", "B:2"]);
    expect(out.every((e) => e.chronologyProvable)).toBe(true);
  });

  it("Plane A historical NULL ordinals at one instant stay an unordered group", () => {
    const out = assignChronology([A("1", "T", null), A("2", "T", null)]);
    expect(new Set(out.map((e) => e.chronologyGroup)).size).toBe(1);
    expect(out.every((e) => !e.chronologyProvable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("merged ordering never invents chronology", () => {
  it("earlier occurred_at always comes first, whatever the planes", () => {
    const out = assignChronology([B("x", "2026-01-03T00:00:00Z"), A("y", "2026-01-01T00:00:00Z", 9)]);
    expect(out.map((e) => e.entryId)).toEqual(["A:y", "B:x"]);
  });

  it("same-instant Decision and Observation form ONE unordered group", () => {
    const out = assignChronology([A("1", "T", 5), B("1", "T")]);
    expect(new Set(out.map((e) => e.chronologyGroup)).size).toBe(1);
    expect(out.every((e) => !e.chronologyProvable)).toBe(true);
  });

  it("an ordinal does NOT rescue provability once an observation shares the instant", () => {
    // A1 and A2 are provably ordered relative to each other, but neither is
    // provably ordered against B — so the whole instant is one group.
    const out = assignChronology([A("1", "T", 5), A("2", "T", 6), B("1", "T")]);
    expect(new Set(out.map((e) => e.chronologyGroup)).size).toBe(1);
    expect(out.every((e) => !e.chronologyProvable)).toBe(true);
  });

  it("has NO fixed plane precedence — the comparator never reads `plane` to break a tie", () => {
    // Swapping which plane owns the lexically-smaller id flips the order, which
    // it could not do if a plane always won.
    const first = compareUnified(A("a", "T", null), B("b", "T"));
    const second = compareUnified(A("z", "T", null), B("b", "T"));
    expect(first).toBeLessThan(0);
    expect(second).toBeGreaterThan(0);
  });

  it("received_at appears in no ordering path anywhere in the module", () => {
    for (const f of [MERGED, OBS, UNI]) {
      const src = code(f);
      expect(src, f).not.toMatch(/received_at/);
    }
  });

  it("Plane B is never given an ordinal", () => {
    const src = code(OBS);
    const assigned = [...src.matchAll(/ordinal:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
    expect(assigned.length).toBeGreaterThan(0);
    expect([...new Set(assigned)]).toEqual(["null"]);
  });

  it("is deterministic: the same set always yields the same order", () => {
    const set = [A("1", "T", 5), B("2", "T"), A("3", "S", null)];
    const a = assignChronology(set).map((e) => e.entryId);
    const b = assignChronology([...set].reverse()).map((e) => e.entryId);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
describe("confidence and provenance", () => {
  it("carries the four grades verbatim and never fabricates one", () => {
    const src = code(OBS);
    // The unrecognised case maps to null, not to a plausible default.
    expect(src).toMatch(/CONFIDENCE as readonly string\[\]\)\.includes\(r\.confidence\)/);
    expect(src).toMatch(/:\s*null;/);
    expect(src).not.toMatch(/confidence.*\?\?\s*"CONFIRMED"|confidence:\s*"CONFIRMED"/);
    expect([...CONFIDENCE]).toEqual(["CONFIRMED", "INFERRED", "MANUAL", "ESTIMATED"]);
  });

  it("classifies observation origin from the source, without inventing an actor", () => {
    const src = code(OBS);
    expect(src).toMatch(/nature: "observation"/);
    expect(src).toMatch(/r\.source === "MANUAL" \? "human" : r\.source === "SYSTEM" \? "system" : "external"/);
    expect(src).toMatch(/actorId: null/);
  });

  it("only the two planes exist — audit is not one of them", () => {
    expect([...PLANES]).toEqual(["decision", "observation"]);
  });
});

// ---------------------------------------------------------------------------
describe("pagination", () => {
  const grouped = (n: number, group: string) =>
    Array.from({ length: n }, (_, i) => ({ entryId: `${group}${i}`, chronologyGroup: group }));

  it("never splits a chronology group across a page boundary", () => {
    const rows = [...grouped(2, "g1"), ...grouped(3, "g2"), ...grouped(1, "g3")];
    const { page, hasMore } = truncateAtGroupBoundary(rows, 4);
    // 4 would cut g2 in half; the page stops at the end of g1 instead.
    expect(page).toHaveLength(2);
    expect(page.every((e) => e.chronologyGroup === "g1")).toBe(true);
    expect(hasMore).toBe(true);
  });

  it("returns an oversized first group whole rather than lying about it", () => {
    const rows = [...grouped(5, "big"), ...grouped(1, "next")];
    const { page, hasMore } = truncateAtGroupBoundary(rows, 2);
    expect(page).toHaveLength(5);
    expect(hasMore).toBe(true);
  });

  it("returns everything when it fits", () => {
    const rows = grouped(3, "g1");
    expect(truncateAtGroupBoundary(rows, 10)).toEqual({ page: rows, hasMore: false });
  });

  it("the cursor carries no plane and no ordinal — it is a position, not a sequence", () => {
    const c = { occurredAt: "T", entryId: "A:1" };
    expect(decodeUnifiedCursor(encodeUnifiedCursor(c))).toEqual(c);
    expect(Object.keys(c)).toEqual(["occurredAt", "entryId"]);
  });

  it("rejects a malformed cursor rather than guessing", () => {
    expect(decodeUnifiedCursor("!!not-base64")).toBeNull();
    expect(decodeUnifiedCursor(Buffer.from("[1,2]").toString("base64url"))).toBeNull();
  });

  it("is stable and strict — the cursor row is never returned twice", () => {
    const cur = { occurredAt: "T", entryId: "m" };
    expect(isBeforeUnifiedCursor({ occurredAt: "T", entryId: "a" }, cur)).toBe(true);
    expect(isBeforeUnifiedCursor({ occurredAt: "T", entryId: "m" }, cur)).toBe(false);
    expect(isBeforeUnifiedCursor({ occurredAt: "S", entryId: "z" }, cur)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("client-safe projection", () => {
  const decisionEntry = (t: string, safe: boolean) =>
    fromDecisionEntry(
      {
        eventId: "e1", tenantId: "t1", dossierId: "d1", subjectType: "operational_file",
        subjectId: "d1", eventType: t, domain: "dossier", eventVersion: 1,
        occurredAt: "T", ordinal: 1, actorId: "u1", actorName: "Alice",
        labelFr: "L", provenance: { nature: "decision", origin: "human", confidence: null },
        metadata: { file_number: "EFT-1", internal_key: "x" },
        orderingGroup: "", chronologyProvable: true,
      } as TimelineEntry,
      safe,
    );

  it("is an ALLOW-LIST: an unclassified entry is omitted, not disclosed", () => {
    expect(toClientSafe([decisionEntry("SOMETHING_NEW", false)])).toHaveLength(0);
    expect(toClientSafe([decisionEntry("DOSSIER_OPENED", true)])).toHaveLength(1);
  });

  it("strips actor identity, source, confidence and freshness", () => {
    const [out] = toClientSafe([
      entry({ entryId: "B:1", occurredAt: "T", plane: "observation", clientSafe: true,
        actorId: "u1", actorName: "Alice", observationSource: "AIS",
        confidence: "ESTIMATED", freshness: "STALE" }),
    ]);
    expect(out.actorId).toBeNull();
    expect(out.actorName).toBeNull();
    expect(out.observationSource).toBeNull();
    expect(out.confidence).toBeNull();
    expect(out.freshness).toBeNull();
  });

  it("keeps only a short allow-list of summary keys", () => {
    const [out] = toClientSafe([decisionEntry("DOSSIER_OPENED", true)]);
    expect(out.summary).toEqual({ file_number: "EFT-1" });
    expect(out.summary.internal_key).toBeUndefined();
  });

  it("preserves chronology and grouping truthfully", () => {
    const rows = assignChronology([A("1", "T", 5), B("1", "T")]).map((e) => ({ ...e, clientSafe: true }));
    const out = toClientSafe(rows);
    expect(out.every((e) => !e.chronologyProvable)).toBe(true);
    expect(new Set(out.map((e) => e.chronologyGroup)).size).toBe(1);
  });

  it("excludes EXCEPTION and all telemetry from the observation allow-list", () => {
    const list = [...CLIENT_SAFE_OBSERVATIONS] as string[];
    for (const t of ["EXCEPTION", "POSITION_UPDATE", "ETA_UPDATE", "CANCELLED"]) {
      expect(list, t).not.toContain(t);
    }
  });

  it("is built but NOT exposed: no portal route or permission consumes it", () => {
    const consumers = ["app", "components"].flatMap((d) => {
      const dir = join(root, d);
      return existsSync(dir) ? [] : [];
    });
    expect(consumers).toEqual([]);
    // Nothing in the portal imports the unified reader.
    for (const f of ["lib/portal/service.ts"]) {
      if (existsSync(join(root, f))) expect(code(f)).not.toMatch(/unified-timeline/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("boundaries and safety", () => {
  it("the merged reader never touches audit_log", () => {
    for (const f of [MERGED, OBS, UNI]) expect(code(f), f).not.toMatch(/audit_log/);
  });

  it("nothing is written, anywhere in lib/unified-timeline", () => {
    for (const f of readdirSync(join(root, "lib", "unified-timeline"))) {
      const src = code(join("lib", "unified-timeline", f));
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src, f).not.toMatch(/\.rpc\(/);
    }
  });

  it("no observation is copied into business_event, and no store is created", () => {
    const src = code(OBS);
    expect(src).not.toMatch(/business_event/);
    expect(src).not.toMatch(/create table|emit_business_event/);
  });

  it("reads only the approved source tables", () => {
    const src = code(OBS);
    const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
    // `tracking_event` joined at UT3-ROAD (Option C, ratified). Four sources, no more.
    expect([...new Set(tables)]).toEqual([
      "air_tracking_event", "ocean_tracking_event", "shipment", "tracking_event",
    ]);
  });

  it("gates dossier visibility BEFORE the admin client is touched", () => {
    const src = code(OBS);
    const gate = src.indexOf("isFileVisible");
    const client = src.indexOf("getAdminSupabaseClient()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(client);
  });

  it("attributes observations structurally — no heuristic matching", () => {
    const src = code(OBS);
    expect(src).toMatch(/\.eq\("file_id", q\.dossierId\)/);
    expect(src).not.toMatch(/ilike|client_name|from_address|sender|fuzzy|match\(/i);
  });

  it("re-scopes every merged entry to the requested dossier and the caller's tenant", () => {
    const src = code(UNI);
    expect(src).toMatch(/e\.dossierId === query\.dossierId && e\.tenantId === user\.tenantId/);
  });

  it("excludes telemetry from the timeline entirely (DEC-B88 §4)", () => {
    const src = code(OBS);
    expect(src).toMatch(/TELEMETRY = new Set\(\["POSITION_UPDATE", "ETA_UPDATE"\]\)/);
    expect(src).toMatch(/!TELEMETRY\.has\(r\.event_type\)/);
  });

  it("carries no free text, coordinates or money out of the observation store", () => {
    const src = code(OBS);
    // `description`, latitude and longitude are never selected or projected.
    expect(src).not.toMatch(/description/);
    expect(src).not.toMatch(/latitude|longitude/);
    expect(src).not.toMatch(/amount|price|currency|total/i);
  });

  it("SYSTEM_ADMIN gains nothing: no permission is referenced or minted", () => {
    for (const f of [MERGED, OBS, UNI]) {
      expect(code(f), f).not.toMatch(/SYSTEM_ADMIN|assertPermission|has_permission/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("UT3-ROAD (Option C) — road joins the Observation Plane", () => {
  it("reads the road store, attributed DIRECTLY by file_id (no shipment hop)", () => {
    const src = code(OBS);
    expect(src).toMatch(/\.from\("tracking_event"\)/);
    expect(src).toMatch(/\.eq\("file_id", q\.dossierId\)/);
  });

  it("carries confidence = null, ALWAYS — no grade is invented", () => {
    const src = code(OBS);
    const road = src.slice(src.indexOf("function roadToUnified"));
    expect(road).toMatch(/confidence: null/);
    // No mapping table turns a road source into a confidence grade.
    expect(road).not.toMatch(/CONFIRMED|INFERRED|ESTIMATED/);
  });

  it("maps source to freshness thresholds ONLY — never to confidence", () => {
    const src = code(OBS);
    // The mapping table's values are freshness sources, not confidence grades.
    const table = src.slice(src.indexOf("ROAD_FRESHNESS_SOURCE"), src.indexOf("function roadOrigin"));
    for (const g of ["CONFIRMED", "INFERRED", "ESTIMATED"]) expect(table).not.toContain(g);
    expect(table).toMatch(/MANUAL|ROAD|CARRIER/);
  });

  it("preserves provenance on the frozen origin axis", () => {
    const src = code(OBS);
    expect(src).toMatch(/manual" \|\| source === "driver_mobile"\) return "human"/);
    expect(src).toMatch(/vehicle_gps"\) return "system"/);
    expect(src).toMatch(/return "external"/);
  });

  it("admits milestones only — geofence, session and prose types excluded", () => {
    const src = code(OBS);
    const list = src.slice(src.indexOf("ROAD_MILESTONES"), src.indexOf("ROAD_CLIENT_SAFE"));
    for (const t of ["ARRIVED_NEAR_PICKUP", "ARRIVED_NEAR_DESTINATION", "TRACKING_STARTED",
                     "TRACKING_STOPPED", "CHECKPOINT_REACHED", "DELAY_REPORTED", "INCIDENT_REPORTED"]) {
      expect(list, t).not.toContain(t);
    }
    expect(list).toContain("DELIVERED");
  });

  it("narrows the store's own customer flag, never widens it", () => {
    const src = code(OBS);
    expect(src).toMatch(/ROAD_CLIENT_SAFE\.has\(r\.type\) && r\.customer_visible === true/);
  });

  it("never selects the road store's free text or coordinates", () => {
    const src = code(OBS);
    expect(src).not.toMatch(/customer_message|internal_note/);
    expect(src).not.toMatch(/latitude|longitude/);
  });

  it("a dossier with road legs but no shipment is not silenced", () => {
    const src = code(OBS);
    // The shipment lookup gates ocean/air only.
    expect(src).not.toMatch(/if \(!shipment\?\.id\) return \[\];/);
    expect(src).toMatch(/shipment\?\.id[\s\S]{0,40}\? await Promise\.all/);
  });

  it("road stays an OBSERVATION — nothing reaches business_event", () => {
    const src = code(OBS);
    expect(src).not.toMatch(/business_event|emit_business_event/);
    const road = src.slice(src.indexOf("function roadToUnified"));
    expect(road).toMatch(/plane: "observation"/);
    expect(road).toMatch(/ordinal: null/);
  });
});

// ---------------------------------------------------------------------------
describe("UT-3B emitters remain UNIMPLEMENTED (migration blocked)", () => {
  it("all nine reserved types still have no emitter", () => {
    const src = code("lib/workflow/events/types.ts");
    const reserved = [...src.matchAll(/emission: "reserved"/g)];
    expect(reserved).toHaveLength(9);
  });

  it("the two acts-that-do-not-exist stay reserved by name", () => {
    const src = read("lib/workflow/events/types.ts");
    for (const t of ["ADMIN_OVERRIDE_EXECUTED", "WORKFLOW_REVERSED"]) {
      const i = src.indexOf(`"${t}"`);
      expect(i, t).toBeGreaterThan(-1);
      expect(src.slice(i, i + 400)).toMatch(/emission: "reserved"/);
    }
  });

  it("no emitter was smuggled into an application layer", () => {
    for (const f of ["lib/ec/inbound/capture.ts", "lib/process/engine/actions.ts",
                     "lib/documents/actions.ts", "lib/workflow/policy/actions.ts"]) {
      // Quoted literals only: AuditActions.PROCESS_HANDOFF_SENT is an AUDIT
      // action name and contains "HANDOFF_SENT" as a substring — matching it
      // would report an emitter that does not exist.
      expect(code(f), f).not.toMatch(
        /"(CORRESPONDENCE_RECEIVED|HANDOFF_SENT|HANDOFF_RECEIVED|DOCUMENT_SHARED_WITH_CLIENT|DOSSIER_POLICY_PINNED|EXPENSE_AUTHORIZED)"/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("scope: UT-2 only", () => {
  it("adds NO migration — the chain is unchanged at 85", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(all).toHaveLength(85);
    expect(all.sort()[84]).toBe("20260809000001_decision_plane_ordinal.sql");
  });

  it("creates no UI", () => {
    expect(existsSync(join(root, "app", "tracking"))).toBe(false);
    expect(existsSync(join(root, "app", "timeline"))).toBe(false);
    expect(existsSync(join(root, "components", "unified-timeline"))).toBe(false);
  });

  it("adds no emitter — the event registry is untouched by UT-2", () => {
    const src = code("lib/workflow/events/types.ts");
    expect(src).not.toMatch(/UT-2|unified-timeline/);
  });

  it("UT-3 has not begun: the reserved types still have no emitter", () => {
    const src = code("lib/workflow/events/types.ts");
    expect(src).toMatch(/emission: "reserved"/);
  });

  it("UT-1's frozen contract is not aware of UT-2 — the dependency points one way", () => {
    const src = code("lib/unified-timeline/contract.ts");
    expect(src).not.toMatch(/UnifiedEntry/);
    expect(src).not.toMatch(/from "\.\/merged"/);
    expect(src).not.toMatch(/ocean_tracking_event|air_tracking_event/);
  });
});
