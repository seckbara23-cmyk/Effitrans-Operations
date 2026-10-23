# WP1 closure hardening — release notes, risk and rollback

**Status:** RELEASE CANDIDATE — local commit only. Not pushed, no pull request, not merged, not deployed; migration #162 **not applied to production**. Each of those steps needs the owner's separate authorisation.
**Base:** `main` = production = `2c3acc8276162ab347215900b95ac57157a65def` (PR #51), Vercel `dpl_DzSdDCaGUgUqBMpSDmmpPQdTtwwQ`, ledger 161.
**Branch:** `feat/wp1-closure-hardening`.
**Findings closed:** N-1, R-1, R-2, I-2 and AL-1, plus CR-1 to CR-4 from the independent security review of the first closure commit — details and evidence in [`security-findings.md`](security-findings.md).

---

## 1. What ships

| Item | Change | Who notices |
|---|---|---|
| N-1 | The inbound e-mail reduction (`htmlToText`) is linear, and reads at most 500 000 characters of the stored body. Tag names are folded ASCII-only, so no character can shift a cut (CR-1); a `<script>`/`<style>` closed past the cut is removed, not printed (CR-3). Renderer `wp1d-3`. | Nobody today — the inbox is held by no role (DEC-CEO-20). Once opened, a hostile e-mail can no longer stall the server. |
| R-1 | The EMP-4 attachment lookup names the dossier only to someone who can see it; otherwise « Déjà rattachée, à un dossier que vous ne pouvez pas consulter. » The inbox message page and the conversation page stop linking the triage outcome's dossier for the same people (CR-2). | Nobody today (same gate). |
| AL-1 | Migration #162: `audit_log` refuses TRUNCATE — statement trigger for every role, REVOKE for the API roles. Nothing else about `audit_log` changes. | Nobody: no application path truncates. An operator's `truncate audit_log [cascade]` is refused. |
| R-2 | The CI promotion walk starts from production's real maximum (`20261021000005`), and the rule that sets it no longer turns every pull request red once everything is deployed (`docs/migration-policy.md`, *The walk baseline*). | CI only. |
| Docs | WP1 activation record (release manifest §11), security findings register, CEO-ALIGNMENT rows in `docs/decision-register.md`. | Readers of the docs. |

**Not in this release:** no permission grant (DEC-CEO-20 stays pending), no HARD PO rule (DEC-CEO-19 stays pending), no environment flag, no change to dossier opening, Customs, Transport or Finance code paths, no WP2 work.

## 2. Migration

| # | Version | File | Executor | Writes rows? | Lock on `audit_log` | Verifier |
|---|---|---|---|---|---|---|
| 162 | `20261023000001` | `audit_log_truncate_guard` | db-query | **no** | SHARE ROW EXCLUSIVE — readers never blocked, writers wait only for the catalog change (lock mode measured in rehearsal; its duration was not measured — the body changes catalog rows only) | 4 checks, structural |

`build-info.ts` pins `LATEST_MIGRATION = 20261023000001_audit_log_truncate_guard`, `MIGRATION_COUNT = 162`. The migration aborts on its own if the trigger is not installed as required, if the UPDATE/DELETE guards are missing, or if any API role still holds TRUNCATE afterwards. Re-running it is a no-op.

## 3. Verification (local, before any push)

| Check | Result |
|---|---|
| `npm run lint:migrations` | OK |
| New and coupled suites (`wp1-closure-hardening`, `wp1-closure-outcome-visibility`, `wp1-message-ingest`, `emp-4-ingest`, `ec-2-triage`, `emp-1-mail-workspace`, `emp-ia-1-mail-information-architecture`, `migration-gate-repair`) | 212 / 212 |
| Each review fix against its own defect (re-introduce it, the new tests must fail) | 4 / 4 caught |
| Disposable-database rehearsal (PGlite), both privilege shapes | 162/162 migrations, seed OK, 25/25 verifiers, 3 SQL suites PASS, idempotent re-apply, **27/27 negative controls caught**, verifiers robust to CI's fixture grants |
| `tsc --noEmit` | 0 errors |
| Full unit suite (Windows) | 10 496 tests: 10 486 passed, 1 skipped, **9 failed = exactly the base's 9** (Windows-only CRLF debt, same 7 files; identical failure list to PR #51's run). Run before the last test (the every-code-point check) was added; that file was re-run alone: 22 / 22 |
| `next build` (no secrets, as CI) | success, no new warning |
| Independent security review of `a9bec55` | N-1 FAIL → fixed (CR-1, CR-3); R-1 CONDITIONAL → fixed (CR-2); AL-1 PASS; R-2 PASS; docs CONDITIONAL → fixed (CR-4) |

