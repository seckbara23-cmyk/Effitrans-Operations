/**
 * CUSTOMS-REF-01A / REF-1 — the Customs Reference Library, structurally.
 * ===========================================================================
 * WHAT THIS SLICE IS. A place for the Customs Department's reference material,
 * with publication as a governed act rather than a side effect of upload.
 *
 * WHAT THIS SUITE DEFENDS. Five things that are declarative, invisible on the
 * happy path, and therefore easy for a later edit to undo:
 *
 *   1. A library document is NOT a dossier document. The table has no file_id,
 *      and nothing in the dossier evidence engine knows it exists.
 *   2. Publication cannot be claimed without provenance, legal version and a
 *      licence ruling — and the HS Explanatory Notes need the strongest one.
 *   3. An upload lands QUARANTINE with every safety default at its safe value.
 *      There is no malware scanner; this is what stands in for one.
 *   4. The bytes leave the server only through the streaming route. No signed
 *      URL is minted, and the bucket has no storage.objects policy.
 *   5. Readers read. Uploading, publishing, replacing and withdrawing all need
 *      the second permission, and no portal or driver role holds either.
 *
 * The behavioural half runs against real PostgreSQL in
 * tests/journey/customs-reference-library.journey.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { t } from "@/lib/i18n";
import { AuditActions } from "@/lib/audit/events";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { MIGRATION_COUNT, LATEST_MIGRATION } from "@/lib/platform/ops/build-info";
import {
  CATEGORY_LABEL_FR,
  LICENCE_LABEL_FR,
  LICENCE_PENDING_CATEGORIES,
  LICENCE_STATUSES,
  REFERENCE_CATEGORIES,
  STATUS_LABEL_FR,
  isLicenceStatus,
  isReferenceCategory,
  publicationBlockers,
} from "@/lib/customs/reference/types";
import {
  ACCEPTED_MIME,
  MAX_UPLOAD_BYTES,
  MIN_UPLOAD_BYTES,
  BUCKET_LIMIT_BYTES,
  buildReferencePath,
  hasPdfSignature,
  referenceFileName,
  validateUpload,
} from "@/lib/customs/reference/validate";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Assert on CODE, never on prose: this slice's comments name every token. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const MIGRATION = "supabase/migrations/20261016000001_customs_reference_library.sql";
const migration = strip(read(MIGRATION));
const verifier = read(`supabase/verifiers/20261016000001_customs_reference_library.verify.sql`);
const uploadRoute = strip(read("app/api/customs/reference/upload/route.ts"));
const viewRoute = strip(read("app/api/customs/reference/[id]/pdf/route.ts"));
const actions = strip(read("lib/customs/reference/actions.ts"));
const service = strip(read("lib/customs/reference/service.ts"));
const seed = strip(read("supabase/seed.sql"));
const gate = strip(read("supabase/migrations/20261017000001_customs_reference_publication_gate.sql"));
const gateVerifier = read("supabase/verifiers/20261017000001_customs_reference_publication_gate.verify.sql");
const replay = strip(read("supabase/migrations/20261018000001_customs_reference_scan_replay.sql"));
const replayVerifier = read("supabase/verifiers/20261018000001_customs_reference_scan_replay.verify.sql");
const templates = strip(read("lib/platform/role-templates.ts"));

/** A minimal, valid PDF buffer of at least MIN_UPLOAD_BYTES. */
function pdfBytes(size = 2048): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 0); // %PDF-1.7
  return b;
}

const validInput = {
  bytes: pdfBytes(),
  declaredMime: "application/pdf",
  declaredSize: 2048,
  title: "Code des douanes",
  sourceAuthority: "Direction Générale des Douanes",
  referenceCode: "CODE-DOUANES",
  categoryValid: true,
  publishedOn: "2022-01-01",
};

