/**
 * Malware scanning for the Customs Reference Library. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * CUSTOMS-REF-01A / REF-1-PUBLISH-GATE, Part A.
 *
 * THERE IS NO SCANNER CONFIGURED FOR THIS PROJECT, and this module is written
 * so that that fact is safe rather than hidden. It is an ADAPTER with no
 * default: `scannerConfig()` returns null unless an operator has supplied both
 * an endpoint and a secret, and every caller treats null as "cannot scan".
 * Nothing here ever produces a verdict of its own — the only path into CLEAN is
 * a signed callback from the configured scanner, recorded through a database
 * function that the browser and every authenticated client are revoked from.
 *
 * WHY AN OUT-OF-BAND CALLBACK RATHER THAN A SYNCHRONOUS CALL. The bytes live in
 * a private Supabase bucket and the application runs as serverless functions
 * with a short execution budget; a 50 MB statute cannot be streamed to a
 * scanner and back inside one request. So the upload hands over a reference,
 * the document sits SCANNING, and the verdict arrives later on its own route.
 * That also means a scanner outage cannot block an upload — it simply leaves
 * the document unpublishable, which is the failure we want.
 *
 * FAIL CLOSED, EVERYWHERE. Unconfigured, unreachable, slow, or answering
 * something this module does not recognise all end in the same place: the
 * document does not become CLEAN, and `publish_customs_reference` refuses it.
 * There is no timeout that degrades to a pass and no "assume clean" branch.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { hmacSha256Hex, verifyHmacSignature } from "@/lib/finance/providers/sign";

/** The verdicts the database will accept. Nothing else is a scan result. */
export const SCAN_VERDICTS = ["CLEAN", "INFECTED", "ERROR"] as const;
export type ScanVerdict = (typeof SCAN_VERDICTS)[number];

export const SCAN_STATUSES = ["UNSCANNED", "SCANNING", "CLEAN", "INFECTED", "ERROR"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export function isScanVerdict(v: unknown): v is ScanVerdict {
  return typeof v === "string" && (SCAN_VERDICTS as readonly string[]).includes(v);
}

/**
 * How long the scanner's download link lives.
 *
 * Long enough for a queued worker to fetch a large PDF, short enough that a
 * leaked link is worthless by the time anyone could use it. This is the ONE
 * place in the library that mints a signed URL, and the reasoning differs from
 * the viewer's on purpose: the viewer serves PEOPLE, where a link can be pasted
 * into a chat and licence-restricted material redistributed, so it streams
 * bytes instead. The scanner is a single automated consumer with no UI, and the
 * alternative — handing it service-role credentials to the whole bucket — is
 * strictly worse than a five-minute link to one object.
 */
export const SCAN_DOWNLOAD_TTL_SECONDS = 300;

/**
 * How long a SCANNING document may wait before the request is considered lost.
 *
 * A verdict that never arrives must not strand a document for ever: after this,
 * a publisher may ask again. It is NOT a timeout that decays to a pass —
 * publication still requires CLEAN, so a lost scan simply stays unpublishable.
 */
export const SCAN_TIMEOUT_MS = 30 * 60 * 1000;

/** A callback older than this is refused, whatever its signature says. */
export const CALLBACK_MAX_SKEW_MS = 5 * 60 * 1000;

export type ScannerConfig = {
  /** Where a scan is requested. */
  endpoint: string;
  /** Shared secret the scanner signs its callback with. */
  callbackSecret: string;
  /** Free-text name recorded with every verdict, for traceability. */
  name: string;
};

/**
 * The configured scanner, or null.
 *
 * BOTH halves are required. An endpoint without a callback secret would mean
 * accepting unauthenticated verdicts, and a secret without an endpoint would
 * mean nothing ever gets scanned — each alone is a misconfiguration, and the
 * safe reading of a misconfiguration is "no scanner".
 */
export function scannerConfig(): ScannerConfig | null {
  const endpoint = (process.env.CUSTOMS_SCAN_ENDPOINT ?? "").trim();
  const callbackSecret = (process.env.CUSTOMS_SCAN_CALLBACK_SECRET ?? "").trim();
  if (!endpoint || !callbackSecret) return null;
  return {
    endpoint,
    callbackSecret,
    name: (process.env.CUSTOMS_SCAN_PROVIDER ?? "external-scanner").trim() || "external-scanner",
  };
}

/** Is scanning available at all? Used to explain, never to excuse. */
export function scanningAvailable(): boolean {
  return scannerConfig() !== null;
}

export type ScanRequest = {
  documentId: string;
  tenantId: string;
  storagePath: string;
  sha256: string;
  /**
   * A short-lived signed URL for the exact object.
   *
   * WITHOUT THIS THE WORKFLOW DOES NOT EXIST. The bucket is private and has no
   * `storage.objects` policy, so a `storage_path` alone is a name the scanner
   * has no way to read. The caller mints the link; this module never holds
   * storage credentials.
   */
  downloadUrl: string;
  /** Echoed back in the verdict; makes a replayed callback collide. */
  nonce: string;
};

export type ScanDispatch =
  | { ok: true; nonce: string }
  | { ok: false; error: "scanner_unavailable" | "dispatch_failed" };

/** A nonce for one dispatch. Unique per (document, attempt), never reused. */
export function newScanNonce(): string {
  return randomUUID();
}

/**
 * Hand an object to the scanner.
 *
 * Returns `scanner_unavailable` when nothing is configured — the caller must
 * leave the document UNSCANNED rather than inventing a state. A dispatch that
 * throws or answers non-2xx is `dispatch_failed`: the document stays where it
 * was and can be retried.
 *
 * The request carries a REFERENCE, never the bytes: the scanner fetches them
 * through its own credential. This module does not hand out signed URLs.
 */
export async function dispatchScan(req: ScanRequest): Promise<ScanDispatch> {
  const cfg = scannerConfig();
  if (!cfg) return { ok: false, error: "scanner_unavailable" };

  // SIGNED OUTBOUND, under the same shared secret. Authentication has to work
  // in both directions: without this the scanner cannot tell a genuine request
  // from anyone who learned its endpoint, and would happily fetch and scan
  // whatever URL a stranger handed it.
  const body = JSON.stringify({
    document_id: req.documentId,
    tenant_id: req.tenantId,
    storage_path: req.storagePath,
    sha256: req.sha256,
    download_url: req.downloadUrl,
    nonce: req.nonce,
    issued_at: new Date().toISOString(),
  });

  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-effitrans-signature": hmacSha256Hex(cfg.callbackSecret, body),
      },
      body,
      // A dispatch is not a verdict: a slow scanner must not hold a request
      // open, and a timeout here leaves the document unpublishable.
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { ok: true, nonce: req.nonce } : { ok: false, error: "dispatch_failed" };
  } catch {
    return { ok: false, error: "dispatch_failed" };
  }
}

