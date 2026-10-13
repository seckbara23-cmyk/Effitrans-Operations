/**
 * EFF-STAGING-ISOLATION-02 — which database is this deployment allowed to touch?
 * ---------------------------------------------------------------------------
 * PURE. No I/O, no `process.env`, no node builtins — so the SAME logic is used
 * by the application (TypeScript, via `allowJs`), by `next.config.mjs` at build
 * time, and by the operator scripts. One rule, three call sites, no copies.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * EFF-PR33-PREVIEW-DATA-ISOLATION-01 found that Vercel Preview deployments and
 * Production resolve to the SAME Supabase project: one Vercel project serves
 * both, no Supabase branching is configured, and a preview build was directly
 * observed baking the production project ref. A preview therefore reads and
 * writes production data with the service-role key, which bypasses RLS
 * entirely. Audit item F-6 has been open since Phase 8.0A.
 *
 * Configuration alone cannot fix that, because configuration is what produced
 * it. So the application decides for itself whether the binding it was handed
 * is one it may use.
 *
 * ===========================================================================
 * THE RULE
 * ===========================================================================
 *   * a NON-PRODUCTION deployment bound to the production project is REFUSED;
 *   * a PRODUCTION deployment bound to anything else is REFUSED — serving
 *     staging data to real customers is the same class of accident;
 *   * a LOCAL database (127.0.0.1 and friends) is always fine: it cannot be
 *     production by construction;
 *   * NOTHING configured is fine and silent-free: CI builds with no Supabase
 *     variables at all (`lib/env.ts` is not imported at build time), and that
 *     must keep working.
 *
 * ===========================================================================
 * WHY THE UNVERIFIABLE CASES WARN INSTEAD OF REFUSING
 * ===========================================================================
 * Until `PRODUCTION_SUPABASE_PROJECT_REF` is installed there is nothing to
 * compare against, and a guard that refused everything would take Production
 * down the moment it shipped. Those cases return `ok: true` with a status that
 * is NOT "verified", which the build log prints and `/api/version` reports —
 * so "we cannot prove isolation" is visible rather than mistaken for "isolated".
 * Once the expectation is configured the guard is fully closed, and
 * `ENV_BINDING_STRICT=true` turns every unverified status into a refusal
 * without a code change — including a binding that is simply ABSENT, because
 * strict mode means "require positive proof", and an absent binding proves
 * nothing. Strict mode only ever TIGHTENS: there is deliberately no flag that
 * permits a preview to reach production.
 *
 * The three states strict mode refuses, and nothing else:
 *   unconfigured            — no Supabase URL at all (CI's build, an unset deployment)
 *   unverified_no_expectation — PRODUCTION_SUPABASE_PROJECT_REF is not installed
 *   unverified_host         — a host whose project cannot be identified
 * A loopback target stays allowed under strict mode: it IS proof, since a
 * developer's own stack cannot be production.
 */

/** Hosts that can only ever be a developer's own stack. */
export const LOCAL_DB_HOSTS = Object.freeze([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
  "kong", // the supabase-cli docker network alias
]);

/**
 * @typedef {"production" | "preview" | "development"} EnvClass
 * @typedef {{ kind: "unconfigured" }
 *   | { kind: "local", host: string }
 *   | { kind: "cloud", ref: string, host: string }
 *   | { kind: "unknown", host: string }} BindingTarget
 * @typedef {"verified_production" | "verified_isolated" | "local"
 *   | "unconfigured" | "unverified_no_expectation" | "unverified_host"} BindingStatus
 * @typedef {{ ok: true, status: BindingStatus, envClass: EnvClass, target: BindingTarget }
 *   | { ok: false, reason: BindingRefusal, status: BindingStatus, envClass: EnvClass, target: BindingTarget }} BindingVerdict
 * @typedef {"non_production_bound_to_production_project"
 *   | "production_bound_to_foreign_project"
 *   | "unverified_binding_in_strict_mode"} BindingRefusal
 */

/**
 * Vercel sets VERCEL_ENV to production | preview | development. Anything else —
 * including unset, which is CI and a plain local run — is treated as
 * development: the class with the least privilege, never production.
 *
 * @param {string | undefined | null} vercelEnv
 * @returns {EnvClass}
 */
export function classifyEnvironment(vercelEnv) {
  const v = typeof vercelEnv === "string" ? vercelEnv.trim().toLowerCase() : "";
  if (v === "production") return "production";
  if (v === "preview") return "preview";
  return "development";
}

/**
 * What does this Supabase URL point at? Hosted projects are
 * `https://<ref>.supabase.co`; a local stack is a loopback host; anything else
 * (a self-hosted gateway, a custom domain) is honestly reported as unknown
 * rather than guessed at.
 *
 * @param {string | undefined | null} supabaseUrl
 * @returns {BindingTarget}
 */
export function classifyTarget(supabaseUrl) {
  const raw = typeof supabaseUrl === "string" ? supabaseUrl.trim() : "";
  if (raw === "") return { kind: "unconfigured" };
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return { kind: "unknown", host: "" };
  }
  if (host === "") return { kind: "unknown", host: "" };
  if (LOCAL_DB_HOSTS.includes(host)) return { kind: "local", host };
  const m = /^([a-z0-9]{16,40})\.supabase\.(co|in|net)$/.exec(host);
  if (m) return { kind: "cloud", ref: m[1], host };
  return { kind: "unknown", host };
}

