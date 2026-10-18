/**
 * The Customs Reference Library's three UI authorization gates.
 * CUSTOMS-REF-RBAC-REGRESSION-01.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. CUSTOMS-REF-UAT-01B verified by hand, in production, that a
 * CUSTOMS_DECLARANT sees no upload form, no publisher antivirus notice and no
 * publication-state filter. Those three observations were the only verification
 * those gates had: the service layer, the API routes and the migration grants
 * are all pinned by tests, but the component render gates were not. A manual
 * browser check does not survive a refactor, and an authorization boundary
 * protected only by somebody remembering to look is not protected.
 *
 * THESE TESTS RENDER THE COMPONENTS. `renderToStaticMarkup` from the already
 * installed react-dom produces real markup in a plain Node environment, so the
 * assertions are about what a browser would actually receive — not about the
 * source text of a JSX expression. No jsdom, no testing-library, no new
 * dependency.
 *
 * AND THEY ASSERT SEMANTIC CONTROLS, NOT LABELS. A file input, a named select,
 * a `role="note"` region. French wording is a product decision that may change
 * without the authorization contract changing; `<input type="file">` appearing
 * for a reader is a defect whatever it is labelled.
 *
 * THE CHAIN IS TESTED, NOT JUST THE LEAF. `canPublish` is derived the way the
 * application derives it — union the roles' permissions as `get_user_permissions`
 * does, then `hasPermission` — and the role→permission fixture is PARSED FROM
 * MIGRATION 152 rather than retyped, so a change to the grant that contradicts
 * these expectations fails here instead of drifting silently.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasPermission } from "@/lib/rbac/check";
import type { ReferenceDocument } from "@/lib/customs/reference/types";

// The panel is a client component: it reaches for a router, the server actions
// and the browser Supabase client. None of that is under test here, and none of
// it may be allowed to run.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/customs/reference/actions", () => ({
  publishDocument: async () => ({ ok: true }),
  recordLicenceRuling: async () => ({ ok: true }),
  recordVerifications: async () => ({ ok: true }),
  requestScan: async () => ({ ok: true }),
  submitForPublication: async () => ({ ok: true }),
  withdrawDocument: async () => ({ ok: true }),
}));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabaseClient: () => ({}) }));

const { ReferenceLibraryPanel } = await import("@/components/customs/reference-library-panel");
const { ReferenceSearch } = await import("@/components/customs/reference-search");

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const MIGRATION = "supabase/migrations/20261016000001_customs_reference_library.sql";
const READ = "customs:reference:read";
const PUBLISH = "customs:reference:publish";

/**
 * The grant lists, read out of the migration that creates them.
 *
 * Retyping them here would make this file agree with itself and with nothing
 * else. Parsing them means a future migration that widens the publish grant
 * breaks these tests, which is the point.
 */
function grantedRoles(permission: string): string[] {
  const sql = read(MIGRATION);
  const at = sql.indexOf(`p.code = '${permission}'`);
  expect(at, `grant block for ${permission}`).toBeGreaterThan(-1);
  const block = sql.slice(at, at + 600);
  // No `s` flag: this project targets below es2018, and a negated class already
  // spans newlines — the role list is wrapped across three lines in the SQL.
  const m = /r\.code in \(([^)]*)\)/.exec(block);
  expect(m, `role list for ${permission}`).not.toBeNull();
  return [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

const READERS = grantedRoles(READ);
const PUBLISHERS = grantedRoles(PUBLISH);

/** Every library permission a set of roles confers, as get_user_permissions unions them. */
function effectivePermissions(roles: string[]): string[] {
  const out = new Set<string>();
  for (const r of roles) {
    if (READERS.includes(r)) out.add(READ);
    if (PUBLISHERS.includes(r)) out.add(PUBLISH);
  }
  return [...out];
}

/** The application's own derivation, not a shortcut. */
const canPublishFor = (roles: string[]) =>
  hasPermission(effectivePermissions(roles), PUBLISH);

// ---------------------------------------------------------------------------
const panelFor = (roles: string[], scannerConfigured: boolean, documents: ReferenceDocument[] = []) =>
  renderToStaticMarkup(
    createElement(ReferenceLibraryPanel, {
      documents,
      canPublish: canPublishFor(roles),
      viewerId: "00000000-0000-0000-0000-0000000000v1",
      scannerConfigured,
    }),
  );

const searchFor = (roles: string[]) =>
  renderToStaticMarkup(
    createElement(ReferenceSearch, {
      canPublish: canPublishFor(roles),
      current: {},
      resultCount: 0,
    }),
  );

/** Semantic facts about rendered markup. No label matching. */
const facts = (html: string) => ({
  /** The upload form is identified by its file input, not by its heading. */
  uploadForm: /<input[^>]*type="file"/.test(html),
  pdfOnly: /accept="application\/pdf"/.test(html),
  /** The publisher antivirus notice is the panel's only role="note" region. */
  publisherNotices: (html.match(/role="note"/g) ?? []).length,
  forms: (html.match(/<form/g) ?? []).length,
  statusFilter: /<select[^>]*name="status"/.test(html),
  fieldNames: [...html.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]),
  selects: (html.match(/<select/g) ?? []).length,
});

