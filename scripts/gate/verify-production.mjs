/**
 * Phase 8.0B — production gate verification (C1 + part of C3). Plain Node, no dependencies.
 * ---------------------------------------------------------------------------
 * Runs the mechanical part of the C1 acceptance against a LIVE deployment:
 *   1. /api/version — the served git SHA (fails if it differs from the expected SHA);
 *   2. route sweep — public pages return 200, protected pages redirect to the correct
 *      login (staff vs portal), nothing 404s, no redirect loop;
 *   3. security headers present (HSTS, nosniff, X-Frame-Options);
 *   4. C3 helper — extracts the Supabase PROJECT REF the deployment is wired to (the ref is
 *      public by design: every visitor's browser receives it) so it can be compared against
 *      the refs used by Preview and local dev. Refs must DIFFER between production and
 *      non-production for gate C3.
 *
 * Usage:
 *   node scripts/gate/verify-production.mjs https://effitrans-operations.vercel.app [expectedSha]
 *
 * Exit code 0 = all checks pass; 1 = any failure (evidence lines print either way — paste
 * them into docs/production/gate-closure.md §C1).
 */

const base = process.argv[2];
const expectedSha = (process.argv[3] ?? "").trim();
if (!base) {
  console.error("usage: node scripts/gate/verify-production.mjs <base-url> [expectedSha]");
  process.exit(1);
}
const origin = base.replace(/\/+$/, "");

let failures = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
const bad = (label, detail = "") => { failures++; console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`); };

/** fetch without following redirects, with a hard timeout */
async function probe(path) {
  const res = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  return res;
}

// Routes and what a healthy, freshly-opened production must answer to an ANONYMOUS client.
const PUBLIC_200 = ["/login", "/portal/login", "/api/version"];
const STAFF_PROTECTED = [
  "/dashboard", "/dashboard/executive", "/departments/transport", "/customs/intelligence",
  "/shipping", "/shipping/shipments", "/shipping/containers", "/shipping/vessels",
  "/shipping/voyages", "/shipping/ports", "/shipping/carriers", "/shipping/alerts",
  "/air", "/air/shipments", "/air/airlines", "/air/airports", "/air/flights", "/air/ulds",
  "/air/alerts", "/brand-center", "/platform", "/platform/operations", "/files", "/clients",
];
const PORTAL_PROTECTED = ["/portal", "/portal/documents", "/portal/invoices", "/portal/notifications"];

console.log(`\n=== Gate C1 verification against ${origin} ===\n`);

// 1. Version / SHA attestation -------------------------------------------------
let servedSha = null;
try {
  const res = await probe("/api/version");
  if (res.status === 200) {
    const v = await res.json();
    servedSha = v.sha ?? null;
    if (!v.hosted) bad("version: hosted", "endpoint reachable but not a Vercel deployment?");
    else ok("version endpoint", `sha=${servedSha ?? "null"} env=${v.env}`);
    if (expectedSha) {
      if (servedSha && servedSha.startsWith(expectedSha)) ok("SERVED SHA matches expected", expectedSha);
      else bad("SERVED SHA MISMATCH", `expected ${expectedSha}, serving ${servedSha ?? "null"} — stale deploy?`);
    } else {
      console.log("  NOTE  no expectedSha argument given — record the served SHA above as evidence");
    }
  } else if (res.status === 302 || res.status === 307) {
    const loc = res.headers.get("location") ?? "";
    if (loc.includes("vercel.com/sso-api")) bad("deployment still SEALED", "Deployment Protection is still covering production (gate F-1 not yet flipped)");
    else bad("/api/version redirected", loc);
  } else bad(`/api/version -> ${res.status}`, "endpoint missing? deploy the gate-tooling commit first");
} catch (e) {
  bad("/api/version unreachable", String(e?.message ?? e));
}

// 2. Public pages --------------------------------------------------------------
for (const path of PUBLIC_200) {
  try {
    const res = await probe(path);
    if (res.status === 200) ok(`${path} -> 200`);
    else if ([301, 302, 307, 308].includes(res.status) && (res.headers.get("location") ?? "").includes("sso-api")) bad(`${path} sealed`, "protection wall");
    else bad(`${path} -> ${res.status}`, "expected 200");
  } catch (e) { bad(`${path} unreachable`, String(e?.message ?? e)); }
}

// 3. Protected pages: anonymous -> redirect to the CORRECT login, never 404/500/loop ----
async function expectRedirect(path, wantLogin) {
  try {
    const res = await probe(path);
    if (res.status === 404) return bad(`${path} -> 404`, "route missing — stale deploy?");
    if (res.status >= 500) return bad(`${path} -> ${res.status}`, "server error");
    if (![301, 302, 307, 308].includes(res.status)) return bad(`${path} -> ${res.status}`, `expected redirect to ${wantLogin}`);
    const loc = res.headers.get("location") ?? "";
    const target = new URL(loc, origin).pathname;
    if (target === wantLogin) return ok(`${path} -> ${wantLogin}`);
    if (loc.includes("sso-api")) return bad(`${path} sealed`, "protection wall");
    return bad(`${path} redirects to ${target}`, `expected ${wantLogin}`);
  } catch (e) { bad(`${path} unreachable`, String(e?.message ?? e)); }
}
for (const p of STAFF_PROTECTED) await expectRedirect(p, "/login");
for (const p of PORTAL_PROTECTED) await expectRedirect(p, "/portal/login");

// 4. Uniform 404 on an unknown public card token --------------------------------
try {
  const res = await probe("/card/does-not-exist-gate-check");
  if (res.status === 404) ok("/card/{unknown} -> uniform 404");
  else bad(`/card/{unknown} -> ${res.status}`, "expected uniform 404");
} catch (e) { bad("/card probe unreachable", String(e?.message ?? e)); }

// 5. Security headers ------------------------------------------------------------
try {
  const res = await probe("/login");
  const need = ["strict-transport-security", "x-content-type-options", "x-frame-options"];
  for (const h of need) {
    if (res.headers.get(h)) ok(`header ${h}`, res.headers.get(h));
    else bad(`header ${h} missing`);
  }
} catch (e) { bad("header probe unreachable", String(e?.message ?? e)); }

// 6. C3 helper: which Supabase project is this deployment wired to? ---------------
// The project ref is public by design (every browser receives it in the client env);
// printing it leaks nothing. Compare: production ref MUST differ from Preview/local refs.
try {
  const res = await fetch(origin + "/login", { signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const refs = new Set([...html.matchAll(/https:\/\/([a-z0-9]{16,24})\.supabase\.co/g)].map((m) => m[1]));
  if (refs.size === 0) {
    // env may be inlined in a linked chunk rather than the HTML — fetch first script chunks
    const chunks = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]).slice(0, 8);
    for (const c of chunks) {
      const js = await (await fetch(origin + c, { signal: AbortSignal.timeout(15000) })).text();
      for (const m of js.matchAll(/https:\/\/([a-z0-9]{16,24})\.supabase\.co/g)) refs.add(m[1]);
      if (refs.size) break;
    }
  }
  if (refs.size === 1) ok("C3: Supabase project ref in use", [...refs][0]);
  else if (refs.size > 1) bad("C3: MULTIPLE Supabase refs found", [...refs].join(", "));
  else console.log("  NOTE  C3: no Supabase ref extractable from public assets — check the Vercel env settings directly");
} catch (e) { console.log(`  NOTE  C3 ref extraction failed (${String(e?.message ?? e)}) — check env settings directly`); }

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
