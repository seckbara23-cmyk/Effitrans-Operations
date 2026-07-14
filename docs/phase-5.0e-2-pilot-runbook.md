# Phase 5.0E-2 — Pilot runbook

Deliverables 3 (pilot dossier), 9 (rollback), 10 (production readiness), 11 (decision
register), 13 (acceptance report).

Live tooling — do not duplicate any of this by hand:

| What | Where |
|---|---|
| Enable / disable a tenant | `/platform/rollout` (platform SUPER_ADMIN) |
| Role matrix, 26-step checklist, metrics, dossier inventory | `/settings/pilot` (tenant SYSTEM_ADMIN) |

---

## 1. Rollout model (Deliverable 1)

```
effective(feature) = global_env(feature) AND tenant_row(feature)
```

* **Global env flag** — the *kill switch*. Ships with the deployment, needs no database,
  so it still works when the database is the thing that is broken. One flip stops the
  feature for **every** tenant at once.
* **Tenant row** — the *enablement*. A platform admin toggles it with no redeploy.

Both default to false, and **a missing row means disabled**. Every unknown answer —
no row, a query error, an unresolvable tenant — resolves to OFF.

`compatibility` and `overrideAllowed` are **environment-only** and deliberately not
tenant-delegable. They are governance escape hatches (historical backfill, and the
maker-checker override), not features; a platform admin must not be able to hand a
tenant the ability to self-validate by ticking a box.

### BOOTSTRAP — do this ONCE, before anything else

There is a deadlock in the design as shipped, and it is the reason a tenant can sit at
`Tenant Engine = false` forever:

* only a `PLATFORM_SUPER_ADMIN` may write `tenant_process_rollout` (no RLS write policy,
  no table grant — deliberately, so a tenant cannot enable its own pilot);
* **no platform admin exists**, and nothing in the schema creates one (`platform_admin`
  FKs `auth.users`, so no migration and no seed can);
* therefore `/platform/rollout` is unreachable by everyone, and the tenant can never be
  enabled.

Minting the first super-admin is inherently an **out-of-band** act — the only person who
can do it is whoever holds the database. That is by design, and it is why this is a
script and not a button.

```
0. supabase db push                    # if /settings/pilot says the TABLE is missing
1. Sign in to the app once with the email you want to promote.
2. Supabase Dashboard → SQL Editor → run:
      supabase/scripts/bootstrap_platform_admin.sql   (edit the email; idempotent)
3. Sign in again → /platform/rollout is now reachable.
```

Break-glass alternative, if the UI is not an option:
`supabase/scripts/enable_tenant_rollout.sql` (edit the slug; idempotent; writes its own
audit row). The UI remains preferred because it audits the change properly.

### To start the pilot

1. Set in the deployment environment (one redeploy, once):
   ```
   EFFITRANS_PROCESS_ENGINE_ENABLED=true
   EFFITRANS_PROCESS_WORKSPACES_ENABLED=true
   EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED=true
   EFFITRANS_COLLECTIONS_ENABLED=true
   ```
   At this point **nothing changes for anyone** — no tenant has a rollout row.
2. Open `/platform/rollout` as a platform SUPER_ADMIN.
3. Enable the four capabilities for the **pilot tenant only**. Audited automatically
   (`platform.rollout.updated`, with before/after).
4. Confirm every other tenant still shows *"Processus officiel inactif"*.

Subsequent tenant toggles need **no redeploy**.

---

## 2. Pilot dossier procedure (Deliverable 3)

**Do not run the pilot on an active customer shipment.** Management approval is
required to deviate. In preference order:

1. **Dedicated sandbox tenant** *(recommended)*. A new `organization` row, provisioned
   with the standard role templates, enabled on `/platform/rollout`. Complete blast-radius
   isolation: RLS means a mistake there cannot touch Effitrans data at all.
2. **Pilot-tagged internal client + dossier** in the real tenant. Cheaper, but the pilot
   dossier is then a real row in the real ledger — it will appear in Collections aging and
   in executive reporting, and someone must remember it is fake.
3. **Cloned sanitized fixture in a non-production environment.**

