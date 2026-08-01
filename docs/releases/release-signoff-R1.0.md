# Release R1.0 — Official Sign-off

**Release:** R1.0 — *Production migration-ledger reconciliation and operational validation*
**Prepared:** 2026-07-31 · **Status:** ✅ **RELEASED — 2026-08-01**

> This document is the release record. §3 closed on 2026-08-01 with zero unresolved
> rows — every check PASS, every deviation recorded with its classification. §4 was
> signed the same day (see the signature-provenance note). **R1.0 is complete.**
> The four deferred items listed under §4 carry their re-test triggers and are the
> only open threads; none reopens this release.

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

> **Commit identifiers after 2026-07-31.** A repository-history sanitation on 2026-07-31
> (two business documents purged from a public repo) changed **five** commit SHAs. **No
> application behaviour, code, schema or configuration changed** — trees are identical apart
> from the removed files, and every SHA cited in this document predates the rewrite and still
> resolves. Mapping and verification:
> [`R1.0/history-sanitation-2026-07-31.md`](R1.0/history-sanitation-2026-07-31.md).
> The invoice-renderer fix, recorded below as `106423a`, is now **`733c116`**.

---

## 3. Operational validation results

Executed per [`R1.0/operator-validation-checklist.md`](R1.0/operator-validation-checklist.md).
R1.0 cannot be signed with an unresolved row.

| # | Check | Seat | Result | Date | Evidence / notes |
|---|---|---|---|---|---|
| A1 | Served SHA = `main` HEAD | Operator | ✅ **PASS** | 2026-07-31 | `5b24164a57fc45cdf82221ade7ebbe2634d838c9` = `main` HEAD; verified inside A2's version check |
| A2 | Production verification sweep (exit 0) | Operator | ✅ **PASS** | 2026-07-31 | `verify-production.mjs` → ALL CHECKS PASSED, **exit code 0**; SHA `5b24164a57fc45cdf82221ade7ebbe2634d838c9` |
| A3 | Ops dashboard: `72 · dernière : 20260729000002_…`, no `warn` | Operator | ✅ **PASS** | 2026-07-31 | Commit `5b24164a57fc…`, branche `main`, env `production`, **Migrations livrées 72**, dernière `20260729000002_aging_balance_foundation`, Déploiement **Sain**, base de données joignable, Santé plateforme **Sain**, Sécurité **Sain** |
| B1 | Invoice three-hash on `EFT-INV-2026-00001` | DAF / Finance | ✅ **PASS** | 2026-08-01 | Served SHA `c29b7cf` verified. **Staff endpoint: PASS** — HTTP `200` · `Content-Type: application/pdf` · `Content-Length: 3073` · `Content-Disposition: inline; filename="EFT-INV-2026-00001.pdf"` · **H1** `A1442D1311AB2845EDB24480A28401268EB8F532FDC9CCF74EEFDD21928C8C2E`. **Portal endpoint: PASS** — **H2** `A1442D1311AB2845EDB24480A28401268EB8F532FDC9CCF74EEFDD21928C8C2E`. **Downloaded file** (« Enregistrer la cible du lien sous… »): length `3073` = Content-Length ✔ · **H3** `A1442D1311AB2845EDB24480A28401268EB8F532FDC9CCF74EEFDD21928C8C2E`. **Result: H1 = H2 = H3** (hex case differs from the lowercase response header; SHA-256 comparison is case-insensitive). One artifact serves both paths; the stored hash describes the served bytes. Corrected-layout check (`uat2b-2`) **deferred** to the next naturally issued invoice — a DEF-R10-05 verification, outside B1's criterion. |
| B2 | Customs discovery without assignment | Douane (CUSTOMS_DECLARANT) | ✅ **PASS — with stated limitation** | 2026-07-31 | Seat `uat.douane@effitrans.sn`, sole role **CUSTOMS_DECLARANT**; no ownership/task/step/assignment history **by construction** (account created for this test). Saw **3 dossiers on `/files`** — a LIST, which only the migration-69 coarse filter can produce. Opened `EFT-IMP-2026-00002`: Douane panel present, `customs_record` badged « **Requis** » (= `required = true`), page attributes access itself: « **Visible parce que : Département destinataire** ». **Limitation (operator, verbatim):** « Contrôle négatif non exécutable — aucun dossier sans volet douane requis n'existe en production au moment de la validation. » |
| B3 | Closure of `EFT-IMP-2026-00003` | OPS_SUPERVISOR | ✅ **PASS** | 2026-07-31 | Statut = **Clôturé**; full lifecycle history preserved (Brouillon → Ouvert → En cours → Livré → Clôturé); operational journal intact after closure; official invoice artifact and generated documents still present; journal read-only/immutable. « Supprimer le dossier » remains visible — **EXPECTED GATE**, see OBS-R10-07 |
| B4 | Temporary-password lifecycle | SYSTEM_ADMIN + test account | ✅ **PASS** | 2026-07-31 | Admin-issued temp password generated from `/users/{id}`; status became « Mot de passe temporaire en attente de changement »; login **forced** to `/auth/change-password`; password changed; `/dashboard` reachable only afterwards. First attempt (creation-time password) tested the wrong path — see **DEF-R10-01**; the intermediate refusal is **DEF-R10-03**, both in [`R1.0/validation-findings.md`](R1.0/validation-findings.md). Expired path: **deferred** (preview-only; production writes to force expiry not authorized). |

**Deviations, substitutions and refusals recorded during validation** *(a gate that
correctly refuses is a pass for the gate — record it here rather than forcing it)*:

