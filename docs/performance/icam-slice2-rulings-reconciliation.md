# ICAM Slice 2 — rulings reconciliation and final pre-build audit

**Date:** 2026-08-30 · **Status:** AUDIT / RECONCILIATION ONLY — no migration,
no code, no UI, no roles, no seed. Predecessor: `0fdd6d0`.

---

## 1. Q1 — closure authority, investigated

**Q1-A — the canonical existing closure source.**

`operational_file` has **no `closed_at` column**. It carries `opened_at`,
`archived_at`, `status`, `updated_at` — and none of those is a closure instant.
The authoritative fact is:

> **`file_state_transition` where `to_status = 'CLOSED'`, its `occurred_at`.**

Written by `transitionFile` (`lib/files/actions.ts`), which is the single guarded
seam for dossier status (C-4 ratified: "CLOSED is reached through ONE guarded
seam, from two doors"). `occurred_at timestamptz not null default now()` —
**database time**, and the row carries `actor_id`.

⚠ **`process_instance.closed_at` is NOT the dossier's closure.** It exists
(migration `20260713000001:56`) and `closeDossier` writes it, but the C-4
architecture ruling froze these as *different objects*: door 1 (`transitionFile`)
can set a dossier CLOSED with a non-terminal process instance, and that was
explicitly ratified as **not a defect**. Using `process_instance.closed_at` would
silently drop every dossier closed through the manual door.

**Q1-B — immutable and auditable: YES.**
`create trigger trg_fst_no_update before update on public.file_state_transition`
(migration `20260614000002:150`). Append-only, RLS select-only, DB-defaulted
timestamp, actor recorded. No application path can rewrite a closure instant.

**Q1-C — reopening: IMPOSSIBLE by construction.**
`lib/files/status.ts`: `CLOSED: []` — no outbound transition — and
`TERMINAL_FILE_STATUSES = ["CLOSED", "CANCELLED"]`. So a dossier has **at most
one** CLOSED transition, and the "which closure counts" ambiguity never arises.
This removes a question the brief anticipated.

**Q1-D — historical reconstruction: COMPLETE.** Verified read-only against
production:

| check | value |
|---|---|
| dossiers with `status = 'CLOSED'` | **1** |
| …with a matching CLOSED transition | **1** |
| …**without** one | **0** |
| CLOSED transitions total | 1 |

Every closed dossier is reconstructable. No bypass path exists: the only other
code writing `status: "CLOSED"` is `collections/actions.ts` (the *process
instance*) and `fleet/actions.ts` (a vehicle), neither of which is a dossier.

**Verdict: NOT a schema blocker.** No new column is needed; `updated_at` is not
substituted anywhere.

---

## 2. Q6 — RATIFIED, recorded

> **NFACT = verified `VENDOR_INVOICE` documents.** Existence is not control. The
> authoritative evidence of control is the platform's **document-verification
> doctrine** (`isVerified`: `VERIFIED` / `CONSUMED_AS_EVIDENCE`, legacy
> `APPROVED`), reused as-is — no ICAM-specific definition of verified — with
> `reviewed_by` attribution preserved.

The same doctrine ICTD's NF uses, which is also what keeps the two invoice types
from being conflated a third time.

---

## 3. Q1–Q10 decision table (all ten, verbatim from `0fdd6d0`)

| Q | Question | Blocks | Frozen evidence | Repository evidence | Recommendation & consequence |
|---|---|---|---|---|---|
| **Q1** | Which timestamp is the canonical *date de clôture* for `EOMONTH`? | **ICAM-1** | AM-S11 `EOMONTH(G,0)`; F-ICAM-05 | `file_state_transition.occurred_at` where `to_status='CLOSED'`; immutable trigger; no reopen; 1/1 reconstructable | **ANSWERED ABOVE** — use it. Choosing `process_instance.closed_at` instead would drop manual-door closures; `updated_at` would move a published month whenever anything on the dossier changed. |
| **Q2** | *NDOC — documents contrôlés et classés*: all verified types, or a named subset? | **ICAM-1** | AM-S01 NDOC 0,10/1,00; source map row 57 *"« distinct contrôlé et classé » ≈ verified versions; ratify whether upload alone counts"* | `document` + `isVerified`; `document_type` catalog with categories (`commercial`, `financial`, …) | **Recommend: all verified documents on the dossier, any type, counted once per document.** Cap 1,00 = 10 documents, so scope choice only matters below the cap. A named subset would need a ratified list and would drift as types are added. |
| **Q3** | *NREP — reporting formel*: which events qualify? | ICAM-1 (term only) | AM-S01 NREP 0,15/0,75; source map row 58 *"« prévu ou justifié, envoyé, horodaté » — external emails not captured"* | `notification` is **internal** (`user_id` = staff) — it is *not* client reporting. `client_notification` exists and IS client-facing. `communication_message`/`conversation`/`ec_*` exist for mail. | **Recommend: `client_notification` rows for the dossier.** It is the only table that means "we formally told the client something", it is timestamped, and it is ours. Consequence of including EC mail: inbound/outbound threads inflate NREP with ordinary correspondence. Consequence of deferring: NREP reads 0 and understates AM workload — **so state it in the report rather than silently scoring 0**. |
| **Q4** | *NAD*: counts on creation, or only once visa'd? | ICAM-1 (term only) | AM-S01 NAD 0,25/1,00 | `expense_authorization` + visa chain (11.0B/C) + `SPENDING_AUTHORIZATION` doc type | **Recommend: visa'd (approved) authorizations.** ICAM measures work *completed*; a draft authorization is not an authorization. Counting drafts would let an abandoned request score 0,25. |
| **Q5** | *NPAY — « en ligne »*: no live provider exists. | ICAM-1 (term only) | AM-S01 NPAY 0,30/0,90 | `payment` has `verification_status`, `verified_by/at`, `method`, `provider_name`; `payment_intent` scaffold is behind `PAYMENTS_ENABLED=false` (mock only) | **Recommend: hold NPAY at 0 and SAY SO**, rather than substituting all verified payments. Substituting silently redefines a frozen term and inflates ICAM by up to 0,90 per dossier on manual bank transfers the methodology never meant. Revisit when Wave/OM go live. |
| **Q6** | *NFACT*: contrôlée = verified? whose control? | **ICAM-1** | AM-S01 NFACT 0,15/0,75; source map row 61 *"`VENDOR_INVOICE` documents + verification"* | `isVerified` doctrine; `reviewed_by` | **RATIFIED** (§2). Residual sub-question: count invoices verified **by the AM** or **any** verification on the AM's dossier? **Recommend: any verification on the dossier** — ICAM attributes the *dossier's* workload to its AM everywhere else; making one term actor-specific would be inconsistent. |
| **Q7** | *NCOORD — coordination documentée*: which events count? | ICAM-1 (term only) | AM-S01 NCOORD 0,30/1,20; source map row 62 *"definition is human"* | see §4 | **Recommend: defer NCOORD to a ruling; do not guess.** It is the highest-coefficient term (0,30, cap 1,20 — up to 15 % of the ceiling), so a wrong definition is the most expensive wrong answer in ICAM. |
| **Q8** | *NCOUR*: deposits only, or all physical pickups? | ICAM-1 (term only) | AM-S01 NCOUR 0,20/0,40; source map row 64 *"other courier runs not modelled"* | `invoice_deposit` + `invoice_deposit_event` custody chain | **Recommend: deposits only** (cap 0,40 = 2 runs, so the exposure is small). Non-deposit runs are unmodelled, so any wider definition is unsourceable today. |
| **Q9** | Dossier reassigned mid-period — whole ICAM to the closing AM, or split? | **ICAM-1** | *the frozen methodology does not decide this* — AM-R03/R04 filter `D=AM` on a single AM column per dossier row | `assignment_event` (`COMMERCIAL_OWNER`) holds full tenure history, so either is implementable | **See §5 — this needs YOUR ruling.** |
| **Q10** | Repeat incidents on one dossier: each counts, or once? | **ICAM-2** | AM-S01 NINC `MIN(0,50 × N(count), 1,00)` — `N(count)` implies **several may count**, capped at 2 | no register yet | **Recommend: each adjudicated non-imputable incident counts, capped at 2 by the plafond.** The cap already bounds abuse; collapsing to one would make the 1,00 plafond unreachable and contradict `N(count)`. |

**Nothing was hidden.** Q2–Q5, Q8 and Q10 were listed in §M of `0fdd6d0`; the
prose summary named only the three blockers, which was terse rather than
selective. All ten are above.

---

## 4. Q7 — « coordination documentée », candidates without invention

The distinction the brief draws is the right one: **a message existing does not
prove a coordination act.** Candidates the platform actually persists:

| Candidate | What it records | Argues FOR | Argues AGAINST |
|---|---|---|---|
| `process_handoff` (SENT + **RECEIVED**) | one department formally handed work to another and a named person **accepted** it | A deliberate, two-sided, timestamped, attributed act — the closest thing the platform has to *"coordination documentée"*. Reception is a separate act (C-4), so acceptance is provable. | Handoffs are *process* transitions; some occur without AM involvement |
| `task` (assigned + completed) | somebody was asked to do something and did | intentional, attributed | tasks are internal work items, not necessarily coordination |
| `client_notification` | the client was formally told something | timestamped, ours | that is NREP's territory — double counting risk |
| `communication_message` / `conversation` / `ec_*` | correspondence exists | volume | **a message is not a coordination**; inbound spam would score |
| `business_event` / `audit_log` | every governed act | complete | far too broad — would count the whole dossier lifecycle |

**Recommendation:** if a definition must be chosen, **received handoffs on the
dossier** is the only candidate that is deliberate, two-sided, attributed and
timestamped. Consequence of the broader readings: `communication_message` would
make NCOORD saturate its 1,20 cap on any dossier with five emails, turning the
second-largest ICAM term into a proxy for inbox volume.

**Consequence of deferring:** NCOORD reads 0 and ICAM understates by up to 1,20
(15 % of the 8,00 ceiling) — material, and it must be disclosed in the report's
methodology block rather than passed off as a complete figure.

---

## 5. Attribution and reassignment — YOUR RULING REQUIRED

**Reconfirmed:** attribution is `operational_file.account_manager_id`, designated
only by RPC `assign_commercial_owner` (permission `file:assign:commercial`,
OPS_SUPERVISOR + SYSTEM_ADMIN), with tenure history in `assignment_event`
(`subject_type = 'COMMERCIAL_OWNER'`), a mandatory reason on reassignment, and a
refusal on terminal dossiers. **Never the dossier creator** — the migration says
so in as many words. Production: 8 of 9 dossiers carry an AM; 8 assignment events
exist.

**The frozen methodology does not decide reassignment.** The workbook has one AM
column per dossier row and filters `D=AM`, which is a *spreadsheet* limitation,
not a business ruling. Three defensible readings:

| Option | Rule | Consequence |
|---|---|---|
| **A — closing owner takes all** | ICAM attributes to the AM at closure | Simplest, matches the workbook's shape. A late reassignment hands B the credit for A's work — visible and possibly unfair. |
| **B — act-time owner** | each counted act attributes to whoever owned the dossier when it occurred | Most faithful to "workload done by this person". Requires interval arithmetic over `assignment_event`; the data supports it exactly. |
| **C — split by tenure** | prorate the dossier's ICAM by ownership duration | Cheap to compute, but attributes *acts* by *time*, which is neither the acts' truth nor the workbook's. **Not recommended.** |

**Recommendation: B**, because the platform already stores the tenure history
that makes it exact, and because ICAM is defined as work *an Account Manager
did*. **A** is acceptable and simpler if Effitrans prefers it — but it must be a
ruling, not an implementation convenience.

---

## 6. NINC governance — workload, not penalty

Answering the brief's eight sub-questions:

1. **What creates a candidate?** A recorded *retour / non-conformité* on a
   dossier — the operational event, not a judgement about it.
2. **`EN_ANALYSE`?** Imputability is undecided. GOV-04: *« Imputabilité list has
   « En analyse » (→ not yet a fault) »*. It counts **neither** way — not as
   NINC workload, not as a penalty. Silence, deliberately.
3. **Who decides?** Not the recorder. Four-eyes, as everywhere else in this
   platform (`assert_actor_authority` + self-review refusal).
4. **What makes it count?** Adjudicated **NON imputable** *and* **traité**. Both
   words are in the frozen text; "traité" means the AM handled it.
5. **Why does an imputable incident NOT count?** Because ICAM measures work, and
   **F-ICAM-06 is explicit**: *"an AM-caused rework must NOT increment
   counters"*. Rewarding an AM with +0,50 of workload for their own error would
   invert the indicator. That is also why NINC is not a penalty: an imputable
   incident scores **nothing here** — its consequence lives in IPAM's quality
   dimensions (Slice 3). ICAM neither rewards nor punishes fault; it counts
   handled non-fault work.
6. **Can one incident count twice?** No — one incident, one count; several
   incidents each count, capped at 2 by the 1,00 plafond (Q10).
7. **Which timestamp sets the period?** The dossier's closure month, like every
   other ICAM term — ICAM is a per-dossier score rolled up by `EOMONTH(closure)`.
   The incident's own date does **not** place it in a month. This matters: an
   incident recorded in July on a dossier closed in September belongs to
   September's ICAM.
8. **If adjudication is corrected later?** Live ICAM recomputes; **published
   reports do not move** — the snapshot is frozen (Slice 1, trigger-enforced).
   The correction itself goes through a governed door with a motif and WORM
   history, exactly like D4's customs correction.

---

## 7. Live vs monthly vs published

| Surface | Population | Freeze |
|---|---|---|
| **Live dossier view** | any dossier, open or closed — provisional ICAM | none; explicitly provisional |
| **Monthly performance** | **closed dossiers only**, by `EOMONTH(file_state_transition.occurred_at)` — F-ICAM-05 | none; recomputes |
| **Published report** | whatever the monthly population was **at publication** | frozen snapshot + parameter version, trigger-enforced |

**The separation that must not leak:** a provisional ICAM on an *open* dossier
must never enter a monthly figure. F-ICAM-05 is the guard, and it belongs in the
read service's population filter — not in the UI, which is why it will be pinned
behaviourally rather than presentationally.

---

## 8. Stale artefacts — classified, not fixed

| Artefact | Can it affect ICAM correctness or UAT? | Class |
|---|---|---|
| `effitrans-process.ts` step 3 `implementation.gaps`: *"no VENDOR_INVOICE type and no accounts-payable model"* | **No.** Nothing reads `implementation`; it is the known-stale 5.0A snapshot (`process-registry-metadata-stale.md`). But it has already misled **two** phases, and it directly contradicts the NFACT source. | **CLEANUP** (high value — a third misdirection is likely) |
| `requiredEvidence: ["…, "vendor_invoices_verified"]` not enforced — `evaluateStepEvidence` reads `requiredDocuments` only | **No**, provided ICAM derives NFACT from document verification (the ratified rule) and not from this key. It would become a **BLOCKER** only if someone treated the key as the source. | **CLEANUP** + record the non-enforcement where NFACT is implemented |

Neither is a blocker. Neither is fixed here.

---

## 9. Updated BLOCKERS
1. **Q9 — reassignment attribution.** Blocks the ICAM-1 engine; not decidable
   from the methodology.
2. **NINC has no source register.** Blocks *complete* ICAM (ICAM-2), not ICAM-1.
3. ~~Q1 closure authority~~ — **RESOLVED**, no schema change.
4. ~~Q6 NFACT~~ — **RATIFIED**.

## 10. Updated REQUIRED
Q2 (NDOC scope) · Q3 (NREP source) · Q4 (NAD state) · Q5 (NPAY hold-or-substitute)
· Q7 (NCOORD definition) · Q8 (NCOUR scope) · Q10 (NINC multiplicity) · the
`icam` snapshot block optional on read, so Slice-1 published reports keep
rendering.

## 11. CLEANUP
The two stale artefacts above · correct rows A5–A7 of
`bi-reporting-architecture-audit.md`, which still misstate ICAM as quality-gated.

---

## 12. Proposed scopes

### ICAM-1 — the engine and the derivable terms
**Schema:** none. **Migration count: 0.**
**Engine:** `lib/performance/icam.ts` — pure `computeIcamDossier(counts)` with the
eight coefficients/caps, base 1,00, ceiling 8,00; fixtures F-ICAM-01..05.
**Read service:** `icamDossiers(tenantId, period)` in the existing
`lib/performance/read.ts`; population = closed dossiers by
`EOMONTH(file_state_transition.occurred_at)`; NDOC/NFACT/NAD/NCOUR derived per
their rulings; NREP/NPAY/NCOORD contribute 0 until ruled, **disclosed as
uncounted terms** the way ICTD discloses its own basis.
**RBAC:** none new — `performance:read`.
**UI:** none (ICAM-3 presents it).
**Tests:** fixtures; population excludes open dossiers; attribution follows
`account_manager_id`/tenure per Q9; caps hold; tenant isolation.
**Dependencies:** Q9 (blocking), Q2/Q4/Q6-sub, ideally Q3/Q5/Q7/Q8.
**UAT exit:** F-ICAM-01 reproduces **4,45**; F-ICAM-03 caps at **8,00**; an open
dossier computes but is absent from the month.

### ICAM-2 — the incident register (NINC)
**Schema:** `am_incident` + WORM correction history. **Migration count: 1.**
**Actions/RPC:** record · adjudicate (definer, `assert_actor_authority`,
self-adjudication refused) · correct (motif, WORM).
**RBAC:** `incident:record`, `incident:adjudicate` on Operations roles —
**not** on `PERFORMANCE_MANAGEMENT`. SYSTEM_ADMIN assigns, does not adjudicate.
**Audit:** business event + audit rows; correction history append-only.
**Engine:** NINC = count(NON_IMPUTABLE ∧ traité); `is_critical` → GOV-09
reliability ladder.
**UAT exit:** non-imputable +0,50; `EN_ANALYSE` changes nothing; imputable
changes nothing (F-ICAM-06); self-adjudication refused; critical incident forces
*Revue managériale*; correction recomputes live but not published.

### ICAM-3 — presentation
**Schema:** none. **Migration count: 0.**
Optional `icam` block in `ReportSnapshot` (backward-compatible on read) ·
`buildBriefing` KPIs · BI tab · report section · PDF. No second engine, no
aggregation table, no client-side maths.
**UAT exit:** ICAM appears in a draft, freezes on publication, and a later
incident or reassignment does not move the published figure.

---

## 13. GO / NO-GO

| | |
|---|---|
| **ICAM-1** | **CONDITIONAL GO** — blocked only on **Q9**; Q2/Q4 and the Q6 sub-question shape three terms; Q3/Q5/Q7/Q8 decide whether three terms count or are disclosed as uncounted. **Zero migrations.** |
| **ICAM-2** | **NO-GO** pending the register ruling + Q10 |
| **ICAM-3** | **NO-GO** until ICAM-1 lands |

**Minimum to start building: Q9.** Everything else changes what ICAM-1 *counts*,
not whether it can be built — but shipping with four terms silently at zero would
publish an understated indicator, so the disclosure is not optional if they are
deferred.

---

*Reconciliation only. No migration, schema, code, UI, seed or role change.*