### The run

Follow `/settings/pilot?tab=checklist`. It is derived from the 26-step registry, so it
cannot drift from the process the engine actually enforces. For every step it names the
actor, the route, the expected result, the evidence, and who receives the dossier next.

**Coverage is 26/26** — every official role now has a real tenant role behind it.

Three things the run must actively try to **break**, because a pass that never attempted
them proves nothing:

* **Maker-checker** (steps 6/7, 18/19, 20/21). Have the *same person* submit and then
  approve. The engine must refuse — on **identity**, not permission, so an `OPS_SUPERVISOR`
  or `SYSTEM_ADMIN` holding both halves is refused too.
* **The pickup gate** (step 15). Attempt a pickup before customs and transport have
  converged. It must be blocked, and the blocker must be stated in French.
* **Closure ≠ payment** (step 26). Record full payment and complete recovery. The dossier
  must remain **open**. Only an explicit `process:close` act by a Supervisor or System Admin
  closes it.

---

## 3. Rollback (Deliverable 9)

**One click**: `/platform/rollout` → *Rollback immédiat* → give a reason (it is written to
the audit log as `ROLLBACK: <reason>`).

What rollback does and does not do:

| | |
|---|---|
| Tenant workspaces disabled | ✅ immediately, no redeploy |
| Process engine disabled for that tenant | ✅ every sub-capability cascades off with it |
| Legacy navigation restored | ✅ the nav builder falls back to the pre-5.0C sections |
| Further process mutations | ✅ refused — every engine guard re-checks the tenant gate |
| Process records | ✅ **kept**. Nothing is deleted |
| Audit / history | ✅ **kept**. Append-only, never touched by a flag |
| Pilot data | ✅ **kept** |
| Re-enable later | ✅ safe — see below |

**Global rollback** (all tenants, no database access needed): set
`EFFITRANS_PROCESS_ENGINE_ENABLED=false`. This is the switch to reach for when the database
itself is unhealthy, which is exactly why the kill switch is checked *before* any query.

### Why toggling off and on cannot corrupt anything

* Rollout resolution is a **pure function of (env, row)**. It accumulates no state, so
  off→on lands on precisely the state you started from.
* `tenant_id` is the **primary key** of `tenant_process_rollout`, and writes are an
  `upsert` on it. A second row is not merely avoided — it is impossible.
* `first_enabled_at` is stamped only on the `false → true` transition, so re-enabling does
  not rewrite history.
* Process instances are **not** created by the flag. `initializeProcessForFile` is
  idempotent and keyed on the file; a disable/enable cycle creates no duplicate instance
  and no duplicate handoff (`process_handoff` has a unique `dedup_key`, plus a partial
  unique index on `(instance, to_step) WHERE status='SENT'`).
* A `CHECK` constraint refuses a sub-capability without the engine, so a half-rolled-back
  row cannot leave a tenant staring at permanently empty queues.

Covered by `tests/rollout.test.ts` ("toggling off and on is safe") and
`supabase/tests/rls_tenant_rollout_test.sql`.

---

## 4. Production readiness checklist (Deliverable 10)

### Database
- [x] All migrations applied — 38, replayed twice from empty in CI
- [x] All SQL suites green — 32/32 (31 RLS + numbering), `ON_ERROR_STOP=1`, **0 skipped**
- [x] No pending destructive migration — 5.0E-2 is additive only (one new table)
- [ ] **Backups confirmed** — *outside this repo. Must be verified by whoever owns the
      Supabase project before the pilot writes anything.*

### Roles
- [x] `process:override` granted to **no role** — self-validation is impossible for everyone
- [x] `process:close` restricted to `SYSTEM_ADMIN` + `OPS_SUPERVISOR`
- [x] `platform:rollout:manage` restricted to `PLATFORM_SUPER_ADMIN` (not SUPPORT)
- [x] No tenant user can write rollout state — no RLS policy, no table grant
- [ ] **Pilot users assigned** — admin-assisted; see §5
- [ ] **`FINANCE_OFFICER` still holds `finance:create`** — open decision, see §6

