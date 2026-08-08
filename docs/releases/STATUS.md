# Release Status — standing table (updated at every release event)

*Last updated: 2026-08-08 (**IA RENAME SHIPPED — CI GREEN run #376 on `d509b55`**: rls-tests
81/0/0, build 10/0/0. **The Communications workspace is now Enterprise Mail at `/mail`**
(`/communications/*` → permanent 308 redirects in next.config.mjs; triage → inbox). No
migration, no schema, no permission, no RLS change. "Communications" is now RESERVED for a
future omnichannel workspace (SMS/WhatsApp/portal messaging/notifications). **Label kept in
ENGLISH** — a French rendering was tried and rejected because "Messagerie d'entreprise" sits one
word from "Messagerie" (Phase 8.7 chat at /messages) in the same nav section. **NOT renamed,
because they are contracts, not labels:** `communication:*` permission codes (live grants,
three-source rule), `communication_message` and `ec_*` tables, the `communication` event domain
and `CORRESPONDENCE_*` types (**business_event is APPEND-ONLY — renaming a domain would orphan
every existing row**), audit action codes and storage buckets. New `/mail/sent` and
`/mail/drafts` are filtered views over the ONE outbound queue; **Archive and Attachments were
NOT built** (no backing surface). **Administration → Users → Enterprise Mail was NOT built — it
is EMP-4A**, a separate audit-first phase with a live STOP clause. See
`docs/mail/ia-enterprise-mail-rename.md`. **EMP-5 and EMP-4A have not begun.**
Previously: (**EMP-4 COMPLETE — CI GREEN run #373 on `a5f939b`**: rls-tests
81/0/0, build 10/0/0, green on the FIRST attempt. Attachment → document ingestion.
**⚠️ MIGRATION 88 IS NOT APPLIED IN PRODUCTION** — apply and confirm the ledger reads 88/88;
there is no flag or permission to set, and the feature stays unreachable regardless because
`communication:inbound:read` is granted to no role (RATIFY-EC1-1, untouched as ratified).
Migration 88 is ONE nullable FK + ONE partial unique index: no table, bucket, policy,
permission, emitter, trigger, RPC or background job. Both provenance signals are kept — the SHA
proves CONTENT identity, the FK proves BUSINESS provenance, because two customers can send the
same PDF. Idempotency is the unique index rather than a service check (a read-then-insert loses
a race); soft-delete deliberately does NOT reopen ingestion, and a lost race does NOT delete the
stored object. Bytes are hashed once and stored once, and the copy is REFUSED if it disagrees
with the hash EC-1 recorded. Ingestion lives in its own module, NOT in EC-2's triage actions, so
EC-2's anti-auto-promotion guard stays true. New SQL suite proves exactly-once DOCUMENT_UPLOADED
from the db trigger only, no extra event, inbound evidence unchanged. See
`docs/mail/emp-4-completion-report.md` and the audit `docs/mail/emp-4-audit.md`.
**EMP-4A (mailbox membership + user provisioning) is REGISTERED but NOT STARTED** —
`docs/mail/emp-4a-mailbox-provisioning-brief.md`; its STOP clause is live because per-mailbox
ACL is the new security boundary EMP-0 deferred as RATIFY-EMP-2. **EMP-5 has not begun.**
Previously: (**EMP-3 COMPLETE — CI GREEN run #370 on `ad8da34`**: rls-tests
80/0/0, build 10/0/0. Governed outbound mail — compose, reply, reply-all, drafts and a
CAS-protected send — entirely on the EXISTING `communication_message` queue. **⚠️ MIGRATION 87
IS NOT APPLIED IN PRODUCTION**; apply via the sanctioned path and confirm the ledger reads
87/87. Outbound stays dark until `EFFITRANS_EC_OUTBOUND_ENABLED=true` AND a real provider is
configured. **Operator-visible behaviour change:** with no provider configured, template mail
(invoices, quotations) now records FAILED instead of a false SENT — that is the correction, not
a regression. THREE defects CI caught that local testing could not: (1) `ADD CONSTRAINT`
validates existing rows, so the sent-evidence check would have ABORTED migration 87 on any
database with history — fixed with `NOT VALID`, back-fill refused because we do not know which
provider accepted historical sends; (2) revoking from PUBLIC does NOT remove Supabase's
explicit default-privilege grants, so four SECURITY DEFINER functions were reachable by anon
and authenticated — the migration's own assertion caught it and rolled back
(`docs/ops/emp-3-privilege-incident.md`); (3) `business_event.source` is a closed set, so
`comms_rpc` was added following the assignment_rpc/document_rpc/reconcile_rpc precedent; (4) my own
table-write assertion tested the WRONG property — DML grants on `communication_message` are
INERT because RLS is on with no write policy (no table in this platform has one), so the
privileges were left alone and the assertion replaced with a proof of effective immutability. Also
fixed the PRE-EXISTING duplicate-send defect in `deliver()`. **⚠️ NEW FINDING, reported not
fixed: no migration in this repo revokes from anon/authenticated, so the pre-existing
quotation/document/customs/reconciliation/policy RPCs are likely executable by authenticated
sessions on hosted Supabase — recommend a dedicated OPS-SEC-1 phase.** See
`docs/mail/emp-3-completion-report.md`. **EMP-4 has not begun.**
Previously: (**EMP-2 COMPLETE — CI GREEN, run #363 on `54a45b0`**: rls-tests
79/0/0, build 10/0/0. Thread correlation over the existing capture: conversation identity is
**derived, never stored**, because `ec_inbound_message` carries `prevent_mutation` — a
`thread_id` backfill is not discouraged but IMPOSSIBLE, and the brief independently forbids
rewriting historical messages. Union-find over Message-ID / In-Reply-To / References;
**subject, sender and date are not inputs at all**; case is never folded and a msg-id must
contain `@` — both because **splitting is safer than merging**, a false link being a
confidentiality failure where a missed one is merely visible incompleteness. Repairs the gap in
the stored `thread_key`, which split any conversation whose reply omitted References. No
migration (chain 86), no table, no RLS, no event, no emitter, no write path. **EMP-1 is
verified by the same run** — `b0009cd` is a proven ancestor of `54a45b0`, and the only commits
without runs are documentation-only. **RESOLVED: the earlier "no CI run" alarm was a GitHub
Actions PLATFORM OUTAGE** (incident 2026-08-06T15:22:49Z, `Actions` = `major_outage`), which
delayed run creation by ~30 minutes; nothing in the repository was misconfigured and no
remediation was applied. Full audit with all 18 deliverables in
`docs/ops/ops-ci-1-actions-trigger-audit.md` — root cause `GITHUB_INCIDENT`, every other
classification positively excluded. Durable lesson: "CI is green" must mean **a run exists for
that exact SHA and passed**. See `docs/mail/emp-2-completion-report.md`. **EMP-3 has not
begun.**
Previously: (**EMP-1 COMPLETE — nothing to deploy**. The Enterprise Mail
workspace now administers the mailboxes EC-1 created but never exposed — they had been
operator-seeded, so a typo in an address sent real customer mail to quarantine with nobody
able to see why. **No migration (chain stays 86), no new table, no event journal, no
timeline, no attachment system, no outbound, no permission.** Two findings shaped it:
(1) **no `ec_*` table has a write policy**, so activation/deactivation goes through the
admin client behind a `communication:manage` gate STRICTER than the read policy, tenant
re-scoped and audited — chosen over a migration that would have widened the correspondence
write boundary; (2) **the Quarantine view is unreachable BY CONSTRUCTION** —
`ec_inbound_quarantine_shape` forces `tenant_id NULL` — so it states that fact and never
issues the query, because an empty grid would have read as "no mail was rejected". The five
views are filters over the triage queue that ALREADY existed, not a second inbox. Message
detail gains routing/webhook history, the integrity hash and the correspondence events read
through `readDecisionPlane`. The workspace stays DARK: `communication:inbound:read` is still
granted to no role pending RATIFY-EC1-1. See `docs/mail/emp-1-completion-report.md` and the
EMP-0 audit `docs/mail/emp-0-architecture-audit.md`. **EMP-2 has not begun.**
Previously: **UT-5 COMPLETE** — the customer's history is the ledger, not their inbox.
Previously: (**UT-4 COMPLETE — nothing to deploy**. The Unified Operational
Timeline is live on the dossier page: both planes, ordered and grouped by the frozen
chronology rules, with filters, group-safe paging and authorized links out to the owning
workspaces. **No route was created** — a dossier timeline already existed and was ABSORBED,
so one dossier still has exactly one history. The load-bearing decision: chronology is
assigned BEFORE filtering, or a filter would manufacture provability by hiding the entry
that shared an instant. **CI GREEN** run `30953710749`, 79+10 steps, 0 skipped; the rls step
count is unchanged from UT-3B, which is itself evidence UT-4 added no database surface. No
migration, emitter, store or permission. See `docs/tracking/ut-4-completion-report.md`.
**UT-5, Customer Portal 2.0, AI Operations Center and Enterprise Mail have not begun.**
Previously: **MIGRATION 86 DEPLOYED · UT-3B CLOSED**. Ledger **86/86**, no
replay, no mismatch, deployment **PASS** with no sequencing deviation. **No historical
backfill:** `business_event` is unchanged at ~26 rows, the same count verified before the
migration — the seven emitters are live for **new acts only**. Independent verification and
its one stated boundary (trigger objects are not observable without Docker/`psql`; the
confirmatory query is provided) in `docs/releases/deployment-record-86.md`. **One optional
operator action remains:** the ledger honesty marker is not yet recorded, and
`recordLedgerStartMarker()` shipped with no invocation surface because UT-3B forbade UI —
the sanctioned read-then-emit path is in that record §3. **UT-3C has not begun.**
Previously: **UT-3B BUILT — migration 86 NOT YET APPLIED**. The seven
approved Decision Plane emitters, six as database triggers so each event commits in the SAME
transaction as its business act, and one — the ledger honesty marker — at the application
layer because the statement IS the act. **Migration 86 is architectural, not functional:**
six trigger functions and six triggers, no table, permission, RLS policy, index, column,
backfill or scheduler, and **no RPC edited**. `ADMIN_OVERRIDE_EXECUTED` and
`WORKFLOW_REVERSED` stay reserved — their acts do not exist — now pinned as exactly two.
**CI GREEN** run `30935590218`, 79+10 steps, 0 skipped, after three rounds: one genuine
design defect (a quarantine-release trigger that could never fire, because the capture table
is append-only) and two fixture defects. See `docs/tracking/ut-3b-completion-report.md`.
**UT-3C has not begun.** Previously: **UT-2 BUILT — no migration, nothing to deploy**. The merged
two-plane Unified Timeline read model: one dossier, one history, composed from
`business_event` and the ocean/air observation stores, owning no table and copying nothing.
Same-instant cross-plane entries are GROUPED, never given a precedence — a defect that
reintroduced exactly that precedence through an `A:`/`B:` id prefix was caught by its own
test and fixed. Plane-B visibility is dossier-derived in the application because the
observation policies are `transport:read`-based. The clientSafe projection is built and
exposed to nothing. **`public.tracking_event` (road) is documented as a GAP, not silently
absorbed:** it has no `confidence` column, and admitting it would mean fabricating a grade
or adding a migration — raised as UT3-ROAD. See `docs/tracking/ut-2-completion-report.md`.
**CI GREEN** — run `30917288697`, 78+10 steps, **0 skipped, 0 failed**; the rls-tests step count is unchanged from UT-1, which is itself evidence that UT-2 added no database surface. **UT-3 has not begun.** Previously: **MIGRATIONS 83–85 DEPLOYED · EC-3C, EC-3D and UT-1 CLOSED**.
Ledger reconciled at **85/85** via the sanctioned history-only repair, no replay, no
mismatch, deployment **PASS** with **no sequencing deviation** — every one applied after its
own CI suite was green. Independent verification: ledger 85 entries with 0 unapplied / 0
orphan / 0 mismatched · migration 85's two ordering indexes and migration 84's notification
index all **PRESENT** · pre-existing indexes intact · commercial tables still at **0 rows** ·
app serves `19c75b1`. Boundaries stated in `docs/releases/deployment-record-83-85.md`.
**No operator work remains.** Two management blockers stand: **SEATS** (two different people
for QUOTATION_MANAGER / OPS_SUPERVISOR) and **SEATS-CONVERT** (one person holding both
`file:create` and commercial read — until then conversion cannot be performed by anyone).
**UT-2 is not authorised.** Previously: **UT-1 BUILT — migration 85 NOT YET APPLIED**. The Unified
Tracking ordering foundation, per **DEC-B88**. `business_event` gains a monotonic ordinal
assigned by trigger — unspoofable by any caller, immutable through the existing
`prevent_mutation` guard — so events emitted in ONE transaction finally have a truthful
order; they previously shared `occurred_at` (which is transaction start time) with only a
random uuid to separate them. **No history was backfilled and no `occurred_at` rewritten:**
pre-ordinal events keep `ordinal IS NULL` and are GROUPED, never ordered. The SELECT policy
was corrected so prologue visibility follows the SUBJECT — SYSTEM_ADMIN NARROWS and no
permission was minted. **CI GREEN** — run `30912513643`, 78+10 steps, **0 skipped, 0 failed**, the UT-1 suite passing, so the clean 1→85 chain is proven. No UI, no cross-plane merge, no emitters: UT-2 has not begun. See
`docs/tracking/ut-1-completion-report.md`. Previously: **EC-3D BUILT — migration 84 NOT YET
APPLIED**. Customer
acceptance and dossier conversion. Commercial **requests** a dossier and Operations creates
it: conversion calls the existing `createFile()` contract and then records the link through
EC-3B's RPC, writing to **no** dossier table and deliberately not driving
`openDossierWorkflow`, which owns the process instance and the `file_opened` milestone.
EC-3D adds **no commercial schema, no RPC and no permission**; migration 84 only widens the
`client_notification` category CHECK and adds a nullable `quotation_id` so the EXISTING
Customer Notify pipeline can carry a decision. **CI GREEN** — run `30774583748`, 77+10 steps, **0 skipped, 0 failed**, all five EC suites by name (EC-3D passing on its first execution), so the clean 1→84 chain is proven. **New blocker: SEATS-CONVERT** — converting
needs `file:create` AND commercial read, and no ROLE holds both, so a person must hold one
of each; acceptance works meanwhile. See `docs/commercial/ec-3d-completion-report.md`.
Previously: **EC-3C BUILT — migration 83 NOT YET APPLIED**. The Commercial
workspace ships over the EC-3B foundation and implements **DEC-C32**: migration 83 grants the
exact ratified matrix (QUOTATION_MANAGER `create`+`send`+`approve` · OPS_SUPERVISOR
`validate` only · SYSTEM_ADMIN **none**), mirrored in the seed and the role templates, and
widens the three quotation SELECT policies to `create OR validate` — the defect that left a
validating supervisor unable to see what they validate. Reads on the RLS-bypassing admin
client are now explicitly gated. **CI GREEN** — run `30773158495`, 76+10 steps, **0 skipped, 0 failed**, all four EC suites by name (the EC-3C suite passing on its first execution), so the clean 1→83 chain is proven. **Production is unchanged until the operator applies 83**;
once applied, the module becomes reachable for whoever holds the two roles, so **seat
assignment is the remaining gate**. See `docs/commercial/ec-3c-completion-report.md`.
Previously: **EC-3B CLOSED** — migration **82** applied, ledger **82/82**
reconciled, CI green with zero skipped; deployment PASS with **no sequencing deviation**.
The Commercial/Quotation foundation is DEPLOYED DARK: 4 tables at 0 rows, `quotation:validate`
granted to nobody, and the Phase-5.0B blanket grant of `quotation:create/send/approve`
**withdrawn at all three sources** — so no user holds any quotation authority at all. See
`docs/commercial/ec-3b-deployment-record.md`. **RATIFY-EC3-1 ANSWERED** the same day
(**DEC-C32**) — ratified but **not yet applied**; activation is additive migration 83,
planned in `docs/commercial/ec-3c-implementation-brief.md`, **not authorised**.
Previously: **EC-2 CLOSED** — migrations **80–81** applied, ledger
**81/81** reconciled, CI green with zero skipped; deployment PASS with **no sequencing
deviation**. Enterprise Communications inbound capture + triage are DEPLOYED DARK: both
permissions granted to nobody, flag unset, `ec_mailbox` empty. See
`docs/mail/ec-deployment-record.md`. Previously: **HR-6 CLOSED** — migrations 78–79 applied, ledger **79/79**,
CI green with zero skipped; deployment PASS with **DEV-HR6-01** recorded and closed. See
`docs/hr/hr-6-deployment-record.md`. Previously: **R1.0 RELEASED** 2026-08-01 — §3 all
PASS, §4 signed, `release-signoff-R1.0.md` §7).*

> **DEV-HR6-01 (2026-08-02) — sequencing deviation, CLOSED.** Migrations 78–79 were
> applied to production *before* CI was green, against the standing rule; the run at that
> moment was in fact red. **No harm, verifiably:** both CI failures were in test
> assertions, and `git diff --name-only 91bb84c fc04190 -- supabase/migrations/` returns
> **0 files** — the SQL in production is byte-identical to the SQL that went green. The
> real exposure was that migration 79 was applied while its RLS suite had **never executed
> anywhere** (skipped behind an aborting step); that suite has since run and passed.
> **Control reinforced: application waits for a green run AND a per-step check showing
> zero skipped — a green summary can hide a skipped suite.**

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
| **R2.0 — HR** *(active focus)* | **HR-1 → HR-6 DEPLOYED** (**HR-6 CLOSED 2026-08-02**: migrations **78–79**, ledger **79/79**; performance cycles, objectives, competencies, evaluations + training register live-dark; **one** new permission `hr:performance:finalize`, **granted to nobody** pending RATIFY-HR6-1; no scoring formula, no LMS, no procurement — each pinned absent by test; **DEV-HR6-01** early-application deviation recorded and closed. Reports: `docs/hr/hr-6-completion-report.md`, `docs/hr/hr-6-deployment-record.md`). Previously: (HR-5 closed 2026-08-02: migration **77**, ledger **77/77**; leave + attendance live-dark, ON_LEAVE derived, `hr:leave:approve` ungranted pending ratification). Previously: (HR-4 closed 2026-08-02: migration **76**, ledger **76/76**; onboarding cases, checklists, equipment custody + 4 transactional RPCs live-dark; department icons made distinct). Previously: (HR-3 closed 2026-08-02: migration **75**, ledger **75/75** after INC-HR3-01 drift repair; employee file + contracts live-dark; `employee_identifier` withheld per DEC-B63). Previously: (HR-2 closed 2026-08-02: migration **74** applied, ledger **74/74**; assignment engine + timeline ledger + EMPLOYEES staging live-dark; ADR-HR2-01 recorded). Previously: HR-1 — migration **73 applied in production** (operator; ledger repaired → **73/73**); dashboard + org foundation + config center + import staging live-dark; `hr:config:manage`/`hr:sensitive:read` catalog-only, **0 grants verified in prod** (B1 pause intact). Report: `docs/hr/hr-1-completion-report.md` | HR-1 & HR-2 **CLOSED**; HR-3 brief ready (`docs/hr/hr-3-implementation-brief.md`), awaits explicit approval | B1 grant ratification · B2 structure seeds · B3 purge window (blocks batch application only) |
| **R3.0 — Enterprise Communications + Commercial** *(active focus)* | **EC-3C · EC-3D · UT-1 ALL CLOSED 2026-08-09** — migrations **83–85 applied, ledger 85/85**, deployment PASS, no operator work remaining (`docs/releases/deployment-record-83-85.md`). Open blockers are **management only: SEATS · SEATS-CONVERT**. Previously: **EC-3C BUILT 2026-08-07** (`59b2691`): the Commercial workspace — `/commercial` landing + queues, drafting, internal validation, sending with the stored PDF, acceptance evidence, quotation timeline, EC-2 handoff inbox. Migration **83 applied**; the DEC-C32 matrix is mirrored at all three sources and the SELECT policies widened to `create OR validate`. Admin-client reads explicitly gated. Remaining gate = **seat assignment**. Report: `docs/commercial/ec-3c-completion-report.md`. Previously: **EC-3B DEPLOYED DARK + CLOSED 2026-08-06**: migration **82**, ledger **82/82**. Commercial/Quotation foundation — 4 tables, 8 RPCs, integer minor units only, **no pricing and no tax rule**, maker-checker as a structural CHECK, one-live-version as a partial unique index, and ten `commercial` events all emitted from inside their RPC. **Nobody holds any quotation authority**: `quotation:validate` minted ungranted and the Phase-5.0B blanket grant withdrawn at migration + seed + role templates. **RATIFY-EC3-1 answered (DEC-C32)**; EC-3C brief written, implementation **not authorised**. Reports: `docs/commercial/ec-3b-completion-report.md`, `ec-3b-deployment-record.md`, `ec-3c-implementation-brief.md`. Previously: **EC-1 + EC-2 DEPLOYED DARK, EC-2 CLOSED 2026-08-05**: migrations **80–81**, ledger **81/81**. EC-1 = signed-webhook inbound capture (immutable evidence, quarantine for unroutable mail, `communication:inbound:read` minted because `communication:read` already reaches SYSTEM_ADMIN). EC-2 = triage workspace, **four** outcomes (quarantine deliberately NOT one — ratified Q-EC2-1), outcome-immutable, cross-tenant attachment refused twice, and the first phase emitting under the Digital-LOS rule (`CORRESPONDENCE_ATTACHED` carries the DOSSIER). Reports: `docs/mail/ec-{1,2}-completion-report.md`, `ec-deployment-record.md` | **CLOSED** — activation gated | RATIFY-EC1-1/EC2-1 (grants) · Q-EC2-2 (mailbox) · DEC-EC-D2 (provider+DPA) · EDGE-EC1-1 (rate limiting) |
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

**Opened by EC-1/EC-2 (2026-08-05), none blocking any build:**
**RATIFY-EC1-1 / EC2-1** grant `communication:inbound:read` + `communication:triage` to
ACCOUNT_MANAGER + OPS_SUPERVISOR (**until then nobody can open the triage workspace, so
it cannot reach UAT**) · **Q-EC2-2** create `operations@effitrans.com` + its `ec_mailbox`
row · **DEC-EC-D2** inbound provider + DPA (RESEND stays `not_configured`) ·
**EDGE-EC1-1** edge rate limiting before the webhook is publicly reachable.

~~**EC-3 BLOCKER**~~ **RESOLVED 2026-08-06 by EC-3B + DEC-C32.** The blanket grant that
gave `QUOTATION_MANAGER` *and* `OPS_SUPERVISOR` *and* `SYSTEM_ADMIN` all three of
`quotation:create/send/approve` is **withdrawn** — at the migration, the seed **and** the
role templates (only the three together made it real). **RATIFY-EC3-1 is answered**
(**DEC-C32**): QUOTATION_MANAGER = `create`+`send`+`approve` · OPS_SUPERVISOR =
`validate` **only** · SYSTEM_ADMIN = **none**. The two-person model is now enforced by role
membership *and* by `validated_by <> prepared_by`. **The decision is ratified, not
applied:** the grant is additive migration **83** and **remains unauthorised**, so nobody
can quote today. The required audit found one real gap — the RLS SELECT policies gate on
`quotation:create` alone, so a validating supervisor would see nothing; the fix widens them
to `create OR validate`, inventing **no** `quotation:read`
(`docs/commercial/ec-3c-implementation-brief.md` §2).

**Opened by HR-6 (2026-08-02), all management — no operator action:**
**RATIFY-HR6-1** which seat holds `hr:performance:finalize` (**nothing can be finalized
until granted**; note the finalizer≠reviewer constraint means a single-seat HR department
cannot finalize at all) · **HRQ-P1** employee self-service (today self-assessment is
entered by HR *on the employee's behalf*) · **HRQ-P2** manager-scoped write authority
(*would amend DEC-B63*) · **HRQ-P3** aggregate scoring formula (none exists; primitives
only) · **HRQ-P4** the competency framework (catalogue ships empty by design).

## Deployment history

| Release | Date | SHA | Migrations | Sign-off |
|---|---|---|---|---|
| — (pre-framework) | ≤ 2026-07-31 | rolling | 1–72 applied (57–72 outside the ledger; reconciliation = R1.0-R) | Phase 8.0 gate documents |
| R1.0-R (ledger reconciliation) | 2026-07-31 | `1abccda` (no code change; app already served it) | ledger repaired to **72/72** — `migration repair --status applied` × 16 (`20260724000002` → `20260729000002`); no DDL; schema spot-checks unchanged | verification 30/30 (operator) · repair GO (operator) |
| **R1.0** (reconciliation + validation) | 2026-07-31 → **2026-08-01 RELEASED** | `c29b7cf` at completion (post-sanitation head) | none — validation only. Side products shipped during UAT: invoice-renderer geometry fix `733c116` (`uat2b-2`, immutable artifacts untouched) + history sanitation (5 SHAs remapped) | A1–A3, B1–B4 **all PASS** (B2 with stated limitation) · **§4 signed 2026-08-01** (Bara Seck, all seats; provenance note in the sign-off) |
| **HR-1** (Dashboard & Organization Foundation) | 2026-08-01 **DEPLOYED** | `43bf42e` (migration) / `c47f95b` (repo at deploy) | **73** applied in production by the operator after the `scope`→`data_scope` correction; ledger repaired → **73/73**; prod verification: 2 permission rows · **0 grants** (B1 pause) · all tables present | operator deployment PASS · CI 67/67 RLS steps ×2 · business gates open (B1/B2/B3) |
| **EC-1 + EC-2** (Enterprise Communications: inbound capture + triage) | 2026-08-05 **CLOSED** | `aa50fd9` (EC-1) / `91ad948` (EC-2, CI green; **no migration file differs** from `fc88633`) | **80–81** applied; ledger **81/81**. Independent verification: ledger zero-mismatched · **6/6 EC tables** · **11/11 EC indexes** (9 from 80, 2 from 81) | deployment **PASS** · CI run `30758769202` **green, 74+10 steps, 0 skipped, 0 failed**, both EC suites executed by name · **no sequencing deviation** (applied after green, unlike DEV-HR6-01) · open: grants + mailbox + provider/DPA + rate limiting (**management/ops, not operator**) |
| **UT-4** (Unified Operational Timeline UI) | 2026-08-12 **COMPLETE — nothing to deploy** | `849af88` | **none** — no migration, schema, permission, flag or route (pinned) | gates: 205 files / 5138 tests green, tsc 0, build clean · CI `30953710749` 79+10 steps, 0 skipped · UI queries no module table · `audit_log` excluded · clientSafe projection still unwired (UT-5) |
| **UT-3B** (Decision Plane emitters) | 2026-08-11 **CLOSED** | `fe6a9ff` | **86** `20260810000001_decision_plane_emitters.sql` — **APPLIED** 2026-08-11, ledger 86/86. Six trigger functions + six triggers; no RPC edited, no table, permission or policy | gates: 204 files / 5077 tests green, tsc 0 · CI `30935590218` 79+10 steps, 0 skipped · emitters proven in real PostgreSQL incl. **nothing survives ROLLBACK** · no backfill: events appear for NEW acts only |
| **UT-2** (Unified Tracking: merged two-plane read model) | 2026-08-10 **BUILT — nothing to deploy** | `031d9db` | **none** — UT-2 adds no migration, no schema, no permission and no flag (pinned by test) | gates: 204 files / 5064 tests green, tsc 0, build clean · no UI, no emitter, no store · `audit_log` excluded · new blocker **UT3-ROAD** (road store has no `confidence`) |
| **UT-1** (Unified Tracking: ordering foundation) | 2026-08-09 **CLOSED** | `a201baf` | **85** `20260809000001_decision_plane_ordinal.sql` — **APPLIED** 2026-08-09. Adds a nullable ordinal + sequence + BEFORE INSERT trigger, and corrects the `business_event` SELECT policy to subject-based visibility. No table, no RPC, no permission | gates: 203 files / 5024 tests green, tsc 0 · **nothing backfilled**, no `occurred_at` rewritten · SYSTEM_ADMIN narrowed, never broadened · `audit_log` never a timeline source (pinned) |
| **EC-3D** (Customer acceptance & dossier conversion) | 2026-08-09 **CLOSED** | `6f01a67` | **84** `20260808000001_commercial_conversion.sql` — **APPLIED** 2026-08-09. Adds no commercial schema and no RPC; widens the `client_notification` category CHECK to admit `commercial` and adds a nullable `quotation_id` | gates: 202 files / 4981 tests green, tsc 0, build clean · conversion invokes the Operations `createFile` contract and writes no dossier table (test-pinned) · cross-tenant conversion refused by QT617 · **SEATS-CONVERT** blocker recorded |
| **EC-3C** (Commercial / Quotation workspace) | 2026-08-09 **CLOSED** | `59b2691` | **83** `20260807000001_commercial_activation.sql` — **APPLIED** 2026-08-09; ledger 85/85. Grants the DEC-C32 matrix at all three sources and widens the three quotation SELECT policies to `create OR validate` | gates: 201 files / 4950 tests green, tsc 0, build clean · **no permission invented** (`quotation:read` explicitly refused) · SYSTEM_ADMIN named only inside a `delete` · remaining gate is **seat assignment**, not engineering |
| **EC-3B** (Commercial / Quotation foundation) | 2026-08-06 **CLOSED** | `7733304` (foundation) → `f9058f1` → `b735bb7` (CI green; **no migration file differs** from `7733304`) | **82** applied; ledger **82/82**, no repair, no replay. Independent verification: ledger 82 entries, **0** local-only / **0** orphan / **0** mismatched · **4/4 tables PRESENT at 0 rows** (control group + negative control first) · **`uq_quotation_one_live_version` + 4 PKs** present · `/api/version` = `b735bb7`. **Boundary stated:** grant count = 0 accepted from the operator — no Docker/`psql`/service key here to run arbitrary SQL | deployment **PASS** · CI run `30769464325` **green, 75+10 steps, 0 skipped, 0 failed**, EC-1/EC-2/EC-3B suites all executed **by name** · **no sequencing deviation** · **RATIFY-EC3-1 answered same day (DEC-C32)**, activation migration 83 **unauthorised** |
| **HR-6** (Performance & Training) | 2026-08-02 **CLOSED** | `91bb84c` (migrations) → `fc04190` (CI green; **no migration file differs**) | **78–79** applied by the operator **ahead of CI** (DEV-HR6-01); ledger repaired → **79/79**. Independent verification: ledger 79/79 zero-mismatched · **9/9 tables** (control group first) · **13/13 indexes** incl. the last of migration 79 | deployment **PASS** · CI run `30751865999` **green, 72+10 steps, 0 skipped, 0 failed**, both HR-6 suites executed by name · DEV-HR6-01 **closed** · open: RATIFY-HR6-1 + HRQ-P1..P4 (**management, not operator**) |
