# EC-3C — Commercial / Quotation Workspace: Completion Report

**Date:** 2026-08-07 · **Migration:** 83 `20260807000001_commercial_activation.sql`
**Commit:** `59b2691` · **New permissions: none** — EC-3C *assigns* what EC-3B minted
**Governing decision:** **DEC-C32** (RATIFY-EC3-1) · Freeze: [ec-3a-governance-freeze.md](ec-3a-governance-freeze.md)

---

## 1. Repository audit (performed before any code)

| Surface | Found | Action |
|---|---|---|
| Quotation routes | **none** — `app/commercial` absent | created; no parallel route |
| Quotation actions | all eight lifecycle acts already in `lib/commercial/actions.ts`, each correctly gated | **reused unchanged** |
| `lib/commercial/service.ts` | reads on `getAdminSupabaseClient()` — **RLS bypassed**, no permission check | gated (§5) |
| RLS SELECT policies | all three gated on `quotation:create` **alone** | widened (§4) |
| PDF / document components | `lib/reports/pdf` + `lib/commercial/pdf.ts` render-once artifact with SHA-256 | reused; **never re-rendered** |
| Customer/client selectors | no reusable picker component exists | tenant-scoped `<select>` fed by a gated server read |
| EC-2 handoff path | `HANDOFF_TO_QUOTATION` outcome, `quotation_request.triage_item_id` link | read-only inbox (§12) |
| Business-event timeline | `readDossierTimeline` + `components/files/event-timeline.tsx` | **extended**, not duplicated (§13) |
| Navigation | DÉPARTEMENTS frozen at three entries; workspaces live on department hubs | hub tile + widened predicate (§6) |
| Outbound email | `lib/comms/provider` + `queueAndSend`; `invoice-send.ts` is the artifact-attachment precedent | mirrored exactly (§10) |

**No parallel route and no duplicate service was created.** Every act EC-3C exposes was
already implemented and gated by EC-3B; this phase adds the surface, the reads, and the
grant.

## 2. Architecture reused

`lib/reports/pdf` (PDF engine) · `lib/comms/provider` (outbound) · `lib/documents/storage`
(private bucket, signed URLs) · `lib/workflow/events/readers` (timeline) ·
`lib/auth/require-permission` · the quotation counter (numbering) · `public.client`.
**Nothing was forked.**

## 3. Migration 83

Additive, idempotent, forward-only; **1–82 untouched**; no table, column or constraint
dropped (dropping a *policy* to recreate it is the sanctioned way to change one).

## 4. Permission and RLS matrix

| Role | Permissions | Reads quotations? |
|---|---|---|
| **QUOTATION_MANAGER** | `quotation:create` · `:send` · `:approve` | yes (via `create`) |
| **OPS_SUPERVISOR** | `quotation:validate` **only** | **yes — via `validate`, the fix** |
| **SYSTEM_ADMIN** | **none** | **no** |
| anyone else | none | no |

The three SELECT policies now read
`tenant_id = auth_tenant_id() AND (has_permission('quotation:create') OR has_permission('quotation:validate'))`
on `quotation_request`, `quotation` and `quotation_line`.
**No `quotation:read` was invented** — the existing family expresses safe visibility.
**`quotation:create` was NOT granted to OPS_SUPERVISOR** to achieve readability, as
DEC-C32 explicitly refuses. Writes remain RPC-only: no INSERT/UPDATE/DELETE policy exists
for `authenticated`.

## 5. Application read-gate review — the important one

`lib/commercial/service.ts` uses the **admin client**, which bypasses RLS. The policies are
therefore defence in depth for direct PostgREST access; **they are not what protects the
application**. Every exported read now calls `assertCommercialRead(tenantId)` **before**
touching the client (order pinned by test), and that gate checks **two** things:

1. the caller holds `quotation:create` **or** `quotation:validate`;
2. the `tenantId` passed is the caller's **own** — the admin client would happily read
   another tenant's rows, and "the id came from a tenant-scoped row" is exactly the
   reasoning that produces cross-tenant reads later.

`quotationArtifactUrl` is gated the same way rather than on `quotation:send`: a validator
must be able to open the document they are judging, and the bucket is private with no
`storage.objects` policy for `authenticated`, so this function is the only door.

## 6. Workspace routes — one route per capability

| Route | Capability |
|---|---|
| `/commercial` | the landing **and the list**, organised by state |
| `/commercial/quotations/new` | open a request + draft v1 (`quotation:create`) |
| `/commercial/quotations/[id]` | one quotation: detail, acts, versions, timeline |

**No `/commercial/quotations` index was created** — it would show the same rows as the
landing under a different heading, which the "exactly one route per capability" rule
forbids. Each page gates itself and 404s rather than 403s.

**A reachability defect was found and fixed.** `QUOTATION_MANAGER` holds only
`profile:*` + `quotation:*` + `messaging:*` — none of `file:read` / `client:read` /
`document:read` — so the Operations hub 404'd and the sidebar section never rendered:
the workspace was unreachable for the role that owns it. **DÉPARTEMENTS stays at exactly
three entries** (test-pinned); the *predicate* widened and a Commercial tile was added to
the hub, which renders no data.

