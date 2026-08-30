# ICAM-2 / NINC — STOP before schema

**Date:** 2026-08-30 · **Status:** STOPPED at the brief's own stop conditions.
**No migration, no schema, no code, no roles, no seed.** Predecessors: `0fdd6d0`,
`aa53428`, ICAM-1 at `ff15185` (CI 33316147198).

The brief instructs: *"STOP before implementation if … « traité » has no
authoritative business meaning [or] the NINC qualifying activity timestamp
cannot be determined"*, and *"Do not solve business ambiguity with code."*
Both conditions are met, and a third conflict was found. What follows is what
the frozen corpus does and does not decide.

---

## 1. Q10 — RESOLVED from the frozen fixtures ✅

**Multiple qualifying NINC events count, bounded by the plafond.** Proven, not
inferred:

| evidence | value |
|---|---|
| AM-S01..S08 | `MIN(COEF × **N(count)**, PLAF)` — NINC (0,50 ; 1,00) |
| **F-ICAM-01** | NINC = **1** → 0,50 |
| **F-ICAM-03** | NINC = **3** → `MIN(0,50×3, 1,00)` = **1,00** |

A frozen fixture uses NINC = 3. A one-incident-per-dossier rule would make
F-ICAM-03 unreproducible and the 1,00 plafond unreachable, so the register must
admit several events, each counted once, with the cap doing the bounding
(effectively 2 events). **No ruling needed.**

## 2. Imputability vocabulary — RATIFIED, and my earlier proposal was wrong ⚠

`formula-source-census.md:64` records the workbook's own `LISTES` sheet:

> 9 lists incl. the four-state `Oui/Non/Non évalué/Non applicable` and
> **`Imputabilité (Oui/Non/En analyse/Non évalué)`**

The ratified vocabulary is **four states: Oui · Non · En analyse · Non évalué.**

The pre-implementation audit (`0fdd6d0` §D) proposed
`IMPUTABLE_EFFITRANS / IMPUTABLE_CLIENT / IMPUTABLE_TIERS / NON_IMPUTABLE /
EN_ANALYSE`. **Those categories were invented.** The brief says *"Do not invent
categories merely because they sound reasonable"* — so that proposal is
withdrawn. Any register must use the four ratified states.

GOV-04 and F-GOV-04 confirm the semantics: `En analyse` is *not yet a fault* and
must score neither way; `Non évalué` likewise. Only a definitive **Non** opens
the door to NINC.

**Adjudication authority is also already ratified** — the governance matrix
assigns **imputabilité** to the *Superviseur / responsable de service*, with
*Responsable Qualité* validating "imputable errors & conformity items; incident
analysis". The matrix's own rule: *"anything that can blame … is NOT entered by
the person being measured."* Four-eyes is therefore doctrine, not a new
invention — but it names **existing operational roles**, which is a strong
argument against creating a new one.

---

## 3. ⛔ STOP 1 — « traité » has no authoritative meaning

Exhaustive search of the frozen corpus: the word appears **only inside the NINC
label itself**. There is no treatment state, no treatment actor, no treatment
timestamp, no completion rule, and no incident lifecycle anywhere.

```
NINC — retours/non-conformités NON imputables traités
                                              ^^^^^^^
                                     defined nowhere
```

Three readings are defensible and they produce materially different counts:

| reading | « traité » means | consequence |
|---|---|---|
| **A** | the AM **handled** the return — an operational treatment act, distinct from adjudication | needs a treatment state + actor + timestamp in the register; richest, and the only one that makes "traité" a separate condition from "non imputable" |
| **B** | the incident reached a **final adjudicated** state (non-imputable) — adjudication *is* the treatment | "traité" adds nothing beyond adjudication; simplest, but makes the frozen wording redundant, which is a warning sign |
| **C** | the incident is **closed** on the dossier — treatment = the dossier moved on | ties NINC to dossier lifecycle rather than to AM work; weakest fit for a workload indicator |

The frozen text lists **both** conditions — *NON imputables* **and** *traités* —
which argues against B, since a methodology rarely states a condition that is
already implied. But "argues against" is not a ruling, and this decides both the
schema and the counts.

