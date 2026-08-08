/**
 * UT-4 — the Unified Operational Timeline UI.
 *
 * The surface's whole value is being trustworthy about sequence and source, so
 * most of what follows pins what it must NOT do: invent order, leak prose,
 * show money, query a module table, or let a filter make history look firmer
 * than it is.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TIMELINE_FILTERS, FILTER_LABEL_FR, matchesFilter, matchesPlane, matchesOrigin,
  describeEntry, iconKeyFor, linkFor, UNPROVABLE_GROUP_NOTICE,
  PLANE_LABEL_FR, NATURE_LABEL_FR, ORIGIN_LABEL_FR,
} from "@/lib/unified-timeline/presentation";
import type { UnifiedEntry } from "@/lib/unified-timeline/merged";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VIEW = "components/files/unified-timeline-view.tsx";
const WRAPPER = "components/files/event-timeline.tsx";
const PRESENTATION = "lib/unified-timeline/presentation.ts";
const READER = "lib/unified-timeline/unified.ts";

function entry(p: Partial<UnifiedEntry> = {}): UnifiedEntry {
  return {
    entryId: "A:1", tenantId: "t1", dossierId: "d1", subjectType: "operational_file",
    subjectId: "d1", plane: "decision", nature: "decision", origin: "system",
    eventType: "X", occurredAt: "2026-01-01T00:00:00Z", ordinal: 1,
    observationSource: null, confidence: null, freshness: null, label: "L",
    summary: {}, locationName: null, domain: "dossier", actorId: null, actorName: null,
    chronologyGroup: "e:A:1", chronologyProvable: true, clientSafe: false,
    paginationToken: "", ...p,
  };
}

// ---------------------------------------------------------------------------
describe("canonical route — exactly one timeline", () => {
  it("adds NO new route: the dossier page section is the entry point", () => {
    expect(existsSync(join(root, "app", "files", "[id]", "timeline"))).toBe(false);
    expect(existsSync(join(root, "app", "operations", "files"))).toBe(false);
    expect(existsSync(join(root, "app", "timeline"))).toBe(false);
  });

  it("is mounted once, on the dossier page", () => {
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain("<EventTimeline fileId={file.id} />");
    expect((page.match(/<EventTimeline/g) ?? []).length).toBe(1);
  });

  it("has no duplicate implementation — the old one was ABSORBED, not forked", () => {
    // The pre-existing component still exists at the same path and the same
    // export; only its data source changed. A second component reading
    // business_event for a dossier would be a second history.
    expect(code(WRAPPER)).toContain("readUnifiedTimeline");
    expect(code(WRAPPER)).not.toContain("readDossierTimeline");
    const dupes = readdirSync(join(root, "components", "files"))
      .filter((f) => /timeline/i.test(f));
    expect(dupes.sort()).toEqual(["event-timeline.tsx", "unified-timeline-view.tsx"]);
  });
});

// ---------------------------------------------------------------------------
describe("security — the UI owns no data path", () => {
  it("queries NO module table directly", () => {
    for (const f of [VIEW, WRAPPER, PRESENTATION]) {
      const src = code(f);
      for (const t of ["ocean_tracking_event", "air_tracking_event", "tracking_event",
                       "document", "quotation", "invoice", "ec_inbound_message",
                       "process_handoff", "expense_authorization"]) {
        expect(src, `${f} queries ${t}`).not.toMatch(new RegExp(`from\\("${t}"\\)`));
      }
    }
  });

  it("reads only through the Unified Timeline reader", () => {
    expect(code(WRAPPER)).toContain("readUnifiedTimeline");
    expect(code(VIEW)).toContain("loadTimelinePage");
  });

  it("audit_log is excluded from every UT-4 file", () => {
    for (const f of [VIEW, WRAPPER, PRESENTATION, "lib/unified-timeline/actions.ts"]) {
      expect(code(f), f).not.toMatch(/audit_log/);
    }
  });

  it("the one admin-client read is tenant-scoped and yields a boolean only", () => {
    const src = code(WRAPPER);
    const i = src.indexOf("hasLedgerBoundary");
    const body = src.slice(i, src.indexOf("export async function", i));
    expect(body).toMatch(/\.eq\("tenant_id", tenantId\)/);
    // head:true — a count, never event content.
    expect(body).toMatch(/head: true/);
    // The tenant comes from the resolved user, never from a prop.
    expect(src).toMatch(/requireUser\(\)/);
    expect(src).toMatch(/hasLedgerBoundary\(user\.tenantId\)/);
  });

  it("grants no bypass: no permission is asserted or referenced in the UI", () => {
    for (const f of [VIEW, WRAPPER]) {
      expect(code(f), f).not.toMatch(/SYSTEM_ADMIN|assertPermission|service_role/);
    }
  });

  it("the load-more action adds no second gate — the reader is the only one", () => {
    const src = code("lib/unified-timeline/actions.ts");
    expect(src).toContain("readUnifiedTimeline");
    expect(src).not.toMatch(/assertPermission|isFileVisible|getAdminSupabaseClient/);
  });

  it("never uses the clientSafe projection as internal data", () => {
    for (const f of [VIEW, WRAPPER]) {
      expect(code(f), f).not.toMatch(/readClientSafeTimeline|toClientSafe/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("nothing raw reaches the browser", () => {
  it("renders no raw metadata map — the old chips are gone", () => {
    const src = code(VIEW);
    expect(src).not.toMatch(/METADATA_LABELS|Object\.entries\(entry\.metadata\)/);
    expect(src).not.toMatch(/entry\.summary\)\s*\.map/);
  });

  it("shows no email body, subject, note or storage path", () => {
    for (const f of [VIEW, PRESENTATION]) {
      const src = code(f);
      expect(src, f).not.toMatch(/body|storage_path|internal_note|customer_message|\bsubject\b/i);
    }
  });

  it("shows no monetary value", () => {
    for (const f of [VIEW, PRESENTATION]) {
      const src = code(f);
      expect(src, f).not.toMatch(/amount|montant|balance|price|currency|XOF/i);
    }
  });

  it("uses the project icon library, never an emoji", () => {
    const src = read(VIEW);
    expect(src).toContain('from "@/lib/icons"');
    // No pictographic characters anywhere in the rendered source.
    expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

// ---------------------------------------------------------------------------
describe("chronology is presented, never invented", () => {
  it("a filter can NEVER manufacture provability", () => {
    // The reader assigns chronology BEFORE filtering. If it filtered first,
    // hiding the entry that shared an instant would make the survivor look
    // individually ordered.
    // Compare the CALL sites, not the import line — matchesFilter appears in
    // the import block long before any code runs.
    const src = code(READER);
    const assign = src.indexOf("const withChronology = assignChronology(scoped)");
    const filter = src.indexOf("const filtered = withChronology.filter");
    expect(assign, "assignChronology call not found").toBeGreaterThan(-1);
    expect(filter, "filter call not found").toBeGreaterThan(-1);
    expect(assign).toBeLessThan(filter);
  });

  it("groups consecutive same-group entries and names the reason", () => {
    const src = code(VIEW);
    expect(src).toMatch(/chronologyGroup === e\.chronologyGroup/);
    expect(src).toContain("UNPROVABLE_GROUP_NOTICE");
    expect(UNPROVABLE_GROUP_NOTICE).toMatch(/sans séquence/);
  });

  it("a group renders WITHOUT ordered-list semantics", () => {
    // <ol> would number simultaneous events, which is a claimed sequence.
    const src = code(VIEW);
    const i = src.indexOf("function ChronologyGroup");
    const body = src.slice(i, src.indexOf("function Entry"));
    expect(body).toContain("<ul");
    expect(body).not.toContain("<ol");
  });

  it("carries no plane precedence into the UI", () => {
    const src = code(VIEW);
    // No sort at all in the view: order arrives settled from the reader.
    expect(src).not.toMatch(/\.sort\(/);
  });

  it("an unprovable entry says so to assistive technology", () => {
    const d = describeEntry(entry({ chronologyProvable: false }));
    expect(d).toMatch(/ordre non prouvable/);
    expect(describeEntry(entry({ chronologyProvable: true }))).not.toMatch(/non prouvable/);
  });

  it("received_at never appears in the UI", () => {
    for (const f of [VIEW, PRESENTATION]) expect(code(f), f).not.toMatch(/received_at|receivedAt/);
  });
});

// ---------------------------------------------------------------------------
describe("filters", () => {
  it("offers exactly the seven required options", () => {
    expect([...TIMELINE_FILTERS]).toEqual([
      "all", "commercial", "communication", "operations", "document", "finance", "tracking",
    ]);
    for (const f of TIMELINE_FILTERS) expect(FILTER_LABEL_FR[f], f).toBeTruthy();
  });

  it("tracking selects the Observation Plane, not a domain", () => {
    expect(matchesFilter(entry({ plane: "observation", domain: null }), "tracking")).toBe(true);
    expect(matchesFilter(entry({ plane: "decision", domain: "transport" }), "tracking")).toBe(false);
  });

  it("operations covers the dossier's own working life", () => {
    for (const d of ["dossier", "task", "process", "handoff"]) {
      expect(matchesFilter(entry({ domain: d as never }), "operations"), d).toBe(true);
    }
    expect(matchesFilter(entry({ domain: "finance" }), "operations")).toBe(false);
  });

  it("all admits everything; a domain filter excludes observations", () => {
    expect(matchesFilter(entry({ plane: "observation" }), "all")).toBe(true);
    expect(matchesFilter(entry({ plane: "observation" }), "document")).toBe(false);
  });

  it("secondary plane and origin filters are orthogonal and default to open", () => {
    expect(matchesPlane(entry(), null)).toBe(true);
    expect(matchesPlane(entry({ plane: "decision" }), "observation")).toBe(false);
    expect(matchesOrigin(entry({ origin: "external" }), "external")).toBe(true);
    expect(matchesOrigin(entry({ origin: "human" }), "external")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("pagination", () => {
  it("reuses the group-safe cursor contract and never re-sorts", () => {
    const src = code(VIEW);
    expect(src).toContain("nextCursor");
    expect(src).not.toMatch(/\.sort\(/);
  });

  it("de-duplicates on append so a page boundary cannot repeat an entry", () => {
    const src = code(VIEW);
    expect(src).toMatch(/new Set\(prev\.map\(\(e\) => e\.entryId\)\)/);
    expect(src).toMatch(/filter\(\(e\) => !seen\.has\(e\.entryId\)\)/);
  });

  it("loads a bounded first page — never the full history", () => {
    const src = code(WRAPPER);
    expect(src).toMatch(/FIRST_PAGE = \d+/);
    expect(src).toMatch(/limit: FIRST_PAGE/);
  });

  it("makes ONE reader call per render — no per-entry lookup", () => {
    const src = code(WRAPPER);
    expect((src.match(/readUnifiedTimeline\(/g) ?? []).length).toBe(1);
    expect(code(VIEW)).not.toMatch(/await .*map\(/);
  });
});

// ---------------------------------------------------------------------------
describe("authorized links only", () => {
  it("returns nothing without the owning module's permission", () => {
    expect(linkFor(entry({ domain: "document" }), [])).toBeNull();
    expect(linkFor(entry({ domain: "communication" }), [])).toBeNull();
    expect(linkFor(entry({ domain: "finance" }), [])).toBeNull();
    expect(linkFor(entry({ plane: "observation" }), [])).toBeNull();
  });

  it("documents link to the dossier's document workspace, never to storage", () => {
    const l = linkFor(entry({ domain: "document" }), ["document:read"]);
    expect(l?.href).toBe("/files/d1/documents");
    expect(l?.href).not.toMatch(/storage|supabase|\.pdf/);
  });

  it("observations reuse the EXISTING tracking surface — no second map", () => {
    expect(linkFor(entry({ plane: "observation" }), ["transport:read"])?.href).toBe("/transport");
    const src = code(VIEW);
    expect(src).not.toMatch(/leaflet|mapbox|<Map|MapContainer/i);
  });

  it("commercial links need the DEC-C32 read pair and use the quotation id when present", () => {
    expect(linkFor(entry({ domain: "commercial" }), ["file:read"])).toBeNull();
    const l = linkFor(entry({ domain: "commercial", summary: { quotation_id: "q9" } }),
                      ["quotation:validate"]);
    expect(l?.href).toBe("/commercial/quotations/q9");
  });

  it("finance links to the dossier, carrying no figure", () => {
    const l = linkFor(entry({ domain: "finance" }), ["finance:read"]);
    expect(l?.href).toBe("/files/d1");
    expect(JSON.stringify(l)).not.toMatch(/amount|montant/i);
  });
});

// ---------------------------------------------------------------------------
describe("accessibility", () => {
  it("uses semantic list structure and a labelled region", () => {
    const src = code(VIEW);
    expect(src).toContain("<ol");
    expect(src).toContain("<li");
    expect(src).toMatch(/aria-labelledby="ut-timeline-heading"/);
  });

  it("filters are a labelled group with pressed state", () => {
    const src = code(VIEW);
    expect(src).toMatch(/role="group"/);
    expect(src).toMatch(/aria-label="Filtrer le journal par domaine"/);
    expect(src).toMatch(/aria-pressed=\{filter === f\}/);
  });

  it("every entry carries a full spoken description", () => {
    const src = code(VIEW);
    expect(src).toMatch(/aria-label=\{describeEntry\(entry\)\}/);
    const d = describeEntry(entry({
      plane: "observation", nature: "observation", origin: "external",
      observationSource: "AIS", confidence: "ESTIMATED", freshness: "STALE",
      locationName: "Dakar", clientSafe: true,
    }));
    for (const s of ["Observation", "Source externe", "AIS", "Estimée", "Ancienne", "Dakar", "visible par le client"]) {
      expect(d, s).toContain(s);
    }
  });

  it("no meaning is carried by colour alone — plane, nature and origin are words", () => {
    expect(PLANE_LABEL_FR.decision).toBeTruthy();
    expect(PLANE_LABEL_FR.observation).toBeTruthy();
    expect(NATURE_LABEL_FR.observation).toBeTruthy();
    expect(ORIGIN_LABEL_FR.external).toBeTruthy();
    const src = code(VIEW);
    // The plane badge renders text, not just a tone.
    expect(src).toMatch(/PLANE_LABEL_FR\[entry\.plane\]/);
  });

  it("loading and status regions are announced", () => {
    const src = code(VIEW);
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/aria-live="polite"/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toContain("sr-only");
  });

  it("is mobile-capable — wrapping layout, no fixed width", () => {
    const src = code(VIEW);
    expect(src).toMatch(/flex-wrap/);
    expect(src).not.toMatch(/w-\[\d+px\]|min-w-\[\d{3,}px\]/);
  });
});

// ---------------------------------------------------------------------------
describe("honest empty and boundary states", () => {
  it("distinguishes no-events, no-observations and no-filter-match", () => {
    const src = code(VIEW);
    expect(src).toContain("Aucun évènement enregistré pour ce dossier.");
    expect(src).toContain("Aucune observation de suivi pour ce dossier.");
    expect(src).toMatch(/Aucun évènement ne correspond au filtre/);
  });

  it("without a ledger marker it refuses to imply completeness", () => {
    const src = code(VIEW);
    expect(src).toMatch(/hasLedgerBoundary/);
    expect(src).toMatch(/ne signifie pas qu'il ne s'est rien passé/);
  });

  it("a failed page says the shown history is still exact", () => {
    expect(code(VIEW)).toMatch(/Ce qui est affiché reste exact/);
  });

  it("the boundary probe fails CLOSED — unknown means 'not complete'", () => {
    const src = code(WRAPPER);
    expect(src).toMatch(/catch \{\s*return false;/);
  });
});

// ---------------------------------------------------------------------------
describe("scope: UT-4 only", () => {
  it("adds no migration", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    // This phase's OWN position, not "the newest migration" — migrations are
    // append-only and never renamed, so an index holds forever, whereas
    // "newest" is a claim a finished phase does not own.
    expect(all.indexOf("20260810000001_decision_plane_emitters.sql")).toBe(85);
    expect(all.length).toBeGreaterThanOrEqual(86);
  });

  it("adds no emitter and no store", () => {
    for (const f of [VIEW, WRAPPER, PRESENTATION, "lib/unified-timeline/actions.ts"]) {
      const src = code(f);
      expect(src, f).not.toContain("emit_business_event");
      expect(src, f).not.toMatch(/create table/i);
    }
    const src = code("lib/workflow/events/types.ts");
    expect([...src.matchAll(/emission: "reserved"/g)]).toHaveLength(2);
  });

  it("has not begun the portal, AI or mail programs", () => {
    expect(existsSync(join(root, "app", "portal", "timeline"))).toBe(false);
    expect(existsSync(join(root, "app", "ai-operations"))).toBe(false);
    // `app/mail` was once asserted absent here. The Enterprise Mail programme
    // (EMP-1..4) has since shipped it, which is not a UT-4 regression — a phase
    // marker must assert what THAT phase did, never that a later programme
    // never starts. The AI surface above is still genuinely unbuilt.
    // The clientSafe projection remains built-but-unwired.
    for (const f of readdirSync(join(root, "app", "portal"), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".tsx")) {
        expect(code(join("app", "portal", f.name))).not.toMatch(/unified-timeline/);
      }
    }
  });

  it("icons come from the shared library, keyed per domain and plane", () => {
    expect(iconKeyFor(entry({ plane: "observation" }))).toBe("route");
    expect(iconKeyFor(entry({ domain: "commercial" }))).toBe("quote");
    expect(iconKeyFor(entry({ domain: "finance" }))).toBe("finance");
  });
});
