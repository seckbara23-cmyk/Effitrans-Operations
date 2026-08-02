# EC-1 — Inbound Email Foundation: Completion Report

**Date:** 2026-08-04 · **Migration:** 80 `20260804000001_ec_inbound_foundation.sql`
**New permissions:** 2, **granted to nobody** · **Production: DARK** (env flag unset)
· **Capture-only:** no business object is created by any code path in this phase.

---

## 1. Repository reuse report

EC-1 composed existing infrastructure and added no parallel engine.

| Reused | From | How |
|---|---|---|
| **Webhook transport pattern** | `app/api/payments/webhook/[provider]/route.ts` | raw body first, signature verified inside the processor, no auth cookie, env-gated, provider path param, internals never leaked |
| **HMAC verification** | `lib/finance/providers/sign.ts` | `verifyHmacSignature` imported **unchanged** — timing-safe, already tested |
| **Adapter + registry shape** | `lib/finance/providers/index.ts` | `getInboundProvider(name)`; the pipeline never branches on a provider name (pinned) |
| **Idempotency ledger** | `provider_webhook_event` | `ec_webhook_event` mirrors it: unique `(provider, provider_event_id)`, 23505 = concurrent duplicate |
| **Audit engine** | `lib/audit/log` + `events` + `validate` | three machine actions registered in the existing `SYSTEM_MACHINE_ACTIONS` allow-list |
| **Private storage idiom** | `lib/documents/storage`, `lib/messaging/attachments` | private bucket, service-role writes, filename sanitization, MIME allow-list, byte-size caps |
| **Two-layer rollout** | `tenant_messaging_rollout` | `tenant_ec_inbound_rollout`, same shape, **fail closed** |
| **RLS idiom** | every tenant table | `tenant_id = auth_tenant_id() AND has_permission(...)`, SELECT-only to `authenticated`, no portal policy |
| **Immutability** | WES-9 `prevent_mutation` | applied to message, attachment and webhook-event |
| **Observability** | `reportError` | reused the existing `webhook` scope rather than widening `ErrorScope` |

**Not touched, contracts intact:** `lib/comms` (outbound), `lib/messaging`, `lib/notifications`,
`lib/customer-notify`. A test pins that EC-1 references none of their tables and calls
none of their send paths — **no fifth communication engine**.

## 2. Provider-adapter architecture

`InboundEmailProvider.parseWebhook(rawBody, headers) → InboundEmail` behind a registry.

* **GENERIC** — the working adapter. HMAC-SHA256 over the raw body in `x-ec-signature`;
  documented JSON envelope (the contract is written out in `providers.ts`).
* **RESEND** — deliberately `not_configured`. **DEC-EC-D2 (provider + DPA) is still
  open**, and writing a payload mapping for a contract nobody has ratified would be
  guesswork. This is precisely how payments shipped: `MockProvider` worked while Wave and
  Orange Money stayed `not_configured` until their contracts landed.

A signature failure **returns `signatureValid: false`** rather than throwing, so the
refusal is logged as evidence; the adapter throws only when a payload is unintelligible.

## 3. Mailbox and routing model

`ec_mailbox`: tenant, **address (globally unique)**, `label_fr`, `purpose`, `is_active`.

* **Global uniqueness, not per-tenant** — the single most important constraint here. Two
  tenants claiming one address would make routing a guess; the index refuses it.
* A lowercase CHECK makes case-collision impossible rather than trusting callers.
* `purpose` is **tenant vocabulary** (QUOTATION / OPERATIONS / FINANCE / TRANSIT /
  SUPPORT / …) carried as configuration. **EC-1 starts no workflow from it** — it exists
  so EC-2 has something ratified to dispatch on. No platform or customer domain is
  hardcoded anywhere in the migration.

`resolveRouting()` is **pure and unit-tested**: one match routes · zero → `no_matching_mailbox`
· two *different* mailboxes → `ambiguous_routing` (even inside one tenant, because EC-2
dispatches on the mailbox) · the same mailbox in To and Cc is **not** ambiguous · an
inactive sole match → `mailbox_inactive`. **The sender is never consulted** — pinned by a
test that reads the routing block and asserts `fromAddress` does not appear in it.

