/**
 * CUSTOMS-REF-01A / REF-1 — the Customs Reference Library, against real
 * PostgreSQL.
 * ===========================================================================
 * The structural half lives in tests/customs-reference-ref1.test.ts. This file
 * proves what no amount of source reading can: that the CHECK constraints
 * actually refuse, that the trigger actually fires, that the partial unique
 * index actually holds, and that a reader resolving REAL permissions from the
 * database is really unable to publish.
 *
 * THE ROUTE HANDLERS ARE CALLED DIRECTLY, and that is faithful rather than a
 * shortcut: `lib/auth/current-user` is the harness's one stubbed boundary, so
 * `getCurrentUser()` inside a route resolves to the journey identity while
 * `getEffectivePermissions` still runs against the real role grants. An actor
 * who lacks a permission is refused by the real RBAC lookup.
 *
 * NO DOSSIER IS CREATED BY THIS FILE. That is the point of the slice: a
 * reference document belongs to no dossier, so the journey needs none.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { as } from "./identity";
import { identity, db, auditFor, TENANT_A } from "./fixtures";
import type { CurrentUser } from "@/lib/auth/current-user";

import { POST as uploadRoute } from "@/app/api/customs/reference/upload/route";
import { GET as viewRoute } from "@/app/api/customs/reference/[id]/pdf/route";
// REF-2 — the two halves of the direct-to-storage path.
import { POST as ticketRoute } from "@/app/api/customs/reference/upload-url/route";
import { POST as finalizeRoute } from "@/app/api/customs/reference/finalize/route";
import {
  publishDocument,
  recordLicenceRuling,
  recordVerifications,
  requestScan,
  submitForPublication,
  withdrawDocument,
} from "@/lib/customs/reference/actions";
import { getLibrary, getReferenceDocument, getVersionHistory } from "@/lib/customs/reference/service";
import { MAX_REGIMES, MAX_REGIME_LENGTH } from "@/lib/customs/reference/validate";

const FOREIGN_TENANT = "00000000-0000-0000-0000-0000000000f2";

let chief: CurrentUser;      // CHIEF_OF_TRANSIT — holds read AND publish
let chief2: CurrentUser;     // a SECOND CHIEF_OF_TRANSIT — the checker half
let declarant: CurrentUser;  // CUSTOMS_DECLARANT — holds read only
let driver: CurrentUser;     // DRIVER — holds neither

/** A valid PDF of a given size. The signature is what the route checks. */
function pdf(size = 4096): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 0);
  // A little entropy so two uploads do not share a checksum.
  for (let i = 8; i < Math.min(64, size); i += 1) b[i] = (i * 37) % 251;
  return b;
}

/**
 * REF-1-HARDEN (F2) - `reference_code` is NOT NULL and one PUBLISHED,
 * un-superseded edition is allowed per (tenant, category, code). So every
 * upload needs a key, and cases that are not about lineage need a DISTINCT one
 * or they would collide on publication and prove nothing about what they test.
 */
let seq = 0;

type UploadFields = {
  category?: string;
  title?: string;
  sourceAuthority?: string;
  referenceCode?: string;
  edition?: string;
  publishedOn?: string;
  supersedesId?: string;
  bytes?: Uint8Array;
  mime?: string;
  filename?: string;
};

async function upload(actor: CurrentUser, f: UploadFields = {}) {
  const form = new FormData();
  form.set("category", f.category ?? "LEGISLATION");
  form.set("title", f.title ?? "Code des douanes");
  form.set("sourceAuthority", f.sourceAuthority ?? "Direction Générale des Douanes");
  form.set("referenceCode", f.referenceCode ?? `AUTO-${(seq += 1)}`);
  if (f.edition) form.set("edition", f.edition);
  if (f.publishedOn) form.set("publishedOn", f.publishedOn);
  if (f.supersedesId) form.set("supersedesId", f.supersedesId);
  const bytes = f.bytes ?? pdf();
  form.set(
    "file",
    new File([bytes], f.filename ?? "doc.pdf", { type: f.mime ?? "application/pdf" }),
  );

  const res = await as(actor, () =>
    uploadRoute(
      new Request("http://localhost/api/customs/reference/upload", { method: "POST", body: form }),
    ),
  );
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; status?: string };
  return { status: res.status, body };
}

/** Row straight from the database — no application filtering in the way. */
async function row(id: string) {
  const { data } = await db()
    .from("customs_reference_document")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

/**
 * Record a scan verdict the way the scanner would: through the trusted
 * recorder. The journey cannot call the callback route's HMAC path without a
 * configured secret, so it calls the function the route calls — which is also
 * the only thing in the database allowed to produce a CLEAN state.
 */
async function recordScan(
  id: string,
  verdict: "CLEAN" | "INFECTED" | "ERROR",
  nonce?: string,
) {
  const r = await row(id);
  const { data, error } = await db().rpc("record_customs_reference_scan", {
    p_document: id,
    p_tenant: TENANT_A,
    p_verdict: verdict,
    p_sha256: String(r!.content_sha256),
    p_storage_path: String(r!.storage_path),
    p_scanner_name: "journey-scanner",
    p_scanner_version: "1.0",
    p_engine_ref: `jr-${id.slice(0, 8)}`,
    p_detail: null,
    // SCANNER-01: unique per call unless a case is deliberately replaying one.
    p_nonce: nonce ?? `jn-${crypto.randomUUID()}`,
  });
  expect(error).toBeNull();
  return String(data ?? "");
}

/**
 * Drive a document all the way to PUBLISHED, the governed way — which now means
 * verifications, a licence ruling, a CLEAN scan, a submission by one person and
 * approval by ANOTHER.
 */
async function publishFully(id: string, licence = "INTERNAL_ONLY") {
  await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
  await as(chief, () => recordLicenceRuling(id, licence, "Communiqué par la DGD le 2026-10-17."));
  expect(await recordScan(id, "CLEAN")).toBe("clean");
  expect(await as(chief, () => submitForPublication(id))).toEqual({ ok: true, id });
  return as(chief2, () => publishDocument(id));
}

beforeAll(async () => {
  chief = await identity("transit");
  // REF-1-PUBLISH-GATE: publication needs a second, equally entitled person.
  // `declarantchief` holds CHIEF_OF_TRANSIT (and CUSTOMS_DECLARANT), so the
  // maker-checker proof is about IDENTITY and not about a missing grant.
  chief2 = await identity("declarantchief");
  declarant = await identity("declarant");
  driver = await identity("driver");
  expect(chief.roles).toContain("CHIEF_OF_TRANSIT");
  expect(chief2.roles).toContain("CHIEF_OF_TRANSIT");
  expect(chief2.id).not.toBe(chief.id);
  expect(declarant.roles).toContain("CUSTOMS_DECLARANT");
  expect(driver.roles).toContain("DRIVER");
});

// ===========================================================================
describe("R1 — an upload lands quarantined, with every safety default safe", () => {
  it("records the bytes, the checksum and nothing it was not asked to record", async () => {
    const { status, body } = await upload(chief, { title: "Code des douanes — R1" });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("QUARANTINE");

    const r = await row(body.id!);
    expect(r).toBeTruthy();
    expect(r!.status).toBe("QUARANTINE");
    expect(r!.licence_status).toBe("RESTRICTED");
    expect(r!.redistribution_allowed).toBe(false);
    expect(r!.provenance_verified).toBe(false);
    expect(r!.legal_version_verified).toBe(false);
    expect(r!.published_by).toBeNull();
    expect(r!.published_at).toBeNull();
    expect(r!.version).toBe(1);
    expect(r!.tenant_id).toBe(TENANT_A);
    expect(r!.uploaded_by).toBe(chief.id);
    expect(String(r!.content_sha256)).toMatch(/^[0-9a-f]{64}$/);
    // The object key carries no filename.
    expect(r!.storage_path).toBe(`${TENANT_A}/${body.id}.pdf`);

    const audit = await auditFor("customs.reference.uploaded", body.id!);
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(chief.id);
  });
});

// ===========================================================================
describe("R2 — a quarantined document is invisible to a reader", () => {
  it("the publisher sees it; the Déclarant does not", async () => {
    const { body } = await upload(chief, { title: "Quarantaine — R2" });

    const asChief = await as(chief, () => getLibrary());
    expect(asChief.canPublish).toBe(true);
    expect(asChief.documents.map((d) => d.id)).toContain(body.id);

    const asReader = await as(declarant, () => getLibrary());
    expect(asReader.canPublish).toBe(false);
    expect(asReader.documents.map((d) => d.id)).not.toContain(body.id);
    // And a direct fetch by id is indistinguishable from absent.
    expect(await as(declarant, () => getReferenceDocument(body.id!))).toBeNull();
  });

  it("…and the bytes are refused to the reader with 404, not 403", async () => {
    const { body } = await upload(chief, { title: "Quarantaine — R2b" });
    const res = await as(declarant, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id: body.id! } }),
    );
    // 404: the response must not disclose that the row exists.
    expect(res.status).toBe(404);

    const ok = await as(chief, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id: body.id! } }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
  });
});

