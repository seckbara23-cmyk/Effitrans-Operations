/**
 * CUSTOMS-REF-01A / REF-2 — large uploads, browsing, search, and the
 * development-only testing method.
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE IS FOR. REF-2 raised the upload ceiling from 4 MB to the
 * bucket's 50 MB by letting the bytes bypass the application on the way in.
 * That is a real change to how a document comes into existence, so most of
 * what follows asserts that the NEW path carries the same five guarantees the
 * REF-1 path was verified for — staff session, publish permission, bytes
 * validated for real, server-derived object key, safe database defaults.
 *
 * AND WHY THE TWO PATHS ARE PINNED SEPARATELY. The REF-1 route is left
 * untouched on purpose: it is CI-verified and pinned by
 * customs-reference-ref1.test.ts. Two independent implementations is exactly
 * how one of them later stops landing documents in QUARANTINE, so the new one
 * is pinned the same way rather than trusted to stay in step.
 *
 * THE DEV STUB SECTION IS THE LOAD-BEARING ONE. A stub that reports CLEAN is
 * only safe if it cannot reach a deployed environment and cannot be mistaken
 * for a scanner. Those are not promises in a README; they are asserted here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isReferenceStatus,
  referenceLifecycle,
  REFERENCE_STATUSES,
} from "@/lib/customs/reference/types";
import {
  BUCKET_LIMIT_BYTES,
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_REGIMES,
  MAX_REGIME_LENGTH,
  MAX_UPLOAD_BYTES,
  buildStagingPath,
  normalizeRegimes,
  parseRegimeInput,
  validateReferenceMetadata,
  validateUpload,
} from "@/lib/customs/reference/validate";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Assert on CODE, never on prose: this slice's comments name every token. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");

const ticketRoute = strip(read("app/api/customs/reference/upload-url/route.ts"));
const finalizeRoute = strip(read("app/api/customs/reference/finalize/route.ts"));
const service = strip(read("lib/customs/reference/service.ts"));
const page = strip(read("app/customs/reference/page.tsx"));
const migration = strip(read("supabase/migrations/20261019000001_customs_reference_regime_axis.sql"));
const verifier = read("supabase/verifiers/20261019000001_customs_reference_regime_axis.verify.sql");
const stub = strip(read("workers/dev-scan-stub/src/server.mjs"));

/** A minimal, valid PDF buffer of a given size. */
function pdfBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 0); // %PDF-1.7
  return b;
}

const META = {
  title: "Tarif Extérieur Commun",
  sourceAuthority: "Direction Générale des Douanes",
  referenceCode: "TEC",
  categoryValid: true,
  publishedOn: null,
};

