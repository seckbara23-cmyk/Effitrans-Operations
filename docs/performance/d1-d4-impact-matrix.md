# ICTD / ICAM / IPAM — D1–D4 Impact Matrix

**Date:** 2026-08-26 · **Status:** impact audit only — nothing implemented, no
production code modified. Inputs are the four business-ratified answers from
Fary / Effitrans, reconciled against the Phase-0 freeze (`8161333`) and the
current repository.

Ground truth that frames everything below: **Phase 0 was audit-and-spec only.**
There is no ICTD/ICAM/IPAM calculation engine, schema, RBAC or UI in the
repository. The "current implementation" for each decision is therefore
(a) the frozen contract register and fixtures, and (b) the live platform
machinery each decision will land on. That machinery is substantial and is
where the real findings are.

---

## D1 — DPE / DEP

**Confirmed rule.** DPE is not a separate declaration type; it was historical
mis-entry tolerated by the spreadsheet. Platform uses **DEP only, coefficient
1,30**. No DPE as a current selectable value; normalization at ingestion if
historical data requires it.

**Current implementation.**

| where | state |
|---|---|
| Code / schema | **Nothing.** No declaration-type vocabulary exists anywhere — `customs_record` carries free-text `regime` only. Zero hits for DPE/DEP in `lib/`, `app/`, migrations, tests. |
| Frozen docs | `formula-contract-register.md` ICTD-D05 carries **DPE 1,30 (workbook-only)** pending Q1; `workbook-divergence-register.md` DV-01/DV-09; fixture **F-ICTD-06** marked *provisional — voided if Q1 rejects*; `effitrans-decision-packet.md` Décision 1 open. |
| Ingestion pattern | Already proven: migration 101 MAYA staging normalizes labels at the boundary (`source_type_label` → `normalized_*`, taxonomy DERIVED, source preserved). The DPE→DEP alias is one more row of that idiom, **only if** ICTD workbook history is ever imported (Q12, still open, non-blocking). |

**Classification: STALE PARITY** (docs only — there is no code to retire).

**Required change.**
- ICTD-D05 → exactly four types: SIMPLE 1,00 · APE 1,40 · **DEP 1,30** · OG 1,50.
- DV-01/DV-09 closed with the ruling; Décision 1 marked answered.
- F-ICTD-06 is **not discarded** — DPE at 1,30 computes identically to DEP, so
  its expected value (4,94) survives verbatim as the *normalization* fixture:
  a historical row labelled DPE must land as DEP and produce 4,94.
- Future schema rule (recorded now, built later): declaration-type CHECK
  constraint over the four values; `DPE` accepted **only** at the staging
  boundary, normalized to DEP with the source label preserved.

Migration required: **no** (nothing exists yet). · RBAC impact: none. ·
Historical data: normalization rule recorded, applies only if import happens. ·
Calculation impact: CDP table is 4 rows. · Tests: coefficient-table pin +
normalization fixture when the import path is built. · UAT: DEP selectable,
DPE absent everywhere.

---

## D2 — Performance status / cell-coverage mechanism

**Confirmed rule.** The status mechanism existed to police manual cell
completeness. The CRM auto-populates, so that function is removable. Do not
remove genuinely independent KPI rules that merely share its labels.

**Current implementation.**

| where | state |
|---|---|
| Code | **Nothing.** No `Non classé`/`Provisoire`/coverage-status logic anywhere in `lib/` or `app/` (the grep hits are unrelated modules). |
| Frozen docs | ICTD-R16 and AM-R28 status ladders; GOV-06 (MIN_DOSSIERS 10), GOV-07 (80 % coverage), GOV-08 (ladder incl. duplicate → Non classé); AM-R26 pooled 13-KPI coverage; ICTD-R19 quality coverage; **Q2** (ladder precedence) blocking; fixture **F-STAT-05** provisional pending Q2. |

**The ladder is not one rule — it is five, and they classify differently:**

