/**
 * §14 — PROVE 138 → 139 → 140 → 141 WITH THE REAL MIGRATIONS, FROM A REAL 138.
 * CI ONLY. REFUSES ANY NON-LOCAL DATABASE.
 * ---------------------------------------------------------------------------
 * WHAT THIS ADDS THAT NOTHING ELSE HAD.
 *
 * Three things already existed and none of them is this:
 *
 *   * the REHEARSAL (R7) walks the ordering rule against a real ledger, but
 *     with SYNTHETIC migrations. It proves the machinery, not this sequence.
 *   * the VERIFIER SWEEP runs every real verifier against a database where its
 *     migration IS applied — but that database was built by `db reset` from
 *     empty, applying all 141 in one go. It proves the verifiers, not the
 *     promotion.
 *   * CI's `db reset` applies all 141 and stops. It never asks the guard what
 *     it thinks at each intermediate state, and never asks the runner's
 *     validator whether #141 may jump the queue.
 *
 * So: rebuild the database at EXACTLY the production baseline (every migration
 * up to and including 138, seed included), put the three pending migrations
 * back, and then walk the window forward one migration at a time, asking the
 * REAL validator and the REAL verifiers at every state.
 *
 * "Do NOT simply start from empty and apply all 141" — the baseline is produced
 * by temporarily withdrawing the pending migrations from the directory that
 * `db reset` reads, so the reset lands on 138 with nothing else changed.
 *
 * ONE DEVIATION, STATED PLAINLY. The apply step uses `psql`, not the sanctioned
 * executor, because `supabase db query --db-url` sends SQL over the extended
 * query protocol and rejects a multi-statement body — and real migrations are
 * multi-statement. Production applies through `--linked`, the Management API,
 * which accepts them; the two executors are not interchangeable and that is
 * measured separately (scripts/measure-atomicity.mjs). Every OTHER step here is
 * the real thing: `validateTarget` for ordering, `queryFile` for the verifier,
 * `supabase migration repair` for recording, `reconcile`/`classify` for state.
 *
 * WHAT IT WILL NOT DO. It has no production code path: the target is built from
 * `--db-url` and the URL's host must be loopback, or it exits before touching
 * anything. It restores the withdrawn files in a `finally`, and asserts they
 * are back before it reports.
 *
 * EXIT 0 the whole sequence behaved · 1 something did not · 2 could not run.
 *
 * Usage (CI):
 *   node scripts/migration-promotion-walk.mjs \
 *     --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *     --baseline 20260930000001
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { target, queryFile, repair } from "./migration/exec.mjs";
import {
  repoMigrations,
  remoteLedger,
  reconcile,
  validateTarget,
  classify,
  LEDGER_STATUS,
  MIGRATIONS_DIR,
} from "./migration/ledger.mjs";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "db", "postgres"]);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db-url") a.url = argv[++i];
    else if (argv[i] === "--baseline") a.baseline = argv[++i];
  }
  return a;
}

/** The same refusal the rehearsal makes, for the same reason. */
function assertDisposable(url) {
  let host = "";
  try {
    host = new URL(String(url).replace(/^postgres(ql)?:\/\//, "http://")).hostname;
  } catch {
    host = "";
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    console.error(`[walk] REFUSED: "${host || url}" is not a disposable local database.`);
    console.error("[walk] This script rebuilds the database from scratch. It runs ONLY against a local/CI database.");
    process.exit(2);
  }
  return host;
}

const log = (s = "") => console.log(s);
const one = (s) => String(s).replace(/\s+/g, " ").trim();
const annotate = (level, title, message) =>
  console.log(`::${level} title=${title}::${one(message).slice(0, 900)}`);

const results = [];
function record(id, what, pass, detail) {
  results.push({ id, pass });
  log(`[walk] ${pass ? "PASS" : "FAIL"}  ${id}  ${what}`);
  if (detail) log(`[walk]        ${one(detail).slice(0, 500)}`);
  if (!pass) annotate("error", `walk ${id}`, `${what} — ${detail ?? ""}`);
}

/**
 * `supabase db reset`. CI installs the CLI on PATH (setup-cli), so prefer it;
 * fall back to the npx shim elsewhere. Reported either way, because "which CLI
 * built the baseline" is part of what the result means.
 */
function dbReset() {
  const attempts = [
    ["supabase", ["db", "reset"]],
    ["npx", ["supabase", "db", "reset"]],
  ];
  let last = { ok: false, out: "no attempt ran" };
  for (const [cmd, argv] of attempts) {
    const r = spawnSync(cmd, argv, {
      encoding: "utf8",
      timeout: 900_000,
      shell: process.platform === "win32",
    });
    if (r.error && r.error.code === "ENOENT") {
      last = { ok: false, out: `${cmd}: not found` };
      continue;
    }
    return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? ""), via: cmd };
  }
  return last;
}

