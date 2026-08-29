# ICAM — Slice 2 pre-implementation architecture audit

**Date:** 2026-08-29 · **Status:** AUDIT ONLY — no migration, no schema, no code,
no roles, no seed. Baseline: Slice 1 closed at `09ee213` (CI 33271057289).

---

## ⚠ THE HEADLINE FINDING, FIRST

**ICAM is a WORKLOAD indicator, not a quality indicator — and my own earlier
audit said otherwise.**

`docs/performance/bi-reporting-architecture-audit.md` (row A5–A7, commit
`c31b9b7`) listed ICAM's missing sources as *« réclamations, imputabilité,
erreurs imputables, redressements douaniers, retours, incidents critiques »*.
That is **wrong**, and this brief inherited it (sections 5 and 7 ask for a claims
and redressement design *for ICAM*).

The frozen register is unambiguous. **AM-S01..S09**:

> ICAM composantes (documents, reportings, autorisations, paiements, factures,
> coordinations, incidents, coursier) — `MIN(COEF_x × N(count), PLAF_x)`
> … **ICAM dossier** = `ICAM_BASE + SUM(U:AB)` = 1 + capped components

ICAM counts **eight kinds of work an Account Manager did on a dossier**. It has
no penalty term, no imputability gate and no claim input. The claims,
imputability, errors, returns and CSAT machinery belongs to the **13 per-dossier
KPIs (AM-S12..S24)** which feed **IPAM** dimensions Q/D/C/E — *Slice 3*, not
Slice 2.

Only **one** of the six "missing registers" is actually an ICAM input: **NINC**,
and even there the frozen definition is *« retours/non-conformités NON
imputables **traités** »* — work handled, not a fault recorded.

**Consequence: ICAM is far closer than the earlier audit claimed.** Five of its
eight components are derivable from authoritative data that already exists;
Slice 2 is mostly a computation and attribution slice, not a register-building
programme.

---

## A. The ICAM formula, reconstructed from the frozen methodology

```
ICAM(dossier) = ICAM_BASE + Σ MIN(COEF_x × N(count_x), PLAFOND_x)
              = 1,00      + the eight capped components below
```

Hard ceiling **8,00 per dossier** (F-ICAM-03). Base 1,00 with all counts zero
(F-ICAM-02). Methodology §7.4 example → **4,45** (F-ICAM-01).

| # | Code | Business name | Coef | Cap | Unit |
|---|---|---|---|---|---|
| 1 | **NDOC** | documents contrôlés / classés | 0,10 | 1,00 | count |
| 2 | **NREP** | reportings formels | 0,15 | 0,75 | count |
| 3 | **NAD** | autorisations de dépense | 0,25 | 1,00 | count |
| 4 | **NPAY** | paiements en ligne | 0,30 | 0,90 | count |
| 5 | **NFACT** | factures fournisseurs **contrôlées** | 0,15 | 0,75 | count |
| 6 | **NCOORD** | coordinations documentées | 0,30 | 1,20 | count |
| 7 | **NINC** | retours / non-conformités **NON imputables traités** | 0,50 | 1,00 | count |
| 8 | **NCOUR** | récupérations physiques (coursier) | 0,20 | 0,40 | count |

**Monthly roll-up** — AM-R03 dossiers clôturés · AM-R04 **ICAM total**
`SUMIFS` over the same filter · AM-R05 jours actifs · AM-R06 **ICAM / jour actif**.

**Persona:** the **Account Manager**. **Period semantics:** AM-S11 — *Mois de
clôture* = `EOMONTH(date de clôture)`, and **F-ICAM-05 is decisive**: an open
dossier still *computes* ICAM (charge is tracked) but is **excluded from every
monthly KPI and count** because its closure month is blank. ICAM's monthly
population is therefore **closed dossiers only** — materially different from
ICTD, which scores on declaration date.

**Reliability (AM-R28, as amended by D2):** `C=0 → Aucune donnée`; critical
incident → `Revue managériale — non classé`; `C<10 → Provisoire`; else `Classé`.
The 80 % coverage rung is retired; AM×month duplication is a uniqueness
constraint, not a status.

**Governance:** GOV-04 (imputability before penalty — relevant to NINC's
qualifier and to IPAM, not to ICAM's other terms) · GOV-09 (critical incident
blocks classification) · F-ICAM-06 (**an AM-caused rework must NOT increment
counters** — enforced by validation, never by the formula).

**No conflict found** between the register, the source map and the fixtures. The
only conflict is between them and my earlier BI audit, and the register wins.

---

## B. Source-lineage matrix

