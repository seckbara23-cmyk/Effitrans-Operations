/**
 * UT-5 — Customer Operational Intelligence.
 *
 * The phase's whole claim is that the customer and the internal timeline are the
 * SAME history, projected once and narrowed by an allow-list. These contracts
 * exist to make that claim falsifiable: a second projection, a second ordering
 * rule, or a customer read that selects an internal field all fail here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toClientSafe, assignChronology, compareUnified } from "@/lib/unified-timeline/merged";
import {
  CUSTOMER_SOURCE_LABEL_FR, CUSTOMER_UNPROVABLE_NOTICE,
  describeCustomerEntry, isUnconfirmed,
} from "@/lib/unified-timeline/presentation";
import type { UnifiedEntry } from "@/lib/unified-timeline/merged";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — a rule must live in code, not in prose. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const READER = "lib/unified-timeline/unified.ts";
const PORTAL_VIEW = "components/portal/dossier-timeline.tsx";
const PORTAL_PAGE = "app/portal/(app)/files/[id]/page.tsx";
const DERIVE = "lib/portal/tracking-derive.ts";
const READERS = "lib/workflow/events/readers.ts";

function entry(p: Partial<UnifiedEntry> = {}): UnifiedEntry {
  return {
    entryId: "A:1", tenantId: "t1", dossierId: "d1", subjectType: "operational_file",
    subjectId: "d1", plane: "decision", nature: "decision", origin: "system",
    eventType: "X", occurredAt: "2026-01-01T00:00:00Z", ordinal: 1,
    observationSource: null, confidence: null, freshness: null, label: "L",
    summary: {}, locationName: null, domain: "dossier", actorId: null, actorName: null,
    chronologyGroup: "e:A:1", chronologyProvable: true, clientSafe: true,
    paginationToken: "", ...p,
  };
}

// ---------------------------------------------------------------------------
// 1. ONE customer projection
// ---------------------------------------------------------------------------
describe("UT-5 — a single customer projection", () => {
  it("retires WES-9K's readClientTimeline rather than leaving two", () => {
    const src = code(READERS);
    expect(src).not.toContain("export async function readClientTimeline");
    expect(src).not.toContain("ClientTimelineEvent");
  });

  it("keeps readClientSafeTimeline as the only customer reader", () => {
    const src = code(READER);
    expect(src).toContain("export async function readClientSafeTimeline");
    // One definition, not two implementations of "the customer's history".
    expect(src.match(/export async function readClientSafeTimeline/g)).toHaveLength(1);
  });

  it("retires the state-derived notification feed at its source", () => {
    const src = code(DERIVE);
    expect(src).not.toContain("export function buildTimeline");
    expect(src).not.toContain("CustomerTimelineEntry");
    // The portal view model no longer carries it either.
    expect(code("lib/portal/tracking.ts")).not.toContain("activity");
  });

  it("does not create a second portal route for history", () => {
    for (const p of ["app/portal/(app)/timeline", "app/portal/(app)/files/[id]/timeline"]) {
      expect(existsSync(join(root, p))).toBe(false);
    }
    // The existing dossier page is the entry point, mounted exactly once.
    expect(read(PORTAL_PAGE).match(/<DossierTimeline/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The gate — customer isolation is the database's answer
// ---------------------------------------------------------------------------
describe("UT-5 — authorization", () => {
  it("establishes the portal user and the dossier gate BEFORE the admin client", () => {
    const src = code(READER);
    const fn = src.slice(src.indexOf("export async function readClientSafeTimeline"));
    const gate = fn.indexOf("getPortalFileSummary");
    const admin = fn.indexOf("getAdminSupabaseClient");
    expect(fn.indexOf("requirePortalUser")).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    // The admin client bypasses RLS; nothing may reach it un-gated.
    expect(gate).toBeLessThan(admin);
  });

  it("returns an empty page when the dossier is not the customer's", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    expect(fn).toMatch(/if \(!summary\) return empty;/);
  });

  it("scopes every row to the portal user's own tenant, never to an argument", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    expect(fn).toContain('.eq("tenant_id", portalUser.tenantId)');
    expect(fn).not.toMatch(/\.eq\("tenant_id", query\./);
  });

  it("asserts no permission, so SYSTEM_ADMIN gains no customer view", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    expect(fn).not.toContain("SYSTEM_ADMIN");
    expect(fn).not.toContain("getEffectivePermissions");
    expect(code(PORTAL_VIEW)).not.toContain("permission");
  });
});

// ---------------------------------------------------------------------------
// 3. Allow-list, never a deny-filter
// ---------------------------------------------------------------------------
describe("UT-5 — disclosure is an allow-list", () => {
  it("filters client-safe types in the QUERY, so others never leave the database", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    expect(fn).toContain("clientSafeEventTypes()");
    expect(fn).toContain('.in("event_type"');
  });

  it("selects no actor, metadata or subject column at all", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    const select = fn.slice(fn.indexOf(".select("), fn.indexOf(".eq("));
    expect(select).not.toContain("actor_user_id");
    expect(select).not.toContain("metadata");
    expect(select).not.toContain("subject_");
    expect(select).not.toContain("policy_version_id");
  });

  it("omits an unclassified entry rather than disclosing it", () => {
    // Forgetting to classify must cost a missing row, never a leak.
    const kept = toClientSafe([entry({ clientSafe: false }), entry({ entryId: "A:2", clientSafe: true })]);
    expect(kept.every((e) => e.clientSafe)).toBe(true);
  });

  it("never renders an amount, body, subject or storage path", () => {
    const view = code(PORTAL_VIEW);
    for (const forbidden of ["amount", "body", "storage_path", "subject", "metadata"]) {
      expect(view).not.toContain(forbidden);
    }
  });

  it("queries no module table from the portal timeline component", () => {
    const view = code(PORTAL_VIEW);
    // Match the QUERY, not the bare word: "document" is a substring of the
    // IconDocument import and would otherwise fail for the wrong reason.
    for (const table of [
      "operational_file", "document", "customs_record", "transport_record",
      "invoice", "payment", "business_event", "client_notification", "app_user",
    ]) {
      expect(view).not.toContain(`.from("${table}")`);
    }
    expect(view).not.toContain("supabase");
    expect(view).not.toContain("getAdminSupabaseClient");
  });

  it("excludes the Audit Plane, which is never a timeline source", () => {
    expect(code(READER)).not.toContain("audit_log");
    expect(code(PORTAL_VIEW)).not.toContain("audit_log");
  });
});

// ---------------------------------------------------------------------------
// 4. The customer is never told a firmer history than exists
// ---------------------------------------------------------------------------
describe("UT-5 — chronology honesty survives the projection", () => {
  it("assigns chronology BEFORE narrowing to client-safe entries", () => {
    const fn = code(READER).slice(code(READER).indexOf("readClientSafeTimeline"));
    const chrono = fn.indexOf("assignChronology");
    const narrow = fn.indexOf("toClientSafe");
    expect(chrono).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(-1);
    // Narrowing first would let a hidden internal entry make the customer's
    // entry look individually ordered — the filter would manufacture provability.
    expect(chrono).toBeLessThan(narrow);
  });

  it("keeps an entry unprovable even when its instant-mate is hidden", () => {
    const a = entry({ entryId: "A:1", ordinal: null, clientSafe: true });
    const b = entry({ entryId: "A:2", ordinal: null, clientSafe: false });
    const grouped = assignChronology([a, b]);
    const visible = toClientSafe(grouped);
    expect(visible).toHaveLength(1);
    expect(visible[0].chronologyProvable).toBe(false);
  });

  it("states the unprovable group in plain words and never numbers it", () => {
    expect(CUSTOMER_UNPROVABLE_NOTICE).toMatch(/ordre exact n'est pas connu/);
    // Comment-stripped: the source comment explaining the absent <ol> mentions
    // it, and a rule must be enforced against code rather than against prose.
    const view = code(PORTAL_VIEW);
    // Slice from the JSX usage, not the import of the same name.
    const group = view.slice(view.indexOf("{CUSTOMER_UNPROVABLE_NOTICE}"));
    // <ul> inside the group: numbering simultaneous events asserts a sequence.
    expect(group).toContain("<ul");
    expect(group.slice(0, group.indexOf("</ul>"))).not.toContain("<ol");
  });

  it("sorts by the shared comparator, giving neither plane precedence", () => {
    const at = "2026-01-01T00:00:00Z";
    const dec = entry({ entryId: "A:2", occurredAt: at, ordinal: null });
    const obs = entry({
      entryId: "B:1", plane: "observation", nature: "observation",
      occurredAt: at, ordinal: null,
    });
    // The entryId's "A:"/"B:" prefix must not survive into the tiebreak. If it
    // did, every decision would sort before every observation — the defect UT-2
    // found in its own comparator. Here the decision's key ("2") is the LARGER,
    // so a plane-blind comparator must order it after the observation.
    expect(compareUnified(dec, obs)).toBeGreaterThan(0);
    // Same instant, no ordinal: neither may be declared first.
    expect(assignChronology([dec, obs]).every((e) => !e.chronologyProvable)).toBe(true);
  });

  it("never sorts in the component — order arrives settled", () => {
    expect(code(PORTAL_VIEW)).not.toContain(".sort(");
  });
});

// ---------------------------------------------------------------------------
// 5. One ordering / pagination implementation
// ---------------------------------------------------------------------------
describe("UT-5 — no forked assembly", () => {
  it("shares assemblePage between the internal and customer readers", () => {
    const src = code(READER);
    expect(src.match(/function assemblePage/g)).toHaveLength(1);
    expect(src.match(/return assemblePage\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shares the observation adapter instead of copying the mapping", () => {
    expect(code(READER)).toContain("fetchObservations");
    const obs = code("lib/unified-timeline/observation-plane.ts");
    expect(obs.match(/export async function fetchObservations/g)).toHaveLength(1);
    // The staff entry point still gates before delegating.
    const staff = obs.slice(obs.indexOf("export async function readObservationPlane"));
    expect(staff.indexOf("isFileVisible")).toBeLessThan(staff.indexOf("fetchObservations"));
  });
});

// ---------------------------------------------------------------------------
// 6. Customer vocabulary
// ---------------------------------------------------------------------------
describe("UT-5 — customer wording", () => {
  it("uses no internal plane or provenance vocabulary", () => {
    const view = read(PORTAL_VIEW);
    for (const jargon of ["Plan de décision", "Plan d'observation", "decision plane", "Provenance"]) {
      expect(view).not.toContain(jargon);
    }
    expect(CUSTOMER_SOURCE_LABEL_FR.decision).toBe("Confirmé par Effitrans");
    expect(CUSTOMER_SOURCE_LABEL_FR.observation).toMatch(/transporteur/);
  });

  it("marks a derived observation as unconfirmed, and a keyed one as not", () => {
    expect(isUnconfirmed("ESTIMATED")).toBe(true);
    expect(isUnconfirmed("INFERRED")).toBe(true);
    // A colleague who keyed a milestone in did observe it.
    expect(isUnconfirmed("MANUAL")).toBe(false);
    expect(isUnconfirmed("CONFIRMED")).toBe(false);
    expect(isUnconfirmed(null)).toBe(false);
  });

  it("gives every entry a spoken description carrying source and any doubt", () => {
    const d = describeCustomerEntry(entry({ label: "Documents transmis" }));
    expect(d).toContain("Documents transmis");
    expect(d).toContain("Confirmé par Effitrans");

    const shaky = describeCustomerEntry(entry({
      plane: "observation", confidence: "ESTIMATED", chronologyProvable: false,
    }));
    expect(shaky).toContain("non confirmée");
    expect(shaky).toContain("n'est pas connu");
  });

  it("carries no meaning in colour alone", () => {
    const view = read(PORTAL_VIEW);
    // The amber "unconfirmed" styling is always accompanied by its word.
    expect(view).toContain("Non confirmé");
    expect(view).toContain("CUSTOMER_SOURCE_LABEL_FR[entry.plane]");
  });

  it("uses the icon library, not emoji", () => {
    const view = read(PORTAL_VIEW);
    expect(view).toContain('from "@/lib/icons"');
    expect(view).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

// ---------------------------------------------------------------------------
// 7. The AI assistant tells the same story
// ---------------------------------------------------------------------------
describe("UT-5 — one history, including for the assistant", () => {
  it("feeds the copilot from the projection, not the notification feed", () => {
    const src = code("lib/portal/copilot/context.ts");
    expect(src).toContain("readClientSafeTimeline");
    expect(src).not.toContain("tracking.activity");
  });

  it("puts only closed-vocabulary labels in the prompt", () => {
    const src = code("lib/portal/copilot/context.ts");
    const block = src.slice(src.indexOf("readClientSafeTimeline"));
    expect(block).toContain("e.label");
    // Free-text notification titles no longer reach a model.
    expect(block).not.toContain("a.title");
  });
});

// ---------------------------------------------------------------------------
// 8. Nothing was built that this phase forbade
// ---------------------------------------------------------------------------
describe("UT-5 — no new surface", () => {
  it("adds no migration", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files).toHaveLength(86);
  });

  it("adds no event store, emitter or permission", () => {
    for (const f of [READER, PORTAL_VIEW, "lib/unified-timeline/presentation.ts"]) {
      const src = code(f);
      expect(src).not.toContain("create table");
      expect(src).not.toContain("emit_business_event");
      expect(src).not.toContain("hasPermission");
    }
  });
});
