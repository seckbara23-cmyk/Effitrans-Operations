/**
 * SCANNER-01 — the scanner adapter, executed.
 * ===========================================================================
 * WHAT THIS DEFENDS. The adapter is the only place that decides whether a
 * message is authentic, and every one of its refusals is a security property:
 * an unconfigured scanner, a forged signature, a captured callback replayed
 * later, a verdict about other bytes, a verdict nobody recognises. None of
 * those can be asserted by reading source — they are outcomes of a function
 * given adversarial input — so this file runs the real adapter.
 *
 * THE ENVIRONMENT IS SET PER TEST, NOT GLOBALLY. `scannerConfig()` reads
 * process.env on every call so the unconfigured case is reachable, which is the
 * case that matters most: with no scanner, nothing may be published.
 *
 * NO SECRET LEAVES THIS FILE. The secret used here is a literal test string.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  CALLBACK_MAX_SKEW_MS,
  SCAN_DOWNLOAD_TTL_SECONDS,
  SCAN_TIMEOUT_MS,
  isScanVerdict,
  newScanNonce,
  parseCallback,
  scannerConfig,
  scanningAvailable,
} from "@/lib/customs/reference/scan";

const SECRET = "test-callback-secret-not-a-real-one";
const ENDPOINT = "https://scanner.invalid/scan";

const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

/** A well-formed verdict body. */
function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    document_id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    verdict: "CLEAN",
    sha256: "a".repeat(64),
    storage_path: "00000000-0000-0000-0000-000000000001/doc.pdf",
    nonce: "nonce-abcdef123456",
    issued_at: new Date().toISOString(),
    ...over,
  });
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.CUSTOMS_SCAN_ENDPOINT = ENDPOINT;
  process.env.CUSTOMS_SCAN_CALLBACK_SECRET = SECRET;
  process.env.CUSTOMS_SCAN_PROVIDER = "test-scanner";
});
afterEach(() => {
  process.env = { ...saved };
});

// ===========================================================================
describe("SCANNER-01 — configuration fails closed", () => {
  it("1 — both halves are required", () => {
    expect(scanningAvailable()).toBe(true);

    delete process.env.CUSTOMS_SCAN_CALLBACK_SECRET;
    // An endpoint with no secret would mean believing unauthenticated verdicts.
    expect(scannerConfig()).toBeNull();
    expect(scanningAvailable()).toBe(false);

    process.env.CUSTOMS_SCAN_CALLBACK_SECRET = SECRET;
    delete process.env.CUSTOMS_SCAN_ENDPOINT;
    // A secret with no endpoint means nothing is ever sent for scanning.
    expect(scannerConfig()).toBeNull();
  });

  it("2 — blank or whitespace configuration is not configuration", () => {
    process.env.CUSTOMS_SCAN_ENDPOINT = "   ";
    expect(scannerConfig()).toBeNull();
  });

  it("3 — with no scanner, every callback is refused", () => {
    delete process.env.CUSTOMS_SCAN_ENDPOINT;
    delete process.env.CUSTOMS_SCAN_CALLBACK_SECRET;
    const b = body();
    // Not even a correctly signed one, because there is no secret to sign with.
    expect(parseCallback(b, sign(b))).toEqual({ ok: false, error: "scanner_unavailable" });
  });

  it("4 — the provider name has a fallback, so a verdict is always attributable", () => {
    delete process.env.CUSTOMS_SCAN_PROVIDER;
    expect(scannerConfig()?.name).toBe("external-scanner");
  });
});

// ===========================================================================
describe("SCANNER-01 — callback authentication", () => {
  it("5 — a correctly signed, fresh callback parses", () => {
    const b = body();
    const res = parseCallback(b, sign(b));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.verdict).toBe("CLEAN");
    expect(res.payload.nonce).toBe("nonce-abcdef123456");
    expect(res.payload.sha256).toBe("a".repeat(64));
  });

  it("6 — no signature, a wrong signature, and a signature under another secret", () => {
    const b = body();
    expect(parseCallback(b, null)).toEqual({ ok: false, error: "bad_signature" });
    expect(parseCallback(b, "")).toEqual({ ok: false, error: "bad_signature" });
    expect(parseCallback(b, "f".repeat(64))).toEqual({ ok: false, error: "bad_signature" });
    // FORGERY: a perfectly formed HMAC, under a secret the platform does not
    // share. This is the attack the shared secret exists to stop.
    expect(parseCallback(b, sign(b, "the-wrong-secret")))
      .toEqual({ ok: false, error: "bad_signature" });
  });

  it("7 — the signature covers the WHOLE body, so no field can be edited", () => {
    const original = body();
    const signature = sign(original);
    // Keep the signature, change the verdict: the classic tamper.
    const tampered = body({ verdict: "CLEAN", sha256: "b".repeat(64) });
    expect(parseCallback(tampered, signature)).toEqual({ ok: false, error: "bad_signature" });
    // And an INFECTED verdict cannot be flipped to CLEAN either.
    const infected = body({ verdict: "INFECTED" });
    expect(parseCallback(body({ verdict: "CLEAN" }), sign(infected)))
      .toEqual({ ok: false, error: "bad_signature" });
  });

  it("8 — a malformed signature does not throw", () => {
    const b = body();
    for (const bad of ["zz", "!!!!", "0x1234", " ".repeat(64)]) {
      expect(parseCallback(b, bad)).toEqual({ ok: false, error: "bad_signature" });
    }
  });
});

