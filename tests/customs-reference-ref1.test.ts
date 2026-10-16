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

  it("17 — nothing in the slice can publish except the publish action", () => {
    expect(uploadRoute).not.toContain("publishDocument");
    expect((actions.match(/\.update\(\{ status: "PUBLISHED"/g) ?? []).length).toBe(1);
    // The other occurrence is the audit payload: a record of the move, not a
    // second way to perform it.
    expect((actions.match(/status: "PUBLISHED"/g) ?? []).length).toBe(2);
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
    // No module in this slice hands out a URL.
    expect(actions).not.toContain("createSignedUrl");
    expect(service).not.toContain("createSignedUrl");
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
    // All four governance acts, each gated on publish.
    expect((actions.match(/assertPermission\("customs:reference:publish"\)/g) ?? []).length).toBe(4);
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
    expect(actions).toContain('.eq("status", "QUARANTINE")');
  });

  it("35 — supersession precedes publication, and a failed publish is compensated", () => {
    const retire = actions.indexOf('.update({ superseded_by_id: id, superseded_at: supersededAt })');
    const publish = actions.indexOf('.update({ status: "PUBLISHED"');
    expect(retire).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(retire);
    // The retirement CAS cannot overwrite a concurrent publisher's.
    expect(actions).toContain('.is("superseded_by_id", null)');
    // The compensation is fenced to OUR supersession.
    expect(actions).toContain('.eq("superseded_by_id", id)');
    expect(actions).toContain("superseded_by_id: null, superseded_at: null");
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
    expect(files).toHaveLength(152);
    expect(MIGRATION_COUNT).toBe(152);
    expect(LATEST_MIGRATION).toBe("20261016000001_customs_reference_library");
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
    // Corrections to an UNAPPLIED migration belong in it, not in a successor.
    expect(files).toHaveLength(152);
    expect((migration.match(/insert into public\.permission/g) ?? []).length).toBe(1);
    expect((migration.match(/insert into public\.role_permission/g) ?? []).length).toBe(2);
    const publishGrant = migration.slice(migration.indexOf("p.code = 'customs:reference:publish'"));
    expect(publishGrant).toContain("'SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT'");
  });
});
