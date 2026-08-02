# EC-3B — Commercial / Quotation Foundation: Completion Report

**Date:** 2026-08-06 · **Migration:** 82 `20260806000001_commercial_quotation.sql`
**New permissions:** 1 (`quotation:validate`), **granted to nobody**
**Grants REVOKED:** the Phase-5.0D blanket grant of `quotation:create/send/approve`
**Production: DARK** · Frozen by [ec-3a-governance-freeze.md](ec-3a-governance-freeze.md)

> **STATUS: CLOSED 2026-08-06.** Deployed to production, **ledger 82/82**, CI green with
> **zero skipped**, deployment **PASS** with **no sequencing deviation**. Independent
> verification and its one stated boundary: [ec-3b-deployment-record.md](ec-3b-deployment-record.md).
> **No operator work remains.**
>
> **RATIFY-EC3-1 is ANSWERED** (2026-08-06, **DEC-C32**): QUOTATION_MANAGER holds
> `quotation:create` + `:send` + `:approve`; OPS_SUPERVISOR holds `quotation:validate`
> **only**; SYSTEM_ADMIN receives **none**. The decision is ratified but **not yet
> applied** — activation is additive migration 83, planned in
> [ec-3c-implementation-brief.md](ec-3c-implementation-brief.md) and **not authorised to
> begin**. Until that migration is applied and authorised, the gate still binds: nobody
> can quote.

---

## 1. Repository reuse audit (performed before any code)

Full audit: [ec-3a-finance-reuse-audit.md](ec-3a-finance-reuse-audit.md). Verdicts applied:

| Asset | Verdict | What EC-3B did |
|---|---|---|
| `billing_charge` | reuse as **conversion target** | untouched; accepted lines project into it at EC-3D |
| `invoice_line` | reuse the **shape**, not the table | `quotation_line` mirrors its four business fields |
| `invoice` | **do not touch** | untouched; a quotation is not a draft invoice |
| `client` | reuse unchanged | referenced; no commercial customer entity created |
| Tax | **build nothing** | a `tax_rate_bp` field defaulting to **0**; no rate encoded |
| Currency | reuse the column convention | `text` + `XOF` default; no currency table |
| Pricing | **build nothing** | no tariff, price list or rate card |
| Templates | reuse the pattern, not the table | no template table; the renderer generates |
| PDF | **reuse wholesale** | `lib/reports/pdf` `PdfDoc`; no second engine |
| Numbering | reuse the pattern | sixth counter instance; **no `EFT-` prefix repeated** |

**A finding that shaped the design:** `finalize_generated_artifact` takes `p_file_id`,
and `document.file_id` is `NOT NULL` — but **a quotation has no dossier**. So the
artifact *discipline* (render once, hash, store privately, record renderer version) is
applied on the quotation row, and *registration* into the governed registry waits for
conversion. This is EC-1's evidence-in-waiting shape, reused.

## 2. Migration 82

Four tables (`quotation_request`, `quotation`, `quotation_line`, `quotation_counter`),
eight RPCs, one new permission, the `commercial` event domain, RLS on all three data
tables. Additive, idempotent, forward-only; **migrations 1–81 untouched**.

**The permission correction, executed:** `quotation:validate` added (act 2 had *no*
permission — the EC-3A finding); the blanket grant **revoked** from SYSTEM_ADMIN,
OPS_SUPERVISOR and QUOTATION_MANAGER; `quotation:approve`'s misleading description
corrected without renaming the code (the process registry references it). Safe because
no quotation module ever existed — the grant governed nothing.

**The revocation needed three edits, not one — and CI proved it.** The migration's
`DELETE` only removes rows that already exist. Two other sources re-created them:
`supabase/seed.sql`, which runs **after** migrations under `supabase db reset`, and
`lib/platform/role-templates.ts`, which provisions **every new tenant**. So the migration
alone was cosmetic: SYSTEM_ADMIN kept `quotation:create`, and because `quotation_select`
gates on exactly that permission, **SYSTEM_ADMIN could read quotations** — the one thing
the freeze forbids. The RLS suite reported `legacy=9` (3 roles × 3 permissions) and
`admin=1` from a single cause. Both sources were corrected and a contract now asserts the
revocation **at every source**, because the pre-existing text-only assertion on the
migration was green throughout.

