# Release R1.0 — Official Sign-off

**Release:** R1.0 — *Production migration-ledger reconciliation and operational validation*
**Prepared:** 2026-07-31 · **Status:** ☐ **OPEN — awaiting §3 results and §4 signatures**

> This document is the release record. It is **not valid until every box in §3 is
> resolved and §4 is signed**. Sections 1 and 2 are already established fact, evidenced
> below; sections 3–5 are completed by the seats that perform the work.

---

## 1. Scope

R1.0 is a **reconciliation and validation** release. It contains:

| Included | Excluded |
|---|---|
| Migration-ledger reconciliation to 72/72 (metadata only) | Any DDL — no migration was executed |
| Documentation of the verified production state | Any code change — production already served current `main` |
| Operational validation of the already-deployed behaviour of migrations 69, 70, 71 | Any activation — the Finance Aging workspace stays dark (that is **R1.1**) |

Production was **already serving** this code and **already carried** this schema. R1.0
makes the *record* match the *system* and proves the system behaves.

---

## 2. Established facts (evidence held)

### 2.1 Pre-repair state

Ledger recorded **56 of 72** migrations (last `20260724000001`) while the schema was
structurally at **72**. Cause: history gap, not unapplied work — consistent with the 9.0F
finding that the CLI ledger was empty of the phase-era migrations.

### 2.2 Structural verification — 30/30

`docs/releases/R1.0/verification-57-67.sql`, read-only, run by the operator in the Supabase
SQL editor: **all 30 rows returned `passed = true`**, including three negative controls
(nonexistent table / function / permission row) that validate the probe method itself.

Two earlier evidence rows had been **wrong-object** and were corrected before this run:

| Migration | Rejected evidence | Accepted fingerprint |
|---|---|---|
| 60 `expense_approval_chain` | `expense_visa` table — created by **58** | `uq_expense_visa_attempt_step` index **+** TREASURER holding `finance:expense:sign` (58 granted it to nobody) |
| 63 `business_event_atomicity` | `business_event.causation_id` — created by **62** | `EF001` abort marker present in the replaced `emit_business_event` / `emit_dossier_events` bodies |

A REST RPC probe reading `reconcile_step_completion` as "absent" was **retracted**:
`PGRST202` also fires on signature mismatch. Catalog queries replaced it.

### 2.3 The repair

Executed 2026-07-31 under explicit operator GO, after the stop-gate confirmed exactly
56 recorded / 16 unrecorded:

```
npx supabase migration repair --status applied \
  20260724000002 … 20260729000002        (16 versions, one invocation)
→ Repaired migration history: [ … ] => applied
```

No `db push`. No manual `INSERT` into `supabase_migrations`. No migration re-run. The
mechanism writes **history only**, in both directions (§5 reversal).

### 2.4 Post-repair verification

| Check | Expected | Actual |
|---|---|---|
| `migration list` total | 72 | **72** |
| Recorded (LOCAL = REMOTE) | 72 | **72** |
| Unrecorded | 0 | **0** |
| LOCAL ≠ REMOTE | 0 | **0** |
| Last version | `20260729000002` | **`20260729000002`** |
| `schema_migrations` count *(operator, SQL editor)* | 72 | **72** |
| `admin:users:%` permissions | 8 | **8** — 7 granular from migration 71 **+** the retained deprecated umbrella `admin:users:manage` (71 rewrites its description rather than deleting it; the server still accepts it as the expand→contract fallback) |
| `finance:aging:%` permissions | 11 | **11** |
| Schema unchanged by the repair | tables/columns identical | `employee`, `business_event`, `document.artifact_code`, `invoice.provenance`, `aging_report` all still resolve |

### 2.5 Build and deployment

| Item | Value |
|---|---|
| Served SHA at repair time | `1abccda` (`env=production`, `hosted=true`) |
| Documentation commit | `d8b37d8` — CI **green**: build success (10 steps), rls-tests success (66 steps), **0 skipped** |
| Schema/code changes in R1.0 | **none** |

---

## 3. Operational validation results

Executed per [`R1.0/operator-validation-checklist.md`](R1.0/operator-validation-checklist.md).
R1.0 cannot be signed with an unresolved row.