// ===========================================================================
describe("R3 — publication is refused until every fact is recorded", () => {
  it("names the missing fact, one at a time, and writes nothing", async () => {
    const { body } = await upload(chief, { title: "Non vérifié — R3" });
    const id = body.id!;

    expect(await as(chief, () => publishDocument(id)))
      .toEqual({ ok: false, error: "provenance_unverified" });

    await as(chief, () => recordVerifications(id, { provenance: true }));
    expect(await as(chief, () => publishDocument(id)))
      .toEqual({ ok: false, error: "legal_version_unverified" });

    await as(chief, () => recordVerifications(id, { legalVersion: true }));
    expect(await as(chief, () => publishDocument(id)))
      .toEqual({ ok: false, error: "licence_unresolved" });

    // REF-1-PUBLISH-GATE extends the same ladder: a licence is not enough.
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "source"));
    expect(await as(chief, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_required" });

    // Still quarantined, still unpublished, and no publication audit exists.
    const r = await row(id);
    expect(r!.status).toBe("QUARANTINE");
    expect(r!.published_by).toBeNull();
    expect((await auditFor("customs.reference.published", id)).length).toBe(0);
  });

  it("a licence ruling without a source is refused", async () => {
    const { body } = await upload(chief, { title: "Licence sans source — R3b" });
    expect(await as(chief, () => recordLicenceRuling(body.id!, "INTERNAL_ONLY", "   ")))
      .toEqual({ ok: false, error: "licence_note_required" });
    expect(await as(chief, () => recordLicenceRuling(body.id!, "FREE_FOR_ALL", "source")))
      .toEqual({ ok: false, error: "licence_invalid" });
  });
});

// ===========================================================================
describe("R4 — the full governed path, and what it makes visible", () => {
  it("publishes, attributes, audits, and becomes readable", async () => {
    const { body } = await upload(chief, { title: "Publié — R4", referenceCode: "R4-CODE" });
    const id = body.id!;
    expect(await publishFully(id)).toEqual({ ok: true, id });

    const r = await row(id);
    expect(r!.status).toBe("PUBLISHED");
    // REF-1-PUBLISH-GATE: the APPROVER publishes, and the submitter is someone
    // else. Asserting `chief` here was the pre-maker-checker expectation.
    expect(r!.published_by).toBe(chief2.id);
    expect(r!.submitted_for_publication_by).toBe(chief.id);
    expect(r!.published_at).toBeTruthy();
    expect(r!.licence_status).toBe("INTERNAL_ONLY");
    // A licence short of redistribution never sets the redistribution flag.
    expect(r!.redistribution_allowed).toBe(false);

    const audit = await auditFor("customs.reference.published", id);
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(chief2.id);

    // The reader can now see it and fetch the bytes.
    const lib = await as(declarant, () => getLibrary());
    expect(lib.documents.map((d) => d.id)).toContain(id);
    const res = await as(declarant, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id } }),
    );
    expect(res.status).toBe(200);
    // Consultation is evidenced.
    expect((await auditFor("customs.reference.accessed", id)).length).toBeGreaterThanOrEqual(1);
  });

  it("a second publication of the same document is refused", async () => {
    const { body } = await upload(chief, { title: "Deux fois — R4b" });
    const id = body.id!;
    expect(await publishFully(id)).toEqual({ ok: true, id });
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "already_published" });
    expect((await auditFor("customs.reference.published", id)).length).toBe(1);
  });
});

// ===========================================================================
describe("R5 — the HS Explanatory Notes licence fence", () => {
  it("a licence ruling short of redistribution is not enough", async () => {
    const { body } = await upload(chief, {
      category: "EXPLANATORY_NOTES",
      title: "Notes explicatives SH — R5",
      sourceAuthority: "Organisation Mondiale des Douanes",
    });
    const id = body.id!;
    await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "Reçu par courriel, licence non communiquée."));
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    await as(chief, () => submitForPublication(id));

    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "explanatory_notes_licence_required" });
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("the DATABASE refuses it too, not only the action", async () => {
    const { body } = await upload(chief, {
      category: "EXPLANATORY_NOTES",
      title: "Notes explicatives SH — R5b",
      sourceAuthority: "Organisation Mondiale des Douanes",
    });
    const id = body.id!;
    // Bypass the action entirely and write the publication directly. The CHECK
    // is what must stop this, because the action is not the only possible
    // writer of a service-role update.
    // Everything the OTHER gates want is in place, so the refusal below can
    // only be the Explanatory-Notes licence fence.
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    await db()
      .from("customs_reference_document")
      .update({
        submitted_for_publication_by: chief.id,
        submitted_for_publication_at: new Date().toISOString(),
      })
      .eq("id", id);
    const { error } = await db()
      .from("customs_reference_document")
      .update({
        status: "PUBLISHED",
        published_by: chief2.id,
        published_at: new Date().toISOString(),
        provenance_verified: true,
        legal_version_verified: true,
        licence_status: "INTERNAL_ONLY",
      })
      .eq("id", id);
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("customs_reference_explanatory_notes_licence");
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("with an explicit redistribution licence it publishes", async () => {
    const { body } = await upload(chief, {
      category: "EXPLANATORY_NOTES",
      title: "Notes explicatives SH — R5c",
      sourceAuthority: "Organisation Mondiale des Douanes",
    });
    const id = body.id!;
    expect(await publishFully(id, "APPROVED_REDISTRIBUTION")).toEqual({ ok: true, id });
    const r = await row(id);
    expect(r!.status).toBe("PUBLISHED");
    expect(r!.redistribution_allowed).toBe(true);
  });
});

// ===========================================================================
describe("R6 — a reader reads, and nothing else", () => {
  it("the Déclarant cannot upload", async () => {
    const { status, body } = await upload(declarant, { title: "Interdit — R6" });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  it("the Déclarant cannot publish, verify, licence or withdraw", async () => {
    const { body } = await upload(chief, { title: "Lecture seule — R6b" });
    const id = body.id!;
    expect(await as(declarant, () => publishDocument(id))).toEqual({ ok: false, error: "forbidden" });
    expect(await as(declarant, () => recordVerifications(id, { provenance: true })))
      .toEqual({ ok: false, error: "forbidden" });
    expect(await as(declarant, () => recordLicenceRuling(id, "INTERNAL_ONLY", "x")))
      .toEqual({ ok: false, error: "forbidden" });
    expect(await as(declarant, () => withdrawDocument(id, "motif"))).toEqual({ ok: false, error: "forbidden" });
    expect(await as(declarant, () => submitForPublication(id))).toEqual({ ok: false, error: "forbidden" });
    expect(await as(declarant, () => requestScan(id))).toEqual({ ok: false, error: "forbidden" });
    // Nothing moved.
    const r = await row(id);
    expect(r!.status).toBe("QUARANTINE");
    expect(r!.provenance_verified).toBe(false);
  });
});

// ===========================================================================
describe("R7 — the library is unreachable without the permission", () => {
  it("a driver cannot read it, fetch it, or upload to it", async () => {
    const { body } = await upload(chief, { title: "Hors périmètre — R7" });
    const id = body.id!;
    await publishFully(id);

    // The real RBAC lookup refuses: assertPermission throws.
    await expect(as(driver, () => getLibrary())).rejects.toThrow();
    const res = await as(driver, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id } }),
    );
    expect(res.status).toBe(403);
    const up = await upload(driver, { title: "Hors périmètre — R7b" });
    expect(up.status).toBe(403);
  });
});

