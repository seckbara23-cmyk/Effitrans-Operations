/**
 * Temporary password generation (Phase 3.2B) — PURE (Web Crypto only).
 * ---------------------------------------------------------------------------
 * Generates a strong, admin-shared temporary password for a client portal
 * account. Cryptographically secure (globalThis.crypto.getRandomValues), ≥ 12
 * chars, guaranteeing one uppercase, one lowercase, one digit and one special.
 * The value is returned to the caller ONCE and is NEVER logged, stored in an app
 * table, put in an audit payload, or emailed by default — it is handed straight
 * to Supabase Auth and shown to the admin once.
 *
 * Ambiguous glyphs (0/O/1/l/I) are excluded so the password is safe to read out
 * over the phone / WhatsApp / a printed sheet.
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l, o
const DIGIT = "23456789"; // no 0, 1
const SPECIAL = "!@#$%&*?";
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

const DEFAULT_LENGTH = 14;
const MIN_LENGTH = 12;

/** Uniform integer in [0, max) from CSPRNG, rejection-sampled to avoid bias. */
function secureIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

function pick(pool: string): string {
  return pool[secureIndex(pool.length)];
}

/** A strong temporary password (≥ 12 chars, all four character classes). */
export function generateTempPassword(length = DEFAULT_LENGTH): string {
  const len = Math.max(MIN_LENGTH, length);
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < len) chars.push(pick(ALL));
  // Secure Fisher–Yates shuffle so the required classes are not positionally fixed.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** True when a password satisfies the temporary-password strength contract. */
export function hasRequiredComplexity(pw: string): boolean {
  return (
    pw.length >= MIN_LENGTH &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}