| # | Check | Seat | Result | Date | Evidence / notes |
|---|---|---|---|---|---|
| A1 | Served SHA = `main` HEAD | Operator | ✅ **PASS** | 2026-07-31 | `5b24164a57fc45cdf82221ade7ebbe2634d838c9` = `main` HEAD; verified inside A2's version check |
| A2 | Production verification sweep (exit 0) | Operator | ✅ **PASS** | 2026-07-31 | `verify-production.mjs` → ALL CHECKS PASSED, **exit code 0**; SHA `5b24164a57fc45cdf82221ade7ebbe2634d838c9` |
| A3 | Ops dashboard: `72 · dernière : 20260729000002_…`, no `warn` | Operator | ✅ **PASS** | 2026-07-31 | Commit `5b24164a57fc…`, branche `main`, env `production`, **Migrations livrées 72**, dernière `20260729000002_aging_balance_foundation`, Déploiement **Sain**, base de données joignable, Santé plateforme **Sain**, Sécurité **Sain** |
| B1 | Invoice three-hash on `EFT-INV-2026-00001` | DAF / Finance | ☐ PASS ☐ FAIL | | H = |
| B2 | Customs discovery without assignment | Chef de transit / Douane | ☐ PASS ☐ FAIL | | role = |
| B3 | Closure of `EFT-IMP-2026-00003` | OPS_SUPERVISOR | ✅ **PASS** | 2026-07-31 | Statut = **Clôturé**; full lifecycle history preserved (Brouillon → Ouvert → En cours → Livré → Clôturé); operational journal intact after closure; official invoice artifact and generated documents still present; journal read-only/immutable. « Supprimer le dossier » remains visible — **EXPECTED GATE**, see OBS-R10-07 |
| B4 | Temporary-password lifecycle | SYSTEM_ADMIN + test account | ✅ **PASS** | 2026-07-31 | Admin-issued temp password generated from `/users/{id}`; status became « Mot de passe temporaire en attente de changement »; login **forced** to `/auth/change-password`; password changed; `/dashboard` reachable only afterwards. First attempt (creation-time password) tested the wrong path — see **DEF-R10-01**; the intermediate refusal is **DEF-R10-03**, both in [`R1.0/validation-findings.md`](R1.0/validation-findings.md). Expired path: **deferred** (preview-only; production writes to force expiry not authorized). |

**Deviations, substitutions and refusals recorded during validation** *(a gate that
correctly refuses is a pass for the gate — record it here rather than forcing it)*:

- **2026-07-31 · B4 · DEF-R10-01** — a test account was created with credential mode
  « générer »; its creation-time password did **not** force a change at first login.
  Root cause: `createUser` never writes `must_change_password` (column defaults to
  `false`), while the create panel's own wording promises a forced change. The
  migration-71 lever (`generateStaffTempPassword`) is a **different** path and does arm
  the gate — it remains untested. Classified an **implementation defect, pre-existing,
  not an R1.0 blocker**; B4 stays OPEN pending retest. Full analysis:
  [`R1.0/validation-findings.md`](R1.0/validation-findings.md).

```
_____________________________________________________________________________
_____________________________________________________________________________
```

---

## 4. Signatures

| Seat | Scope | Name | Result | Date | Signature |
|---|---|---|---|---|---|
| Operator | A1–A3, ledger reconciliation | | ☐ accept ☐ reject | | |
| DAF / Finance Manager | B1 | | ☐ accept ☐ reject | | |
| Chef de transit | B2 | | ☐ accept ☐ reject | | |
| OPS Supervisor | B3 | | ☐ accept ☐ reject | | |
| SYSTEM_ADMIN | B4 | | ☐ accept ☐ reject | | |
| Release owner | R1.0 as a whole | | ☐ **RELEASED** ☐ held | | |

---

## 5. Rollback position

**Nothing in R1.0 requires a schema rollback, because R1.0 changed no schema.**

- Ledger reversal (only if a version was repaired in error):
  `npx supabase migration repair --status reverted <version>` — history-only, in both
  directions. Asymmetry of risk: a version wrongly marked *applied* makes the CLI skip a
  migration that genuinely needs to run (reverse it at once); a version wrongly *reverted*
  only reappears as pending, which the stop-gate catches.
- Application rollback: redeploy the previous Vercel build. No coupling to the ledger.
- A failed §3 check does **not** call for a rollback — it calls for the remedy named in the
  checklist's "if it fails" column, and it blocks the signature until resolved.

---

## 6. What R1.0 explicitly does not deliver

The Finance Aging workspace remains **dark**: `EFFITRANS_FINANCE_AGING_ENABLED` is unset
in production, so `/finance/aging` 404s even though migration 72's schema and grants are
live. Activation is **R1.1** and does not begin until R1.0 is signed **and** Q-01 is closed
verbatim — « Montant = outstanding balance as of the reporting date ». The order is
deliberate: the number's meaning is confirmed before the number is shown.

**R1.0 is complete when §3 has no unresolved row, §4 is signed, and `STATUS.md` records
the outcome.**
