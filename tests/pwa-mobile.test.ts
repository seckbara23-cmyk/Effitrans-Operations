/**
 * Phase 8.3 — PWA & mobile experience. The manifest is exercised directly (it is a pure
 * function); the SERVICE-WORKER CACHE POLICY — the security-critical piece — is pinned
 * structurally against the hand-written sw.js (auditable by construction: a tiny file with an
 * explicit allowlist). Shells, a11y hook, install lifecycle, network status and mobile
 * standards are verified structurally.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------- manifest ----
describe("manifest — installable, tenant-neutral, safe shortcuts", () => {
  const m = manifest();

  it("carries the installability essentials", () => {
    expect(m.name).toBe("Effitrans Operations Platform");
    expect(m.short_name).toBe("Effitrans");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("effitrans-operations");
    expect(m.categories).toEqual(["business", "productivity", "logistics"]);
  });
  it("ships the four required icons incl. maskable variants", () => {
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("192x192:maskable");
    expect(sizes).toContain("512x512:maskable");
  });
  it("orientation is 'any' — tablet landscape operation is first-class", () => {
    expect(m.orientation).toBe("any");
  });
  it("shortcuts are universally-safe entry routes only (auth re-checked server-side)", () => {
    const urls = (m.shortcuts ?? []).map((s) => s.url);
    expect(urls).toEqual(["/dashboard", "/files", "/portal"]);
  });
  it("is tenant-neutral: no session/tenant data can flow into a static manifest", () => {
    const src = code("../app/manifest.ts");
    expect(src).not.toMatch(/supabase|getCurrentUser|tenant|process\.env/i);
  });
  it("the real icon files exist and are PNGs", () => {
    for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
      const buf = readFileSync(fileURLToPath(new URL(`../public/icons/${f}`, import.meta.url)));
      expect(buf.slice(1, 4).toString(), f).toBe("PNG");
    }
  });
});

// ---------------------------------------------------------------- service worker policy ----
describe("service worker — the cache-security contract", () => {
  const sw = read("../public/sw.js");
  // sw.js contains no protocol URLs, so stripping every //-to-EOL is safe here.
  const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("never caches navigation (HTML) responses — offline serves only the precached fallback", () => {
    // The navigate branch must contain NO cache.put — fetch, catch, fallback only.
    const nav = swCode.slice(swCode.indexOf('mode === "navigate"'), swCode.indexOf("if (!cacheableStatic"));
    expect(nav).toContain("fetch(request)");
    expect(nav).not.toContain("cache.put");
    expect(nav).toContain("OFFLINE_URL");
  });
  it("cacheable set is an explicit same-origin allowlist: /_next/static, /icons, favicon — nothing else", () => {
    expect(sw).toContain('url.origin !== self.location.origin) return false');
    expect(sw).toContain('request.method !== "GET"') ;
    expect(sw).toContain('"/_next/static/"');
    expect(sw).toContain('"/icons/"');
    expect(sw).toContain('"/favicon.ico"');
    // No API, supabase, upload, AI, or auth path may EVER appear as cacheable.
    expect(swCode).not.toMatch(/\/api\/|supabase|copilot|storage|auth|upload/i);
  });
  it("precache is exactly the offline page + icons", () => {
    expect(sw).toMatch(/PRECACHE = \[OFFLINE_URL, "\/icons\/icon-192\.png", "\/icons\/icon-512\.png", "\/icons\/apple-touch-icon\.png"\]/);
  });
  it("does NOT skipWaiting on install — activation only via the user-consented message", () => {
    const install = swCode.slice(swCode.indexOf('"install"'), swCode.indexOf('"activate"'));
    expect(install).not.toContain("skipWaiting");
    expect(swCode).toMatch(/event\.data === "SKIP_WAITING"\) self\.skipWaiting\(\)/);
  });
  it("activate retires old cache versions", () => {
    expect(swCode).toMatch(/names\.filter\(\(n\) => n !== STATIC_CACHE\)\.map\(\(n\) => caches\.delete\(n\)\)/);
  });
});

// ---------------------------------------------------------------- offline page ----
describe("offline fallback — public, honest, static", () => {
  const src = read("../app/offline/page.tsx");
  it("says offline / data unavailable / nothing saved / reconnect", () => {
    expect(src).toContain("hors ligne");
    expect(src).toMatch(/ne sont pas disponibles/);
    expect(src).toContain("Aucune modification n'a été enregistrée");
    expect(src).toContain("Reconnectez-vous");
  });
  it("reads no data and requires no auth (static + middleware-public)", () => {
    expect(code("../app/offline/page.tsx")).not.toMatch(/supabase|getCurrentUser|require|fetch\(/);
    expect(read("../lib/supabase/middleware.ts")).toContain('pathname === "/offline"');
  });
  it("the PWA static surface bypasses the middleware entirely (live 307 found by the sweep)", () => {
    // A session-refresh redirect on manifest/sw/icons breaks installability + registration.
    const mw = read("../middleware.ts");
    // The raw file carries the escaped regex source (backslash-backslash-dot).
    expect(mw).toContain("sw\\\\.js");
    expect(mw).toContain("manifest\\\\.webmanifest");
    expect(mw).toContain("icons/");
  });
});

// ---------------------------------------------------------------- PWA runtime ----
describe("PWA runtime — gated registration, safe update, polite install, honest network", () => {
  const src = read("../components/pwa/pwa-provider.tsx");

  it("service worker registers ONLY behind NEXT_PUBLIC_PWA_ENABLED (Preview-first rollout)", () => {
    expect(src).toContain('process.env.NEXT_PUBLIC_PWA_ENABLED !== "true") return');
  });
  it("update banner is click-to-activate with a single guarded reload (no loop, no forced refresh)", () => {
    expect(src).toContain('postMessage("SKIP_WAITING")');
    expect(src).toMatch(/if \(reloaded\.current\) return;\s*reloaded\.current = true;/);
    expect(src).toContain("Nouvelle version disponible");
  });
  it("exposes the build identifier in the update UI via the secret-free version endpoint", () => {
    expect(src).toContain('fetch("/api/version")');
  });
  it("compact install banner reads shared state — no competing install logic in this file", () => {
    expect(src).toContain("usePwaInstall");
    expect(src).toContain("pwa.showLargePrompt");
    expect(src).toContain("pwa.dismissLargePrompt");
    // The old full-width, always-there install bar and its own listeners must be GONE —
    // beforeinstallprompt/localStorage now live only in pwa-install-context.tsx.
    expect(src).not.toContain("beforeinstallprompt");
    expect(src).not.toContain("localStorage");
  });
  it("treats navigator.onLine as a hint — real request errors are never suppressed", () => {
    expect(src).toMatch(/hint/i);
    expect(src).not.toMatch(/preventDefault\(\).*fetch|intercept/);
  });
  it("is mounted in the root layout outside AppShell (every surface gets it)", () => {
    expect(read("../app/layout.tsx")).toContain("<PwaProvider />");
  });
});

// ---------------------------------------------------------------- metadata ----
describe("mobile metadata — viewport, theme, apple, format detection", () => {
  const src = read("../app/layout.tsx");
  it("exports viewport with safe-area support and brand theme color", () => {
    expect(src).toContain('viewportFit: "cover"');
    expect(src).toContain('themeColor: "#0F766E"');
  });
  it("declares apple web-app capability and disables phone-number mangling", () => {
    expect(src).toContain("appleWebApp");
    expect(src).toContain("formatDetection: { telephone: false }");
    expect(src).toContain("apple-touch-icon.png");
  });
});

// ---------------------------------------------------------------- shells & a11y ----
describe("drawers — ONE shared a11y implementation, both shells", () => {
  const hook = read("../lib/ui/use-dialog-a11y.ts");

  it("the shared hook implements trap + Escape + restore + scroll lock", () => {
    expect(hook).toMatch(/key === "Escape"/);
    expect(hook).toMatch(/key !== "Tab"/);
    expect(hook).toContain('document.body.style.overflow = "hidden"');
    expect(hook).toMatch(/restoreRef\.current\?\.focus/);
  });
  it("tenant mobile drawer: dialog semantics + route-change close via the shared hook", () => {
    const s = read("../components/shell/sidebar.tsx");
    expect(s).toContain("useDialogA11y(open, onClose)");
    expect(s).toMatch(/role="dialog"[\s\S]{0,80}aria-modal="true"/);
    expect(s).toMatch(/pathname !== lastPath\.current/);
  });
  it("platform shell now has a mobile drawer (was: nav unreachable <1024px) with the same semantics", () => {
    const p = read("../components/platform/platform-shell.tsx");
    expect(p).toContain("useDialogA11y(menuOpen");
    expect(p).toMatch(/aria-label="Ouvrir le menu"/);
    expect(p).toMatch(/role="dialog"[\s\S]{0,120}aria-label="Navigation plateforme"/);
    expect(p).toMatch(/min-h-\[44px\]/);
  });
  it("no navigation destinations were duplicated (both drawers render the existing nav data)", () => {
    const p = code("../components/platform/platform-shell.tsx");
    expect(p).toContain("visiblePlatformNav(permissions)");
    expect((p.match(/visiblePlatformNav\(/g) ?? []).length).toBe(1); // one source, rendered twice
  });
});

// ---------------------------------------------------------------- mobile standards ----
describe("mobile standards — global, not per-form", () => {
  const css = read("../app/globals.css");
  it("form controls are 16px below 640px (kills iOS zoom-on-focus app-wide)", () => {
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]{0,200}font-size: 1rem/);
  });
  it("reduced motion is honored globally", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
  it("safe-area insets are applied to the shells and PWA banners", () => {
    for (const f of ["../components/platform/platform-shell.tsx", "../components/portal/portal-shell.tsx", "../components/pwa/pwa-provider.tsx"]) {
      expect(read(f), f).toMatch(/safe-area-inset/);
    }
  });
  it("previously-clipped tables now scroll horizontally instead of clipping", () => {
    expect(read("../app/settings/audit/page.tsx")).toContain("overflow-x-auto");
    expect(read("../app/portal/(app)/invoices/[id]/page.tsx")).toContain("overflow-x-auto");
  });
  it("maps use responsive breakpoint heights instead of fixed inline pixels", () => {
    expect(read("../components/shipping/shipment-map.tsx")).toContain("h-[260px] w-full sm:h-[340px]");
    expect(read("../components/portal/leaflet-map.tsx")).toContain("h-[240px] w-full sm:h-[300px]");
  });
});
