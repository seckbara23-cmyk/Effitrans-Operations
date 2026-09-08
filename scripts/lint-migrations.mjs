/**
 * Migration lint — repository-only, no database, runs in the ordinary build job.
 * ---------------------------------------------------------------------------
 * Enforces the two conventions that make the production runner possible:
 *
 *   1. EVERY migration from the cutover ships a companion `.verify.sql`. The
 *      runner's post-apply check and the guard's schema-ahead-of-ledger
 *      detection both depend on it existing; discovering it is missing at
 *      deployment time is discovering it too late.
 *
 *   2. THE EXECUTOR IS DECLARED, NEVER GUESSED. The default path sends a
 *      migration's whole body through the pooler connection `--linked` opens,
 *      which runs it as one implicit transaction under a 2-minute statement
 *      timeout. Some SQL cannot
 *      live there — `CREATE INDEX CONCURRENTLY` is illegal inside a transaction
 *      block, and a large backfill will exceed two minutes. Such migrations must
 *      say so in a header, and this lint refuses the combination of hostile SQL
 *      with the default executor. Choosing an executor at deploy time by
 *      pattern-matching the SQL would be a guess made at the worst moment.
 *
 * Header syntax, on any comment line of the migration:
 *      -- migrate:executor db-query          (default; implicit transaction)
 *      -- migrate:executor psql-no-transaction
 *
 * EXIT 0 clean · 1 violations.
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { repoMigrations, MIGRATIONS_DIR, VERIFIERS_DIR } from "./migration/ledger.mjs";

/**
 * Migrations before the cutover predate the convention. They are covered by the
 * separate historical-integrity backlog, not retrofitted here — a lint that
 * demands 138 verifiers nobody has written is a lint that gets disabled.
 */
const VERIFIER_REQUIRED_FROM = "20260930000001";

const EXECUTORS = new Set(["db-query", "psql-no-transaction"]);

/** SQL that cannot run inside an implicit transaction block. */
const TRANSACTION_HOSTILE = [
  [/create\s+(unique\s+)?index\s+concurrently/i, "CREATE INDEX CONCURRENTLY"],
  [/drop\s+index\s+concurrently/i, "DROP INDEX CONCURRENTLY"],
  [/reindex[^;]*concurrently/i, "REINDEX CONCURRENTLY"],
  [/^\s*vacuum\b/im, "VACUUM"],
  [/create\s+database\b/i, "CREATE DATABASE"],
  [/drop\s+database\b/i, "DROP DATABASE"],
  [/alter\s+system\b/i, "ALTER SYSTEM"],
  [/create\s+tablespace\b/i, "CREATE TABLESPACE"],
  [/alter\s+type\s+\S+\s+add\s+value/i, "ALTER TYPE … ADD VALUE"],
  [/create\s+subscription\b/i, "CREATE SUBSCRIPTION"],
];

/** Explicit transaction control fights whatever the executor is doing. */
const EXPLICIT_TXN = [/^\s*begin\s*;/im, /^\s*commit\s*;/im, /^\s*rollback\s*;/im];

const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const problems = [];
const notes = [];

for (const m of repoMigrations()) {
  const raw = readFileSync(m.path, "utf8");
  const sql = strip(raw);

  if (m.malformed) {
    problems.push(`${m.file}: filename must be <14-digit version>_<name>.sql`);
    continue;
  }

  // ---- 1. the companion verifier ----------------------------------------
  if (m.version >= VERIFIER_REQUIRED_FROM && !existsSync(m.verifier)) {
    problems.push(`${m.file}: missing companion verifier ${VERIFIERS_DIR}/${m.version}_${m.name}.verify.sql`);
  }

  // ---- 2. the declared executor -----------------------------------------
  const decl = /--\s*migrate:executor\s+([a-z-]+)/i.exec(raw);
  const executor = decl ? decl[1].toLowerCase() : "db-query";
  if (decl && !EXECUTORS.has(executor)) {
    problems.push(`${m.file}: unknown executor "${executor}" (expected: ${[...EXECUTORS].join(", ")})`);
  }

  const hostile = TRANSACTION_HOSTILE.filter(([re]) => re.test(sql)).map(([, label]) => label);
  if (hostile.length && executor !== "psql-no-transaction") {
    problems.push(
      `${m.file}: contains ${hostile.join(", ")}, which cannot run inside a transaction — ` +
        `declare "-- migrate:executor psql-no-transaction"`,
    );
  }
  if (!hostile.length && executor === "psql-no-transaction" && m.version >= VERIFIER_REQUIRED_FROM) {
    notes.push(`${m.file}: declares psql-no-transaction but contains no construct that requires it`);
  }

  for (const re of EXPLICIT_TXN) {
    if (re.test(sql)) {
      problems.push(`${m.file}: explicit BEGIN/COMMIT/ROLLBACK — the executor owns transaction control`);
      break;
    }
  }
}

