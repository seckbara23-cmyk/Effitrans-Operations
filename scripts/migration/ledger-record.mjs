/**
 * The migration ledger: how it is read, and the ONE way a single row is written.
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS. `exec.mjs` says, correctly, that recording a migration
 * is `supabase migration repair` and nothing else — "a script cannot insert
 * into the ledger table because this module gives it no way to". That rule was
 * written after the September 2026 gap, where applying and recording were two
 * unrelated hand-run commands and sixteen migrations fell between them.
 *
 * On 2026-10-08 that rule stopped being sufficient. Production workflow #18
 * applied 20261013000001, its verifier passed 13/13, and `migration repair
 * --linked` then printed nothing but
 *
 *     Initialising login role... Connecting to remote database...
 *
 * and wrote no row. The pooler transport was plainly working — it had just
 * applied the SQL and run the verifier through it — so this was not the
 * Management API, not a credential and not connectivity. The supported
 * recording mechanism simply did not record, with no error text to act on, and
 * the runner correctly refused to re-apply. That leaves a live schema the
 * ledger denies, and no governed way to finish.
 *
 * SO THE RULE IS AMENDED DELIBERATELY, NOT BYPASSED. This module adds exactly
 * one writing verb, `recordOne`, and it is as narrow as the job allows:
 *
 *   * it writes ONE row, for ONE version named by the caller, and can touch no
 *     other row — there is no UPDATE and no DELETE in this file;
 *   * it is reached only from the runner's `--record-only` mode, behind the
 *     same `production-db` approval as every apply;
 *   * it refuses unless `proveFormat` has just demonstrated, against the LIVE
 *     ledger, that this file reproduces the CLI's own `statements` encoding for
 *     migrations the CLI itself recorded;
 *   * it is idempotent — `where not exists` makes a second run a no-op rather
 *     than a duplicate;
 *   * and its success is read back out of the ledger, never inferred from
 *     output text. That is the whole lesson of #18.
 *
 * The 2026 gap was caused by apply and record being UNTIED. A record-only verb
 * that proves its encoding, writes one row, and then re-reads the ledger to
 * confirm is the opposite of that failure, not a repetition of it.
 *
 * WHAT IS NEVER ASSUMED: that our split matches the CLI's. The CLI stores the
 * migration file split into statements, and the split is SQL-aware — migration
 * 20261012000001 is a single 17,755-character element because its whole
 * `do $recovery$ … $recovery$` body is one statement, semicolons and all. A
 * naive split on `;` would shred every dollar-quoted function in this
 * repository. `proveFormat` is therefore a PRECONDITION re-run at the moment of
 * use, not a claim made once in a comment.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { query } from "./exec.mjs";

export const LEDGER = "supabase_migrations.schema_migrations";

/**
 * The digest separator. NOT chr(0): Postgres refuses a NUL in text with
 * `54000 null character not permitted`, which is how the first draft of the
 * proof failed. SOH cannot occur in SQL source, and `cardinality` is compared
 * alongside the digest so a separator collision could not pass unnoticed.
 */
const SEP = "";
const SEP_SQL = "chr(1)";

/**
 * Split a migration's SQL the way the CLI does: on top-level semicolons, with
 * everything that can legally contain one skipped over.
 *
 * Skipped: single-quoted strings (doubled '' escapes), double-quoted
 * identifiers, dollar-quoted bodies, `--` line comments, and block comments,
 * which nest in Postgres — so the depth is counted rather than matched once.
 *
 * Comments are RETAINED: element one of every recorded migration in production
 * begins with that file's own header comment. Only the separator itself is
 * dropped, and whitespace-only text yields no element.
 *
 * Dollar-quote tags are matched as ASCII. Postgres permits non-ASCII tags; none
 * of the 151 migrations uses one, and `proveFormat` would refuse if that ever
 * stopped being true, so the narrower rule fails closed rather than silently.
 */
