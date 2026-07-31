# Release Status — standing table (updated at every release event)

*Last updated: 2026-07-31 (RELEASE-0 — framework established; no release executed yet).*

## Current production

| Item | Value |
|---|---|
| Application | continuous from `main` (Vercel); verify served SHA via `/api/version` |
| Schema | current through migration 67 (`20260727000005_process_reconciliation`) — per the 9.0F reconciliation; **68–72 pending** |
| Dark-but-deployed code | invoice artifact + three-hash parity (68) · Douane discovery (69) · `file:transition` (70) · user admin + password lifecycle (71) · Finance Aging (72 + flag + grants) |

## Pending releases

| Release | Bundle | State | Blockers |
|---|---|---|---|
| **R1.0** Platform Foundation Consolidation | migrations 68–71 + UAT gates | **ready to schedule** — all CI-rehearsed | operator window; readiness checklist walk |
| **R1.1** Finance Aging Foundation | migration 72 + activation | specified | R1.0 UAT closed · aging preview sign-off · **Q-01** |
| R1.2 Aging legacy import | FIN-AGING-4 (unbuilt) | specified | R1.1 · Q-01 |
| R2.0 Human Resources | HR-1..HR-4 (unbuilt; registry live) | architecture ratified | HRQ-D2 · structure answers · explicit go |

## Outstanding UAT (defined, not yet run)

UAT-2B three-hash smoke (R1.0) · Douane discovery (R1.0) · closure of EFT-IMP-2026-00003
(R1.0) · temp-password/forced-change flow (R1.0) · aging preview visual checklist (R1.1).

## Known decision blockers

Q-01 « Montant » = outstanding (gates R1.1/R1.2) · HRQ-D2 permission ceiling 9→11 ·
HRQ-A4 staging purge window · HRQ-D1 termination-reason vocabulary · DEC-B63 legal gates
(HR-3+) · Messaging Center production activation state — *verify at R3.0 planning*.

## Deployment history

| Release | Date | SHA | Migrations | Sign-off |
|---|---|---|---|---|
| — (pre-framework) | ≤ 2026-07-23 | rolling | 1–67 | Phase 8.0 gate documents |