// ===========================================================================
describe("REF-1 — upload validation decides from the BYTES", () => {
  it("1 — a real PDF passes", () => {
    expect(validateUpload(validInput)).toEqual({ ok: true });
  });

  it("2 — the magic number is what decides, not the declared type", () => {
    // Declares application/pdf and carries HTML. This is the attack the
    // signature check exists for.
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>".padEnd(2048, " "));
    expect(hasPdfSignature(html)).toBe(false);
    expect(validateUpload({ ...validInput, bytes: html, declaredSize: html.length }))
      .toEqual({ ok: false, error: "not_a_pdf" });
  });

  it("3 — a non-PDF declared type is refused before the bytes are inspected", () => {
    expect(validateUpload({ ...validInput, declaredMime: "image/png" }))
      .toEqual({ ok: false, error: "mime_not_pdf" });
    expect(validateUpload({ ...validInput, declaredMime: null }))
      .toEqual({ ok: false, error: "mime_not_pdf" });
  });

  it("4 — size bounds, and a declared size that disagrees with the payload", () => {
    expect(validateUpload({ ...validInput, bytes: pdfBytes(10), declaredSize: 10 }))
      .toEqual({ ok: false, error: "too_small" });
    const big = pdfBytes(MAX_UPLOAD_BYTES + 1);
    expect(validateUpload({ ...validInput, bytes: big, declaredSize: big.length }))
      .toEqual({ ok: false, error: "too_large" });
    // The request says one thing and the body another: refuse, never pick one.
    expect(validateUpload({ ...validInput, declaredSize: 999 }))
      .toEqual({ ok: false, error: "size_mismatch" });
  });

  it("5 — an empty or absent file is refused", () => {
    expect(validateUpload({ ...validInput, bytes: null })).toEqual({ ok: false, error: "missing_file" });
    expect(validateUpload({ ...validInput, bytes: new Uint8Array(0) }))
      .toEqual({ ok: false, error: "missing_file" });
  });

  it("6 — the metadata the row cannot be without", () => {
    expect(validateUpload({ ...validInput, title: "   " })).toEqual({ ok: false, error: "title_required" });
    expect(validateUpload({ ...validInput, sourceAuthority: "" }))
      .toEqual({ ok: false, error: "authority_required" });
    expect(validateUpload({ ...validInput, categoryValid: false }))
      .toEqual({ ok: false, error: "category_invalid" });
    // REF-1-HARDEN (F2) — the business key is mandatory.
    expect(validateUpload({ ...validInput, referenceCode: "   " }))
      .toEqual({ ok: false, error: "reference_code_required" });
    expect(validateUpload({ ...validInput, referenceCode: null }))
      .toEqual({ ok: false, error: "reference_code_required" });
    expect(validateUpload({ ...validInput, publishedOn: "01/01/2022" }))
      .toEqual({ ok: false, error: "published_on_invalid" });
    // Absent is fine; malformed is not.
    expect(validateUpload({ ...validInput, publishedOn: null })).toEqual({ ok: true });
  });

  it("7 — the ceiling is stated at the boundary that can explain it", () => {
    // The bucket accepts more than this route can carry. The smaller number is
    // the honest one, and the French sentence names it.
    expect(MAX_UPLOAD_BYTES).toBeLessThan(BUCKET_LIMIT_BYTES);
    expect(MIN_UPLOAD_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(ACCEPTED_MIME).toBe("application/pdf");
    expect(t.customs.reference.errors.too_large).toContain("4 Mo");
  });
});

// ===========================================================================
describe("REF-1 — the object key cannot be influenced by the uploader", () => {
  it("8 — the path is tenant + document id, and the filename is nowhere in it", () => {
    const path = buildReferencePath("tenant-1", "doc-9");
    expect(path).toBe("tenant-1/doc-9.pdf");
    // Nothing from the upload reaches the key, so traversal has no vector.
    expect(buildReferencePath("t", "../../etc/passwd")).not.toContain("..\\");
    expect(strip(read("lib/customs/reference/validate.ts"))).not.toContain("file.name");
    expect(uploadRoute).toContain("buildReferencePath(user.tenantId, documentId)");
    expect(uploadRoute).toContain("const documentId = randomUUID();");
  });

  it("9 — the download filename is derived, never echoed", () => {
    expect(referenceFileName('../../evil"; rm -rf /', 2)).toBe("evil-rm--rf-v2.pdf");
    expect(referenceFileName("Tarif Extérieur Commun", 1)).toBe("Tarif-Exterieur-Commun-v1.pdf");
    expect(referenceFileName("", 1)).toBe("document-v1.pdf");
  });
});

// ===========================================================================
describe("REF-1 — publication is a governed act", () => {
  const base = {
    status: "QUARANTINE" as const,
    category: "LEGISLATION" as const,
    licenceStatus: "INTERNAL_ONLY" as const,
    provenanceVerified: true,
    legalVersionVerified: true,
  };

  it("10 — a fully verified, licensed document has no blockers", () => {
    expect(publicationBlockers(base)).toEqual([]);
  });

  it("11 — each missing fact blocks publication by name", () => {
    expect(publicationBlockers({ ...base, provenanceVerified: false })).toContain("provenance_unverified");
    expect(publicationBlockers({ ...base, legalVersionVerified: false })).toContain("legal_version_unverified");
    expect(publicationBlockers({ ...base, licenceStatus: "RESTRICTED" })).toContain("licence_unresolved");
    expect(publicationBlockers({ ...base, status: "PUBLISHED" })).toContain("already_published");
    expect(publicationBlockers({ ...base, status: "WITHDRAWN" })).toContain("withdrawn");
  });

  it("12 — the HS Explanatory Notes need the strongest licence, not merely a ruling", () => {
    expect(LICENCE_PENDING_CATEGORIES).toEqual(["EXPLANATORY_NOTES"]);
    // INTERNAL_ONLY satisfies the general rule and is still not enough here.
    expect(publicationBlockers({ ...base, category: "EXPLANATORY_NOTES" }))
      .toContain("explanatory_notes_licence_required");
    expect(
      publicationBlockers({
        ...base,
        category: "EXPLANATORY_NOTES",
        licenceStatus: "APPROVED_REDISTRIBUTION",
      }),
    ).toEqual([]);
    // And the same rule exists in the database, not only here.
    expect(migration).toContain("customs_reference_explanatory_notes_licence");
    expect(migration).toMatch(/category <> 'EXPLANATORY_NOTES'[\s\S]*?APPROVED_REDISTRIBUTION/);
  });

  it("13 — the database makes an unverified publication unrepresentable", () => {
    expect(migration).toContain("customs_reference_published_is_verified");
    for (const token of [
      "published_by is not null",
      "published_at is not null",
      "provenance_verified",
      "legal_version_verified",
      "licence_status <> 'RESTRICTED'",
    ]) {
      expect(migration, token).toContain(token);
    }
  });

  it("14 — redistribution requires the strongest licence, in the database too", () => {
    expect(migration).toContain("customs_reference_redistribution_needs_licence");
    expect(migration).toContain("not redistribution_allowed or licence_status = 'APPROVED_REDISTRIBUTION'");
  });
});

// ===========================================================================
describe("REF-1 — the safe defaults are the database's, not the code's", () => {
  it("15 — every safety column defaults to its safe value", () => {
    expect(migration).toContain("status                  text not null default 'QUARANTINE'");
    expect(migration).toContain("licence_status           text not null default 'RESTRICTED'");
    expect(migration).toContain("redistribution_allowed   boolean not null default false");
    expect(migration).toContain("provenance_verified      boolean not null default false");
    expect(migration).toContain("legal_version_verified   boolean not null default false");
  });

  it("16 — the upload route's INSERT sets none of them", () => {
    // If the route passed these, a later edit could publish on upload without
    // touching a migration. The defaults must be the only source. Scoped to the
    // insert payload, because `status:` legitimately names the HTTP code and
    // the response body elsewhere in the file.
    // Anchored on the INSERT itself: the HTTP early-returns between the
    // predecessor lookup and the insert carry `status:` for their status codes.
    const insert = uploadRoute.slice(
      uploadRoute.indexOf(".insert({"),
      uploadRoute.indexOf('.select("id")', uploadRoute.indexOf(".insert({")),
    );
    expect(insert.length).toBeGreaterThan(0);
    for (const column of [
      "status:",
      "licence_status:",
      "redistribution_allowed:",
      "provenance_verified:",
      "legal_version_verified:",
      "published_by:",
      "published_at:",
      "superseded_by_id:",
      "superseded_at:",
    ]) {
      expect(insert, column).not.toContain(column);
    }
    // …and it says the quarantine state out loud to its caller.
    expect(uploadRoute).toContain('status: "QUARANTINE"');
  });

  it("17 — exactly one thing in the slice can set PUBLISHED, and it is in the database", () => {
    expect(uploadRoute).not.toContain("publishDocument");
    // REF-1-PUBLISH-GATE moved publication into `publish_customs_reference`.
    // The application no longer writes the status at all, which is stronger
    // than it writing it once: there is no second code path to audit.
    expect(actions).not.toContain('.update({ status: "PUBLISHED"');
    expect(actions).toContain('supabase.rpc("publish_customs_reference"');
    // …and the RPC sets it exactly once.
    expect((gate.match(/set\s+status\s+=\s+'PUBLISHED'/g) ?? []).length).toBe(1);
  });
});

// ===========================================================================
describe("REF-1 — a library document is not a dossier document", () => {
  it("18 — the table has no file_id, in the migration or the types", () => {
    // THE structural guarantee. `document.file_id` is NOT NULL, so the library
    // could only have lived there behind a synthetic dossier; a separate table
    // with no file_id is unreachable from the evidence engine, which keys on
    // (file_id, type_code).
    const table = migration.slice(
      migration.indexOf("create table if not exists public.customs_reference_document"),
      migration.indexOf("comment on table"),
    );
    expect(table.length).toBeGreaterThan(0);
    expect(table).not.toContain("file_id");
    expect(strip(read("lib/customs/reference/types.ts"))).not.toContain("fileId");
  });

  it("19 — no document_type row, and no dossier document table, is touched", () => {
    expect(migration).not.toContain("public.document_type");
    expect(migration).not.toContain("insert into public.document");
    expect(migration).not.toContain("alter table public.document");
    // The slice's own modules never read the dossier document table either.
    expect(service).not.toContain('from("document")');
    expect(actions).not.toContain('from("document")');
    expect(uploadRoute).not.toContain('from("document")');
  });

  it("20 — the evidence engine does not know this table exists", () => {
    const evidence = strip(read("lib/process/engine/evidence.ts"));
    expect(evidence).not.toContain("customs_reference");
    const registry = strip(read("lib/process/effitrans-process.ts"));
    expect(registry).not.toContain("customs_reference");
  });

  it("21 — and it is registered as tenant-scoped, so service-role reads are guarded", () => {
    expect(TENANT_SCOPED_TABLES.has("customs_reference_document")).toBe(true);
  });
});

// ===========================================================================
describe("REF-1 — the bytes leave the server one way only", () => {
  it("22 — the bucket is private, PDF-only, and has no storage policy", () => {
    expect(migration).toContain("'customs-reference', 'customs-reference', false");
    expect(migration).toContain("array['application/pdf']");
    expect(migration).not.toContain("storage.objects");
    expect(migration).not.toContain(", true,"); // never a public bucket
  });

  it("23 — the viewer STREAMS; it mints no signed URL", () => {
    expect(viewRoute).toContain(".download(doc.storage_path)");
    expect(viewRoute).not.toContain("createSignedUrl");
    expect(viewRoute).not.toContain("getPublicUrl");
    expect(viewRoute).toContain('"Cache-Control": "private, no-store"');
    expect(viewRoute).toContain('"Content-Type": "application/pdf"');
    // No module hands a URL to a PERSON. SCANNER-01 added exactly one signed
    // URL to the slice — the scanner's download link — and the distinction is
    // the point: a viewer link can be pasted into a chat and licence-restricted
    // material redistributed, which is what the licence gate exists to prevent;
    // the scanner is one automated consumer with no UI, and the alternative is
    // handing it credentials to the whole bucket.
    expect(service).not.toContain("createSignedUrl");
    expect((actions.match(/createSignedUrl/g) ?? []).length).toBe(1);
    const scanFn = actions.slice(actions.indexOf("export async function requestScan"));
    expect(scanFn).toContain("createSignedUrl");
    // …and it is scoped to ONE object with a short TTL, not to the bucket.
    expect(scanFn).toContain("createSignedUrl(doc.storage_path, SCAN_DOWNLOAD_TTL_SECONDS)");
  });

  it("24 — a failed insert does not leave the object behind", () => {
    expect(uploadRoute).toContain("await supabase.storage.from(BUCKET).remove([path]);");
    const insert = uploadRoute.indexOf(".insert({");
    expect(uploadRoute.indexOf("remove([path])", insert)).toBeGreaterThan(insert);
  });

  it("25 — the checksum describes what was stored", () => {
    // One buffer, hashed and uploaded. Hashing a separately-read stream would
    // leave room for the two to differ.
    expect(uploadRoute).toContain('createHash("sha256").update(bytes).digest("hex")');
    expect(uploadRoute).toContain(".upload(path, bytes,");
    expect(migration).toContain("content_sha256 ~ '^[0-9a-f]{64}$'");
  });
});

// ===========================================================================
describe("REF-1 — authority, and who may not reach the library at all", () => {
  it("26 — every server entry point checks authorization independently", () => {
    expect(uploadRoute).toContain('hasPermission(permissions, "customs:reference:publish")');
    expect(viewRoute).toContain('hasPermission(permissions, "customs:reference:read")');
    expect(service).toContain('assertPermission("customs:reference:read")');
    // All SIX governance acts, each gated on publish: the original four plus
    // REF-1-PUBLISH-GATE's submission and scan request.
    expect((actions.match(/assertPermission\("customs:reference:publish"\)/g) ?? []).length).toBe(6);
    for (const act of ["submitForPublication", "requestScan"]) {
      expect(actions, act).toContain(`export async function ${act}(`);
    }
    // …and the read permission is never what authorises a write.
    expect(actions).not.toContain('assertPermission("customs:reference:read")');
  });

  it("27 — the checks come BEFORE any work in both routes", () => {
    for (const [name, route] of [["upload", uploadRoute], ["view", viewRoute]] as const) {
      const auth = route.indexOf("getCurrentUser()");
      const perm = route.indexOf("hasPermission(permissions");
      const work = route.indexOf("getAdminSupabaseClient()");
      expect(auth, name).toBeGreaterThan(-1);
      expect(perm, name).toBeGreaterThan(auth);
      expect(work, name).toBeGreaterThan(perm);
    }
  });

  it("28 — no portal branch exists in either route", () => {
    // The customer portal has its own session type. Never consulting it is what
    // makes a portal account unable to reach a byte of this library.
    expect(uploadRoute).not.toContain("getCurrentPortalUser");
    expect(viewRoute).not.toContain("getCurrentPortalUser");
    expect(service).not.toContain("getCurrentPortalUser");
  });

  it("29 — a reader sees PUBLISHED only, and the filter is restated for the service role", () => {
    // A service-role read BYPASSES RLS, so the policy does not constrain it and
    // the application must re-state the rule rather than inherit it.
    expect(service).toContain('if (!canPublish) query = query.eq("status", "PUBLISHED");');
    expect(service).toContain('if (!canPublish && data.status !== "PUBLISHED") return null;');
    // Every read is tenant-scoped.
    expect((service.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("30 — the RLS policy is select-only and names both permissions", () => {
    expect(migration).toContain("alter table public.customs_reference_document enable row level security");
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("tenant_id = public.auth_tenant_id()");
    expect(migration).toContain("public.has_permission('customs:reference:read')");
    expect(migration).toContain("public.has_permission('customs:reference:publish')");
    // The actions are the boundary: no write policy anywhere.
    expect(migration).not.toMatch(/for (insert|update|delete)/);
    expect(migration).toContain("grant select on public.customs_reference_document to authenticated");
    expect(migration).not.toMatch(/grant (insert|update|delete)/);
  });

  it("31 — publish is granted to two roles, read to the customs chain", () => {
    const publishGrant = migration.slice(migration.indexOf("p.code = 'customs:reference:publish'"));
    expect(publishGrant).toContain("'SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT'");
    const readGrant = migration.slice(
      migration.indexOf("p.code = 'customs:reference:read'"),
      migration.indexOf("p.code = 'customs:reference:publish'"),
    );
    for (const role of ["SYSTEM_ADMIN", "CEO", "CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT",
                        "CUSTOMS_FIELD_AGENT", "CUSTOMS_FINANCE_OFFICER", "COORDINATOR",
                        "OPS_SUPERVISOR", "DOCUMENTATION_OFFICER", "COMPLIANCE_HSSE"]) {
      expect(readGrant, role).toContain(`'${role}'`);
    }
  });

  it("32 — no portal, driver or field-courier role is granted either permission", () => {
    const grants = migration.slice(migration.indexOf("insert into public.permission"));
    for (const role of ["CLIENT_USER", "DRIVER", "COURIER", "PICKUP_AGENT", "PARTNER_AGENT"]) {
      expect(grants, role).not.toContain(`'${role}'`);
    }
    // The role TEMPLATES must agree with the migration, or the admin UI would
    // offer a grant the slice never ratified.
    expect((templates.match(/"customs:reference:publish"/g) ?? []).length).toBe(2);
    expect((templates.match(/"customs:reference:read"/g) ?? []).length).toBe(10);
    for (const key of ["CLIENT_USER", "DRIVER", "PARTNER_AGENT", "COURIER", "PICKUP_AGENT"]) {
      const start = templates.indexOf(`key: "${key}"`);
      const next = templates.indexOf('key: "', start + 10);
      const block = templates.slice(start, next === -1 ? undefined : next);
      expect(block, key).not.toContain("customs:reference");
    }
  });

  it("33 — the grants are mirrored in seed.sql, because role is empty at migration time", () => {
    // A migration's role_permission join finds nothing on a fresh database: the
    // roles are created by seed.sql afterwards. Without the mirror, CI would
    // run with the permissions defined and granted to nobody.
    expect(seed).toContain("'customs:reference:read'");
    expect(seed).toContain("'customs:reference:publish'");
    const seedPublish = seed.slice(seed.indexOf("p.code = 'customs:reference:publish'"));
    expect(seedPublish).toContain("'SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT'");
  });
});

// ===========================================================================
describe("REF-1 — the acts are atomic and attributed", () => {
  it("34 — every write is a compare-and-set whose outcome is observable", () => {
    // PostgREST reports no error for an UPDATE that matched nothing, so the row
    // count is the only truthful signal.
    expect((actions.match(/\.select\("id"\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    for (const guard of [
      'if ((moved?.length ?? 0) !== 1) return { ok: false, error: "withdrawn" };',
      'if ((moved?.length ?? 0) !== 1) return { ok: false, error: "already_withdrawn" };',
    ]) {
      expect(actions, guard).toContain(guard);
    }
    // The publication CAS is now the RPC's own row count under a row lock,
    // which is strictly stronger than a PostgREST predicate.
    expect(gate).toContain("and status = 'QUARANTINE'");
    expect(gate).toContain("get diagnostics v_retired = row_count;");
    expect(gate).toContain("for update");
  });

  it("35 — supersession and publication are now ONE transaction, so there is nothing to compensate", () => {
    // REF-1-HARDEN did this as two PostgREST writes with a compensating undo
    // and a disclosed residual window. Part C closed it: both writes live in
    // `publish_customs_reference`, so a failure anywhere rolls back both.
    const fn = gate.slice(gate.indexOf("function public.publish_customs_reference"));
    const retire = fn.indexOf("set superseded_by_id = p_document");
    const publish = fn.indexOf("set status       = 'PUBLISHED'");
    expect(retire).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(retire);
    // The retirement still cannot overwrite a concurrent publisher's.
    expect(fn).toContain("and superseded_by_id is null");
    expect(fn).toContain("predecessor_already_superseded");
    // And the application no longer carries an undo, because it cannot half-fail.
    expect(actions).not.toContain("superseded_by_id: null, superseded_at: null");
  });

  it("36 — the audit row follows the move, never precedes it", () => {
    for (const action of [
      "CUSTOMS_REFERENCE_PUBLISHED",
      "CUSTOMS_REFERENCE_WITHDRAWN",
      "CUSTOMS_REFERENCE_LICENCE_RECORDED",
      "CUSTOMS_REFERENCE_VERIFIED",
    ]) {
      expect(actions, action).toContain(`AuditActions.${action}`);
    }
    expect(AuditActions.CUSTOMS_REFERENCE_PUBLISHED).toBe("customs.reference.published");
    expect(AuditActions.CUSTOMS_REFERENCE_UPLOADED).toBe("customs.reference.uploaded");
    expect(AuditActions.CUSTOMS_REFERENCE_ACCESSED).toBe("customs.reference.accessed");
    // In publishDocument the audit comes after the CAS verdict.
    const fn = actions.slice(actions.indexOf("export async function publishDocument"));
    expect(fn.indexOf("writeAudit")).toBeGreaterThan(fn.indexOf('error: "already_published"'));
  });

  it("37 — consultation is audited, because a licence obligation needs evidence", () => {
    expect(viewRoute).toContain("AuditActions.CUSTOMS_REFERENCE_ACCESSED");
    expect(viewRoute).toContain("licence_status: doc.licence_status");
  });

  it("38 — there is no hard delete in the module", () => {
    expect(actions).not.toContain(".delete()");
    expect(service).not.toContain(".delete()");
    expect(migration).toContain("'WITHDRAWN'");
  });

  it("39 — the stored object and its identity are immutable in the database", () => {
    expect(migration).toContain("protect_customs_reference_identity");
    expect(migration).toContain("trg_customs_reference_identity");
    for (const col of ["storage_path", "content_sha256", "size_bytes", "version", "uploaded_by"]) {
      expect(migration, col).toContain(`new.${col}`);
    }
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
  });
});

// ===========================================================================
describe("REF-1 — French, and the inventory", () => {
  it("40 — every refusal this slice can return has its own French sentence", () => {
    const errors = t.customs.reference.errors as Record<string, string>;
    const codes = [
      "forbidden", "not_found", "missing_file", "mime_not_pdf", "not_a_pdf", "too_large",
      "too_small", "size_mismatch", "title_required", "authority_required", "category_invalid",
      "published_on_invalid", "upload_failed", "save_failed", "predecessor_not_found",
      "predecessor_already_superseded", "category_mismatch", "nothing_to_record", "withdrawn",
      "already_published", "already_withdrawn", "provenance_unverified",
      "legal_version_unverified", "licence_unresolved", "explanatory_notes_licence_required",
      "licence_invalid", "licence_note_required", "reason_required", "invalid_input",
      "unavailable", "generic",
    ];
    for (const code of codes) {
      expect(errors[code], code).toBeTruthy();
      expect(errors[code].length, code).toBeGreaterThan(15);
    }
    // Distinct sentences, not one message wearing many names.
    expect(new Set(codes.map((c) => errors[c])).size).toBe(codes.length);
  });

  it("41 — the authority disclaimer exists and is unconditional on the page", () => {
    expect(t.customs.reference.authorityDisclaimer).toContain("référence interne");
    expect(t.customs.reference.authorityDisclaimer).toContain("version en vigueur");
    const page = strip(read("app/customs/reference/page.tsx"));
    // Rendered before the list, and not behind any condition.
    const disclaimer = page.indexOf("authorityDisclaimer");
    const panel = page.indexOf("<ReferenceLibraryPanel");
    expect(disclaimer).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(disclaimer);
    expect(page).not.toMatch(/&&\s*\(?\s*<div[^>]*role="note"/);
  });

  it("42 — the quarantine notice names the missing scanner", () => {
    expect(t.customs.reference.quarantineNotice).toContain("antivirus");
    expect(t.customs.reference.licencePendingNotice).toContain("OMD");
  });

  it("43 — every vocabulary is labelled, and matches the database CHECKs", () => {
    for (const c of REFERENCE_CATEGORIES) {
      expect(CATEGORY_LABEL_FR[c], c).toBeTruthy();
      expect(migration, c).toContain(`'${c}'`);
      expect(isReferenceCategory(c)).toBe(true);
    }
    for (const l of LICENCE_STATUSES) {
      expect(LICENCE_LABEL_FR[l], l).toBeTruthy();
      expect(migration, l).toContain(`'${l}'`);
      expect(isLicenceStatus(l)).toBe(true);
    }
    for (const s of ["QUARANTINE", "PUBLISHED", "WITHDRAWN"] as const) {
      expect(STATUS_LABEL_FR[s], s).toBeTruthy();
    }
    expect(isReferenceCategory("SOMETHING_ELSE")).toBe(false);
    expect(isLicenceStatus("FREE")).toBe(false);
  });

  it("44 — one migration ships, with its companion verifier, and the inventory agrees", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(files).toHaveLength(154);
    expect(MIGRATION_COUNT).toBe(154);
    expect(LATEST_MIGRATION).toBe("20261018000001_customs_reference_scan_replay");
    expect(verifier).toContain("ok boolean, detail text");
    expect(verifier).toContain("customs_reference_document");
    // The verifier asserts the POLICY, not table privileges: on Supabase
    // `authenticated` holds SELECT nearly everywhere and the policy is the
    // protection.
    expect(verifier).toContain("pg_policy");
    expect(strip(verifier)).not.toContain("has_table_privilege");
  });

  it("45 — this slice ships no EXO table, no scheduler and no search index", () => {
    for (const forbidden of [
      "customs_regime", "customs_authorization", "customs_dpi", "customs_compliance",
      "pg_cron", "cron.schedule", "tsvector", "pg_trgm", "to_tsvector",
    ]) {
      expect(migration, forbidden).not.toContain(forbidden);
    }
    // And the workflow, customs release, transport and finance are untouched.
    for (const forbidden of [
      "process_step", "process_instance", "transport_record", "invoice", "customs_record",
    ]) {
      expect(migration, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
describe("REF-1-HARDEN — the four corrections", () => {
  it("46 — F2: reference_code is NOT NULL and the uniqueness rule is unconditional", () => {
    expect(migration).toContain("reference_code          text not null check (btrim(reference_code) <> '')");
    const uq = migration.slice(migration.indexOf("uq_customs_reference_one_current"));
    const stmt = uq.slice(0, uq.indexOf(";"));
    // The lifecycle predicate stays; the reference_code predicate is gone, so
    // no row can sit outside the one-current-edition rule any more.
    expect(stmt).toContain("where status = 'PUBLISHED' and superseded_at is null");
    expect(stmt).not.toContain("reference_code is not null");
    // The lineage index lost its NULL predicate too, so every edition of every
    // document is indexed by its key.
    const lineage = migration.slice(migration.indexOf("idx_customs_reference_lineage"));
    expect(lineage.slice(0, lineage.indexOf(";"))).not.toContain("reference_code is not null");
  });

  it("47 — F2: a replacement's lineage is enforced by the DATABASE, on insert", () => {
    expect(migration).toContain("enforce_customs_reference_lineage");
    expect(migration).toContain("before insert on public.customs_reference_document");
    const fn = migration.slice(
      migration.indexOf("function public.enforce_customs_reference_lineage"),
      migration.indexOf("drop trigger if exists trg_customs_reference_lineage"),
    );
    for (const rule of ["tenant", "category", "reference code", "already been replaced"]) {
      expect(fn, rule).toContain(rule);
    }
    // It compares against the PREDECESSOR's row, not against the insert.
    expect(fn).toContain("where id = new.supersedes_id");
    expect(fn).toContain("p.reference_code is distinct from new.reference_code");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public, pg_temp");
  });

  it("48 — F2: the route inherits the predecessor's key and never the form's", () => {
    expect(uploadRoute).toContain("effectiveCode = prior.reference_code;");
    expect(uploadRoute).toContain('error: "reference_code_mismatch"');
    expect(uploadRoute).toContain("reference_code: effectiveCode,");
    // The raw form value is not what lands in the row.
    const insert = uploadRoute.slice(
      uploadRoute.indexOf(".insert({"),
      uploadRoute.indexOf('.select("id")', uploadRoute.indexOf(".insert({")),
    );
    expect(insert).not.toContain("reference_code: referenceCode");
  });

  it("49 — F3: a failed audit deletes the row and the object, in that order", () => {
    // Anchored on the AUDIT call, not on the first `try` in the file: the
    // formData parse is also a try/catch, and the insert-failure path removes
    // the object before this one even runs.
    const tail = uploadRoute.slice(uploadRoute.indexOf("await writeAudit({"));
    expect(tail).toContain("writeAudit({");
    expect(tail).toContain("} catch {");
    const del = tail.indexOf(".delete()");
    const rm = tail.indexOf("remove([path])");
    expect(del).toBeGreaterThan(-1);
    // Row first, then object: a row with no object is visible and fixable, an
    // object with no row is unaccountable.
    expect(rm).toBeGreaterThan(del);
    expect(tail).toContain('error: "audit_failed"');
    // The success path still returns 201 only after the audit landed. Measured
    // inside `tail`, because an index from the whole file is not comparable
    // with one from a slice of it.
    expect(tail.indexOf("status: 201")).toBeGreaterThan(rm);
  });

  it("50 — F4: a withdrawn document is frozen, in the action and in the database", () => {
    const fn = actions.slice(
      actions.indexOf("export async function recordLicenceRuling"),
      actions.indexOf("export async function publishDocument"),
    );
    expect(fn).toContain('if (doc.status === "WITHDRAWN") return { ok: false, error: "withdrawn" };');
    expect(fn).toContain('.neq("status", "WITHDRAWN")');
    // …and the trigger refuses it whatever the writer.
    const trg = migration.slice(migration.indexOf("function public.protect_customs_reference_identity"));
    expect(trg).toContain("old.status = 'WITHDRAWN' and new.status = 'WITHDRAWN'");
    for (const col of ["licence_status", "redistribution_allowed", "licence_note",
                       "provenance_verified", "legal_version_verified"]) {
      expect(trg, col).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(trg).toContain("a withdrawn document is frozen");
  });

  it("51 — F1: a pgTAP RLS test exists and CI runs it", () => {
    const rls = read("supabase/tests/rls_customs_reference_test.sql");
    expect(rls).toContain("customs_reference_document");
    // Non-destructive, like every other RLS test in the suite.
    expect(rls).toContain("begin;");
    expect(rls).toContain("rollback;");
    // It drives real authenticated identities through the policy.
    expect(rls).toContain("set_config('role', 'authenticated', true)");
    expect(rls).toContain("request.jwt.claims");
    // The five required cases.
    for (const probe of ["reader_published", "publisher_quarantine", "reader_quarantine",
                         "noperm_published", "foreign_published"]) {
      expect(rls, probe).toContain(probe);
    }
    // And CI executes it — a test nobody runs is not evidence.
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/rls_customs_reference_test.sql");
  });

  it("52 — the French sentences for the new refusals exist", () => {
    const errors = t.customs.reference.errors as Record<string, string>;
    for (const code of ["reference_code_required", "reference_code_mismatch", "audit_failed"]) {
      expect(errors[code], code).toBeTruthy();
      expect(errors[code].length, code).toBeGreaterThan(20);
    }
  });

  it("53 — the hardening added no permission, no role grant and no second migration", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    // Corrections to an UNAPPLIED migration belong in it; NEW CAPABILITY gets
    // its own, which is why the publication gate is #153 and not an edit.
    expect(files).toHaveLength(154);
    expect((migration.match(/insert into public\.permission/g) ?? []).length).toBe(1);
    expect((migration.match(/insert into public\.role_permission/g) ?? []).length).toBe(2);
    const publishGrant = migration.slice(migration.indexOf("p.code = 'customs:reference:publish'"));
    expect(publishGrant).toContain("'SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT'");
  });
});

// ===========================================================================
describe("REF-1-PUBLISH-GATE — Part A: nothing is published unscanned", () => {
  it("54 — the scan lifecycle is a database CHECK, defaulting to UNSCANNED", () => {
    expect(gate).toContain("add column if not exists scan_status text not null default 'UNSCANNED'");
    const chk = gate.slice(gate.indexOf("customs_reference_scan_status_check"));
    for (const v of ["UNSCANNED", "SCANNING", "CLEAN", "INFECTED", "ERROR"]) {
      expect(chk.slice(0, 400), v).toContain(`'${v}'`);
    }
  });

  it("55 — publication requires CLEAN bound to THESE bytes and THIS object", () => {
    const chk = gate.slice(
      gate.indexOf("customs_reference_publication_requires_clean_scan"),
      gate.indexOf("-- 4. PUBLICATION REQUIRES TWO DISTINCT ACTORS"),
    );
    expect(chk).toContain("scan_status = 'CLEAN'");
    // The binding is what makes a clearance non-transferable between objects.
    expect(chk).toContain("scanned_sha256 = content_sha256");
    expect(chk).toContain("scanned_storage_path = storage_path");
  });

  it("56 — only the trusted recorder can record CLEAN", () => {
    // THE trust boundary. Every write in this platform uses the service role,
    // so "the application decides" would be no boundary at all.
    expect(gate).toContain("guard_customs_reference_scan_status");
    expect(gate).toContain("before insert or update on public.customs_reference_document");
    const fn = gate.slice(
      gate.indexOf("function public.guard_customs_reference_scan_status"),
      gate.indexOf("drop trigger if exists trg_customs_reference_scan_guard"),
    );
    expect(fn).toContain("effitrans.scan_recorder");
    expect(fn).toContain("only the trusted scan recorder may record a CLEAN verdict");
    // Transaction-local, so it cannot leak to another statement or a pooled
    // connection.
    expect(gate).toContain("perform set_config('effitrans.scan_recorder', 'customs_reference', true);");
    expect(fn).toContain("cannot be re-bound");
  });

  it("57 — the recorder refuses a verdict about other bytes, and evidences every one", () => {
    const fn = gate.slice(gate.indexOf("function public.record_customs_reference_scan"));
    expect(fn).toContain("binding_mismatch");
    expect(fn).toContain("p_sha256 is distinct from v_doc.content_sha256");
    expect(fn).toContain("p_storage_path is distinct from v_doc.storage_path");
    expect(fn).toContain("insert into public.customs_reference_scan");
    expect(fn).toContain("for update");
  });

  it("58 — a rescan that disagrees invalidates the clearance and retires the document", () => {
    const fn = gate.slice(gate.indexOf("function public.record_customs_reference_scan"));
    expect(fn).toContain("scanned_sha256       = null");
    expect(fn).toContain("'WITHDRAWN'");
    expect(fn).toContain("'SCAN'");
    // A scanner has no seat in app_user, so a SCAN withdrawal carries no actor
    // — and the coherence CHECK admits that case and only that case.
    const coh = gate.slice(gate.indexOf("customs_reference_withdrawal_coherent"));
    expect(coh).toContain("withdrawn_source = 'OPERATOR' and withdrawn_by is not null");
    expect(coh).toContain("withdrawn_source = 'SCAN'");
  });

  it("59 — scan evidence is append-only and readable only by publishers", () => {
    expect(gate).toContain("create table if not exists public.customs_reference_scan");
    expect(gate).toContain("execute function public.prevent_mutation()");
    expect(gate).toContain("alter table public.customs_reference_scan enable row level security");
    const pol = gate.slice(gate.indexOf("customs_reference_scan_select on public.customs_reference_scan"));
    expect(pol).toContain("public.auth_tenant_id()");
    expect(pol).toContain("customs:reference:publish");
    expect(TENANT_SCOPED_TABLES.has("customs_reference_scan")).toBe(true);
  });

  it("60 — there is NO scanner in this codebase, and the adapter fails closed", () => {
    const scan = strip(read("lib/customs/reference/scan.ts"));
    // Both halves required: an endpoint with no secret would mean believing
    // unauthenticated verdicts.
    expect(scan).toContain("CUSTOMS_SCAN_ENDPOINT");
    expect(scan).toContain("CUSTOMS_SCAN_CALLBACK_SECRET");
    expect(scan).toContain("if (!endpoint || !callbackSecret) return null;");
    // Nothing here invents a verdict.
    expect(scan).not.toContain('verdict: "CLEAN"');
    expect(scan).not.toMatch(/return\s*\{\s*ok:\s*true,\s*payload:\s*\{[^}]*CLEAN/);
    // No default endpoint, so an unconfigured deployment cannot be pointed at
    // somebody else's scanner by accident. The scanner's download link is a
    // PARAMETER minted by the caller, never a literal in here.
    expect(scan).not.toMatch(/https?:\/\/[a-z]/);
    expect(scan).toContain("downloadUrl: string;");
  });

  it("61 — the callback is HMAC-authenticated and accepts no session", () => {
    const cb = strip(read("app/api/customs/reference/scan-callback/route.ts"));
    expect(cb).toContain("parseCallback(raw, signature)");
    expect(cb).toContain("await request.text()");
    // A person cannot be a scanner.
    expect(cb).not.toContain("getCurrentUser");
    expect(cb).not.toContain("getCurrentPortalUser");
    expect(cb).not.toContain("assertPermission");
    // Unconfigured => refuse everything.
    expect(cb).toContain('error: "scanner_unavailable" }, { status: 503 }');
    // It records through the RPC; it never writes the document itself.
    expect(cb).toContain('supabase.rpc("record_customs_reference_scan"');
    expect(cb).not.toContain('.from("customs_reference_document")');
    // No human actor: the audit action is system-prefixed.
    expect(AuditActions.SYSTEM_CUSTOMS_REFERENCE_SCANNED).toBe("system.customs.reference.scanned");
    expect(cb).toContain("AuditActions.SYSTEM_CUSTOMS_REFERENCE_SCANNED");
  });

  it("62 — a failed dispatch does not leave the document stranded in SCANNING", () => {
    const fn = actions.slice(actions.indexOf("export async function requestScan"));
    expect(fn).toContain('if (!scanningAvailable()) return { ok: false, error: "scanner_unavailable" };');
    expect(fn).toContain('.eq("scan_status", previous)');
    expect(fn).toContain('.update({ scan_status: previous })');
    expect(fn).toContain('.eq("scan_status", "SCANNING")');
    // And it can never record a verdict.
    expect(fn).not.toContain("CLEAN");
  });

  it("63 — NO exception, override or bypass exists anywhere in the slice", () => {
    // The authorising brief asked for a general-purpose malware exception NOT
    // to be built. Asserted rather than assumed, in both layers.
    for (const [name, src] of [["gate", gate], ["actions", actions], ["migration", migration]] as const) {
      expect(src, name).not.toMatch(/\b(bypass_scan|scan_override|force_publish|skip_scan|publish_anyway)\b/);
    }
    expect(gate).not.toMatch(/add column[^;]*\b(override|bypass|exempt|exception)\b/);
    expect(gateVerifier).toContain("no override, bypass or exception column exists");
  });
});

// ===========================================================================
describe("REF-1-PUBLISH-GATE — Part B: two people, enforced by the row", () => {
  it("64 — publication requires a submission and a DIFFERENT approver", () => {
    const chk = gate.slice(
      gate.indexOf("customs_reference_publication_requires_two_actors"),
      gate.indexOf("customs_reference_submission_coherent"),
    );
    expect(chk).toContain("submitted_for_publication_by is not null");
    expect(chk).toContain("published_by <> submitted_for_publication_by");
  });

  it("65 — the RPC refuses self-approval and an unsubmitted document by name", () => {
    const fn = gate.slice(gate.indexOf("function public.publish_customs_reference"));
    expect(fn).toContain("if v_doc.submitted_for_publication_by is null then return 'not_submitted'");
    expect(fn).toContain("self_approval_forbidden");
    expect(fn).toContain("v_doc.submitted_for_publication_by = p_approver");
  });

  it("66 — both human acts assert the NOMINATED actor's authority, not the caller's", () => {
    // The service role is transport, not authority (OPS-SEC-2A).
    for (const [fnName, actor] of [
      ["submit_customs_reference_for_publication", "p_actor"],
      ["publish_customs_reference", "p_approver"],
    ] as const) {
      const fn = gate.slice(gate.indexOf(`function public.${fnName}`));
      expect(fn, fnName).toContain(
        `assert_actor_authority(${actor}, p_tenant, 'customs:reference:publish', 'SERVICE')`,
      );
    }
    // The scan recorder deliberately does NOT, because there is no human and
    // the SYSTEM lane fails closed by ratification.
    const rec = gate.slice(
      gate.indexOf("function public.record_customs_reference_scan"),
      gate.indexOf("function public.submit_customs_reference_for_publication"),
    );
    expect(rec).not.toContain("assert_actor_authority");
  });

  it("67 — the three RPCs are service_role-only definers", () => {
    for (const fn of ["record_customs_reference_scan",
                      "submit_customs_reference_for_publication",
                      "publish_customs_reference"]) {
      expect(gate, fn).toContain(`revoke execute on function public.${fn}`);
      expect(gate, fn).toContain(`to service_role`);
      expect(gate, `${fn} from authenticated`).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}[^;]*from authenticated`),
      );
    }
    expect((gate.match(/security definer/g) ?? []).length).toBe(4);
    expect((gate.match(/set search_path = public, pg_temp/g) ?? []).length).toBe(4);
  });

  it("68 — no new permission code, and publish stays with two roles", () => {
    // Splitting publish into submit/approve codes would let a tenant grant one
    // without the other and recreate single-handed publication sideways.
    expect(gate).not.toContain("insert into public.permission");
    expect(gate).not.toContain("insert into public.role_permission");
    expect(gate).toContain("customs:reference:publish");
  });

  it("69 — the UI names self-approval and the scan gate before the database does", () => {
    const panel = strip(read("components/customs/reference-library-panel.tsx"));
    expect(panel).toContain("submitForPublication");
    expect(panel).toContain("requestScan");
    expect(panel).toContain("approverId: viewerId");
    expect(panel).toContain("SCAN_LABEL_FR[doc.scanStatus]");
    const errors = t.customs.reference.errors as Record<string, string>;
    for (const code of ["scan_required", "scan_in_progress", "scan_infected", "scan_error",
                        "scan_binding_mismatch", "scanner_unavailable", "not_submitted",
                        "self_approval_forbidden", "dispatch_failed", "scan_not_requestable"]) {
      expect(errors[code], code).toBeTruthy();
      expect(errors[code].length, code).toBeGreaterThan(20);
    }
  });

  it("70 — publicationBlockers names every non-CLEAN state and self-approval", () => {
    const base = {
      status: "QUARANTINE" as const,
      category: "LEGISLATION" as const,
      licenceStatus: "INTERNAL_ONLY" as const,
      provenanceVerified: true,
      legalVersionVerified: true,
      submittedForPublicationBy: "maker",
      approverId: "checker",
    };
    expect(publicationBlockers({ ...base, scanStatus: "CLEAN" })).toEqual([]);
    expect(publicationBlockers({ ...base, scanStatus: "UNSCANNED" })).toContain("scan_required");
    expect(publicationBlockers({ ...base, scanStatus: "SCANNING" })).toContain("scan_in_progress");
    expect(publicationBlockers({ ...base, scanStatus: "INFECTED" })).toContain("scan_infected");
    expect(publicationBlockers({ ...base, scanStatus: "ERROR" })).toContain("scan_error");
    expect(publicationBlockers({ ...base, scanStatus: "CLEAN", submittedForPublicationBy: null }))
      .toContain("not_submitted");
    expect(publicationBlockers({ ...base, scanStatus: "CLEAN", approverId: "maker" }))
      .toContain("self_approval_forbidden");
  });

  it("71 — migration 153 ships with its verifier and touches no unrelated table", () => {
    expect(gateVerifier).toContain("ok boolean, detail text");
    expect(gateVerifier).toContain("CUSTOMS-REF-01A #153");
    expect(strip(gateVerifier)).not.toContain("has_table_privilege('authenticated'");
    for (const forbidden of ["invoice", "transport_record", "process_step", "customs_record",
                             "operational_file", "document_type"]) {
      expect(gate, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
describe("SCANNER-01 — the integration is end-to-end executable", () => {
  it("72 — the scanner is given a CREDENTIAL, not just a path", () => {
    // THE GAP THIS CLOSED. The bucket is private with no storage.objects
    // policy, so a `storage_path` alone is a name nothing outside the server
    // can read: the workflow was not executable at all.
    const fn = actions.slice(actions.indexOf("export async function requestScan"));
    expect(fn).toContain(".createSignedUrl(doc.storage_path, SCAN_DOWNLOAD_TTL_SECONDS)");
    expect(fn).toContain("downloadUrl: link.signedUrl");
    // Minting it is a precondition, not best-effort.
    expect(fn).toContain('if (linkErr || !link?.signedUrl) return { ok: false, error: "dispatch_failed" };');
    // A credential is never written to the audit trail.
    const audit = fn.slice(fn.indexOf("writeAudit"));
    expect(audit).not.toContain("signedUrl");
    expect(audit).not.toContain("downloadUrl");
  });

  it("73 — the dispatch is SIGNED, so the scanner can authenticate us too", () => {
    const scan = strip(read("lib/customs/reference/scan.ts"));
    expect(scan).toContain('"x-effitrans-signature": hmacSha256Hex(cfg.callbackSecret, body)');
    // Signed over the exact bytes sent, not a re-serialisation.
    expect(scan).toContain("const body = JSON.stringify({");
    expect(scan).toContain("body,");
    expect(scan).toContain("nonce: req.nonce");
    expect(scan).toContain("issued_at: new Date().toISOString()");
  });

  it("74 — replay is refused in the DATABASE, not only by a clock", () => {
    expect(replay).toContain("add column if not exists callback_nonce text");
    const idx = replay.slice(replay.indexOf("uq_customs_reference_scan_nonce"));
    expect(idx).toContain("(tenant_id, document_id, callback_nonce)");
    expect(idx).toContain("where callback_nonce is not null");
    // The refusal happens on the evidence insert, which is BEFORE the document
    // update — so a replay changes no state at all.
    const fn = replay.slice(replay.indexOf("function public.record_customs_reference_scan"));
    expect(fn).toContain("exception when unique_violation then");
    expect(fn).toContain("return 'replayed'");
    expect(fn.indexOf("insert into public.customs_reference_scan"))
      .toBeLessThan(fn.indexOf("effitrans.scan_recorder"));
  });

  it("75 — the 9-argument recorder is DROPPED, not left as an overload", () => {
    // An overload pair would mean a caller that omitted the nonce silently
    // reaching the unprotected function — the defect, by accident.
    expect(replay).toContain("drop function if exists public.record_customs_reference_scan(");
    expect(replay).toContain("p_nonce           text default null");
    // Re-granted on the new signature, and still service_role only.
    expect(replay).toMatch(/revoke execute on function public\.record_customs_reference_scan\([^)]*\) from authenticated/);
    expect(replay).toContain("to service_role");
  });

  it("76 — a lost scan can be retried, and a fresh one cannot", () => {
    const fn = actions.slice(actions.indexOf("export async function requestScan"));
    expect(fn).toContain("SCAN_TIMEOUT_MS");
    expect(fn).toContain('doc.scan_status === "SCANNING"');
    expect(fn).toContain("const scanLost =");
    // Fail-closed: a retry window is not a pass. Publication still needs CLEAN.
    expect(fn).not.toContain('scan_status: "CLEAN"');
    expect(fn).toContain('doc.scan_status !== "UNSCANNED" && doc.scan_status !== "ERROR" && !scanLost');
  });

  it("77 — the callback refuses a stale message and reports a replay distinctly", () => {
    const cb = strip(read("app/api/customs/reference/scan-callback/route.ts"));
    expect(cb).toContain('parsed.error === "stale_callback" ? 409');
    expect(cb).toContain('if (outcome === "replayed")');
    expect(cb).toContain("p_nonce: p.nonce");
  });

  it("78 — migration 154 ships with its verifier and widens nothing", () => {
    expect(replayVerifier).toContain("ok boolean, detail text");
    expect(replayVerifier).toContain("SCANNER-01 #154");
    expect(replay).not.toContain("insert into public.permission");
    expect(replay).not.toContain("insert into public.role_permission");
    for (const forbidden of ["invoice", "transport_record", "process_step",
                             "customs_record", "operational_file"]) {
      expect(replay, forbidden).not.toContain(forbidden);
    }
    // And the publication gate is untouched: still CLEAN-only, still two actors.
    expect(replay).not.toContain("customs_reference_publication_requires");
  });
});
