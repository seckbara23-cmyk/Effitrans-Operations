# EMP-4 — Attachment → Document Ingestion: Architecture Audit

**Date:** 2026-08-08 · **Baseline:** EMP-3 complete, migration **87 applied**, history reconciled,
CI green, no schema drift.
**Status: AUDIT ONLY. No code, no SQL, no migration was written. Documentation commit only.**

---

## 0. Headline

**Ingestion does not exist — and almost nothing needs to be built to make it exist.**

No code anywhere promotes an `ec_inbound_attachment` into `public.document`. But every
primitive the promotion needs already exists and was, in one case, deliberately designed for
exactly this shape. **The provisional finding is that EMP-4 requires NO migration**, subject to
one ratification (§6, RATIFY-EMP4-1) that decides whether provenance is recorded by pointer or
by content.

The real blocker is not technical. **`communication:inbound:read` is granted to no role**
(it appears **zero times** in `role-templates.ts`), so today nobody can even see an attachment
to ingest it. EMP-4 inherits RATIFY-EC1-1 wholesale.

---

## 1. Architecture discovered

### 1.1 The document model — complete, and already hash-bearing

`public.document` (migration `20260615000001`, extended by WES-4/WES-4G):

```
id, tenant_id, file_id → operational_file, type_code → document_type,
title, status (UPLOADED|PENDING_REVIEW|APPROVED|REJECTED|EXPIRED),
version, supersedes_id, superseded_by_id, expiry_date,
storage_path, mime_type, size_bytes, content_sha256,
artifact_code, source_snapshot, invoice_id, shared_with_client,
uploaded_by, reviewed_by, review_note, deleted_at (soft delete)
```

`content_sha256` was added by WES-4 with a comment that matters here: it is **NULL for rows
uploaded before WES-4**, because *"the bytes are unchanged but were never hashed, and computing
one now would claim an assurance we do not have."* The same discipline governs EMP-4.

### 1.2 The upload pipeline — designed to take bytes, not a browser file

`lib/documents/storage.ts`:

```ts
uploadObject(path: string, bytes: Uint8Array, contentType?: string)
sha256Hex(bytes: Uint8Array): string
buildStoragePath(tenantId, fileId, documentId, ext)
createSignedDownloadUrl(path)   // documents bucket, TTL-bounded
```

The header on `uploadObject` states the reason: *"WES-4G.5 — takes BYTES, not a `File`. The hash
must describe what is actually stored."* **This is precisely the signature a bucket-to-bucket
copy needs.** `uploadDocument` reads the stream once, hashes that buffer, uploads that buffer,
and fails the upload if hashing fails — *"a row that claims an unverified hash is worse than a
row with no hash at all."*

### 1.3 Storage — six buckets, one per bounded context

| Bucket | Public | Owner |
|---|---|---|
| `documents` | no, 25 MB | dossier documents |
| `ec-inbound` | no | EC-1 captured mail + attachments |
| `messaging-attachments` | no, 15 MB | Messaging Center |
| `finance-expense` | no | expense documents |
| `brand-assets` | **yes**, 100 KB | Brand Center |
| HR documents | no | HR |

Deny-by-default writes: there is **no `storage.objects` policy for `authenticated`** on the
private buckets; every write goes through the service role.

### 1.4 Events — the timeline entry is already free

`DOCUMENT_UPLOADED` is emitted by a **database trigger** on `document` INSERT
(`emission: "trigger"`, WES-9/WES-9J). Also present: `DOCUMENT_VERIFIED`, `DOCUMENT_REJECTED`,
`DOCUMENT_SHARED_WITH_CLIENT` (client-safe), `INTERNAL_DOCUMENT_GENERATED`.

**Consequence: an ingested document produces its timeline event by construction.** EMP-4 needs
no emitter, no new event type, and must add none — an application-level emission beside the
trigger would be the double-emission trap.

### 1.5 Evidence, versioning and governance

WES-4 supplies `supersedes_id` / `superseded_by_id` and a `supersede_document` RPC;
`lib/documents/governance.ts` supplies `resolveDocumentGovernance` and `mayVerifyDocument`.
Soft delete only (`deleted_at`). `ec_inbound_attachment` is **immutable** (`prevent_mutation`)
and hash-indexed.

### 1.6 OCR / AI — on demand, keyed by document id

Doc Intelligence (7.4A/7.4B) has `document_intelligence_job` and `document_candidate_field`.
Entry point is `createIntelligenceJob(documentId)` — **human-triggered, per document**, with
extraction producing *suggestions* that a person reviews (`reviewField`, `applyFields`).
An ingested document enters this pipeline through the existing door with **no change at all**.

### 1.7 Permissions, RLS, isolation

