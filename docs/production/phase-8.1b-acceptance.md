# Phase 8.1B — User Archive Production Acceptance Ledger

**Feature under acceptance:** Phase 8.1A archive lifecycle (deployed `4a5db16`, production migration
`20260720000001_user_archive.sql` reported applied by the operator).

Two evidence classes, honestly separated:
- **EXECUTED** — verified from the engineering environment (code proofs pinned by tests, CI, live
  sweep). Machine-checked, done.
- **OPERATOR** — requires an authenticated production session or database access this environment
  does not have. Exact steps + expected outcomes below; tick and date each row.

---

## Executed evidence

| Check | Result | Evidence |
|---|---|---|
| Deployed SHA = `4a5db16` | ✅ | `/api/version` attestation via sweep, 2026-07-17 |
| Production route sweep | ✅ 36/36 ALL CHECKS PASSED | `scripts/gate/verify-production.mjs` |
| CI on `4a5db16` | ✅ run #170 success — **includes the rls-tests job: clean DB → all 51 migrations (incl. the archive constraint) → seed → full RLS suite** | api.github.com |
| Unit suite | ✅ 2,288 tests / 131 files (after +6 acceptance regressions) | local |
| Typecheck + production build | ✅ clean | local |
| Client-bundle secret scan | ✅ no key patterns, no server env names | `.next/static` scan |
| Lifecycle correctness (Part 10.1–3, 10.10) | ✅ code-proven + test-pinned | `tests/user-archive.test.ts`: already-archived → `user_archived`; restore-active → refused before any write; archived→inactive illegal; stale form re-validated server-side |
| Cross-tenant archive/restore (Part 10.5) | ✅ refused `not_found`, tenant server-resolved | test-pinned |
| Self-archive (Part 10.6) | ✅ refused `cannot_disable_self` | test-pinned |
| **Only-remaining-SYSTEM_ADMIN lockout (Part 10.7)** | ✅ **structurally impossible — NOT a pilot blocker** | Proof: `admin:users:manage` is held by exactly one role template (SYSTEM_ADMIN — test-pinned), so the only actor able to archive the last admin is that admin, and self-archive is refused. Suspend has the same self-guard; self-revocation of SYSTEM_ADMIN is separately refused (`cannot_revoke_own_admin`). With N≥2 admins, archiving down to 1 is possible; below 1 is not. |
| Audit ordering (Part 9) | ✅ success audit written ONLY after the status update succeeds; failures return first — no misleading audit | test-pinned |
| Audit payload safety (Part 9) | ✅ before/after status + ban outcome only; no password/link/token/session/provider error | test-pinned |
| Authorization surface (Part 8, structural) | ✅ both actions gate `assertPermission("admin:users:manage")` (SYSTEM_ADMIN only); portal identities hold no RBAC permission; anonymous callers have no session; tenant + actor are server-resolved | test-pinned (8.1A + 8.1B suites) |
| Assignment exclusion (Part 5, structural) | ✅ pickers filter `status='active'` at query level AND writes validate the target is active (`validateAssignee` / `invalid_collector` / `invalid_courier`) — a forced server-side assignment of an archived id is refused with a mapped error and writes nothing | test-pinned |
| Historical attribution (Part 6, structural) | ✅ audit actor + dossier assignee render via `staffDisplayName` → "Nom (Archivé)"; no code path renders "Unknown user" | test-pinned |

### Edge-case analyses (Part 10.4, 10.8 — documented, no code change)

**Concurrent archive submissions (10.4):** two racing requests can both read `status='active'` and
both update. The final state is identical (idempotent), the ban is idempotent, and at most a
duplicate audit row records that two requests were made — an honest record, not corruption.
Classified BENIGN; no serialization added (would be speculative).

**Restore after partial GoTrue failure (10.8):** if the un-ban fails, the user is `active` in the
app but still banned at GoTrue — cannot log in. The audit row records `authBan: "lift_failed"` so
the condition is visible. **In-product recovery exists: archive the user again (legal from
active), then restore — the restore retries the un-ban.** Dashboard un-ban is the fallback.
Classified DOCUMENTED-RECOVERABLE; no blocker.

**Observation (LOW, governance):** the `is_system_admin` boolean (single-per-tenant unique index,
DEC-B12) is independent of the SYSTEM_ADMIN *role* and is used only for display/platform listings.
Archiving its holder breaks nothing functional, but the flag stays occupied — reassigning it to a
successor requires clearing it first. Track for the tenant-governance backlog; out of 8.1B scope.

---

## OPERATOR — Part 1: database verification (SQL, read-only; report presence/counts only)

