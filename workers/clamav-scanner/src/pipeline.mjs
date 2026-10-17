/**
 * The scan pipeline: validate → download → verify bytes → scan → report.
 *
 * EVERY FAILURE PATH ENDS IN A VERDICT, AND NEVER IN CLEAN. A dead URL, a
 * truncated download, a checksum that does not match, a clamd timeout and an
 * unrecognised reply all produce ERROR. Effitrans refuses to publish on
 * anything but CLEAN, so an honest ERROR costs one re-scan while a wrong CLEAN
 * publishes malware. The asymmetry is the whole design.
 *
 * THE CHECKSUM IS VERIFIED BEFORE THE SCAN, not after. A verdict is evidence
 * about specific bytes; if the bytes that arrived are not the bytes Effitrans
 * asked about, there is nothing to say about them and scanning them would
 * produce a verdict that looks authoritative and is not. Effitrans re-checks
 * the same binding server-side, so this is defence in depth rather than the
 * only guard.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { scanBuffer } from "./clamd.mjs";

export const hmacHex = (secret, body) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

/** Constant-time hex compare. False on any length or format mismatch. */
export function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifySignature(secret, rawBody, signature) {
  return safeEqualHex(hmacHex(secret, rawBody), String(signature ?? ""));
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Validate an inbound scan request.
 *
 * Returns `{ ok: true, job }` or `{ ok: false, status, error }`. The status
 * codes matter to Effitrans' retry behaviour: 401 for a forged signature, 400
 * for a malformed body, 409 for a replayed or stale request.
 */
export function parseRequest({ rawBody, signature, secret, now, maxSkewMs, seenNonces }) {
  if (!verifySignature(secret, rawBody, signature)) {
    return { ok: false, status: 401, error: "bad_signature" };
  }

  let b;
  try {
    b = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "invalid_payload" };
  }

  const str = (k) => (typeof b[k] === "string" ? b[k].trim() : "");
  const documentId = str("document_id");
  const tenantId = str("tenant_id");
  const storagePath = str("storage_path");
  const sha256 = str("sha256").toLowerCase();
  const downloadUrl = str("download_url");
  const nonce = str("nonce");
  const issuedAtRaw = str("issued_at");

  if (!documentId || !tenantId || !storagePath || !downloadUrl) {
    return { ok: false, status: 400, error: "invalid_payload" };
  }
  if (!HEX64.test(sha256)) return { ok: false, status: 400, error: "invalid_payload" };
  if (nonce.length < 8) return { ok: false, status: 400, error: "invalid_payload" };

  const issuedAt = Date.parse(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, status: 400, error: "invalid_payload" };
  if (Math.abs(now - issuedAt) > maxSkewMs) {
    // A captured request replayed later is refused before anything is fetched.
    return { ok: false, status: 409, error: "stale_request" };
  }

  // REQUEST-LEVEL REPLAY. Effitrans also refuses a replayed VERDICT via a
  // unique nonce in the database; this stops the duplicate work earlier, and
  // stops a captured request being used to make the worker fetch an object
  // repeatedly.
  if (seenNonces?.has(nonce)) {
    return { ok: false, status: 409, error: "duplicate_request" };
  }

  return {
    ok: true,
    job: { documentId, tenantId, storagePath, sha256, downloadUrl, nonce },
  };
}

/**
 * Download the object, capped and timed.
 *
 * The URL is a CREDENTIAL: it is never logged, never echoed in an error, and
 * never persisted. Only its host is ever mentioned, and only on failure.
 */
export async function download(url, { maxBytes, timeoutMs, fetchImpl = fetch }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, error: `download_http_${res.status}` };

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared && declared > maxBytes) return { ok: false, error: "too_large" };

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return { ok: false, error: "empty_download" };
    if (buf.length > maxBytes) return { ok: false, error: "too_large" };
    return { ok: true, buf };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "download_timeout" : "download_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Run one job to a verdict. Never throws; every path yields a verdict object.
 */