### Configuration
- [x] Tenant rollout flags — `/platform/rollout`
- [x] Driver direct-contact opt-in **off** (`EFFITRANS_SHARE_DRIVER_PHONE` unset)
- [ ] **Business contact number** — `PORTAL_CONTACT_PHONE`. If unset, the customer-safe
      driver contact resolves to `masked`. It never falls back to a driver's personal number
- [ ] **Physical deposit requirement** — `client.requires_physical_invoice_deposit`, per client
- [ ] **Collections** — enable only when Finance is ready to work an aging balance

### Workflow
- [x] Documents configured — catalog complete, `MISSING_DOCUMENT_TYPES` is empty
- [x] Queue ownership — 15 queues, each derived from the 26-step registry
- [ ] **Maker-checker users available** — the pilot needs **two distinct humans** for each
      of the three pairs. One person cannot test maker-checker; the engine will refuse them,
      correctly, and the step will simply never complete
- [ ] Support escalation identified

### Support
- [ ] Named pilot administrator
- [ ] Issue-reporting channel
- [ ] Rollback owner (must hold `PLATFORM_SUPER_ADMIN`)
- [ ] Daily pilot review

---

## 5. Admin-assisted user setup (Deliverable 2)

**No user is created automatically, and no password appears anywhere in this repo.**

For each role in `/settings/pilot?tab=roles`:

1. Create the user in the pilot tenant via `/users` (SYSTEM_ADMIN).
2. Assign **exactly one** operational role — the point of the pilot is to see what a real
   Déclarant sees, and a tester holding four roles sees a supervisor's screen.
3. The maker-checker pairs need **two different people**:
   * Déclarant → Chef Transit (steps 6/7)
   * Coordinateur/Account Manager → Facturation (18/19)
   * Facturation → Validation Finance (20/21)
4. Verify the landing page matches the matrix. A Coursier landing on `/dashboard` means the
   rollout did not apply — they hold no `analytics:read` and would see an empty page.

The full per-role matrix (landing, visible nav, authorized queue, primary actions,
forbidden actions, expected handoffs) is at `/settings/pilot?tab=roles`. It is **derived
from the live navigation builder and queue registry**, so it cannot describe an application
that does not exist. It is not reproduced here, deliberately: a copy would be wrong within a
sprint.

---

## 6. Management decision register (Deliverable 11)

**These are business decisions. They are not decided in code, and this phase does not
decide them.**

### 6.1 Collections balance: non-reversed vs verified-only

| | |
|---|---|
| **Today** | Balance = Σ **non-reversed** payments — the *exact* figure that drives `invoice.status`. Payments awaiting verification are a **priority signal**, not a different number. |
| **Alternative** | Count only **verified** payments. A collector then chases money the invoice already considers paid. |
| **Why it is today's answer** | A verified-only balance would **contradict the invoice**. The same dossier would be "paid" on the finance screen and "outstanding" on the collections screen, and staff would have to know which lies. |
| **Impact if changed** | A second receivables truth. Either `invoice.status` changes meaning too (a migration touching live financial records), or the two disagree permanently. |
| **Recommendation** | **Keep.** Add an *"awaiting verification"* badge if collectors need the signal — a badge, not a second number. |

*This was a deliberate deviation from the 5.0D-4 brief, flagged at the time, and still open.*

### 6.2 `FINANCE_OFFICER` holds `finance:create`

| | |
|---|---|
| **Today** | `FINANCE_OFFICER` can both **create** and **validate** an invoice. |
| **Risk** | Not maker-checker bypass — the engine refuses a maker who approves their own work, on identity, whatever they hold. The risk is *role hygiene*: the permission implies an authority the official process does not grant. |
| **Options** | (a) **Keep** — no user impact, permission stays broader than the process. (b) **Remove** — matches 5.0A; **changes existing users' capabilities in production**. (c) **Split** into `BILLING_OFFICER` (create) + `FINANCE_OFFICER` (validate) — cleanest, needs a role migration and reassignment. |
| **Recommendation** | **(c)** after the pilot. Do not change live permissions mid-pilot. |

### 6.3 Legacy dossier mapping (backfill)

