/**
 * MAYA-P0.8-C — the « Dossier mère » selector stops dragging the search engine.
 * ---------------------------------------------------------------------------
 * The dossier page called `listFiles()` purely to populate a two-field select.
 * Since P0.6-B/C that call maps up to 2000 dossiers through the full search
 * projection, batches a customs read whenever the viewer holds `customs:read`,
 * and derives a MAYA-compatible label per row — all discarded except
 * `{ id, fileNumber }`, on every dossier page load, for anyone who can edit.
 *
 * Three properties this suite defends:
 *
 *   1. THE HEAVY PIPELINE IS GONE from this path — no search projection, no
 *      customs read, no MAYA derivation.
 *   2. VISIBILITY IS UNCHANGED, and is now decided one layer LOWER: the reader
 *      runs on the user-context client, so the RLS policy itself is the filter
 *      rather than an application mirror of it.
 *   3. NOTHING ELSE MOVED — no parent/child semantics, no Q5, and the search
 *      pipeline the dossier LIST still uses is untouched.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const SERVICE = "lib/files/service.ts";
const PAGE = "app/files/[id]/page.tsx";
const FORM = "components/files/file-form.tsx";

/** The body of listParentCandidates only — comments stripped. */
function readerBody(): string {
  const s = code(SERVICE);
  const start = s.indexOf("export async function listParentCandidates");
  expect(start, "listParentCandidates must exist").toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

// ===========================================================================
describe("the selector no longer depends on the search pipeline", () => {
  it("the dossier page does not call listFiles at all", () => {
    const p = code(PAGE);
    expect(p).not.toContain("listFiles(");
    // …and no longer even imports it.
    expect(p).not.toMatch(/import \{[^}]*\blistFiles\b[^}]*\}/);
    expect(p).toContain("listParentCandidates(file.id)");
  });

  it("the reader performs no customs read and derives no MAYA label", () => {
    const b = readerBody();
    expect(b).not.toContain("customs_record");
    expect(b).not.toContain("deriveMayaLabelFromRow");
    expect(b).not.toContain("ocean_container");
    // No search/filter/sort machinery either.
    expect(b).not.toMatch(/applyFileFilters|sortFiles|FileSearchRow|matchesSearch/);
  });

  it("it selects only the two columns the selector renders", () => {
    expect(readerBody()).toContain('.select("id, file_number")');
    // The form's contract is exactly those two fields.
    expect(read(FORM)).toContain("parents?: { id: string; fileNumber: string }[]");
  });

  it("exactly one query, and none inside a mapping", () => {
    const b = readerBody();
    expect((b.match(/\.from\(/g) ?? []).length).toBe(1);
    const map = b.slice(b.indexOf(".map("));
    expect(map).not.toMatch(/await|\.from\(|supabase/);
  });

  it("the dossier LIST still uses the search pipeline — only this path changed", () => {
    const s = code(SERVICE);
    expect(s).toContain("export async function listFiles");
    const listBody = s.slice(s.indexOf("export async function listFiles"), s.indexOf("export async function", s.indexOf("export async function listFiles") + 1));
    expect(listBody).toContain("applyFileFilters");
    expect(listBody).toContain("deriveMayaLabelFromRow");
  });
});

// ===========================================================================
describe("visibility is unchanged, and now enforced by the database", () => {
  it("the same permission gates it", () => {
    expect(readerBody()).toContain('assertPermission("file:read")');
  });

  it("it runs on the USER-CONTEXT client, so RLS is the filter", () => {
    const b = readerBody();
    expect(b).toContain("getServerSupabaseClient()");
    expect(b).not.toContain("getAdminSupabaseClient");
    // resolveFileScope exists to REBUILD that filter for admin reads; a
    // user-context read needs no mirror of the policy.
    expect(b).not.toContain("resolveFileScope");
  });

  it("the policy it relies on really is the scoped one", () => {
    const m = read("supabase/migrations/20260614000005_scope_visibility.sql");
    expect(m).toMatch(/create policy operational_file_select[\s\S]{0,240}can_read_file\(id\)/);
    expect(m).toMatch(/create policy operational_file_select[\s\S]{0,240}has_permission\('file:read'\)/);
  });

  it("it is tenant-scoped explicitly as well as by policy", () => {
    expect(readerBody()).toContain('.eq("tenant_id", user.tenantId)');
  });

  it("the selector stays behind the same edit permission", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canUpdate \? await listParentCandidates/);
    expect(p).toMatch(/const canUpdate = hasPermission\(permissions, "file:update"\)/);
  });
});

// ===========================================================================
describe("behaviour is preserved, not quietly narrowed", () => {
  it("the dossier itself is excluded — in the query", () => {
    expect(readerBody()).toContain('.neq("id", excludeFileId)');
    // The form keeps its own guard; defence in depth, not a replacement.
    expect(read(FORM)).toMatch(/parents\.filter\(\(p\) => p\.id !== fileId\)/);
  });

  it("the same bound and the same newest-first ordering are kept", () => {
    const b = readerBody();
    expect(b).toContain(".limit(2000)");
    expect(b).toMatch(/\.order\("created_at", \{ ascending: false \}\)/);
  });

  it("no status, archived or type filter was introduced", () => {
    // The selector never had one; adding one here would silently change which
    // dossiers may be chosen as a parent.
    const b = readerBody();
    expect(b).not.toMatch(/\.eq\("status"|archived_at|\.eq\("type"|isActiveFile/);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("parent integrity stays in the database, and is not duplicated here", () => {
    expect(readerBody()).not.toMatch(/cycle|parent_file_id|depth/i);
    const m = read("supabase/migrations/20260822000001_dossier_fact_convergence.sql");
    expect(m).toContain("enforce_file_parent");
    expect(m).toContain("parent dossier chain forms a cycle");
  });

  it("no Q5 semantics were introduced", () => {
    const b = readerBody();
    expect(b.toLowerCase()).not.toContain("groupage");
    expect(b).not.toMatch(/dossiermere|consolidat|children/i);
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const bi = read("lib/platform/ops/build-info.ts");
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(bi)![1]));
    expect(migrations.filter((f) => /parent|selector/i.test(f))).toEqual([]);
  });

  it("QC1–QC6 and PG-1/PG-6 are untouched", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    expect(code("lib/files/qc2.ts")).toContain("QC2_TRANSMISSION_CONFLICT");
    expect(code("lib/files/qc4.ts")).toContain("QC4_VALIDATION_IS_NOT_A_VERDICT");
    expect(code("lib/files/qc5.ts")).toContain("QC5_NO_VEHICLE_CONFORMITY");
    expect(code("lib/files/qc6.ts")).toContain("QC6_NO_ARCHIVE_AUTHORITY");
    expect(code("lib/customs/actions.ts")).toContain('assertPermission("customs:validate")');
    expect(read("supabase/migrations/20260826000001_customs_editor_attribution.sql"))
      .toMatch(/v_editor = p_actor/);
    // The Account Manager identity question is deliberately still open.
    expect(code("lib/files/actions.ts")).toContain("account_manager_id: admin.id");
  });
});
