/**
 * DEVELOPMENT SCAN STUB — NOT A MALWARE SCANNER.
 * ===========================================================================
 * This process speaks the same contract as `workers/clamav-scanner` so the
 * publication workflow can be exercised end to end on a developer's machine
 * without ClamAV or Docker. It detects NOTHING. It looks for one well-known
 * test string and otherwise reports CLEAN because it has no opinion.
 *
 * WHY THIS IS NOT A PRODUCTION BYPASS, and the argument is structural rather
 * than a promise:
 *
 *   1. IT IS NOT IN THE APPLICATION. Effitrans has no stub mode, no test flag
 *      and no code path that behaves differently. It dispatches to whatever
 *      `CUSTOMS_SCAN_ENDPOINT` names and believes a signed callback. There is
 *      therefore no Production environment variable that can "turn this on",
 *      because there is nothing in Production to turn on.
 *
 *   2. IT PHYSICALLY CANNOT REACH PRODUCTION. A verdict only matters if it is
 *      delivered, and this process REFUSES TO START unless its callback URL is
 *      loopback. So even if somebody pointed a Production
 *      `CUSTOMS_SCAN_ENDPOINT` at a stub, the stub would have no way to answer
 *      Production — it would be holding a callback URL for localhost.
 *
 *   3. EVERY VERDICT IT PRODUCES IS LABELLED, PERMANENTLY. `scanner_version` is
 *      persisted on the evidence row and on the document by
 *      `record_customs_reference_scan`, and this stub sets it to
 *      DEV-STUB-NOT-A-REAL-SCAN. Operators are also told to set
 *      `CUSTOMS_SCAN_PROVIDER=dev-scan-stub`, which Effitrans stores as
 *      `scanner_name`. So a stubbed clearance is identifiable from the database
 *      alone, by two independent fields, for ever. No row can be mistaken for
 *      genuine scanner evidence.
 *
 *   4. IT CHANGES NO SECURITY CONTROL. It signs with the shared secret, echoes
 *      the nonce and binds its verdict to the sha256 it was given, exactly as
 *      the real worker must. The database guard, the maker-checker separation,
 *      the RLS policies and the replay index are untouched and still do their
 *      work — a stubbed CLEAN still cannot publish a document whose provenance
 *      and licence have not been ruled on by two different people.
 *
 * WHAT IT CANNOT TELL YOU: whether the real scanner detects malware. That
 * requires ClamAV and EICAR against the real worker, and is reported as
 * pending until it has been run.
 */
import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SCANNER_VERSION = "DEV-STUB-NOT-A-REAL-SCAN";

/** The EICAR test string, split so this file is not itself a flagged sample. */
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join("");

const need = (name) => {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.error(`[dev-scan-stub] ${name} is required.`);
    process.exit(1);
  }
  return v;
};

// ---------------------------------------------------------------------------
// GUARD 1 — the operator must say it out loud.
// ---------------------------------------------------------------------------
if ((process.env.DEV_SCAN_STUB_ACK ?? "").trim() !== "i-know-this-is-not-a-scanner") {
  console.error(
    "[dev-scan-stub] refusing to start.\n"
      + "  Set DEV_SCAN_STUB_ACK=i-know-this-is-not-a-scanner.\n"
      + "  This process reports CLEAN for almost everything. It exists to exercise\n"
      + "  the publication workflow in development, and it must never be the thing\n"
      + "  standing between the library and a malicious PDF.",
  );
  process.exit(1);
}

const secret = need("EFFITRANS_SCAN_SECRET");
const callbackUrl = need("EFFITRANS_CALLBACK_URL");
const port = Number(process.env.PORT || 8099);

// ---------------------------------------------------------------------------
// GUARD 2 — loopback only, and this is the one that makes the stub harmless.
//
// A verdict is worthless unless it is delivered. Refusing any non-loopback
// callback means this process cannot deliver a verdict to a deployed
// environment at all, whatever anyone configures on the other side.
// ---------------------------------------------------------------------------
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
let callbackHost;
try {
  callbackHost = new URL(callbackUrl).hostname.replace(/^\[|\]$/g, "");
} catch {
  console.error(`[dev-scan-stub] EFFITRANS_CALLBACK_URL is not a URL: ${callbackUrl}`);
  process.exit(1);
}
if (!LOOPBACK.has(callbackHost)) {
  console.error(
    `[dev-scan-stub] refusing to start: callback host "${callbackHost}" is not loopback.\n`
      + "  This stub may only answer a local development server. If you need a\n"
      + "  verdict in a deployed environment, run the real scanner\n"
      + "  (workers/clamav-scanner) — that is the whole point of the distinction.",
  );
  process.exit(1);
}