/** A project ref as configured: trimmed, lower-cased, or null when absent. */
function normalizeRef(ref) {
  const v = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  return v === "" ? null : v;
}

/**
 * Decide whether this deployment may use the database it was handed.
 *
 * @param {{ supabaseUrl?: string | null, vercelEnv?: string | null,
 *           productionRef?: string | null, strict?: boolean }} input
 * @returns {BindingVerdict}
 */
export function evaluateBinding(input) {
  const envClass = classifyEnvironment(input.vercelEnv);
  const target = classifyTarget(input.supabaseUrl);
  const productionRef = normalizeRef(input.productionRef);
  const strict = input.strict === true;

  /** @param {BindingStatus} status */
  const unverified = (status) =>
    strict
      ? { ok: /** @type {false} */ (false), reason: /** @type {BindingRefusal} */ ("unverified_binding_in_strict_mode"), status, envClass, target }
      : { ok: /** @type {true} */ (true), status, envClass, target };

  // Nothing is bound at all: the CI build, which carries no Supabase variables
  // whatsoever, or a deployment nobody has configured yet — which the app
  // already renders as « Configuration requise. » rather than pretending to
  // work. That is not a FORBIDDEN binding, so the default posture allows it;
  // but it is not PROOF of an isolated one either, and strict mode means
  // "require positive proof", so strict refuses it too.
  if (target.kind === "unconfigured") return unverified("unconfigured");

  // A developer's own stack can never be production.
  if (target.kind === "local") return { ok: true, status: "local", envClass, target };

  // No expectation installed yet — the state this guard ships in. Reported, not
  // enforced, so Production keeps working until the operator configures it.
  if (productionRef === null) return unverified("unverified_no_expectation");

  if (target.kind === "cloud") {
    const isProductionProject = target.ref === productionRef;
    if (envClass === "production") {
      return isProductionProject
        ? { ok: true, status: "verified_production", envClass, target }
        : { ok: false, reason: "production_bound_to_foreign_project", status: "verified_isolated", envClass, target };
    }
    return isProductionProject
      ? { ok: false, reason: "non_production_bound_to_production_project", status: "verified_production", envClass, target }
      : { ok: true, status: "verified_isolated", envClass, target };
  }

  // An unrecognised host. We cannot prove which project it fronts, but if the
  // production ref appears anywhere in the URL (a pooler address, a custom
  // domain carrying the ref) that is proof enough to refuse a non-production
  // deployment.
  const mentionsProduction =
    typeof input.supabaseUrl === "string" && input.supabaseUrl.toLowerCase().includes(productionRef);
  if (mentionsProduction) {
    return envClass === "production"
      ? { ok: true, status: "verified_production", envClass, target }
      : { ok: false, reason: "non_production_bound_to_production_project", status: "verified_production", envClass, target };
  }
  return unverified("unverified_host");
}

/** Operator-facing explanation of a refusal. Never contains a key or a full URL. */
export function bindingRefusalMessage(verdict) {
  if (verdict.ok) return "";
  const where = `environment=${verdict.envClass}, target=${verdict.target.kind}`;
  if (verdict.reason === "non_production_bound_to_production_project") {
    return (
      `[env-binding] REFUSED: a ${verdict.envClass} deployment is bound to the PRODUCTION Supabase project (${where}). ` +
      "A Preview or local build must never read or write production data — the service-role key bypasses RLS. " +
      "Set the Preview-scoped NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY to the staging project and redeploy " +
      "(see docs/production/staging-isolation-plan.md)."
    );
  }
  if (verdict.reason === "production_bound_to_foreign_project") {
    return (
      `[env-binding] REFUSED: the PRODUCTION deployment is bound to a project that is not the approved production one (${where}). ` +
      "Either the deployment's Supabase variables are wrong, or PRODUCTION_SUPABASE_PROJECT_REF is. " +
      "Unsetting PRODUCTION_SUPABASE_PROJECT_REF restores the previous behaviour while you investigate."
    );
  }
  return (
    `[env-binding] REFUSED (strict mode): the binding could not be verified — status=${verdict.status} (${where}). ` +
    "Configure PRODUCTION_SUPABASE_PROJECT_REF, or unset ENV_BINDING_STRICT."
  );
}

/** One-line summary for a build log. Carries no credential and no full ref. */
export function bindingSummary(verdict) {
  const t = verdict.target;
  const where = t.kind === "cloud" ? `${t.ref.slice(0, 4)}…${t.ref.slice(-4)}` : t.kind === "local" ? t.host : t.kind;
  return `[env-binding] ${verdict.ok ? "OK" : "REFUSED"} env=${verdict.envClass} target=${t.kind}(${where}) status=${verdict.status}`;
}

/** Statuses that prove isolation (or correct production binding) was checked. */
export const VERIFIED_STATUSES = Object.freeze(["verified_production", "verified_isolated", "local"]);

/** Is this verdict a positive proof rather than an absence of evidence? */
export function isVerified(verdict) {
  return verdict.ok && VERIFIED_STATUSES.includes(verdict.status);
}
