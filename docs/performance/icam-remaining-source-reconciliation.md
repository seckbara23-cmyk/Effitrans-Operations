# ICAM remaining-source reconciliation — NREP · NPAY · NCOORD

**Date:** 2026-08-30 · **Status:** AUDIT ONLY. No implementation, no migration,
no schema, no seed, no role change, no ICAM-3, no IPAM.
**Predecessors:** ICAM-1 `ff15185` · ICAM-2 `7ee8c4b` (CI 687 green).
**Production access:** read-only probes via `supabase db query --linked`.
Nothing in production was mutated.

---

## 0. Production state reconciliation — and a correction I owe

| migration | object probed | production | earlier claim |
|---|---|---|---|
| **131** `operational_incident` | 2 tables, 6 RPCs, 2 capabilities, 2 grants, 0 forbidden holders, 0 write policies | **APPLIED** ✅ | pending → now correct |
| **103** `customs_validation_event` | `customs_record.reviewed_at` | **APPLIED** ✅ | ⚠ I said *pending* — **wrong** |
| **104** `customs_editor_attribution` | `customs_record.updated_by` | **APPLIED** ✅ | ⚠ I said *pending* — **wrong** |

**Why the error survived so long.** `supabase_migrations.schema_migrations`
stops at `20260914000001`. Everything after it was applied by an operator
through the SQL Editor, which writes **no ledger row**. Reading the ledger and
concluding "not applied" is a false negative, and it was repeated across
reports without being re-checked.

> **Rule going forward:** a migration's production state is established by
> probing its **objects** — `to_regclass`, `information_schema.columns`,
> `pg_proc`, `pg_policies` — never by the ledger. The ledger is a local
> bookkeeping artefact, not a statement about production.

---

## 1. What is actually at stake

The frozen coefficients are internally exact: the eight caps sum to **7,00**,
which is precisely `ICAM_MAX (8,00) − ICAM_BASE (1,00)`. That is not a
coincidence and it carries a design assumption discussed in §6.

| | terms | Σ caps | share of the variable range |
|---|---|---|---|
| **sourced today** | NDOC 1,00 · NAD 1,00 · NFACT 0,75 · NCOUR 0,40 · NINC 1,00 | **4,15** | **59,3 %** |
| **not sourced** | NREP 0,75 · NPAY 0,90 · NCOORD 1,20 | **2,85** | **40,7 %** |

So today's observable ICAM ceiling is **5,15 of 8,00**. **NCOORD alone is 1,20**
— the single largest component and therefore the most expensive wrong answer in
the whole indicator.

---

## 2. The population is nearly empty — and that reframes the priority

| fact | production |
|---|---|
| dossiers total | **9** |
| dossiers ever CLOSED (the F-ICAM-05 population) | **1** |
| operational incidents (NINC, new) | 0 |

ICAM is computed over dossiers **closed in the period**. With one closed dossier
in the platform's entire history, **no ICAM monthly figure is meaningful today
regardless of how many terms are sourced.**

This is worth stating plainly: sourcing NREP, NPAY and NCOORD would not by
itself produce a usable ICAM report. The binding constraint is operational
adoption — dossiers being opened, worked and *closed* in the platform. The three
terms are a correctness problem; the population is the utility problem, and they
are not the same problem.

---

## 3. NREP — « reportings formels : prévu ou justifié, envoyé, horodaté »

The frozen wording carries **three** conditions. The platform can observe the
second and third. It cannot observe the first at all.

### Candidate A — `client_notification` (the earlier recommendation) ❌

19 rows, every one carrying `file_id` and `created_at`. It looked like the
answer. Two facts disqualify it.

**A1 — it has no actor, because no human authors it.** The table has no
`created_by`/`sent_by` column of any kind. Rows are emitted as **side effects of
other operational acts**, from inside those acts' own server actions:

| emitter | fires from |
|---|---|
| `custCustomsCleared` | `lib/customs/actions.ts` |
| `custDocumentsReceived`, `custDocumentsVerified` | `lib/documents/actions.ts` |
| `custInvoiceIssued`, `custPaymentReceived` | `lib/finance/actions.ts` |
| `custTransportStarted`, `custDelivered` | `lib/transport/actions.ts`, `pod-receipt.ts`, `transition.ts` |
| `notifyCustomer` | `lib/commercial/actions.ts`, `lib/process/engine/intake-actions.ts` |

Counting these would credit a named Account Manager with work **no human
performed**. It would also be self-inflating: the further a dossier advances,
the more "reportings" it accrues, automatically.

**A2 — it double-counts terms ICAM already measures.** The production
distribution:

```
file_opened 5 · documents_received 4 · delivered 2 · transport_started 2
customs_cleared 2 · documents_verified 2 · invoice_issued 1 · payment_received 1
```

