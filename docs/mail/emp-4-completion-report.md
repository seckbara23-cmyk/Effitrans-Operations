# EMP-4 — Attachment → Document Ingestion: Completion & Deployment Report

**Date:** 2026-08-08 · **Implementation SHA:** `a5f939b`
**CI GREEN — run #373: `rls-tests` 81 steps / 0 skipped / 0 failed · `build` 10 / 0 / 0**
**Migration 88 `20260812000001_document_ingest_provenance.sql` — APPLIED IN CI, UNAPPLIED IN PRODUCTION**

Green on the first attempt, which is worth noting after EMP-3 needed four rounds: the
difference was the pre-code audit below, which established what already existed before any SQL
was written.

---

## 1. Mandatory pre-code audit — all five claims verified, no STOP

| Required verification | Result |
|---|---|
| `uploadObject` already supports byte-copy | **Yes.** `(path, bytes: Uint8Array, contentType)` — WES-4G.5 built it that way so the hash describes the stored bytes. |
| `document` INSERT still emits `DOCUMENT_UPLOADED` | **Yes.** `emit_document_events()` AFTER INSERT, `source='db_trigger'`, actor `new.uploaded_by`. It **re-raises** on ledger failure, so a document cannot exist without its event. |
| No duplicate document emitter | **None.** Every TS occurrence is `AuditActions.DOCUMENT_UPLOADED` = `"document.uploaded"` — the audit-log namespace, not the ledger. The only TS caller of `emit_business_event` is the ledger marker. |
| No second document service | **None.** `lib/documents/` is the only one. |
| No second upload pipeline | **None.** `lib/documents/storage.ts` is the only door to the `documents` bucket. |

---

## 2. Migration 88 — one column, one index

```sql
alter table public.document
  add column if not exists source_attachment_id uuid
    references public.ec_inbound_attachment (id);

create unique index if not exists uq_document_source_attachment
  on public.document (source_attachment_id)
  where source_attachment_id is not null;
```
Plus one lookup index and migration-time assertions. **No table, bucket, RLS policy, permission,
grant, emitter, trigger, RPC, queue or background job.**

**Why the column, when both sides already carry a SHA-256 (RATIFY-EMP4-1).** The hash proves
**content** identity — these bytes are those bytes. It cannot prove **business** provenance: two
customers can send the same PDF, and matching on hash alone would attribute a document to
whichever attachment happened to share its content. Both are kept because they answer different
questions.

**Why the index is partial.** Every document that exists today has NULL provenance. A non-partial
unique index would permit exactly one such row — i.e. one document in the whole table. The
partial predicate also makes it cheap to build and safe to validate, unlike a narrowing CHECK
(the EMP-3 lesson).

---

## 3. Idempotency — the invariant, and two deliberate choices

**Enforced by the unique index, not by a service check.** A read-then-insert would let two
operators clicking at the same instant both through; an index cannot be raced. The service's
pre-check exists only to produce a friendly refusal, and the database has the last word — a
`23505` is reported as `already_ingested` rather than surfacing as a crash.

* **Soft-delete does not reopen ingestion.** "Already ingested" is a fact about the *attachment*,
  not about the current status of its copy. Making the refusal depend on lifecycle state would
  mean deleting a document silently re-armed duplication.
* **A lost race does not delete the stored object.** Removing an object on a path another writer
  may own is worse than leaving an inert orphan.

Duplicate creation is never the default, and no override path exists — a test pins the absence
of `force`/`allowDuplicate`/`override`.

## 4. The copy, and what makes it verifiable

Bytes are downloaded from `ec-inbound`, hashed **once** (a single `arrayBuffer()` call, pinned),
and the same buffer is passed to `uploadObject`. If the hash disagrees with what EC-1 recorded at
capture, ingestion is **refused** — copying anyway would launder a disagreement between evidence
and its hash into a document that looks trustworthy.

The two hashes are not a duplicate: `ec_inbound_attachment.sha256` describes an object in
`ec-inbound`, `document.content_sha256` describes an object in `documents`. Same value, different
stored subjects — which is exactly what makes the copy checkable.

## 5. Authorization

Both authorities, checked separately so a refusal names the missing one:
`communication:inbound:read` (see the attachment) **AND** `document:create` **AND**
`isFileVisible` on the target dossier — the same gate the manual upload path uses, reused rather
than re-implemented. **No new permission.** `SYSTEM_ADMIN` appears nowhere.

Document type is **required** from the operator: an email attachment has no inherent type, and
`document.type_code` is NOT NULL, so a default would record a guess as a fact.

## 6. Where the control lives — and why that is architectural