/** A quarantined document, for the per-row control assertions. */
const quarantined: ReferenceDocument = {
  id: "00000000-0000-0000-0000-00000000d001",
  category: "CIRCULAR",
  title: "Circulaire de test",
  sourceAuthority: "DGD",
  edition: null,
  publishedOn: null,
  referenceCode: "TEST-1",
  customsRegimes: ["TRANSIT"],
  version: 1,
  supersedesId: null,
  supersededById: null,
  supersededAt: null,
  sizeBytes: 4096,
  contentSha256: "a".repeat(64),
  status: "QUARANTINE",
  licenceStatus: "RESTRICTED",
  redistributionAllowed: false,
  licenceNote: null,
  provenanceVerified: false,
  legalVersionVerified: false,
  scanStatus: "UNSCANNED",
  scanCompletedAt: null,
  scannerName: null,
  scanDetail: null,
  submittedForPublicationBy: null,
  submittedForPublicationAt: null,
  uploadedBy: "00000000-0000-0000-0000-0000000000u1",
  uploadedAt: "2026-10-18T00:00:00.000Z",
  publishedBy: null,
  publishedAt: null,
  withdrawnAt: null,
  notes: null,
};

// ===========================================================================
describe("the grant fixture tracks the migration", () => {
  it("1 — publish is granted to exactly SYSTEM_ADMIN and CHIEF_OF_TRANSIT", () => {
    // If a migration ever widens this, every expectation below is wrong and
    // must be revisited deliberately rather than quietly.
    expect([...PUBLISHERS].sort()).toEqual(["CHIEF_OF_TRANSIT", "SYSTEM_ADMIN"]);
  });

  it("2 — the read grant includes the roles these tests rely on, and no publisher accident", () => {
    for (const r of ["COORDINATOR", "CUSTOMS_DECLARANT", "SYSTEM_ADMIN", "CHIEF_OF_TRANSIT"]) {
      expect(READERS, r).toContain(r);
    }
    expect(PUBLISHERS).not.toContain("COORDINATOR");
    expect(PUBLISHERS).not.toContain("CUSTOMS_DECLARANT");
  });

  it("3 — the derivation agrees with the grant", () => {
    expect(canPublishFor(["SYSTEM_ADMIN"])).toBe(true);
    expect(canPublishFor(["CHIEF_OF_TRANSIT"])).toBe(true);
    expect(canPublishFor(["COORDINATOR"])).toBe(false);
    expect(canPublishFor(["CUSTOMS_DECLARANT"])).toBe(false);
  });
});

// ===========================================================================
describe("SYSTEM_ADMIN — publisher surface", () => {
  it("4 — the upload form is rendered, and it accepts PDF only", () => {
    const f = facts(panelFor(["SYSTEM_ADMIN"], false));
    expect(f.uploadForm).toBe(true);
    expect(f.pdfOnly).toBe(true);
    expect(f.forms).toBe(1);
  });

  it("5 — the scanner-unavailable notice is rendered when no scanner is configured", () => {
    expect(facts(panelFor(["SYSTEM_ADMIN"], false)).publisherNotices).toBe(1);
  });

  it("6 — the publication-state filter is rendered", () => {
    const f = facts(searchFor(["SYSTEM_ADMIN"]));
    expect(f.statusFilter).toBe(true);
    expect(f.selects).toBe(2); // category + status
  });
});