| rung | exists for | classification |
|---|---|---|
| `< 80 %` coverage → Non classé (GOV-07 + the coverage rungs of R16/R28) | manual-entry completeness — exactly what Fary retired | **STALE PARITY — retire** |
| Q2 precedence + F-STAT-05 | ordering rungs of a ladder that no longer exists | **voided by elimination** — Q2 needs no answer anymore |
| duplicate AM×month → Non classé | spreadsheet can't prevent duplicate rows; a database can | **STALE PARITY — superseded by construction**: a uniqueness constraint on (AM, month), not a status |
| `< 10` dossiers → Provisoire (GOV-06) | statistical reliability of ranking someone on few dossiers — **not** cell completeness | **QUESTION (BQ-2)** — independent rule; must not be silently retired with the mechanism, must not be silently kept |
| critical incident → Revue managériale | independent governance (incident forces managerial review) | **GREEN — keep**, as a workflow flag, not a "status" |

**Kept independently (not part of the mechanism):** GOV-02 « Non évalué » ≠
conforme, GOV-03 N/A denominator exclusion, CSAT no-survey ≠ 100 %, pilot-blank
semantics. These are correctness rules for the inputs that **remain manual**
(satisfaction survey, claims/imputability registers) and for score denominators.
Auto-population does not make them moot.

**Coverage as a displayed metric** (AM-R26 pooled, ICTD-R19): with
auto-population these trend to 100 % trivially for auto KPIs. The
status-driving use retires; the évalué/éligible semantics survive only inside
score denominators. Headline coverage metrics: retire (CLEANUP).

Migration required: **no**. · RBAC: none. · Calculation impact: ranking
population definition depends on BQ-2. · Tests: F-STAT-* fixtures retire. ·
UAT: no status column appears; ranking behaves per BQ-2's answer.

---

## D3 — Working days

**Confirmed rule.** Delay/performance calculations use days actually worked;
exclude leave and public holidays; **HR owns the calendar.**

**Current implementation — audited before changing anything:**

| question | current truth | evidence |
|---|---|---|
| How are working days calculated today? | **Nowhere.** No working-day engine exists in the platform. | grep across `lib/`, `app/`, migrations |
| Weekends? | Frozen contract ICTD-D11 specifies NETWORKDAYS.INTL weekend code 1 (**Sat–Sun**), `MAX(0, … − 1)`, same-day = 0. Ratified as written in Phase 0. | `formula-contract-register.md:34` |
| Public holidays? | **Not represented anywhere.** FERIES was empty in both workbooks (that was blocking Q3 — now answered: authority = HR). Decision packet already rules delay indicators are « non calculable » until a validated calendar exists. | `effitrans-decision-packet.md` Décision 3 |
| Employee leave? | **Exists and is governed.** `hr_leave_request` (DRAFT→…→APPROVED, `day_tenths`, evidence, approver) — HR-B1, migration 108 applied. `lib/hr/leave/balance.ts` counts **calendar days deliberately**, with a comment stating a holiday calendar "may not be invented here". | migration `20260802000003`, `balance.ts:49-53` |
| Days actually worked? | **A literal data source exists**: `hr_attendance_day` (employee, `work_date`, `worked_minutes`, unique per employee×day, source MANUAL/IMPORT/DEVICE). HR-7 payroll already snapshots it because it is upsertable. | migration `20260802000003:173` |
| Exceptional company closures? | **Not representable.** No structure carries them. |  |
| Calendar days used where worked days should be? | No — nothing computes either yet. The only risk site is `balance.ts`, which is explicitly and correctly calendar-day for leave *quantity*, a different question. | |
| HR capability for calendar maintenance? | `hr:manage` held by HR_OFFICER; HR module live (HR-1..10 closed); no calendar UI/table yet. | `lib/hr/actions.ts:68` |

**Classification: GAP** (the calendar and the engine are genuinely missing —
Q3 was one of the four Phase-0 blockers and this answer unblocks it), plus
three narrow questions the confirmed answer does not resolve (below).

**Smallest correction (design, for GO later — not implemented):**
- New reference table `hr_calendar_day` (tenant, date, kind
  `PUBLIC_HOLIDAY | COMPANY_CLOSURE`, label, created_by) — **HR-governed**:
  writes behind `hr:manage`, no operational role touches it. Migration **yes**.