## 4. Inbound capture model

`ec_inbound_message` — **append-only** (`prevent_mutation`: no UPDATE, no DELETE).
Provider evidence (provider, event id, message id) · RFC-5322 threading (`message_id`,
`in_reply_to`, `references_header`, derived `thread_key`) · participants and subject ·
`raw_sha256` + `raw_storage_path` + `raw_size_bytes` · normalized `headers` ·
**`text_body_path` / `html_body_path` — paths, never prose columns** · `received_at` ·
`capture_status` · `quarantine_reason`.

**The immutability split is structural.** Everything mutable lives in `ec_triage_item`,
a 1:1 companion. "Corrections occur through triage metadata, not by rewriting the
message" is therefore a fact the database enforces, not a convention to remember.

## 5. Attachment model

`ec_inbound_attachment` — **every part is recorded** (sanitized filename, original name,
MIME, size, SHA-256); **bytes are extracted only** for allow-listed MIME under 15 MiB.
A refused part carries `stored = false` + `rejection_reason`, enforced by a CHECK.

No evidence is lost by refusing extraction: the **raw envelope contains the attachment
regardless**, so this is storage hygiene, not an evidence decision.

Nothing here is a `public.document` and **no foreign key points at one** — a test
enumerates every FK target in the migration and fails on anything outside
`organization`, `app_user`, `platform_admin` and the `ec_*` tables. Promotion into
governed document storage is a later human-authorized phase (ADR-EC-5).

## 6. Quarantine model

Unroutable mail is **kept, not discarded** — discarding would destroy the only proof of
what arrived. Reasons: `no_matching_mailbox` · `ambiguous_routing` · `tenant_not_enabled`
· `mailbox_inactive` · `payload_too_large` · `malformed_envelope`.

**A quarantined row carries `tenant_id = NULL`**, so the tenant RLS predicate excludes it
from *every* tenant — misrouted mail cannot leak into the wrong tenant because it belongs
to none. Its storage path is scoped `quarantine/…`, outside every tenant prefix. A CHECK
constraint makes the two shapes mutually exclusive: RECEIVED requires a tenant and a
mailbox and no reason; QUARANTINED requires no tenant and a reason.

## 7. Permission analysis — **the finding that shaped this phase**

**`communication:read` is already granted to SYSTEM_ADMIN, CEO, OPS_SUPERVISOR,
ACCOUNT_MANAGER and FINANCE_OFFICER** (migration `20260615000008`). Reusing it for
inbound would have handed every incoming customer email to five roles — including a
platform administrator — the moment migration 80 landed. EC-1's own security requirement
("SYSTEM_ADMIN must not automatically read tenant correspondence") forbids exactly that.

So the existing family was **insufficient**, and inbound gets its own gate:

| Code | Purpose | Granted |
|---|---|---|
| **`communication:inbound:read`** | read captured inbound correspondence | **nobody** |
| **`communication:triage`** | triage an inbound message (EC-2's authority) | **nobody** |

Reused unchanged where sufficient: `communication:send` / `:manage` are untouched, and
EC-1 adds no outbound path that would need them.

**Smallest ratification proposal (RATIFY-EC1-1):** grant `communication:inbound:read` to
the seat that will actually read customer mail — most plausibly a
commercial/operations reader, **not** SYSTEM_ADMIN, whose administrative role does not
imply a business need to read correspondence. `communication:triage` is a separate
decision and belongs with EC-2 activation (DEC-EC-D3). Until both are granted, the tables
are readable by **nobody** — the intended dark state.

## 8. Migration details

Additive, forward-only, idempotent. **Migrations 1–79 untouched** (pinned). Six tables,
one private bucket, two permissions, zero grants, zero destructive statements — the only
`drop`s are the trigger/policy/function drop-then-recreate idempotency idiom (pinned).

## 9. RLS and security review

RLS enabled on all six tables from birth. Reads gated on
`tenant_id = auth_tenant_id() AND has_permission('communication:inbound:read')`;
`authenticated` receives **SELECT only** — every write goes through the service role.
**No portal policy** anywhere. **SYSTEM_ADMIN is never named** in the migration.
Quarantine is tenant-less and therefore invisible to all tenants.

**Data protection.** No prose column exists on any table. Audit payloads are scanned by a
test that fails if `subject`, `from_address`, `filename`, `headers` or any body field
appears in a `writeAudit` call. The pipeline contains **no `console.*`**. The HTTP
response is an outcome plus a short classification — never content, never internals.

## 10. Webhook threat review

| Threat | Mitigation |
|---|---|
| Forged POST | HMAC-SHA256 over the raw body, timing-safe compare; unsigned → 401 + logged refusal |
| Replay / duplicate delivery | unique `(provider, provider_event_id)`; pre-check returns `DUPLICATE`; concurrent insert caught via 23505 |
| Oversized payload | 25 MiB ceiling checked in **bytes**, *before* parsing (pinned to precede `parseWebhook`) |
| Path traversal via filename | `sanitizeFilename` strips separators and leading dots; unit-tested against `../../etc/passwd`, `C:\Windows\evil.exe` |
| Forged storage prefix | `inboundStoragePath` accepts a UUID scope or falls back to `quarantine/` — a non-UUID cannot forge a tenant prefix (unit-tested) |
| Malicious attachment | never executed or rendered; MIME allow-list + size cap for extraction; hash recorded regardless |
| Tenant misrouting | explicit address→tenant mapping only; ambiguity quarantines; sender never consulted |
| Spam flood | dark by default; capture-only bounds blast radius to storage; per-delivery evidence rows are cheap and immutable |
| Secret leakage | secrets read server-side only, never `NEXT_PUBLIC_`; signature header value never logged |
| Endpoint discovery | no session, so nothing to steal; a valid signature is the only way in |

**Residual, and stated plainly:** rate limiting is **not implemented in EC-1** — it
belongs at the edge (Vercel/WAF), and implementing an in-process limiter would need
shared state this platform does not have. Recorded as an activation dependency, not
silently skipped.

## 11. Files created and modified

**Created:** migration 80 · `lib/ec/inbound/{types,parse,providers,capture}.ts` ·
`app/api/ec/inbound/[provider]/route.ts` · `supabase/tests/rls_ec_inbound_test.sql` ·
`tests/ec-1-inbound.test.ts` · this report.
**Modified:** `lib/audit/events.ts` (+3 machine actions) · `lib/audit/validate.ts`
(allow-list) · `lib/db/types.ts` (6 tables) · `.github/workflows/ci.yml` (+1 suite) ·
7 drift pins.

## 12. Tests and CI results

**Local: 198 files / 4818 tests green · tsc 0 errors · build clean**, with
`/api/ec/inbound/[provider]` present in the build output.

`tests/ec-1-inbound.test.ts` — 47 contracts across: migration chain · permissions (incl.
an assertion that `communication:read`'s SYSTEM_ADMIN grant exists, which is *why* the
new code exists) · capture-only (no business import, no business FK, ec_-tables-only
writes) · webhook security (raw-body ordering, no session, fail-closed statuses,
idempotency, no IMAP/scheduler, adapter registry) · data protection · routing (7 cases) ·
address/filename normalization · attachments · immutability · no-fifth-engine.

`supabase/tests/rls_ec_inbound_test.sql` — 18 checks including **SYSTEM_ADMIN, holding
`communication:read`, sees zero inbound rows**, portal sees zero, quarantine is invisible,
capture refuses UPDATE and DELETE, the global address index refuses a second tenant, and
**no client/dossier/document row was created**.

**The SQL suite runs in CI only** — there is no Docker in this environment, so CI is its
first execution. Production stays dark regardless.

## 13. Operator deployment procedure

1. **Wait for CI green** — per job, per step, **zero skipped**. The `EC-1 inbound` suite
   must appear and pass. A green summary is not evidence (DEV-HR6-01 control).
2. Confirm `cat supabase/.temp/project-ref` = production `xtpppzhkiagdpmnghdlc` (INC-HR3-01).
3. Apply migration 80 through the normal path. **Never** `db push`, never a manual ledger
   INSERT, never a replay.
4. **Verify objects, not the report:**
   ```sql
   select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('ec_mailbox','ec_webhook_event','ec_inbound_message',
       'ec_inbound_attachment','ec_triage_item','tenant_ec_inbound_rollout');   -- expect 6

   select count(*) from public.permission
     where code in ('communication:inbound:read','communication:triage');       -- expect 2
   select count(*) from public.role_permission rp join public.permission p
     on p.id=rp.permission_id
     where p.code in ('communication:inbound:read','communication:triage');     -- expect 0

   select count(*) from pg_policies where schemaname='public'
     and tablename like 'ec\_%' and policyname like '%_select';                 -- expect 5
   select count(*) from storage.buckets where id='ec-inbound' and public=false; -- expect 1
   select count(*) from public.ec_mailbox;                                      -- expect 0
   ```
5. Confirm the ledger reads **80/80** via `supabase migration list`; if it lags, reconcile
   with `migration repair --status applied 20260804000001` — **repair, never replay**.
6. **Leave `EFFITRANS_EC_INBOUND_ENABLED` unset.** The endpoint returns 503 and captures
   nothing. That is the intended post-deployment state.

## 14. Activation dependencies

| Ref | Needed for | Owner |
|---|---|---|
| **DEC-EC-D1** | inbound addresses/domain + DNS — nothing can route until mailboxes exist | management |
| **DEC-EC-D2** | provider choice + DPA — RESEND stays `not_configured` until then | management |
| **RATIFY-EC1-1** | grant `communication:inbound:read` — today **nobody** can read a captured message | management |
| **DEC-EC-D4** | retention for raw mail — no purge mechanism exists, and none was invented | counsel |
| **NEW — EDGE-EC1-1** | edge rate limiting before the endpoint is publicly reachable | platform/ops |
| DEC-EC-D3 | `communication:triage` grant | EC-2, not EC-1 |

**Activation order:** grants and mailboxes are useless without a provider, and a provider
is dangerous without rate limiting. Recommended: DEC-EC-D2 → EDGE-EC1-1 → DEC-EC-D1
(mailboxes) → RATIFY-EC1-1 → enable the env flag → enable the tenant row.

## 15. Readiness assessment for EC-2

EC-2 can begin on this foundation. It inherits: the triage item with its five states and
guarded transitions; the mailbox `purpose` field to dispatch on; `communication:triage`
already catalogued (so EC-2 needs **no permission migration**); immutable evidence to
decide against; and the `thread_key` EC-4 will correlate on.

EC-2 must add — additively — the **outcome** columns deliberately omitted here
(attach-to-dossier, quotation-request reference, discard reason), the triage workspace,
and the actions themselves. It should not begin before **RATIFY-EC1-1 / DEC-EC-D3**, since
a triage workspace nobody may open is not testable by its intended users.

---

## Confirmations

* **EC-1 is capture-only.** The pipeline imports no business service, writes only to
  `ec_*` tables plus storage and audit, and the migration contains no foreign key into
  any business table — all three pinned by test.
* **No quotation, dossier, client, document, task or invoice was created automatically**,
  by any code path. Asserted in both the vitest suite and the SQL suite.
* **Production remains dark.** `EFFITRANS_EC_INBOUND_ENABLED` is unset, so the endpoint
  returns 503; the tenant rollout table is empty; both permissions are granted to nobody;
  and `ec_mailbox` ships with zero rows, so nothing could route even if the flag were on.
* **EC-2 has not begun.** No triage workspace, no outcome column, no dossier attachment,
  no quotation creation, no AI classification exists in this phase.