export function splitStatements(sqlRaw) {
  // CI checks out with LF, and the ledger holds what the CLI read there. A CRLF
  // working copy must normalise or every digest differs for an invisible reason.
  const sql = String(sqlRaw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < n) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const t = tag[0];
        const close = sql.indexOf(t, i + t.length);
        i = close === -1 ? n : close + t.length;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === ";") {
      const piece = sql.slice(start, i).trim();
      if (piece !== "") out.push(piece);
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }

  const tail = sql.slice(start).trim();
  if (tail !== "") out.push(tail);
  return out;
}

/** A migration file's statements, as the ledger should hold them. */
export function statementsOf(path) {
  return splitStatements(readFileSync(path, "utf8"));
}

/** What the proof compares: element count AND content digest, never one alone. */
export function fingerprint(statements) {
  return {
    cardinality: statements.length,
    md5: createHash("md5").update(statements.join(SEP), "utf8").digest("hex"),
  };
}

/** The ledger's own fingerprints. READ-ONLY. */
export function ledgerFingerprints(tgt, versions, { q = query } = {}) {
  if (versions.length === 0) return new Map();
  // Versions are `\d{14}` — asserted by the caller and again in `recordOne` —
  // so this list cannot carry anything but digits.
  const list = versions.map((v) => `'${String(v).replace(/[^0-9]/g, "")}'`).join(", ");
  const rows = q(
    tgt,
    `select version,
            coalesce(name, '') as name,
            cardinality(statements) as cardinality,
            md5(array_to_string(statements, ${SEP_SQL})) as md5,
            -- CR-stripped as well, because the ledger is HETEROGENEOUS: 19 of
            -- the first 150 rows hold CRLF, having been applied by hand from a
            -- Windows working copy in the pre-policy era, while every row CI
            -- wrote holds LF. Line endings are what differ, nothing else.
            md5(replace(array_to_string(statements, ${SEP_SQL}), chr(13), '')) as md5_lf
       from ${LEDGER}
      where version in (${list})
      order by version;`,
  );
  const byVersion = new Map();
  for (const r of rows) {
    byVersion.set(String(r.version), {
      name: String(r.name),
      cardinality: Number(r.cardinality),
      md5: String(r.md5),
      md5Lf: String(r.md5_lf),
    });
  }
  return byVersion;
}

/**
 * Prove this module reproduces the CLI's encoding, against rows the CLI wrote.
 *
 * Every sampled version must match on BOTH element count and digest. One
 * mismatch and nothing is recorded: a splitter that is wrong about an existing
 * migration has no business encoding a new one.
 */
export function proveFormat(tgt, migrations, { q = query } = {}) {
  const sample = migrations.filter((m) => m.recorded);
  if (sample.length === 0) {
    return { ok: false, checked: 0, mismatches: [], detail: "no recorded migration to prove against" };
  }
  const live = ledgerFingerprints(tgt, sample.map((m) => m.version), { q });
  const mismatches = [];
  let exact = 0;
  for (const m of sample) {
    const l = live.get(m.version);
    if (!l) { mismatches.push(`${m.version}: absent from the ledger mid-proof`); continue; }
    const f = fingerprint(statementsOf(m.path));
    // CARDINALITY IS ABSOLUTE. It is the statement BOUNDARIES — the part a
    // naive `;` split gets wrong — and no line-ending difference can change it.
    if (f.cardinality !== l.cardinality) {
      mismatches.push(`${m.version}: ${f.cardinality} elements locally vs ${l.cardinality} in the ledger`);
      continue;
    }
    // CONTENT is compared LF-normalised on both sides. The ledger's CRLF rows
    // are a historical artefact of how they were applied, not a different
    // encoding, and a new row written from CI is LF by construction.
    if (f.md5 !== l.md5Lf) {
      mismatches.push(`${m.version}: content differs beyond line endings (${f.md5.slice(0, 12)} vs ${l.md5Lf.slice(0, 12)})`);
      continue;
    }
    if (f.md5 === l.md5) exact += 1;
  }
  return {
    ok: mismatches.length === 0,
    checked: sample.length,
    exact,
    mismatches,
    detail: mismatches.length === 0
      ? `boundaries and content reproduce the CLI across ${sample.length} recorded migration(s) `
        + `(${exact} byte-identical, ${sample.length - exact} identical once the ledger's historical CRLF is normalised)`
      : `${mismatches.length}/${sample.length} mismatched`,
  };
}

