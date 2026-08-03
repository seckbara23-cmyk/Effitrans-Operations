# EC-3D — Customer Acceptance & Dossier Conversion: Completion Report

**Date:** 2026-08-08 · **Migration:** 84 `20260808000001_commercial_conversion.sql`
**Commit:** `6f01a67` · **New permissions: none** · **New RPCs: none**
**Predecessors:** EC-3A/3B/3C **closed and not reopened**

---

## 1. Repository audit (returned before any code was written)

| Subsystem | Found | Verdict |
|---|---|---|
| **Operations dossier creation** | **`createFile()`** (`file:create` → validates, mints via `next_file_number`, audits) then **`openDossierWorkflow()`** (`process:manage` → process instance, owner, DRAFT→OPENED, publishes `file_opened`) | **reusable contract EXISTS — invoked, never copied** |
| Commercial service | EC-3C gated reads | extended |
| Dossier state machine | `lib/files/status.ts` | read-only from Commercial |
| Business-event registry | all four required types already registered, `emission: rpc` | **EC-3D registers none** |
| Timeline rendering | `readQuotationTimeline` / `readDossierTimeline` | reused |
| Customer Notify | `notifyCustomer`, 8 events, recipient resolved **only** via file/invoice | extended (§7) |
| Communications Hub | `lib/comms/provider` + `queueAndSend` | reused |
| Document engine | `public.document` (`file_id NOT NULL`) | untouched |
| PDF artifact engine | render-once + SHA-256 + renderer version | untouched, never re-rendered |
| Approval / maker-checker | `quotation_validator_differs` + QT606 | preserved |
| Audit helpers | `writeAudit` | reused |
| Workflow engine | process engine, `intakeGuard` | never driven from Commercial |
| Notification pipeline | `createNotification` (staff) | untouched |
| Evidence framework | EC-3B acceptance columns + CHECK | **already existed — no new model** |

**Nothing in that list was duplicated.**

### 1.1 The blocker the audit surfaced

Converting requires **`file:create`** (Operations) **and** commercial read (`quotation:create`
OR `quotation:validate`, per DEC-C32). The live matrix:

| Role | `file:create` | `quotation:approve` | `quotation:validate` |
|---|---|---|---|
| SYSTEM_ADMIN | ✅ | ❌ *(ratified: never)* | ❌ |
| ACCOUNT_MANAGER | ✅ | ❌ | ❌ |
| QUOTATION_MANAGER | ❌ | ✅ | ❌ |
| OPS_SUPERVISOR | ❌ | ❌ | ✅ |

**No role holds both.** This was *not* the "no reusable contract" STOP condition — the
contract exists — so nothing was invented. Permissions **union across roles**, so a person
holding a commercial role *and* an Operations role can convert with **no new permission and
no new grant**. That is a seat decision, recorded in §16, and deliberately preferred over
granting Commercial `file:create` (which would make Commercial own Operations) or widening
DEC-C32's read model.

## 2. Architecture reused

`createFile` · `quotation_record_conversion` · `notifyCustomer` + `queueAndSend` ·
`writeAudit` · `readQuotationTimeline` · `lib/operations/kpi/windows` (tenant-day source) ·
`t.files` vocabulary · the EC-3B evidence model. **No engine was rebuilt.**

## 3. Migration 84 — the minimum, and only for notifications

EC-3B already ships the acceptance columns, the evidence CHECK, decline/cancel, and the
conversion RPC. **EC-3D adds no commercial schema, no column on `quotation`, and no RPC**
(pinned by test). Migration 84 touches only `client_notification`:

1. **Widened the `category` CHECK** to admit `commercial` (drop-and-recreate, the WES-5
   precedent; every existing value survives). A quotation acknowledgement is not a shipment
   update, and mislabelling it would have been the cheaper, wronger option.
2. **Added a nullable `quotation_id`** (`ON DELETE SET NULL`, like its file/invoice
   siblings). At acceptance there is neither dossier nor invoice — that is the *point* of
   the phase — so without it the row would reference nothing.

## 4. Operations integration

