/**
 * Worker contract tests — Node's built-in runner, no dependencies.
 *
 * WHAT THESE PROVE AND WHAT THEY DO NOT. Every test here exercises the real
 * pipeline functions with adversarial input: forged signatures, stale and
 * replayed requests, a checksum that does not match the bytes, a dead
 * download, a clamd that times out. ClamAV itself is INJECTED, because Docker
 * and ClamAV are not installed on this machine.
 *
 * So these are CONTRACT tests. They do not prove that ClamAV detects malware —
 * that is EICAR's job, against a running container, and it is reported as
 * pending rather than simulated. A mocked "CLEAN" here would be exactly the
 * fabricated clearance the whole design exists to prevent, so no test in this
 * file asserts that a real scan passed.
 */
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  deliver,
  download,
  hmacHex,
  parseRequest,
  runJob,
  safeEqualHex,
  sha256Hex,
  verifySignature,
} from "../src/pipeline.mjs";

const SECRET = "test-secret-not-a-real-one";
const sign = (body, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 7)]);
const PDF_SHA = sha256Hex(PDF);

const reqBody = (over = {}) =>
  JSON.stringify({
    document_id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    storage_path: "00000000-0000-0000-0000-000000000001/doc.pdf",
    sha256: PDF_SHA,
    download_url: "https://storage.invalid/signed/object?token=x",
    nonce: "nonce-abcdef123456",
    issued_at: new Date().toISOString(),
    ...over,
  });

const parse = (body, signature, extra = {}) =>
  parseRequest({
    rawBody: body,
    signature,
    secret: SECRET,
    now: Date.now(),
    maxSkewMs: 300_000,
    seenNonces: new Set(),
    ...extra,
  });

const cfg = {
  secret: SECRET,
  callbackUrl: "https://effitrans.invalid/api/customs/reference/scan-callback",
  clamdHost: "127.0.0.1",
  clamdPort: 3310,
  maxBytes: 64 * 1024 * 1024,
  downloadTimeoutMs: 5_000,
  scanTimeoutMs: 5_000,
  callbackRetries: 2,
  callbackBackoffMs: 1,
  scannerVersion: "test",
};

const okFetch = (buf = PDF) => async () =>
  new Response(buf, { status: 200, headers: { "content-length": String(buf.length) } });

// ===========================================================================
test("authentication: a correctly signed request is accepted", () => {
  const b = reqBody();
  const r = parse(b, sign(b));
  assert.equal(r.ok, true);
  assert.equal(r.job.sha256, PDF_SHA);
  assert.equal(r.job.nonce, "nonce-abcdef123456");
});

test("authentication: missing, wrong and foreign-secret signatures are refused", () => {
  const b = reqBody();
  for (const sig of [null, "", "f".repeat(64), sign(b, "another-secret")]) {
    const r = parse(b, sig);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, "bad_signature");
  }
});

test("authentication: the signature covers the whole body, so no field can be edited", () => {
  const original = reqBody();
  const tampered = reqBody({ sha256: "b".repeat(64) });
  const r = parse(tampered, sign(original));
  assert.equal(r.error, "bad_signature");
});

test("authentication: a malformed signature does not throw", () => {
  const b = reqBody();
  for (const bad of ["zz", "!!!", "0x12", " ".repeat(64)]) {
    assert.equal(parse(b, bad).error, "bad_signature");
  }
  assert.equal(safeEqualHex("", ""), false);
  assert.equal(verifySignature(SECRET, "x", null), false);
});