// ===========================================================================
describe("CHIEF_OF_TRANSIT — the same publisher surface", () => {
  it("7 — upload form, notice and state filter are all rendered", () => {
    const p = facts(panelFor(["CHIEF_OF_TRANSIT"], false));
    expect(p.uploadForm).toBe(true);
    expect(p.publisherNotices).toBe(1);
    expect(facts(searchFor(["CHIEF_OF_TRANSIT"])).statusFilter).toBe(true);
  });

  it("8 — and its surface is byte-identical to SYSTEM_ADMIN's", () => {
    // The gate is the PERMISSION, never the role. Two roles conferring the same
    // permission must produce the same interface, or something is keyed on a
    // role name somewhere it should not be.
    expect(panelFor(["CHIEF_OF_TRANSIT"], false)).toBe(panelFor(["SYSTEM_ADMIN"], false));
    expect(searchFor(["CHIEF_OF_TRANSIT"])).toBe(searchFor(["SYSTEM_ADMIN"]));
  });
});

// ===========================================================================
describe("CUSTOMS_DECLARANT — reader surface, no publisher controls", () => {
  const panel = facts(panelFor(["CUSTOMS_DECLARANT"], false));
  const search = facts(searchFor(["CUSTOMS_DECLARANT"]));

  it("9 — NO upload form, and no form at all in the panel", () => {
    // The UAT-01B observation, now permanent.
    expect(panel.uploadForm).toBe(false);
    expect(panel.forms).toBe(0);
  });

  it("10 — NO file input anywhere, under any markup", () => {
    expect(panelFor(["CUSTOMS_DECLARANT"], false)).not.toContain('type="file"');
  });

  it("11 — NO publisher antivirus notice, configured or not", () => {
    expect(facts(panelFor(["CUSTOMS_DECLARANT"], false)).publisherNotices).toBe(0);
    expect(facts(panelFor(["CUSTOMS_DECLARANT"], true)).publisherNotices).toBe(0);
  });

  it("12 — NO publication-state filter", () => {
    expect(search.statusFilter).toBe(false);
    expect(search.selects).toBe(1); // category only
  });

  it("13 — but every permitted search axis REMAINS available", () => {
    // Hiding the publisher control must not degrade the reader's own tools.
    for (const name of ["q", "category", "regime", "source", "version", "currentOnly"]) {
      expect(search.fieldNames, name).toContain(name);
    }
    expect(search.fieldNames).not.toContain("status");
  });

  it("14 — and no per-document publisher control is rendered, even for a quarantined row", () => {
    // Defence in depth: `getLibrary` would never send a reader a QUARANTINE
    // document (it re-states the PUBLISHED filter for the service-role client).
    // This asserts the component would not expose controls even if one arrived.
    const html = panelFor(["CUSTOMS_DECLARANT"], false, [quarantined]);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("<form");
    expect((html.match(/<button/g) ?? []).length).toBe(0);
  });
});

// ===========================================================================
describe("COORDINATOR — reader only", () => {
  it("15 — reader surface, no publisher controls", () => {
    const p = facts(panelFor(["COORDINATOR"], false));
    expect(p.uploadForm).toBe(false);
    expect(p.publisherNotices).toBe(0);
    expect(p.forms).toBe(0);
    expect(facts(searchFor(["COORDINATOR"])).statusFilter).toBe(false);
  });

  it("16 — identical to the declarant's surface", () => {
    // Both hold read and not publish; neither role name may matter.
    expect(panelFor(["COORDINATOR"], false)).toBe(panelFor(["CUSTOMS_DECLARANT"], false));
    expect(searchFor(["COORDINATOR"])).toBe(searchFor(["CUSTOMS_DECLARANT"]));
  });
});

