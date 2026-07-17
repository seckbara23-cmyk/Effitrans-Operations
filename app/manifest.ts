/**
 * PWA web-app manifest (Phase 8.3) — Next.js App Router native manifest.
 * ---------------------------------------------------------------------------
 * Served at /manifest.webmanifest and linked automatically by Next. TENANT-NEUTRAL by
 * construction: this is a static file identical for every visitor — it must never carry a
 * tenant name, brand value, or anything session-derived (install metadata reveals no
 * confidential detail).
 *
 * start_url is "/" — the root redirects unauthenticated users to /login and authenticated
 * users to their workspace (middleware + landing logic), so the app always ENTERS SAFELY
 * regardless of session state. Shortcuts list only universally-safe destinations: each one
 * re-checks authorization server-side on navigation (a shortcut is a bookmark, not a grant);
 * manifest shortcuts cannot be permission-aware, so only routes every identity class can
 * safely LAND on (auth-gated pages redirect to the right login) are listed.
 *
 * display "standalone" + orientation "any": tablet landscape operation is a first-class
 * logistics workflow (portrait-primary would harm it).
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "effitrans-operations",
    name: "Effitrans Operations Platform",
    short_name: "Effitrans",
    description:
      "Plateforme intégrée des opérations de transit, logistique et douane — dossiers, maritime, aérien, route, documents et portail client.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F6F4EF", // sand-100 — the app's canvas
    theme_color: "#0F766E", // Effitrans teal (brand green fallback of the brand profile)
    lang: "fr",
    categories: ["business", "productivity", "logistics"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Tableau de bord", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Dossiers", url: "/files", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Portail client", url: "/portal", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
