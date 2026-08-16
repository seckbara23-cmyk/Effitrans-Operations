# EFFITRANS-HR-7 — Préparation de paie : audit & ratification gate

**Date:** 2026-08-16 · **Baseline:** `f5eeab3` (CI #480 GREEN, prod 109/109) · **Audit only — nothing modified.**

## The verdict in one paragraph

The boundary question is already answered **by ratified governance, not by this
audit**: HR-0F (§ roadmap + risk R7) defines HR-7 as *« compensation domain (C3)
+ versioned Finance export — an interface, **never a payroll engine** (DEC-B63:
preparation + export only; a payroll engine is out of scope permanently until
separately ratified) »*. Repository evidence supports it from both sides: the
platform holds **zero** salary/payroll artifacts anywhere (DEC-B27 is enforced
in code — `employee` has no compensation column, the audit layer notes salary
fields "do not exist to log", `employee_identifier` is **deliberately absent**
pending DEC-B63's legal gates), and the accounting boundary is external (SAGE-0:
Effitrans runs Sage 100 i7; MAYA-0 found the vendor system has no payroll
either — so pay is computed outside this platform today and nothing here should
pretend otherwise). Every governance pattern HR-7 needs already exists and is
production-proven: the FIN-AGING **copied-not-joined immutable snapshot** with
`finalizer ≠ preparer`, the HR four-eyes idiom, the B1/B2 identity lanes and
actor integrity, the two-tier C3 reads, the integer-minor-unit money
discipline, and the HR-B3 XLSX builder for the export artifact. The one design
decision that gates implementation is **whether v1 carries money at all** —
this audit recommends it does not.

---

## 1. Architecture discovered

**HR (all live, dark or active):** employee registry (matricule engine,
lifecycle DRAFT→ACTIVE→…, ledgered); effective-dated `employee_assignment`
(open PRIMARY idiom, manager line, append-and-close history); positions / org
units / sites (HR-C1 full CRUD); `employment_contract` (kind, dates, probation,
**maker-checker prepared/verified, no compensation column**); leave (day-tenths
entitlements, DB-enforced lifecycle, B1 identity lanes); attendance
(`hr_attendance_day`: recorded `worked_minutes` 0–1440, source
MANUAL/IMPORT/DEVICE — **no schedule, no lateness, no overtime concept**);
`hr_configuration` (vocabularies: employment_kinds, termination_reasons,
performance_cycle_kinds — all tenant-named); imports (stage→validate→four-eyes
visa→apply); append-only `hr_employee_event` ledger + audit discipline (facts,
never C3 values); B1/B2 identity lanes with the shared linked-employee resolver
and HR630 actor integrity; C3 two-tier reads + Q2 identity-scoped disclosure;
role templates with the Direction seats (DAF/DGA) carrying both activated HR
authorities; `hr:sensitive:read` parked, granted to NOBODY.

**Finance:** FIN-AGING (report lifecycle `DRAFT→VALIDATED→FINAL→SUPERSEDED/
CANCELLED`, snapshot rows *"Copied, not joined: renaming a client must not
rewrite a finalized report"*, template-version pinning, stored aggregates so a
report "can PROVE its own consistency later", `finalized_by <> prepared_by`
CHECK, integer minor units in `lib/finance/aging/money.ts`); expense documents
(ordered visa chains, DAF/DGA/Trésorière seats); invoices/payments — **client
money**, a different domain from wages.

**Payroll artifacts: none.** Repo-wide sweep (`payroll|paie|salair|salary|
remunerat|wage`) finds only client-payment strings, the DEC-B27 "does not
exist" comments, and the hub tile `« Préparation de paie — À venir — HR-7 »`
([hr/page.tsx:165](../../app/departments/hr/page.tsx)).

## 2. Existing capabilities to reuse

| Need | Existing capability |
|---|---|
| Immutable, reproducible period snapshot | FIN-AGING copied-not-joined idiom + stored aggregates + version/supersede |
| Four-eyes | contract verifier≠preparer CHECK; import `same_actor`; aging finalizer≠preparer; HR616 |
| Identity & actor integrity | `lib/hr/identity.ts` resolver; HR630/EFA idiom in every recent RPC (INV-7) |
| C3 discipline | two-tier reads (columns not requested), audits without values, private HR bucket |
| Money without floats | aging integer minor units (XOF scale) |
| Export artifact | HR-B3 hand-rolled XLSX builder; CSV precedents; sha256 fingerprint idiom (EMP-4A) |
| Vocabulary-not-enum | employment_kinds / performance_cycle_kinds — tenant names the words |
| Authority seats | DAF/DGA Direction pattern (migrations 108/109), CEO-ungranted assertions |
| Period facts | employees, assignments (dated history ✓), approved leave, recorded attendance, contracts, status ledger |

## 3. Genuine gaps

1. **No period/snapshot/adjustment/export tables** — the whole HR-7 domain.
2. **No compensation data of any kind** — deliberate (DEC-B27/B63); creating it
   is the single biggest step and is severable (see §4).
3. **No statutory identifiers** — `employee_identifier` (CNI/IPRES/CSS/IPM/
   NINEA) was designed in HR-0F and deliberately not built pending DEC-B63's
   legal gates on storage/retention. A payroll export without them may be fine
   for an internal handoff; the accountant's needs decide (Q6).
4. **No schedule model** → lateness/overtime are **not derivable** from
   recorded minutes alone; anything beyond "minutes recorded / days with
   entries" needs a ratified work-schedule concept (defer).
5. **No payroll calendar** (period definition, cutoff day) — configuration.
6. **No hr:payroll:\* permissions** — to be catalogued parked, activated by
   ratification (the hr:leave:approve playbook).

## 4. Recommended HR-7 scope — answer to the boundary question

**Option A: payroll preparation + controlled export/handoff. Nothing else.**
That is what DEC-B63 ratified, what Sage-as-accounting implies, and what the
absent statutory rules require. Explicitly out: calculation, payment execution,
accounting entries, declarations, payslips, and any duplication of Finance.

**The severable decision (Q1):** a preparation period can be built in two
tiers —
* **Tier 1 — facts & quantities (recommended v1):** identity, assignment,
  contract kind, movements (hired/terminated in period), status at cutoff,
  attendance minutes/days, approved leave day-tenths by category (with the
  category's `is_paid` flag, currently NULL = unknown), absence days, and
  QUANTIFIED adjustments (e.g. "prime X: quantity/reason/evidence") **without
  amounts**. Zero compensation storage → no new C3 class, no DEC-B63 legal
  gate, immediately buildable, immediately useful to whoever computes pay.
* **Tier 2 — amounts (HR-7E, gated):** monetary adjustment values and/or base
  salary. First compensation data in the platform; requires DEC-B63's legal
  gates plus the sensitive-data model in §9. Additive later.

## 5. HR ↔ Finance boundary

HR owns: population, presence facts, movements, approved adjustments,
verification, four-eyes approval, the LOCK, and the versioned export artifact.
The handoff is **an approved immutable snapshot rendered as a downloadable
XLSX/CSV** (HR-B3 builder; columns per Q6) with a registered, sha256-stamped
export history — consumed by the external payroll process (accountant / Sage
side). Finance's existing machinery (invoices, payments, expense visas, caisse)
is **client- and expense-money** and must not be bent into wage payment; if
Effitrans later wants an in-platform "salaries paid" record, that is a Finance
phase consuming HR's snapshot, never HR writing Finance tables. No accounting
entries, no Sage writes (P6 boundary stands).

## 6. Conceptual data model (no DDL — shape only)

* `hr_payroll_period` — tenant, code (« 2026-09 »), period_start/end, cutoff
  timestamp, status, prepared/verified/approved/locked actors+times, version,
  supersedes_period_id, unique (tenant, code, version).
* `hr_payroll_period_line` — one row per included employee, **copied not
  joined** at PREPARE: matricule, names, department, unit/position/site labels,
  contract kind, hire/termination dates in period, status at cutoff, worked
  minutes + attendance-day count, approved leave tenths per category (+
  is_paid flag as recorded), absence summary, adjustment refs. C3-classed as a
  bloc even in Tier 1 (aggregated presence is personal data).
* `hr_payroll_adjustment` — period+employee, kind from a **tenant vocabulary
  shipping empty**, quantity (integer) and/or amount (Tier 2 only, integer
  minor units), reason, evidence `hr_document`, proposer/approver with a
  differs CHECK, status.
* `hr_payroll_export` — period version, format, sha256, storage path
  (**private** HR bucket, never `documents`), exported_by/at.

## 7. Proposed lifecycle

`DRAFT → PREPARED → VERIFIED → APPROVED → LOCKED`, with `CANCELLED` (reason
required) from any pre-LOCKED state and correction by **supersession** (new
version, old row intact — the aging/objective idiom). Snapshot taken at
PREPARED and refreshable until VERIFIED (re-prepare = re-copy); APPROVED
freezes content; LOCKED is trigger-immutable and is the only state that may
export. Duplicate periods refused by the unique key; re-preparing is idempotent
per version.

## 8. Authority / maker-checker matrix (proposed — nothing granted)

| Act | Who (proposed) | Mechanism |
|---|---|---|
| Create/prepare/verify period, propose adjustment | HR_OFFICER | existing `hr:manage` |
| Approve adjustment | second HR officer or Direction | differs-CHECK + four-eyes (approver ≠ proposer) |
| Approve period | **new parked `hr:payroll:approve`** → DAF/DGA when ratified | approver ≠ preparer CHECK + RPC (INV-7) |
| Lock + export | approval authority (or a separate parked `hr:payroll:export` if Effitrans wants the split) | audited, versioned |
| Read compensation-grade content | see §9 | two-tier reads |

CEO: **no evidence** of operational participation anywhere in the HR/Finance
authority record — excluded unless explicitly ratified (the standing question-a
boundary). Finance roles get read of the LOCKED artifact only if ratified (Q7).

## 9. Sensitive-data model

Least privilege, three layers: workflow (who/which period/status) rides
`hr:read` like every HR surface; **line content** (per-person presence facts,
Tier 1) rides a two-tier read as HR-6 does — but on a **new, narrower parked
`hr:payroll:read`**, NOT on `hr:sensitive:read`, which stays parked and
unbroadened (it is the org-wide everything-sensitive authority; payroll needs
its own narrower door). Tier 2 amounts, if ever ratified, live behind the same
payroll-specific authority plus DEC-B63's legal gates. Identity-scoped
disclosure (an employee seeing their own line) is **not assumed** — it is Q8,
the Q2-of-payroll. Audits record THAT, never a quantity or an amount.

## 10. Reproducibility

The snapshot is the answer: copied-not-joined lines + stored aggregates + the
cutoff timestamp make a LOCKED period self-proving, exactly like an aging
report. Flagged weaknesses the snapshot exists to neutralize: `hr_attendance_day`
is **upsertable** (a later correction would silently change an "as-of" query;
the copied line pins what was true at cutoff); unit/position/site names are
mutable (labels copied); leave decided after cutoff must not leak in (cutoff
filter on `decided_at`). Assignments and employee status already keep honest
history (append-and-close; ledger).

## 11. UX plan (minimum useful surface)

The hub tile becomes `/departments/hr/paie`: period list (status badges, «
Nouvelle période »); period detail — population table with per-employee facts;
**exceptions panel** (terminated mid-period, zero attendance recorded, leave
overlapping cutoff, no active contract, DRAFT employees excluded-with-count);
adjustments (propose/approve); « Vérifier » → « Approuver » (Direction) → «
Verrouiller » → « Exporter (XLSX) » + export history with fingerprints. French
throughout; no employee self-service in v1 (no payslips exist to show).

## 12. Senegal / Effitrans configuration questions

No statutory rule is invented. Everything below is theirs to name: adjustment
vocabulary (primes, indemnités, retenues — words and whether amounts belong in
the platform at all = **Q1**); export columns the accountant/Sage process needs
(Q6); payroll calendar + cutoff (Q5); `is_paid` per leave category (currently
NULL = unknown — Q4); overtime/lateness rules and any schedule model (Q9 —
defer); statutory identifiers activation (CSS/IPRES/IPM/NINEA — blocked on
DEC-B63 legal, Q10); approver seats (Q7); rounding rules only if Tier 2 ever
computes anything (it should not).

## 13. Security & test plan

New SQL suite (EFA08 jwt-clearing discipline; appended LAST, runs-last pin
moves): tenant isolation; HR630 actor integrity on every new RPC; maker-checker
(preparer≠approver, proposer≠approver refused at DB); LOCKED immutability
(trigger, incl. line rows); duplicate period refusal + idempotent re-prepare;
inclusion/exclusion (ACTIVE in, DRAFT out, terminated-in-period IN with
end date); leave/attendance cutoff (post-cutoff decision excluded); unauthorized
reads (no `hr:payroll:read` → workflow only, prose/facts withheld);
unauthorized approve/export (EFA15); cross-tenant refusal; export fingerprint
recorded; audit events per transition. Vitest: pure snapshot/aggregation rules,
disclosure rule, structural pins. Mutation targets: widen inclusion predicate,
drop the differs CHECK, read live tables instead of the snapshot at export,
skip the cutoff filter, grant CEO. Pins that will move: HR-A1 parked-set (new
parked codes join it), the hub `SoonTile` (workspace-activation tests pin it),
ledger counts, runs-last.

## 14. Dependencies / blockers

* **BUILDABLE NOW:** the entire Tier-1 domain — periods, snapshot, exceptions,
  quantified adjustments over an empty vocabulary, lifecycle, four-eyes,
  parked permissions, XLSX export skeleton with provisional columns.
* **NEEDS EFFITRANS ANSWER:** Q1 (amounts in scope?), Q5 calendar, Q6 export
  columns, Q4 leave is_paid, Q7 seats, Q8 self-disclosure, Q10 identifiers.
* **NEEDS STAFFING/CONFIG (not defects):** 2nd HR Officer (four-eyes), DAF/DGA
  members (approval inert until staffed), real attendance/leave data being
  entered, employee account links.
* **OUT OF SCOPE (permanently, per DEC-B63 unless separately ratified):**
  calculation, payments, accounting entries, declarations, payslips.

## 15. Proposed implementation phases

**HR-7A** foundation (migration 110: tables + lifecycle RPCs with INV-7 lanes +
parked permissions, dark) → **HR-7B** preparation surface (snapshot, population,
exceptions, verify) → **HR-7C** adjustments (vocabulary + four-eyes) →
**HR-7D** approve/lock/export + export registry (needs Q6/Q7) → **HR-7E**
amounts (only after Q1=yes AND DEC-B63 legal gates — may never happen, by
design).

## 16. Ratification questions (condensed)

**Q1** amounts in HR-7 at all, or facts-and-quantities only (recommended)? ·
**Q4** is_paid per leave category · **Q5** payroll calendar/cutoff · **Q6**
export format & columns · **Q7** approver/export seats (DAF/DGA proposed; CEO
excluded absent ratification) · **Q8** may an employee see their own line? ·
**Q9** overtime/lateness/schedule — defer or ratify · **Q10** statutory
identifiers (DEC-B63 legal gates).

## 17. Recommendation

**CONDITIONAL GO.** The architecture is ready and every needed pattern is
production-proven; HR-7A/7B/7C (Tier 1, facts-only) are safe under **any**
answer to the open questions and can be implemented next. The conditions:
Effitrans answers **Q1** before HR-7E is even designed, and **Q5/Q6/Q7**
before HR-7D ships an export anyone relies on. Do not seed a single vocabulary
word, component, rate or rule — every one of those is Effitrans's to name.
