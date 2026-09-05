/**
 * The repository ↔ ledger model, and the invariants both scripts read from.
 * ---------------------------------------------------------------------------
 * ONE definition, two consumers: the read-only guard reports on these, and the
 * production runner refuses to act unless they hold. If they were written twice
 * they would drift, and a guard that disagrees with the runner is worse than no
 * guard — it grants false confidence.
 *
 * THE VERSION INVARIANT IS ORDERING-BASED, NOT ARITHMETIC. Migration ids are
 * timestamps (`20260930000001`), not a counter, so "the next one" can never be
 * `max + 1`. It is "the next file in repository order after the remote maximum",
 * and the check that actually matters is the fourth one below: NO repository
 * migration older than the remote maximum may be missing remotely. That is the
 * condition the September gap violated, and it would have been caught on the
 * very next deployment had anything been looking.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { query, migrationList } from "./exec.mjs";

export const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Verifiers live OUTSIDE the migrations directory, and that is load-bearing.
 * The Supabase CLI treats every `<14-digit>_<name>.sql` file under
 * `supabase/migrations` as a migration. A companion named
 * `20260930000001_customs_release_approval.verify.sql` therefore parses as a
 * SECOND migration sharing a version — it shows up as pending, and `db push`
 * would try to APPLY it. Discovered by this toolchain's own guard, on the first
 * run after the convention was introduced.
 */
export const VERIFIERS_DIR = "supabase/verifiers";

/** Every committed migration, in repository (lexicographic = chronological) order. */
export function repoMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".verify.sql"))
    .sort()
    .map((file) => {
      const base = file.slice(0, -4);
      const cut = base.indexOf("_");
      if (cut < 1) return { file, version: base, name: "", malformed: true };
      return {
        file,
        path: join(dir, file),
        version: base.slice(0, cut),
        name: base.slice(cut + 1),
        verifier: join(VERIFIERS_DIR, `${base}.verify.sql`),
        malformed: !/^\d{14}$/.test(base.slice(0, cut)),
      };
    });
}

/** The remote ledger, ordered. Read-only: a plain select, never a write. */
export function remoteLedger(tgt) {
  const rows = query(
    tgt,
    "select version, name from supabase_migrations.schema_migrations order by version",
  );
  return rows.map((r) => ({ version: String(r.version), name: r.name ?? "" }));
}

/**
 * Compare the two and classify every discrepancy.
 *
 * `hard` findings are stop-the-world: production and the repository disagree
 * about what has happened. `advisory` findings are repository-side bookkeeping
 * (a renamed file) that cannot harm production and must not block a deploy.
 */
export function reconcile(repo, ledger) {
  const repoByVersion = new Map(repo.map((m) => [m.version, m]));
  const ledgerByVersion = new Map(ledger.map((m) => [m.version, m]));
  const remoteMax = ledger.length ? ledger[ledger.length - 1].version : "";

  const hard = [];
  const advisory = [];

  for (const m of repo) {
    if (m.malformed) hard.push({ code: "MALFORMED_VERSION", version: m.version, detail: m.file });
  }

  // A repository migration OLDER than the remote maximum that the ledger does
  // not know. Either it was applied and never recorded, or it was skipped
  // outright — opposite remedies, so the guard never guesses which.
  for (const m of repo) {
    if (!ledgerByVersion.has(m.version) && remoteMax && m.version < remoteMax) {
      hard.push({ code: "MISSING_REMOTELY_BEHIND_MAX", version: m.version, detail: m.file });
    }
  }

  // A recorded version with no file. The repository can no longer explain what
  // production contains.
  for (const l of ledger) {
    if (!repoByVersion.has(l.version)) {
      hard.push({ code: "UNKNOWN_REMOTE_VERSION", version: l.version, detail: l.name });
    }
  }

  const seen = new Set();
  for (const m of repo) {
    if (seen.has(m.version)) hard.push({ code: "DUPLICATE_VERSION", version: m.version, detail: m.file });
    seen.add(m.version);
  }

  // A rename is a repository-side change that cannot affect production.
  for (const m of repo) {
    const l = ledgerByVersion.get(m.version);
    if (l && l.name && m.name && l.name !== m.name) {
      advisory.push({ code: "NAME_MISMATCH", version: m.version, detail: `repo=${m.name} ledger=${l.name}` });
    }
  }

  const pending = repo.filter((m) => !ledgerByVersion.has(m.version)).map((m) => m.version);

  return { hard, advisory, pending, remoteMax, repoCount: repo.length, ledgerCount: ledger.length };
}

/**
 * May `version` be applied right now?
 *
 * Every condition is stated separately so a refusal names the ONE thing that is
 * wrong, rather than a generic "preconditions failed" that sends an operator
 * hunting at the worst possible moment.
 */
export function validateTarget(version, repo, ledger, state) {
  const problems = [];
  const m = repo.find((x) => x.version === version);

  if (!m) {
    problems.push(`no committed migration file for version ${version}`);
    return problems;
  }
  if (!existsSync(m.verifier)) {
    problems.push(`migration ${version} has no companion verifier (${m.verifier})`);
  }
  if (state.hard.length) {
    problems.push(`repository/ledger integrity is not clean: ${state.hard.map((h) => h.code).join(", ")}`);
  }
  if (state.remoteMax && !(version > state.remoteMax)) {
    problems.push(`version ${version} is not greater than the remote maximum ${state.remoteMax}`);
  }
  // "Next in repository ordering": nothing may sort between the remote maximum
  // and the target.
  const between = repo.filter((x) => (!state.remoteMax || x.version > state.remoteMax) && x.version < version);
  if (between.length) {
    problems.push(`${between.length} earlier migration(s) would be skipped: ${between.map((x) => x.version).join(", ")}`);
  }
  if (state.pending.length !== 1 || state.pending[0] !== version) {
    problems.push(
      `expected exactly one pending migration (${version}) but found ${state.pending.length}: ${state.pending.join(", ") || "none"}`,
    );
  }
  return problems;
}

/**
 * The CLI's own view, used only to cross-check ours. Disagreement means one of
 * the two readings is wrong, which is itself worth stopping for.
 */
export function crossCheckCli(tgt, pending) {
  const list = migrationList(tgt);
  if (!list) return { checked: false, agrees: true, detail: "CLI list unavailable" };
  const cliPending = list.filter((x) => !x.remote).map((x) => x.local);
  const agrees =
    cliPending.length === pending.length && cliPending.every((v, i) => v === pending[i]);
  return { checked: true, agrees, cliPending, detail: agrees ? "agrees" : `CLI pending=${cliPending.join(",")}` };
}
