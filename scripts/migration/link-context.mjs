/**
 * Establish the pinned CLI's linked-project context WITHOUT the Management API.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, and it is not a convenience.
 *
 * The protected production workflow used to begin with `supabase link`. That
 * command is not a context setter — it is a project-PROVISIONING fetch. On the
 * pinned CLI 2.106.0 it makes four Management API calls:
 *
 *     GET /v1/projects/{ref}
 *     GET /v1/projects/{ref}/api-keys
 *     GET /v1/projects/{ref}/config/storage
 *     GET /v1/projects/{ref}/config/database/pooler
 *
 * and the migration runner consumes the result of exactly ONE of them: the
 * pooler address. On 2026-09-08 the account behind SUPABASE_ACCESS_TOKEN was
 * refused by the Management API on one of those endpoints, `link` exited 1, and
 * every governed step — integrity guard, dry run, apply, verify, record — was
 * skipped. The migration could not even be validated, because of a permission
 * on an endpoint whose answer the runner never reads.
 *
 * THE MEASUREMENT THAT DECIDED THIS. With only `project-ref` and `pooler-url`
 * present in `supabase/.temp`, against production on CLI 2.106.0:
 *
 *     db query --linked        -> 0 calls to api.supabase.com   (returned n=138)
 *     migration list --linked  -> 0 calls to api.supabase.com
 *     migration-integrity      -> CLEAN_WITH_PENDING, exit 0, CLI cross-check agrees
 *
 * Zero even on a FAILING query, so there is no Management API fallback hiding
 * behind the success case. `--linked` on this CLI is a DIRECT POSTGRES
 * CONNECTION through the pooler; it is not a Management API path, whatever the
 * older comments in this toolchain said.
 *
 * So the fix removes the requirement instead of satisfying it. No Supabase
 * organization role is expanded, no PAT is replaced, no CLI is upgraded, and
 * the execution transport is untouched — the runner talks to the same pooler it
 * always did.
 *
 * WHAT THIS DEPENDS ON, STATED PLAINLY. `supabase/.temp` is the CLI's own cache
 * directory and is not a supported public interface. That dependency is
 * deliberate and bounded:
 *
 *   * the CLI version is PINNED in the workflow, so it cannot move underneath us;
 *   * `tests/migration-link-context.test.ts` pins the cache shape, so changing
 *     it is a test failure rather than a surprise;
 *   * and it FAILS CLOSED. If a future CLI stops reading these files, `--linked`
 *     stops resolving, and the integrity guard — step 1 of every deployment —
 *     refuses. This mechanism can PREVENT a migration. It cannot corrupt one,
 *     and it cannot cause the wrong migration to be applied.
 *
 * There is deliberately NO fallback to `supabase link` and no fallback to the
 * Management API: a fallback would hide exactly the failure this is built to
 * surface.
 *
 * SECRETS ARE NEVER PRINTED. Not the ref, not the URL, not on success and not
 * in any refusal. Every message below names the PROBLEM, never the value.
 *
 * EXIT 0 context written · 2 refused (missing or malformed input)
 *
 * Usage (CI):
 *   SUPABASE_PROJECT_REF=… SUPABASE_POOLER_URL=… node scripts/migration/link-context.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A Supabase project ref: twenty lowercase letters. */
export const PROJECT_REF_RE = /^[a-z]{20}$/;

/**
 * The pooler role name encodes the project: `postgres.<ref>`. Checking it
 * against SUPABASE_PROJECT_REF is what makes a copy-paste of the WRONG
 * project's URL a refusal rather than a migration applied to the wrong database.
 *
 * The HOST is deliberately not checked. Pooler hostnames carry a region
 * (`aws-0-eu-west-1…`) that Supabase may change, and a rule that guesses at
 * geography would fail closed on a legitimate move — an outage caused by the
 * safety check rather than by the thing it guards.
 */
export function validatePoolerUrl(poolerUrl, projectRef) {
  const problems = [];
  if (!projectRef) problems.push("SUPABASE_PROJECT_REF is empty or unset");
  else if (!PROJECT_REF_RE.test(projectRef)) {
    problems.push("SUPABASE_PROJECT_REF is not a project ref (expected twenty lowercase letters)");
  }
  if (!poolerUrl) {
    problems.push("SUPABASE_POOLER_URL is empty or unset");
    return problems;
  }

  let url;
  try {
    url = new URL(poolerUrl);
  } catch {
    problems.push("SUPABASE_POOLER_URL is not a parseable URL");
    return problems;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    problems.push("SUPABASE_POOLER_URL is not a postgresql:// connection string");
  }
  if (!url.hostname) problems.push("SUPABASE_POOLER_URL has no host");

  // ---- NO PASSWORD, and this is a hard rule ------------------------------
  //
  // The whole point of this mechanism is that it introduces no new production
  // credential. A pooler URL with a password embedded would smuggle a database
  // password into a GitHub secret, into the runner's filesystem, and into any
  // log that ever prints a connection string — turning a least-privilege fix
  // into a privilege ESCALATION. The CLI does not need one: it authenticates
  // the pooler with SUPABASE_ACCESS_TOKEN.
  if (url.password) {
    problems.push("SUPABASE_POOLER_URL contains an embedded password — it must not; the CLI authenticates with SUPABASE_ACCESS_TOKEN");
  }

  if (!url.username) {
    problems.push("SUPABASE_POOLER_URL has no pooler role in its userinfo (expected postgres.<project-ref>)");
  } else if (projectRef && PROJECT_REF_RE.test(projectRef)) {
    const expected = `postgres.${projectRef}`;
    if (url.username !== expected) {
      // Named without printing either value: the mismatch is the fact, and the
      // two values are the secrets.
      problems.push(
        "SUPABASE_POOLER_URL is for a DIFFERENT project than SUPABASE_PROJECT_REF " +
          "(its pooler role does not match postgres.<project-ref>)",
      );
    }
  }
  return problems;
}

/**
 * Write the two files the pinned CLI reads to resolve `--linked`.
 *
 * EXACTLY these two, with no trailing newline — the representation the
 * investigation measured against production. `linked-project.json`,
 * `pooler-url`'s siblings and the service-version files that `link` also caches
 * are NOT written: the runner reads none of them, and writing values we have
 * not verified would be inventing state.
 */
export function writeLinkContext(projectDir, projectRef, poolerUrl) {
  const dir = join(projectDir, "supabase", ".temp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project-ref"), projectRef, "utf8");
  writeFileSync(join(dir, "pooler-url"), poolerUrl, "utf8");
  return dir;
}

function main() {
  const projectRef = (process.env.SUPABASE_PROJECT_REF ?? "").trim();
  const poolerUrl = (process.env.SUPABASE_POOLER_URL ?? "").trim();

  const problems = validatePoolerUrl(poolerUrl, projectRef);
  if (problems.length) {
    console.error("[link-context] REFUSED — the project context is not usable:");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("");
    console.error("[link-context] Nothing was written. No migration step will run, which is the");
    console.error("[link-context] intended outcome: a runner that cannot prove WHICH database it");
    console.error("[link-context] is addressing must not address one.");
    process.exit(2);
  }

  const dir = writeLinkContext(process.cwd(), projectRef, poolerUrl);
  // The DIRECTORY is safe to print; the values are not.
  console.log(`[link-context] project context established in ${dir}`);
  console.log("[link-context] wrote: project-ref, pooler-url (values not printed)");
  console.log("[link-context] no Supabase Management API endpoint was called.");
  process.exit(0);
}

// Importable for tests without executing.
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/migration/link-context.mjs")) {
  main();
}
