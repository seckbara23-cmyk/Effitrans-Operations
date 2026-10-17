/**
 * The worker's HTTP surface. Two routes, and nothing else.
 *
 *   POST /scan     authenticated scan request from Effitrans
 *   GET  /healthz  liveness + clamd readiness, for the platform's restarts
 *
 * IT ACKNOWLEDGES FAST AND SCANS LATER, and that is forced by the other side:
 * Effitrans aborts its dispatch after 10 seconds. A 50 MB download plus a
 * ClamAV pass does not fit in that, so /scan validates, enqueues and returns
 * 202. The verdict travels back on its own authenticated callback.
 *
 * LOAD IS SHED, NOT QUEUED FOR EVER. Beyond `queueLimit` the worker answers
 * 503, which Effitrans surfaces as `dispatch_failed` and leaves the document
 * exactly where it was. A worker that accepts unbounded work on a 4 GB box
 * dies, and a dead scanner is indistinguishable from a silent one.
 */
import http from "node:http";
import { loadConfig } from "./config.mjs";
import { ping, version } from "./clamd.mjs";
import { deliver, parseRequest, runJob } from "./pipeline.mjs";

const cfg = loadConfig();
cfg.scannerVersion = process.env.SCANNER_VERSION ?? null;

/** nonce -> expiry. Request-level replay refusal; bounded and swept. */
const seenNonces = new Map();
const rememberNonce = (n, now) => seenNonces.set(n, now + cfg.nonceTtlMs);
const sweepNonces = (now) => {
  for (const [n, exp] of seenNonces) if (exp <= now) seenNonces.delete(n);
};

const queue = [];
let active = 0;

/**
 * Structured logging that CANNOT leak a document or a credential.
 *
 * Logged: ids, verdict, byte count, timings. Never logged: the signed URL, the
 * shared secret, any document bytes, any signature.
 */
const log = (event, fields = {}) => {
  const safe = { ts: new Date().toISOString(), event, ...fields };
  delete safe.downloadUrl;
  delete safe.download_url;
  process.stdout.write(`${JSON.stringify(safe)}\n`);
};

async function pump() {
  if (active >= cfg.concurrency) return;
  const job = queue.shift();
  if (!job) return;
  active += 1;

  const started = Date.now();
  try {
    const outcome = await runJob(job, cfg);
    log("scan.complete", {
      document_id: job.documentId,
      verdict: outcome.verdict,
      bytes: outcome.bytes ?? null,
      ms: Date.now() - started,
    });

    const sent = await deliver(job, outcome, cfg);
    log("callback.result", {
      document_id: job.documentId,
      ok: sent.ok,
      attempts: sent.attempts,
      status: sent.status ?? null,
      permanent: sent.permanent ?? false,
    });
  } catch (e) {
    // Belt and braces: runJob/deliver are written not to throw, but a crash
    // here would silently drop a job and strand a document.
    log("scan.crash", { document_id: job.documentId, message: e?.message ?? "unknown" });
    await deliver(job, { verdict: "ERROR", detail: "worker_exception", engineRef: null }, cfg).catch(
      () => {},
    );
  } finally {
    active -= 1;
    setImmediate(pump);
  }
}

const readBody = (req, limitBytes = 64 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("request_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

export const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    const alive = await ping({ host: cfg.clamdHost, port: cfg.clamdPort });
    const v = alive ? await version({ host: cfg.clamdHost, port: cfg.clamdPort }) : null;
    // UNHEALTHY WITHOUT CLAMD, deliberately: a worker that accepts scans it
    // cannot perform would answer ERROR for everything while looking up.
    return json(res, alive ? 200 : 503, {
      ok: alive,
      clamd: alive ? "ready" : "unavailable",
      engine: v,
      queued: queue.length,
      active,
    });
  }

  if (req.method !== "POST" || req.url !== "/scan") {
    return json(res, 404, { error: "not_found" });
  }

  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch {
    return json(res, 413, { error: "request_too_large" });
  }

  const now = Date.now();
  sweepNonces(now);

  const parsed = parseRequest({
    rawBody,
    signature: req.headers["x-effitrans-signature"],
    secret: cfg.secret,
    now,
    maxSkewMs: cfg.maxRequestSkewMs,
    seenNonces,
  });

  if (!parsed.ok) {
    log("scan.refused", { error: parsed.error, status: parsed.status });
    return json(res, parsed.status, { error: parsed.error });
  }

  if (queue.length >= cfg.queueLimit) {
    log("scan.shed", { document_id: parsed.job.documentId, queued: queue.length });
    return json(res, 503, { error: "busy" });
  }

  rememberNonce(parsed.job.nonce, now);
  queue.push(parsed.job);
  log("scan.accepted", {
    document_id: parsed.job.documentId,
    tenant_id: parsed.job.tenantId,
    queued: queue.length,
  });

  // 202: accepted, not finished. The verdict arrives on the callback.
  json(res, 202, { accepted: true, document_id: parsed.job.documentId });
  setImmediate(pump);
});

if (process.env.NODE_ENV !== "test") {
  server.listen(cfg.port, () => {
    log("worker.start", {
      port: cfg.port,
      concurrency: cfg.concurrency,
      queue_limit: cfg.queueLimit,
      scanner: cfg.scannerName,
    });
  });
}