## 4. ⛔ STOP 2 — the qualifying activity instant is therefore undetermined

Q9 (ratified) requires attributing each act to the AM who owned the dossier
**when the act occurred**. For NINC the candidate instants are:

| candidate | argues for | argues against |
|---|---|---|
| **treatment completion** | the frozen wording makes *treating* the work | undefined until STOP 1 is ruled |
| adjudication | a persisted, four-eyes instant | adjudication is a *supervisor's* act, not the AM's workload |
| recording | earliest, simplest | recording an incident is not handling it |

ICAM-1 proved this matters: `attribution.ts` resolves ownership at an instant and
refuses to guess. Wiring NINC to the wrong instant would attribute a colleague's
work to the wrong person — silently, and plausibly.

## 5. ⚠ CONFLICT — the frozen source map calls NINC **VALIDATED MANUAL**

`platform-data-source-map.md:63`:

> | NINC — retours/non-conformités NON imputables traités | **no incident
> register** | **NOT AVAILABLE → VALIDATED MANUAL** | imputability gate is
> mandatory anyway |

The frozen Phase-0 expectation is a **supervisor-validated count**, not a
derived event register. F-ICAM-06 points the same way: *"an AM-caused rework must
NOT increment counters — governance fixture: counters unchanged (**enforced by
validation, not formula**)."*

This is a genuine architectural fork the brief did not anticipate:

| | **Event register** (the brief's assumption) | **Validated count** (the source map's) |
|---|---|---|
| what is stored | each incident, adjudicated individually | a per-dossier NINC figure a Superviseur validates |
| effort | one table, two capabilities, adjudication + correction workflow | a much smaller validated-entry surface |
| fidelity | richer; auditable per incident | matches the frozen expectation exactly |
| risk | building an operational workflow Effitrans may not want to run | loses per-incident evidence IPAM may later need |

I recommend the **event register** — per-incident evidence is what IPAM's quality
dimensions will need in Slice 3, and a validated count cannot be decomposed
later. But it is more than the frozen methodology asks for, and that is your
call, not mine.

---

## 6. What is NOT blocked

Everything else in the brief is answerable from the corpus and is ready the
moment the rulings land: Q10 (§1) · the imputability vocabulary and its
authority (§2) · four-eyes doctrine · the ICAM engine contract (ICAM-1 already
accepts `NINC` and marks it `SOURCE_UNAVAILABLE` today) · the F-ICAM-05 /Q9
separation (already pinned) · RBAC shape (existing Operations roles, per §8 of
the brief and the governance matrix).

**ICAM-1 is unaffected** and remains CI-green: NINC reads `SOURCE_UNAVAILABLE`,
`basisComplete` is false, and no zero is fabricated.

---

## 7. The three rulings needed

**R1 — what does « traité » mean?** Option A (a distinct treatment act by the
AM, with its own actor and timestamp), B (adjudication is the treatment), or C
(dossier closure). *Recommend A*, because the frozen text states it as a second
condition alongside non-imputability.

**R2 — which instant is the NINC workload act?** Follows R1. If A: treatment
completion. *Recommend treatment completion* — that is the work being measured.

**R3 — event register or validated count?** *Recommend the event register*, for
the per-incident evidence Slice 3 will need — while noting the frozen source map
expects a validated count, so this is a deliberate step beyond it.

Two secondary points needing confirmation, cheap once R1–R3 land: whether the
four ratified states are the *only* imputability values the register may store
(recommend yes), and whether `incident:record` / `incident:adjudicate` attach to
the existing **Superviseur** and **Responsable Qualité** roles the governance
matrix already names (recommend yes — no new role).

---

## 8. Verdict

**ICAM-2 — NO-GO pending R1, R2, R3.**

Q10 is resolved and the vocabulary is ratified, so two of the five stop
conditions cleared. The remaining three are business meaning, not engineering,
and the brief is explicit that code must not settle them.

*No migration, schema, code, UI, seed or role change was made. No production
data was touched.*
