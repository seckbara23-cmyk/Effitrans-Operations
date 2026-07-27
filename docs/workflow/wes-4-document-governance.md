# WES-4 — Canonical Document Doctrine & BAE Governance

**Date:** 2026-07-27 · **Migration:** `20260727000003_document_governance` (65th)
**Depends on:** WES-2 (projection) · WES-7 (policy) · WES-9/9A (event ledger) · WES-3/3A (access)

**Scope ratified for this phase: the GOVERNANCE CORE.** Internal document generation and the
operator surface were deferred to WES-4G/4H, which are now **complete** — see
[wes-4g-generated-artifacts.md](wes-4g-generated-artifacts.md). §10 records what each phase
closed.

---

## 1. The seven questions, answered

| Question | Answer |
|---|---|
| **Which documents are uploaded?** | Category A, external evidence: Commercial Invoice, Packing List, Bill of Lading, Air Waybill, Certificate of Origin, Customs Declaration, **BAE**, Delivery Note/POD, Payment Receipt, Other. Effitrans did not author them and cannot regenerate them. |
| **Which are generated?** | Category B, internal artifacts: **Demande de transport** and **Ordre de transport**, generated from structured data since WES-4G. Manual upload of either is refused at three layers. |
| **What stays structured data?** | Category C: driver, vehicle, route, pickup, destination, ETA, GPS, status, **the BAE reference**, operational notes. A PDF of these is a printable representation, never the record. |
| **Who uploads the BAE?** | Whoever the pinned policy binds to the `uploader` seat — the Declarant in the default model. Never hardcoded in a page. |
| **Who verifies it?** | Whoever the policy binds to `verifier`, **and never the person who uploaded it**: the BAE is always maker-checked. `SYSTEM_ADMIN` gains nothing — administering the platform is not a verifier seat. |
| **What does "Libérer" mean?** | It is gone. The action is **"Constater la mainlevée"** — recording a fact Effitrans *observes*. Effitrans does not approve Customs. |
| **What allows Transport preparation?** | Recording the customs release. It still creates the same handoff task it always did; it does **not** complete an official process-engine step (WES-5). |

**What document verification changes:** the version's status, the protected review record,
and one business event. **What it does not change:** the dossier lifecycle stage, the
responsible department, progress, or any process-engine step.

---

## 2. Architecture discovered

| Finding | Consequence |
|---|---|
| **The BAE did not exist as a document.** It was a text string on `customs_record.bae_reference`; `canRelease()` checked only that the string was non-empty. | There was nothing to verify. A `BAE` document type is added; the reference stays as structured data beside it. |
| **`releaseCustoms(id, ref)` did five things in one call** — recorded the reference, set `RELEASED`, stamped `reviewed_by`, fired the Transport handoff, notified the customer. One click, one person, one permission, no maker-checker, no evidence. | Split into `recordBaeReference` and `recordCustomsRelease`. |
| **`TRANSPORT_ORDER` is an uploadable `document_type`** — an internal artifact offered as an upload. | Classified as Category B; generation shipped in WES-4G and the upload path is now closed. |
| **`document` had no content hash, no review record, no reviewer/uploader separation**, and only a backward `supersedes_id`. | Version metadata, `superseded_by_id` and the append-only `document_review` added. |
| **Rejection captured one free-text sentence** via `window.prompt` into `review_note`. | Replaced by a closed reason-code registry plus a protected explanation. |
| **`DELIVERY_NOTE` (POD) is `required_for {IMP,TRP,HND}`** — a POD counts as missing from day one, and `docsVerified = missing===0`, so documentation never verifies until delivery. | The stage-aware resolver fixes this **as a contract**; wiring it into the projection is WES-5 (§3). |

---

## 3. A deliberate boundary

`resolveEvidenceRequirements` is the canonical stage-aware answer, and it is **not wired
into `getDossierLifecycle`**. Rewiring changes `missingRequired` → the WES-2 projection's
`responsibleDepartment` → **WES-3 visibility and the department queue**, silently, for
every existing dossier. Moving people's access as a side effect of a document phase is not
acceptable, and reconciling the two views is WES-5's job.

Two requirement views therefore coexist, and that is recorded rather than hidden: the
legacy `required_for` list still feeds the projection; the new resolver answers *"what is
actually required, now"* for document surfaces. A test asserts the resolver is absent from
both `lifecycle.ts` and `projection.ts`.

---

## 4. Canonical lifecycle (WES-4A)

```
UPLOADED ──> UNDER_REVIEW ──> VERIFIED ──> CONSUMED_AS_EVIDENCE
   │              │              │
   └──> REJECTED ─┘              └──> EXPIRED
            │                             │
            └────────> SUPERSEDED <───────┘
```

`PENDING_REVIEW` and `APPROVED` remain legal as **read-only legacy aliases**. Rows carry
them, and rewriting history to make the new vocabulary look original would be a lie.