// ===========================================================================
describe("R8 — replacement preserves the history", () => {
  it("v2 supersedes v1 at publication, and both remain", async () => {
    const first = await upload(chief, {
      title: "TEC 2022",
      category: "TARIFF",
      referenceCode: "TEC-R8",
      edition: "2022",
    });
    const v1 = first.body.id!;
    expect(await publishFully(v1)).toEqual({ ok: true, id: v1 });

    const second = await upload(chief, {
      title: "TEC 2026",
      category: "TARIFF",
      referenceCode: "TEC-R8",
      edition: "2026",
      supersedesId: v1,
    });
    expect(second.status).toBe(201);
    const v2 = second.body.id!;
    expect((await row(v2))!.version).toBe(2);
    expect((await row(v2))!.supersedes_id).toBe(v1);

    // Before publication, v1 is still the current edition.
    expect((await row(v1))!.superseded_at).toBeNull();

    expect(await publishFully(v2)).toEqual({ ok: true, id: v2 });

    const r1 = await row(v1);
    const r2 = await row(v2);
    expect(r1!.superseded_by_id).toBe(v2);
    expect(r1!.superseded_at).toBeTruthy();
    // The predecessor is NOT deleted and NOT withdrawn: it was published, and
    // it is now superseded. That distinction is the history.
    expect(r1!.status).toBe("PUBLISHED");
    expect(r2!.superseded_at).toBeNull();

    const history = await as(chief, () => getVersionHistory("TEC-R8", "TARIFF"));
    expect(history.map((d) => d.version)).toEqual([2, 1]);
    expect((await auditFor("customs.reference.replaced", v2)).length).toBe(1);
  });

  it("a predecessor can only be replaced once", async () => {
    const first = await upload(chief, { title: "Base — R8b", referenceCode: "R8B", category: "CIRCULAR" });
    const v1 = first.body.id!;
    const a = await upload(chief, { title: "Rempl. A", referenceCode: "R8B", category: "CIRCULAR", supersedesId: v1 });
    expect(a.status).toBe(201);
    await publishFully(v1).catch(() => undefined);
    expect(await publishFully(a.body.id!)).toEqual({ ok: true, id: a.body.id });
    // v1 is now superseded, so a second replacement of it is refused upfront.
    const b = await upload(chief, { title: "Rempl. B", referenceCode: "R8B", category: "CIRCULAR", supersedesId: v1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("predecessor_already_superseded");
  });

  it("a replacement may not cross categories", async () => {
    const first = await upload(chief, { title: "Catégorie — R8c", category: "CIRCULAR", referenceCode: "R8C" });
    const res = await upload(chief, {
      title: "Mauvaise catégorie",
      category: "TARIFF",
      referenceCode: "R8C",
      supersedesId: first.body.id!,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("category_mismatch");
  });

  it("the database admits one current published edition per business key", async () => {
    // Asserted against the INDEX, not the action: two published, un-superseded
    // rows sharing a key must be impossible however they are written.
    const a = await upload(chief, { title: "Unicité A", category: "REGIME_LIST", referenceCode: "UQ-R8" });
    await publishFully(a.body.id!);
    const b = await upload(chief, { title: "Unicité B", category: "REGIME_LIST", referenceCode: "UQ-R8" });
    await as(chief, () => recordVerifications(b.body.id!, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(b.body.id!, "INTERNAL_ONLY", "source"));
    expect(await recordScan(b.body.id!, "CLEAN")).toBe("clean");
    await as(chief, () => submitForPublication(b.body.id!));
    const { error } = await db()
      .from("customs_reference_document")
      .update({ status: "PUBLISHED", published_by: chief2.id, published_at: new Date().toISOString() })
      .eq("id", b.body.id!);
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("uq_customs_reference_one_current");
  });
});

// ===========================================================================
describe("R9 — tenancy", () => {
  it("a document in another tenant is invisible, even to a publisher", async () => {
    const foreignId = crypto.randomUUID();
    const { error } = await db().from("customs_reference_document").insert({
      id: foreignId,
      tenant_id: FOREIGN_TENANT,
      category: "LEGISLATION",
      title: "Texte d'un autre tenant — R9",
      source_authority: "Autre administration",
      reference_code: "R9-FOREIGN",
      storage_path: `${FOREIGN_TENANT}/${foreignId}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 4096,
      content_sha256: "f".repeat(64),
      uploaded_by: chief.id,
    });
    expect(error).toBeNull();

    const lib = await as(chief, () => getLibrary());
    expect(lib.documents.map((d) => d.id)).not.toContain(foreignId);
    expect(await as(chief, () => getReferenceDocument(foreignId))).toBeNull();

    // And the bytes door refuses it as not-found rather than forbidden.
    const res = await as(chief, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id: foreignId } }),
    );
    expect(res.status).toBe(404);
  });

  it("a replacement cannot be chained onto another tenant's document", async () => {
    const { data } = await db()
      .from("customs_reference_document")
      .select("id, reference_code, category")
      .eq("tenant_id", FOREIGN_TENANT)
      .limit(1);
    const foreign = (data ?? [])[0] as
      { id: string; reference_code: string; category: string } | undefined;
    expect(foreign).toBeTruthy();
    const res = await upload(chief, {
      title: "Chaînage interdit — R9b",
      referenceCode: "R9-FOREIGN",
      supersedesId: foreign!.id,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("predecessor_not_found");
  });
});

// ===========================================================================
describe("R10 — the upload refuses what it should, through the real route", () => {
  it("a disguised non-PDF is refused on its bytes", async () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>".padEnd(4096, " "));
    const res = await upload(chief, { title: "Faux PDF — R10", bytes: html });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_a_pdf");
  });

  it("a non-PDF declared type, a tiny file and missing metadata are refused", async () => {
    expect((await upload(chief, { title: "x", mime: "image/png" })).body.error).toBe("mime_not_pdf");
    expect((await upload(chief, { title: "x", bytes: pdf(32) })).body.error).toBe("too_small");
    expect((await upload(chief, { title: "   " })).body.error).toBe("title_required");
    expect((await upload(chief, { sourceAuthority: "" })).body.error).toBe("authority_required");
    expect((await upload(chief, { category: "INVENTED" })).body.error).toBe("category_invalid");
    expect((await upload(chief, { publishedOn: "16/10/2026" })).body.error).toBe("published_on_invalid");
  });

  it("a refused upload leaves no row and no audit", async () => {
    const before = await db()
      .from("customs_reference_document")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_A);
    await upload(chief, { title: "Rien — R10c", bytes: new TextEncoder().encode("x".repeat(4096)) });
    const after = await db()
      .from("customs_reference_document")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_A);
    expect(after.count).toBe(before.count);
  });
});

// ===========================================================================
describe("R11 — the stored object and its identity are immutable", () => {
  it("the trigger refuses to repoint the storage path or rewrite the checksum", async () => {
    const { body } = await upload(chief, { title: "Immuable — R11" });
    const id = body.id!;
    const original = await row(id);

    for (const patch of [
      { storage_path: `${TENANT_A}/elsewhere.pdf` },
      { content_sha256: "a".repeat(64) },
      { size_bytes: 1 },
      { version: 99 },
      { uploaded_by: declarant.id },
      { category: "TARIFF" },
    ]) {
      const { error } = await db().from("customs_reference_document").update(patch).eq("id", id);
      expect(error, JSON.stringify(patch)).toBeTruthy();
      expect(String(error!.message)).toContain("immutable");
    }

    const unchanged = await row(id);
    expect(unchanged!.storage_path).toBe(original!.storage_path);
    expect(unchanged!.content_sha256).toBe(original!.content_sha256);
  });

  it("a recorded publication cannot be re-attributed", async () => {
    const { body } = await upload(chief, { title: "Attribution — R11b" });
    const id = body.id!;
    await publishFully(id);
    const { error } = await db()
      .from("customs_reference_document")
      .update({ published_by: declarant.id })
      .eq("id", id);
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("re-attributed");
  });
});

// ===========================================================================
describe("R12 — withdrawal ends consultability and destroys nothing", () => {
  it("requires a reason, hides the document from readers, and keeps the row", async () => {
    const { body } = await upload(chief, { title: "Retiré — R12" });
    const id = body.id!;
    await publishFully(id);

    expect(await as(chief, () => withdrawDocument(id, "   "))).toEqual({ ok: false, error: "reason_required" });

    expect(await as(chief, () => withdrawDocument(id, "Édition remplacée par la DGD.")))
      .toEqual({ ok: true, id });
    expect(await as(chief, () => withdrawDocument(id, "encore")))
      .toEqual({ ok: false, error: "already_withdrawn" });

    const r = await row(id);
    expect(r!.status).toBe("WITHDRAWN");
    expect(r!.withdrawn_by).toBe(chief.id);
    // The bytes are still referenced: nothing was destroyed.
    expect(r!.storage_path).toBeTruthy();

    const lib = await as(declarant, () => getLibrary());
    expect(lib.documents.map((d) => d.id)).not.toContain(id);
    const res = await as(declarant, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id } }),
    );
    expect(res.status).toBe(404);
    expect((await auditFor("customs.reference.withdrawn", id)).length).toBe(1);
  });

  it("a withdrawn document cannot be verified back into publication", async () => {
    const { body } = await upload(chief, { title: "Retiré puis — R12b" });
    const id = body.id!;
    await publishFully(id);
    await as(chief, () => withdrawDocument(id, "motif"));
    expect(await as(chief, () => recordVerifications(id, { provenance: true })))
      .toEqual({ ok: false, error: "withdrawn" });
    expect(await as(chief, () => publishDocument(id))).toEqual({ ok: false, error: "withdrawn" });
  });
});

// ===========================================================================
describe("R13 — F2: a replacement inherits its predecessor's business key", () => {
  it("the route refuses a replacement whose code disagrees", async () => {
    const v1 = await upload(chief, {
      title: "TEC — R13", category: "TARIFF", referenceCode: "TEC-R13",
    });
    expect(v1.status).toBe(201);
    const bad = await upload(chief, {
      title: "TEC nouvelle édition", category: "TARIFF",
      referenceCode: "TEC-DIFFERENT", supersedesId: v1.body.id!,
    });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe("reference_code_mismatch");
  });

  it("a matching code is accepted and the lineage is recorded", async () => {
    const v1 = await upload(chief, {
      title: "Code — R13b", category: "LEGISLATION", referenceCode: "CODE-R13B",
    });
    const v2 = await upload(chief, {
      title: "Code — R13b éd. 2", category: "LEGISLATION",
      referenceCode: "CODE-R13B", supersedesId: v1.body.id!,
    });
    expect(v2.status).toBe(201);
    const r2 = await row(v2.body.id!);
    expect(r2!.reference_code).toBe("CODE-R13B");
    expect(r2!.version).toBe(2);
    // Both editions answer to the same key, which is what makes the history one
    // document rather than two.
    const history = await as(chief, () => getVersionHistory("CODE-R13B", "LEGISLATION"));
    expect(history.map((d) => d.version)).toEqual([2, 1]);
  });

  it("the DATABASE refuses a mismatched lineage even without the route", async () => {
    // The route is not the only possible writer of a service-role insert, so
    // the rule has to exist below it. This bypasses the route entirely.
    const v1 = await upload(chief, {
      title: "Socle — R13c", category: "CIRCULAR", referenceCode: "CIRC-R13C",
    });
    const id = crypto.randomUUID();
    const { error } = await db().from("customs_reference_document").insert({
      id,
      tenant_id: TENANT_A,
      category: "CIRCULAR",
      title: "Édition au mauvais code",
      source_authority: "DGD",
      reference_code: "CIRC-AUTRE",
      supersedes_id: v1.body.id!,
      storage_path: `${TENANT_A}/${id}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 4096,
      content_sha256: "d".repeat(64),
      uploaded_by: chief.id,
    });
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("reference code");
    expect(await row(id)).toBeNull();
  });

  it("…and refuses a replacement that crosses tenants", async () => {
    const { data } = await db()
      .from("customs_reference_document")
      .select("id, reference_code, category")
      .eq("tenant_id", FOREIGN_TENANT)
      .limit(1);
    const foreign = (data ?? [])[0] as
      { id: string; reference_code: string; category: string } | undefined;
    expect(foreign).toBeTruthy();
    const id = crypto.randomUUID();
    const { error } = await db().from("customs_reference_document").insert({
      id,
      tenant_id: TENANT_A,
      category: foreign!.category,
      title: "Chaînage inter-tenant",
      source_authority: "DGD",
      reference_code: foreign!.reference_code,
      supersedes_id: foreign!.id,
      storage_path: `${TENANT_A}/${id}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 4096,
      content_sha256: "e".repeat(64),
      uploaded_by: chief.id,
    });
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("cross tenants");
  });

  it("an upload with no business key is refused", async () => {
    const form = new FormData();
    form.set("category", "LEGISLATION");
    form.set("title", "Sans code — R13e");
    form.set("sourceAuthority", "DGD");
    form.set("file", new File([pdf()], "d.pdf", { type: "application/pdf" }));
    const res = await as(chief, () =>
      uploadRoute(new Request("http://localhost/x", { method: "POST", body: form })),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("reference_code_required");
  });
});

// ===========================================================================
describe("R14 — F4: a withdrawn document is frozen", () => {
  it("the action refuses a licence ruling on a withdrawn document", async () => {
    const { body } = await upload(chief, { title: "Gelé — R14" });
    const id = body.id!;
    await publishFully(id);
    await as(chief, () => withdrawDocument(id, "Remplacé par la DGD."));

    expect(await as(chief, () => recordLicenceRuling(id, "APPROVED_REDISTRIBUTION", "nouvelle source")))
      .toEqual({ ok: false, error: "withdrawn" });

    const r = await row(id);
    expect(r!.licence_status).toBe("INTERNAL_ONLY");
    expect(r!.redistribution_allowed).toBe(false);
  });

  it("the DATABASE refuses it too, licence and verifications alike", async () => {
    const { body } = await upload(chief, { title: "Gelé — R14b" });
    const id = body.id!;
    await publishFully(id);
    await as(chief, () => withdrawDocument(id, "motif"));

    for (const patch of [
      { licence_status: "APPROVED_REDISTRIBUTION" },
      { redistribution_allowed: true },
      { licence_note: "réécrit" },
      { provenance_verified: false },
      { legal_version_verified: false },
    ]) {
      const { error } = await db()
        .from("customs_reference_document")
        .update(patch)
        .eq("id", id);
      expect(error, JSON.stringify(patch)).toBeTruthy();
      expect(String(error!.message)).toContain("frozen");
    }

    const r = await row(id);
    expect(r!.licence_status).toBe("INTERNAL_ONLY");
    expect(r!.provenance_verified).toBe(true);
  });
});

// ===========================================================================
describe("R15 — the publication matrix: every scan state, attempted", () => {
  /** A document with everything EXCEPT a scan verdict and an approver. */
  async function readyExceptScan(title: string) {
    const { body } = await upload(chief, { title });
    const id = body.id!;
    await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "Source DGD."));
    await as(chief, () => submitForPublication(id));
    return id;
  }

  it("UNSCANNED — refused, and nothing moves", async () => {
    const id = await readyExceptScan("Matrice UNSCANNED");
    expect((await row(id))!.scan_status).toBe("UNSCANNED");
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_required" });
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("SCANNING — refused: an outstanding verdict is not a pass", async () => {
    const id = await readyExceptScan("Matrice SCANNING");
    // Reached the way the application reaches it, without a configured
    // scanner: the status move is the application's, the verdict never comes.
    await db().from("customs_reference_document")
      .update({ scan_status: "SCANNING", scan_requested_at: new Date().toISOString() })
      .eq("id", id);
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_in_progress" });
  });

  it("INFECTED — refused", async () => {
    const id = await readyExceptScan("Matrice INFECTED");
    expect(await recordScan(id, "INFECTED")).toBe("infected");
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_infected" });
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("ERROR — refused: an outage fails CLOSED", async () => {
    const id = await readyExceptScan("Matrice ERROR");
    expect(await recordScan(id, "ERROR")).toBe("error");
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_error" });
  });

  it("CLEAN from an unauthorized writer — the database refuses the state itself", async () => {
    const id = await readyExceptScan("Matrice CLEAN forgé");
    const r = await row(id);
    // The service-role client is the most privileged thing the application
    // has, and it still cannot manufacture a clearance.
    const { error } = await db().from("customs_reference_document").update({
      scan_status: "CLEAN",
      scanned_sha256: String(r!.content_sha256),
      scanned_storage_path: String(r!.storage_path),
      scan_completed_at: new Date().toISOString(),
      scanner_name: "forged",
    }).eq("id", id);
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("trusted scan recorder");
    expect((await row(id))!.scan_status).toBe("UNSCANNED");
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_required" });
  });

  it("CLEAN about the wrong bytes — refused by the recorder", async () => {
    const id = await readyExceptScan("Matrice mauvaise empreinte");
    const { data } = await db().rpc("record_customs_reference_scan", {
      p_document: id,
      p_tenant: TENANT_A,
      p_verdict: "CLEAN",
      p_sha256: "f".repeat(64),
      p_storage_path: "somewhere/else.pdf",
      p_scanner_name: "journey-scanner",
      p_scanner_version: null,
      p_engine_ref: null,
      p_detail: null,
    });
    expect(String(data)).toBe("binding_mismatch");
    expect((await row(id))!.scan_status).toBe("UNSCANNED");
  });

  it("CLEAN from the trusted process, approved by a second person — published", async () => {
    const id = await readyExceptScan("Matrice CLEAN");
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    expect(await as(chief2, () => publishDocument(id))).toEqual({ ok: true, id });

    const r = await row(id);
    expect(r!.status).toBe("PUBLISHED");
    expect(r!.scan_status).toBe("CLEAN");
    // The clearance is bound to the object it examined.
    expect(r!.scanned_sha256).toBe(r!.content_sha256);
    expect(r!.scanned_storage_path).toBe(r!.storage_path);
    // Two different people, both recorded.
    expect(r!.submitted_for_publication_by).toBe(chief.id);
    expect(r!.published_by).toBe(chief2.id);
  });

  it("every verdict leaves append-only evidence", async () => {
    const id = await readyExceptScan("Matrice preuves");
    await recordScan(id, "ERROR");
    await recordScan(id, "CLEAN");
    const { data } = await db()
      .from("customs_reference_scan")
      .select("verdict, sha256, scanner_name")
      .eq("document_id", id)
      .order("recorded_at", { ascending: true });
    expect((data ?? []).map((r) => (r as { verdict: string }).verdict)).toEqual(["ERROR", "CLEAN"]);
    // …and it cannot be rewritten or removed.
    const upd = await db().from("customs_reference_scan")
      .update({ verdict: "CLEAN" }).eq("document_id", id);
    expect(upd.error).toBeTruthy();
    const del = await db().from("customs_reference_scan").delete().eq("document_id", id);
    expect(del.error).toBeTruthy();
  });

  it("a rescan that turns INFECTED retires a PUBLISHED document", async () => {
    const id = await readyExceptScan("Matrice rescan");
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    expect(await as(chief2, () => publishDocument(id))).toEqual({ ok: true, id });

    // New signatures, same bytes: the clearance is revoked and the document
    // cannot stay published.
    expect(await recordScan(id, "INFECTED")).toBe("withdrawn_by_scan");
    const r = await row(id);
    expect(r!.status).toBe("WITHDRAWN");
    expect(r!.scan_status).toBe("INFECTED");
    expect(r!.withdrawn_source).toBe("SCAN");
    // No human is credited with a machine's decision.
    expect(r!.withdrawn_by).toBeNull();
    // And it is no longer consultable by a reader.
    const lib = await as(declarant, () => getLibrary());
    expect(lib.documents.map((d) => d.id)).not.toContain(id);
  });
});

// ===========================================================================
describe("R16 — maker-checker on publication", () => {
  async function scannedAndLicensed(title: string) {
    const { body } = await upload(chief, { title });
    const id = body.id!;
    await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "Source DGD."));
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    return id;
  }

  it("an unsubmitted document cannot be published", async () => {
    const id = await scannedAndLicensed("MC non transmis");
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "not_submitted" });
  });

  it("the SAME person cannot submit and approve", async () => {
    const id = await scannedAndLicensed("MC auto-approbation");
    expect(await as(chief, () => submitForPublication(id))).toEqual({ ok: true, id });
    expect(await as(chief, () => publishDocument(id)))
      .toEqual({ ok: false, error: "self_approval_forbidden" });
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("…and the DATABASE refuses it, not just the action", async () => {
    const id = await scannedAndLicensed("MC auto-approbation SQL");
    await as(chief, () => submitForPublication(id));
    // Straight past the action, with the service role.
    const { error } = await db().from("customs_reference_document").update({
      status: "PUBLISHED",
      published_by: chief.id,            // the submitter
      published_at: new Date().toISOString(),
    }).eq("id", id);
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("customs_reference_publication_requires_two_actors");
    expect((await row(id))!.status).toBe("QUARANTINE");
  });

  it("a different authorized person CAN approve, and both are recorded", async () => {
    const id = await scannedAndLicensed("MC approbation");
    await as(chief, () => submitForPublication(id));
    expect(await as(chief2, () => publishDocument(id))).toEqual({ ok: true, id });
    const r = await row(id);
    expect(r!.submitted_for_publication_by).toBe(chief.id);
    expect(r!.published_by).toBe(chief2.id);
    expect((await auditFor("customs.reference.submitted", id)).length).toBe(1);
    expect((await auditFor("customs.reference.published", id)).length).toBe(1);
  });

  it("a submission cannot be re-made, or made on a published document", async () => {
    const id = await scannedAndLicensed("MC double transmission");
    await as(chief, () => submitForPublication(id));
    expect(await as(chief2, () => submitForPublication(id)))
      .toEqual({ ok: false, error: "already_submitted" });
    await as(chief2, () => publishDocument(id));
    expect(await as(chief, () => submitForPublication(id)))
      .toEqual({ ok: false, error: "already_published" });
  });

  it("the RPCs refuse an actor who does not hold the permission", async () => {
    const id = await scannedAndLicensed("MC sans autorité");
    // Straight to the function, nominating the Déclarant. OPS-SEC-2A's SERVICE
    // lane checks the NOMINATED actor, so the service role is transport here,
    // not authority.
    const { error } = await db().rpc("submit_customs_reference_for_publication", {
      p_document: id, p_tenant: TENANT_A, p_actor: declarant.id,
    });
    expect(error).toBeTruthy();
    expect(String(error!.message)).toContain("customs:reference:publish");
  });

  it("cross-tenant: neither RPC will touch another tenant's document", async () => {
    const { data } = await db()
      .from("customs_reference_document")
      .select("id")
      .eq("tenant_id", FOREIGN_TENANT)
      .limit(1);
    const foreign = (data ?? [])[0] as { id: string } | undefined;
    expect(foreign).toBeTruthy();

    const sub = await db().rpc("submit_customs_reference_for_publication", {
      p_document: foreign!.id, p_tenant: TENANT_A, p_actor: chief.id,
    });
    expect(String(sub.data ?? "")).toBe("not_found");

    const pub = await db().rpc("publish_customs_reference", {
      p_document: foreign!.id, p_tenant: TENANT_A, p_approver: chief2.id,
    });
    expect(String(pub.data ?? "")).toBe("not_found");

    // And a scan verdict cannot be aimed across the boundary either.
    const scan = await db().rpc("record_customs_reference_scan", {
      p_document: foreign!.id, p_tenant: TENANT_A, p_verdict: "CLEAN",
      p_sha256: "a".repeat(64), p_storage_path: "x", p_scanner_name: "journey-scanner",
      p_scanner_version: null, p_engine_ref: null, p_detail: null,
    });
    expect(String(scan.data ?? "")).toBe("not_found");
  });
});

// ===========================================================================
describe("R17 — Part C: replacement publication is now one transaction", () => {
  it("the predecessor is retired and the successor published atomically", async () => {
    const v1 = await upload(chief, {
      title: "TEC — R17", category: "TARIFF", referenceCode: "TEC-R17",
    });
    expect(await publishFully(v1.body.id!)).toEqual({ ok: true, id: v1.body.id });

    const v2 = await upload(chief, {
      title: "TEC — R17 éd. 2", category: "TARIFF",
      referenceCode: "TEC-R17", supersedesId: v1.body.id!,
    });
    expect(await publishFully(v2.body.id!)).toEqual({ ok: true, id: v2.body.id });

    const r1 = await row(v1.body.id!);
    const r2 = await row(v2.body.id!);
    expect(r1!.superseded_by_id).toBe(v2.body.id);
    expect(r1!.superseded_at).toBeTruthy();
    expect(r1!.status).toBe("PUBLISHED");   // published, and now superseded
    expect(r2!.status).toBe("PUBLISHED");
    expect(r2!.superseded_at).toBeNull();
    const history = await as(chief, () => getVersionHistory("TEC-R17", "TARIFF"));
    expect(history.map((d) => d.version)).toEqual([2, 1]);
  });

  it("a refused publication leaves the predecessor untouched — no half-applied state", async () => {
    const v1 = await upload(chief, {
      title: "Socle — R17b", category: "CIRCULAR", referenceCode: "CIRC-R17B",
    });
    await publishFully(v1.body.id!);

    const v2 = await upload(chief, {
      title: "Socle — R17b éd. 2", category: "CIRCULAR",
      referenceCode: "CIRC-R17B", supersedesId: v1.body.id!,
    });
    const id2 = v2.body.id!;
    // Everything except the scan, so the RPC refuses AFTER it would have
    // reached the supersession step had the checks been ordered badly.
    await as(chief, () => recordVerifications(id2, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id2, "INTERNAL_ONLY", "source"));
    await as(chief, () => submitForPublication(id2));
    expect(await as(chief2, () => publishDocument(id2)))
      .toEqual({ ok: false, error: "scan_required" });

    // The predecessor is still the current edition: nothing was retired on the
    // strength of a publication that did not happen.
    const r1 = await row(v1.body.id!);
    expect(r1!.superseded_by_id).toBeNull();
    expect(r1!.superseded_at).toBeNull();
    expect(r1!.status).toBe("PUBLISHED");
  });

  it("an operator withdrawal records its source as OPERATOR", async () => {
    const { body } = await upload(chief, { title: "Retrait opérateur — R17c" });
    const id = body.id!;
    await publishFully(id);
    expect(await as(chief, () => withdrawDocument(id, "Remplacé par la DGD.")))
      .toEqual({ ok: true, id });
    const r = await row(id);
    expect(r!.withdrawn_source).toBe("OPERATOR");
    expect(r!.withdrawn_by).toBe(chief.id);
  });
});

// ===========================================================================
describe("R18 — SCANNER-01: a verdict cannot be replayed", () => {
  it("the same nonce twice is refused, and changes nothing", async () => {
    const { body } = await upload(chief, { title: "Replay — R18" });
    const id = body.id!;
    const nonce = `fixed-${crypto.randomUUID()}`;

    expect(await recordScan(id, "CLEAN", nonce)).toBe("clean");
    expect((await row(id))!.scan_status).toBe("CLEAN");

    // THE ATTACK, exactly: the identical callback arriving a second time.
    expect(await recordScan(id, "CLEAN", nonce)).toBe("replayed");

    // One evidence row, not two: the refusal happens on the insert.
    const { data } = await db()
      .from("customs_reference_scan")
      .select("id, callback_nonce")
      .eq("document_id", id);
    expect((data ?? []).length).toBe(1);
  });

  it("a captured CLEAN cannot resurrect a clearance a rescan revoked", async () => {
    // The concrete harm the nonce exists to prevent. A document is cleared and
    // published; a rescan finds a signature and retires it; the original CLEAN
    // callback is replayed. Without the nonce the library's own evidence would
    // then say the current verdict was clean on a file its scanner rejected.
    const { body } = await upload(chief, { title: "Replay après rescan — R18b" });
    const id = body.id!;
    const cleanNonce = `clean-${crypto.randomUUID()}`;

    await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "Source DGD."));
    expect(await recordScan(id, "CLEAN", cleanNonce)).toBe("clean");
    await as(chief, () => submitForPublication(id));
    expect(await as(chief2, () => publishDocument(id))).toEqual({ ok: true, id });

    expect(await recordScan(id, "INFECTED")).toBe("withdrawn_by_scan");
    expect((await row(id))!.scan_status).toBe("INFECTED");

    // Replay the original clearance.
    expect(await recordScan(id, "CLEAN", cleanNonce)).toBe("replayed");

    const r = await row(id);
    expect(r!.scan_status).toBe("INFECTED");   // still revoked
    expect(r!.status).toBe("WITHDRAWN");
    expect(r!.scanned_sha256).toBeNull();
  });

  it("a DIFFERENT nonce for the same document is accepted — a rescan is legitimate", async () => {
    const { body } = await upload(chief, { title: "Rescan légitime — R18c" });
    const id = body.id!;
    expect(await recordScan(id, "ERROR")).toBe("error");
    expect(await recordScan(id, "CLEAN")).toBe("clean");
    const { data } = await db()
      .from("customs_reference_scan")
      .select("verdict")
      .eq("document_id", id)
      .order("recorded_at", { ascending: true });
    expect((data ?? []).map((r) => (r as { verdict: string }).verdict)).toEqual(["ERROR", "CLEAN"]);
  });

  it("a nonce is unique per document, not globally — two documents may share one", async () => {
    // Scoping it per document is deliberate: a scanner that derives its nonce
    // from its own job id must not be unable to scan a second file.
    const a = await upload(chief, { title: "Nonce A — R18d" });
    const b = await upload(chief, { title: "Nonce B — R18d" });
    const shared = `shared-${crypto.randomUUID()}`;
    expect(await recordScan(a.body.id!, "CLEAN", shared)).toBe("clean");
    expect(await recordScan(b.body.id!, "CLEAN", shared)).toBe("clean");
  });
});

// ===========================================================================
describe("R19 — SCANNER-01: outage and a lost scan", () => {
  const savedEnv = { ...process.env };
  afterEach(() => { process.env = { ...savedEnv }; });

  it("with no scanner configured, a scan cannot be requested at all", async () => {
    delete process.env.CUSTOMS_SCAN_ENDPOINT;
    delete process.env.CUSTOMS_SCAN_CALLBACK_SECRET;
    const { body } = await upload(chief, { title: "Sans scanner — R19" });
    expect(await as(chief, () => requestScan(body.id!)))
      .toEqual({ ok: false, error: "scanner_unavailable" });
    // Still UNSCANNED, and therefore still unpublishable.
    expect((await row(body.id!))!.scan_status).toBe("UNSCANNED");
  });

  it("an unreachable scanner leaves the document where it was, not SCANNING", async () => {
    // A configured-but-dead endpoint is the outage case. The status must not be
    // left claiming a scan is in progress when nothing is scanning.
    process.env.CUSTOMS_SCAN_ENDPOINT = "http://127.0.0.1:1/scan";
    process.env.CUSTOMS_SCAN_CALLBACK_SECRET = "journey-secret-not-real";
    const { body } = await upload(chief, { title: "Scanner injoignable — R19b" });
    const id = body.id!;

    const res = await as(chief, () => requestScan(id));
    expect(res).toEqual({ ok: false, error: "dispatch_failed" });
    expect((await row(id))!.scan_status).toBe("UNSCANNED");
    // And publication is still refused for the right reason.
    await as(chief, () => recordVerifications(id, { provenance: true, legalVersion: true }));
    await as(chief, () => recordLicenceRuling(id, "INTERNAL_ONLY", "src"));
    await as(chief, () => submitForPublication(id));
    expect(await as(chief2, () => publishDocument(id)))
      .toEqual({ ok: false, error: "scan_required" });
  });

  it("a FRESH SCANNING document cannot be re-requested", async () => {
    process.env.CUSTOMS_SCAN_ENDPOINT = "http://127.0.0.1:1/scan";
    process.env.CUSTOMS_SCAN_CALLBACK_SECRET = "journey-secret-not-real";
    const { body } = await upload(chief, { title: "Scan en cours — R19c" });
    const id = body.id!;
    await db().from("customs_reference_document")
      .update({ scan_status: "SCANNING", scan_requested_at: new Date().toISOString() })
      .eq("id", id);
    expect(await as(chief, () => requestScan(id)))
      .toEqual({ ok: false, error: "scan_not_requestable" });
    expect((await row(id))!.scan_status).toBe("SCANNING");
  });

  it("a LOST scan can be re-requested, so a document is never stranded", async () => {
    // Before SCANNER-01 only UNSCANNED and ERROR were requestable, so a verdict
    // that never arrived left the document unpublishable AND unfixable.
    process.env.CUSTOMS_SCAN_ENDPOINT = "http://127.0.0.1:1/scan";
    process.env.CUSTOMS_SCAN_CALLBACK_SECRET = "journey-secret-not-real";
    const { body } = await upload(chief, { title: "Scan perdu — R19d" });
    const id = body.id!;
    await db().from("customs_reference_document")
      .update({
        scan_status: "SCANNING",
        scan_requested_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", id);

    // Reached the dispatch, which then fails against the dead endpoint — proof
    // the eligibility check let it through rather than refusing upfront.
    expect(await as(chief, () => requestScan(id)))
      .toEqual({ ok: false, error: "dispatch_failed" });
    // Reverted to SCANNING, which is where it was: no state invented.
    expect((await row(id))!.scan_status).toBe("SCANNING");
  });

  it("a withdrawn document is never scanned again", async () => {
    process.env.CUSTOMS_SCAN_ENDPOINT = "http://127.0.0.1:1/scan";
    process.env.CUSTOMS_SCAN_CALLBACK_SECRET = "journey-secret-not-real";
    const { body } = await upload(chief, { title: "Retiré puis scan — R19e" });
    const id = body.id!;
    await publishFully(id);
    await as(chief, () => withdrawDocument(id, "motif"));
    expect(await as(chief, () => requestScan(id)))
      .toEqual({ ok: false, error: "withdrawn" });
  });
});

// ===========================================================================
// REF-2 — THE DIRECT-TO-STORAGE UPLOAD, END TO END.
// ===========================================================================
// WHY THESE TESTS EXIST. REF-2 added a SECOND way for a reference document to
// come into existence. Every test above posts a file to the REF-1 route, which
// carries the bytes itself and is therefore bounded by the platform's request
// limit. The Tarif Extérieur Commun does not fit through it. So REF-2 mints a
// signed, single-path ticket, the browser puts the bytes straight into the
// private bucket, and the application decides AFTERWARDS whether a document
// exists. That means there is a moment when the bucket holds a file nothing
// has validated — and until this block, nothing had ever run that moment.
//
// CUSTOMS-REF-UAT-02-CI-01. This is the transactional half of UAT-02, and it
// lives here rather than in a browser because this project has no isolated
// Supabase environment to point a browser at: Vercel Previews are bound to the
// PRODUCTION project (docs/customs-ref-uat/uat-02-environment.md), and the
// owner has set a $0 ceiling on new infrastructure. CI's disposable
// `supabase start` database is the only real, isolated, free environment that
// exists, so the matrix is proven against that.
//
// THE TICKET IS USED THE WAY A BROWSER USES IT — WITH AN ANON CLIENT. A
// service-role client can write into the bucket whether a ticket authorised it
// or not, so staging the bytes with one would have made every test below pass
// while proving nothing about the ticket. Every byte placed in these tests is
// placed by a client holding no privilege at all.

const BUCKET = "customs-reference";

/**
 * The bucket's own ceiling, declared by migration 152. The ticket advertises a
 * limit to the browser, and a ticket that advertised more than storage accepts
 * would invite a 50 MB transfer that storage then refuses.
 */
const BUCKET_CEILING = 50 * 1024 * 1024;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A client with NO privilege — the operator's browser credentials.
 *
 * Deliberately separate from `db()`: `db()` holds the service role, which
 * bypasses every storage policy. The direct upload must be performed without
 * privilege or it demonstrates nothing about what the ticket grants.
 */
function anonDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "the REF-2 block requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY: "
        + "the direct upload is only meaningful from an UNPRIVILEGED client.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function jsonPost(url: string, payload: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

type TicketBody = {
  ok?: boolean;
  uploadId?: string;
  path?: string;
  token?: string;
  signedUrl?: string;
  maxBytes?: number;
  error?: string;
};

type FinalizeBody = {
  ok?: boolean;
  id?: string;
  status?: string;
  sha256?: string;
  sizeBytes?: number;
  error?: string;
};

/** Step 1 of 2 — ask for an upload ticket through the real route. */
async function ticket(actor: CurrentUser, overrides: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    category: "LEGISLATION",
    title: "Tarif Extérieur Commun",
    sourceAuthority: "Direction Générale des Douanes",
    referenceCode: `DIRECT-${(seq += 1)}`,
    declaredSize: 4096,
    ...overrides,
  };
  const res = await as(actor, () =>
    ticketRoute(jsonPost("http://localhost/api/customs/reference/upload-url", payload)),
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as TicketBody };
}

/** Step 2 of 2 — ask the application to accept the staged bytes. */
async function finalize(actor: CurrentUser, overrides: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    category: "LEGISLATION",
    title: "Tarif Extérieur Commun",
    sourceAuthority: "Direction Générale des Douanes",
    ...overrides,
  };
  const res = await as(actor, () =>
    finalizeRoute(jsonPost("http://localhost/api/customs/reference/finalize", payload)),
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as FinalizeBody };
}

/**
 * The browser's whole first half: take a ticket, then PUT the bytes with it
 * from an unprivileged client. Returns what a caller needs to finalise — or to
 * assert that a refusal left the right things behind.
 */
async function stage(
  actor: CurrentUser,
  opts: { bytes?: Uint8Array; overrides?: Record<string, unknown> } = {},
) {
  const bytes = opts.bytes ?? pdf();
  const referenceCode = `DIRECT-${(seq += 1)}`;
  const t = await ticket(actor, {
    referenceCode,
    declaredSize: bytes.length,
    ...(opts.overrides ?? {}),
  });
  expect(t.status, `ticket refused: ${t.body.error}`).toBe(201);

  const put = await anonDb().storage
    .from(BUCKET)
    .uploadToSignedUrl(t.body.path!, t.body.token!, new File([bytes], "tec.pdf", {
      type: "application/pdf",
    }));
  expect(put.error, `signed upload failed: ${put.error?.message}`).toBeNull();

  return { ...t.body, bytes, referenceCode, sha256: sha256Of(bytes) };
}

/** Is there a staged object for this ticket, in this tenant's prefix? */
async function stagedObject(tenantId: string, uploadId: string) {
  const { data } = await db()
    .storage.from(BUCKET)
    .list(`${tenantId}/_staging`, { search: `${uploadId}.pdf`, limit: 1 });
  return (data ?? []).find((o) => o.name === `${uploadId}.pdf`) ?? null;
}

/** Is there a document object under tenant A's own prefix? */
async function storedObject(name: string) {
  const { data } = await db().storage.from(BUCKET).list(TENANT_A, { search: name, limit: 1 });
  return (data ?? []).find((o) => o.name === name) ?? null;
}

/**
 * How many reference documents exist. Every refusal below asserts against this
 * rather than against "my row is absent": a route that refused the request but
 * wrote SOME row would otherwise pass.
 */
async function documentCount(): Promise<number> {
  const { count } = await db()
    .from("customs_reference_document")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_A);
  return count ?? 0;
}

async function uploadAuditCount(): Promise<number> {
  const { count } = await db()
    .from("audit_log")
    .select("action", { count: "exact", head: true })
    .eq("action", "customs.reference.uploaded");
  return count ?? 0;
}

// ===========================================================================
describe("R20 — REF-2: the ticket authorises bytes, and nothing else", () => {
  it("an authorised publisher is issued a ticket, and the ticket alone creates nothing", async () => {
    const documentsBefore = await documentCount();
    const auditBefore = await uploadAuditCount();

    const { status, body } = await ticket(chief);
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.uploadId).toMatch(UUID_SHAPE);
    // The key is derived from the SESSION's tenant and a server-generated uuid:
    // the caller named no part of it.
    expect(body.path).toBe(`${TENANT_A}/_staging/${body.uploadId}.pdf`);
    expect(String(body.token ?? "").length).toBeGreaterThan(0);
    expect(body.signedUrl).toContain(`/${BUCKET}/${TENANT_A}/_staging/${body.uploadId}.pdf`);
    // What the route advertises is the bucket's own ceiling, not a larger number
    // the browser would discover to be a lie after a 50 MB transfer.
    expect(body.maxBytes).toBe(BUCKET_CEILING);

    // A ticket is not a document. Nothing exists yet — not a row, not an audit
    // event, and not even an object: a ticket nobody uses must leave no trace
    // of a document that never was.
    expect(await documentCount()).toBe(documentsBefore);
    expect(await uploadAuditCount()).toBe(auditBefore);
    expect(await stagedObject(TENANT_A, body.uploadId!)).toBeNull();
  });

  it("a reader is issued no ticket at all", async () => {
    const reader = await ticket(declarant);
    expect([reader.status, reader.body.error]).toEqual([403, "forbidden"]);
    // And nothing usable leaked with the refusal.
    expect(reader.body.token).toBeUndefined();
    expect(reader.body.path).toBeUndefined();
    expect(reader.body.signedUrl).toBeUndefined();

    const outsider = await ticket(driver);
    expect([outsider.status, outsider.body.error]).toEqual([403, "forbidden"]);
  });

  it("the ticket refuses what it should before a single byte moves", async () => {
    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ category: "NOT_A_CATEGORY" }, "category_invalid"],
      [{ title: "   " }, "title_required"],
      [{ sourceAuthority: "" }, "authority_required"],
      [{ referenceCode: "" }, "reference_code_required"],
      [{ publishedOn: "17/10/2026" }, "published_on_invalid"],
      [{ customsRegimes: "X".repeat(MAX_REGIME_LENGTH + 1) }, "regime_too_long"],
      [
        {
          customsRegimes: Array.from({ length: MAX_REGIMES + 1 }, (_, i) => `REGIME ${i}`).join(","),
        },
        "too_many_regimes",
      ],
      [{ declaredSize: 0 }, "missing_file"],
      [{ declaredSize: null }, "missing_file"],
      [{ declaredSize: -1 }, "missing_file"],
      [{ declaredSize: 4096.5 }, "missing_file"],
      [{ declaredSize: 512 }, "too_small"],
      [{ declaredSize: BUCKET_CEILING + 1 }, "too_large"],
    ];
    for (const [overrides, error] of refusals) {
      const r = await ticket(chief, overrides);
      expect([JSON.stringify(overrides), r.status, r.body.error]).toEqual([
        JSON.stringify(overrides),
        400,
        error,
      ]);
      // A refused ticket is not a half-issued one.
      expect(r.body.token).toBeUndefined();
    }
  });

  it("a body that is not JSON is bad input, not a server error", async () => {
    const res = await as(chief, () =>
      ticketRoute(new Request("http://localhost/api/customs/reference/upload-url", {
        method: "POST",
        body: "{ not json",
      })),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });
});

// ===========================================================================
describe("R21 — REF-2: the bytes travel on their own, and become one document", () => {
  it("the ticket places the bytes in the private staging prefix, and authorises nothing else", async () => {
    const bytes = pdf(9000);
    const t = await ticket(chief, { declaredSize: bytes.length });
    expect(t.status).toBe(201);
    const anon = anonDb();

    // (a) the ticket works for its own path, from a client with no privilege.
    const ok = await anon.storage
      .from(BUCKET)
      .uploadToSignedUrl(t.body.path!, t.body.token!, new File([bytes], "tec.pdf", {
        type: "application/pdf",
      }));
    expect(ok.error).toBeNull();

    const staged = await stagedObject(TENANT_A, t.body.uploadId!);
    expect(staged).toBeTruthy();
    expect(Number((staged!.metadata as { size?: number } | null)?.size)).toBe(bytes.length);

    // (b) a ticket does not authorise a second path. "Single-path" is the
    // whole security claim of a signed upload URL, so it is asserted rather
    // than assumed — with a FRESH ticket rather than the one just spent, so
    // that a refusal can only be explained by the path.
    const other = await ticket(chief, { declaredSize: bytes.length });
    expect(other.status).toBe(201);
    const elsewhere = await anon.storage
      .from(BUCKET)
      .uploadToSignedUrl(
        `${TENANT_A}/_staging/${randomUUID()}.pdf`,
        other.body.token!,
        new File([bytes], "x.pdf", { type: "application/pdf" }),
      );
    expect(elsewhere.error).toBeTruthy();
    // …and the path it WAS minted for stayed empty: the refusal did not quietly
    // write the bytes to the key the token names.
    expect(await stagedObject(TENANT_A, other.body.uploadId!)).toBeNull();

    // (c) and with no ticket, that client has nothing: the bucket is private
    // and `storage.objects` carries no policy granting it a write.
    const unticketed = await anon.storage
      .from(BUCKET)
      .upload(`${TENANT_A}/_staging/${randomUUID()}.pdf`, new File([bytes], "x.pdf", {
        type: "application/pdf",
      }));
    expect(unticketed.error).toBeTruthy();

    // (d) it cannot even read back what it just wrote.
    const readback = await anon.storage.from(BUCKET).download(t.body.path!);
    expect(readback.error).toBeTruthy();
    expect(readback.data).toBeNull();
  });

  it("finalisation creates exactly one quarantined document whose checksum describes the bytes that arrived", async () => {
    const bytes = pdf(12_288);
    const s = await stage(chief, { bytes });
    const before = await documentCount();

    const { status, body } = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      title: "Tarif Extérieur Commun — R21",
      declaredSize: bytes.length,
      sha256: s.sha256,
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("QUARANTINE");
    expect(body.sha256).toBe(s.sha256);
    expect(body.sizeBytes).toBe(bytes.length);
    // Exactly one, not two: the move writes a document, not a document per
    // attempt at one.
    expect(await documentCount()).toBe(before + 1);

    const r = await row(body.id!);
    expect(r).toBeTruthy();
    // The same safety defaults R1 pins for the office route. A second way in
    // must not be a second set of defaults.
    expect(r!.status).toBe("QUARANTINE");
    expect(r!.scan_status).toBe("UNSCANNED");
    expect(r!.licence_status).toBe("RESTRICTED");
    expect(r!.redistribution_allowed).toBe(false);
    expect(r!.provenance_verified).toBe(false);
    expect(r!.legal_version_verified).toBe(false);
    expect(r!.published_by).toBeNull();
    expect(r!.published_at).toBeNull();
    expect(r!.version).toBe(1);
    expect(r!.tenant_id).toBe(TENANT_A);
    expect(r!.uploaded_by).toBe(chief.id);
    expect(r!.mime_type).toBe("application/pdf");
    expect(r!.size_bytes).toBe(bytes.length);
    expect(r!.content_sha256).toBe(s.sha256);
    // The document's home is derived from its id, and carries no filename.
    expect(r!.storage_path).toBe(`${TENANT_A}/${body.id}.pdf`);

    // THE MOVE PRESERVED THE BYTES. The checksum in the row is computed by the
    // route; this reads the object back out of the bucket and hashes it again,
    // so a route that recorded a hash of something else would fail here.
    const { data: blob } = await db().storage.from(BUCKET).download(String(r!.storage_path));
    expect(blob).toBeTruthy();
    const stored = new Uint8Array(await blob!.arrayBuffer());
    expect(stored.length).toBe(bytes.length);
    expect(sha256Of(stored)).toBe(s.sha256);

    const audit = await auditFor("customs.reference.uploaded", body.id!);
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(chief.id);
    // Which door it came through is part of the record.
    expect((audit[0].after as { via?: string } | null)?.via).toBe("direct_upload");
    expect((audit[0].after as { sha256?: string } | null)?.sha256).toBe(s.sha256);
    expect((audit[0].after as { size_bytes?: number } | null)?.size_bytes).toBe(bytes.length);
  });

  it("the staging copy does not outlive a successful finalisation", async () => {
    const s = await stage(chief);
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeTruthy();

    const { status, body } = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: s.bytes.length,
      sha256: s.sha256,
    });
    expect(status).toBe(201);

    // Swept. An unvalidated copy of a document's bytes is exactly what should
    // not be left lying in the bucket.
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeNull();
    // …and the document's own object is there, under its own key.
    expect(await storedObject(`${body.id}.pdf`)).toBeTruthy();
  });

  it("a ticket cannot be finalised twice", async () => {
    const s = await stage(chief);
    const fields = {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: s.bytes.length,
      sha256: s.sha256,
    };
    expect((await finalize(chief, fields)).status).toBe(201);

    const before = await documentCount();
    const replay = await finalize(chief, fields);
    // The bytes are gone, so the replay has nothing to accept. The important
    // part is the count: a replayed request must not mint a second document
    // from the same upload.
    expect([replay.status, replay.body.error]).toEqual([404, "upload_not_found"]);
    expect(await documentCount()).toBe(before);
  });

  it("a document created by the direct path is quarantined exactly like an office one", async () => {
    const s = await stage(chief);
    const { body } = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      title: "Quarantaine directe — R21e",
      declaredSize: s.bytes.length,
      sha256: s.sha256,
    });
    const id = body.id!;

    const reader = await as(declarant, () => getLibrary());
    expect(reader.documents.map((d) => d.id)).not.toContain(id);
    expect(await as(declarant, () => getReferenceDocument(id))).toBeNull();
    const res = await as(declarant, () =>
      viewRoute(new Request("http://localhost/x"), { params: { id } }),
    );
    expect(res.status).toBe(404);

    // The publisher sees their own quarantined upload, as before.
    const publisher = await as(chief, () => getLibrary());
    expect(publisher.documents.map((d) => d.id)).toContain(id);
  });
});

// ===========================================================================
describe("R22 — REF-2: a refusal leaves no document and no stray bytes", () => {
  it("a declared checksum that does not describe the bytes is refused, and the bytes are dropped", async () => {
    const s = await stage(chief);
    const before = await documentCount();

    const r = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: s.bytes.length,
      sha256: "b".repeat(64),
    });
    expect([r.status, r.body.error]).toEqual([400, "sha256_mismatch"]);
    expect(r.body.id).toBeUndefined();
    expect(await documentCount()).toBe(before);
    // Bytes whose integrity could not be established never outlive the refusal.
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeNull();
  });

  it("a declared size that does not describe the bytes is refused the same way", async () => {
    const s = await stage(chief);
    const before = await documentCount();

    const r = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: s.bytes.length + 1,
      sha256: s.sha256,
    });
    expect([r.status, r.body.error]).toEqual([400, "size_mismatch"]);
    expect(await documentCount()).toBe(before);
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeNull();
  });

  it("bytes that are not a PDF are refused, whatever the ticket said they would be", async () => {
    // A ZIP's signature. The ticket is metadata-only, so this is the first
    // moment anything looks at the bytes — and the moment that must refuse.
    const notPdf = new Uint8Array(2048);
    notPdf.set([0x50, 0x4b, 0x03, 0x04], 0);
    const s = await stage(chief, { bytes: notPdf });
    const before = await documentCount();

    const r = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: notPdf.length,
      sha256: s.sha256,
    });
    expect([r.status, r.body.error]).toEqual([400, "not_a_pdf"]);
    expect(await documentCount()).toBe(before);
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeNull();
  });

  it("a malformed upload identifier is refused before any path is built", async () => {
    const before = await documentCount();
    const malformed = [
      "",
      "   ",
      "not-a-uuid",
      "../../secret",
      `${TENANT_A}/_staging/x`,
      "00000000-0000-0000-0000-00000000000",
      `${randomUUID()}/`,
      `${randomUUID()}.pdf`,
      `${randomUUID()}%2F..%2F`,
    ];
    for (const bad of malformed) {
      const r = await finalize(chief, {
        uploadId: bad,
        referenceCode: `BAD-${(seq += 1)}`,
        declaredSize: 4096,
      });
      expect([bad, r.status, r.body.error]).toEqual([bad, 400, "invalid_upload_id"]);
    }
    expect(await documentCount()).toBe(before);
  });

  it("a well-formed identifier for bytes nobody staged is simply not found", async () => {
    const before = await documentCount();
    const r = await finalize(chief, {
      uploadId: randomUUID(),
      referenceCode: `GHOST-${(seq += 1)}`,
      declaredSize: 4096,
      sha256: sha256Of(pdf()),
    });
    // 404, not 500: the identifier is well-formed, there are simply no bytes.
    expect([r.status, r.body.error]).toEqual([404, "upload_not_found"]);
    expect(await documentCount()).toBe(before);
  });

  it("a reader cannot finalise a publisher's upload, and the refusal does not touch their bytes", async () => {
    const s = await stage(chief);
    const fields = {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      declaredSize: s.bytes.length,
      sha256: s.sha256,
    };
    const before = await documentCount();

    const reader = await finalize(declarant, fields);
    expect([reader.status, reader.body.error]).toEqual([403, "forbidden"]);
    const outsider = await finalize(driver, fields);
    expect([outsider.status, outsider.body.error]).toEqual([403, "forbidden"]);
    expect(await documentCount()).toBe(before);

    // A refusal is a refusal, not a deletion: the publisher's staged bytes are
    // still there, and still finalise. Someone else's failed attempt must not
    // destroy work in progress.
    expect(await stagedObject(TENANT_A, s.uploadId!)).toBeTruthy();
    const mine = await finalize(chief, fields);
    expect(mine.status).toBe(201);
    expect(mine.body.sha256).toBe(s.sha256);
  });
});

// ===========================================================================
describe("R23 — REF-2: the regime axis, and whose staging prefix it is", () => {
  const MESSY = " transit ,MISE EN CONSOMMATION;transit\nexportation,";
  const TIDY = ["EXPORTATION", "MISE EN CONSOMMATION", "TRANSIT"];

  it("regimes are normalised, de-duplicated, sorted and persisted", async () => {
    const s = await stage(chief, { overrides: { customsRegimes: MESSY } });
    const { status, body } = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      title: "Régimes — R23",
      declaredSize: s.bytes.length,
      sha256: s.sha256,
      customsRegimes: MESSY,
    });
    expect(status).toBe(201);

    const r = await row(body.id!);
    expect(r!.customs_regimes).toEqual(TIDY);
    // The service hands the same axis back to a reader of its own output…
    const doc = await as(chief, () => getReferenceDocument(body.id!));
    expect(doc!.customsRegimes).toEqual(TIDY);
    // …and the audit records what was STORED, not what was typed.
    const audit = await auditFor("customs.reference.uploaded", body.id!);
    expect((audit[0].after as { customs_regimes?: string[] } | null)?.customs_regimes)
      .toEqual(TIDY);
  });

  it("a published document is findable by a regime it carries, and not by one it does not", async () => {
    const s = await stage(chief, { overrides: { customsRegimes: "ADMISSION TEMPORAIRE" } });
    const { body } = await finalize(chief, {
      uploadId: s.uploadId,
      referenceCode: s.referenceCode,
      title: "Admission temporaire — R23b",
      declaredSize: s.bytes.length,
      sha256: s.sha256,
      // Typed in lower case by the operator: the normaliser is what makes the
      // search work, not the operator's shift key.
      customsRegimes: "admission temporaire",
    });
    const id = body.id!;
    expect(await publishFully(id)).toEqual({ ok: true, id });

    // UAT-01B recorded search accuracy as NOT TESTABLE because the library was
    // empty. This is that test: a real document, matched by a real filter.
    const hit = await as(declarant, () => getLibrary({ regime: "admission temporaire" }));
    expect(hit.documents.map((d) => d.id)).toContain(id);

    const miss = await as(declarant, () => getLibrary({ regime: "RÉEXPORTATION" }));
    expect(miss.documents.map((d) => d.id)).not.toContain(id);
  });

  it("another tenant's staged bytes are unreachable, and untouched by the attempt", async () => {
    // Staged under a FOREIGN tenant's prefix with privilege, because no ticket
    // this application mints could ever name that path.
    const foreignId = randomUUID();
    const foreignPath = `${FOREIGN_TENANT}/_staging/${foreignId}.pdf`;
    const bytes = pdf();
    const put = await db()
      .storage.from(BUCKET)
      .upload(foreignPath, bytes, { contentType: "application/pdf" });
    expect(put.error).toBeNull();

    try {
      const before = await documentCount();
      // `/finalize` builds the path from the SESSION's tenant, so this uuid
      // resolves to a path in tenant A that holds nothing.
      const r = await finalize(chief, {
        uploadId: foreignId,
        referenceCode: `FOREIGN-${(seq += 1)}`,
        declaredSize: bytes.length,
        sha256: sha256Of(bytes),
      });
      expect([r.status, r.body.error]).toEqual([404, "upload_not_found"]);
      expect(await documentCount()).toBe(before);
      // And it did not delete what it was not allowed to read.
      expect(await stagedObject(FOREIGN_TENANT, foreignId)).toBeTruthy();
    } finally {
      await db().storage.from(BUCKET).remove([foreignPath]);
    }
  });
});
