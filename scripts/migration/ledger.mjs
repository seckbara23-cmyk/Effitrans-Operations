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
 * THE STRUCTURAL MODEL, stated once and named.
 * ---------------------------------------------------------------------------
 * A healthy repository/ledger pair is a CONTIGUOUS APPLIED PREFIX followed by a
 * CONTIGUOUS PENDING SUFFIX:
 *
 *     repo:    1 … 138 | 139 140 141
 *     ledger:  1 … 138 |
 *              ^applied ^pending, all strictly above the ledger maximum
 *
 * PENDING IS NOT CORRUPTION. Between authoring a migration and approving it,
 * the correct state IS a non-empty suffix — and a guard that called that an
 * incident would be a guard operators learn to ignore, which is worse than no
 * guard. What corruption looks like is a hole in the PREFIX: a repository
 * migration older than the ledger maximum that the ledger does not know. That
 * is the September 2026 condition, and `reconcile` has always reported it as
 * `MISSING_REMOTELY_BEHIND_MAX`.
 *
 * So the suffix needs no separate check: every ledger row is by definition at
 * or below `remoteMax`, so a pending version can only fail to be in the suffix
 * by being behind the maximum — which is exactly the hard finding above. The
 * model is asserted here rather than merely implied, so a future change to
 * `reconcile` that broke it would break a named contract instead of quietly
 * widening what counts as healthy.
 */
export const LEDGER_STATUS = {
  CLEAN: "CLEAN",
  CLEAN_WITH_PENDING: "CLEAN_WITH_PENDING",
  HELD: "HELD",
};

export function classify(state) {
  // Belt and braces over the implication above: if a pending version were ever
  // at or below the maximum, the prefix has a hole whatever else is true.
  const suffixIntact =
    !state.remoteMax || state.pending.every((v) => v > state.remoteMax);

  const status = state.hard.length || !suffixIntact
    ? LEDGER_STATUS.HELD
    : state.pending.length
      ? LEDGER_STATUS.CLEAN_WITH_PENDING
      : LEDGER_STATUS.CLEAN;

  return {
    status,
    suffixIntact,
    appliedThrough: state.remoteMax || null,
    pending: state.pending,
    /** The only version the runner may apply next, or null when none is due. */
    earliestPending: state.pending.length ? state.pending[0] : null,
  };
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
  // ---- THE ORDERING RULE (ratified 2026-09-07, MIGRATION-GATE-139-141) -----
  //
  // WAS: "expected exactly one pending migration". That was not an ordering
  // rule at all — it was an assumption that a migration is always deployed
  // immediately alongside the code that needs it. When three accumulated, it
  // refused ALL of them, including the earliest, and the repository became
  // undeployable through its own sanctioned path with no supported way out.
  //
  // NOW: the target must be THE EARLIEST PENDING migration. That is strictly
  // stronger as an ordering control — it holds whatever the backlog depth —
  // and it is what makes 138→139→140→141 provable rather than remembered.
  //
  // It is NOT a skip feature and it does not permit a gap: exactly one
  // migration is applied per invocation, and the next invocation's earliest
  // pending is the one after it. Nothing else changed — approval, the single
  // apply, verifier gating, recording and the HELD behaviour are untouched.
  const earliest = state.pending.length ? state.pending[0] : null;
  if (earliest === null) {
    problems.push(`no migration is pending: ${version} is already recorded or is not in the repository`);
  } else if (version !== earliest) {
    problems.push(
      `${version} is not the earliest pending migration. ` +
        `requested=${version} · earliest allowed=${earliest} · ` +
        `production max applied=${state.remoteMax || "(empty)"} · ` +
        `remaining pending=[${state.pending.join(", ")}]. ` +
        `Apply ${earliest} first; one migration per approved production action.`,
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
