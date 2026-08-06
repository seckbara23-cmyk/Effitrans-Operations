# OPS-CI-1 — GitHub Actions Trigger Audit

**Date:** 2026-08-06 · **Scope:** why pushes to `main` created no workflow runs
**Method:** unauthenticated GitHub REST API + local git. No `gh` CLI and no token are present
in this environment, so four requested items returned HTTP 401 and are reported as
**NOT VERIFIABLE FROM HERE** rather than guessed.

---

## ROOT CAUSE: `GITHUB_INCIDENT`

**A GitHub Actions platform incident suppressed run CREATION. Nothing in this repository was
misconfigured, and nothing needs to change.**

Direct evidence, not inference:

| Fact | Value |
|---|---|
| GitHub status at audit time | **Partial System Outage** |
| `Actions` component | **`major_outage`** |
| Active incident | *"Incident with Actions"*, status `investigating`, **impact `critical`** |
| Incident opened | **2026-08-06T15:22:49Z** |
| Last run before the gap | `1719a28`, 2026-08-05T11:40:47Z — **before** the incident |
| All five EMP pushes | 2026-08-06T20:09:43Z → 20:49:19Z — **inside** the incident window |

**The audit ran long enough to watch it begin recovering.** Run **#363** was created for
`54a45b0` at **21:17:45Z** — a push→run-creation latency of **~30 minutes**, against a normal
latency of seconds. That is the signature of delayed run creation during recovery, not of a
repository that cannot trigger.

**It was never a trigger defect, a permission policy, a ruleset, or a suppressed push event** —
each of those is independently disproved below.

---

## THE VERIFICATION THAT MATTERS: EMP-1 AND EMP-2 ARE NOW GREEN

**Run #363 — `54a45b0` — conclusion `success`:**

| Job | Result | Steps | Skipped | Failed |
|---|---|---|---|---|
| `rls-tests` | success | 79 | **0** | **0** |
| `build` | success | 10 | **0** | **0** |

`54a45b0` is the EMP-2 implementation commit. Proven by `git merge-base --is-ancestor`:
**`b0009cd` (EMP-1) is an ancestor of `54a45b0`**, so the tree CI just verified contains all of
EMP-1's and all of EMP-2's application code.

The three commits still without runs — `4c01d61`, `04087c0`, `c1e047c` — are **documentation
only** (verified by `git show --name-only`; every path is under `docs/`). The diff between the
green tree and current `HEAD` is exactly two files: `docs/mail/emp-2-completion-report.md` and
`docs/releases/STATUS.md`.

**No application code exists at HEAD that has not passed CI.**

---

## Deliverables

**1. Repository ownership mode** — `owner.type = "User"` (`seckbara23-cmyk`). A personal
account, **not** an organization. Therefore **organization and enterprise policy are NOT
APPLICABLE**, proven rather than assumed. `fork=false`, `archived=false`, `disabled=false`,
`visibility=public`, `default_branch=main`, created 2026-06-04.

**2. Effective Actions permissions** — **NOT VERIFIABLE FROM HERE.**
`/actions/permissions` → HTTP 401. *Indirect proof it is not the cause:* run #363 was created
and executed on this repository during the audit. A repository with Actions disabled or an
allowlist blocking `actions/checkout@v4` could not have produced a green run.

**3. Repository Actions settings** — workflow-permissions endpoint also 401. Same indirect
disproof: the workflow ran to completion.

**4. Organization/enterprise policy** — **N/A**, ownership is a User account (item 1).

**5. Branch protection** — `/branches/main/protection` → HTTP 401, NOT VERIFIABLE FROM HERE.
*Disproved as a cause by direct evidence:* all five pushes are recorded as delivered
`PushEvent`s on `refs/heads/main` and all five commits are present on `origin/main`. Branch
protection cannot both admit a push and suppress its run. Commits reached `main` by ordinary
fast-forward — reflog shows five sequential `commit:` entries, no rebase, no reset.

**6. Rulesets** — `/rulesets` returned **`[]`** (a successful empty response, not a 401).
**No repository rulesets exist.** Org rulesets N/A per item 1. **Ruled out.**

**7. Required workflows** — none can exist: required workflows are configured through org
policy or rulesets, and this repository has neither. The API lists **exactly one** workflow.
**Ruled out.**

**8. Push-event and push-actor findings** — **push delivery is healthy.** The events API
returned a `PushEvent` for every EMP commit:

```
2026-08-06T20:09:43Z  refs/heads/main  4c01d61  actor=seckbara23-cmyk
2026-08-06T20:32:32Z  refs/heads/main  b0009cd  actor=seckbara23-cmyk
2026-08-06T20:34:17Z  refs/heads/main  04087c0  actor=seckbara23-cmyk
2026-08-06T20:47:44Z  refs/heads/main  54a45b0  actor=seckbara23-cmyk
2026-08-06T20:49:19Z  refs/heads/main  c1e047c  actor=seckbara23-cmyk
```

**Push actor is a human user**, identical to the actor of the last successful run
(`1719a28`, same login). Committer on every EMP commit is `Bara Seck <seckbara23@gmail.com>` —
the same identity that produced green runs before the gap. Credential path is HTTPS via **Git
Credential Manager** (`credential.helper=manager`), i.e. a stored user credential.

