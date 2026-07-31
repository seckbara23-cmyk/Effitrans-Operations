# R1.0 — Findings raised during operator validation

Findings discovered while executing
[`operator-validation-checklist.md`](operator-validation-checklist.md). A finding is
recorded here whether or not it blocks the release; the classification is stated
explicitly and separately from the evidence.

---

## OBS-R10-02 — `/users/{id}` refused while `/users` was accessible

**Raised:** 2026-07-31, during B4 · **Reporter:** operator (production)
**Classification:** **not established as a defect — the two observations cannot come from
one session** · **Blocks B4 execution until resolved; not an R1.0 blocker**

### 1. Observation

While authenticated as SYSTEM_ADMIN (`seckbara23@gmail.com`): `/users` accessible, user
creation works, archive/suspend works — but `/users/{id}` for the UAT account returns
« Vous n'avez pas l'autorisation de gérer les utilisateurs. »

### 2. The authorization path, audited

| Question | Answer | File · line |
|---|---|---|
| Permission checked by `/users/[id]` | `admin:users:read` **OR** `admin:users:manage` | `app/users/[id]/page.tsx:41` → `canUserAdmin(permissions, "read")` |
| Granular instead of umbrella? | **No.** `userAdminCodes("read")` returns **both** codes and the gate passes if **either** is held | `lib/users/permissions.ts:47-54` |
| Does the check differ from the list page? | **No — identical call, identical argument, identical source array** | list: `app/users/page.tsx:40`; detail: `app/users/[id]/page.tsx:41` |
| Is the authenticated user evaluated correctly? | Yes — `requireUser()` then `getEffectivePermissions(current.id)`, the same pair the list page uses | `app/users/[id]/page.tsx:38-39` |
| Could the loader have produced this message? | **No.** `getAdminUser` → `listUsers` → `assertAnyPermission(userAdminCodes("read"))` **throws** on refusal (error boundary), and a missing record renders `t.users.errors.not_found`, a different string | `lib/users/service.ts:150-152, 73` |

The string « Vous n'avez pas l'autorisation de gérer les utilisateurs. » (`t.users.forbidden`)
occurs in exactly **two** places in the entire codebase — the two page gates above. So the
message pins the failure to the page gate, which means the effective permission array for
**that request** contained neither `admin:users:read` nor `admin:users:manage`.

### 3. Why this cannot be a route-level defect

Both routes read the same array, produced by the same function, for the same user id, and
apply the same predicate. **One session cannot yield both outcomes.** Therefore the two
observations were made in **two different request contexts**.

**Leading explanation:** the detail page was opened in the **private/incognito window
authenticated as the UAT account** — the window opened for B4's login step. That account was
deliberately created with **no roles** (per the B4 solo-operator procedure), so it is
authenticated (no `/login` redirect) and holds **zero** permissions — which renders exactly
this notice on `/users/{id}`. The SYSTEM_ADMIN evidence (list, create, archive) comes from
the main window.

### 4. The decisive test (no SQL, no writes)

**In the same window and tab that produced the refusal**, open `/users`:

| Result | Conclusion |
|---|---|
| `/users` **also** refuses | Session mix-up confirmed — **no defect**. Re-run the B4 steps in the SYSTEM_ADMIN window. |
| `/users` renders the directory while `/users/{id}` refuses, same tab, same minute | A genuine contradiction that the code cannot express. Escalate with: the account email shown in the topbar on **both** screens, the full `/users/{id}` URL, and whether a hard refresh changes it. The remaining candidate would be `get_user_permissions` returning an incomplete set for one request — a database-side issue, not a route-gate one. |

### 5. Effect on the release

- **Not an R1.0 blocker.** R1.0 ships no code; `app/users/[id]/page.tsx` has been in
  production since `2fec38b`, unchanged by this release.
- **Blocks B4 execution.** The lever under test — « Générer un nouveau mot de passe
  temporaire » — exists only on `/users/{id}`. B4 stays **OPEN** until the detail page is
  reachable in the SYSTEM_ADMIN session.

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