- One pure working-day function reproducing ICTD-D11 (Sat–Sun + calendar
  exclusion, −1, floor 0) with the frozen fixture F-SLA-06 as its parity proof.
- Jours actifs (the UTD/jour and capacity denominators): derived from platform
  data — working days in period minus approved leave, or `hr_attendance_day`
  where recorded — resolving Phase-0 Q9. Exact derivation needs BQ-5 (half-days).
- KPI time bases must read the calendar **as-of** the evaluation period —
  §17.2 forbids retroactive recomputation; the parameter-versioning invariant
  doc already specifies the pinning pattern. Design constraint, not a question.

RBAC impact: **none new** — reuse `hr:manage`; explicitly do NOT grant
calendar writes to operational roles. · Historical data: none. · Calculation
impact: délai, SLA flag, UTD/jour, part de charge denominators. · Tests:
engine parity vs F-SLA-06 + calendar-authority negative tests. · UAT: HR
records a holiday; a délai spanning it shrinks by one working day; ops roles
cannot modify the calendar.

---

## D4 — ICTD customs data authority

**Confirmed rule.** « Déclarant saisit → Chef de Transit valide → toute
correction après validation est tracée » — applied to: positions SH (NPSH),
type de déclaration, DPI, titre d'exonération, origine du classement tarifaire.

**Current implementation — element by element:**

| D4 requirement | current truth | evidence |
|---|---|---|
| The five data elements | **None exist.** `customs_record` has none of them (declaration_number, office, regime, dates, BAE, inspection — nothing else). Phase 0 §6 already lists all five as genuinely new collection. | migration `20260615000002:28` |
| Declarant entry authority | **Machinery exists and is governed.** `customs:update` held by CUSTOMS_DECLARANT; every write passes `assertControlStep` (out-of-sequence hard-blocked) and the C-4 step-ownership invariant. Broader roles also hold `customs:update`, but the step gate binds execution to the owning step. | `lib/customs/actions.ts:145`, `lib/process/control-gate.ts` |
| Chief validation authority | **Exists.** `customs:validate` held by CHIEF_OF_TRANSIT (deliberately not by the declarant — PG-6), plus OPS_SUPERVISOR/SYSTEM_ADMIN. | `role-templates.ts:233` |
| Validation state + attribution + timestamp | **Exists.** `reviewed_by` + `reviewed_at` written only by SECURITY-DEFINER RPC `record_customs_validation` (migration 103), which re-proves authority via `assert_actor_authority` (INV-7), refuses self-validation against **both** `created_by` and `updated_by` (migration 104), and emits business event `CUSTOMS_VALIDATED`. | migrations 103/104, `actions.ts:478-522` |
| Post-validation correction — possible? | **NO — currently there is no door at all.** `updateCustoms` is gated on the owning step being in `["AVAILABLE","ACTIVE","BLOCKED","SUBMITTED"]`; once the step completes, every update is hard-blocked as out-of-sequence. Validated data is **de-facto permanently immutable**, which D4 explicitly forbids. | `control-gate.ts:53` |
| old→new capture | **Capability exists, unused here.** `audit_log` has `before`/`after` jsonb; `CUSTOMS_UPDATED` writes neither. | foundation migration:83, `actions.ts:184` |
| Re-validation after correction | **Impossible.** `record_customs_validation` raises `already validated` — one-shot by design. | migration 103 RPC |
| Reason for correction | Governed-model precedent exists: C-3 declared absence requires a motif (`reason_required`); expense-visa versioning never rewrites history. The platform's correction idiom is *reasoned, append-only, attributed*. | `evidence-absence-actions.ts`, expense chain |

**Classification: GAP** — in the exact opposite direction from the one D4
warns about. The platform does not allow unrestricted post-validation editing
with a generic audit event; it allows **nothing**, and D4 requires a traced
correction path. Both halves of Fary's sentence need work: the five fields
(entry + validation ride existing machinery) and the governed correction door.

**Smallest correction (design, for GO later — not implemented):**
- Add the five fields to the customs capture surface (schema + UI), entered
  under the existing step-gated `customs:update`, certified by the existing
  `record_customs_validation`. Migration **yes**.