**`GITHUB_TOKEN` recursion suppression is definitively ruled out**: that mechanism applies only
to commits pushed by the Actions token, the actor here is a user account, and the identical
credential path produced run #362 a day earlier. Run #363's `triggering_actor` is likewise
`seckbara23-cmyk`.

**9. Workflow state from the API** — `total_count: 1`.
```
id=295406369  name="CI"  state="active"  path=.github/workflows/ci.yml
created=2026-06-13T17:07:24Z   updated=2026-07-27T16:16:25Z
```
State is **`active`** — not `disabled_manually`, not `disabled_inactivity`, not `deleted`.
**Silent disablement is ruled out.** (The `updated` stamp matches the UT-3B edit, `142da52`.)
No runs were hiding in a non-terminal state either: `queued`, `waiting`, `requested` and
`in_progress` all returned `total_count: 0`.

**10. Force-push / history** — **no force push occurred.**
`git merge-base --is-ancestor 1719a28 origin/main` → **true**: history is linear and
`1719a28` remains an ancestor. Reflog shows five ordinary sequential commits. Workflow files
never disappeared (item 12). **Ruled out.**

**11. Proof the workflow file exists on `origin/main`** —
`git ls-tree -r origin/main -- .github/` returns exactly:
```
.github/workflows/ci.yml
```
**There is no `security.yml`** in this repository, on `origin/main` or locally — the audit
brief assumed one. `ci.yml` is the only workflow, which is consistent with the API's
`total_count: 1`.

**12. Exact trigger block, as stored on `origin/main`** (via `git cat-file blob`):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
```

Byte-level inspection of the trigger lines (`cat -A`):
```
on:$
  push:$
    branches: [main]$
  pull_request:$
```
`on:` at column 0; `push:` indented two spaces; `branches: [main]` indented four. **LF endings
(no `^M`), no tabs, no `paths` or `paths-ignore` filter, valid `.yml` extension under
`.github/workflows/`.** The YAML is valid and the `push` key is not inert.
**`WORKFLOW_TRIGGER_DEFECT` is ruled out.** *(`security.yml` — does not exist; nothing to
report.)*

**13. Diff of workflow definitions since `1719a28`** —
`git diff --stat 1719a28 origin/main -- .github/` returns **empty**.
**There were NO changes to `.github/**` between the last successful run and HEAD** — stated
explicitly, as the brief requires. Default branch is still `main`; the workflow's own
`updated_at` (2026-07-27) predates the gap entirely.

**14. GitHub incident status** — **active incident, direct evidence** (see root cause). This is
an *active* incident with partial recovery in progress, not a resolved one with lingering
effects, and not a repository- or account-specific restriction.

**15. Root-cause classification** — **`GITHUB_INCIDENT`.**

Every other classification is positively excluded: `WORKFLOW_DISABLED` (state `active`),
`RULESET_OR_REQUIRED_WORKFLOW` (`[]`, and none possible on a user account),
`ORGANIZATION_POLICY` (N/A — User owner), `PUSH_EVENT_SUPPRESSED` (all five `PushEvent`s
delivered, human actor), `WORKFLOW_TRIGGER_DEFECT` (byte-verified trigger, unchanged),
`FORCE_PUSH_OR_HISTORY_ISSUE` (linear ancestry), `ACTIONS_DISABLED` and
`REPOSITORY_PERMISSION_POLICY` (401 to read directly, but disproved in practice by run #363
executing successfully on this repository).

**16. Safe remediation** — **none required. Take no action.** The correct response to a
platform incident is to wait for it. Specifically:

* **Do not** edit `ci.yml` — it is byte-identical to the version that produced 362 green runs.
* **Do not** add `workflow_dispatch` as a workaround; that would be a speculative workflow edit
  during an outage, which the brief forbids and which could not be distinguished from a fix.
* **Do not** push empty commits to "kick" Actions. GitHub queued and eventually created the
  run on its own; extra pushes add commits that will themselves need runs.
* Optionally, once the incident closes, re-run #363 from the Actions UI to confirm steady-state
  latency has returned.

**17. One controlled verification step** — **already satisfied, without any intervention.**
Run #363 on `54a45b0` completed `success` with `rls-tests` 79/0/0 and `build` 10/0/0. Because
a real push-triggered run was created and passed, the `workflow_dispatch` test the brief
contemplated is unnecessary — and per the brief's own rule, a *push* producing a run classifies
this as **not** a push-event problem.

If further confirmation is wanted after the incident resolves, the minimal safe step is:
**re-run run #363 from the Actions UI** (no new commit, no workflow edit).

**18. Can EMP-1 and EMP-2 be verified without code changes?** — **Yes, and they now are.**
Run #363 is green on `54a45b0`, whose tree contains `b0009cd` (EMP-1) as a proven ancestor. The
only commits lacking runs are documentation-only, and the diff from the verified tree to `HEAD`
is two `.md` files. **No application code at HEAD is unverified.**

---

## Correction to the prior record

`docs/releases/STATUS.md` and `docs/mail/emp-2-completion-report.md` were written during the
outage and state that EMP-1 and EMP-2 must not be treated as verified. **That caveat is now
discharged** by run #363 and both documents are corrected alongside this audit.

The durable lesson stands regardless: *"CI is green"* must mean **a run exists for that exact
SHA and passed** — never that the most recent run one happened to see was green.