export async function runJob(job, cfg, deps = {}) {
  const { fetchImpl = fetch, scan = scanBuffer } = deps;

  const got = await download(job.downloadUrl, {
    maxBytes: cfg.maxBytes,
    timeoutMs: cfg.downloadTimeoutMs,
    fetchImpl,
  });
  if (!got.ok) {
    return { verdict: "ERROR", detail: got.error, engineRef: null };
  }

  const actual = sha256Hex(got.buf);
  if (actual !== job.sha256) {
    // The bytes are not the bytes we were asked about. Say so precisely — and
    // do NOT scan them, because a verdict about the wrong object is worse than
    // no verdict.
    return {
      verdict: "ERROR",
      detail: `sha256_mismatch expected=${job.sha256.slice(0, 12)}… actual=${actual.slice(0, 12)}…`,
      engineRef: null,
    };
  }

  const result = await scan(got.buf, {
    host: cfg.clamdHost,
    port: cfg.clamdPort,
    timeoutMs: cfg.scanTimeoutMs,
  });

  return {
    verdict: result.verdict,
    detail:
      result.verdict === "INFECTED"
        ? `signature=${result.signature ?? "unknown"}`
        : result.verdict === "ERROR"
          ? String(result.raw ?? "scan_error").slice(0, 300)
          : null,
    engineRef: result.signature ?? null,
    bytes: got.buf.length,
  };
}

/**
 * Deliver the verdict to Effitrans, signed and fresh.
 *
 * `issued_at` is stamped at SEND time, not at scan time: Effitrans refuses a
 * callback outside a 5-minute window, and a long scan would otherwise produce
 * a verdict that is correct and arrives stale. Retries re-stamp and re-sign
 * for the same reason.
 */
export async function deliver(job, outcome, cfg, deps = {}) {
  const { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = deps;
  let lastError = null;

  for (let attempt = 0; attempt <= cfg.callbackRetries; attempt += 1) {
    const body = JSON.stringify({
      document_id: job.documentId,
      tenant_id: job.tenantId,
      storage_path: job.storagePath,
      sha256: job.sha256,
      verdict: outcome.verdict,
      nonce: job.nonce,
      issued_at: new Date().toISOString(),
      scanner_version: cfg.scannerVersion ?? null,
      engine_ref: outcome.engineRef ?? null,
      detail: outcome.detail ?? null,
    });

    try {
      const res = await fetchImpl(cfg.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-effitrans-signature": hmacHex(cfg.secret, body),
        },
        body,
        // CALLBACK-MIDDLEWARE-F1 — DO NOT FOLLOW REDIRECTS.
        //
        // The default is `follow`, and that turned a routing defect into a
        // silent success: edge middleware answered 307 to /login, a 307
        // preserves method and body, so this POST was replayed at /login, which
        // returned 200 with an HTML page — and `res.ok` was true. The verdict
        // was discarded and this function reported it delivered.
        //
        // With `manual` the 3xx arrives here as a 3xx and is named below.
        redirect: "manual",
      });

      // A REDIRECT IS A MISCONFIGURATION, NOT A TRANSIENT FAULT. Something is
      // intercepting the callback — wrong URL, or an auth layer that does not
      // know this endpoint is machine-facing. Retrying cannot fix routing, and
      // failing loudly once is what gets it noticed.
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          attempts: attempt + 1,
          status: res.status,
          permanent: true,
          error: `callback_redirected_to_${res.headers.get("location") ?? "unknown"}`,
        };
      }

      // A 2xx IS NOT ENOUGH; IT MUST ALSO BE THE API ANSWERING. The endpoint
      // replies with JSON. Anything else — an HTML page, an empty body from a
      // proxy, a captive portal — means this reached something that is not the
      // callback handler, and treating it as an acknowledgement is exactly the
      // mistake that hid this defect.
      if (res.ok) {
        const kind = (res.headers.get("content-type") ?? "").toLowerCase();
        if (!kind.includes("application/json")) {
          return {
            ok: false,
            attempts: attempt + 1,
            status: res.status,
            permanent: true,
            error: `callback_not_json_${kind.split(";")[0] || "unknown"}`,
          };
        }
        return { ok: true, attempts: attempt + 1 };
      }

      // 409 means Effitrans has already recorded this verdict (replayed) or
      // refuses the binding. Retrying cannot change either, so stop.
      if (res.status === 409 || res.status === 401 || res.status === 400) {
        return { ok: false, attempts: attempt + 1, status: res.status, permanent: true };
      }
      lastError = `http_${res.status}`;
    } catch (e) {
      lastError = e?.message ?? "callback_failed";
    }

    if (attempt < cfg.callbackRetries) await sleep(cfg.callbackBackoffMs * (attempt + 1));
  }

  // Effitrans leaves the document SCANNING; its own 30-minute lost-scan window
  // lets a publisher ask again. Nothing is published in the meantime.
  return { ok: false, attempts: cfg.callbackRetries + 1, error: lastError };
}
