# EFFITRANS-HR-7A/7B/7C — completion report & production UAT closure

**Date:** 2026-08-16 · **Implementation:** `19efd11` (CI #482 GREEN) ·
**Audit baseline:** `ede0da4` (docs/hr/hr-7-payroll-preparation-audit.md) ·
**Migration 110** `20260901000001_hr_payroll_preparation.sql` — **applied and
reconciled in production** (operator ran the SQL + `migration repair`;
`npx supabase migration list --linked` shows local = remote through
`20260901000001`, re-verified from tooling at closure time). Production serves
`19efd11` (`/api/version`).

## Closure verdict

**HR-7A/7B/7C: COMPLETE / PRODUCTION-VALIDATED.** Repository evidence (CI #482
with the A–H SQL suite green, migration parity, the shipped domain/UI) and the
operator-led production UAT below agree on every contract the phases claimed —
including the one that matters most, snapshot immutability under live source
mutation. No blocker remains inside the A/B/C scope. HR-7D/7E remain **open by
design**, gated on the ratification questions preserved below.

## Production UAT evidence (operator-observed, recorded verbatim)

The following was observed by the operator in production at
`/departments/hr/paie` as Chargé RH, 2026-08-16. It is human-observed UAT
evidence, not automated capture.

| # | Test | Observed | Verdict |
|---|---|---|---|
| 1 | Period creation | `UAT-PAIE-2026-08` / « UAT Paie août 2026 » / 2026-08-01→31 created in **Brouillon** | PASS |
| 2 | Fact collection | 2 employees collected (Joe Doe EMP-0001, Chris Demo EMP-0002); factual exceptions surfaced (missing attendance, missing covering contract) — **no data invented** | PASS |
| 3 | Verification | « Vérifier » → **Vérifiée**; governed reopen path and approval boundary visible | PASS |
| 4 | Parked approval | UI states approval/locking requires `hr:payroll:approve`, unassigned pending Q7 — **left unassigned, as designed** | PASS |
| 5 | Adjustment vocabulary | Tenant-created kind `UAT-ABS` / « Ajustement UAT » / DAYS | PASS |
| 6 | Adjustment four-eyes | Proposal (+1 j, Joe Doe) refused self-approval: « Quatre yeux : le décideur doit différer du proposant. » Adjustment intentionally left PROPOSED | PASS |
| 7 | Attendance integration | Attendance entered via Congés & présence; explicit re-collection: 1 j · 8h00, then 2 j · 16h00 | PASS |
| 8 | **VERIFIED snapshot immutability (critical)** | Period VERIFIED at « 2 j · 16h00 » (collected 16/08/2026 16:39:14). A NEW authoritative attendance row (2026-08-12, 480 min) was then entered. Returning to the workspace **without reopening**: status still Vérifiée, timestamp unchanged, Joe still **2 j · 16h00** | PASS |
| 9 | Governed reopen + recollection | « Rouvrir » → « Recollecter » : Faits collectés, new timestamp 18:08:21, Joe **3 j · 24h00**, Chris unchanged 0 j · 0h00 | PASS |

Cases 8+9 prove the complete production contract: *authoritative HR change →
VERIFIED snapshot stays frozen → governed reopen → explicit recollection →
updated facts in a new preparation state* — the exact reproducibility model
the audit specified (FIN-AGING idiom) and the SQL suite proves on every CI run.

## Boundary confirmation

No payroll engine and no monetary functionality exists or was introduced:
no salary/gross/net/rate storage or calculation, no payment, no accounting
entry, no payslip, no declaration, no invented overtime/calendar/identifier or
seat assignment. The boundary is **structural**: migration 110's assertion 6h
refuses to apply if a monetary-looking column enters an `hr_payroll_%` table;
the SQL suite re-asserts it every CI run; the vitest suite bans the vocabulary
from the domain layer. DEC-B63 stands. MAYA carries no payroll — there is no
parity claim to satisfy.

## Ratification gates — preserved, unanswered

**Q1** monetary amounts / whether HR-7E exists at all · **Q4** is_paid
semantics (leave categories still NULL) · **Q5** payroll calendar/cutoff ·
**Q6** export columns/contract · **Q7** approval/locking seats
(`hr:payroll:approve` parked; DGA/DAF still 0 members) · **Q8** employee
self-disclosure · **Q9** schedules/overtime · **Q10** statutory identifiers.
None is answered here or in code.

## Next-phase determination

**A — buildable now under already-ratified decisions:**
* **HR-8 Offboarding** — the recommended next phase. HR-0F ratified its shape
  (« clearance gates; equipment return blocks completion; prompts — never
  silently performs — the 8.1A account archive/ban ») and EVERY dependency is
  built and live: employee lifecycle with TERMINATED-requires-reason and the
  rehire-is-a-new-record rule (HR-1/DEC-B26), `termination_reasons` vocabulary
  in hr_configuration, equipment assignments with the open-row idiom (HR-4),
  documents/contracts with the ENDED status (HR-3), the 8.1A account
  archive/ban to PROMPT (never perform), the ledger and identity/actor
  patterns of B1/B2/7. No Effitrans ratification gates its foundation. It is
  also the highest-value gap: HR-7 collection now FLAGS departures
  (`TERMINATED_IN_PERIOD`), but nothing governs the departure itself —
  today an employee can be terminated with company equipment still assigned
  and no clearance trail.
* (Smaller, same class: HR-9 facts-only reporting — real counters exist
  already; lower value than closing the lifecycle. Deferred behind HR-8.)

**B — blocked pending Effitrans ratification:** HR-7D export (Q5/Q6/Q7);
HR-7E amounts (Q1 + DEC-B63 legal gates); leave `is_paid` completion (Q4);
payroll self-disclosure lane (Q8); schedule/overtime model (Q9); statutory
identifiers (Q10); every seat grant (Q7 + the standing DGA/DAF staffing and
second-HR-Officer designation).

**C — optional/deferred:** HR-9 Reporting RH; competency catalog and cycle
vocabularies (Effitrans data entry, not engineering); Q2-style disclosure
refinements.

**D — explicitly out of scope (DEC-B63, permanent unless separately
ratified):** payroll calculation, monetary compensation storage, payment
execution, accounting entries, payslips, statutory declarations, Sage writes.

**Recommendation:** proceed to **HR-8 Offboarding** (audit-first per the house
process), leaving all HR-7 gates untouched until Effitrans answers. HR-7 work
resumes only as HR-7D (after Q5/Q6/Q7) or HR-7E (after Q1), in that order of
likelihood.
