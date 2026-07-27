# WES-4G / WES-4H — Generated Artifacts, Upload Integrity & Sharing

**Date:** 2026-07-27 · **Migration:** `20260727000004_generated_artifacts` (66th)
**Closes:** the three gaps WES-4 left open. **WES-4 is now complete.**

---

## 1. Feasibility matrix (WES-4G.1)

| Artifact | Verdict | Why |
|---|---|---|
| **Demande de transport** | `GENERATABLE_NOW` | Did not exist **anywhere** — no document type, no record, no code path. Every input it needs already did. |
| **Ordre de transport** | `GENERATABLE_NOW` | Same sources plus the transport assignment. |
| Feuille de mission | `DEPENDENT_ON_WES_6_MISSION_MODEL` | A mission sheet describes a MISSION. No mission entity exists; a transport record is not one. Generating it would define the mission model by accident. |
| Bon de dispatch | `BLOCKED_BY_MISSING_STRUCTURED_DATA` | `readyForDispatch` is a derived **count** over transport statuses, not a dispatch decision with an author, a time and a recipient. |
| Manifeste interne | `BLOCKED_BY_MISSING_STRUCTURED_DATA` | A manifest enumerates line items. The platform stores one free-text `cargo_type` and no line-item model. |

---

## 2. Required source fields

Mandatory fields **refuse** generation when absent; the operator sees exactly which.

| Field | Source | Demande | Ordre |
|---|---|:-:|:-:|
| `fileNumber` | `operational_file.file_number` | ✅ | ✅ |
| `clientName` | `client.name` | ✅ | ✅ |
| `pickupLocation` | `transport_record.pickup_location` | ✅ | ✅ |
| `deliveryLocation` | `transport_record.delivery_location` | ✅ | ✅ |
| `pickupPlanned` | `transport_record.pickup_planned` | ✅ | ✅ |
| `driverName` | `transport_record.driver_name` | — | ✅ |
| `vehiclePlate` | `transport_record.vehicle_plate` | — | ✅ |

Optional: `fileType`, `transportMode`, `origin`, `destination`, `cargoType`, `containerRef`,
`deliveryPlanned`, `trailerOrContainer`, `transportCompany`, `requestedBy`, `requestedAt`.

**A Demande deliberately needs no driver.** A transport *request* precedes the assignment;
requiring a driver would make the artifact impossible exactly when it is needed.

**Never invented.** A PDF with an empty driver line does not read as incomplete — it reads
as an order with no driver, which is a claim the data does not support.

**Driver provenance is printed, not hidden.** `AUTHENTICATED_DRIVER` when a driver user is
linked; `LEGACY_TEXT_DRIVER` otherwise, and the document says so on the page. WES-4G.4
allowed either labelling or refusing; refusing would block real work on dossiers whose
driver predates authenticated assignment.

**Excluded from the snapshot:** `driverUserId` (identity, not content), operational notes,
phone numbers, and anything not needed to reproduce or explain the artifact.

---

## 3. Reproducibility (WES-4G.6)

> same snapshot + same `RENDERER_VERSION` ⇒ **byte-identical PDF** ⇒ same hash

The renderer takes **no clock and no random source**. There is no "generated at 14:32"
line, no document id in the footer, no creation date in the PDF trailer — `generated_at`
and the actor live on the database row, where they can be read without reopening a file.
A test renders the same snapshot twice and compares hashes; without it, "reproducible"
would be a claim nobody checks.

The snapshot is canonicalized (keys sorted) before hashing, so two callers that assembled
the same facts in a different order hash identically.

---

## 4. Regeneration and supersession

Regeneration **creates a new version**. It never mutates the prior one.

```
v1  content_sha256=A  status=SUPERSEDED  superseded_by_id=v2
v2  content_sha256=B  status=VERIFIED    supersedes_id=v1     <- current
```

Both directions are written, in one transaction, and the previous version keeps its own
bytes and hash. A generated artifact is `VERIFIED` on creation: the platform authored it
from its own records, so there is no external claim to verify.

**Manual replacement is impossible**, at three layers: the type is absent from the upload
catalogue, the upload action refuses a generatable type, and a database trigger rejects any
upload that tries to supersede a generated artifact. Corrections happen on the structured
record, then by regeneration.

---

## 5. Storage / database failure model (WES-4G.10)

Object storage cannot join a PostgreSQL transaction, so the ordering **is** the design:

1. render + hash in memory
2. `PUT` the object — at this moment nothing references it; it is a blob, not an artifact
3. **finalize atomically** — row + supersession + business event in ONE transaction

**An artifact becomes authoritative at step 3, never before.**

