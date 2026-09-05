/**
 * The single door to the database for every migration script.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The ledger gap of September 2026 (migrations 123–138 live in
 * production but absent from `supabase_migrations.schema_migrations`) was not
 * caused by a bad command. It was caused by TWO commands: one that applies SQL
 * and one that records it, run by hand, with nothing tying them together. When
 * only the first happened, nothing noticed for sixteen migrations.
 *
 * So every database interaction in this toolchain goes through here, and this
 * module offers exactly three verbs — `query`, `applyFile`, `repair` — against
 * one explicitly chosen target. There is no fourth verb that writes the ledger
 * directly: recording a migration is `supabase migration repair`, the supported
 * mechanism, and nothing else. A script cannot insert into the ledger table
 * because this module gives it no way to.
 *
 * TARGETS are explicit and never inferred. `linked` is production. Rehearsal and
 * failure injection use `db-url`, pointed at a disposable database. A script
 * that forgets to pass a target gets an error, not a default.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * HOW WE INVOKE THE CLI, AND WHY NOT SIMPLY "npx".
 *
 * On Windows `npx` is `npx.cmd`, and Node 20+ refuses to spawn a `.cmd` without
 * `shell: true` (EINVAL). Turning the shell on would mean hand-quoting every
 * argument — connection strings carry `@` and `:`, this project's own path
 * carries spaces, and SQL carries quotes. One missed edge and a migration
 * command becomes something else entirely.
 *
 * So we bypass the shim: `npx` is really `node <npm>/bin/npx-cli.js`, and we
 * spawn THAT with argv passed as an array. No shell, no quoting, nothing
 * interpolated. On platforms where a plain `npx` is directly spawnable we use
 * it, and the shim path is the fallback.
 */
