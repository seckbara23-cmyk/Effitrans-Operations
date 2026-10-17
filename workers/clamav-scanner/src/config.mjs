/**
 * Worker configuration. Fails closed, loudly, at startup.
 *
 * THE WORKER HOLDS NO SUPABASE CREDENTIAL. It cannot list the bucket, cannot
 * read another document, and cannot reach storage at all except through the
 * single short-lived signed URL Effitrans mints for one object. That is the
 * least-privilege property this whole design is built around: compromising the
 * worker yields one shared secret and whatever object is in flight, not the
 * library.
 */

const req = (name) => {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    throw new Error(
      `[config] ${name} is required. The worker refuses to start without it: ` +
        `an unauthenticated scanner is worse than no scanner.`,
    );
  }
  return v;
};

const num = (name, fallback) => {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`[config] ${name} must be a positive number`);
  return n;
};

export function loadConfig(env = process.env) {
  const get = (n) => (env[n] ?? "").trim();
  const need = (n) => {
    const v = get(n);
    if (!v) throw new Error(`[config] ${n} is required`);
    return v;
  };

  return {
    /** Shared with Effitrans. Signs BOTH directions. */
    secret: need("EFFITRANS_SCAN_SECRET"),
    /** Where the verdict is POSTed, e.g. https://…/api/customs/reference/scan-callback */
    callbackUrl: need("EFFITRANS_CALLBACK_URL"),

    port: Number(get("PORT") || 8080),
    clamdHost: get("CLAMD_HOST") || "127.0.0.1",
    clamdPort: Number(get("CLAMD_PORT") || 3310),

    /** Refuse a dispatch older than this. Mirrors Effitrans' own window. */
    maxRequestSkewMs: Number(get("MAX_REQUEST_SKEW_MS") || 5 * 60 * 1000),
    /** The signed URL lives 300 s; give up well inside it. */
    downloadTimeoutMs: Number(get("DOWNLOAD_TIMEOUT_MS") || 120_000),
    /** A scan that takes longer than this is reported ERROR, never CLEAN. */
    scanTimeoutMs: Number(get("SCAN_TIMEOUT_MS") || 180_000),
    /** Hard ceiling on bytes pulled from the signed URL. */
    maxBytes: Number(get("MAX_BYTES") || 64 * 1024 * 1024),
    /** Simultaneous scans. ClamAV is memory-hungry; this is the main dial. */
    concurrency: Number(get("SCAN_CONCURRENCY") || 2),
    /** Queue depth before the worker sheds load with 503. */
    queueLimit: Number(get("QUEUE_LIMIT") || 50),
    /** Callback delivery retries, with linear backoff. */
    callbackRetries: Number(get("CALLBACK_RETRIES") || 4),
    callbackBackoffMs: Number(get("CALLBACK_BACKOFF_MS") || 3_000),
    /** How long a seen nonce is remembered, for request-level replay refusal. */
    nonceTtlMs: Number(get("NONCE_TTL_MS") || 60 * 60 * 1000),

    scannerName: get("SCANNER_NAME") || "clamav-worker",
  };
}

export { req, num };