| Failure | Result |
|---|---|
| storage fails | nothing written anywhere |
| storage succeeds, finalization fails | object orphaned; caller deletes best-effort. **No row, no event, no artifact.** Re-running writes a new key and succeeds. |
| the event fails | the whole finalization rolls back (WES-9A Model A) — same as above |
| finalization succeeds, object missing | the row points at nothing and download fails loudly. This is why the object is written **first**: the ordering makes the survivable failure the one that actually happens. |

Orphans are detectable — an object under `<tenant>/<file>/<uuid>` with no `document` row of
that id. **No sweeper ships**: a deletion job against a storage bucket is exactly the kind
of destructive automation this programme keeps refusing to add without a ratified retention
policy.

---

## 6. Upload hashing contract (WES-4G.5)

```
receive bytes -> read stream ONCE -> sha256 -> store THAT buffer -> insert row with hash
```

The signature change to `uploadObject` caught **four** document-creating paths, not one:
the main upload, deposit proof, driver POD and portal self-service. All four now hash.

- The hash describes the **stored bytes** — never the filename, the metadata, or anything
  the browser claims. Any client-supplied checksum is ignored.
- **Hashing failure fails the upload.** A row claiming an unverified hash is worse than a
  row with no hash, because the next reader trusts it.
- Storage failure creates no row; a row-insert failure removes the object.
- **Legacy nulls stay null.** No hash is fabricated for rows whose bytes were never read.

Duplicate hashes are not deduplicated: the same bytes may legitimately appear in different
dossiers, under different types, or as a resubmission.

---

## 7. Client sharing (WES-4G.8)

`isShareable` is now enforced **server-side**. A version may be shared only when all hold:

| Condition | Rejected as |
|---|---|
| the type is client-safe | `not_client_safe` |
| not superseded | `superseded` |
| verified (or the legacy `APPROVED` alias) | `not_verified` |
| the actor can see the dossier | `forbidden` |

**Never shareable:** `BAE`, `CUSTOMS_DECLARATION`, and every generated internal artifact.

**Revocation is unconditional.** A document that should never have been shared must always
be retractable; re-checking shareability on the way out would strand exactly the wrong ones.

> This also fixed a regression WES-4 introduced: the check was `status !== "APPROVED"`, so
> after the rename to `VERIFIED` a properly verified document could no longer be shared.

---

## 8. Legacy provenance (WES-4G.12)

Historical manual uploads of an internal type keep `LEGACY_GENERATION_UNKNOWN` from
migration 65 and gain **no** `artifact_code`. A generator existing now does not make them
its output. They remain downloadable under existing authorization; they are simply not
authoritative generated versions, and nothing relabels them.

---

## 9. Operator runbook

**Generate a transport document**
1. Open the dossier → **Documents générés**.
2. If the panel shows amber, it lists the missing fields. Fill them on the dossier
   (transport panel), then return.
3. **Générer**. The version appears as *courante* with its author, time and engine version.

**Correct a generated document**
Do **not** try to upload a replacement — it is refused. Correct the structured record, then
**Régénérer**. The old version becomes *Remplacée* and stays downloadable.

**Why is Générer disabled?** The source data is incomplete. The listed fields are exactly
what is missing.

**Who may generate?** Holders of `transport:manage` — the authority that plans the
transport leg. `document:create` was deliberately **not** used: it would let anyone who can
attach a file issue an operational order.

---

## 10. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3866 passed / 170 files** (47 in WES-4G, 21 in WES-4H) |
| Production build | compiled |
| SQL/RLS suites | **53** wired in CI |
| Migrations | 66 |
| Seed | unchanged |

---

## 11. Known limitations

1. **Authorization uses an existing permission, not a policy seat.** The WES-7 schema has no
   `generator` seat, and inventing one would be an unratified policy concept. `transport:manage`
   is the narrowest existing authority that fits; a seat binding belongs to a policy phase.
2. **Mission Sheet, Dispatch Order and Internal Manifest are not generated** — see §1. Two
   are blocked on missing structured data, one on WES-6.
3. **No orphan sweeper** — orphaned storage objects are detectable but not collected (§5).
4. **The stage-aware evidence resolver is still not wired into the projection.** Deferred to
   WES-5; the POD defect remains a documented reconciliation item.
5. **`CONSUMED_AS_EVIDENCE` is still unset by anything** — it belongs with WES-5.
6. **Regeneration is manual.** Nothing detects that the structured source changed and a
   generated artifact is now stale, even though `source_sha256` makes that comparison
   possible. A staleness indicator is a small follow-up, not built here.
