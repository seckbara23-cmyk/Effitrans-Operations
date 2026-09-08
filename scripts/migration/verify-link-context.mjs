/**
 * CONTRACT CHECK — the pinned CLI still resolves `--linked` from two cache files.
 * NO CREDENTIALS. NO PRODUCTION. NO WRITES.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The protected production workflow no longer runs
 * `supabase link`; it writes `supabase/.temp/project-ref` and
 * `supabase/.temp/pooler-url` itself (see link-context.mjs for the measurement
 * that justified it). That is the CLI's own cache directory, and it is NOT a
 * supported public interface. A CLI upgrade could stop honouring it.
 *
 * The consequence of that going unnoticed is narrow but real: a production
 * deployment that fails at step one with a confusing "Cannot find project ref",
 * during an approved maintenance window, with an operator watching. So the
 * mechanism is asserted here instead, on every ordinary CI run, where finding
 * out is free.
 *
 * HOW IT PROVES ANYTHING WITHOUT A DATABASE. The question is not "can we
 * connect" — that needs credentials. It is "does the CLI still UNDERSTAND this
 * cache", and that has an observable answer either way:
 *
 *   * with an EMPTY project directory, `--linked` refuses before connecting:
 *     "Cannot find project ref. Have you run supabase link?"
 *   * with the two files present, that refusal is GONE and the CLI proceeds to
 *     resolve a host and attempt a connection, which then fails for network
 *     reasons against the fabricated project used here.
 *
 * The transition between those two states is the contract. If a future CLI
 * stops reading `project-ref`, the first message comes back and this fails.
 *
 * ⚠ WHAT THIS DOES **NOT** PROVE, stated so nobody reads more into a green run
 * than it contains: it does not prove `pooler-url` is honoured. The CLI only
 * consults the pooler when the direct host is IPv6-only, which is true of a
 * real project and not of the fabricated ref used here — with a made-up ref the
 * direct host does not resolve at all and the CLI stops there. The pooler half
 * was established by A/B measurement against production on this exact CLI:
 * with `project-ref` alone `--linked` fails "IPv6 is not supported… run
 * supabase link"; adding `pooler-url` makes it succeed, with zero requests to
 * api.supabase.com. Re-checking that needs production credentials and is an
 * operator step, not a CI one.
 *
 * EXIT 0 contract holds · 1 the CLI no longer resolves the cache · 2 cannot run
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLinkContext } from "./link-context.mjs";

/** Not a real project. Twenty lowercase letters, and deliberately meaningless. */
const FAKE_REF = "zzzzzzzzzzzzzzzzzzzz";
const FAKE_POOLER = `postgresql://postgres.${FAKE_REF}@127.0.0.1:59999/postgres`;
/** The refusal that means "the cache was not understood". */
const NOT_LINKED = /cannot find project ref/i;

const log = (s = "") => console.log(s);
const annotate = (level, title, message) =>
  console.log(`::${level} title=${title}::${String(message).replace(/\s+/g, " ").slice(0, 900)}`);

function runCli(workdir, sqlFile) {
  // No access token is supplied on purpose: this must never be able to reach a
  // real project, and the question is answered before authentication matters.
  const r = spawnSync(
    process.platform === "win32" ? "npx" : "supabase",
    process.platform === "win32"
      ? ["-y", "supabase@2.106.0", "--output-format", "json", "db", "query", "--linked", "--workdir", workdir, "-f", sqlFile]
      : ["--output-format", "json", "db", "query", "--linked", "--workdir", workdir, "-f", sqlFile],
    { encoding: "utf8", timeout: 180_000, shell: process.platform === "win32", env: { ...process.env, SUPABASE_ACCESS_TOKEN: "" } },
  );
  if (r.error && r.error.code === "ENOENT") return { missing: true, out: "" };
  return { missing: false, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function main() {
  const root = mkdtempSync(join(tmpdir(), "eft-link-contract-"));
  const empty = mkdtempSync(join(tmpdir(), "eft-link-empty-"));
  const sql = join(root, "probe.sql");
  writeFileSync(sql, "select 1;\n", "utf8");

  try {
    // ---- 1. WITHOUT the cache, the CLI must refuse for the KNOWN reason ----
    const before = runCli(empty, sql);
    if (before.missing) {
      console.error("[link-contract] could not run: the supabase CLI is not on PATH.");
      process.exit(2);
    }
    if (!NOT_LINKED.test(before.out)) {
      // The control failed. Either the CLI changed its refusal, or something
      // resolved a project we did not give it — both mean this probe is no
      // longer measuring what it claims, and a probe that cannot fail for the
      // right reason must not pass.
      annotate("error", "link-context contract inconclusive",
        `an EMPTY project directory did not produce the expected "Cannot find project ref" refusal, so the check below proves nothing. Got: ${before.out.slice(-300)}`);
      console.error("[link-contract] INCONCLUSIVE — the control did not behave as expected.");
      console.error(before.out.slice(-600));
      process.exit(1);
    }
    log('[link-contract] control  : empty directory → "Cannot find project ref" (as expected)');

    // ---- 2. WITH the two files, that refusal must be GONE ------------------
    writeLinkContext(root, FAKE_REF, FAKE_POOLER);
    const after = runCli(root, sql);
    if (NOT_LINKED.test(after.out)) {
      annotate("error", "link-context contract BROKEN",
        "the pinned Supabase CLI no longer resolves --linked from supabase/.temp/project-ref. The protected production workflow establishes project context this way and will fail at its first step. Do NOT work around it by reintroducing `supabase link` — that is what the permission incident was about (SUPABASE-LINK-PRIVILEGE-01).");
      console.error("[link-contract] FAILED — the cache mechanism is no longer honoured.");
      console.error(after.out.slice(-600));
      process.exit(1);
    }

    log("[link-contract] subject  : two-file context → the CLI resolved it and moved on to connect");
    log("[link-contract] OK — the pinned CLI still reads supabase/.temp/project-ref.");
    log("[link-contract] NOT proven here: that pooler-url is honoured (needs a real IPv6-only");
    log("[link-contract] project). See the header, and the production A/B measurement.");
    process.exit(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
}

main();