EC-2 pins that its **own** surfaces create nothing automatically. Ingestion therefore lives in
`lib/ec/ingest/` and `components/ec/attachment-ingest.tsx`, mounted on the triage detail page
but outside EC-2's actions and studio. A test asserts those files stay free of `public.document`,
so EC-2's guarantee remains true rather than re-scoped.

## 7. Files changed

**New:** `supabase/migrations/20260812000001_document_ingest_provenance.sql` ·
`lib/ec/ingest/service.ts` · `lib/ec/ingest/actions.ts` ·
`components/ec/attachment-ingest.tsx` · `supabase/tests/rls_document_ingest_test.sql` ·
`tests/emp-4-ingest.test.ts` · `docs/mail/emp-4-audit.md`.

**Modified:** `app/communications/triage/[id]/page.tsx` (mounts the control) ·
`lib/audit/events.ts` (`EC_ATTACHMENT_INGESTED`) · `lib/db/types.ts` ·
`lib/platform/ops/build-info.ts` · `.github/workflows/ci.yml` ·
`tests/fin-aging-schema.test.ts` (ordering pin moved to the newest suite).

## 8. Tests

**32 TypeScript contracts** covering: no table/bucket/policy/permission/emitter; the single
storage abstraction; inbound bucket read-only; inbound row never mutated; EC-2's surfaces still
clean; migration position; nullable FK; both provenance signals; hash-once-store-once; mismatch
refusal; partial unique index; `23505` handling; no object deletion on a lost race; no override
path; both authorities; tenant scoping; no `SYSTEM_ADMIN`; required type; no OCR; no AI; no
background work; no customer visibility; one audit entry, distinct from the timeline event.

**New SQL suite** (CI, last) proving against a real database: at-most-once ingestion, including
**across dossiers** and **after soft delete**; `DOCUMENT_UPLOADED` emitted **exactly once** and
**only** with `source='db_trigger'`; **no extra business event** for the ingested document; the
inbound attachment and its hash unchanged; copied hash equal to the inbound hash; document
lifecycle independent of the evidence; ordinary NULL-provenance uploads unaffected.

**Local: 211 files / 5347 tests green · tsc 0 · build compiled · `ci.yml` re-parsed valid.**

One test-authoring bug found and fixed: a regex asserting the column is nullable matched the
migration's own error *message* ("source_attachment_id missing or NOT NULL"). Scoped to the DDL.

## 9. Deployment

| Gate | State |
|---|---|
| CI run exists for the exact SHA | **Yes — run #373 on `a5f939b`** |
| `rls-tests` | **81 / 0 skipped / 0 failed** |
| `build` | **10 / 0 / 0** |
| Migration 88 in production | **NOT APPLIED** |
| Feature reachable | **No — ships dark** |

**Operator actions**

1. Apply migration 88 through the sanctioned path; confirm the ledger reads **88/88**.
2. Nothing else. There is no flag, no environment variable and no permission to grant for
   EMP-4 itself.
3. The feature stays unreachable regardless, because `communication:inbound:read` is granted to
   no role (**RATIFY-EC1-1**). EMP-4 made no attempt to change that, as ratified.

**Rollback note:** migration 88 is additive and nullable. Dropping the index and column would
lose provenance on any ingested document but breaks nothing else — no code path requires the
column to be non-null.

## 10. Remaining EMP roadmap

| Phase | Status |
|---|---|
| **EMP-4A** — mailbox membership & user provisioning | **registered, not started** (`docs/mail/emp-4a-mailbox-provisioning-brief.md`). Audit-first; its STOP clause is live because per-mailbox ACL is the new security boundary EMP-0 deferred as RATIFY-EMP-2. |
| **EMP-5** — AI suggestions (no autonomous send) | **untouched**, as required |
| EMP-6 — customer visibility | blocked on RATIFY-EMP-10 |
| **OPS-SEC-1** (recommended) | pre-existing RPCs likely executable by `authenticated` on hosted Supabase — reported at EMP-3, not patched |

Open ratifications: RATIFY-EC1-1 (gates the whole EC workspace), RATIFY-EMP-4/9/10/11.

---

## Confirmations

* **The same attachment cannot be ingested twice** — enforced by a partial unique index, proven
  across dossiers and after soft delete.
* **Provenance FK recorded; SHA preserved; copied hash equals the inbound hash.**
* **The original inbound object and row are unchanged**, and the document lifecycle is
  independent of them.
* **`DOCUMENT_UPLOADED` is emitted exactly once, by the existing trigger only** — no duplicate
  business event, no duplicate timeline entry, one audit entry.
* **No automatic OCR · no automatic AI · no background worker.**
* **No new bucket · no RLS change · no permission change · no customer visibility · no second
  document model, attachment model or storage abstraction.**
* **EMP-5 has not begun** · **EMP-4A has not begun.**