Invariants, enforced by trigger rather than convention: bytes and identity are immutable
from upload in every state · a `SUPERSEDED` version cannot be reopened · supersession is
recorded once and never cleared · a rejected version is **replaced**, never verified in
place · a verified version never returns to review, so its meaning is stable forever.

---

## 5. Reason governance (WES-4F) — the WES-9 contradiction, resolved

WES-9 flagged an open conflict: ADR-WES-014 says rejection reasons *are* included because
governance requires them; WES-9 omitted them because an immutable table can never redact
staff-authored prose. **The reference resolves it.**

| Protected `document_review` | Immutable `business_event` |
|---|---|
| structured code, **free-text explanation**, actor, timestamp, uploader, maker-checker flag, policy version | `reason_code`, `has_reason`, `reason_reference_id`, and for overrides `is_override` + `override_reason_code` |

Governance can always reach the explanation; the ledger never holds an uncorrectable
sentence about a colleague's work. The registry is **closed** — 9 rejection codes and 2
override codes, each traceable to a refusal the repository can already produce. Every
override requires an explanation, because an override without a stated reason is
indistinguishable from a mistake.

---

## 6. BAE governance (WES-4D/4E)

| Action | Who | What it means |
|---|---|---|
| **Enregistrer le BAE** | policy `uploader` seat | The reference arrived. **Not** a release, **not** a verification. |
| **Soumettre pour vérification** | uploader | `UPLOADED → UNDER_REVIEW`. |
| **Vérifier le BAE** | policy `verifier` seat, **never the uploader** | The evidence is authentic, complete and consistent with the dossier. |
| **Demander une correction** | verifier | Requires a structured reason code. |
| **Constater la mainlevée** | `customs:release` | Records the official release **fact**. |
| Authorize continuation | — | The existing handoff task, unchanged. **No process-engine step is completed** — WES-5. |

Language is enforced by test: no artifact may say *"BAE approuvé"* or *"Douane approuvée par
Effitrans"*.

---

## 7. Atomicity (WES-9A Model A)

`review_document` writes the status, the protected review record and the business event in
**one transaction**. RPC rather than trigger, for the same reason as WES-3's assignment
RPCs: the reason code, the explanation, the maker-checker context and the policy version
are not derivable from the row.

**A double-emission bug was found and fixed.** The WES-9 trigger emitted `DOCUMENT_VERIFIED`
on `status → APPROVED` and `DOCUMENT_REJECTED` on `status → REJECTED`; the new RPC emits the
same facts with a fuller envelope. Left alone, one rejection would have appended **two**
events. The RPC now owns review transitions; the trigger keeps `DOCUMENT_UPLOADED`, the
insert it alone observes. The rewritten trigger preserves the WES-9A non-swallowing
contract (logs, then re-raises `EF001`).

---

## 8. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3770 passed / 167 files** (61 new) |
| Production build | compiled |
| SQL/RLS suites | **52** wired in CI (was 51) |
| Migrations | 65 |
| Seed idempotency | unchanged |

---

## 9. Legacy honesty (WES-4L)

Existing rows are classified, never repaired into looking compliant:
`LEGACY_VERIFIED` (approved, reviewer known) · `LEGACY_REVIEWER_UNKNOWN` (approved, no
reviewer recorded) · `LEGACY_UNVERIFIED` · `LEGACY_GENERATION_UNKNOWN` (internal artifact
uploaded by hand). **No content hash is computed for old rows** — the bytes are unchanged,
but they were never hashed, and generating one now would claim an integrity check that
never happened. No maker-checker compliance is claimed retroactively.

---

## 10. Known limitations

1. ~~**Internal document generation (WES-4G) is NOT implemented.**~~ **CLOSED by WES-4G/4H**
   (`20260727000004`). `Demande de transport` and `Ordre de transport` are generated from
   structured data; manual upload of either is refused at three layers. See
   [wes-4g-generated-artifacts.md](wes-4g-generated-artifacts.md).
2. ~~**`INTERNAL_DOCUMENT_GENERATED` is not emitted.**~~ **CLOSED** — emitted atomically by
   `finalize_generated_artifact`.
3. **The stage-aware resolver does not drive the projection** (§3). Two requirement views
   coexist until WES-5.
4. **No dedicated BAE panel.** The `BAE` type is uploadable through the ordinary document
   panel; the six separated BAE actions exist in the service layer, but a purpose-built UI
   with those six buttons is not built.
5. **`CONSUMED_AS_EVIDENCE` is reachable but nothing sets it.** Recording evidence
   consumption belongs with WES-5's engine reconciliation.
6. ~~**Content hashes are not computed on upload.**~~ **CLOSED by WES-4G.5** — all four
   document-creating paths hash the stored bytes; hashing failure fails the upload.
7. ~~**Sharing is aligned in the pure layer only.**~~ **CLOSED by WES-4G.8** —
   `setDocumentShared` enforces `isShareable` plus dossier access. This also fixed a
   regression WES-4 introduced, where a `VERIFIED` document could not be shared at all.