```
Commercial                         Operations
   │ convertQuotationToDossier()
   ├── assertPermission("file:create")  ← Operations authority
   ├── assertCommercialRead(tenant)     ← DEC-C32 read + tenant ownership
   ├──────────────────────────────────► createFile()   [the contract]
   │                                      mints number, validates, audits
   ├── quotation_record_conversion()   ← records the link, emits the keystone
   └── stop.                             openDossierWorkflow() is THEIRS
```

**Commercial writes to no dossier table** — pinned by test across the module: no
`operational_file`, no `file_shipment`, no `insert/update/delete`, no `next_file_number`.

**`openDossierWorkflow` is deliberately NOT called.** It owns the process instance, the
owner assignment and the `file_opened` customer milestone. Calling it from Commercial would
be Commercial modifying the Operations workflow *and* would duplicate a notification
Operations already sends. The dossier is created in DRAFT and appears in Operations' own
intake queue.

**If the link fails after the dossier exists**, the dossier is **not** deleted: Commercial
does not get to un-create an Operations row. The failure is audited and the UI says the
dossier exists and must not be recreated.

## 5. Acceptance workflow

`SENT → ACCEPTED | DECLINED | CANCELLED`. **No automatic expiry, no scheduler, no timer, no
background job** — a quotation leaves SENT only by a recorded human act (pinned since EC-3B).

## 6. Evidence model

Signed quotation · email acceptance · written agreement. **Evidence is mandatory** — the
database CHECK refuses an acceptance without kind + date, proven in the RLS suite by a
direct call that omits them. **Acceptance is never inferred**; an inbound message may be
*referenced* as supporting evidence (`acceptance_message_id`) and nothing derives a decision
from mail arriving.

## 7. Versioning review

Only the **latest live version** may be accepted. A partial unique index allows exactly one
live version per request, and revision supersedes the previous one — so "accept the old
version" fails as a database fact, not a rule to remember. The RLS suite accepts v2 and
proves v1 is refused **and** that its lines remain frozen (QT612).

## 8. Conversion review

Refused unless ACCEPTED (**QT616**). A **cross-tenant** dossier is refused (**QT617**) —
the security check that matters most, because the RPC is SECURITY DEFINER and RLS does not
apply inside it. The suite asserts `files_created_by_rpc = 0`: recording a conversion
creates no dossier row.

## 9. Timeline review

One timeline answers the whole story: preparation, validation, sending, the customer
decision with its evidence, the conversion, and the handover. Selected by
`metadata.quotation_id`, which every commercial event carries — so
`QUOTATION_CONVERTED_TO_DOSSIER` appears on **both** the quotation and the dossier timeline,
the one event that belongs to both. Once converted, the detail page states plainly that
Operations owns the dossier and links to it.

## 10. Notifications review

Two events, two templates, **one** new resolver branch — the existing pipeline, extended.
The templates name a **quotation**, never a dossier that does not exist yet. A customer who
muted shipment mail is not emailed a commercial decision (`commercial` maps to the shipment
preference; **no new preference column was invented**). Best-effort by that pipeline's
contract: it never throws and cannot fail a recorded business decision.

## 11. Security review