## 7. Role-based queues

Agents see drafts, awaiting-validation, validated-ready-to-send, sent-awaiting-customer,
and the outcome queues. Supervisors see awaiting-validation and the outcome queues — **not
drafts**, which they can neither read nor act on. `lib/commercial/queues.ts` is **pure**,
so the rules are testable without a database, and every capability mirrors a server gate:
**no act is offered that the action or a CHECK would refuse.**

## 8. Drafting and revision

Client selection is tenant-scoped server-side and re-verified by the action. Line entry
takes description, quantity, unit price and **tax rate as entered configuration** — no rate
is defaulted, suggested or cascaded. Validity is free text with **no automatic expiry and
no scheduler**. A sent quotation is immutable; revision creates a **new version**, the
previous survives as SUPERSEDED and stays visible, and a partial unique index allows
exactly **one live version per request**, so "only the latest may be sent or accepted" is a
database fact.

## 9. Validation and rejection

OPS_SUPERVISOR validates or rejects with a **mandatory reason**. The same actor may not
validate what they prepared — enforced by `quotation_validator_differs` (CHECK) *and*
QT606 (RPC), with the button **absent** and the reason named in French rather than
presented-and-refused. Under DEC-C32 this is now doubly true: the validating role holds no
`quotation:create` at all.

## 10. Sending

Only a VALIDATED quotation may be sent. `sendQuotation` mints the number, freezes the row
and emits `QUOTATION_SENT` from inside its RPC; `emailQuotationToCustomer` then delivers
the **stored** artifact through `lib/comms/provider` — mirroring `invoice-send.ts`
statement for statement. **No second email engine, no template table, no re-render**: the
customer receives the exact bytes whose SHA-256 the row records, and the audit records
which artifact went, by hash. A delivery failure is reported and retryable; it never
un-sends a quotation whose event has already committed.

## 11. Acceptance evidence

Three ratified kinds, evidence and date required. **Acceptance is never inferred** — the UI
says so, and nothing derives it from an inbound message.

## 12. EC-2 integration

Handoffs appear on the landing as an **inbox** of triage items resolved
`HANDOFF_TO_QUOTATION` and not yet linked. Opening one is a deliberate act that creates the
request and carries `triage_item_id`. **Nothing auto-creates a quotation**, the triage table
is never written, and **quarantine semantics are untouched** — a quarantined item carries no
outcome, so it cannot appear. A `?triage=` query value is untrusted and honoured only if it
really is an unlinked handoff in this tenant.

## 13. Digital-LOS events

All nine types render on the quotation timeline and the landing's activity strip.
**EC-3C emits no new event type** — migration 82 registered all ten, each from inside its
RPC. `readQuotationTimeline` selects on `metadata.quotation_id`, which every commercial
event carries, so `QUOTATION_CONVERTED_TO_DOSSIER` appears on **both** the quotation and
the dossier timeline — the one event that belongs to both stories.

It reads on the admin client **deliberately**: `business_event_select` admits only dossier
events (via `can_read_file`) and configuration events, and a commercial event carries
`dossier_id = NULL` until conversion. Widening a policy on the shared ledger would change
what every other module's events are worth; this follows the pattern `readClientTimeline`
already uses. **No customer prose or document body enters a payload** (pinned by the
metadata registry).

## 14. Security / RLS review

Tenant isolation (policy **and** application gate) · SYSTEM_ADMIN holds zero and sees zero ·
portal sees zero · a staff user with neither authority sees zero · supervisors cannot edit
draft lines · agents cannot validate · sending before validation refused · self-validation
refused by RPC **and** by CHECK · previous versions immutable · cross-tenant client
selection refused · admin-client reads application-gated.

**Conversion:** `recordConversion` **records** a dossier Operations created. Commercial
creates no dossier and writes into no dossier internals — pinned across all four
`lib/commercial` modules. **No conversion UI is exposed in EC-3C.**

## 15. Files changed

**New:** migration 83 · `lib/commercial/queues.ts` · `lib/commercial/send.ts` ·
`app/commercial/{layout,page}.tsx` · `app/commercial/quotations/new/page.tsx` ·
`app/commercial/quotations/[id]/page.tsx` ·
`components/commercial/{new-quotation-form,quotation-studio}.tsx` ·
`supabase/tests/rls_commercial_activation_test.sql` · `tests/ec-3c-commercial-workspace.test.ts`.
**Modified:** `lib/commercial/service.ts` (gate + workspace reads) ·
`lib/workflow/events/readers.ts` (two readers) · `lib/nav.ts` ·
`app/departments/operations/page.tsx` · `supabase/seed.sql` ·
`lib/platform/role-templates.ts` · `lib/platform/ops/build-info.ts` · `ci.yml` ·
9 test files.

## 16. Tests and CI

