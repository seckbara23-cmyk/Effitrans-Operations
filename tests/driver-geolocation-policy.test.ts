/**
 * UAT-DRIVER-LIVE-TRACKING-04 — the Permissions-Policy must permit geolocation
 * for THIS origin, and must never regress to an empty allowlist.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. Phase 1.18 (2026-06-16) shipped
 * `Permissions-Policy: … geolocation=() …` under the comment "disable powerful
 * features the app never uses" — written a month BEFORE the driver mobile
 * tracking layer existed (Phase 3.4, migration 20260710000002). Nothing
 * reconciled the two and NO test pinned the header, so on 2026-09-26 the
 * chauffeur GPS pipeline failed in production while looking like a device
 * problem: the session went ACTIVE, `tracking_position` stayed at zero, the
 * client queue stayed at zero, and the driver saw « Permission de localisation
 * refusée » that no Android setting or per-site grant could clear.
 *
 * An empty allowlist means the feature is DISALLOWED for the document, so
 * `watchPosition` / `getCurrentPosition` invoke the error callback with
 * PERMISSION_DENIED immediately and the browser never prompts. That is why the
 * fix is `(self)` and why the shape of the value — not merely the presence of
 * the word "geolocation" — is what these tests assert.
 *
 * IT READS THE REAL CONFIG. `next.config.mjs` is imported and `headers()` is
 * invoked, so this checks the value Next will actually serve. A substring match
 * on the file text would pass just as happily on a malformed directive, and a
 * malformed directive fails CLOSED — which is the very outage being pinned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import nextConfig from "../next.config.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const cfg = nextConfig as unknown as { headers?: () => Promise<HeaderRule[]> };
  expect(typeof cfg.headers, "next.config.mjs must define headers()").toBe("function");
  return (await cfg.headers!()) as HeaderRule[];
}

/** The Permissions-Policy value Next will actually serve, from the real config. */
async function permissionsPolicy(): Promise<string> {
  const all = await rules();
  const values = all
    .flatMap((r) => r.headers)
    .filter((h) => h.key.toLowerCase() === "permissions-policy")
    .map((h) => h.value);
  expect(values.length, "exactly one Permissions-Policy header is served").toBe(1);
  return values[0];
}

/**
 * `camera=(), geolocation=(self)` -> { camera: "", geolocation: "self" }.
 * Parsed rather than pattern-matched so a directive that is present but
 * malformed cannot satisfy the assertions below.
 */
function directives(policy: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of policy.split(",")) {
    const m = /^\s*([a-z-]+)\s*=\s*\((.*)\)\s*$/.exec(part);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

describe("UAT-DRIVER-LIVE-TRACKING-04 — geolocation is permitted for self", () => {
  it("01 — ⚠ THE OUTAGE: the geolocation allowlist is NOT empty", async () => {
    const policy = await permissionsPolicy();
    // The exact string that broke production, in both spellings a formatter
    // might produce. `geolocation=()` disallows the feature outright.
    expect(policy).not.toMatch(/geolocation\s*=\s*\(\s*\)/);
    const geo = directives(policy).get("geolocation");
    expect(geo, "a geolocation directive must be present and parseable").toBeDefined();
    expect(geo, "an empty allowlist disallows the Geolocation API entirely").not.toBe("");
  });

  it("02 — and it grants exactly `self`, never a wildcard or a third party", async () => {
    const geo = directives(await permissionsPolicy()).get("geolocation");
    // `self` only: the driver app is same-origin. `*` would hand the feature to
    // every embedded frame, which is a widening, not a fix.
    expect(geo).toBe("self");
    expect(geo).not.toContain("*");
    expect(geo).not.toMatch(/https?:/);
  });

  it("03 — the driver tracker's geolocation calls can therefore run", async () => {
    // Pins the dependency this header exists to serve, so the two cannot drift
    // apart again silently: if the tracker stops calling geolocation, this test
    // says so rather than quietly guarding nothing.
    const tracker = read("components/driver/mission-tracker.tsx");
    expect(tracker).toContain("navigator.geolocation.watchPosition");
    const actions = read("components/driver/mission-actions.tsx");
    expect(actions).toContain("navigator.geolocation.getCurrentPosition");
  });

  it("04 — NOT WEAKENED: every other powerful feature stays disabled", async () => {
    const d = directives(await permissionsPolicy());
    // These three were disabled for a reason and this slice does not touch them.
    // Driver photo capture uses <input type="file">, which needs no getUserMedia,
    // so `camera=()` remains correct.
    expect(d.get("camera"), "camera must stay disabled").toBe("");
    expect(d.get("microphone"), "microphone must stay disabled").toBe("");
    expect(d.get("browsing-topics"), "browsing-topics must stay disabled").toBe("");
  });

  it("05 — NOT WEAKENED: the other baseline security headers are unchanged", async () => {
    const served = new Map(
      (await rules()).flatMap((r) => r.headers).map((h) => [h.key, h.value] as const),
    );
    expect(served.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(served.get("X-Content-Type-Options")).toBe("nosniff");
    expect(served.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(served.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("06 — the headers still apply to every route", async () => {
    const all = await rules();
    const sources = all.map((r) => r.source);
    // A policy scoped to a subset would leave /driver uncovered — or, worse,
    // covered by a stale rule elsewhere.
    expect(sources).toContain("/:path*");
  });

  it("07 — and the config records WHY, so the next hardening pass does not undo it", () => {
    // The comment is the only thing standing between a future "disable what we
    // don't use" sweep and a repeat of this outage.
    const cfg = read("next.config.mjs");
    expect(cfg).toContain("geolocation=(self)");
    expect(cfg).toMatch(/PERMISSION_DENIED/);
    expect(cfg).toContain("tests/driver-geolocation-policy.test.ts");
  });
});