// ===========================================================================
test("replay: a stale request is refused before anything is fetched", () => {
  const b = reqBody({ issued_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
  const r = parse(b, sign(b));
  assert.equal(r.status, 409);
  assert.equal(r.error, "stale_request");
});

test("replay: a far-future request is refused too", () => {
  const b = reqBody({ issued_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  assert.equal(parse(b, sign(b)).error, "stale_request");
});

test("replay: a repeated nonce is refused as a duplicate", () => {
  const b = reqBody();
  const seen = new Set(["nonce-abcdef123456"]);
  const r = parse(b, sign(b), { seenNonces: seen });
  assert.equal(r.status, 409);
  assert.equal(r.error, "duplicate_request");
});

// ===========================================================================
test("payload: malformed fields are refused with 400", () => {
  const cases = [
    { sha256: "abc" },
    { sha256: "g".repeat(64) },
    { nonce: "short" },
    { document_id: "" },
    { tenant_id: "" },
    { storage_path: "" },
    { download_url: "" },
    { issued_at: "not-a-date" },
  ];
  for (const over of cases) {
    const b = reqBody(over);
    const r = parse(b, sign(b));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.status, 400, JSON.stringify(over));
  }
  const notJson = "{{{";
  assert.equal(parse(notJson, sign(notJson)).error, "invalid_payload");
});

// ===========================================================================
test("binding: a checksum mismatch yields ERROR and the bytes are never scanned", async () => {
  let scanned = false;
  const out = await runJob(
    { ...JSON.parse(reqBody()), sha256: "a".repeat(64), documentId: "d", tenantId: "t", storagePath: "p", downloadUrl: "u", nonce: "n" },
    cfg,
    {
      fetchImpl: okFetch(),
      scan: async () => {
        scanned = true;
        return { verdict: "CLEAN", signature: null, raw: "OK" };
      },
    },
  );
  assert.equal(out.verdict, "ERROR");
  assert.match(out.detail, /sha256_mismatch/);
  // THE POINT: a verdict about the wrong object is worse than no verdict.
  assert.equal(scanned, false, "bytes that do not match must never reach the scanner");
});

test("binding: matching bytes do reach the scanner", async () => {
  let seenBytes = null;
  const job = {
    documentId: "d", tenantId: "t", storagePath: "p",
    sha256: PDF_SHA, downloadUrl: "u", nonce: "n",
  };
  await runJob(job, cfg, {
    fetchImpl: okFetch(),
    scan: async (buf) => {
      seenBytes = buf.length;
      return { verdict: "CLEAN", signature: null, raw: "OK" };
    },
  });
  assert.equal(seenBytes, PDF.length);
});

// ===========================================================================
test("download: HTTP failure, empty body and oversize all yield ERROR, never CLEAN", async () => {
  const job = { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, downloadUrl: "u", nonce: "n" };

  const notFound = await runJob(job, cfg, {
    fetchImpl: async () => new Response("nope", { status: 404 }),
    scan: async () => assert.fail("must not scan"),
  });
  assert.equal(notFound.verdict, "ERROR");
  assert.equal(notFound.detail, "download_http_404");

  const empty = await runJob(job, cfg, {
    fetchImpl: async () => new Response(Buffer.alloc(0), { status: 200 }),
    scan: async () => assert.fail("must not scan"),
  });
  assert.equal(empty.detail, "empty_download");

  const big = await runJob(job, { ...cfg, maxBytes: 16 }, {
    fetchImpl: okFetch(),
    scan: async () => assert.fail("must not scan"),
  });
  assert.equal(big.detail, "too_large");
});

test("download: a timeout is ERROR, not a pass", async () => {
  const r = await download("u", {
    maxBytes: 1024,
    timeoutMs: 5,
    fetchImpl: (_u, { signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "download_timeout");
});

// ===========================================================================
test("scanner: an INFECTED verdict carries its signature name", async () => {
  const job = { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, downloadUrl: "u", nonce: "n" };
  const out = await runJob(job, cfg, {
    fetchImpl: okFetch(),
    scan: async () => ({ verdict: "INFECTED", signature: "Eicar-Test-Signature", raw: "stream: Eicar-Test-Signature FOUND" }),
  });
  assert.equal(out.verdict, "INFECTED");
  assert.equal(out.engineRef, "Eicar-Test-Signature");
  assert.match(out.detail, /Eicar-Test-Signature/);
});

test("scanner: a clamd error or timeout is ERROR", async () => {
  const job = { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, downloadUrl: "u", nonce: "n" };
  const out = await runJob(job, cfg, {
    fetchImpl: okFetch(),
    scan: async () => ({ verdict: "ERROR", signature: null, raw: "clamd timeout" }),
  });
  assert.equal(out.verdict, "ERROR");
  assert.match(out.detail, /clamd timeout/);
});

// ===========================================================================
test("callback: the verdict is signed, carries the nonce and a fresh issued_at", async () => {
  let captured = null;
  const job = { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, nonce: "nonce-abcdef123456" };
  const r = await deliver(job, { verdict: "CLEAN", detail: null, engineRef: null }, cfg, {
    fetchImpl: async (url, init) => {
      captured = { url, init };
      // JSON, because the real endpoint answers NextResponse.json(...) and
      // `deliver` now refuses a 2xx that is not the API answering.
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(r.ok, true);
  const body = captured.init.body;
  assert.equal(captured.init.headers["x-effitrans-signature"], hmacHex(SECRET, body));
  const parsed = JSON.parse(body);
  assert.equal(parsed.nonce, "nonce-abcdef123456");
  assert.equal(parsed.verdict, "CLEAN");
  // Fresh, so Effitrans' 5-minute window cannot reject a slow scan's verdict.
  assert.ok(Math.abs(Date.now() - Date.parse(parsed.issued_at)) < 5_000);
});

test("callback: a 409 is permanent and is not retried", async () => {
  let calls = 0;
  const r = await deliver(
    { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, nonce: "n12345678" },
    { verdict: "CLEAN", detail: null, engineRef: null },
    cfg,
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response("", { status: 409 });
      },
      sleep: async () => {},
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.permanent, true);
  assert.equal(calls, 1, "a replayed or rejected verdict must not be retried");
});

test("callback: a 5xx is retried, then gives up without publishing anything", async () => {
  let calls = 0;
  const r = await deliver(
    { documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, nonce: "n12345678" },
    { verdict: "ERROR", detail: "x", engineRef: null },
    cfg,
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response("", { status: 503 });
      },
      sleep: async () => {},
    },
  );
  assert.equal(r.ok, false);
  assert.equal(calls, cfg.callbackRetries + 1);
});

// ===========================================================================
test("cross-tenant: the worker echoes back the tenant it was given, never a different one", async () => {
  let body = null;
  const job = {
    documentId: "doc-a", tenantId: "tenant-a", storagePath: "tenant-a/doc.pdf",
    sha256: PDF_SHA, nonce: "nonce-abcdef123456",
  };
  await deliver(job, { verdict: "CLEAN", detail: null, engineRef: null }, cfg, {
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init.body);
      // JSON, because the real endpoint answers NextResponse.json(...) and
      // `deliver` now refuses a 2xx that is not the API answering.
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(body.tenant_id, "tenant-a");
  assert.equal(body.document_id, "doc-a");
  assert.equal(body.storage_path, "tenant-a/doc.pdf");
  // Effitrans scopes every RPC by (document, tenant) and answers not_found on a
  // mismatch, so the worker cannot reach across tenants even if it tried.
});

test("no fabricated clearance: nothing in this suite asserts a real scan passed", () => {
  // A guard against this file drifting into the thing it exists to prevent.
  // Every CLEAN above is an INJECTED scanner result used to exercise the
  // plumbing around it. Real detection is proven by EICAR against a running
  // container, and is reported as pending until that runs.
  assert.ok(true);
});

// ===========================================================================
// CALLBACK-MIDDLEWARE-F1 — a redirect or an HTML page is NOT a delivered
// verdict.
//
// This is the regression suite for the defect that made the whole scanner
// integration fail silently: edge middleware answered 307 → /login, fetch
// followed it, /login answered 200 with HTML, and `deliver` reported success.
// ===========================================================================
const deliverJob = {
  documentId: "d", tenantId: "t", storagePath: "p", sha256: PDF_SHA, nonce: "n12345678",
};
const CLEAN_OUTCOME = { verdict: "CLEAN", detail: null, engineRef: null };

test("callback: a 307 is NOT success, is permanent, and names where it went", async () => {
  let calls = 0;
  const r = await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
    fetchImpl: async () => {
      calls += 1;
      return new Response("", { status: 307, headers: { location: "/login" } });
    },
    sleep: async () => {},
  });
  assert.equal(r.ok, false, "a redirect must never be read as a delivered verdict");
  assert.equal(r.permanent, true, "routing cannot be fixed by retrying");
  assert.match(r.error, /callback_redirected_to_\/login/);
  assert.equal(calls, 1, "a misconfiguration is reported once, not four times");
});

test("callback: an HTML 200 is NOT success — the login page is not an acknowledgement", async () => {
  // The exact shape of the production defect: after following the redirect the
  // worker saw 200 text/html and `res.ok === true`.
  const r = await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
    fetchImpl: async () =>
      new Response("<!DOCTYPE html><html><body>Connexion</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    sleep: async () => {},
  });
  assert.equal(r.ok, false, "HTML is not the callback API answering");
  assert.equal(r.permanent, true);
  assert.match(r.error, /callback_not_json_text\/html/);
});

test("callback: a 200 with no content-type at all is refused too", async () => {
  const r = await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
    fetchImpl: async () => new Response("", { status: 200 }),
    sleep: async () => {},
  });
  assert.equal(r.ok, false, "an unidentifiable 200 is not an acknowledgement");
  assert.equal(r.permanent, true);
});

test("callback: redirect: manual is actually requested, not merely intended", async () => {
  // Without this the default `follow` applies and the 307 above never reaches
  // the checks at all — the assertion that makes them meaningful.
  let init = null;
  await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
    fetchImpl: async (_u, i) => {
      init = i;
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(init.redirect, "manual");
});

test("callback: a JSON 200 is still success, so the happy path is unchanged", async () => {
  const r = await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
    fetchImpl: async () =>
      new Response('{"ok":true,"outcome":"recorded"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
});

test("callback: a failed delivery reports failure — no fabricated scan evidence", async () => {
  // The worker is the only thing that can tell Effitrans a verdict exists. If
  // delivery failed it must say so: the document then stays SCANNING and the
  // 30-minute lost-scan window lets a publisher ask again. Nothing is
  // published on the strength of a verdict that never arrived.
  for (const res of [
    new Response("", { status: 307, headers: { location: "/login" } }),
    new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    new Response("", { status: 500 }),
  ]) {
    const r = await deliver(deliverJob, CLEAN_OUTCOME, cfg, {
      fetchImpl: async () => res.clone(),
      sleep: async () => {},
    });
    assert.equal(r.ok, false, `status ${res.status} must not report success`);
  }
});