// ===========================================================================
describe("SCANNER-01 — replay", () => {
  it("9 — a captured callback goes stale, however valid its signature", () => {
    // THE ATTACK. An HMAC proves WHO sent a message and nothing about WHEN, so
    // without a freshness window a captured CLEAN stayed valid for ever.
    const issued = new Date(Date.now() - (CALLBACK_MAX_SKEW_MS + 60_000)).toISOString();
    const b = body({ issued_at: issued });
    expect(parseCallback(b, sign(b))).toEqual({ ok: false, error: "stale_callback" });
  });

  it("10 — and a callback from the future is refused too", () => {
    // Clock skew cuts both ways; a far-future timestamp is how an attacker
    // would buy a long validity window.
    const b = body({ issued_at: new Date(Date.now() + CALLBACK_MAX_SKEW_MS + 60_000).toISOString() });
    expect(parseCallback(b, sign(b))).toEqual({ ok: false, error: "stale_callback" });
  });

  it("11 — inside the window it is accepted, which is why the nonce exists too", () => {
    const b = body({ issued_at: new Date(Date.now() - 60_000).toISOString() });
    expect(parseCallback(b, sign(b)).ok).toBe(true);
    // A window has to be wide enough for a slow scanner, and anything inside it
    // is replayable — including immediately. Uniqueness has no window, and the
    // nonce is carried through for the database to enforce it.
    const res = parseCallback(b, sign(b));
    expect(res.ok && res.payload.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("12 — a missing, short or absent nonce is refused", () => {
    for (const nonce of [undefined, "", "short"]) {
      const b = body(nonce === undefined ? { nonce: undefined } : { nonce });
      expect(parseCallback(b, sign(b)), String(nonce)).toEqual({ ok: false, error: "invalid_payload" });
    }
  });

  it("13 — a missing or unparseable timestamp is refused", () => {
    for (const issued of [undefined, "", "yesterday", "2026-13-45"]) {
      const b = body({ issued_at: issued });
      expect(parseCallback(b, sign(b)), String(issued)).toEqual({ ok: false, error: "invalid_payload" });
    }
  });

  it("14 — nonces are unique per call", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newScanNonce()));
    expect(seen.size).toBe(200);
    expect([...seen].every((n) => n.length >= 8)).toBe(true);
  });
});

// ===========================================================================
describe("SCANNER-01 — the payload decides nothing by itself", () => {
  it("15 — an unknown verdict is refused, not coerced", () => {
    for (const verdict of ["SUSPICIOUS", "clean-ish", "OK", "PASS", "", undefined]) {
      const b = body({ verdict });
      expect(parseCallback(b, sign(b)), String(verdict))
        .toEqual({ ok: false, error: "invalid_payload" });
    }
    // Case is normalised, because that is a formatting difference, not a
    // different answer.
    const lower = body({ verdict: "clean" });
    expect(parseCallback(lower, sign(lower)).ok).toBe(true);
    expect(isScanVerdict("CLEAN")).toBe(true);
    expect(isScanVerdict("MAYBE")).toBe(false);
  });

  it("16 — a malformed checksum is refused", () => {
    for (const sha256 of ["", "abc", "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      const b = body({ sha256 });
      expect(parseCallback(b, sign(b)), sha256.slice(0, 8))
        .toEqual({ ok: false, error: "invalid_payload" });
    }
    // Uppercase hex is NORMALISED, not rejected: case is a formatting
    // difference, not a different checksum, and `content_sha256` is stored
    // lowercase — so the comparison in the recorder has to see lowercase or a
    // correct verdict would read as binding_mismatch.
    const upper = body({ sha256: "A".repeat(64) });
    const res = parseCallback(upper, sign(upper));
    expect(res.ok).toBe(true);
    expect(res.ok && res.payload.sha256).toBe("a".repeat(64));
  });

  it("17 — a missing document, tenant or path is refused", () => {
    for (const field of ["document_id", "tenant_id", "storage_path"]) {
      const b = body({ [field]: "" });
      expect(parseCallback(b, sign(b)), field).toEqual({ ok: false, error: "invalid_payload" });
    }
  });

  it("18 — a body that is not JSON is refused", () => {
    expect(parseCallback("not json at all", sign("not json at all")))
      .toEqual({ ok: false, error: "invalid_payload" });
  });

  it("19 — the adapter never manufactures a verdict of its own", () => {
    // Every path out of parseCallback either refuses, or returns exactly what
    // was signed. There is no default and no inference.
    const b = body({ verdict: "ERROR" });
    const res = parseCallback(b, sign(b));
    expect(res.ok && res.payload.verdict).toBe("ERROR");
  });
});

// ===========================================================================
describe("SCANNER-01 — the operational constants are coherent", () => {
  it("20 — the download link is short-lived, and the lost-scan window is long", () => {
    // Long enough for a queued worker to fetch a large PDF; short enough that a
    // leaked link is worthless.
    expect(SCAN_DOWNLOAD_TTL_SECONDS).toBeGreaterThanOrEqual(60);
    expect(SCAN_DOWNLOAD_TTL_SECONDS).toBeLessThanOrEqual(900);
    // A retry must not be possible before a slow scan could plausibly finish.
    expect(SCAN_TIMEOUT_MS).toBeGreaterThan(SCAN_DOWNLOAD_TTL_SECONDS * 1000);
    // And the freshness window must be far shorter than the retry window, or a
    // captured callback could be replayed against the retry.
    expect(CALLBACK_MAX_SKEW_MS).toBeLessThan(SCAN_TIMEOUT_MS);
  });
});
