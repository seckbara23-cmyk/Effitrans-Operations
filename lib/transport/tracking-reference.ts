/**
 * TMS-1C — external live-tracking reference. PURE (no I/O), so the rules are
 * testable and shared by the server action, the RLS backstop and the UI.
 * ---------------------------------------------------------------------------
 * Effitrans Operations is the system of record for the mission; the provider
 * platform stays the live telemetry authority. This module knows only WHERE to
 * look — never a coordinate, never a credential.
 *
 * PROVIDER-NEUTRAL BY CONSTRUCTION: no vendor name appears here, and none may.
 * A test asserts it, because a hard-coded provider is how a "neutral" contract
 * quietly stops being one.
 */

/** Derived tracking state. There is deliberately no ACTIVE — see below. */
export type TrackingReferenceState = "NOT_CONFIGURED" | "AVAILABLE" | "ENDED";

export const TRACKING_STATE_LABEL_FR: Readonly<Record<TrackingReferenceState, string>> = {
  NOT_CONFIGURED: "Suivi en direct non configuré pour cette mission.",
  AVAILABLE: "Suivi en direct disponible chez le prestataire.",
  ENDED: "Suivi en direct clôturé pour cette mission.",
};

export type TrackingReference = {
  id: string;
  transportId: string;
  provider: string;
  externalReference: string | null;
  trackingUrl: string;
  attachedAt: string;
  updatedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
};

/**
 * The state of live tracking for a mission.
 *
 * ACTIVE IS ABSENT ON PURPOSE. Without a provider API this platform cannot
 * observe whether a session is live; reporting ACTIVE would be a claim about
 * the world that nothing here verified. AVAILABLE says exactly what is true —
 * a reference exists and has not been closed. Phase 2 may add ACTIVE when
 * something can actually see it.
 */
export function trackingState(ref: TrackingReference | null): TrackingReferenceState {
  if (!ref) return "NOT_CONFIGURED";
  return ref.endedAt ? "ENDED" : "AVAILABLE";
}

/** May the operator open the provider view? Only a live, unclosed reference. */
export function canFollowLive(ref: TrackingReference | null): boolean {
  return trackingState(ref) === "AVAILABLE";
}

export const MAX_PROVIDER_LENGTH = 80;
export const MAX_EXTERNAL_REFERENCE_LENGTH = 120;
export const MAX_TRACKING_URL_LENGTH = 2000;

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * HTTPS ONLY, and parsed rather than pattern-matched.
 *
 * A tracking link may carry signed parameters, so `http:` would leak them on
 * the wire. `javascript:`, `data:` and friends are refused because this string
 * is rendered into an anchor's href: accepting one would turn an operator
 * field into stored XSS. Parsing with URL() rather than a regex is deliberate —
 * regex URL validation is where these bugs live.
 */
export function validateTrackingUrl(raw: string | null | undefined): UrlCheck {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return { ok: false, error: "url_required" };
  if (trimmed.length > MAX_TRACKING_URL_LENGTH) return { ok: false, error: "url_too_long" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "url_invalid" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "url_not_https" };
  // A URL with no host ("https:///x") parses but points nowhere.
  if (!parsed.hostname) return { ok: false, error: "url_invalid" };
  return { ok: true, url: trimmed };
}

export type ProviderCheck = { ok: true; provider: string } | { ok: false; error: string };

/** A reference without a named provider cannot be governed or explained. */
export function validateProvider(raw: string | null | undefined): ProviderCheck {
  const provider = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PROVIDER_LENGTH);
  if (provider.length === 0) return { ok: false, error: "provider_required" };
  return { ok: true, provider };
}

/** Optional; normalized when present. */
export function normalizeExternalReference(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_EXTERNAL_REFERENCE_LENGTH);
  return v || null;
}

/**
 * What the operator is shown ABOUT the link, without rendering the link's
 * query string anywhere. If the provider signs its URLs, the signature must not
 * end up in a page body, a tooltip or a log line — so the display carries the
 * host only, and the full URL exists solely as the anchor's href.
 */
export function trackingDisplayHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