| Input | Frozen definition | Authoritative source in the platform | Class | Persona | Gap |
|---|---|---|---|---|---|
| **Attribution (AM)** | dossier's Account Manager | `operational_file.account_manager_id`, designated by RPC `assign_commercial_owner` (permission `file:assign:commercial`, OPS_SUPERVISOR + SYSTEM_ADMIN), history in `assignment_event` (`subject_type = COMMERCIAL_OWNER`), reassignment demands a reason, terminal dossier refused | **A — AUTHORITATIVE** | Ops Manager assigns; AM is measured | none |
| **Closure month** | AM-S11 `EOMONTH(date clôture)` | `operational_file.status`/`closed_at` + `file_state_transition` | **A** | — | which timestamp is canonical → Q1 |
| **NDOC** | documents contrôlés et classés | `document` rows per dossier + `isVerified` doctrine (VERIFIED / CONSUMED_AS_EVIDENCE / legacy APPROVED) | **B — DERIVABLE** | AM | does *contrôlé* = verified, and which types count → Q2 |
| **NREP** | reportings formels « prévu ou justifié, envoyé, horodaté » | `notification` table + EC mail (outbound sends are timestamped); **externally-sent mail is not captured** | **C — PARTIAL** | AM | what counts as a *reporting formel* → Q3 |
| **NAD** | autorisations de dépense | `expense_authorization` (11.0B/C) + visas + `SPENDING_AUTHORIZATION` document type | **B** | AM | which state counts (visa'd?) → Q4 |
| **NPAY** | paiements **en ligne** | `payment` + `payment_intent`/provider scaffold (PAYMENTS_ENABLED=false, mock only) | **C — PARTIAL** | AM | *« en ligne »* has no live provider; count all verified payments instead? → Q5 |
| **NFACT** | factures fournisseurs **contrôlées** | `VENDOR_INVOICE` document type **exists** (migration `20260714000001:58`) and is a `requiredDocument` of step 3; verification state via the same `isVerified` doctrine, with `reviewed_by` attribution | **B** | AM | *contrôlée* = verified: confirm, and whose control → Q6 |
| **NCOORD** | coordinations documentées | process handoffs, tasks, messaging, audit events — several candidates, none matching a human definition | **C — PARTIAL** | AM | the definition is human → Q7 |
| **NINC** | retours/non-conformités **NON imputables traités** | **nothing** | **D — ABSENT** | AM | needs a register + imputability verdict |
| **NCOUR** | récupérations physiques | `invoice_deposit` custody chain (courier module, D4-adjacent) | **B** | AM/courier | non-deposit courier runs unmodelled → Q8 |

**No input is class E (CONTRADICTED).** The one contradiction in the repository
is my earlier audit document, corrected by this one.

### The NFACT question, answered directly (brief §8)

`NFACT = number of VENDOR_INVOICE documents actually controlled` **is supported**
by the frozen methodology — the word in the register is *contrôlées*, and the
source map row 61 already classified it AUTO against *"`VENDOR_INVOICE`
documents **+ verification**"*.

**Document existence alone does NOT prove control.** The platform has an exact,
already-governed notion of control: document verification (`isVerified`), which
is an attributed, audited review act carrying `reviewed_by`. So NFACT counts
**verified** VENDOR_INVOICE documents — the same shape as ICTD's NF, using the
same doctrine, which is also why the two must never be conflated again.

⚠ Two stale artefacts to disregard, both verified stale here:
`lib/process/effitrans-process.ts` step 3 `implementation.gaps` still says *"no
VENDOR_INVOICE type and no accounts-payable model"* — false since migration
`20260714000001`; this is the known-stale 5.0A snapshot
(`process-registry-metadata-stale.md`). And its `requiredEvidence`
`"vendor_invoices_verified"` is **documentary only** — `evaluateStepEvidence`
consumes `requiredDocuments` and nothing else, so that key enforces nothing and
stores nothing. It describes the intent; it is not a source.

---

## C. Existing reusable machinery (build on, do not rebuild)

Attribution + history (`assign_commercial_owner`, `assignment_event`) · document
verification doctrine (`isVerified`) · expense authorization chain · payments +
verification · deposit/courier custody · the **shared performance engine and read
service** · the report snapshot/freeze/PDF pipeline · the four-eyes idiom
(`assert_actor_authority`, self-review refusal, WORM history) proven twice in D4
and once in the report lifecycle.

---

## D. Genuine missing register — exactly ONE

**`am_incident`** — the NINC source. Proposed shape (design only):

- **Purpose:** record a return / non-conformity handled on a dossier, and the
  imputability verdict that decides whether it counts.
- **Owner:** Operations (recording), Quality/Ops Supervisor (imputability).
- **Create:** the AM or Operations on a dossier. **Validate:** a different
  actor — imputability is a verdict about someone's work, so four-eyes applies
  exactly as in D4. **Correct:** through a governed door with a motif, WORM
  history, never in place.
- **Fields:** tenant, file, occurred_on, recorded_by/at, description,
  `imputability` ∈ {`EN_ANALYSE`, `NON_IMPUTABLE`, `IMPUTABLE_EFFITRANS`,
  `IMPUTABLE_CLIENT`, `IMPUTABLE_TIERS`}, decided_by/at, motif, `is_critical`.
- **ICAM consumes:** `count(NON_IMPUTABLE AND traité)`. GOV-04 is the whole
  point — `EN_ANALYSE` is *not yet a fault* and must not count either way.
- **GOV-09:** `is_critical` feeds the reliability ladder (Revue managériale).
- **Immutability/tenant/audit:** the `customs_correction` pattern verbatim.

Everything else in the earlier "ICAM registers" list — claims, imputabilité as a
standalone register, redressements, retours, CSAT — belongs to **IPAM (Slice 3)**
and is out of scope here.

---

## E. Attribution findings (brief §3) — no blocker

The doctrine is already implemented and audited. Migration
`20260906000001_commercial_owner_assignment` states it plainly: *"registry step 2
makes the Operations Manager the assignment authority… The creator and the
Account Manager are separate concepts even when they happen to be the same
person."* `account_manager_id` is the authoritative attribution;
`assignment_event` is the history; reassignment requires a reason.

**Do not attribute ICAM by dossier creator.** One narrow question remains: a
dossier reassigned mid-period — does the closing AM take the whole ICAM, or is it
split? (→ Q9.)

---

## F. RBAC / governance model

- **No new capability for reading ICAM.** It reaches management through
  `performance:read`, exactly like ICTD.
- **`performance:read` must NOT confer incident entry.** The one new operational
  capability is for the register: `incident:record` (create) and
  `incident:adjudicate` (imputability verdict), on Operations roles — *not* on
  `PERFORMANCE_MANAGEMENT`. Performance readers consume facts; they do not
  create them.
- **SYSTEM_ADMIN doctrine preserved:** may assign the roles, holds no
  `performance:*` and should hold no incident adjudication either (DEC-B61
  reasoning — personal-consequence data).
- Two capabilities is the minimum that keeps four-eyes real; a single
  `incident:manage` would let the recorder adjudicate their own entry.

---

## G. BI / report integration — no new architecture

ICAM enters the **existing** pipeline at exactly one point:

```
operational facts → lib/performance/read.ts  (add: icamDossiers / icamByCollaborator)
                  → buildSnapshot()          (add: an icam block)
                  → loadBiView()             (already generic)  → live BI
                  → publishReport()          (already generic)  → frozen snapshot → PDF
```

`buildBriefing` gains ICAM KPIs from the snapshot it already receives. **No second
engine, no aggregation table, no independent PDF maths, no client-side KPI.** The
existing test that asserts `bi.ts` and `report-actions.ts` contain no indicator
arithmetic keeps that true.

⚠ **Snapshot compatibility:** `ReportSnapshot` is persisted in published rows. A
new `icam` block must be **optional on read**, so reports published in Slice 1
keep rendering. That is a design constraint, not a migration.

---

## H. Proposed build sequence — three slices, evidence-driven

The brief's suggested 4-way split does not match the evidence: attribution is
already done, and NFACT is not a slice's worth of work.

| Slice | Contents | Migration | UAT exit criterion |
|---|---|---|---|
| **ICAM-1 — the derivable six** | NDOC, NAD, NFACT, NCOUR (+ NPAY, NREP under their rulings) computed per dossier from existing sources; closure-month population; ICAM engine + fixtures F-ICAM-01/02/03/04/05 | **none** | F-ICAM-01 reproduces **4,45**; caps hold; open dossiers excluded from the month |
| **ICAM-2 — the incident register** | `am_incident` + four-eyes adjudication + correction door + the two capabilities; NINC wired; GOV-09 to the reliability ladder | **1** | non-imputable incident raises ICAM by 0,50; `EN_ANALYSE` changes nothing; self-adjudication refused; critical incident forces *Revue managériale* |
| **ICAM-3 — presentation** | ICAM in the snapshot, BI tab, report section, PDF; NCOORD under its ruling | **none** | ICAM appears in a draft, freezes on publication, and a later incident does not move the published figure |

ICAM-1 is genuinely deliverable with **zero schema change** — the significant
result of this audit.

---

## I. UAT matrix (expected effects, no invented numbers)

| # | Scenario | Expected ICAM effect |
|---|---|---|
| 1 | Clean closed dossier, zero counted events | **1,00** (base only) — F-ICAM-02 |
| 2 | AM assigned via `assign_commercial_owner` | dossier attributes to that AM, not its creator |
| 3 | One **verified** VENDOR_INVOICE | +0,15 |
| 4 | An **unverified** VENDOR_INVOICE | **no change** — existence is not control |
| 5 | §7.4 counts (6,3,2,1,2,2,1,1) | **4,45** exactly — F-ICAM-01 |
| 6 | Every component saturated | **8,00**, never above — F-ICAM-03 |
| 7 | NDOC = 11 | **+1,00**, not +1,10 — F-ICAM-04 |
| 8 | Incident recorded, `EN_ANALYSE` | **no change** (GOV-04 — not yet a fault) |
| 9 | Adjudicated **NON_IMPUTABLE** | **+0,50** |
| 10 | Adjudicated **IMPUTABLE_EFFITRANS** | **no change** to NINC (F-ICAM-06: AM-caused rework never increments) |
| 11 | Recorder attempts own adjudication | **refused** |
| 12 | Independent adjudication | accepted, attributed, audited |
| 13 | Imputability corrected afterwards | governed door + motif; ICAM recomputes live; history preserved |
| 14 | Duplicate incident on one dossier | prevented, or counted once — → Q10 |
| 15 | Critical incident | reliability → **Revue managériale — non classé** (GOV-09) |
| 16 | **Open** dossier | ICAM computed, **excluded from the month** — F-ICAM-05 |
| 17 | Dossier closed on the period boundary | falls in `EOMONTH(closure)`, not declaration month |
| 18 | AM reassigned mid-period | per Q9's ruling |
| 19 | Cross-tenant read/adjudication | **refused** |
| 20 | Live ICAM → draft report | draft shows live ICAM |
| 21 | Publish, then add an incident | **published figure unchanged**; live BI moves |

---

## J. BLOCKERS
1. **NINC has no source** (class D) — ICAM cannot be complete without the
   incident register. *ICAM-1 is not blocked by this*; full ICAM is.
2. **Q6 (NFACT = verified?)** — blocks ICAM-1's NFACT term.
3. **Q1 (canonical closure timestamp)** — blocks the monthly population.

## K. REQUIRED
Q2 (NDOC scope) · Q4 (NAD state) · Q9 (reassignment attribution) · optional
snapshot `icam` block on read.

## L. CLEANUP
Correct the ICAM rows in `bi-reporting-architecture-audit.md` (A5–A7) — they
misstate ICAM as quality-gated · retire the stale `implementation.gaps` claim
about VENDOR_INVOICE in `effitrans-process.ts` · record that `requiredEvidence`
is documentary.

## M. BUSINESS QUESTIONS (narrow — the repository cannot answer these)

- **Q1** Which timestamp is the dossier's canonical *date de clôture* for
  `EOMONTH` — `operational_file.closed_at`, the CLOSED `file_state_transition`,
  or POD/delivery?
- **Q2** *NDOC — documents contrôlés et classés*: all verified document types, or
  a named subset?
- **Q3** *NREP — reporting formel*: which platform events qualify (client
  notifications only? outbound mail? both?), given external email is uncaptured.
- **Q4** *NAD*: does an authorization count when created, or only once visa'd?
- **Q5** *NPAY — « en ligne »*: no live provider exists. Count all **verified**
  payments, or hold NPAY at zero until online payments are live?
- **Q6** *NFACT*: confirm **contrôlée = document verified**; and does it count
  invoices verified **by the AM** specifically, or any verification on the AM's
  dossier?
- **Q7** *NCOORD — coordination documentée*: which recorded events count? (This
  is the least platform-decidable of the eight.)
- **Q8** *NCOUR*: deposits only, or all physical pickups?
- **Q9** Dossier reassigned mid-period — closing AM takes the whole ICAM, or
  split by tenure?
- **Q10** Duplicate/repeat incidents on one dossier: each counts, or once?

## N. GO / NO-GO

| | |
|---|---|
| **ICAM-1 (derivable components)** | **GO** on Q1 + Q6 (+ Q2/Q4/Q5 to fix the remaining counts). **Zero migrations.** |
| **ICAM-2 (incident register)** | **NO-GO** pending the register ruling + Q10 |
| **ICAM-3 (BI/report)** | **NO-GO** until ICAM-1 lands |
| **Slice 2 as a whole** | **CONDITIONAL GO** — smaller than believed: one register, not six |

**Recommended next build after rulings:** ICAM-1.

---

*Audit only. No migration, schema, code, UI, seed or role change was made.*