## 3. Maker-checker — structural

`constraint quotation_validator_differs check (validated_by <> prepared_by)` **plus**
`QT606` in the RPC. Neither is the only line of defence, and **no role membership can
bypass either**. The RLS suite proves both paths independently.

## 4. Lifecycle, versioning, immutability

`DRAFT → PENDING_VALIDATION → VALIDATED → SENT → ACCEPTED → CONVERTED`, with `DECLINED`,
`SUPERSEDED` and `CANCELLED` as governed exits. **No expiry state and no expiry date** —
a quotation leaves SENT only by an *act*, per the ratified "no automatic expiration", and
**no scheduler was introduced**.

Revision creates a **new version row**; the previous survives as `SUPERSEDED` and stays
permanently visible; lines are copied forward. A **partial unique index** allows exactly
**one live version per request**, so "only the latest active version may be accepted" is
a database fact rather than a rule to remember. A sent quotation and its lines are frozen
by triggers (`QT610`, `QT612`).

## 5. Acceptance — evidence, never inferred

Three ratified kinds; the database demands kind + date + recorder. Optional
`acceptance_document_id` and `acceptance_message_id` **reference** the contexts that own
them. Nothing derives acceptance from a message arriving — pinned by test.

## 6. Money — integer minor units only

`unit_amount_minor bigint` · `quantity_milli bigint` · `tax_rate_bp int`. **No `numeric`,
no float anywhere in the commercial schema** (pinned). Arithmetic throws on a
non-integer. Totals are **derived at read time and never stored** — a stored total is a
second source of truth that can drift from its lines.

**No tax rule exists.** The rate defaults to 0, no cascade is encoded, and the PDF prints
no tax block when nothing carries a rate. TVA and CA appear nowhere in the codebase.

## 7. Digital-LOS events

Domain `commercial` added to the registry and the SQL CHECK (WES-5 precedent). Ten types,
**all emitted from inside their RPC** — including `QUOTATION_CREATED`, which was
initially emitted from the action layer until the platform's own
`business-events` guard caught that two round trips cannot claim the registry's `rpc`
guarantee. Creation became `quotation_create`, an RPC. **The guard was right; the code
changed, not the guard.**

`QUOTATION_CONVERTED_TO_DOSSIER` carries the **dossier** as `subject_id` *and*
`dossier_id` — the keystone that starts a shipment's timeline with its commercial
provenance, without Tracking ever reading a Commercial table.

**No amount, price or currency travels in any payload** — pinned across events and audit.

## 8. Boundaries held

No dossier created (conversion **records** a file Operations made) · no Finance table
written · no second PDF engine · no second numbering engine · no communication engine and
no mail sent · RLS on all three tables, SELECT-only to `authenticated`, no portal policy.

## 9. Tests and CI

**Local: 200 files / 4913 tests green · tsc 0 errors · build clean.**
`tests/ec-3b-commercial.test.ts` — 51 contracts. `rls_commercial_quotation_test.sql` —
24 checks including both maker-checker paths, the revoked blanket grant, one-live-version,
sent-immutability, line-freezing, acceptance-requires-evidence, convert-requires-accepted,
the keystone event on the dossier, **zero Finance rows created**, and no amount in any
payload.

**Two existing guards caught real defects in my code**, both fixed rather than relaxed:

* **`tenant-scope.test.ts`** — the artifact generator read `client` with no tenant filter.
  The admin client bypasses RLS, so the filter was the only boundary; "the id came from a
  tenant-scoped row" is exactly the reasoning that produces cross-tenant reads later.
* **`business-events.test.ts`** — see §7.

Also fixed: an invisible **U+00A0** had crept into the money formatter. It is in fact the
correct French thousands separator, so it was made **explicit** with a documented escape
rather than silently replaced.