Tenant isolation (policy, application gate, and the RPC's own tenant check) · cross-tenant
conversion refused · evidence immutable (EC-3B) · only latest version acceptable ·
maker-checker preserved · agent cannot validate · supervisor cannot prepare · **SYSTEM_ADMIN
holds no quotation authority** · **Commercial creates no Operations row directly** · the
Operations RPC validates tenant ownership.

## 12. Digital-LOS rule

**What operational event does this emit?** `QUOTATION_ACCEPTED`, `QUOTATION_DECLINED`,
`QUOTATION_CANCELLED` and — the keystone — `QUOTATION_CONVERTED_TO_DOSSIER`, carrying the
**dossier** as `subject_id` *and* `dossier_id`, so a shipment's timeline opens with its
commercial provenance and Tracking never queries a Commercial table to learn it. **All four
already existed and are emitted from inside their RPCs**; EC-3D registers none and adds no
emission site. Payloads carry **identifiers only** — no customer message body, pinned.

## 13. Files changed

**New:** migration 84 · `lib/commercial/convert.ts` · `lib/commercial/metrics.ts` ·
`lib/commercial/errors.ts` · `components/commercial/conversion-panel.tsx` ·
`supabase/tests/rls_commercial_conversion_test.sql` · `tests/ec-3d-conversion.test.ts`.
**Modified:** `lib/commercial/{actions,queues,service}.ts` · `lib/customer-notify/{events,service}.ts` ·
`lib/comms/templates.ts` · `lib/db/types.ts` · `lib/platform/ops/build-info.ts` ·
`app/commercial/page.tsx` · `app/commercial/quotations/[id]/page.tsx` · `ci.yml` · 4 test files.

## 14. Tests and CI

**Local: 202 files / 4981 tests green · tsc 0 · build clean.**

**CI: GREEN — run `30774583748` (`6f01a67`), `rls-tests` 77 steps / 0 skipped / 0 failed,
`build` 10 / 0 / 0.** All five EC suites executed **by name**: EC-1 · EC-2 · EC-3B · EC-3C ·
**EC-3D commercial conversion — success on its first execution**. The clean **1 → 84**
migration chain is proven, so migration 84 has never been applied anywhere while its suite
was unproven (the DEV-HR6-01 exposure).
31 EC-3D contracts + an RLS suite of 11 checks in real PostgreSQL. `mapRpc` was **extracted**
to `lib/commercial/errors.ts` so conversion maps the same SQLSTATEs rather than keeping a
second copy.

**Nine drift assertions repaired, not suppressed** — two more phase suites hardcoded the
newest migration and now assert their **own** position; the customer-notify test became an
exact **set** so a new event must be named deliberately instead of a count being nudged.

## 15. Deployment guide

1. **Wait for CI green** — per job, per step, **zero skipped**; the `EC-3D commercial
   conversion` suite must appear and pass.
2. Apply migration 84 normally. **Never** `db push`, no ledger INSERT, no replay.
3. Verify:
   ```sql
   select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'client_notification_category_check';   -- must contain 'commercial'
   select count(*) from information_schema.columns
    where table_name='client_notification' and column_name='quotation_id';  -- 1
   -- EC-3D adds NO commercial schema:
   select count(*) from pg_proc where proname like 'quotation\_%';          -- unchanged (8)
   ```
4. Ledger reads **84/84** — repair if it lags, never replay.

## 16. Remaining activation dependencies

| Ref | Decision | Owner |
|---|---|---|
| **SEATS-CONVERT** | at least one person must hold **both** a commercial role and an Operations role with `file:create`; until then acceptance works and **conversion cannot be performed by anyone**. The UI says so rather than showing a dead button | management |
| **SEATS** (EC-3C) | QUOTATION_MANAGER + OPS_SUPERVISOR held by **different** people | management |
| **DEC-EC-D2** | outbound provider/DPA — decision emails stay queued-not-sent until configured | management |
| MD-Q10 / Q11 / Q13 | tax rates · numbering · quoting a non-client prospect | management |

## 17. Readiness for Unified Tracking

**Ready, and not begun.** The keystone event already lands on the dossier with
`dossier_id` set, so Tracking can read a shipment's commercial origin from the ledger alone
— no Commercial table, no join, no sync. `converted_file_id` closes the loop the other way
for Commercial's read-only status display.

---

## Confirmations

* **EC-3D is complete** as specified; nothing in scope was deferred.
* **No second engine** was built: document, notification, dossier, workflow, communications,
  PDF and timeline are all the existing ones.
* **Commercial never created an Operations row** — `createFile` did, and the module is
  test-pinned to touch no dossier table.
* **No dossier was created outside Operations.**
* **No expiry, scheduler, timer or background job** was introduced.
* **SYSTEM_ADMIN receives no quotation authority.**
* **Unified Tracking, Customer Portal 2.0, Enterprise Mail Platform and AI Operations
  Center have NOT been started.**