- **2026-07-31 · B2 · negative control not executed.** Operator decision, recorded verbatim:
  « Contrôle négatif non exécutable — aucun dossier sans volet douane requis n'existe en
  production au moment de la validation. » Production held exactly three dossiers
  (`EFT-IMP-2026-00001/2/3`), all visible to both SYSTEM_ADMIN and the customs seat.
  **What is evidenced:** a customs-role account with no assignment of any kind discovered
  dossiers in a *list*, on a dossier whose customs record is badged « Requis », with the
  application attributing access to a department relation — the behaviour migration 69 adds.
  **What is not evidenced:** that the filter *excludes* a dossier without a required customs
  leg. No such dossier existed to test against, and the option to create a disposable control
  was declined. Per-dossier verification of the other two (Check A) and their access-reason
  attribution (Check B) were not captured, so the limitation's premise rests on the
  operator's reading of the dataset rather than on a recorded per-dossier check. The
  `/departments/customs` queue result for the customs seat was likewise not captured.
  **Re-test trigger:** the first production dossier created without a required customs leg
  makes this control executable — run it then.
- **2026-07-31 · B3 · OBS-R10-07** — « Supprimer le dossier » stays visible on a closed
  dossier. **EXPECTED GATE:** it is a true physical delete, permitted only for an empty
  shell; the invoice artifact, documents, customs and transport records on
  `EFT-IMP-2026-00003` make it structurally undeletable, and the UI names the refusal.
  Residual for governance: the guard is content-based, not lifecycle-based.
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

> **Execution note for the signers.** All seven §3 checks were physically executed by the
> platform operator, who held the relevant production sessions (including the dedicated
> UAT seats `uat.r10@…` and `uat.douane@…` created for B4/B2). A signature below
> therefore attests to *reviewing the recorded evidence for that scope*, not to having
> personally executed the steps. Where one person occupies several seats, sign each
> scope-row they are accountable for — the rows exist so each scope is consciously
> accepted, not to manufacture five people.

| Seat | Scope | Name | Result | Date | Signature |
|---|---|---|---|---|---|
| Operator | A1–A3, ledger reconciliation, B1 execution | Bara Seck | ☑ **accept** | 2026-08-01 | B.S. — entered on the operator's explicit close-out instruction |
| DAF / Finance Manager | B1 evidence | Bara Seck *(seat held by the operator; see execution note)* | ☑ **accept** | 2026-08-01 | B.S. |
| Chef de transit / Douane | B2 evidence (incl. the stated limitation) | Bara Seck *(seat held by the operator)* | ☑ **accept** | 2026-08-01 | B.S. |
| OPS Supervisor | B3 evidence | Bara Seck *(seat held by the operator)* | ☑ **accept** | 2026-08-01 | B.S. |
| SYSTEM_ADMIN | B4 evidence | Bara Seck *(seat held by the operator)* | ☑ **accept** | 2026-08-01 | B.S. |
| Release owner | R1.0 as a whole, incl. deferred items (§3 deviations) | Bara Seck | ☑ **RELEASED** | 2026-08-01 | B.S. |

> **Signature provenance.** Entered 2026-08-01 on the operator's explicit written
> close-out instruction. One person — the platform operator, who executed every check —
> occupies all six seats, as the execution note above anticipates. If the business seats
> (DAF, Chef de transit, OPS Supervisor) are later staffed by their own holders, their
> countersignature of this record is welcome but does not reopen the release.

**Deferred items the release owner accepts by signing** (all recorded above with
classifications; none is an R1.0 gate):
1. B2 negative control — not executable in the current dataset; re-test trigger recorded.
2. B4 expired-password path — preview-only by rule; not yet run.
3. B1 corrected-layout check — awaits the next naturally issued invoice (`uat2b-2`).
4. DEF-R10-01 (creation-path password does not arm the gate) and DEF-R10-03 (bare catch
   conflates failure classes) — pre-existing defects, scheduled outside R1.0.

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
the outcome.** *All three conditions met 2026-08-01 — see §7.*

---

## 7. Final Release Sign-Off Report — R1.0 RELEASED 2026-08-01

**Verdict: RELEASED.** First release under the RELEASE-0 framework, run manually end to
end, as the framework prescribes for its first two executions.

| Dimension | Outcome |
|---|---|
| Migration ledger | 56/72 → **72/72**, metadata-only repair, 30/30 evidence rows first, zero DDL |
| Schema / code shipped by R1.0 | **none** — reconciliation + validation only |
| Validation | A1–A3, B1–B4 **all PASS**; B1 three-hash `H1 = H2 = H3` (`A1442D13…8C2E`, 3 073 bytes); B2 with a stated, verbatim-recorded limitation |
| Defects found by the UAT | **DEF-R10-01** (create-path password never arms the gate), **DEF-R10-03** (bare catch conflates failure classes), **DEF-R10-05** (invoice renderer bottom-up — **fixed**, `uat2b-2`, immutable artifacts untouched) — none introduced by R1.0, all recorded in `R1.0/validation-findings.md` |
| Expected gates observed | closure blockers, self-issue refusal, empty-shell delete guard (OBS-R10-07) — the system refusing correctly, recorded as passes for the gates |
| Incidents during the cycle | two business documents briefly committed to the public repo → **history sanitised** (5 SHAs remapped, fresh-clone verified, `R1.0/history-sanitation-2026-07-31.md`); GitHub Support GC request pending |
| Production at close | `main` = served SHA, `verify-production.mjs` ALL PASS, CI green per job on every commit of the cycle |
| Deferred (with triggers) | B2 negative control · B4 expired path (preview) · B1 layout check (next new invoice) · DEF-R10-01/-03 remediation |
| Opens next | **R1.1 Finance Aging activation** — D3 closed by this signature; remaining gates D1 (Q-01 verbatim), D2 (preview visual sign-off), D4 (grant matrix check), then D5–D7 |