// ---- verifiers must be read-only ----------------------------------------
const MUTATING = [
  /^\s*(insert|update|delete|truncate|alter|drop|grant|revoke|create)\s+/im,
  /^\s*(set|reset)\s+(role|session)/im,
  /\bdo\s+\$\$/i,
];
for (const m of repoMigrations()) {
  if (!existsSync(m.verifier)) continue;
  const v = strip(readFileSync(m.verifier, "utf8"));
  for (const re of MUTATING) {
    if (re.test(v)) {
      problems.push(`${m.version}.verify.sql: verifiers must be strictly read-only (matched ${re})`);
      break;
    }
  }
  if (!/\bok\b/.test(v) || !/\bdetail\b/.test(v)) {
    problems.push(`${m.version}.verify.sql: must return the (ok boolean, detail text) contract`);
  }

  // ---- A VERIFIER MAY NOT CONSULT THE MIGRATION LEDGER -------------------
  //
  // MIGRATION-GATE-139-141-REPAIR. The #140 and #141 verifiers each compared a
  // row timestamp against `supabase_migrations.schema_migrations.inserted_at`.
  // That column does not exist — the ledger is exactly (version, statements,
  // name), on the hosted platform and in the local stack alike. A verifier is
  // ONE statement, so Postgres planned the whole file and rejected it with
  // 42703, taking every OTHER check in the file down with it. Nothing caught it,
  // because a verifier is only ever run against a database that LACKS its
  // migration, where erroring is the expected answer.
  //
  // THE RULE IS A BAN, NOT A COLUMN WHITELIST, and deliberately so:
  //
  //   * A whitelist would need this lint to know the ledger's shape without a
  //     database, so it would be a hardcoded list that silently rots.
  //   * More fundamentally, a verifier that reads the ledger is asking the
  //     wrong oracle. The integrity guard runs verifiers PRECISELY BECAUSE the
  //     ledger cannot say whether a migration is applied — a missing row looks
  //     identical whether the SQL ran or never did. A verifier that consults
  //     the ledger to answer that is circular.
  //
  // A verifier's evidence is the SCHEMA. Provenance questions that genuinely
  // need "when was this applied" belong in the migration's own apply-time
  // `raise exception` block, which runs once, at exactly that moment.
  if (/\bsupabase_migrations\b/i.test(v)) {
    problems.push(
      `${m.version}.verify.sql: a verifier must not query supabase_migrations — ` +
        `its evidence is the schema, not the ledger (the ledger is why verifiers exist). ` +
        `Move any "when was this applied" assertion into the migration's own apply-time check.`,
    );
  }
}

// A verifier parked in the migrations directory parses as a migration to the
// Supabase CLI — duplicate version, shows as pending, and `db push` would apply
// it. This rule exists because it actually happened.
for (const f of readdirSync(MIGRATIONS_DIR)) {
  if (f.endsWith(".verify.sql")) {
    problems.push(`${MIGRATIONS_DIR}/${f}: verifiers must live in ${VERIFIERS_DIR}/ — the CLI reads this directory as migrations`);
  }
}

for (const n of notes) console.log(`[lint-migrations] note: ${n}`);

if (problems.length) {
  console.error(`[lint-migrations] FAILED — ${problems.length} violation(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`[lint-migrations] OK — conventions hold (verifiers required from ${VERIFIER_REQUIRED_FROM}).`);