CI on GitHub has **not** run on this branch: no push has been made.

## 4. Deployment order

1. Owner authorises the push; a human opens the pull request; CI `build` + `rls-tests` green — including the new step *Run audit_log TRUNCATE guard test (WP1 closure)* and the promotion walk, which now walks exactly #162 from `20261021000005`.
2. Independent security review of the pull request (the sensitive files are listed in its body).
3. Vercel Preview: **visual check only** — Preview uses the production database. Nothing visible changes.
4. Merge (owner). Production deploys the code; N-1 and R-1 are live but unreachable while the inbox is closed.
5. One governed run pair of `migrate-production.yml` for `20261023000001`: `dry_run=true`, then `dry_run=false`, each approved at `production-db`. Read-only checks after the apply: ledger 162; verifier #162 `ok = true`; `audit_log` ACL reads `arwdxtm` for each API role (was `arwdDxtm`: only TRUNCATE, `D`, gone); row count unchanged by the migration; the application keeps writing audit rows (a new row appears after normal use).
6. **After** the apply, nothing in CI changes: the baseline stays at `20261021000005` until the pull request that adds migration #163 (policy R-2).

## 5. Risk

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| The apply waits on a long transaction writing `audit_log` | Low | The run fails after 3 s (`lock_timeout`), rolls back, records nothing | Re-dispatch later; nothing to repair |
| A legitimate process truncates `audit_log` | None found | It would now fail | Repository searched: no migration, script, fixture or code path truncates `audit_log`; the incident runbooks already say « never truncate `audit_log` » (`docs/production/rollback-plan.md`, `observability-plan.md`) — #162 enforces what they state |
| The reducer changes a rendition's text | Low | A filed e-mail's text differs from what the old reducer would have produced | Seeded differential against a verbatim copy of the old reducer — now with « İ » and other non-ASCII case pairs in the corpus, the gap that hid CR-1 — identical on well-formed HTML; the difference is confined to malformed input (a stray `<` is now kept as text, as a browser shows it). The version string (`wp1d-3`) records which reducer produced each rendition. |
| R-1 hides a dossier link from someone who should see it | Low | « Déjà rattachée… » without a link | The decision is the platform's own `isFileVisible` predicate — the one every dossier page uses |
| Baseline policy misread | Low | CI red with « nothing to walk » | A unit test pins the baseline to a real migration strictly older than the newest; the policy text says when it moves |

## 6. Rollback

| Tier | Action | When |
|---|---|---|
| Code | Vercel « promote previous » to `dpl_DzSdDCaGUgUqBMpSDmmpPQdTtwwQ` (`2c3acc8`). Safe with or without #162 applied: the old code never truncates `audit_log` and never reads the renderer version. | A UI or ingest defect |
| Migration | Forward-fix migration only. To remove the guard deliberately: `drop trigger trg_audit_log_no_truncate on public.audit_log;` (and, if the privilege is really wanted back, `grant truncate … to service_role`) in a new reviewed migration. **Never** edit #162 once applied. | The guard blocks something legitimate |
| — | A failed governed run leaves #162 unrecorded and changes nothing; report and stop. | — |
