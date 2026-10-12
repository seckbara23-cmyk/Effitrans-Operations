/**
 * EFF-STAGING-ISOLATION-02 — prove from OUTSIDE which database a deployment uses.
 * READ-ONLY: one HTTP GET, no writes, no credentials, nothing printed that is secret.
 * ---------------------------------------------------------------------------
 * The gap this closes. EFF-PR33-PREVIEW-DATA-ISOLATION-01 had to return
 * UNVERIFIED because a Preview's Supabase binding was invisible from outside:
 * previews are sealed by Deployment Protection and there were no Vercel
 * credentials to read the environment with. `/api/version` now reports a
 * non-secret fingerprint of its binding, so the question is answerable.
 *
 *   node scripts/gate/verify-deployment-binding.mjs <url> [--expect-isolated-from <url>]
 *
 * With one URL it prints that deployment's environment class, binding status
 * and fingerprint. With --expect-isolated-from it fetches BOTH and exits 1 if
 * they share a database — the check to run before promoting a Preview for
 * transactional UAT.
 *
 * A sealed preview answers with Vercel's SSO redirect rather than JSON; the
 * script says so plainly instead of guessing.
 */
const args = process.argv.slice(2);
const url = args[0];
const otherIdx = args.indexOf("--expect-isolated-from");
const other = otherIdx === -1 ? null : args[otherIdx + 1];

if (!url || url.startsWith("--")) {
  console.error("usage: node scripts/gate/verify-deployment-binding.mjs <url> [--expect-isolated-from <url>]");
  process.exit(2);
}

async function probe(base) {
  const target = `${base.replace(/\/+$/, "")}/api/version`;
  const res = await fetch(target, { redirect: "manual", headers: { "User-Agent": "effitrans-binding-probe" } });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    const sealed = loc.includes("vercel.com/sso-api");
    return {
      ok: false,
      why: sealed
        ? "sealed by Vercel Deployment Protection — sign in to Vercel, or run this from a context that can reach it"
        : `redirected to ${loc.split("?")[0]}`,
    };
  }
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const body = await res.json();
  if (!body || typeof body !== "object" || !body.db) {
    return { ok: false, why: "no `db` field — this deployment predates the binding report" };
  }
  return { ok: true, sha: body.sha, env: body.env, db: body.db };
}

function describe(label, p) {
  if (!p.ok) {
    console.log(`${label}: UNREADABLE — ${p.why}`);
    return;
  }
  const d = p.db;
  console.log(
    `${label}: env=${d.envClass} target=${d.target} ref=${d.refHint ?? "-"} fp=${d.refFingerprint ?? "-"} ` +
      `status=${d.status} verified=${d.verified} sha=${(p.sha ?? "").slice(0, 7)}`,
  );
}

const a = await probe(url);
describe("deployment", a);

if (!other) {
  if (!a.ok) process.exit(1);
  if (a.db.envClass !== "production" && a.db.status === "verified_production") {
    console.error("REFUSED: a non-production deployment is bound to the production project.");
    process.exit(1);
  }
  if (!a.db.verified) {
    console.warn("WARNING: binding not verified — PRODUCTION_SUPABASE_PROJECT_REF is probably unset on that deployment.");
  }
  process.exit(0);
}

const b = await probe(other);
describe("reference  ", b);
if (!a.ok || !b.ok) {
  console.error("Cannot compare: one of the two deployments is unreadable.");
  process.exit(1);
}
if (a.db.refFingerprint && a.db.refFingerprint === b.db.refFingerprint) {
  console.error("REFUSED: both deployments are bound to the SAME database. Transactional UAT would write real data.");
  process.exit(1);
}
console.log("OK — the two deployments are bound to different databases.");
