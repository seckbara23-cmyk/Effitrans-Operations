# EC-2 — Triage Workspace: Completion Report

**Date:** 2026-08-05 · **Migration:** 81 `20260805000001_ec_triage_outcomes.sql`
**New permissions: 0** · **New grants: 0** · **Production: DEPLOYED DARK — ledger 81/81**
**Status: CLOSED 2026-08-05.** Deployment PASS: [ec-deployment-record.md](ec-deployment-record.md).
Governance: [ec-2-governance-freeze.md](ec-2-governance-freeze.md) (approved `ed39925`).

---

## 1. Repository audit

| Needed | Found | Used as |
|---|---|---|
| Immutable capture + triage item | EC-1 (migration 80) — `ec_triage_item` shipped **deliberately without outcome columns** | extended additively; no new table |
| Timeline spine | `business_event` + `emit_business_event` (WES-9/WES-9A hardened, EF001 fail-closed) | the Digital-LOS emission path |
| Event vocabulary | **closed registry** `lib/workflow/events/types.ts` + metadata allow/deny-lists (WES-9C) | 7 types registered |
| Domain widening | WES-5 precedent (`20260727000005` §3): drop CHECK, re-add widened | `communication` added the same way |
| Dossier read gate | `isFileVisible` / `resolveFileScope` (`lib/authz/visibility.ts`) | attach authorization |
| Supervisory role signal | `getUserRoleCodes` | reassignment gate |
| Private storage | `ec-inbound` bucket + short-TTL signed URLs (EC-1) | attachment access |
| Audit | `writeAudit` | every act |

**Decisive audit finding:** the platform renders **no external HTML anywhere** —
`dangerouslySetInnerHTML` appears only for platform-generated SVG (Brand Center). EC-2
keeps that record intact (§8).

## 2. Architecture reused

No new table, no new permission, no new engine, no scheduler, no dependency. EC-2 is one
additive migration, one pure model, one read service, one action module, two routes and
one client component.

## 3. Triage workflow

`NEW → ASSIGNED → IN_REVIEW → RESOLVED`, with `RESOLVED` requiring a recorded outcome.
**EC-1's `ec_triage_transition_guard` is not redefined** — a *second* trigger,
`ec_triage_outcome_guard`, owns outcome coherence. One guard per concern; trigger order
is alphabetical, so status legality is validated before outcome coherence.

## 4. Role and permission implementation

`communication:inbound:read` gates every read; `communication:triage` gates every act.
**Both remain granted to nobody**, so the workspace 404s for everyone today — the
intended dark state.

**Reassignment separates by ROLE (`OPS_SUPERVISOR`), not by a permission.** The obvious
candidate, `communication:manage`, is deliberately unused: **SYSTEM_ADMIN holds it**, and
reusing it would have handed a platform administrator authority over tenant
correspondence through the back door. Pinned by test.

## 5. Outcome model

Four outcomes — `ATTACH_TO_DOSSIER` · `HANDOFF_TO_QUOTATION` ·
`GENERAL_CORRESPONDENCE` · `DISCARD`. **Quarantine is not among them** (ratified
Q-EC2-1): it stays EC-1's capture-time verdict for unroutable mail, `tenant_id = NULL`,
invisible to every tenant, and a quarantined item is refused triage (`EC613`).
**No second quarantine concept exists** — pinned by test across schema, model, service,
actions and UI.

Attach requires a dossier; discard requires a **mandatory reason code** (+ optional
comment, actor, timestamp, audit and immutable event); the other two carry neither.
Enforced **three times independently**: the pure `validateOutcome` (so the user sees the
problem first), CHECK constraints, and the RPC. A recorded outcome is **immutable**
(`EC610`) — a correction is a new decision on a new message.

The discard vocabulary (SPAM · DUPLICATE · NOT_BUSINESS_RELATED · WRONG_RECIPIENT ·
UNSOLICITED · OTHER) is **tenant configuration in code**, not a schema enum: the database
enforces that a reason is *present*, never which one. Adding a code needs no migration —
and a test pins that none of the six is frozen into the schema.

## 6. Dossier-attachment transaction

One RPC, one transaction: validate tenant ownership of the dossier → set status +
outcome + attribution → **emit `CORRESPONDENCE_ATTACHED` with the dossier as
`subject_id` AND `dossier_id`** → the action writes the security audit. The immutable
inbound message is never touched.

**Authorization is layered:** the action requires the dossier to be *visible to this
user* (`isFileVisible`), and the RPC independently re-checks tenant ownership — so
cross-tenant attachment is refused twice, and proven refused in the RLS suite.

## 7. Digital-LOS event review

