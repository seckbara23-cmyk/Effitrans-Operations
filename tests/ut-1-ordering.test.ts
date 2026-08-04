/**
 * UT-1 — Decision Plane ordering foundation and read contract.
 *
 * The claim this phase makes is narrow and absolute: **Unified Tracking never
 * invents chronology.** Most of what follows tests the case where order is NOT
 * knowable, because that is the case a timeline is tempted to fake.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  compareEntries, sortAscending, groupUnordered, orderingGroupOf,
  deriveProvenance, projectMetadata, labelFor,
  encodeCursor, decodeCursor, isBeforeCursor,
} from "@/lib/unified-timeline/contract";
import { PROHIBITED_METADATA_KEYS } from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIG = "supabase/migrations/20260809000001_decision_plane_ordinal.sql";
const READER = "lib/unified-timeline/decision-plane.ts";
const CONTRACT = "lib/unified-timeline/contract.ts";

const e = (occurredAt: string, ordinal: number | null, eventId: string) => ({ occurredAt, ordinal, eventId });

// ---------------------------------------------------------------------------
describe("ordering doctrine", () => {
  it("orders by occurred_at first", () => {
    expect(compareEntries(e("2026-01-01T00:00:00Z", 9, "a"), e("2026-01-02T00:00:00Z", 1, "b"))).toBeLessThan(0);
  });

  it("breaks a same-instant tie by ordinal, NOT by uuid", () => {
    // The whole point: two events in one transaction share occurred_at, and id
    // is random. Without the ordinal this pair had no truthful order.
    expect(compareEntries(e("T", 1, "zzz"), e("T", 2, "aaa"))).toBeLessThan(0);
    expect(compareEntries(e("T", 2, "aaa"), e("T", 1, "zzz"))).toBeGreaterThan(0);
  });

  it("is a total order — id is the final, purely-stabilising tiebreaker", () => {
    expect(compareEntries(e("T", 1, "a"), e("T", 1, "b"))).toBeLessThan(0);
    expect(compareEntries(e("T", 1, "a"), e("T", 1, "a"))).toBe(0);
  });

  it("sorts NULL ordinals AFTER recorded ones at the same instant", () => {
    const sorted = sortAscending([e("T", null, "x"), e("T", 5, "y")]);
    expect(sorted.map((s) => s.eventId)).toEqual(["y", "x"]);
  });

  it("is deterministic under shuffling — the same input set always yields one order", () => {
    const set = [e("T", 3, "c"), e("T", 1, "a"), e("T", 2, "b"), e("S", 9, "z")];
    const a = sortAscending(set).map((x) => x.eventId);
    const b = sortAscending([...set].reverse()).map((x) => x.eventId);
    expect(a).toEqual(b);
    expect(a).toEqual(["z", "a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
describe("history whose order was never recorded", () => {
  it("same-instant pre-ordinal events share ONE ordering group", () => {
    const g = orderingGroupOf("2026-01-01T00:00:00Z", null);
    expect(orderingGroupOf("2026-01-01T00:00:00Z", null)).toBe(g);
    // A different instant is a different group.
    expect(orderingGroupOf("2026-01-02T00:00:00Z", null)).not.toBe(g);
  });

  it("an event WITH an ordinal is alone in its group — its position is proven", () => {
    expect(orderingGroupOf("T", 7)).not.toBe(orderingGroupOf("T", 8));
    expect(orderingGroupOf("T", 7)).not.toBe(orderingGroupOf("T", null));
  });

  it("groups consecutive unprovable entries instead of ordering them", () => {
    const entries = [
      { orderingGroup: orderingGroupOf("T", null), id: 1 },
      { orderingGroup: orderingGroupOf("T", null), id: 2 },
      { orderingGroup: orderingGroupOf("T", 4), id: 3 },
    ];
    const groups = groupUnordered(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2); // rendered as simultaneous
    expect(groups[1]).toHaveLength(1);
  });

  it("never coerces a NULL ordinal to a number", () => {
    // Coercing to 0 would fabricate a position for history that has none.
    const src = code(READER);
    expect(src).not.toMatch(/ordinal\s*\?\?\s*0|Number\(r\.ordinal\)\s*\|\|\s*0|coalesce/i);
    expect(src).toMatch(/r\.ordinal === null/);
  });
});

// ---------------------------------------------------------------------------
describe("pagination", () => {
  it("a cursor round-trips, including a NULL ordinal", () => {
    for (const c of [
      { occurredAt: "2026-01-01T00:00:00Z", ordinal: 42, eventId: "abc" },
      { occurredAt: "2026-01-01T00:00:00Z", ordinal: null, eventId: "def" },
    ]) {
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    }
  });

  it("rejects a malformed or hand-crafted cursor rather than guessing", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from('["x"]').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2,3]').toString("base64url"))).toBeNull();
  });

  it("is stable: strictly-before is exactly the comparator", () => {
    const cur = { occurredAt: "T", ordinal: 5, eventId: "m" };
    expect(isBeforeCursor({ occurredAt: "T", ordinal: 4, eventId: "z" }, cur)).toBe(true);
    expect(isBeforeCursor({ occurredAt: "T", ordinal: 5, eventId: "m" }, cur)).toBe(false); // no duplicate
    expect(isBeforeCursor({ occurredAt: "T", ordinal: 6, eventId: "a" }, cur)).toBe(false);
  });

  it("the reader trims the boundary with the SAME comparator the contract defines", () => {
    const src = code(READER);
    expect(src).toContain("compareEntries(cursorOf(e), cursor) < 0");
    expect(src).toMatch(/lte\("occurred_at"/);
  });

  it("caps the page — a timeline page is not a bulk export", () => {
    const src = code(READER);
    expect(src).toMatch(/MAX_PAGE = \d+/);
    expect(src).toMatch(/Math\.min\(Math\.max\(query\.limit/);
  });
});

// ---------------------------------------------------------------------------
describe("provenance is derived, never stored", () => {
  it("adds no provenance column", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/add column if not exists (nature|origin|provenance)/i);
  });

  it("a db_trigger emission is system even when an actor is recorded", () => {
    // Origin describes HOW it was emitted; who caused it is `actorId`.
    expect(deriveProvenance({ source: "db_trigger", actorUserId: "u1" }).origin).toBe("system");
  });

  it("an RPC or action with an actor is human; without one it is system", () => {
    expect(deriveProvenance({ source: "policy_rpc", actorUserId: "u1" }).origin).toBe("human");
    expect(deriveProvenance({ source: "policy_rpc", actorUserId: null }).origin).toBe("system");
    expect(deriveProvenance({ source: "app_action", actorUserId: "u1" }).origin).toBe("human");
  });

  it("every Decision Plane event is nature=decision with no confidence", () => {
    for (const s of ["db_trigger", "policy_rpc", "app_action"]) {
      const p = deriveProvenance({ source: s, actorUserId: null });
      expect(p.nature).toBe("decision");
      expect(p.confidence).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
describe("metadata-safe projection", () => {
  it("drops every prohibited key even if one somehow reached the row", () => {
    const dirty: Record<string, unknown> = { file_number: "EFT-1", quotation_id: "q1" };
    for (const k of PROHIBITED_METADATA_KEYS) dirty[k] = "leak";
    const out = projectMetadata(dirty);
    for (const k of PROHIBITED_METADATA_KEYS) expect(out[k], k).toBeUndefined();
    expect(out.file_number).toBe("EFT-1");
    expect(out.quotation_id).toBe("q1");
  });

  it("drops non-scalars — no nested object reaches the portal or the AI layer", () => {
    const out = projectMetadata({ ok: 1, nested: { a: 1 }, list: [1, 2], nil: null });
    expect(out).toEqual({ ok: 1 });
  });

  it("survives a non-object metadata value", () => {
    expect(projectMetadata(null)).toEqual({});
    expect(projectMetadata("string")).toEqual({});
    expect(projectMetadata([1, 2])).toEqual({});
  });

  it("falls back to the raw type rather than inventing a label", () => {
    expect(labelFor("NOT_A_REAL_TYPE")).toBe("NOT_A_REAL_TYPE");
    expect(labelFor("DOSSIER_OPENED")).not.toBe("DOSSIER_OPENED");
  });
});

// ---------------------------------------------------------------------------
describe("migration 85 — the smallest additive change", () => {
  it("adds the ordinal NULLABLE and never backfills it", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/add column if not exists ordinal bigint/);
    expect(sql).not.toMatch(/update public\.business_event/i);
    expect(sql).not.toMatch(/set ordinal/i);
    // The COLUMN is nullable forever; "is not null" elsewhere is the RLS predicate.
    expect(sql).not.toMatch(/ordinal bigint[^;]*not null/i);
  });

  it("never rewrites occurred_at", () => {
    expect(code(MIG)).not.toMatch(/occurred_at\s*=/);
  });

  it("uses a sequence, and revokes it so nothing else can draw from it", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/create sequence if not exists public\.business_event_ordinal_seq/);
    expect(sql).toMatch(/revoke all on sequence public\.business_event_ordinal_seq from public/);
  });

  it("assigns by BEFORE INSERT trigger — unspoofable by ANY caller", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/before insert on public\.business_event/);
    // Unconditional overwrite: a supplied value is discarded, not respected.
    expect(sql).toMatch(/new\.ordinal := nextval\('public\.business_event_ordinal_seq'\)/);
    expect(sql).not.toMatch(/if new\.ordinal is null/i);
  });

  it("does not change emit_business_event's signature or the registry", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/create or replace function public\.emit_business_event/);
    expect(sql).not.toMatch(/event_domain_check|insert into public\.permission/);
  });

  it("creates no second event table and copies no observation row", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/ocean_tracking_event|air_tracking_event/);
  });

  it("adds no immutability guard, because one already covers it", () => {
    // prevent_mutation() already blocks UPDATE and DELETE for every role.
    const sql = code(MIG);
    expect(sql).not.toMatch(/prevent_mutation/);
    const ledger = code("supabase/migrations/20260726000004_business_event_ledger.sql");
    expect(ledger).toMatch(/before update on public\.business_event[\s\S]{0,120}prevent_mutation/);
  });

  it("sits last in the chain and touches nothing before it", () => {
    // UT-1's OWN position, not "newest" — the recurring maintenance defect.
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all[84]).toBe("20260809000001_decision_plane_ordinal.sql");
    expect(all[83]).toBe("20260808000001_commercial_conversion.sql");
  });
});

// ---------------------------------------------------------------------------
describe("subject-based visibility (DEC-B88 §5)", () => {
  it("mints NO permission", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/insert into public\.permission/i);
    expect(sql).not.toMatch(/tracking:[a-z]+/);
  });

  it("dossier events keep can_read_file, unchanged", () => {
    expect(code(MIG)).toMatch(/dossier_id is not null and public\.can_read_file\(dossier_id\)/);
  });

  it("the commercial prologue follows the DEC-C32 read pair", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/event_domain = 'commercial'[\s\S]{0,200}quotation:create[\s\S]{0,80}quotation:validate/);
  });

  it("the correspondence prologue follows the EC authorities", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/event_domain = 'communication'[\s\S]{0,220}communication:inbound:read[\s\S]{0,90}communication:triage/);
  });

  it("configuration history is unchanged and NOT widened", () => {
    expect(code(MIG)).toMatch(/event_domain in \('policy', 'ledger'\)[\s\S]{0,80}admin:config:manage/);
  });

  it("grants the portal nothing — still no policy for portal users", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/client_user|portal/i);
  });

  it("SELECT-only: the policy adds no write path", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/for select to authenticated/);
    expect(sql).not.toMatch(/for (insert|update|delete)/i);
  });
});

// ---------------------------------------------------------------------------
describe("scope boundaries — UT-1 only", () => {
  it("the reader touches the Decision Plane ONLY", () => {
    const src = code(READER);
    expect(src).toMatch(/from\("business_event"\)/);
    expect(src).not.toMatch(/ocean_tracking_event|air_tracking_event|tracking_event/);
    expect(src).not.toMatch(/audit_log/);
  });

  it("audit_log is never a timeline source, anywhere in lib/unified-timeline", () => {
    for (const f of ["contract.ts", "decision-plane.ts"]) {
      expect(code(join("lib", "unified-timeline", f))).not.toMatch(/audit_log/);
    }
  });

  it("Tracking writes nothing and owns no table", () => {
    for (const f of ["contract.ts", "decision-plane.ts"]) {
      const src = code(join("lib", "unified-timeline", f));
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src, f).not.toMatch(/\.rpc\(/);
    }
  });

  it("visibility is the DATABASE's job — the reader uses the RLS-bound client", () => {
    const src = code(READER);
    expect(src).toContain("getServerSupabaseClient");
    // The admin client appears only through the shared name resolver.
    expect(src).not.toMatch(/getAdminSupabaseClient\(\)/);
  });

  it("no UI was created by UT-1", () => {
    expect(existsSync(join(root, "app", "tracking"))).toBe(false);
    expect(existsSync(join(root, "components", "tracking"))).toBe(false);
  });

  it("UT-1's own reader stays single-plane, whatever later phases add", () => {
    // This marker used to assert that lib/unified-timeline held exactly two
    // files — true until UT-2 legitimately added the merge. Re-aimed at what
    // UT-1 actually owns: its reader touches one plane and nothing else.
    const src = code(READER);
    expect(src).toMatch(/from\("business_event"\)/);
    expect(src).not.toMatch(/ocean_tracking_event|air_tracking_event|tracking_event/);
    expect(code(CONTRACT)).not.toMatch(/observationPlane|crossPlane/i);
  });
});