Run in the production SQL editor; paste outcomes (never data values) into the table:

```sql
-- 1. Migration present in history
select version from supabase_migrations.schema_migrations where version = '20260720000001';

-- 2. Constraint accepts exactly the three states
select pg_get_constraintdef(oid) from pg_constraint where conname = 'app_user_status_check';
-- expect: CHECK (status = ANY (ARRAY['active','inactive','archived']...))

-- 3. No unexpected status value; existing rows valid (counts only)
select status, count(*) from public.app_user group by status;

-- 4. RLS still enabled + policies intact on app_user
select relrowsecurity from pg_class where relname = 'app_user';          -- expect: true
select count(*) from pg_policies where tablename = 'app_user';           -- expect: unchanged (>0)

-- 5. Indexes intact
select indexname from pg_indexes where tablename = 'app_user';
-- expect: idx_app_user_tenant, uq_app_user_email_per_tenant, uq_app_user_single_admin (+pkey)
```

| Item | Result | Date/verifier |
|---|---|---|
| Migration `20260720000001` in history | ☐ | |
| Constraint = exactly active/inactive/archived | ☐ | |
| Status counts contain no unexpected value | ☐ | |
| RLS enabled + policy count unchanged | ☐ | |
| Indexes present | ☐ | |

## OPERATOR — Parts 2–7: supervised acceptance journey (production, test staff account)

Precondition: a controlled test staff account that is **not** the only SYSTEM_ADMIN holder and,
for Part 6, owns at least one historical reference (e.g. is the assignee of a test dossier).
Establish a logged-in browser session for the test user FIRST (Part 3 needs it).

| # | Step | Expected | ☐ |
|---|---|---|---|
| 2.1 | As SYSTEM_ADMIN: `/users` → test user → **Archiver** | consequences confirmation appears (loses access / hidden by default / history preserved / audit preserved / no assignments) | ☐ |
| 2.2 | Confirm | success notice « Utilisateur archivé… » — **not** a generic error (proves the production constraint accepts `archived`) | ☐ |
| 2.3 | Default `/users` | test user ABSENT; active + suspended users present | ☐ |
| 2.4 | Tick « Afficher les utilisateurs archivés » | URL becomes `?archived=1`; test user visible, badge **Archivé**; row read-only except **Restaurer** (no suspend, no role edit, no welcome) | ☐ |
| 3.1 | Test user's pre-existing session: navigate to a protected page | denied on the next request (redirect to /login) — GoTrue ban + app status gate; record which fired | ☐ |
| 3.2 | Fresh login as test user | denied | ☐ |
| 3.3 | « Mot de passe oublié » for the test user's email | no usable reset (banned at GoTrue; app gate refuses regardless) | ☐ |
| 3.4 | As admin: « Renvoyer l'e-mail » on the archived row | not offered (row read-only); direct action would return `user_archived` | ☐ |
| 3.5 | Test user attempts self-restore | impossible — cannot authenticate; restore requires `admin:users:manage` | ☐ |
| 4.1 | Directory search + pagination with archived users present | both respect the filter (archived only under `?archived=1`) | ☐ |
| 5.1 | Dossier assignment picker, task assignee picker, collector/courier selectors, brand member list | archived user ABSENT from every list | ☐ |
| 5.2 | Forced server-side assignment with the archived user id (replay the action with the old id) | refused with the mapped error; nothing written; no success audit | ☐ |
| 6.1 | Dossier the test user was assigned to; audit log rows they acted in | « Nom (Archivé) » — never Unknown/blank/broken | ☐ |
| 7.1 | From `?archived=1`: **Restaurer** | status → **Actif** directly (never inactive); back in default directory | ☐ |
| 7.2 | Test user logs in again | succeeds; roles intact; history intact; no old session resurrected | ☐ |
| 7.3 | Test user reappears in assignment pickers | ✅ eligible again | ☐ |
| 8.1 | As finance / customs / driver users: attempt archive (UI absent → replay action) | `forbidden`; no audit success | ☐ |
| 8.2 | As portal customer + anonymous: call the action | rejected (no staff session) | ☐ |
| 9.1 | `/settings/audit` | `user.archived` and `user.restored` rows with actor/tenant/target/before/after; no link/password/token | ☐ |

**Stop condition:** any privilege crossover, any archived-user access, or any attribution loss ⇒
stop, re-seal if needed, file as a blocker in the 8.0A register.

---

## Closure

When both operator tables are complete with no failure, Phase 8.1B is DONE and the archive
lifecycle is pilot-accepted. Any failed row becomes a finding (classify per the 8.0A register)
before the pilot proceeds.