const hmacHex = (body) => createHmac("sha256", secret).update(body, "utf8").digest("hex");

function verify(rawBody, signature) {
  const expected = hmacHex(rawBody);
  const given = String(signature ?? "");
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}

const log = (event, fields = {}) => {
  const safe = { ts: new Date().toISOString(), event, ...fields };
  delete safe.download_url;
  console.log(JSON.stringify(safe));
};

async function runJob(job) {
  // Fetch the object through the signed URL, exactly as the real worker does.
  let buf;
  try {
    const res = await fetch(job.download_url);
    if (!res.ok) return { verdict: "ERROR", detail: `download_http_${res.status}`, engine_ref: null };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { verdict: "ERROR", detail: `download_failed:${e?.message ?? "unknown"}`, engine_ref: null };
  }

  // THE SAME BINDING THE REAL WORKER ENFORCES. A verdict is evidence about
  // specific bytes; if these are not those bytes, there is nothing to say.
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== job.sha256) {
    return { verdict: "ERROR", detail: "sha256_mismatch", engine_ref: null };
  }

  // The only "detection" this stub performs: the standard harmless test
  // signature. It is here so a developer can prove the INFECTED path — the
  // quarantine, the withdrawal, the refusal to publish — actually works.
  if (buf.includes(EICAR)) {
    return { verdict: "INFECTED", detail: "signature=Eicar-Test-Signature (DEV STUB)", engine_ref: "Eicar-Test-Signature" };
  }

  return {
    verdict: "CLEAN",
    // Said in the evidence itself, not only in the version field.
    detail: "no scan performed — development stub",
    engine_ref: null,
  };
}

async function deliver(job, outcome) {
  const body = JSON.stringify({
    document_id: job.document_id,
    tenant_id: job.tenant_id,
    storage_path: job.storage_path,
    sha256: job.sha256,
    verdict: outcome.verdict,
    nonce: job.nonce,
    issued_at: new Date().toISOString(),
    scanner_version: SCANNER_VERSION,
    engine_ref: outcome.engine_ref,
    detail: outcome.detail,
  });

  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-effitrans-signature": hmacHex(body) },
      body,
    });
    log("callback.result", { document_id: job.document_id, status: res.status, ok: res.ok });
  } catch (e) {
    log("callback.failed", { document_id: job.document_id, message: e?.message ?? "unknown" });
  }
}

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, { ok: true, stub: true, scanner_version: SCANNER_VERSION });
  }
  if (req.method !== "POST" || req.url !== "/scan") return json(res, 404, { error: "not_found" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) return json(res, 413, { error: "request_too_large" });
  }

  if (!verify(raw, req.headers["x-effitrans-signature"])) {
    log("scan.refused", { error: "bad_signature" });
    return json(res, 401, { error: "bad_signature" });
  }

  let job;
  try { job = JSON.parse(raw); } catch { return json(res, 400, { error: "invalid_payload" }); }
  if (!job.document_id || !job.download_url || !job.sha256 || !job.nonce) {
    return json(res, 400, { error: "invalid_payload" });
  }

  // 202 then work, because Effitrans aborts its dispatch after 10 seconds.
  log("scan.accepted", { document_id: job.document_id, tenant_id: job.tenant_id });
  json(res, 202, { accepted: true, document_id: job.document_id });

  setImmediate(async () => {
    const outcome = await runJob(job);
    log("scan.complete", { document_id: job.document_id, verdict: outcome.verdict });
    await deliver(job, outcome);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.error(
    "\n  ############################################################\n"
      + "  #  DEV SCAN STUB — THIS IS NOT A MALWARE SCANNER           #\n"
      + "  #  Every verdict is stamped DEV-STUB-NOT-A-REAL-SCAN.      #\n"
      + "  #  Development use only.                                   #\n"
      + "  ############################################################\n",
  );
  log("stub.start", { port, callback_host: callbackHost, scanner_version: SCANNER_VERSION });
});