/** A dollar-quote tag that appears in none of the given texts. */
export function safeTag(texts) {
  for (let i = 0; i < 64; i += 1) {
    const tag = `$lrec${i}$`;
    if (!texts.some((t) => String(t).includes(tag))) return tag;
  }
  throw new Error("[ledger] no dollar-quote tag is absent from the content");
}

/**
 * Record ONE migration as applied — the single writing verb.
 *
 * Writes one row or none. `ok` means the row IS present and matches what was
 * sent, read back from the ledger rather than inferred from any message.
 */
export function recordOne(tgt, { version, name, statements }, { q = query } = {}) {
  if (!/^\d{14}$/.test(String(version))) {
    return { ok: false, inserted: false, detail: `refusing a malformed version '${version}'` };
  }
  if (!name || !/^[A-Za-z0-9_]+$/.test(String(name))) {
    return { ok: false, inserted: false, detail: `refusing a malformed name '${name}'` };
  }
  if (!Array.isArray(statements) || statements.length === 0) {
    return { ok: false, inserted: false, detail: "refusing to record an empty statements array" };
  }
  const tag = safeTag([...statements, name, String(version)]);
  const arr = statements.map((s) => `${tag}${s}${tag}`).join(", ");
  const sql = `
insert into ${LEDGER} (version, name, statements)
select ${tag}${version}${tag}, ${tag}${name}${tag}, array[${arr}]::text[]
 where not exists (select 1 from ${LEDGER} where version = ${tag}${version}${tag});

select (select count(*) from ${LEDGER} where version = ${tag}${version}${tag})::int as rows,
       (select coalesce(name, '') from ${LEDGER} where version = ${tag}${version}${tag}) as name,
       (select cardinality(statements) from ${LEDGER} where version = ${tag}${version}${tag}) as cardinality,
       (select md5(array_to_string(statements, ${SEP_SQL})) from ${LEDGER} where version = ${tag}${version}${tag}) as md5;`;

  let rows;
  try {
    rows = q(tgt, sql);
  } catch (e) {
    return { ok: false, inserted: false, detail: `the insert failed: ${String(e.message).slice(0, 400)}` };
  }
  const r = rows[rows.length - 1] ?? {};
  const count = Number(r.rows ?? 0);
  if (count !== 1) {
    return { ok: false, inserted: false, detail: `after recording, the ledger holds ${count} row(s) for ${version}` };
  }
  const want = fingerprint(statements);
  if (Number(r.cardinality) !== want.cardinality || String(r.md5) !== want.md5) {
    return {
      ok: false,
      inserted: true,
      detail: `the recorded row does not match what was sent (ledger ${r.cardinality}/${String(r.md5).slice(0, 12)}, expected ${want.cardinality}/${want.md5.slice(0, 12)})`,
    };
  }
  if (String(r.name) !== name) {
    return { ok: false, inserted: true, detail: `the recorded name is '${r.name}', expected '${name}'` };
  }
  return { ok: true, inserted: true, detail: `${version} recorded as '${name}' with ${want.cardinality} statement(s)` };
}

/** Is this version in the ledger? READ-ONLY. */
export function isRecorded(tgt, version, { q = query } = {}) {
  const v = String(version).replace(/[^0-9]/g, "");
  const rows = q(tgt, `select count(*)::int as n from ${LEDGER} where version = '${v}';`);
  return Number(rows[0]?.n ?? 0) > 0;
}
