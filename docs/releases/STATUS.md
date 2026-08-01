# Release Status — standing table (updated at every release event)

*Last updated: 2026-08-01 (**R1.0 RELEASED** — §3 all PASS, §4 signed; see
`release-signoff-R1.0.md` §7 for the final report. Next: R1.1 activation, gated on
Q-01 (D1) and the preview visual sign-off (D2)).*

> **Correction (2026-07-31).** The previous version of this table stated "schema current
> through migration 67; 68–72 pending". The Operator-Task-1 audit proved that wrong:
> **migrations 57–72 are all structurally present in production**; only the *ledger*
> stops at 56 (`20260724000001`). The error came from inferring state from phase reports
> instead of probing — the exact drift the release framework exists to catch, caught on
> its first run.

> **History sanitation, 2026-07-31.** Two business documents were committed by mistake into
> a public repository and were purged from git history with `git-filter-repo`, followed by a
> lease-guarded force-push. **Five commit SHAs changed as a result. No application behaviour,
> code, schema or configuration changed** — the trees are identical apart from the two
> removed files. Full mapping and verification in
> [`R1.0/history-sanitation-2026-07-31.md`](R1.0/history-sanitation-2026-07-31.md). Every SHA
> cited elsewhere in this document predates the rewrite and still resolves.

## Current production (verified 2026-07-31, post-repair)

| Item | Value |
|---|---|
| Application | serves `main` HEAD (verified `1abccda` post-repair) via `/api/version` |
| Schema | **structurally current through migration 72** (probes + manual SQL audit + 30/30 verification script; evidence in `R1.0/verification-57-67.md`) |
| Migration ledger | **72 / 72 recorded** — reconciled 2026-07-31 via `migration repair --status applied` (16 versions, history-only; runbook §3.3); post-repair list: zero unrecorded, zero LOCAL≠REMOTE, last `20260729000002`. Operator SQL confirms `schema_migrations` = 72, `admin:users:%` = **8** (7 granular + retained umbrella `admin:users:manage`), `finance:aging:%` = 11 |
| Activation state | Aging dark via unset `EFFITRANS_FINANCE_AGING_ENABLED` (route 404s); permission grants for 70/71/72 live in DB per manual audit; rollout-row states unverified read-only |

## Pending releases

| Release | Content (REVISED) | State | Blockers |
|---|---|---|---|
| ~~R1.0~~ | ✅ **RELEASED 2026-08-01** — moved to Deployment history | signed: `release-signoff-R1.0.md` §4/§7 | — |
| **R1.1** | ⏸ **ACCEPTANCE DEFERRED 2026-08-01** (management decision): implementation complete, preview infrastructure live (`qrotqyaaugyzgljcwcpg`, corrected dataset `3c2cb58`); remaining work is **acceptance/governance only** (D2 visual review → D5 flag → D6 smoke → D7 DAF). Production flag stays **unset** until the gates complete. D1 ✅ D3 ✅ D4 ✅ | parked at D2 | resumes on management go |
| **R2.0 — HR** *(active focus)* | Development focus shifted to the **Effitrans HR Platform** (2026-08-01). HR-0F architecture freeze: `docs/hr/hr-0f-architecture-freeze.md` | architecture phase | HR-1 starts on explicit go once the freeze blockers clear |
| R1.2 | FIN-AGING-4 legacy import (unbuilt) | specified | R1.1 |
| R2.0 | HR-1..HR-4 (unbuilt; registry live **and its migration applied** — HR-1 runs in production already, gated by `hr:read` holders) | architecture ratified | HRQ-D2 · structure answers · go |

## R1.0 closure documents

| Document | Purpose |
|---|---|
| [`R1.0/operator-validation-checklist.md`](R1.0/operator-validation-checklist.md) | executable A2/A3/B1–B4: exact URL, seat, clicks, expected, pass/fail, remedy |
| [`release-signoff-R1.0.md`](release-signoff-R1.0.md) | the official sign-off record — R1.0 closes only when signed |

## Outstanding UAT

**R1.0 UAT complete 2026-08-01** — B1 (H1 = H2 = H3 on `EFT-INV-2026-00001`), B2
(positive target; negative control not executable — limitation recorded), B3
(`EFT-IMP-2026-00003` → Clôturé), B4 (temp-password lifecycle) all PASS.
**Still open, deferred with recorded triggers:** B4 expired path (preview-only) · B2
negative control (first non-customs dossier) · B1 corrected-layout check (next new
invoice, `uat2b-2`) · aging preview visual checklist (**D2**, blocks R1.1).

## Known decision blockers

~~Q-01~~ **CLOSED 2026-08-01**, verbatim: « Montant = outstanding balance as of the
reporting date. » (Finance Manager — unblocks R1.1 D1) · HRQ-D2 ceiling
9→11 · HRQ-A4 staging purge · HRQ-D1 reason vocabulary · DEC-B63 legal gates ·
Messaging Center activation state — *verify at R3.0 planning*.

## Deployment history

| Release | Date | SHA | Migrations | Sign-off |
|---|---|---|---|---|
| — (pre-framework) | ≤ 2026-07-31 | rolling | 1–72 applied (57–72 outside the ledger; reconciliation = R1.0-R) | Phase 8.0 gate documents |
| R1.0-R (ledger reconciliation) | 2026-07-31 | `1abccda` (no code change; app already served it) | ledger repaired to **72/72** — `migration repair --status applied` × 16 (`20260724000002` → `20260729000002`); no DDL; schema spot-checks unchanged | verification 30/30 (operator) · repair GO (operator) |
| **R1.0** (reconciliation + validation) | 2026-07-31 → **2026-08-01 RELEASED** | `c29b7cf` at completion (post-sanitation head) | none — validation only. Side products shipped during UAT: invoice-renderer geometry fix `733c116` (`uat2b-2`, immutable artifacts untouched) + history sanitation (5 SHAs remapped) | A1–A3, B1–B4 **all PASS** (B2 with stated limitation) · **§4 signed 2026-08-01** (Bara Seck, all seats; provenance note in the sign-off) |
