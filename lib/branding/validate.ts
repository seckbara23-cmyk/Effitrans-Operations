/**
 * Branding value validation (Phase 4.0B-3). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * Branding is tenant-supplied (eventually via an admin UI), so every value that
 * lands in an email/PDF/portal MUST be validated: colors are `#rgb`/`#rrggbb`
 * only, URLs are http(s) only, and text fields reject HTML (no injection, no
 * arbitrary CSS). Invalid values are dropped so the resolver falls back.
 */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHexColor(v: string | null | undefined): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

/** http(s) only — rejects javascript:, data:, and malformed URLs. */
export function isSafeUrl(v: string | null | undefined): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Any angle bracket makes a plain-text branding value unsafe (potential markup). */
export function containsHtml(v: string): boolean {
  return /[<>]/.test(v);
}

/** A trimmed plain-text value, or undefined if empty or containing HTML. */
export function safeText(v: string | null | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "" || containsHtml(t)) return undefined;
  return t;
}
