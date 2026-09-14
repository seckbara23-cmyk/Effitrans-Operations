/**
 * PERF-UX-01 Phase 0 — request timing that carries no data.
 * ---------------------------------------------------------------------------
 * What these prove:
 *   1. a trace line holds constants and numbers only — never a URL, an id, an
 *      e-mail or a query string, even when a careless caller hands one over;
 *   2. the Supabase fetch wrapper is transparent: same arguments in, the very
 *      same Response out, and nothing counted outside a trace;
 *   3. a failure is reported and rethrown unchanged, `notFound()`/`redirect()`
 *      read as control flow, nesting never double-logs, `PERF_TRACE=off` works;
 *   4. both Supabase clients are built with the wrapper, and every instrumented
 *      action still runs its own, unchanged body directly beneath its export.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPerfLine, perfStage, perfTraceEnabled, tracedFetch, withPerfTrace } from "@/lib/perf/trace";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DOSSIER = "7f8e6fb8-aafd-4932-b87a-b34cdca177f3";

describe("the trace line", () => {
  const base = {
    label: "files/[id]",
    kind: "action",
    region: "dub1",
    totalMs: 812.6,
    outcome: "ok" as const,
    calls: 64,
    callMs: 540.2,
    maxInFlight: 9,
    stages: [{ name: "b.documents", ms: 12.4 }],
  };

  it("holds exactly the documented fields", () => {
    expect(formatPerfLine(base)).toBe(
      "[perf] files/[id] kind=action region=dub1 total=813ms outcome=ok supabase=64/540ms inflight_max=9 stages=b.documents:12",
    );
  });

  it("refuses an id, a URL, an e-mail or a query string in any name", () => {
    const line = formatPerfLine({
      ...base,
      label: `files/${DOSSIER}`,
      kind: "https://evil",
      region: "iad1; drop",
      stages: [
        { name: DOSSIER, ms: 1 },
        { name: "https://xtpppzhkiagdpmnghdlc.supabase.co/rest/v1/document?file_id=eq.1", ms: 2 },
        { name: "someone@effitrans.sn", ms: 3 },
        { name: "b.transport", ms: 4 },
      ],
    });
    expect(line).not.toContain(DOSSIER);
    expect(line).not.toMatch(/https?:|supabase\.co|@|\?|=eq\./);
    expect(line).toContain("[perf] invalid kind=- region=local");
    expect(line).toContain("stages=invalid:1,invalid:2,invalid:3,b.transport:4");
  });

  it("never prints a negative or fractional count", () => {
    expect(formatPerfLine({ ...base, totalMs: -5, calls: 2.7, maxInFlight: -1, stages: [] })).toBe(
      "[perf] files/[id] kind=action region=dub1 total=0ms outcome=ok supabase=2/540ms inflight_max=0 stages=-",
    );
  });
});

describe("withPerfTrace, perfStage and tracedFetch", () => {
  let lines: string[];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    lines = [];
    vi.stubEnv("PERF_TRACE", "on");
    vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    globalThis.fetch = realFetch;
  });

  it("is off under the test runner unless forced, and PERF_TRACE=off wins", () => {
    vi.stubEnv("PERF_TRACE", "");
    expect(perfTraceEnabled()).toBe(false);
    vi.stubEnv("PERF_TRACE", "on");
    expect(perfTraceEnabled()).toBe(true);
    vi.stubEnv("PERF_TRACE", "off");
    expect(perfTraceEnabled()).toBe(false);
  });

  it("forwards the caller's arguments and returns the very same Response", async () => {
    const response = new Response("ok");
    const seen: unknown[] = [];
    globalThis.fetch = (async (input: unknown, init: unknown) => {
      seen.push(input, init);
      return response;
    }) as typeof fetch;
    const init = { method: "POST", headers: { apikey: "secret" }, body: "{}" };
    const url = `https://example.supabase.co/rest/v1/document?file_id=eq.${DOSSIER}`;

    const outside = await tracedFetch(url, init);
    expect(outside).toBe(response);
    expect(seen).toEqual([url, init]);

    const inside = await withPerfTrace("action:test", () => tracedFetch(url, init));
    expect(inside).toBe(response);
    expect(seen).toEqual([url, init, url, init]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("supabase=1/");
    expect(lines[0]).not.toContain(DOSSIER);
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain("supabase.co");
  });

  it("counts overlapping requests, and a waterfall reads inflight_max=1", async () => {
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Response("ok");
    }) as typeof fetch;

    await withPerfTrace("action:parallel", async () => {
      await Promise.all([tracedFetch("a"), tracedFetch("b"), tracedFetch("c")]);
    });
    await withPerfTrace("action:waterfall", async () => {
      await tracedFetch("a");
      await tracedFetch("b");
    });

    expect(lines[0]).toMatch(/supabase=3\/\d+ms inflight_max=3/);
    expect(lines[1]).toMatch(/supabase=2\/\d+ms inflight_max=1/);
  });

  it("records named stages inside a trace and nothing outside one", async () => {
    expect(await perfStage("free", async () => 7)).toBe(7);
    await withPerfTrace("files/[id]", async () => {
      await perfStage("b.documents", async () => undefined);
      await perfStage("c.sla", async () => undefined);
    }, "document");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[perf\] files\/\[id\] kind=document region=\w+ total=\d+ms outcome=ok /);
    expect(lines[0]).toMatch(/stages=b\.documents:\d+,c\.sla:\d+$/);
  });

  it("reports a failure and rethrows the very same error", async () => {
    const boom = new Error("refused");
    await expect(withPerfTrace("action:fail", async () => { throw boom; })).rejects.toBe(boom);
    expect(lines[0]).toContain("outcome=error");
  });

  it("reads notFound()/redirect() as control flow, not as a failure", async () => {
    const control = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
    await expect(withPerfTrace("files/[id]", async () => { throw control; })).rejects.toBe(control);
    expect(lines[0]).toContain("outcome=control");
  });

  it("never logs twice for nested traces, and logs nothing when off", async () => {
    const value = await withPerfTrace("action:outer", () => withPerfTrace("action:inner", async () => 42));
    expect(value).toBe(42);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("action:outer");

    vi.stubEnv("PERF_TRACE", "off");
    expect(await withPerfTrace("action:off", async () => 1)).toBe(1);
    expect(lines).toHaveLength(1);
  });
});

describe("the wiring", () => {
  it("both Supabase clients are built with the traced fetch", () => {
    for (const file of ["lib/supabase/admin.ts", "lib/supabase/server.ts"]) {
      const src = code(file);
      expect(src, file).toContain('import { tracedFetch } from "@/lib/perf/trace";');
      expect(src, file).toContain("global: { fetch: tracedFetch }");
    }
    // The admin client's auth settings are unchanged.
    expect(code("lib/supabase/admin.ts")).toContain("auth: { autoRefreshToken: false, persistSession: false },");
  });

  it("the fetch wrapper only ever hands its arguments to fetch", () => {
    const src = code("lib/perf/trace.ts");
    const wrapper = src.slice(src.indexOf("export const tracedFetch"));
    const uses = wrapper.match(/\b(input|init)\b/g) ?? [];
    // (input, init) in the signature, and twice `fetch(input, init)`.
    expect(uses).toHaveLength(6);
    expect(wrapper.match(/fetch\(input, init\)/g)).toHaveLength(2);
  });

  it.each([
    ["lib/transport/actions.ts", "updateTransport", "runUpdateTransport", "action:transport.update"],
    ["lib/transport/actions.ts", "assignTransport", "runAssignTransport", "action:transport.assign"],
    ["lib/transport/actions.ts", "changeTransportStatus", "runChangeTransportStatus", "action:transport.status"],
    ["lib/transport/driver-actions.ts", "assignDriverUser", "runAssignDriverUser", "action:driver.assign"],
  ])("%s %s is timed, and its body sits directly beneath the export", (file, name, inner, label) => {
    const src = code(file);
    const start = src.indexOf(`export async function ${name}(`);
    const next = src.indexOf("\nexport ", start + 1);
    const slice = src.slice(start, next < 0 ? undefined : next);
    expect(slice).toContain(`return withPerfTrace("${label}", () => ${inner}(`);
    expect(slice).toContain(`async function ${inner}(`);
    // The body is the business logic, unchanged: its own gates are still in it.
    const body = slice.slice(slice.indexOf(`async function ${inner}(`));
    expect(body).toMatch(/assertPermission\(/);
    expect(body).toContain("isFileVisible(user.id, user.tenantId, rec.file_id)");
  });

  it("the step buttons' actions are timed around the engine call only", () => {
    const src = code("lib/process/queues/actions.ts");
    expect(src).toContain('withPerfTrace("action:step.start", async () => await activateStep(fileId, stepKey))');
    expect(src).toContain('withPerfTrace("action:step.submit", async () => await submitStep(fileId, stepKey))');
  });

  it("the dossier page and its timeline are traced, labelled by request kind", () => {
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain('return withPerfTrace("files/[id]", () => renderFileDetailPage(params), renderKind());');
    expect(page).toMatch(/if \(h\.get\("next-action"\)\) return "action";/);
    expect(code("components/files/event-timeline.tsx")).toContain('withPerfTrace("files/[id]:timeline"');
  });
});
