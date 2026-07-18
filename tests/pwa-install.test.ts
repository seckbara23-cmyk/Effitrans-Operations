/**
 * Phase 8.5 — compact PWA install experience (replaces the Phase 8.3 full-width banner).
 * Pure decision logic (lib/pwa/install-logic.ts) is unit-tested directly. The client-only
 * pieces (context, banner, header action, iOS dialog) touch the DOM/React state and this
 * repo's Vitest environment is "node" (no jsdom) — those are verified structurally, same
 * convention as the rest of tests/pwa-mobile.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PWA_INSTALL_DISMISS_KEY,
  INSTALL_DISMISS_DURATION_MS,
  isIosDevice,
  isIosSafariBrowser,
  computeStandalone,
  parseDismissedAt,
  isDismissalActive,
} from "@/lib/pwa/install-logic";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const EDGE_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 EdgA/124.0";
const DESKTOP_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1";
const IPHONE_EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/125.0 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI_MACUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// ---------------------------------------------------------------- pure logic ----
describe("install-logic — pure, no DOM (namespaced, non-identifying storage key)", () => {
  it("the dismissal key is namespaced and carries no tenant/user/session identifier", () => {
    expect(PWA_INSTALL_DISMISS_KEY).toBe("effitrans:pwa-install-prompt-dismissed");
    expect(PWA_INSTALL_DISMISS_KEY).not.toMatch(/tenant|user|email|session|token/i);
  });
  it("suppression window is ~30 days", () => {
    expect(INSTALL_DISMISS_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("detects iPhone/iPad/iPod from the UA", () => {
    expect(isIosDevice(IPHONE_SAFARI)).toBe(true);
    expect(isIosDevice(CHROME_ANDROID)).toBe(false);
    expect(isIosDevice(DESKTOP_FIREFOX)).toBe(false);
  });
  it("detects iPadOS 13+ reporting as Macintosh via the touch-capable-Mac heuristic", () => {
    expect(isIosDevice(IPAD_SAFARI_MACUA, true)).toBe(true);
    expect(isIosDevice(IPAD_SAFARI_MACUA, false)).toBe(false); // a real desktop Mac: no touch points
  });

  it("iOS Safari is installable — the only iOS browser with Add to Home Screen", () => {
    expect(isIosSafariBrowser(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafariBrowser(IPAD_SAFARI_MACUA, true)).toBe(true);
  });
  it("never claims Chrome/Edge/Firefox on iOS can install — they are WebKit wrappers", () => {
    expect(isIosSafariBrowser(IPHONE_CHROME)).toBe(false);
    expect(isIosSafariBrowser(IPHONE_EDGE)).toBe(false);
    expect(isIosSafariBrowser(IPHONE_FIREFOX)).toBe(false);
  });
  it("Android Chrome and Android Edge are not treated as iOS", () => {
    expect(isIosSafariBrowser(CHROME_ANDROID)).toBe(false);
    expect(isIosSafariBrowser(EDGE_ANDROID)).toBe(false);
  });

  it("standalone is true from either the media query or navigator.standalone", () => {
    expect(computeStandalone(true, undefined)).toBe(true);
    expect(computeStandalone(false, true)).toBe(true);
    expect(computeStandalone(false, false)).toBe(false);
    expect(computeStandalone(false, undefined)).toBe(false);
  });

  it("parses a valid dismissal timestamp and rejects garbage/missing values", () => {
    expect(parseDismissedAt(null)).toBeNull();
    expect(parseDismissedAt("")).toBeNull();
    expect(parseDismissedAt("not-a-number")).toBeNull();
    expect(parseDismissedAt("-5")).toBeNull();
    expect(parseDismissedAt("1700000000000")).toBe(1700000000000);
  });

  it("a fresh dismissal stays active; one older than 30 days expires", () => {
    const now = 1_700_000_000_000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    expect(isDismissalActive(oneDayAgo, now)).toBe(true);
    expect(isDismissalActive(thirtyOneDaysAgo, now)).toBe(false);
    expect(isDismissalActive(null, now)).toBe(false); // never dismissed ⇒ not "active"
  });
});

// ---------------------------------------------------------------- shared install state ----
describe("PwaInstallProvider — single source of truth, dark by default", () => {
  const src = read("../components/pwa/pwa-install-context.tsx");

  it("is gated by the same flag as the service worker — no listeners when off", () => {
    expect(src).toContain('process.env.NEXT_PUBLIC_PWA_ENABLED !== "true") return');
  });

  it("Android/desktop: captures beforeinstallprompt, prevents the browser's own mini-infobar", () => {
    expect(src).toContain('addEventListener("beforeinstallprompt", onPrompt)');
    expect(src).toMatch(/onPrompt = \(e: Event\) => \{\s*e\.preventDefault\(\)/);
  });

  it("native prompt() is called only from install(), never from the mount effect", () => {
    const mountEffect = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("dismissLargePrompt = useCallback"));
    expect(mountEffect).not.toContain(".prompt()");
    const installFn = src.slice(src.indexOf("const install = useCallback"), src.indexOf("const available ="));
    expect(installFn).toContain("await deferred.prompt()");
  });

  it("clears the spent prompt event after use regardless of accept/reject (finally)", () => {
    expect(src).toMatch(/finally \{[\s\S]{0,400}setDeferred\(null\);/);
  });

  it("rejection is recoverable: the beforeinstallprompt listener is never torn down after a use", () => {
    // The ONLY removeEventListener for beforeinstallprompt is the effect's own cleanup
    // (unmount), not something install() or userChoice triggers.
    const removals = src.match(/removeEventListener\("beforeinstallprompt"/g) ?? [];
    expect(removals.length).toBe(1);
  });

  it("appinstalled marks installed and clears any pending prompt — controls hide immediately", () => {
    expect(src).toMatch(/onInstalled = \(\) => \{\s*setInstalled\(true\);\s*setDeferred\(null\);\s*\}/);
    expect(src).toContain('addEventListener("appinstalled", onInstalled)');
  });

  it("standalone display mode / navigator.standalone hide controls from first paint", () => {
    expect(src).toContain("display-mode: standalone");
    expect(src).toContain("navigator as { standalone?: boolean }");
    expect(src).toContain("computeStandalone(");
  });

  it("the compact control's availability does NOT depend on the large prompt's dismissal", () => {
    expect(src).toMatch(/const available = !installed && \(Boolean\(deferred\) \|\| isIos\);/);
  });

  it("the large prompt additionally requires the dismissal window to have expired", () => {
    expect(src).toMatch(/const showLargePrompt = available && !isDismissalActive\(/);
  });

  it("dismissing the large prompt only ever writes a timestamp — never touches deferred/available", () => {
    const dismissFn = src.slice(src.indexOf("const dismissLargePrompt"), src.indexOf("const closeIosDialog"));
    expect(dismissFn).toContain("localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(now))");
    expect(dismissFn).not.toContain("setDeferred");
    expect(dismissFn).not.toContain("setInstalled");
  });

  it("stores ONLY a numeric timestamp under the namespaced key — no tenant/user/session value", () => {
    const setItemCalls = src.match(/localStorage\.setItem\([^)]*\)/g) ?? [];
    expect(setItemCalls.length).toBeGreaterThan(0);
    for (const call of setItemCalls) {
      expect(call).toContain("PWA_INSTALL_DISMISS_KEY");
      expect(call).not.toMatch(/tenant|email|user\.?id|session|token/i);
    }
  });

  it("iOS gets an instructions dialog instead of a native prompt — no simulated browser UI", () => {
    expect(src).toMatch(/if \(isIos\) \{\s*setIosDialogOpen\(true\);\s*return;\s*\}/);
  });
});

// ---------------------------------------------------------------- compact header action ----
describe("PwaInstallAction — compact, accessible, never a broken action", () => {
  const src = read("../components/pwa/pwa-install-action.tsx");

  it("renders nothing when installation is not available (no disabled-looking button)", () => {
    expect(src).toMatch(/if \(!pwa\.available\) return null;/);
  });
  it("is a semantic <button>, not a bare icon or a link masquerading as a button", () => {
    expect(src).toMatch(/<button[\s\S]{0,40}type="button"/);
    expect(src).toContain("aria-label=");
  });
  it("carries the French label — full form on wider screens, compact on narrow", () => {
    expect(src).toContain("Installer");
    expect(src).toMatch(/l&apos;application/);
    expect(src).toMatch(/hidden sm:inline/);
  });
  it("does not use an emoji for the install glyph — the in-house icon set only", () => {
    expect(src).toContain("IconInstall");
    expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
  it("triggers install only from a click handler (explicit user gesture)", () => {
    expect(src).toMatch(/onClick=\{\(\) => void pwa\.install\(\)\}/);
  });
  it("meets the 44px touch-target minimum", () => {
    expect(src).toContain("min-h-[44px]");
  });
});

// ---------------------------------------------------------------- iOS instructions dialog ----
describe("PwaInstallIosDialog — accessible, Safari-specific instructions", () => {
  const src = read("../components/pwa/pwa-install-ios-dialog.tsx");

  it("uses the shared dialog a11y hook — no bespoke focus/escape handling", () => {
    expect(src).toContain("useDialogA11y(pwa.iosDialogOpen, pwa.closeIosDialog)");
  });
  it("has an accessible title, description, and a semantic close control", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-labelledby="pwa-ios-install-title"/);
    expect(src).toMatch(/aria-describedby="pwa-ios-install-desc"/);
    expect(src).toMatch(/<button[\s\S]{0,60}onClick=\{pwa\.closeIosDialog\}/);
  });
  it("gives the exact required French instruction text", () => {
    const flat = src.replace(/\s+/g, " ");
    expect(flat).toContain("Dans Safari, touchez");
    expect(flat).toContain("Partager");
    expect(flat).toContain("puis");
    expect(flat).toContain("Ajouter à l&apos;écran d&apos;accueil");
  });
  it("renders nothing when the dialog isn't open", () => {
    expect(src).toMatch(/if \(!pwa\.iosDialogOpen\) return null;/);
  });
});

// ---------------------------------------------------------------- topbar placement ----
describe("Topbar — compact install action placed per the responsive-shell audit", () => {
  const src = read("../components/shell/topbar.tsx");

  it("renders PwaInstallAction (Topbar is shared by desktop and mobile — one placement covers both)", () => {
    expect(src).toContain("<PwaInstallAction");
    expect(src).toContain('from "@/components/pwa/pwa-install-action"');
  });
  it("is NOT a persistent floating button — it sits inside the existing header button cluster", () => {
    expect(src).not.toMatch(/fixed[\s\S]{0,40}PwaInstallAction/);
  });
});

// ---------------------------------------------------------------- root wiring ----
describe("app/layout.tsx — one shared provider, one dialog instance", () => {
  const src = read("../app/layout.tsx");

  it("wraps the tree in PwaInstallProvider so Topbar and PwaProvider share one state", () => {
    expect(src).toContain("<PwaInstallProvider>");
    expect(src).toMatch(/<PwaInstallProvider>[\s\S]*<AppShell[\s\S]*<PwaProvider \/>[\s\S]*<\/PwaInstallProvider>/);
  });
  it("mounts exactly one PwaInstallIosDialog regardless of how many triggers exist", () => {
    expect((src.match(/<PwaInstallIosDialog \/>/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------- compact first-visit banner ----
describe("PwaProvider — compact first-visit banner supersedes the old full-width bar", () => {
  const src = read("../components/pwa/pwa-provider.tsx");

  it("no longer owns beforeinstallprompt/localStorage — reads shared context instead", () => {
    expect(src).toContain('from "./pwa-install-context"');
    expect(src).not.toContain("beforeinstallprompt");
    expect(src).not.toContain("localStorage");
  });
  it("shows only on showLargePrompt, and never while the update banner is visible", () => {
    expect(src).toMatch(/!sw\.waiting && pwa\.showLargePrompt/);
  });
  it("is compact (a corner card), not a full-width bar covering the page", () => {
    expect(src).toMatch(/bottom-4 right-4[\s\S]{0,20}max-w-\[20rem\]/);
  });
  it("offers Installer and Plus tard, matching the required French copy", () => {
    expect(src).toContain("Plus tard");
    expect(src).toMatch(/>\s*Installer\s*</);
    expect(src).toContain("pwa.dismissLargePrompt");
  });
});