export type CallbackPayload = {
  documentId: string;
  tenantId: string;
  verdict: ScanVerdict;
  sha256: string;
  storagePath: string;
  scannerVersion: string | null;
  engineRef: string | null;
  detail: string | null;
  /** The dispatch's nonce, echoed back. Recorded, and unique per document. */
  nonce: string;
};

export type CallbackParse =
  | { ok: true; payload: CallbackPayload }
  | { ok: false; error: "scanner_unavailable" | "bad_signature" | "invalid_payload" | "stale_callback" };

/**
 * Authenticate and parse a scanner callback.
 *
 * The signature is computed over the RAW body, exactly as the finance webhook
 * providers do, and compared in constant time. An unconfigured scanner rejects
 * every callback: without a secret there is no one whose word to take.
 *
 * NOTHING IS INFERRED. A missing or unrecognised verdict is `invalid_payload`,
 * not ERROR and certainly not CLEAN — this function never decides anything
 * about an object, it only decides whether a message is authentic.
 */
export function parseCallback(
  rawBody: string,
  signature: string | null,
  now: number = Date.now(),
): CallbackParse {
  const cfg = scannerConfig();
  if (!cfg) return { ok: false, error: "scanner_unavailable" };
  if (!signature || !verifyHmacSignature(cfg.callbackSecret, rawBody, signature)) {
    return { ok: false, error: "bad_signature" };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const documentId = str("document_id");
  const tenantId = str("tenant_id");
  const verdict = str("verdict").toUpperCase();
  const sha256 = str("sha256").toLowerCase();
  const storagePath = str("storage_path");

  if (!documentId || !tenantId || !storagePath) return { ok: false, error: "invalid_payload" };
  if (!isScanVerdict(verdict)) return { ok: false, error: "invalid_payload" };
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "invalid_payload" };

  // REPLAY, FIRST LAYER. An HMAC proves WHO sent a message and says nothing
  // about WHEN or whether it is the first time. A captured CLEAN callback
  // stayed valid for ever; a freshness window makes it worthless once the
  // window closes. The second layer is the unique nonce in the database, which
  // does not depend on either clock being right.
  const nonce = str("nonce");
  if (nonce.length < 8) return { ok: false, error: "invalid_payload" };

  const issuedAt = Date.parse(str("issued_at"));
  if (!Number.isFinite(issuedAt)) return { ok: false, error: "invalid_payload" };
  if (Math.abs(now - issuedAt) > CALLBACK_MAX_SKEW_MS) {
    return { ok: false, error: "stale_callback" };
  }

  const opt = (k: string): string | null => (str(k).length > 0 ? str(k) : null);

  return {
    ok: true,
    payload: {
      documentId,
      tenantId,
      verdict,
      sha256,
      storagePath,
      scannerVersion: opt("scanner_version"),
      engineRef: opt("engine_ref"),
      detail: opt("detail"),
      nonce,
    },
  };
}
