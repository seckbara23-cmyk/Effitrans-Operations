/**
 * PERF-UX-01 Phase 0 — request timing that carries no data. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS. The performance audit could measure database time exactly
 * (pg_stat_statements) but not what an operator waits for: the runtime logs
 * carry no duration, and nothing recorded how many Supabase round trips one
 * dossier render or one action issues, nor how many of them overlap. This
 * records exactly that, and nothing more.
 *
 * ONE LINE PER TRACED REQUEST, containing only:
 *
 *   [perf] <label> kind=<document|rsc|action|-> region=<code> total=<ms>ms
 *          outcome=<ok|control|error> supabase=<calls>/<ms>ms inflight_max=<n>
 *          stages=<name>:<ms>,…
 *
 * WHAT IT NEVER CONTAINS: a URL, path, query string, header, body, cookie,
 * token, dossier id, user id, tenant id or e-mail. The label and every stage
 * name are string constants written in code, and `formatPerfLine` refuses
 * anything that does not look like one — so even a careless future caller
 * cannot turn this into a data log. The Supabase accounting reads the clock
 * and a counter; it never looks at the request it times.
 *
 * `supabase=<calls>/<ms>` is measured to the arrival of response headers, which
 * is where the round trip is spent; streaming a body is not included.
 * `inflight_max` is the most Supabase requests that were open at once: 1 means
 * the request was a pure waterfall.
 *
 * SWITCH. `PERF_TRACE=off` disables it everywhere, `PERF_TRACE=on` forces it.
 * Unset, it is on except under the test runner, so CI logs stay readable.
 * Outside a traced request the fetch wrapper is one store lookup followed by the
 * platform `fetch`, called with the caller's own arguments.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type Stage = { name: string; ms: number };

type Trace = {
  label: string;
  kind: string | null;
  startedAt: number;
  stages: Stage[];
  calls: number;
  callMs: number;
  inFlight: number;
  maxInFlight: number;
};

export type PerfOutcome = "ok" | "control" | "error";

export type PerfLine = {
  label: string;
  kind: string | null;
  region: string;
  totalMs: number;
  outcome: PerfOutcome;
  calls: number;
  callMs: number;
  maxInFlight: number;
  stages: Stage[];
};

const traces = new AsyncLocalStorage<Trace>();

/** Code constants only: letters, digits and `: / _ . [ ] -`. */
const NAME = /^[A-Za-z0-9:/_.[\]-]{1,64}$/;
/**
 * A dossier, user or tenant id is built from exactly the characters a name may
 * use, so the shape alone would let one through. Anything carrying a long hex
 * run — every UUID does — is refused as a name.
 */
const LOOKS_LIKE_AN_ID = /[0-9a-f]{8}/i;
const KIND = /^(document|rsc|action)$/;
const REGION = /^[a-z0-9]{1,12}$/;

export function perfTraceEnabled(): boolean {
  const flag = process.env.PERF_TRACE;
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env.NODE_ENV !== "test";
}

/** Where this function is executing, as Vercel names the region. Never secret. */
function executionRegion(): string {
  const region = process.env.VERCEL_REGION ?? "";
  return REGION.test(region) ? region : "local";
}

/**
 * `notFound()` and `redirect()` complete a request by throwing. They are
 * control flow, not failures, and are reported as such.
 */
function outcomeOf(error: unknown): PerfOutcome {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_") ? "control" : "error";
}

/** Pure. The ONLY place a trace becomes text. */
export function formatPerfLine(line: PerfLine): string {
  const safe = (value: string) => (NAME.test(value) && !LOOKS_LIKE_AN_ID.test(value) ? value : "invalid");
  const ms = (value: number) => Math.max(0, Math.round(value));
  const stages = line.stages.map((s) => `${safe(s.name)}:${ms(s.ms)}`).join(",");
  return [
    "[perf]",
    safe(line.label),
    `kind=${line.kind && KIND.test(line.kind) ? line.kind : "-"}`,
    `region=${REGION.test(line.region) ? line.region : "local"}`,
    `total=${ms(line.totalMs)}ms`,
    `outcome=${line.outcome}`,
    `supabase=${Math.max(0, Math.trunc(line.calls))}/${ms(line.callMs)}ms`,
    `inflight_max=${Math.max(0, Math.trunc(line.maxInFlight))}`,
    `stages=${stages || "-"}`,
  ].join(" ");
}

/**
 * Time `fn` as one request. Nested calls do not open a second trace: the
 * outermost one already counts everything the inner work does.
 */
export async function withPerfTrace<T>(
  label: string,
  fn: () => Promise<T>,
  kind: string | null = null,
): Promise<T> {
  if (!perfTraceEnabled() || traces.getStore()) return fn();

  const trace: Trace = {
    label,
    kind,
    startedAt: performance.now(),
    stages: [],
    calls: 0,
    callMs: 0,
    inFlight: 0,
    maxInFlight: 0,
  };
  let outcome: PerfOutcome = "ok";
  try {
    return await traces.run(trace, fn);
  } catch (error) {
    outcome = outcomeOf(error);
    throw error;
  } finally {
    console.info(
      formatPerfLine({
        label: trace.label,
        kind: trace.kind,
        region: executionRegion(),
        totalMs: performance.now() - trace.startedAt,
        outcome,
        calls: trace.calls,
        callMs: trace.callMs,
        maxInFlight: trace.maxInFlight,
        stages: trace.stages,
      }),
    );
  }
}

/** Time one named part of the current trace. A no-op outside a trace. */
export async function perfStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const trace = traces.getStore();
  if (!trace) return fn();
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    trace.stages.push({ name, ms: performance.now() - startedAt });
  }
}

/**
 * The `fetch` both Supabase clients are built with. It forwards the caller's
 * arguments to the platform `fetch` untouched and returns its response
 * untouched; inside a trace it also counts the request and times it.
 */
export const tracedFetch: typeof fetch = async (input, init) => {
  const trace = traces.getStore();
  if (!trace) return fetch(input, init);

  trace.calls += 1;
  trace.inFlight += 1;
  if (trace.inFlight > trace.maxInFlight) trace.maxInFlight = trace.inFlight;
  const startedAt = performance.now();
  try {
    return await fetch(input, init);
  } finally {
    trace.inFlight -= 1;
    trace.callMs += performance.now() - startedAt;
  }
};
