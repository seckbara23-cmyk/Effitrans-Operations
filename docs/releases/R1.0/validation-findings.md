# R1.0 — Findings raised during operator validation

Findings discovered while executing
[`operator-validation-checklist.md`](operator-validation-checklist.md). A finding is
recorded here whether or not it blocks the release; the classification is stated
explicitly and separately from the evidence.

---

## DEF-R10-01 — a creation-time generated password does not arm the forced-change gate

**Raised:** 2026-07-31, during B4 · **Reporter:** operator (production)
**Classification:** **implementation defect, pre-existing — NOT an R1.0 release blocker**
(reasoning in §5) · **B4 verdict: still OPEN — the B4 mechanism was not exercised**

### 1. Observation

A staff account created for the UAT (`uat.r10@effitrans.sn`) with credential mode
« Générer un mot de passe temporaire » authenticated successfully with that password and
landed directly on `/dashboard`. No `/auth/change-password` interception occurred.

### 2. The four hypotheses, answered

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | `must_change_password` was never written | ✅ **THE ROOT CAUSE** | `lib/users/actions.ts:183` — `createUser`'s `app_user` insert names only `id, tenant_id, email, name, status`. It never writes `must_change_password`, `temp_password_expires_at` or `password_changed_at`. Migration 71 declares the column `boolean not null default false` (`20260729000001…sql:130`), so the row is created with the gate **disarmed**. |
| 2 | Login/session code ignores the flag | ❌ No | The flag is read on **every** authenticated staff request: `lib/auth/require-user.ts:61` calls `getStaffPasswordGate` and redirects on its verdict. `/dashboard` is guarded — `app/dashboard/page.tsx:40` calls `requireUser()`. |
| 3 | Middleware fails to redirect | ❌ No — **and by design** | `middleware.ts` refreshes the Supabase session only; its header states the AUTH-3 constraint: *"NO business-domain redirects"*. Enforcement is page-level, deliberately. Middleware was never the enforcement point, so it cannot have failed as one. |
| 4 | Lifecycle state-machine regression | ❌ No | `evaluatePasswordGate` (`lib/users/password-lifecycle.ts:120-132`) is a pure function: expiry first, then `mustChangePassword === true → "must_change"`, else `"ok"`. Given `false`, `"ok"` is the **correct** output. The machine behaved exactly as specified — it was handed a disarmed state. |

### 3. Why the test did not exercise B4

B4 tests the **migration-71 lever**: `generateStaffTempPassword`
(`lib/users/password-actions.ts:99`), reached from `/users/{id}` → « Générer un nouveau mot
de passe temporaire ». That function **does** arm the gate — `password-actions.ts:138-149`
writes `must_change_password: true`, `temp_password_expires_at` and `password_changed_at`
in one update, after changing the password, in that deliberate order.

The account instead authenticated with the **creation-time** credential produced by
`createUser` (Phase 5.0E-4), a path that predates migration 71 and was never updated to
write the new columns. **Two different generators, one of which arms the gate.** The
observed behaviour is therefore *correct for the path actually exercised*, and B4 proper
remains unrun.

### 4. The defect that is nonetheless real

The creation flow's own one-time panel tells the administrator, verbatim:

> « Transmettez-le de façon sécurisée ; **l'utilisateur devra le changer à la première
> connexion.** » — `lib/i18n.ts`, `users.credential.warning`

That is a promise the code does not keep. The audit action is likewise named
`USER_CREATED_WITH_TEMP_PASSWORD`, and the mode is labelled « Générer un mot de passe
**temporaire** » — three places call the credential temporary while nothing makes it
temporary. Consequence: an initial password chosen by an administrator, and known to that
administrator, can remain the user's permanent password indefinitely, with no expiry and
no forced rotation. Security-relevant (a shared secret persists), not an outage.

**No fix is proposed here** — investigation only, as instructed.

### 5. Classification reasoning

**Not an R1.0 blocker:**

- R1.0 ships **no code and no schema** — it reconciles the migration ledger and validates
  behaviour that was already deployed. This defect is in `createUser`, unchanged since
  Phase 5.0E-4 and untouched by migration 71 or by anything in R1.0. It is not a
  regression *introduced* by this release; blocking R1.0 would not remove it from
  production, and releasing R1.0 does not worsen it.
- Migration 71's lever is **not shown defective** — it is **not yet tested**. Nothing here
  contradicts the code path B4 targets.

**But B4 cannot be signed as PASS.** Its verdict stays **OPEN** until the *admin-issued*
temporary password is exercised from `/users/{id}`. If that retest fails, the finding is
promoted to an **R1.0 blocker**, because migration 71's central promise would then be
unproven in the running system.

**Deferred to a later release** as a code change, with the create/issue paths reconciled
(or the wording corrected to match the behaviour) — a decision to be taken deliberately,
not folded into a reconciliation release.

### 6. One observation settles it definitively

The root cause above is read from code. The live discriminator, requiring no SQL, is on
`/users/{id}` for the UAT account — the row « **État du mot de passe** »:

| Reads | Means | Implication |
|---|---|---|
| « **Inconnu — aucune modification enregistrée** » | `must_change_password = false`, `password_changed_at = null` | **Confirms the root cause above.** The gate was never armed. |
| « **Mot de passe temporaire en attente de changement** » | `must_change_password = true` | The gate **was** armed and the user still reached `/dashboard` → the gate failed **open** (`lib/users/password-gate.ts:50` returns `"ok"` on any read error). That would be a **materially more serious** finding and an R1.0 blocker. |

Labels: `lib/users/password-lifecycle.ts:159-164`.