`document:create / read / update / approve / delete` all exist. `document` has RLS enabled with
a SELECT policy; writes go through the admin client behind `assertPermission("document:create")`
**plus** `isFileVisible(user, tenant, fileId)`. `enforce_document_tenant` refuses a document
whose tenant differs from its dossier's.

### 1.8 No background infrastructure

There is **no cron, no pg_cron, no job queue and no worker** anywhere in the platform.
Every long-running act is an explicit human action. EMP-4 must not be the first exception.

---

## 2. Reuse analysis

| Capability | Verdict |
|---|---|
| `document` table incl. `content_sha256` | **reuse unchanged** |
| `documents` bucket | **reuse unchanged** |
| `uploadObject` / `sha256Hex` / `buildStoragePath` | **reuse unchanged** — already byte-based |
| `createSignedDownloadUrl` | **reuse unchanged** |
| `DOCUMENT_UPLOADED` trigger | **reuse unchanged** — event is free |
| Versioning + `supersede_document` | **reuse unchanged** |
| Document governance / review lifecycle | **reuse unchanged** |
| Doc Intelligence entry point | **reuse unchanged** |
| `document:*` permissions, RLS, tenant trigger | **reuse unchanged** |
| `ec_inbound_attachment` + `ec-inbound` bucket | **read-only reuse** — never mutated |
| The ingestion act itself | **the only thing to build** |

**Must never be duplicated:** the document model · the attachment model · the storage
abstraction (`lib/documents/storage.ts` is the only door to the `documents` bucket) · the
`DOCUMENT_UPLOADED` emitter · the timeline · the review lifecycle · the OCR pipeline.

---

## 3. Gaps

1. **No ingestion service.** Nothing reads an `ec_inbound_attachment` and writes a `document`.
2. **No provenance link.** `document` has no column naming the attachment it came from. See
   RATIFY-EMP4-1 — this is the only candidate for a migration.
3. **No UI affordance.** The triage detail page lists attachments with signed URLs but offers
   no "attach to dossier" action.
4. **No dedup rule.** Nothing decides what happens when the same attachment is ingested twice,
   or when its bytes already exist as a document on that dossier.
5. **`document.type_code` is NOT NULL** and references `document_type`. An email attachment has
   no inherent type, so ingestion must require the operator to choose one — it cannot be
   inferred without guessing.

---

## 4. Risks and architectural violations to avoid

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Duplicate storage abstraction** | A second upload path to `documents` would bypass the hash-with-the-bytes discipline | Ingestion must call `uploadObject`, never `supabase.storage` directly |
| **Duplicate events** | `DOCUMENT_UPLOADED` fires on INSERT; an app-level emit would double it | Insert the row and let the trigger speak |
| **Mutating evidence** | `ec_inbound_attachment` is immutable by trigger | Read only; never mark an attachment "ingested" in place |
| **Referencing instead of copying** | Pointing `document.storage_path` at an `ec-inbound` object would make `createSignedDownloadUrl` (documents-bucket-bound) fail, and would put the document lifecycle — supersede, soft delete — on top of immutable capture evidence | **Copy the bytes.** See RATIFY-EMP4-2 |
| **Auto-promotion** | EC-2 deliberately creates nothing automatically | Ingestion must be an explicit human act |
| **Ingesting into an unreadable dossier** | `document:create` alone is not enough | Reuse `isFileVisible`, exactly as `uploadDocument` does |
| **A background job** | The platform has none | Ingest synchronously in the user's action |

### The EC-2 guard, read precisely

`tests/ec-2-triage.test.ts` asserts *"attachments are never auto-promoted into
public.document"* — scoped to `code(ACTIONS) + code(STUDIO) + code(MIG)`, i.e. **EC-2's own
files**. A new EMP-4 module does not violate it, **provided ingestion is not placed inside the
triage actions or studio.** That is a genuine architectural constraint discovered by the guard,
and it should be preserved rather than re-scoped.

### Is a second hash a duplicate?

No. `ec_inbound_attachment.sha256` describes an object in `ec-inbound`; `document.content_sha256`
would describe an object in `documents`. Same value, **different stored subjects**. Two rows
each honestly hashing their own bytes is not duplication — it is what makes the copy verifiable.

---

## 5. Can EMP-4 avoid every forbidden duplication?

| Forbidden | Avoidable? |
|---|---|
| A second document model | **Yes** — write `public.document` |
| A second attachment model | **Yes** — read `ec_inbound_attachment`, add nothing |
| A second storage abstraction | **Yes** — `uploadObject` already takes bytes |
| Duplicate events | **Yes** — the trigger already emits |
| Duplicate timelines | **Yes** — no timeline is involved |
| Duplicate evidence records | **Yes, with a caveat** — the bytes exist twice, in two buckets, by design (§4). The *records* are not duplicated: one is captured mail, the other is a dossier document |