function npxInvocation() {
  const nodeDir = dirname(process.execPath);
  for (const candidate of [
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    join(nodeDir, "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ]) {
    if (existsSync(candidate)) return { cmd: process.execPath, prefix: [candidate] };
  }
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", prefix: [], needsShell: process.platform === "win32" };
}
const NPX = npxInvocation();

/**
 * A target names WHICH database, and is carried as CLI flags. Kept as an array
 * rather than a string so nothing is ever shell-interpolated.
 */
export function target(spec) {
  if (!spec || typeof spec !== "object") throw new Error("[exec] a target is required");
  if (spec.kind === "linked") return { kind: "linked", flags: ["--linked"], label: "LINKED (production)" };
  if (spec.kind === "local") return { kind: "local", flags: ["--local"], label: "local stack" };
  if (spec.kind === "project-ref") {
    if (!spec.ref) throw new Error("[exec] project-ref target needs a ref");
    return { kind: "project-ref", flags: ["--project-ref", spec.ref], label: `project ${spec.ref}` };
  }
  if (spec.kind === "db-url") {
    if (!spec.url) throw new Error("[exec] db-url target needs a url");
    // `--workdir` points the CLI at a different Supabase project directory.
    // The rehearsal needs it because `migration repair` resolves a migration's
    // NAME from the local migrations directory, and the rehearsal's fabricated
    // versions deliberately do not live in the real one.
    const flags = ["--db-url", spec.url];
    if (spec.workdir) flags.push("--workdir", spec.workdir);
    return { kind: "db-url", flags, label: `db-url ${redact(spec.url)}${spec.workdir ? ` (workdir ${spec.workdir})` : ""}` };
  }
  throw new Error(`[exec] unknown target kind: ${spec.kind}`);
}

/** Never print a connection string with its password. */
export function redact(url) {
  return String(url).replace(/\/\/[^@/]*@/, "//***@");
}

/**
 * `-f` paths must be ABSOLUTE. With `--workdir` set, the CLI resolves relative
 * file arguments against the workdir, so a relative path silently becomes
 * `<workdir>/<workdir>/...` and the file is "not found" — while the command
 * still exits in a way that looks like an ordinary failure.
 */
const abs = (p) => resolve(p);

function run(args, { timeoutMs = 600_000 } = {}) {
  // `--output-format json` is NOT optional. Against `--linked` the CLI happens
  // to emit JSON anyway, but against `--db-url` it prints a human ASCII table —
  // so a parser that works in production silently fails on the rehearsal
  // database, which is precisely backwards. Ask for JSON explicitly, always.
  const r = spawnSync(NPX.cmd, [...NPX.prefix, "supabase", "--output-format", "json", ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: NPX.needsShell === true,
  });
  if (r.error) throw new Error(`[exec] could not run supabase CLI: ${r.error.message}`);
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Inline SQL is never passed as a command-line argument — it goes to a temp file
 * and travels as `-f`. SQL is full of quotes and dollar-quoting; an argv is the
 * wrong place for it, on any platform.
 */
function withTempSql(sql, fn) {
  const dir = mkdtempSync(join(tmpdir(), "eft-mig-"));
  const file = join(dir, "q.sql");
  try {
    writeFileSync(file, sql, "utf8");
    return fn(file);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * The CLI prints human preamble ("Initialising login role…") before its JSON,
 * and reports SQL errors as a JSON object with `_tag: "Error"` while still
 * exiting 0. Both are handled here so no caller has to remember either.
 */
function parseJson(...sources) {
  for (const out of sources) {
    if (!out) continue;
    // A bare array is a valid shape for `--output-format json`; normalise it to
    // the `{ rows }` envelope the callers expect.
    const a = out.indexOf("[");
    const b = out.lastIndexOf("]");
    const objAt = out.indexOf("{");
    if (a >= 0 && b > a && (objAt < 0 || a < objAt)) {
      try {
        const arr = JSON.parse(out.slice(a, b + 1));
        if (Array.isArray(arr)) return { rows: arr };
      } catch {
        /* fall through to the object attempt */
      }
    }
    const i = objAt;
    const j = out.lastIndexOf("}");
    if (i < 0 || j <= i) continue;
    // Bounded to the outermost braces: the CLI writes human preamble before its
    // JSON and can write more after it, so neither end can be assumed clean.
    try {
      return JSON.parse(out.slice(i, j + 1));
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** Read-only SQL. Returns rows; throws with the database's own message on error. */
export function query(tgt, sql, opts) {
  return withTempSql(sql, (file) => queryFile(tgt, file, opts));
}

/** Read-only SQL from a file. Same contract as `query`. */
export function queryFile(tgt, file, opts) {
  const r = run(["db", "query", ...tgt.flags, "-f", abs(file)], opts);
  const j = parseJson(r.stdout, r.stderr, r.stdout + r.stderr);
  if (j && j._tag === "Error") throw new Error(`[exec] query failed: ${j.error?.message ?? "unknown"}`);
  if (r.code !== 0) throw new Error(`[exec] query exited ${r.code}: ${(r.stderr || r.stdout).slice(-800)}`);
  if (!j || !Array.isArray(j.rows)) throw new Error(`[exec] query returned no rows array: ${r.stdout.slice(0, 400)}`);
  return j.rows;
}

/**
 * Apply a migration's SQL. Returns `{ ok, message }` rather than throwing,
 * because the CALLER must decide what an apply failure means — and the answer
 * differs sharply depending on whether the ledger was written yet.
 */
export function applyFile(tgt, file, opts) {
  const r = run(["db", "query", ...tgt.flags, "-f", abs(file)], { timeoutMs: 900_000, ...opts });
  const j = parseJson(r.stdout, r.stderr, r.stdout + r.stderr);
  if (j && j._tag === "Error") return { ok: false, message: j.error?.message ?? "unknown error" };
  if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout).slice(-2000) };
  return { ok: true, message: "" };
}

/**
 * Record a migration as applied — the SUPPORTED mechanism, and the only way
 * this toolchain writes the ledger.
 *
 * `migration repair` reads the local migrations directory to recover the
 * migration's name, so it must run from a checkout of the same commit that was
 * applied. The CI runner satisfies this by construction; a human running it
 * from a stale tree would record the wrong name, which the guard reports.
 */
export function repair(tgt, version, opts, status = "applied") {
  const r = run(["migration", "repair", ...tgt.flags, "--status", status, version], opts);
  if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout).slice(-2000) };
  const out = r.stdout + r.stderr;
  if (/Migration history repaired|repaired/i.test(out)) return { ok: true, message: "" };
  return { ok: false, message: `unexpected repair output: ${out.slice(-800)}` };
}

/** `supabase migration list`, parsed. Used only to cross-check our own view. */
export function migrationList(tgt, opts) {
  const r = run(["migration", "list", ...tgt.flags], opts);
  const j = parseJson(r.stdout, r.stderr, r.stdout + r.stderr);
  if (!j || !Array.isArray(j.migrations)) return null;
  return j.migrations;
}