**One cross-phase regression, and the guard it produced.** The first CI run failed in
**EC-2's** suite, not EC-3B's — and because that abort skipped every later step, EC-3B's own
suite never ran. EC-2 had asserted `quotation_tables_created = 0` by counting
`information_schema.tables`; migration 82 creates exactly those tables, so the assertion was
*correctly* falsified. **Migration 82 was not touched.** EC-2's check was rewritten to count
quotation **rows** for the test tenant, which is what EC-2 actually promises — its handoff
records intent and mints nothing — and is true in every future phase; a `to_regclass` guard
keeps it valid whether or not the Commercial module exists. A new contract then forbids the
whole fragile shape: **no SQL suite may assert a table's absence via `information_schema`**,
because an absence claim about the *schema* is a claim about every phase that follows, while
an absence claim about *rows* is a claim about the phase's own behaviour. This is the second
instance of the pattern (EC-1's fixture was the first), so it is now pinned rather than
remembered.

**The SQL suite runs in CI only** (no Docker here); production is held until CI is green.

## 10. Deployment guide

1. **Wait for CI green** — per job, per step, **zero skipped**; the `EC-3B commercial`
   suite must appear and pass. A green summary is not evidence (DEV-HR6-01).
2. `cat supabase/.temp/project-ref` → `xtpppzhkiagdpmnghdlc`.
3. Apply migration 82 normally. **Never** `db push`, no ledger INSERT, no replay.
4. Verify:
   ```sql
   select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('quotation_request','quotation','quotation_line','quotation_counter'); -- 4
   select count(*) from public.permission where code='quotation:validate';                     -- 1
   -- THE correction: every quotation authority is now held by nobody.
   select count(*) from public.role_permission rp join public.permission p on p.id=rp.permission_id
     where p.code in ('quotation:create','quotation:send','quotation:approve','quotation:validate'); -- 0
   select count(*) from pg_proc where proname like 'quotation\_%' or proname='next_quotation_number'; -- 8
   select pg_get_constraintdef(oid) from pg_constraint
     where conname='business_event_event_domain_check';   -- must contain 'commercial'
   ```
5. Ledger reads **82/82** — repair if it lags, never replay.
6. **Grant nothing.**

## 11. Activation dependencies

| Ref | Decision | Owner |
|---|---|---|
| ~~**RATIFY-EC3-1**~~ | ✅ **ANSWERED 2026-08-06 (DEC-C32).** QUOTATION_MANAGER = `create`+`send`+`approve` · OPS_SUPERVISOR = `validate` only · SYSTEM_ADMIN = none. **Ratified, not yet applied** — the grant is additive migration 83 (EC-3C brief §2), unauthorised. The audit it required found one real gap: the shipped RLS SELECT policies gate on `quotation:create` alone, so a validating supervisor would see nothing. Corrected by widening those policies to `create OR validate`; **no `quotation:read` invented** | management ✅ |
| **MD-Q3** | is validation required for every quotation, or above a threshold? And who validates when only one Operations seat exists? *(DEC-C32 answers **who**, not **when**: it names OPS_SUPERVISOR as validator but does not set a threshold, and the single-seat case still cannot self-validate — `validated_by <> prepared_by`)* | management |
| **MD-Q10** | tax rates — per tenant, per client, per service? Nothing is defaulted until answered | management + counsel |
| MD-Q11 | numbering: `DEV-{year}-{seq}` shipped; confirm or change before real numbers exist | management |
| MD-Q13 | may a quotation address a prospect who is not yet a `client`? (schema takes the reversible NOT NULL path) | management |
| MD-Q4/Q5/Q6/Q8/Q14/Q15 | EC-3C / EC-3D scope | management |

---

## Confirmations

* **No duplicated Finance logic** — no invoice table touched, no billing row written.
* **No duplicated PDF engine** — `lib/reports/pdf` reused; no dependency added.
* **No duplicated numbering engine** — the established counter pattern, sixth instance.
* **No duplicated communication engine** — nothing here sends mail.
* **Commercial remains independent** — Operations owns dossier creation, Finance owns
  accounting, Tracking owns visibility; Commercial only emits.
* **Every state transition emits an immutable business event**, from inside its RPC.
* **Production remains dark**: migration unapplied, `quotation:validate` granted to
  nobody, and the pre-existing blanket grant revoked — so no user holds any quotation
  authority at all.
* **EC-3C has not begun**: no workspace route, no send-mail, no conversion orchestration.