---

## 6. Required ratifications

| Ref | Decision | Recommended default |
|---|---|---|
| **RATIFY-EMP4-1** | **Provenance: pointer or content?** (a) add `document.source_attachment_id` — one additive nullable column + index, **the only migration EMP-4 would need**; (b) no column, rely on matching `content_sha256` between the two tables. | **(a).** (b) is free but cannot distinguish two identical attachments from different messages, and provenance is the point of ingestion. A nullable FK is additive, validates trivially (all existing rows NULL) and adds no RLS surface. |
| **RATIFY-EMP4-2** | **Copy the bytes, or reference them?** | **Copy.** Referencing would break signed downloads and place the mutable document lifecycle on immutable capture evidence. |
| **RATIFY-EMP4-3** | **Who may ingest?** | `communication:inbound:read` (see the attachment) **AND** `document:create` **AND** `isFileVisible` on the target dossier. **No new permission.** ⚠ See §7 — no role holds the pair today. |
| **RATIFY-EMP4-4** | **Document type** — required at ingestion, or a default? | **Required.** `type_code` is NOT NULL and an email attachment has no inherent type; a default would be a guess recorded as fact. |
| **RATIFY-EMP4-5** | **Re-ingesting the same attachment** — block, or allow a second document? | **Block by default** when a non-deleted document with the same `content_sha256` exists on that dossier, and say why. Never silently create a duplicate. |
| **RATIFY-EMP4-6** | **Does ingestion auto-start OCR?** | **No.** Doc Intelligence is human-triggered per document; auto-starting would be the platform's first background job. |
| **RATIFY-EMP4-7** | **Initial status** — `UPLOADED` or `PENDING_REVIEW`? | **`UPLOADED`**, identical to a manual upload. Ingestion is a transfer, not a review. |
| **RATIFY-EMP4-8** | **Customer visibility** | **None.** `shared_with_client` stays false; sharing remains a separate, explicit act. |

---

## 7. STOP conditions — assessed

**No STOP is triggered by the proposed design.** Specifically:

* **No new security boundary.** Ingestion composes two authorities that already exist; it needs
  no new permission, no new RLS policy, and no new bucket.
* **No RLS assumption changes.** `document` keeps SELECT-only RLS with admin-client writes;
  `ec_inbound_attachment` stays read-only and immutable.
* **The one possible migration** (RATIFY-EMP4-1a) is a nullable FK column plus an index — no
  policy, no permission, no constraint that narrows.

**But one governance blocker stands, and it is not EMP-4's to clear:**

> **`communication:inbound:read` is granted to NO role** — it appears **zero times** in
> `lib/platform/role-templates.ts`. The entire EC inbound workspace is dark pending
> **RATIFY-EC1-1**. Until that is answered, no user can read an attachment, so **no user could
> perform ingestion even if it shipped.**

EMP-4 can be *built* dark, exactly as EC-1/EC-2/EMP-1/EMP-2 were. It cannot be *used*.

---

## 8. Recommended roadmap

**EMP-4 as a single phase**, small because the platform already did the work:

1. `lib/ec/ingest/` — one service: authorize → resolve the attachment (tenant-scoped) →
   verify dossier visibility → download from `ec-inbound` → `sha256Hex` the buffer → dedup check
   → `uploadObject` the same buffer → insert `document` → audit. The trigger emits.
2. A "Rattacher au dossier" action on the triage detail page — **in a new module**, not inside
   EC-2's actions, preserving the guard in §4.
3. Migration 88 **only if** RATIFY-EMP4-1a is chosen: one nullable column + index.
4. Tests: no second model/abstraction/emitter; bytes hashed once and stored once; hash matches
   the source attachment; dedup blocks; inbound attachment unmutated; no auto-OCR; no auto-share;
   authority pair enforced; cross-tenant refused.

**Not in EMP-4:** OCR automation, auto-classification, customer visibility, bulk ingestion,
outbound attachment ingestion (EMP-3 already carries references and needs nothing here).

---

## 9. Verdict

**GO for EMP-4**, with the ratifications in §6 answered first.

Justification: every primitive exists and one of them (`uploadObject`) was explicitly designed
for this shape; the timeline event comes free from an existing trigger; no new permission, RLS
policy, bucket, model or abstraction is required; and the largest possible schema change is a
single nullable FK. The phase is genuinely small.

The qualification is governance, not engineering: **EMP-4 ships dark and stays unusable until
RATIFY-EC1-1 grants `communication:inbound:read` to a role.** That is worth knowing before the
work is scheduled, not after.

*No code, SQL or migration was written by this audit. EMP-4 implementation has not begun.*