The first phase built under the standing question. Domain `communication` added to the
registry **and** to the SQL CHECK (WES-5 precedent). Seven types registered, all
`clientSafe: false`:

| Type | Emission | Subject |
|---|---|---|
| `CORRESPONDENCE_RECEIVED` | **reserved** | — |
| `CORRESPONDENCE_ASSIGNED` / `_REASSIGNED` | rpc | triage item |
| **`CORRESPONDENCE_ATTACHED`** | rpc | **the DOSSIER** |
| `CORRESPONDENCE_QUOTATION_HANDOFF` | rpc | triage item |
| `CORRESPONDENCE_RESOLVED` | rpc | triage item (+ dossier when attached) |
| `CORRESPONDENCE_DISCARDED` | rpc | triage item |

`CORRESPONDENCE_RECEIVED` is **reserved on principle**: EC-1's capture is a multi-step
application pipeline, not one transaction, so nothing may claim the rpc guarantee for it.
The registry's own doctrine covers this exact case — declaring the name now means a later
phase adds *emission*, not a second vocabulary.

**Tracking never queries EC tables.** The dossier timeline learns of correspondence
solely through the emitted event; `components/files/event-timeline.tsx` gained the domain
(typecheck *forced* that acknowledgment — the coupling works).

Payloads carry identifiers and codes only. The discard **comment never travels**; only
its `reason_code` does — the WES-4 rejection-reason discipline. `registryMetadataViolations()`
still returns empty with the new types.

## 8. Security and RLS review

RLS unchanged and sufficient: `ec_triage_item`'s policy (migration 80) already gates on
tenant + `communication:inbound:read`, grants SELECT only, and has no portal policy. New
columns inherit it; **no policy was edited**.

**Safe rendering by removal, not by sanitizer.** The captured HTML body is never fetched
and never rendered — only the plain-text body, inside a React text node, escaped by the
framework. That single decision removes XSS, remote images and tracking pixels, and
leaves no sanitizer to keep current. The HTML remains in private storage as evidence,
reachable only as a download. **No `dangerouslySetInnerHTML` in any EC-2 file.**

Attachments: short-TTL (60 s) signed URLs, server-minted, only for `stored` parts; never
a public URL, never direct client storage access. Audit payloads carry no subject,
sender, body, filename or comment.

## 9. Files created and modified

**Created:** migration 81 · `lib/ec/triage/{model,service,actions}.ts` ·
`app/communications/triage/page.tsx` · `app/communications/triage/[id]/page.tsx` ·
`components/ec/triage-studio.tsx` · `supabase/tests/rls_ec_triage_test.sql` ·
`tests/ec-2-triage.test.ts` · this report.
**Modified:** `lib/workflow/events/types.ts` (+domain, +7 types) ·
`components/files/event-timeline.tsx` (+domain tone) · `lib/db/types.ts` ·
`.github/workflows/ci.yml` (+1 suite) · `tests/business-events.test.ts` (guard extended
to read migration 81) · 7 drift pins · EC-1's chain pin made relative.

## 10. Tests and CI results

**Local: 199 files / 4861 tests green · tsc 0 errors · build clean**, both routes
present. `tests/ec-2-triage.test.ts` — 43 contracts. `rls_ec_triage_test.sql` — 20 checks
including quarantine-untriable, resolve-requires-outcome, attach-requires-dossier,
discard-requires-reason, outcome-immutable, **cross-tenant attachment refused**,
`CORRESPONDENCE_ATTACHED` carrying the dossier, **no quotation table created**, and the
discard comment proven absent from the event payload.

**CI: GREEN — run `30758769202`, commit `91ad948`.** `build` success (10 steps, 0
skipped, 0 failed); `rls-tests` success (**74 steps, 0 skipped, 0 failed**), with
`Run EC-1 inbound email isolation test` and `Run EC-2 triage outcomes isolation test`
both passing **by name**.

One red run preceded it (`fc88633`) and the failure was a **cross-suite fixture
regression, not a schema defect**: migration 81's outcome guard applies to every writer
of `ec_triage_item`, so a bare `set status = 'RESOLVED'` in **EC-1's** suite was rejected
(`EC611`), aborting it and skipping EC-2's suite behind it. Fixed by recording an outcome
in EC-1's fixture rather than relaxing the rule, plus a static cross-suite guard so the
class cannot recur. **Migration 81 never changed** — `git diff --name-only fc88633
91ad948 -- supabase/migrations/` returns 0 files.

## 11. Migration / operator procedure *(historical — executed 2026-08-05; retained as the record)*

