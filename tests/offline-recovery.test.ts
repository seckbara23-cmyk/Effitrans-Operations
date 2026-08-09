/**
 * Regression — the 2026-08-09 false « Vous êtes hors ligne » incident.
 * ---------------------------------------------------------------------------
 * Observed twice in production: the full-screen offline fallback replaced the
 * workspace while the workstation had working Internet. Root cause: the service
 * worker's navigation handler treated a SINGLE rejected fetch as proof the
 * device was offline (sleep/wake races, network switches and connection resets
 * reject one fetch while online), and the fallback page had no way back — no
 * probe, no online listener, and a retry link that discarded the original URL.
 *
 * The contract these tests pin:
 *   1. one failed navigation fetch is NOT offline — the worker retries once,
 *      and only a second network-layer failure serves the fallback;
 *   2. the fallback page recovers ITSELF: a real reachability probe (the
 *      public /api/version endpoint) on an interval and on the `online` event,
 *      reloading only after an actual successful response;
 *   3. navigator.onLine is a HINT in both directions — it selects the copy
 *      (device offline vs service unreachable), it never gates the probe and
 *      never triggers reload by itself;
 *   4. retry returns to the ORIGINAL URL (the fallback is served under it),
 *      never through "/";
 *   5. recovery lives in an INLINE script — this page's hydration chunks are
 *      not precached, so React hydration is exactly what cannot be relied on
 *      when the page is shown.
 *
 * The security contract (never cache authenticated HTML, no offline writes) is
 * pinned in pwa-mobile.test.ts and unchanged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const SW = read("../public/sw.js");
const SW_CODE = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const PAGE = read("../app/offline/page.tsx");

// The navigation branch of the fetch handler, comments stripped.
const NAV = SW_CODE.slice(SW_CODE.indexOf('mode === "navigate"'), SW_CODE.indexOf("if (!cacheableStatic"));
// The inline recovery script embedded in the page.
const SCRIPT = PAGE.slice(PAGE.indexOf("RECOVERY_SCRIPT = `"), PAGE.indexOf("`;"));

describe("service worker — one failed fetch is not offline", () => {
  it("retries the navigation once, after a pause, before any fallback", () => {
    // Two attempts on the SAME request; the pause absorbs transient network flaps.
    expect((NAV.match(/fetch\(request\)/g) ?? []).length).toBe(2);
    expect(SW).toContain("NAV_RETRY_DELAY_MS = 400");
    expect(NAV).toContain("setTimeout(resolve, NAV_RETRY_DELAY_MS)");
  });

  it("the fallback is served ONLY from the inner catch — after the second failure", () => {
    // OFFLINE_URL must appear exactly once in the branch, inside the retry's catch.
    expect((NAV.match(/OFFLINE_URL/g) ?? []).length).toBe(1);
    expect(NAV).toMatch(/try \{\s*return await fetch\(request\);\s*\} catch \{[\s\S]*?OFFLINE_URL/);
    // Last resort unchanged: no synthetic page, an explicit network error.
    expect(NAV).toContain("Response.error()");
  });

  it("HTTP errors still pass through — only network-layer rejections are handled", () => {
    // No status inspection in the navigation branch: a 4xx/5xx RESOLVES and is
    // served as-is; converting server errors into "offline" would be a lie.
    expect(NAV).not.toMatch(/\.ok\b|status/);
  });

  it("the security contract survives the fix: navigations still never cached", () => {
    expect(NAV).not.toContain("cache.put");
    expect(NAV).not.toContain("cache.add");
  });

  it("the cache version was bumped so updated clients re-precache the recovering fallback", () => {
    expect(SW).toContain('STATIC_CACHE = "effitrans-static-v2"');
  });
});

describe("offline page — recovers itself with a real reachability probe", () => {
  it("probes the public version endpoint, uncached, on an interval", () => {
    expect(SCRIPT).toContain('fetch("/api/version", { cache: "no-store" })');
    expect(SCRIPT).toMatch(/setInterval\(probe, 4000\)/);
  });

  it("reloads ONLY after an actual successful response — never on a hint", () => {
    expect(SCRIPT).toMatch(/if \(r\.ok\) \{ window\.location\.reload\(\); \}/);
    // Exactly one reload site, and it is inside the response handler.
    expect((SCRIPT.match(/location\.reload/g) ?? []).length).toBe(1);
  });

  it("the `online` event triggers VERIFICATION, not recovery", () => {
    // The handler updates the copy and probes; it must not reload directly.
    expect(SCRIPT).toMatch(/addEventListener\("online", function \(\) \{ setCopy\(\); probe\(\); \}\)/);
  });

  it("navigator.onLine only selects the copy and never gates the probe", () => {
    // The probe function body contains no onLine check — a wrong hint must not
    // prevent the real test from running.
    const probeFn = SCRIPT.slice(SCRIPT.indexOf("function probe()"), SCRIPT.indexOf('window.addEventListener("online"'));
    expect(probeFn).not.toContain("onLine");
    // Both truthful states exist as copy.
    expect(SCRIPT).toContain("Service momentanément injoignable");
    expect(SCRIPT).toContain("Vous êtes hors ligne");
  });

  it("retry preserves the original destination (href=\"\" reloads the CURRENT url)", () => {
    expect(PAGE).toMatch(/href=""/);
    // The old detour that lost the deep link is gone.
    expect(PAGE).not.toMatch(/href="\/"/);
  });

  it("recovery is an inline script — no dependence on hydration chunks that are not precached", () => {
    expect(PAGE).toContain("dangerouslySetInnerHTML");
    expect(PAGE).not.toMatch(/"use client"/);
    expect(PAGE).not.toMatch(/from "react"/);
  });

  it("still honest, still no offline writes: nothing-saved copy intact", () => {
    expect(PAGE).toContain("Aucune modification n'a été enregistrée");
    // Comment-stripped: the header COMMENT legitimately says "no offline write
    // queue" — the recurring word-blacklist trap. What must not exist is the
    // CAPABILITY in code.
    const pageCode = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(pageCode).not.toMatch(/IndexedDB|localStorage|\bqueue\b/i);
  });
});
