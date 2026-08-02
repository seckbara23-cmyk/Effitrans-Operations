# HR-4 — Onboarding & Equipment: Completion Report

**Date:** 2026-08-02 · **Status:** CLOSED — deployed to production (operator PASS)
**Commit:** `beee297` · CI: build 10/10 · rls-tests **69/69, zero skipped** (clean 1->76 chain)

## Production deployment record

| Step | Result |
|---|---|
| Migration `20260802000002` | applied |
| `hr_onboarding_case` / `hr_equipment_type` / `hr_equipment` | present |
| `uq_equipment_single_custodian` | present — the one-custodian invariant is live |
| RPCs `hr_assign_equipment` · `hr_return_equipment` · `hr_complete_onboarding_item` · `hr_complete_onboarding` | all 4 present |
| `hr_equipment_type` seed | 11 rows |
| Ledger | repaired; **76/76**, last `20260802000002` (independently verified against ref `xtpppzhkiagdpmnghdlc`) |

**No operator work remains for HR-4.**

## Naming clarification — the custody table

The custody table is **`public.hr_equipment_assignment`**. A table named
`hr_equipment_custody` **does not exist and never did** — a production probe returns
`PGRST205` for that name and `200` for `hr_equipment_assignment`. The earlier NULL was a
probe-name mismatch, not a missing object.

The name is deliberate: it mirrors `employee_assignment` (HR-2), because the two are the
same idea applied to different subjects — a dated, append-only placement with exactly one
open row, enforced by a partial unique index. "Custody" is what the table *records*;
"assignment" is what the platform *calls* the act, consistently across HR.

| Concept | Table | Open-row invariant |
|---|---|---|
| Where a person sits | `employee_assignment` | one open PRIMARY per employee |
| Who holds an asset | `hr_equipment_assignment` | one open row per equipment |

## What shipped

Onboarding cases with a closed lifecycle (DRAFT/READY/IN_PROGRESS/COMPLETED + governed
CANCELLED) and one live case per employee · configuration-driven checklist templates with
snapshot labels · provisioning tracking that references identity without creating it ·
typed equipment registry · append-only custody with explicit return outcomes · the
completion gate enforced **in the database**, naming its blockers in French · seven new
ledger kinds · department icons made distinct (Operations to the gear, HR to a new team
mark previously shared with Administration).

## ADR-HR2-01 — exercised, not extended

HR-4's four state-changing operations are **transactional RPCs**: the domain write and its
ledger event commit together or not at all. HR-4 therefore added **no new compensation
logic**. The ADR's reserved option is now taken for the highest-risk surface; the earlier
compensation paths in HR-2/HR-3 remain as they are, and may be migrated the same way when
those areas next need SQL.

## Gates open after HR-4 (unchanged — none new)

B1 HRQ-D2 grants · B2 structure seeds (checklist templates and org content stay empty until
seeded) · B3 HRQ-A4 purge window · DEC-B63 (blocks `employee_identifier` only).

## Open design note

**Fleet vs HR vehicle custody.** No fleet or vehicle catalog exists today, so HR may hold a
vehicle as an asset type without conflict. If a Fleet module is ever built, vehicle custody
must be reconciled between the two — recorded here, deliberately not pre-solved.