`documents_verified` is NDOC's territory. `invoice_issued` is NFACT's.
`payment_received` is NPAY's. Roughly a quarter of these rows are echoes of acts
already scored elsewhere. See §6/F2 for why that is a formula-integrity fault,
not a rounding nuisance.

**Verdict: REJECT.** The earlier recommendation in
`icam-slice2-rulings-reconciliation.md` §Q3 should not be adopted.

### Candidate B — `communication_message` ⚠ closer, still not sufficient

30 rows, **4 distinct authors**, every row carrying `created_by`, `sent_at` and
a status. Structurally this *is* a record of humans sending things.

| dimension | production |
|---|---|
| `template_key` | **`staff_welcome` 15** · `shipment_progress` 10 · `invoice_issued` 2 · `shipment_delivered` 2 · `payment_received` 1 |
| `status` | SENT 20 · **FAILED 10** |
| `file_id` present | **15 of 30** |

- The **single largest template is internal staff onboarding** — half the table
  is account provisioning mail, not client reporting.
- **One in three sends FAILED.** A failed send is not « envoyé ».
- Half the rows are not attached to a dossier at all.

Usable only behind a ratified template whitelist *and* a sent-status rule.
Neither exists.

### The blocking half — « prévu ou justifié »

I probed production for any table modelling a reporting plan, schedule, cadence
or coordination commitment: **none exists** (`report|schedule|cadence|meeting`
returns only `aging_report*`, `hr_performance_cycle`, and our own
`performance_report`).

So even a perfect send log cannot distinguish a reporting that was **planned or
justified** from one that simply happened. This condition is unobservable by
construction, not by omission.

> **NREP verdict: NO AUTHORITATIVE SOURCE.** Blocked on a business definition
> (Q3-R). Even after a ruling, « prévu ou justifié » most likely requires new
> capture — this is not a query away.

---

## 4. NPAY — « paiements en ligne » ⚠ **correction to the earlier recommendation**

The earlier reconciliation (§Q5) recommended holding NPAY at 0 "because no live
provider exists". **The conclusion was right; the reasoning was incomplete, and
the incompleteness matters.**

The platform **already expresses « en ligne » precisely, with no provider
integration required** — in its own constraint vocabulary:

```
payment.method        CHECK IN (CASH, BANK_TRANSFER, CHEQUE, WAVE, ORANGE_MONEY, OTHER)
payment_intent.provider CHECK IN (WAVE, ORANGE_MONEY, MOCK)
```

`payment_intent.provider` is the platform's *own* declaration of what an online
payment rail is: **Wave and Orange Money**. And `payment.method` already carries
those two values — meaning a mobile-money payment can be **recorded manually
today**, entirely without the `PAYMENTS_ENABLED` intent machinery.

Production census:

| | |
|---|---|
| payments total | **1** — `BANK_TRANSFER`, provider `CBAO`, `VERIFIED` |
| payments with method WAVE / ORANGE_MONEY | **0** |
| `payment_intent` rows | **0** |
| payments reachable to a dossier (`payment → invoice → file`) | 1 of 1 |
| invoices carrying `file_id` | 2 of 2 |

Attribution is sound: `paid_at` / `verified_at` give the act-time instant, and
the invoice join reaches the dossier.

> **NPAY verdict: DERIVABLE TODAY, and it currently measures ZERO.** This is a
> *measured* zero over a real vocabulary — categorically different from NREP and
> NCOORD, which are unobservable. It needs one narrow confirmation (Q5-R), not a
> definition exercise.

⚠ **Still do not substitute "all verified payments."** That rule would score the
single CBAO **bank transfer** as an online payment — inflating ICAM by up to
0,90 on exactly the manual transfers the frozen term excludes.

⚠ **And do not silently flip NPAY to `COUNTED = 0` on my reading alone.** Whether
mobile money is what Effitrans means by « en ligne » — and whether a transfer
initiated through a bank's web portal also counts — is a business question.

---

## 5. NCOORD — « coordinations documentées » (cap 1,20, the largest)

| candidate | production | why it fails |
|---|---|---|
| `process_handoff` | **2 rows in all of production**, both from the C-4 journey (23–24 Aug) | structurally ideal (`sent_by`/`received_by`/`sent_at`/`received_at`) but effectively **unpopulated** — it would score ~0 on every real dossier |
| `business_event` | 126 rows | it is the ledger of *everything*: `PROCESS_STEP_COMPLETED` 13, `DOCUMENT_UPLOADED` 12, `DOSSIER_STATUS_CHANGED` 9, `TRANSPORT_STATUS_CHANGED` 9… Counting it double-counts nearly every other ICAM term and **saturates the 1,20 cap after 4 events** on any active dossier |
| `task` | 11 rows | a task is assigned work, not a documented coordination |
| `conversation` | 5 rows, **0 carrying `file_id`** | cannot be attributed to a dossier **at all** |

No table models "a coordination" as a business object, and no `COORDINATION`
event type exists in the 35 `business_event` types present in production.