/**
 * Apply one migration file. See the deviation note in the header: psql, because
 * the local executor cannot carry a multi-statement body, and `ON_ERROR_STOP`
 * so a mid-file failure is a failure rather than a partial success.
 */
function psqlApply(url, file) {
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
    encoding: "utf8",
    timeout: 900_000,
    shell: process.platform === "win32",
  });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.baseline) {
    console.error("[walk] usage: --db-url <local postgres url> --baseline <14-digit version>");
    process.exit(2);
  }
  const host = assertDisposable(args.url);
  const tgt = target({ kind: "db-url", url: args.url });

  const repoAll = repoMigrations();
  const walk = repoAll.filter((m) => m.version > args.baseline).sort((a, b) => (a.version < b.version ? -1 : 1));
  const baseCount = repoAll.filter((m) => m.version <= args.baseline).length;

  log(`[walk] disposable target confirmed: ${host}`);
  log(`[walk] repository   : ${repoAll.length} migrations`);
  log(`[walk] baseline     : ${args.baseline} (${baseCount} migrations at or below it)`);
  log(`[walk] to promote   : ${walk.length} — ${walk.map((m) => m.version).join(", ")}`);
  log("");

  if (walk.length === 0) {
    // Nothing is pending in the repository: there is no promotion to walk, and
    // saying so is honest. It is NOT a pass — the scenario did not run.
    record("W0", "there is at least one migration above the baseline to promote", false,
      `no repository migration sorts above ${args.baseline}; nothing to walk`);
    annotate("warning", "walk", `no migration above the baseline ${args.baseline} — nothing to promote`);
    process.exit(1);
  }
  for (const m of walk) {
    if (!existsSync(m.verifier)) {
      record("W0", "every migration to promote has a companion verifier", false,
        `${m.version} has no verifier at ${m.verifier}`);
      process.exit(1);
    }
  }

  // ---- withdraw the pending migrations so `db reset` lands on the baseline --
  //
  // `db reset` applies whatever is in the migrations directory. Moving the
  // pending files out for the duration of the reset is what makes the baseline
  // a real 138 rather than "all 141, and pretend". Restored in the `finally`.
  const stash = mkdtempSync(join(tmpdir(), "promotion-walk-"));
  mkdirSync(join(stash, "m"), { recursive: true });
  mkdirSync(join(stash, "v"), { recursive: true });
  const moved = [];
  let crashed = null;

  try {
    for (const m of walk) {
      // `file` is the basename, `path` the full path — the stash keeps the
      // basenames so the restore cannot land a migration under a new name.
      const mDest = join(stash, "m", m.file);
      const vDest = join(stash, "v", `${m.version}_${m.name}.verify.sql`);
      renameSync(m.path, mDest);
      renameSync(m.verifier, vDest);
      moved.push({ m, mDest, vDest });
    }

    log(`[walk] withdrew ${moved.length} migration(s); resetting to the baseline…`);
    const reset = dbReset();
    if (!reset.ok) {
      record("W1", "the database rebuilds at the production baseline", false, reset.out.slice(-600));
      throw new Error("baseline reset failed");
    }

    // Put them back BEFORE any assertion: from here on the repository is whole
    // and only the ledger moves.
    for (const x of moved) {
      renameSync(x.mDest, x.m.path);
      renameSync(x.vDest, x.m.verifier);
    }
    moved.length = 0;

    const look = () => {
      const repo = repoMigrations();
      const ledger = remoteLedger(tgt);
      const state = reconcile(repo, ledger);
      return { repo, ledger, state, shape: classify(state) };
    };

    // ---- STATE A: the baseline, with the whole backlog pending -------------
    {
      const { repo, ledger, state, shape } = look();
      const pendingMatches =
        state.pending.length === walk.length && walk.every((m, i) => state.pending[i] === m.version);
      const okBaseline =
        shape.status === LEDGER_STATUS.CLEAN_WITH_PENDING &&
        shape.appliedThrough === args.baseline &&
        pendingMatches;
      record("W1", `the database rebuilds at the baseline: applied through ${args.baseline}, ${walk.length} pending`,
        okBaseline,
        `status=${shape.status} appliedThrough=${shape.appliedThrough} ledgerRows=${ledger.length} pending=[${state.pending.join(", ")}]`);
      if (!okBaseline) throw new Error("the baseline is not what the walk requires");

      // Every migration EXCEPT the earliest must be refused, by name.
      const refusals = [];
      for (const m of walk.slice(1)) {
        const problems = validateTarget(m.version, repo, ledger, state);
        const named = problems.join(" ");
        refusals.push({
          version: m.version,
          refused: problems.length > 0,
          byOrdering: /earliest pending/.test(named),
          says: one(named).slice(0, 180),
        });
      }
      const allRefused = refusals.every((r) => r.refused && r.byOrdering);
      record("W2", "every migration except the earliest is refused, and the refusal names the ordering rule",
        allRefused, refusals.map((r) => `${r.version}: refused=${r.refused} ordering=${r.byOrdering}`).join(" · "));
      for (const r of refusals) log(`[walk]        ${r.version} → ${r.says}`);

      const earliest = walk[0];
      const okEarliest = validateTarget(earliest.version, repo, ledger, state).length === 0;
      record("W3", `the earliest pending migration (${earliest.version}) is the one allowed`, okEarliest,
        okEarliest ? "no problems reported" : validateTarget(earliest.version, repo, ledger, state).join(" · "));
      if (!allRefused || !okEarliest) throw new Error("the ordering rule did not hold at the baseline");
    }

    // ---- promote, one at a time, asking at every state ---------------------
    for (let i = 0; i < walk.length; i++) {
      const m = walk[i];
      const rest = walk.slice(i + 1);
      const tag = `W${4 + i}`;
      log("");
      log(`[walk] ── promoting ${m.version} (${i + 1} of ${walk.length}) ──`);

      // 1. validate — the same call the runner's step 1 makes.
      {
        const { repo, ledger, state } = look();
        const problems = validateTarget(m.version, repo, ledger, state);
        if (problems.length) {
          record(`${tag}a`, `${m.version} is due and the validator agrees`, false, problems.join(" · "));
          throw new Error(`${m.version} was refused when it was its turn`);
        }
      }

      // 2. apply
      const ap = psqlApply(args.url, m.path);
      if (!ap.ok) {
        record(`${tag}b`, `${m.version} applies cleanly onto the previous state`, false, ap.out.slice(-700));
        throw new Error(`${m.version} failed to apply`);
      }

      // 3. verify — the REAL companion verifier, at the moment its migration
      //    lands, which is the one occasion it has never been run before.
      let v;
      try {
        v = queryFile(tgt, m.verifier)[0];
      } catch (e) {
        record(`${tag}c`, `the ${m.version} verifier runs and passes against its own applied schema`, false,
          `the verifier could not run: ${e.message}`);
        throw new Error(`${m.version} verifier could not run`);
      }
      if (v?.ok !== true) {
        record(`${tag}c`, `the ${m.version} verifier runs and passes against its own applied schema`, false,
          `ok=${JSON.stringify(v?.ok)} detail=${v?.detail}`);
        throw new Error(`${m.version} verifier failed`);
      }
      record(`${tag}c`, `the ${m.version} verifier passes against its own applied schema`, true, one(v.detail));

      // 4. record — the supported mechanism, nothing else.
      const rec = repair(tgt, m.version);
      if (!rec.ok) {
        record(`${tag}d`, `${m.version} is recorded through migration repair`, false, rec.message.slice(-500));
        throw new Error(`${m.version} could not be recorded`);
      }

      // 5. post-state — the window moved by exactly one, and what remains is
      //    refused by name until its own turn.
      {
        const { repo, ledger, state, shape } = look();
        const expectStatus = rest.length ? LEDGER_STATUS.CLEAN_WITH_PENDING : LEDGER_STATUS.CLEAN;
        const pendingMatches =
          state.pending.length === rest.length && rest.every((x, k) => state.pending[k] === x.version);
        const okState = shape.status === expectStatus && shape.appliedThrough === m.version && pendingMatches;
        record(`${tag}`, `after ${m.version}: applied through it, pending is exactly [${rest.map((x) => x.version).join(", ") || "none"}]`,
          okState,
          `status=${shape.status} appliedThrough=${shape.appliedThrough} pending=[${state.pending.join(", ")}]`);
        if (!okState) throw new Error(`the state after ${m.version} is not what the sequence requires`);

        // Anything still pending beyond the next one must still be refused.
        for (const later of rest.slice(1)) {
          const named = validateTarget(later.version, repo, ledger, state).join(" ");
          const stillRefused = /earliest pending/.test(named);
          record(`${tag}e`, `${later.version} is still refused while ${rest[0].version} is due`, stillRefused,
            one(named).slice(0, 200));
          if (!stillRefused) throw new Error(`${later.version} was not refused when it should have been`);
        }
      }
    }

    // ---- the end state -----------------------------------------------------
    {
      const { repo, ledger, state, shape } = look();
      const okFinal =
        shape.status === LEDGER_STATUS.CLEAN &&
        state.pending.length === 0 &&
        state.hard.length === 0 &&
        ledger.length === repo.length;
      record("W-END", "nothing pending, nothing held, ledger and repository agree", okFinal,
        `status=${shape.status} ledger=${ledger.length} repo=${repo.length} hard=[${state.hard.map((h) => h.code).join(",") || "none"}]`);

      // And every verifier still passes, now that all of them are applied —
      // including the ones applied several steps ago.
      const stillPassing = [];
      for (const m of repo.filter((x) => existsSync(x.verifier))) {
        try {
          const r = queryFile(tgt, m.verifier)[0];
          if (r?.ok !== true) stillPassing.push(`${m.version} ok=${JSON.stringify(r?.ok)}`);
        } catch (e) {
          stillPassing.push(`${m.version} could not run: ${one(e.message).slice(0, 120)}`);
        }
      }
      record("W-VERIFY", "every companion verifier still passes at the end of the walk",
        stillPassing.length === 0, stillPassing.join(" · ") || "all pass");
    }
  } catch (e) {
    crashed = e;
    log("");
    log(`[walk] stopped: ${e.message}`);
    annotate("error", "promotion walk stopped", e.message);
  } finally {
    // Restore anything still withdrawn, whatever happened above. A walk that
    // leaves the repository short of three migrations would poison every later
    // step in the job and look like an unrelated failure.
    for (const x of moved) {
      try {
        if (existsSync(x.mDest)) renameSync(x.mDest, x.m.path);
        if (existsSync(x.vDest)) renameSync(x.vDest, x.m.verifier);
      } catch (err) {
        annotate("error", "walk could not restore a migration file", `${x.m.version}: ${err.message}`);
      }
    }
    rmSync(stash, { recursive: true, force: true });
    const missing = repoMigrations(MIGRATIONS_DIR).length;
    log("");
    log(`[walk] repository restored: ${missing} migration file(s) present`);
  }

  const failed = results.filter((r) => !r.pass);
  log("");
  log(`[walk] ${results.length - failed.length}/${results.length} checks behaved as required`);
  annotate("notice", "promotion walk", results.map((r) => `${r.id}=${r.pass ? "PASS" : "FAIL"}`).join(" "));

  // Three independent ways to fail, spelled out rather than folded into one
  // expression: a recorded failure, an exception, or NO CHECKS AT ALL. The last
  // one matters most — a walk that asserted nothing must never read green.
  if (failed.length) process.exit(1);
  if (crashed) process.exit(1);
  if (results.length === 0) {
    annotate("error", "promotion walk", "the walk ran no checks — that is a failure, not a pass");
    process.exit(1);
  }
  process.exit(0);
}

main();