// ===========================================================================
describe("REF-2 — the size ceiling", () => {
  it("1 — the direct ceiling IS the bucket's own limit", () => {
    // Stated as the same constant so the application cannot promise an upload
    // that storage will refuse.
    expect(MAX_DIRECT_UPLOAD_BYTES).toBe(BUCKET_LIMIT_BYTES);
    expect(MAX_DIRECT_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });

  it("2 — the REF-1 ceiling is UNCHANGED", () => {
    // REF-2 must not quietly raise the limit on the route that carries bytes
    // through a serverless function: that limit is the platform's, not ours.
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
  });

  it("3 — validateUpload still defaults to the REF-1 ceiling", () => {
    const v = validateUpload({
      bytes: pdfBytes(5 * 1024 * 1024),
      declaredMime: "application/pdf",
      declaredSize: 5 * 1024 * 1024,
      ...META,
    });
    expect(v).toEqual({ ok: false, error: "too_large" });
  });

  it("4 — and accepts the same file when the direct ceiling is passed", () => {
    const v = validateUpload({
      bytes: pdfBytes(5 * 1024 * 1024),
      declaredMime: "application/pdf",
      declaredSize: 5 * 1024 * 1024,
      maxBytes: MAX_DIRECT_UPLOAD_BYTES,
      ...META,
    });
    expect(v).toEqual({ ok: true });
  });

  it("5 — a file over the BUCKET limit is refused on the direct path too", () => {
    const v = validateUpload({
      bytes: pdfBytes(BUCKET_LIMIT_BYTES + 1),
      declaredMime: "application/pdf",
      declaredSize: BUCKET_LIMIT_BYTES + 1,
      maxBytes: MAX_DIRECT_UPLOAD_BYTES,
      ...META,
    });
    expect(v).toEqual({ ok: false, error: "too_large" });
  });

  it("6 — raising the ceiling did NOT weaken the byte check", () => {
    // A 10 MB file that is not a PDF must still be refused on its magic
    // number, not accepted because it now fits.
    const notPdf = new Uint8Array(10 * 1024 * 1024);
    notPdf.set([0x4d, 0x5a], 0); // MZ — a Windows executable
    const v = validateUpload({
      bytes: notPdf,
      declaredMime: "application/pdf",
      declaredSize: notPdf.length,
      maxBytes: MAX_DIRECT_UPLOAD_BYTES,
      ...META,
    });
    expect(v).toEqual({ ok: false, error: "not_a_pdf" });
  });
});

// ===========================================================================
describe("REF-2 — metadata validation is shared, not duplicated", () => {
  it("7 — the metadata validator refuses in the documented order", () => {
    expect(validateReferenceMetadata({ ...META, categoryValid: false }))
      .toEqual({ ok: false, error: "category_invalid" });
    expect(validateReferenceMetadata({ ...META, title: "   " }))
      .toEqual({ ok: false, error: "title_required" });
    expect(validateReferenceMetadata({ ...META, sourceAuthority: "" }))
      .toEqual({ ok: false, error: "authority_required" });
    expect(validateReferenceMetadata({ ...META, referenceCode: "  " }))
      .toEqual({ ok: false, error: "reference_code_required" });
    expect(validateReferenceMetadata({ ...META, publishedOn: "2026-13" }))
      .toEqual({ ok: false, error: "published_on_invalid" });
    expect(validateReferenceMetadata(META)).toEqual({ ok: true });
  });

  it("8 — validateUpload delegates to it, so the two cannot disagree", () => {
    // Same refusal, reached through the full validator.
    const v = validateUpload({
      bytes: pdfBytes(2048),
      declaredMime: "application/pdf",
      declaredSize: 2048,
      ...META,
      referenceCode: null,
    });
    expect(v).toEqual({ ok: false, error: "reference_code_required" });
  });
});

// ===========================================================================
describe("REF-2 — the staging prefix", () => {
  it("9 — a staged object is NOT at a document's path", () => {
    const p = buildStagingPath("t-1", "u-1");
    expect(p).toBe("t-1/_staging/u-1.pdf");
    // It must be distinguishable from `tenant/documentId.pdf`, because nothing
    // in the application may read an unvalidated object.
    expect(p).toContain("/_staging/");
  });

  it("10 — it is tenant-scoped", () => {
    expect(buildStagingPath("tenant-a", "u")).toMatch(/^tenant-a\//);
    expect(buildStagingPath("tenant-b", "u")).toMatch(/^tenant-b\//);
  });
});

// ===========================================================================
describe("REF-2 — the regime axis", () => {
  it("11 — trims, upper-cases, de-duplicates and sorts", () => {
    const r = normalizeRegimes([" transit ", "MISE EN CONSOMMATION", "Transit"]);
    expect(r).toEqual({ ok: true, regimes: ["MISE EN CONSOMMATION", "TRANSIT"] });
  });

  it("12 — drops blanks rather than storing them", () => {
    expect(normalizeRegimes(["", "  ", null, undefined, "TRANSIT"]))
      .toEqual({ ok: true, regimes: ["TRANSIT"] });
  });

  it("13 — an empty list is valid and means 'not regime-specific'", () => {
    expect(normalizeRegimes([])).toEqual({ ok: true, regimes: [] });
  });

  it("14 — refuses an over-long entry rather than truncating it", () => {
    // Truncating would make the row searchable under a name nobody typed.
    expect(normalizeRegimes(["x".repeat(MAX_REGIME_LENGTH + 1)]))
      .toEqual({ ok: false, error: "regime_too_long" });
    expect(normalizeRegimes(["x".repeat(MAX_REGIME_LENGTH)]).ok).toBe(true);
  });

  it("15 — bounds the array", () => {
    const many = Array.from({ length: MAX_REGIMES + 1 }, (_, i) => `R${i}`);
    expect(normalizeRegimes(many)).toEqual({ ok: false, error: "too_many_regimes" });
  });

  it("16 — splits on commas, semicolons and newlines but NOT spaces", () => {
    // A regime name contains spaces: « MISE EN CONSOMMATION » is one regime.
    expect(normalizeRegimes(parseRegimeInput("transit; mise en consommation\nexport")))
      .toEqual({ ok: true, regimes: ["EXPORT", "MISE EN CONSOMMATION", "TRANSIT"] });
  });

  it("17 — the application mirror and the database agree on the bounds", () => {
    expect(migration).toContain("cardinality(customs_regimes) <= 24");
    expect(MAX_REGIMES).toBe(24);
    expect(migration).toContain("length(z.r) > 48");
    expect(MAX_REGIME_LENGTH).toBe(48);
  });
});

// ===========================================================================
describe("REF-2 — migration 155 adds a search axis and nothing else", () => {
  it("18 — the normalising trigger is SECURITY INVOKER", () => {
    // A definer trigger on this table would run as the owner on every write:
    // a privilege escalation route bolted to a search feature.
    expect(migration).toContain("security invoker");
    expect(migration).not.toContain("security definer");
  });

  it("19 — it pins its search_path", () => {
    expect(migration).toContain("set search_path = public, pg_temp");
  });

  it("20 — it fires BEFORE insert or update, watching only its own column", () => {
    expect(migration).toContain("before insert or update of customs_regimes");
  });

  it("21 — the index is GIN, for containment", () => {
    expect(migration).toContain("using gin (customs_regimes)");
  });

  it("22 — it creates no policy, no permission and no grant", () => {
    // The publication gate is 152-154's business. A search migration that
    // touched any of these would be doing something it was not asked to.
    for (const forbidden of [
      "create policy", "drop policy", "alter policy",
      "insert into public.permission", "grant ", "revoke ",
      "security definer",
    ]) {
      expect(migration.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("23 — it touches no column that governs publication", () => {
    for (const governed of [
      "scan_status", "licence_status", "provenance_verified",
      "legal_version_verified", "redistribution_allowed",
    ]) {
      expect(migration, governed).not.toContain(governed);
    }
  });

  it("24 — the verifier re-asserts the 152-154 boundary, not just the column", () => {
    // A verifier that only checked its own migration would pass while this
    // migration had quietly widened the gate it sits next to.
    expect(verifier).toContain("still_select_only_no_write_policy");
    expect(verifier).toContain("scan_guard_still_exists");
    expect(verifier).toContain("recorder_still_takes_the_nonce");
    expect(verifier).toContain("this_migration_added_no_permission");
    expect(verifier).toContain("normaliser_is_security_invoker");
  });

  it("25 — the verifier coalesces before bool_and", () => {
    // bool_and IGNORES NULLs, so a check whose subquery returned no rows would
    // be skipped and the verifier would pass vacuously.
    expect(verifier).toContain("bool_and(coalesce(c.ok, false))");
    expect(verifier).not.toMatch(/bool_and\(\s*ok\s*\)/);
  });

  it("25b — the trigger's BEHAVIOUR is proven by a write, not by its existence", () => {
    // The verifier can assert the trigger exists, is security-invoker and
    // watches the right column. It cannot assert that it WORKS — that needs a
    // write, which only the RLS suite performs in CI.
    const rls = read("supabase/tests/rls_customs_reference_test.sql");
    expect(rls).toContain("REGIME NORMALISE FAIL");
    expect(rls).toContain("regime_over_long_refused");
    expect(rls).toContain("regime_cardinality_bounded");
    expect(rls).toContain("regime_reader_write_blocked");
  });

  it("25c — the reader-write probe asserts the ROW, not the absence of an error", () => {
    // An UPDATE with no permitting policy affects zero rows rather than
    // raising, so "no exception" would pass vacuously. The probe must re-read
    // the row and find it unchanged.
    const rls = read("supabase/tests/rls_customs_reference_test.sql");
    expect(rls).toContain("customs_regimes @> array['FORGED']");
    expect(rls).toContain("no permitting policy affects zero rows");
  });

  it("26 — and returns exactly one (ok, detail) row", () => {
    expect(verifier).toMatch(/select\s+bool_and/);
    expect(verifier).toContain("as detail");
  });
});

// ===========================================================================
describe("REF-2 — the new routes carry the REF-1 guarantees", () => {
  it("27 — the checks come BEFORE any work in both new routes", () => {
    for (const [name, route] of [["ticket", ticketRoute], ["finalize", finalizeRoute]] as const) {
      const auth = route.indexOf("getCurrentUser()");
      const perm = route.indexOf("hasPermission(permissions");
      const work = route.indexOf("getAdminSupabaseClient()");
      expect(auth, name).toBeGreaterThan(-1);
      expect(perm, name).toBeGreaterThan(auth);
      expect(work, name).toBeGreaterThan(perm);
    }
  });

  it("28 — no portal branch exists in either", () => {
    expect(ticketRoute).not.toContain("getCurrentPortalUser");
    expect(finalizeRoute).not.toContain("getCurrentPortalUser");
  });

  it("29 — both require customs:reference:publish, never :read", () => {
    for (const [name, route] of [["ticket", ticketRoute], ["finalize", finalizeRoute]] as const) {
      expect(route, name).toContain('hasPermission(permissions, "customs:reference:publish")');
      expect(route, name).not.toContain('"customs:reference:read"');
    }
  });

  it("30 — finalize's INSERT names none of the governance columns", () => {
    const insert = finalizeRoute.slice(
      finalizeRoute.indexOf(".insert({"),
      finalizeRoute.indexOf('.select("id")', finalizeRoute.indexOf(".insert({")),
    );
    expect(insert.length).toBeGreaterThan(0);
    for (const column of [
      "status:",
      "licence_status:",
      "redistribution_allowed:",
      "provenance_verified:",
      "legal_version_verified:",
    ]) {
      expect(insert, column).not.toContain(column);
    }
    // …and it DOES set the metadata column it exists to set.
    expect(insert).toContain("customs_regimes:");
  });

  it("31 — the uploadId is shape-checked before it reaches a storage path", () => {
    // The staging key is built from it. A value carrying `..` or a separator is
    // how an upload escapes its prefix, so the uuid test must come first.
    const guard = finalizeRoute.indexOf("UUID.test(uploadId)");
    const path = finalizeRoute.indexOf("buildStagingPath(");
    expect(guard).toBeGreaterThan(-1);
    expect(path).toBeGreaterThan(guard);
  });

  it("32 — no storage path is built from caller-supplied text", () => {
    // Both paths come from the SESSION's tenant and a server-generated uuid.
    expect(finalizeRoute).toContain("buildStagingPath(user.tenantId, uploadId)");
    expect(finalizeRoute).toContain("buildReferencePath(user.tenantId, documentId)");
    expect(ticketRoute).toContain("buildStagingPath(user.tenantId, uploadId)");
    expect(ticketRoute).toContain("randomUUID()");
  });

  it("33 — finalize validates the bytes it downloaded, at the bucket ceiling", () => {
    expect(finalizeRoute).toContain("validateUpload({");
    expect(finalizeRoute).toContain("maxBytes: MAX_DIRECT_UPLOAD_BYTES");
  });

  it("34 — the recorded hash is taken from the buffer that is uploaded", () => {
    // `content_sha256` must describe what is ACTUALLY stored: the malware gate
    // binds a verdict to it. Hash, then upload the same `bytes`.
    const hash = finalizeRoute.indexOf('createHash("sha256").update(bytes)');
    const upload = finalizeRoute.indexOf(".upload(path, bytes,");
    expect(hash).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(hash);
    // And it is NOT moved: a move would record a hash of bytes read earlier.
    expect(finalizeRoute).not.toContain(".move(");
    expect(finalizeRoute).not.toContain(".copy(");
  });

  it("35 — the object's size is read from metadata before it is downloaded", () => {
    const sized = finalizeRoute.indexOf("MAX_DIRECT_UPLOAD_BYTES");
    const downloaded = finalizeRoute.indexOf(".download(stagingPath)");
    expect(sized).toBeGreaterThan(-1);
    expect(downloaded).toBeGreaterThan(sized);
  });

  it("36 — unvalidated bytes never outlive a refusal", () => {
    // Every refusal after the object exists must drop the staging copy.
    expect(finalizeRoute).toContain("dropStaging");
    const refusals = finalizeRoute.split("return NextResponse.json").length - 1;
    const drops = finalizeRoute.split("dropStaging()").length - 1;
    expect(refusals).toBeGreaterThan(5);
    expect(drops).toBeGreaterThan(5);
  });

  it("37 — a failed audit is compensated, as in REF-1", () => {
    const tail = finalizeRoute.slice(finalizeRoute.indexOf("await writeAudit({"));
    expect(tail).toContain(".delete()");
    expect(tail).toContain(".remove([path])");
    expect(tail).toContain("audit_failed");
  });

  it("38 — the ticket route creates no row and writes no audit event", () => {
    // Nothing has happened yet that the ledger should carry. An unused ticket
    // must leave no trace of a document that never existed.
    expect(ticketRoute).not.toContain(".insert(");
    expect(ticketRoute).not.toContain("writeAudit");
  });

  it("39 — finalize re-resolves the predecessor rather than trusting the ticket", () => {
    // Between minting and finalising, somebody else may have superseded it.
    expect(finalizeRoute).toContain("predecessor_already_superseded");
    expect(finalizeRoute).toContain("reference_code_mismatch");
    expect(finalizeRoute).toContain('.eq("tenant_id", user.tenantId)');
  });

  it("40 — the REF-1 route is untouched by REF-2", () => {
    const ref1 = strip(read("app/api/customs/reference/upload/route.ts"));
    expect(ref1).not.toContain("MAX_DIRECT_UPLOAD_BYTES");
    expect(ref1).not.toContain("buildStagingPath");
    // Still the 4 MB path, still bounded by the platform limit.
    expect(ref1).toContain("validateUpload({");
  });
});

// ===========================================================================
describe("REF-2 — search cannot be escaped from", () => {
  it("41 — no PostgREST `or=` expression is built from operator text", () => {
    // `.or()` takes a RAW filter expression, so a `,` or `)` in a search box
    // would change which rows come back. Single-column filters are encoded.
    expect(service).not.toContain(".or(");
  });

  it("42 — the free-text axis is matched in TypeScript, accent-insensitively", () => {
    expect(service).toContain("function matchesText");
    expect(service).toContain("normalize(\"NFD\")");
  });

  it("43 — the reader's PUBLISHED-only filter is still restated for the service role", () => {
    // A service-role read BYPASSES RLS. REF-2 added filters around this line
    // and must not have displaced it.
    expect(service).toContain('if (!canPublish) query = query.eq("status", "PUBLISHED");');
  });

  it("44 — the status axis cannot widen what a reader sees", () => {
    expect(service).toContain('if (filter?.status && canPublish) query = query.eq("status", filter.status);');
  });

  it("45 — the regime filter goes through the same normaliser as a write", () => {
    // Otherwise searching 'transit' would miss rows stored as 'TRANSIT'.
    expect(service).toContain("normalizeRegimes([filter.regime])");
    expect(service).toContain('.contains("customs_regimes"');
  });

  it("46 — an unrecognised search parameter is dropped, never passed through", () => {
    expect(page).toContain("isReferenceCategory(categoryParam)");
    expect(page).toContain("isReferenceStatus(statusParam)");
  });

  it("47 — the status guard actually recognises the real statuses", () => {
    for (const s of REFERENCE_STATUSES) expect(isReferenceStatus(s)).toBe(true);
    expect(isReferenceStatus("ANYTHING")).toBe(false);
    expect(isReferenceStatus(undefined)).toBe(false);
  });
});

// ===========================================================================
describe("REF-2 — the lifecycle badge is derived, and honest", () => {
  const base = {
    status: "QUARANTINE" as const,
    category: "LEGISLATION" as const,
    licenceStatus: "APPROVED_REDISTRIBUTION" as const,
    provenanceVerified: true,
    legalVersionVerified: true,
    scanStatus: "CLEAN" as const,
  };

  it("48 — everything satisfied reads 'approved'", () => {
    expect(referenceLifecycle(base)).toBe("approved");
  });

  it("49 — WITHOUT a scan it can never read 'approved'", () => {
    // This is the one that matters while no scanner exists: the badge must not
    // tell an operator a document is ready when the gate would refuse it.
    for (const scanStatus of ["UNSCANNED", "SCANNING", "INFECTED"] as const) {
      expect(referenceLifecycle({ ...base, scanStatus }), scanStatus)
        .toBe("pendingVerification");
    }
  });

  it("50 — an unresolved licence or unverified provenance is still pending", () => {
    expect(referenceLifecycle({ ...base, licenceStatus: "RESTRICTED" }))
      .toBe("pendingVerification");
    expect(referenceLifecycle({ ...base, provenanceVerified: false }))
      .toBe("pendingVerification");
    expect(referenceLifecycle({ ...base, legalVersionVerified: false }))
      .toBe("pendingVerification");
  });

  it("51 — published and withdrawn are read from the row, not derived", () => {
    expect(referenceLifecycle({ ...base, status: "PUBLISHED" })).toBe("published");
    expect(referenceLifecycle({ ...base, status: "WITHDRAWN" })).toBe("withdrawn");
    // Withdrawn wins over everything: it is a decision, not a missing step.
    expect(referenceLifecycle({ ...base, status: "WITHDRAWN", scanStatus: "INFECTED" }))
      .toBe("withdrawn");
  });
});

// ===========================================================================
describe("REF-2 — a document that cannot be scanned is handled, not hidden", () => {
  const panel = strip(read("components/customs/reference-library-panel.tsx"));
  const actions = strip(read("lib/customs/reference/actions.ts"));

  it("61 — the operator is told up front, not after pressing a button", () => {
    // Attesting provenance and a licence on a document that can never move is
    // wasted work; the notice belongs above the upload form.
    expect(panel).toContain("scannerConfigured");
    expect(panel).toContain("t.customs.reference.scannerAbsent.title");
    expect(page).toContain("scannerConfigured={scanningAvailable()}");
  });

  it("62 — the scan button is disabled when there is no scanner", () => {
    expect(panel).toContain("disabled={pending || !scannerConfigured}");
  });

  it("63 — but the UI flag is DISPLAY ONLY: the action still refuses server-side", () => {
    // This is the one that matters. A forged or stale `true` must not make a
    // scan believable — it can only produce the same refusal one click later.
    expect(actions).toContain('if (!scanningAvailable()) return { ok: false, error: "scanner_unavailable" };');
    // And the client never decides it: the panel holds no env read.
    expect(panel).not.toContain("process.env");
  });

  it("64 — with no scanner, nothing can be publishable", () => {
    // The gate, restated as a predicate: UNSCANNED always blocks.
    expect(referenceLifecycle({
      status: "QUARANTINE",
      category: "LEGISLATION",
      licenceStatus: "APPROVED_REDISTRIBUTION",
      provenanceVerified: true,
      legalVersionVerified: true,
      scanStatus: "UNSCANNED",
    })).toBe("pendingVerification");
  });
});

// ===========================================================================
describe("REF-2 — the development stub cannot become a production bypass", () => {
  it("52 — the APPLICATION has no stub mode at all", () => {
    // The strongest form of "impossible to activate through a Production
    // environment variable" is that there is nothing to activate. No file
    // under lib/ or app/ may know this stub exists.
    for (const f of [
      "lib/customs/reference/scan.ts",
      "app/api/customs/reference/scan-callback/route.ts",
      "lib/customs/reference/actions.ts",
      "app/api/customs/reference/upload-url/route.ts",
      "app/api/customs/reference/finalize/route.ts",
    ]) {
      const src = read(f).toLowerCase();
      for (const token of ["dev-scan-stub", "dev_scan_stub", "stub", "fake", "simulate"]) {
        expect(src, `${f} must not mention ${token}`).not.toContain(token);
      }
    }
  });

  it("53 — the stub refuses any callback host that is not loopback", () => {
    // This is what makes it incapable of answering a deployed environment,
    // whatever is configured on the other side.
    expect(stub).toContain("LOOPBACK");
    expect(stub).toContain("127.0.0.1");
    const guard = stub.indexOf("LOOPBACK.has(callbackHost)");
    const listen = stub.indexOf("server.listen(");
    expect(guard).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(guard);
    expect(stub).toContain("process.exit(1)");
  });

  it("54 — it refuses to start without an explicit acknowledgement", () => {
    expect(stub).toContain("DEV_SCAN_STUB_ACK");
    expect(stub).toContain("i-know-this-is-not-a-scanner");
  });

  it("55 — it binds its listener to loopback too", () => {
    expect(stub).toContain('server.listen(port, "127.0.0.1"');
  });

  it("56 — every verdict it sends is stamped, permanently", () => {
    // `scanner_version` is persisted on the evidence row AND the document, so a
    // stubbed clearance is identifiable from the database alone.
    expect(stub).toContain('SCANNER_VERSION = "DEV-STUB-NOT-A-REAL-SCAN"');
    expect(stub).toContain("scanner_version: SCANNER_VERSION");
  });

  it("57 — it still binds its verdict to the bytes it was given", () => {
    // A stub that skipped this would be testing a workflow the real worker
    // does not implement.
    expect(stub).toContain("sha256_mismatch");
    expect(stub).toContain("createHash(\"sha256\")");
  });

  it("58 — it echoes the nonce, so the replay index still applies", () => {
    expect(stub).toContain("nonce: job.nonce");
  });

  it("59 — it can produce an INFECTED verdict, so that path is exercisable", () => {
    expect(stub).toContain("INFECTED");
    expect(stub).toContain("Eicar-Test-Signature");
  });

  it("60 — no fabricated clearance: even the stub's CLEAN says so", () => {
    // Mirrors the guard test in the ClamAV worker's own suite. Nothing in
    // REF-2 demonstrates that malware is detected; only that the workflow
    // moves. Detection remains unproven until EICAR has been run against a
    // real ClamAV container.
    //
    // So the stub's own evidence must not read like a scan result: the `detail`
    // it records alongside a CLEAN verdict says in words that nothing was
    // scanned, which lands in `customs_reference_scan.detail` and is readable
    // by anyone auditing why a document was cleared.
    expect(stub).toContain("no scan performed");
    expect(stub).toContain("NOT A MALWARE SCANNER");
    // It names the real worker only to send the operator there, and never
    // claims to BE it: its own identity is the stub version string.
    expect(stub).not.toContain('SCANNER_VERSION = "clamav');
  });
});
