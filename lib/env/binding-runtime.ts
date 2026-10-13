/**
 * EFF-STAGING-ISOLATION-02 — the runtime half of the binding guard. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `lib/env/project-binding.mjs` decides; this module reads the environment,
 * caches the decision, throws on refusal, and renders the non-secret report
 * `/api/version` publishes.
 *
 * `import "server-only"` because the decision depends on `VERCEL_ENV`, which is
 * NOT a `NEXT_PUBLIC_` variable and therefore does not exist in the browser. A
 * client-side copy of this check would read "development" on a production page
 * and refuse the production project — the exact outage the guard exists to
 * prevent. The browser surface is protected a different way: because
 * `NEXT_PUBLIC_SUPABASE_URL` is baked into the client bundle at BUILD time, the
 * build-time check (next.config.mjs / scripts/check-env-binding.mjs) means a
 * misbound Preview never produces a bundle at all.
 */
import "server-only";
import { createHash } from "node:crypto";
import {
  bindingRefusalMessage,
  bindingSummary,
  evaluateBinding,
  isVerified,
} from "./project-binding.mjs";

/** Read the three inputs from the server environment. Static keys, so Next inlines nothing. */
function readEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    vercelEnv: process.env.VERCEL_ENV,
    productionRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
    strict: process.env.ENV_BINDING_STRICT === "true",
  };
}

let cached: ReturnType<typeof evaluateBinding> | null = null;

/** The verdict for this process. Evaluated once — the inputs cannot change mid-process. */
export function currentBinding() {
  if (cached === null) cached = evaluateBinding(readEnv());
  return cached;
}

let announced = false;

/**
 * Refuse to hand out a Supabase client when the binding is forbidden.
 *
 * Called from BOTH client factories, so every privileged write (the 237 modules
 * reached through `getAdminSupabaseClient`) and every RLS-bound server write
 * (the portal/password/notification paths that use the user-context client)
 * passes through it. Throwing is deliberate: a misbound deployment must fail
 * loudly and immediately, not degrade into writing the wrong database.
 */
export function assertSupabaseBinding(): void {
  const verdict = currentBinding();
  if (!verdict.ok) throw new Error(bindingRefusalMessage(verdict));
  // Say once, in the server log, what could not be proven — so an unverified
  // deployment is never mistaken for a verified one.
  if (!announced && !isVerified(verdict)) {
    announced = true;
    console.warn(`${bindingSummary(verdict)} — isolation NOT verified (see docs/production/staging-isolation-plan.md)`);
  }
}

/**
 * A correlation token for a project ref: enough to compare two deployments,
 * not a credential. The ref itself is already public — it is inlined into every
 * production client bundle — so this is tidiness, not secrecy.
 */
export function refFingerprint(ref: string): string {
  return createHash("sha256").update(ref).digest("hex").slice(0, 12);
}

export type BindingReport = {
  /** production | preview | development, as the platform reports it. */
  envClass: string;
  /** unconfigured | local | cloud | unknown — what kind of database is bound. */
  target: string;
  /** First and last four characters of the project ref, or null. */
  refHint: string | null;
  /** Stable, non-reversible token for comparing two deployments' bindings. */
  refFingerprint: string | null;
  /** The guard's verdict for this deployment. */
  status: string;
  /** True only when the binding was positively proven, not merely unrefuted. */
  verified: boolean;
};

/**
 * What `/api/version` publishes. SECRET-FREE BY CONSTRUCTION: no key, no URL,
 * no host, no full ref — a hint, a hash prefix and a verdict. This is what
 * turns "we cannot tell which database that deployment uses" (the finding of
 * EFF-PR33-PREVIEW-DATA-ISOLATION-01) into one unauthenticated request.
 */
export function bindingReport(): BindingReport {
  const v = currentBinding();
  const ref = v.target.kind === "cloud" ? v.target.ref : null;
  return {
    envClass: v.envClass,
    target: v.target.kind,
    refHint: ref ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : null,
    refFingerprint: ref ? refFingerprint(ref) : null,
    status: v.status,
    verified: isVerified(v),
  };
}