// ===========================================================================
describe("multi-role — the effective union decides, never a displayed role", () => {
  it("17 — COORDINATOR + SYSTEM_ADMIN gets the publisher interface", () => {
    // The condition that made a real production observation ambiguous: the
    // owner's account held COORDINATOR as well, and the union grants publish.
    expect(canPublishFor(["COORDINATOR", "SYSTEM_ADMIN"])).toBe(true);
    const p = facts(panelFor(["COORDINATOR", "SYSTEM_ADMIN"], false));
    expect(p.uploadForm).toBe(true);
    expect(p.publisherNotices).toBe(1);
    expect(facts(searchFor(["COORDINATOR", "SYSTEM_ADMIN"])).statusFilter).toBe(true);
  });

  it("18 — role ORDER does not change the interface", () => {
    // A "primary role" listed first must not override the effective union.
    expect(panelFor(["COORDINATOR", "SYSTEM_ADMIN"], false))
      .toBe(panelFor(["SYSTEM_ADMIN", "COORDINATOR"], false));
    expect(panelFor(["COORDINATOR", "SYSTEM_ADMIN"], false))
      .toBe(panelFor(["SYSTEM_ADMIN"], false));
  });

  it("19 — adding read-only roles to a publisher takes nothing away", () => {
    expect(panelFor(["SYSTEM_ADMIN", "COORDINATOR", "CUSTOMS_DECLARANT"], false))
      .toBe(panelFor(["SYSTEM_ADMIN"], false));
  });

  it("20 — and stacking read-only roles never confers publish", () => {
    const readersOnly = READERS.filter((r) => !PUBLISHERS.includes(r));
    expect(readersOnly.length).toBeGreaterThan(2);
    expect(canPublishFor(readersOnly)).toBe(false);
    expect(facts(panelFor(readersOnly, false)).uploadForm).toBe(false);
  });

  it("21 — the components receive no role at all", () => {
    // The strongest form of "a displayed role cannot override the contract":
    // neither component is given one. There is nothing to override with.
    const panelSrc = read("components/customs/reference-library-panel.tsx");
    const searchSrc = read("components/customs/reference-search.tsx");
    const props = (s: string) => s.slice(0, s.indexOf("}) {"));
    for (const [name, src] of [["panel", panelSrc], ["search", searchSrc]] as const) {
      expect(props(src), name).not.toMatch(/\brole\s*[:?]/);
      expect(props(src), name).not.toContain("SYSTEM_ADMIN");
      expect(props(src), name).not.toContain("CHIEF_OF_TRANSIT");
    }
  });
});

// ===========================================================================
describe("scanner configured / unconfigured", () => {
  it("22 — the notice appears only when a publisher has no scanner", () => {
    const matrix = [
      { roles: ["SYSTEM_ADMIN"], scanner: false, notices: 1 },
      { roles: ["SYSTEM_ADMIN"], scanner: true, notices: 0 },
      { roles: ["CUSTOMS_DECLARANT"], scanner: false, notices: 0 },
      { roles: ["CUSTOMS_DECLARANT"], scanner: true, notices: 0 },
    ] as const;
    for (const c of matrix) {
      expect(facts(panelFor([...c.roles], c.scanner)).publisherNotices, JSON.stringify(c))
        .toBe(c.notices);
    }
  });

  it("23 — the upload form does NOT depend on the scanner", () => {
    // Uploading into quarantine is allowed without a scanner; only publication
    // is gated on a CLEAN verdict. Coupling the two would silently remove the
    // ability to stage documents ahead of provisioning one.
    expect(facts(panelFor(["SYSTEM_ADMIN"], true)).uploadForm).toBe(true);
    expect(facts(panelFor(["SYSTEM_ADMIN"], false)).uploadForm).toBe(true);
  });

  it("24 — the scanner flag is display-only; the server still refuses", () => {
    // These tests render a UI. They must not be read as evidence that the
    // publication gate holds — that lives in the action and the database.
    const actions = read("lib/customs/reference/actions.ts");
    expect(actions).toContain('if (!scanningAvailable()) return { ok: false, error: "scanner_unavailable" };');
    expect((actions.match(/assertPermission\("customs:reference:publish"\)/g) ?? []).length).toBe(6);
    const panelSrc = read("components/customs/reference-library-panel.tsx");
    expect(panelSrc).not.toContain("process.env");
  });
});