**Outcome: PASS.** Migrations 80 and 81 applied and **reconciled at 81/81**. Independent
verification: ledger 81/81 zero-mismatched · **6/6 EC tables** · **11/11 EC indexes**
(9 from migration 80, 2 from migration 81). Full evidence and the residual-checks note in
[ec-deployment-record.md](ec-deployment-record.md).

**No operator work remains for EC-1 or EC-2** — no migration, repair, replay, grant or
configuration. What remains is management ratification (§12).

1. **Wait for CI green** — per job, per step, **zero skipped**. The `EC-2 triage` suite
   must appear and pass. A green summary is not evidence (DEV-HR6-01).
2. Confirm `cat supabase/.temp/project-ref` = production `xtpppzhkiagdpmnghdlc`.
3. Apply migration 81 through the normal path. **Never** `db push`, never a manual ledger
   INSERT, never a replay.
4. **Verify objects:**
   ```sql
   select count(*) from information_schema.columns where table_schema='public'
     and table_name='ec_triage_item'
     and column_name in ('outcome','outcome_file_id','discard_reason_code',
       'outcome_comment','outcome_recorded_by','outcome_recorded_at');       -- expect 6
   select count(*) from pg_proc where proname in
     ('ec_assign_triage','ec_review_triage','ec_resolve_triage',
      'ec_triage_outcome_guard');                                            -- expect 4
   select conname from pg_constraint where conname='business_event_event_domain_check';
   -- and confirm 'communication' is in its definition:
   select pg_get_constraintdef(oid) from pg_constraint
     where conname='business_event_event_domain_check';
   select count(*) from public.role_permission rp join public.permission p
     on p.id=rp.permission_id
     where p.code in ('communication:inbound:read','communication:triage'); -- expect 0
   ```
5. Confirm the ledger reads **81/81**; reconcile with `migration repair --status applied
   20260805000001` if it lags — **repair, never replay**.
6. **Grant nothing.** The workspace stays invisible until RATIFY-EC1-1/EC2-1.

## 12. Activation dependencies

| Ref | Needed for | Owner |
|---|---|---|
| **Q-EC2-3 / RATIFY-EC1-1 + EC2-1** | grant both permissions to ACCOUNT_MANAGER + OPS_SUPERVISOR — **without this nobody can open the workspace, so it cannot reach UAT** | management |
| **Q-EC2-2** | create `operations@effitrans.com` and insert its `ec_mailbox` row | operator |
| **DEC-EC-D2** | inbound provider + DPA — RESEND stays `not_configured` | management |
| **EDGE-EC1-1** | edge rate limiting before the endpoint is public | platform/ops |
| Flags | `EFFITRANS_EC_INBOUND_ENABLED` + tenant rollout row | operator |

## 13. Readiness for EC-3

EC-3 inherits a governed handoff: `HANDOFF_TO_QUOTATION` records **intent only**, and
`CORRESPONDENCE_QUOTATION_HANDOFF` is the seam it consumes as provenance. **No quotation
entity was invented** — there is not even a `quotation_id` column, so EC-3's shape is
completely unprejudged.

**EC-3 BLOCKER, recorded and unresolved here as instructed:** `QUOTATION_MANAGER` and
`OPS_SUPERVISOR` each hold `quotation:create`, `quotation:send` **and**
`quotation:approve`. The ratified model is two-person — Operations prepares, the
Operations Manager/Supervisor approves, and the same actor must not do both. **Before
EC-3 activation the platform must enforce that separation.** EC-2 changed no quotation
permission and no quotation workflow.

---

## Confirmations

* **EC-2 is complete** as scoped. All 15 scope items are implemented; nothing was
  deferred silently. What remains is activation, not construction.
* **Quarantine semantics were not changed.** EC-1's guard is not redefined, quarantine
  stays capture-time and unroutable-only, a quarantined item is refused triage, and no
  second quarantine concept exists anywhere — each pinned by test.
* **No quotation was created.** No quotation entity, table, column or write exists;
  the handoff stores intent. Pinned by test *and* by the RLS suite (`quotation_tables_created = 0`).
* **No dossier was created automatically.** No outcome creates a dossier, client,
  document, task or invoice; attachment links to a dossier that already exists, and
  attachment promotion into `public.document` remains a separate human act.
* **Production is DEPLOYED and DARK:** migrations 80–81 applied (ledger 81/81), both
  permissions granted to nobody, inbound flag unset, tenant rollout table empty,
  `ec_mailbox` empty, `/communications/triage` 404s for every user. Applying these
  migrations changed nothing observable — the intent.
* **No sequencing deviation:** unlike DEV-HR6-01, application followed a green run with a
  per-step zero-skipped check.
* **EC-2 is CLOSED (2026-08-05). EC-3 has not begun.**