**Now unblocked.** `/settings/pilot?tab=inventory` gives the count that was missing since
5.0A: dossiers by status, how many already have a process instance, how many do not, and the
age range. Read-only — it has no apply counterpart and cannot run a backfill.

| Option | When it is right |
|---|---|
| **No backfill** *(recommended to start)* | New dossiers get an instance; legacy ones finish on the legacy lifecycle. Zero risk. The two coexist — the queues already exclude instance-less dossiers **by construction**. |
| **Manual initialization** | A handful of high-value in-flight dossiers, initialized deliberately by a supervisor. |
| **Controlled automated mapping** | Only after the inventory is reviewed. `mapDossierToOfficialStep()` never marks a step *completed* — only `assumed`/`unverified` — so a backfilled dossier is visibly reconstructed, not fabricated. |

**Decide only after reading the real numbers.** Terminal dossiers (DELIVERED/CLOSED) are
the safest to leave alone entirely.

### 6.4 Official SLA policy

21 policy keys, **all `unconfigured`**. Four legacy thresholds are live and marked
`unratified`.

5.0E-2C removed the wording that presented them as contractual (*"Dépassements SLA"*,
*"Principaux goulots (SLA)"*) and replaced it with *"Alertes de délai internes"* and
*"Seuils opérationnels provisoires"*. **That is a wording fix, not a policy.** Management
still owes:

* approved values per process step,
* escalation rules,
* and — the one that matters — **which targets are contractual and which are internal**.

Until then the product must not claim a breach of commitment, and now it does not.

---

## 7. Pilot acceptance report (Deliverable 13)

**Filled in by the pilot administrator after the run.** What follows is what the *code*
guarantees; the empty fields are what only a real run can tell you. Automated tests passing
is not production readiness, and this section must not be signed off from CI alone.

### Verified by automation (CI run 29350011333 — both jobs green, 0 skipped, 32/32 SQL suites, 1,328 tests, build green)

* All 15 official roles have a landing page they can open, and a sidebar that is not empty.
* Each specialist sees **exactly one** queue; the supervisor sees the cross-department view.
* A Coursier lands on `/courier`, never on a dashboard they cannot read.
* No raw role code, process key, or document code reaches a staff screen.
* One tenant can be enabled without enabling any other — including with the deployment fully
  switched on.
* A tenant `SYSTEM_ADMIN` **cannot** enable their own pilot (no RLS policy, no grant).
* Off→on is idempotent: no duplicate instance, no duplicate handoff, no lost history.
* Workbench tabs partition — one item in exactly one tab, so every count is a real count.
* A maker never sees their own submission under *"À valider"*.
* No unratified threshold is presented as a contractual SLA.

### Only a real run can establish

- [ ] Roles tested (with **distinct humans** on the maker-checker pairs)
- [ ] Dossier steps completed end to end
- [ ] Failed scenarios
- [ ] UX issues — is *"Qui détient le dossier ?"* actually answerable at a glance?
- [ ] Authorization failures observed (`/settings/pilot?tab=metrics` → *Accès refusés*)
- [ ] Performance observations (queue load times under real volume)
- [ ] Rollback exercised **on the pilot tenant, deliberately**, mid-run

### Readiness classification

**Current honest classification: `internal pilot ready`.**

Not *limited production pilot ready*, and the gap is not in the code:

1. **Backups are unverified.** Outside this repo. Nobody should write a real dossier through
   a new engine without knowing the restore path works.
2. **No dossier has ever traversed the 26 steps with real users.** Every step is implemented
   and tested; not one has been executed by a human who does the job.
3. **Maker-checker has never been tested with two real people.** The refusal is unit-tested;
   the *workflow* around it — the correction coming back, being understood, and being redone
   — has not been observed.
4. **SLA policy is unratified** (§6.4) and `FINANCE_OFFICER` permissions are unresolved (§6.2).

None of these is a code defect. All four are reasons the honest answer is "run the internal
pilot first".

Promote to **limited production pilot ready** when: backups verified, one dossier through
26/26 with distinct humans, rollback exercised at least once, and §6.2/§6.4 decided.
