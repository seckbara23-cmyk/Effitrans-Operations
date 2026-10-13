/**
 * EFF-STAGING-ISOLATION-02 — refuse a forbidden database binding before a build.
 * ---------------------------------------------------------------------------
 * Runs as `prebuild` (so every `npm run build`, including Vercel's, is gated)
 * and as `predev` (so a developer cannot point their own machine at Production).
 * The decision lives in lib/env/project-binding.mjs — this script only supplies
 * the environment and the exit code.
 *
 *   node scripts/check-env-binding.mjs              # read process.env
 *   node scripts/check-env-binding.mjs --dotenv     # also read .env.local/.env
 *   node scripts/check-env-binding.mjs --json       # machine-readable verdict
 *
 * Exit 0 = allowed (verified, or unverifiable and not in strict mode).
 * Exit 1 = refused. Prints no key, no URL and no full project ref.
 */
import { readFileSync } from "node:fs";
import {
  bindingRefusalMessage,
  bindingSummary,
  evaluateBinding,
  isVerified,
} from "../lib/env/project-binding.mjs";

const args = process.argv.slice(2);
const useDotenv = args.includes("--dotenv");
const asJson = args.includes("--json");

/**
 * Minimal reader for the two files Next itself loads, in Next's precedence
 * (.env.local wins over .env). Deliberately tiny: it only needs the three keys
 * below, and a real dotenv dependency for a guard would be a poor trade.
 */
function fromDotenv(keys) {
  const out = {};
  for (const file of [".env", ".env.local"]) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      if (!keys.includes(m[1])) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  return out;
}

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "PRODUCTION_SUPABASE_PROJECT_REF", "ENV_BINDING_STRICT", "VERCEL_ENV"];
const file = useDotenv ? fromDotenv(KEYS) : {};
const pick = (k) => process.env[k] ?? file[k];

const verdict = evaluateBinding({
  supabaseUrl: pick("NEXT_PUBLIC_SUPABASE_URL"),
  vercelEnv: pick("VERCEL_ENV"),
  productionRef: pick("PRODUCTION_SUPABASE_PROJECT_REF"),
  strict: pick("ENV_BINDING_STRICT") === "true",
});

if (asJson) {
  const t = verdict.target;
  console.log(
    JSON.stringify({
      ok: verdict.ok,
      envClass: verdict.envClass,
      target: t.kind,
      status: verdict.status,
      verified: isVerified(verdict),
      reason: verdict.ok ? null : verdict.reason,
    }),
  );
} else {
  console.log(bindingSummary(verdict));
}

if (!verdict.ok) {
  console.error(bindingRefusalMessage(verdict));
  process.exit(1);
}
if (!isVerified(verdict) && !asJson) {
  console.warn(
    "[env-binding] isolation NOT verified — set PRODUCTION_SUPABASE_PROJECT_REF so this can be checked " +
      "(docs/production/staging-isolation-plan.md).",
  );
}