**Local: 201 files / 4950 tests green · tsc 0 · build clean** (all three routes compiled).

**CI: GREEN — run `30773158495` (`48f27c8`), `rls-tests` 76 steps / 0 skipped / 0 failed,
`build` 10 / 0 / 0.** All four EC suites executed **by name**:
`EC-1 inbound email` · `EC-2 triage outcomes` · `EC-3B commercial quotation` ·
**`EC-3C commercial activation` — success on its first execution**. The clean **1 → 83**
migration chain is therefore proven, and migration 83 has never been applied anywhere while
its suite was unproven (the DEV-HR6-01 exposure).

* `tests/ec-3c-commercial-workspace.test.ts` — 34 contracts.
* `supabase/tests/rls_commercial_activation_test.sql` — 15 checks in real PostgreSQL,
  including **the one the whole audit existed for**: a validate-only supervisor sees the
  quotation, **its lines and its request**.
* The EC-3B zero-grant contract **became an exact-matrix assertion** at all three sources —
  the protection was strengthened, not deleted — and was **mutation-tested in both
  directions** (an added SYSTEM_ADMIN grant is caught; a removed legitimate grant is caught).
* The EC-3B RLS suite's `legacy=0` became the **live matrix + `admin_grants=0`**.

**Eight drift-proofing assertions in other suites were repaired**, not suppressed: four
hardcoded "the newest migration is X", which made every future phase edit a test to restate
a fact it could read from disk. They now delegate to the migrations directory. Added a
**self-maintaining** check that every `supabase/tests/*.sql` is wired into CI — the failure
the hand-moved ordering pin could never catch.

## 17. Deployment guide

1. **Wait for CI green** — per job, per step, **zero skipped**; both
   `EC-3B commercial quotation` and `EC-3C commercial activation` must appear and pass.
2. Apply migration 83 normally. **Never** `db push`, no ledger INSERT, no replay.
3. Verify:
   ```sql
   -- The ratified matrix, live.
   select r.code, p.code from public.role_permission rp
     join public.role r on r.id = rp.role_id
     join public.permission p on p.id = rp.permission_id
    where p.code like 'quotation:%' order by 1,2;
   -- Expect exactly: OPS_SUPERVISOR|quotation:validate,
   -- QUOTATION_MANAGER|quotation:approve, :create, :send. NOTHING else.

   -- SYSTEM_ADMIN holds nothing.
   select count(*) from public.role_permission rp
     join public.role r on r.id = rp.role_id
     join public.permission p on p.id = rp.permission_id
    where r.code = 'SYSTEM_ADMIN' and p.code like 'quotation:%';   -- 0

   -- All three policies widened.
   select tablename, policyname from pg_policies
    where schemaname='public' and policyname like 'quotation%_select';  -- 3 rows
   ```
4. Ledger reads **83/83** — repair if it lags, never replay.
5. **Assign the seats.** The permissions now attach to roles; a *person* can quote only once
   they hold QUOTATION_MANAGER or OPS_SUPERVISOR. Verify at least one holder of each, and
   that they are **different people** — a single seat holding both still cannot self-validate.

## 18. Remaining activation dependencies

| Ref | Decision | Owner |
|---|---|---|
| **SEATS** | assign QUOTATION_MANAGER / OPS_SUPERVISOR to real users (**nobody can quote until then**) | management/ops |
| **MD-Q10** | tax rates — nothing is defaulted; every rate is typed per line until answered | management + counsel |
| **MD-Q3** | is validation required for every quotation or above a threshold? | management |
| **MD-Q11** | numbering `DEV-{year}-{seq}` — confirm before real numbers exist | management |
| **MD-Q13** | may a quotation address a prospect who is not yet a `client`? | management |
| **DEC-EC-D2** | outbound provider/DPA — email delivery returns `email_not_configured` until set | management |

## 19. Readiness for EC-3D

EC-3D (conversion to dossier + billing projection) is **unblocked and not begun**.
`recordConversion` and `QUOTATION_CONVERTED_TO_DOSSIER` already exist and are proven;
`billing_charge` remains the untouched projection target; accepted-not-converted is already
surfaced as a counter. What EC-3D must add is the **Operations-owned** dossier creation
call and the line projection — never a direct write into dossier internals.

---

## Confirmations

* **EC-3C is complete** as specified; nothing in the mission's scope was deferred. What
  remains is management seat assignment, not engineering.
* **SYSTEM_ADMIN has no quotation access** — no grant at any of the three sources, zero
  visibility proven in real PostgreSQL, and named only inside a `delete` in migration 83.
* **The exact permission matrix is enforced at all three sources** — migration, seed and
  role templates — with an exact-matrix contract and a live-database assertion.
* **The admin-client read path is explicitly gated**, permission *and* tenant, before the
  client is touched.
* **No tax or pricing rule was invented.** No rate, no cascade, no tariff, no price list.
* **No dossier was created outside Operations.** Commercial records conversion; it never
  performs it, and no conversion UI ships here.
* **EC-3D has not begun.**