- A dedicated correction action for **validated** records only: requires a
  motif, captures old→new in `audit_log.before/after`, emits a
  `CUSTOMS_CORRECTED` business event, appends to a correction history —
  never rewrites the validated row's provenance. Follows INV-7 if RPC-side.
- Who may invoke it, and whether corrected data must be re-validated by the
  Chef, is **BQ-4** — the confirmed sentence establishes that correction is
  traced, not who corrects or whether certification renews.

RBAC impact: likely one narrow dedicated permission for the correction door
(the Step-16 precedent: narrow capability, never a broad grant) — pending
BQ-4. · Historical data: none (fields are new). · Calculation impact: these
five fields feed CDP, NPSH×CCT, DPI, TE — the heart of ICTD. · Tests:
maker/checker on the five fields; correction trace (old→new/actor/timestamp/
motif); immutability of validated provenance; mutation on the correction
door. · UAT: declarant enters, chief validates, declarant cannot
self-validate, post-validation correction leaves the full trace.

---

## What must change before ICTD / ICAM / IPAM UAT

**BLOCKER**
1. **D4 — the five customs data elements do not exist** (schema + capture +
   validation wiring). Without them ICTD's CDP/NPSH/DPI/TE blocks have no
   inputs; nothing can be computed, let alone UAT'd.
2. **D4 — governed post-validation correction door** (currently: validated
   data is immutable with no correction path — contradicts the ratified rule).
3. **D3 — holiday calendar** (`hr_calendar_day` + HR maintenance surface).
   The decision packet already rules working-day indicators « non calculable »
   without it.
4. **D3 — working-day engine** implementing frozen ICTD-D11, proven against
   fixture F-SLA-06.

**REQUIRED**
5. D1 — contract register + fixtures updated to DEP-only (blocks parameter
   seeding; 30-minute doc change, but the coefficient table must be seeded
   from it).
6. D2 — retire GOV-07/ladders/Q2/F-STAT-05 from the contracts; record the
   duplicate rung as a uniqueness constraint.
7. D3 — jours-actifs derivation from HR data (resolves Phase-0 Q9).
8. Pre-existing Phase-0 blockers still open, unchanged by D1–D4: parameter
   version pinning; governance-matrix authority separation encoded as roles;
   pilot-state semantics as data. (Recorded here for honesty — they were
   already on the blocker list before these answers.)

**CLEANUP**
9. Mark Décisions 1–4 answered in the decision packet; close DV-01/DV-09.
10. Retire headline coverage metrics (AM-R26 pooled, ICTD-R19 as status
    feeders); keep évalué/éligible semantics inside score denominators only.
11. Repurpose F-ICTD-06 as the DPE→DEP normalization fixture.

**BUSINESS QUESTION** (narrow — only what implementation genuinely cannot
resolve)
- **BQ-1** — Does « exclure les congés » apply to the **per-dossier délai**
  (the frozen NETWORKDAYS contract excludes only weekends + holidays, no
  individual's leave), or to the **per-agent capacity denominators** (jours
  actifs) as we read it? Changing ICTD-D11 would alter a frozen, fixture-proven
  formula — we will not do that silently.
- **BQ-2** — With the status mechanism removed, does the **minimum-volume
  rule** (10 dossiers) survive as a ranking-reliability marker, or is ranking
  computed over all agents regardless of volume? (Independent of cell
  completeness; not retired by default.)
- **BQ-3** — Do **exceptional Effitrans closure days** (non-holiday, company
  decision) count as non-worked days in KPI time bases? The calendar table
  will carry them either way; only their KPI effect needs ruling.
- **BQ-4** — Post-validation correction: **who** may correct (the declarant,
  the Chef, either?), and must corrected data be **re-validated** by the Chef,
  or is the trace itself sufficient?
- **BQ-5** — **Half-day leave** (`day_tenths` exists): does a half-day absence
  reduce jours actifs by 0,5, or count as worked?

Out-of-scope discoveries: none that block D1–D4. Nothing outside this
workstream was expanded into.
