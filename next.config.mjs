/** @type {import('next').NextConfig} */

/**
 * Baseline security response headers (Phase 1.18 — C2). Applied to every route.
 * These are passive headers on our own HTML responses; they do NOT affect the
 * outbound fetches to Supabase (cross-origin XHR is unaffected by these) nor the
 * Google OAuth redirect flow (top-level navigations, allowed by SAMEORIGIN).
 *
 * - X-Frame-Options: SAMEORIGIN  -> clickjacking protection (app is never framed
 *   by third parties; the portal is a top-level surface).
 * - X-Content-Type-Options: nosniff -> stop MIME sniffing.
 * - Referrer-Policy: strict-origin-when-cross-origin -> don't leak full URLs
 *   (which can carry ids) to external sites.
 * - Permissions-Policy -> disable powerful features the app never uses.
 * - Strict-Transport-Security (HSTS) -> force HTTPS. Honored only over HTTPS
 *   (ignored on http://localhost), so it is safe in local dev.
 *
 * Content-Security-Policy is intentionally NOT set here: a strict CSP requires
 * per-request nonces for Next.js's inline bootstrap/hydration scripts and an
 * allow-list for the Supabase origins; rolling it out blindly would break
 * hydration. Tracked as a follow-up (report-only first). See
 * docs/phase-1.18-operational-hardening.md §C2.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // The searchable-PDF parser (pdf-parse, Phase 7.4B) is a pure-Node library used only from
  // a server-only adapter. Keep it external so webpack requires it at runtime from node_modules
  // (it bundles its own pdf.js and must not be traced into a client/edge bundle).
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