> **NCOORD verdict: BLOCKED — neither a definition nor a source.** It is also the
> most expensive term to get wrong (1,20 = 17 % of the ICAM ceiling). Do not
> guess it.

---

## 6. Cross-cutting findings

**F1 — the recurring shape: a *side effect* of measured work is not work.**
`client_notification` and `business_event` are both faithful records — of
consequences. This is the same root pattern this program has closed repeatedly:
a value taken from a source that observes the act rather than *is* the act.
Applied to a person-level indicator it is worse than usual, because the wrong
number lands on a named colleague's file.

**F2 — double counting is a formula-integrity fault, not a rounding one.**
The eight caps sum to exactly `MAX − BASE`. That arithmetic only closes if the
frozen design intends the eight terms to be **disjoint** — each unit of work
counted once, under one term. Any source that overlaps another term (`business_event`
for NCOORD; `documents_verified`/`invoice_issued` notifications for NREP) breaks
the assumption the ceiling is built on. **This is worth ratifying explicitly
(Q13) because it constrains every future sourcing decision, not just these three.**

**F3 — "unsourced" conflates two different conditions.** NREP and NCOORD lack a
**definition**; NPAY lacks **instances**. Only the second is cured by the passage
of time. Reporting them under one label ("SOURCE_UNAVAILABLE") is honest but
lossy, and the distinction should reach the reader of a published report.

**F4 — the population, not the terms, binds today.** One closed dossier. Sourcing
all three terms tomorrow would still produce an ICAM over a population of one.

---

## 7. Questions for Effitrans — all of them, not only the blockers

### Blocking (no implementation is possible without these)

**Q3-R — NREP: what is a « reporting formel », and what makes it « prévu ou
justifié »?** The platform has no reporting plan. Sub-questions that must be
answered together: (a) does a formal reporting mean a client-facing send, or any
recorded reporting act? (b) is there a *cadence* the AM is expected to meet, and
where does it live? (c) if not, does « justifié » mean "attached to a triggering
event", and which events? *No recommendation offered — the frozen text does not
decide it and I will not invent it.*

**Q7-R — NCOORD: what is a « coordination documentée »?** Which real-world act
does the AM perform that Effitrans wants counted? Only once that is named can a
source (or a capture surface) be proposed. *No recommendation offered.*

### Narrow — cheap to answer, and they unblock real work

**Q5-R — NPAY: is « en ligne » exactly {WAVE, ORANGE_MONEY}?** The platform's own
`payment_intent.provider` says so. Also: (a) must the payment be `VERIFIED`?
(recommend yes — an unverified payment is a claim, not a receipt); (b) does a
bank transfer initiated through a bank's web portal count? (recommend no — the
rail is what is observable, and `CBAO` is recorded as `BANK_TRANSFER`).

**Q11 — NREP scope: do internal staff emails count?** Almost certainly not, but
`staff_welcome` is the largest template in `communication_message` (15 of 30), so
any naive row count is half internal onboarding mail. Recommend excluding it
explicitly rather than relying on a whitelist nobody wrote down.

**Q12 — does a FAILED send satisfy « envoyé »?** 10 of 30 sends failed.
*Recommend no.*

**Q13 — are the eight ICAM terms intended to be disjoint?** The cap arithmetic
(§6/F2) says yes. Confirming it turns an inference into a rule that binds future
sourcing decisions.

**Q14 — how should a genuine zero be presented?** NPAY may become a *measured*
0 while NREP/NCOORD remain *unmeasurable*. Should a published report distinguish
« 0 » from « non mesuré » — and if so, in what words? This is a presentation
ruling that belongs to ICAM-3, raised now because it changes what ICAM-3 must
build.

---

## 8. What this audit does not change

- **No code, migration, schema, seed, role, or capability was touched.**
- ICAM `basisComplete` stays **false**; NREP, NPAY and NCOORD continue to report
  `SOURCE_UNAVAILABLE` and are never dressed up as measured zeroes — **including
  NPAY**, which stays unavailable until Q5-R is ruled.
- No production data was mutated; every production query was read-only.
- ICAM-3 and IPAM are not begun.

---

## 9. Verdict

| term | cap | source exists? | blocked on | verdict |
|---|---|---|---|---|
| **NREP** | 0,75 | no — best candidate is authorless and double-counts; « prévu » is unobservable | **Q3-R** (definition) + likely new capture | **NO-GO** |
| **NPAY** | 0,90 | **yes — `payment.method IN (WAVE, ORANGE_MONEY)`**, dossier-reachable, act-time instant available | **Q5-R** (one narrow confirmation) | **READY on a ruling; currently measures 0** |
| **NCOORD** | 1,20 | no — no business object, and every candidate double-counts or is unpopulated | **Q7-R** (definition) | **NO-GO — highest cost, do not guess** |

**Two of the three are blocked on business meaning, and code must not settle
it.** The third needs one sentence from Effitrans.
