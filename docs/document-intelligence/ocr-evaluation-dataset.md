# OCR Evaluation Dataset & Metrics Plan

**Phase 7.4C-0.** Defines a **safe** evaluation dataset and **measurable acceptance thresholds** so that
any provider's real accuracy on Effitrans documents can be measured **before** approval — never assumed
from vendor benchmarks. **No dataset is collected or committed in this phase**; this is the plan.

## Safety & governance rules (hard constraints)

- **No uncontrolled customer PII.** The evaluation set contains only:
  1. **Synthetic** documents generated from templates with fabricated parties/values, or
  2. **Public-domain / sample** documents (e.g. carrier blank-form specimens, public customs form templates), or
  3. **Explicitly approved** Effitrans documents that have been **redacted/anonymized** (client names,
     tax IDs, personal names, signatures removed) under a documented approval.
- **No production secrets** in any sample or fixture.
- **Do NOT commit sensitive documents to Git.** The repository holds only: the metrics harness (later
  phase), the ground-truth schema, and **aggregate** results — never document images/text.
- **Secure storage:** evaluation documents live in a **private, access-controlled** store (a dedicated
  private Supabase Storage bucket or an access-logged private object store), **separate** from the
  production `documents` bucket, encrypted at rest, with access limited to the evaluation operator(s).
- **Provider transmission during evaluation** is itself document transmission to a third party — it may
  only occur **after** that provider's sandbox terms + DPA are accepted, using **synthetic/anonymized**
  documents, ideally in a **sandbox/free tier** with **training disabled** (Mistral: never Free mode).
- **Retention:** delete evaluation documents from any provider after scoring (using each provider's
  deletion mechanism documented in [ocr-security-review.md](./ocr-security-review.md)).

## Composition

Target the eight supported classes, three language conditions, and multiple quality tiers.

**Classes** (balanced): Bill of Lading · Air Waybill · Commercial Invoice · Packing List · Certificate of
Origin · Customs Declaration · Arrival Notice · Delivery Order.

**Languages:** French · English · bilingual FR/EN.

**Quality tiers per class** (so accuracy can be reported *by* quality, not just in aggregate):
- **T1 clean** — high-DPI digital scan (≥300 DPI), straight.
- **T2 typical** — office scan/photo, ~200 DPI, minor skew, a stamp.
- **T3 degraded** — low-DPI (~150 DPI) or phone photo, rotation, glare, faint stamp, partial fold.

**Document characteristics to include** (per the brief): scanned PDFs, image-only PDFs, multi-page PDFs,
PNG, JPEG, tables, stamps, low-quality scans, rotated pages. **Handwriting** is included only as a small,
**separately-scored** subset — it is **excluded from the MVP pass/fail score** (not required for MVP).

### Recommended size

| Unit | Target |
|------|--------|
| Documents per class | **20–30** where feasible (≥ ~8 per language condition per class) |
| Total documents | ~180–240 |
| **Total pages** | **≥ 150–200** for the pilot |
| Quality mix per class | ~40% T1, ~40% T2, ~20% T3 |
| Handwriting subset (separate) | ~10–15 pages, scored but excluded from MVP threshold |

## Ground truth

Each document has a **known-good** record, authored by a human, stored as structured JSON alongside a
document id (never in Git for real docs):
- **Full page text** per page (for CER/WER), page order.
- **Field ground truth** for the class's schema fields (the platform's existing schemas), with the four
  apply-target fields (`bl_number`, `booking_reference`, `mawb`, `hawb`) always labelled where present.
- **Table ground truth** (row/column cell values) for documents with tables.
- **Language label** and **quality tier**.
- **Expected `OCR_REQUIRED`** flag for the image-only subset that has no text layer (to confirm the
  searchable-vs-scanned gate still routes correctly, and that OCR is only invoked for scanned inputs).

## Metrics

Measured **per provider**, and broken down **by document class, language, scan quality, and page count**
(not only in aggregate). Do **not** rely on vendor benchmark claims.

| Metric | Definition | Why |
|--------|------------|-----|
| **CER** | Character error rate vs ground-truth page text | Raw OCR fidelity |
| **WER** | Word error rate | Word-level fidelity (esp. references) |
| **Field recall** | fraction of ground-truth fields the pipeline surfaces | Coverage |
| **Field precision** | fraction of surfaced fields that are correct | Noise/false positives |
| **Exact-match rate** | fields matching ground truth exactly (normalized) | Straight-through candidates |
| **Page-order preservation** | pages returned in source order | Provenance integrity |
| **Table extraction quality** | cell-level accuracy / TEDS-style score on table docs | Line-item usefulness |
| **Processing latency** | wall-clock per page and per document | Ops feasibility |
| **Failure rate** | % documents returning an error/empty | Reliability |
| **Cost per page** | measured billed pages × price (see [ocr-cost-model.md](./ocr-cost-model.md)) | Economics |
| **Confidence calibration** | correlation of provider confidence with correctness | Can confidence gate review? |
| **% requiring human correction** | fields a reviewer had to edit/reject | The real operational cost |

**Confidence calibration** is emphasized because the platform gates review on confidence
("suggestions, not authority"). A provider whose confidence does not track correctness (flagged as a risk
for Mistral) cannot drive automatic batch-approval regardless of raw accuracy.

## Acceptance thresholds (MVP pilot gate)

A provider is **accuracy-acceptable for pilot** only if, on the **T1+T2** (clean+typical) French **and**
English subsets, it meets **all** of:

| Threshold | Target |
|-----------|--------|
| CER (T1+T2, FR and EN) | **≤ 5%** |
| Field recall (four apply-target fields) | **≥ 90%** |
| Field precision (four apply-target fields) | **≥ 95%** |
| Exact-match on apply-target fields | **≥ 80%** |
| Page-order preservation | **100%** |
| Failure rate | **≤ 2%** |
| Confidence calibration | monotonic — higher confidence ⇒ higher correctness (usable as a gate) |

- **T3 (degraded)** documents are reported but **not** required to meet the same bar — they are expected to
  route to human review; the goal is that low confidence *correctly* flags them.
- **Tables** and **handwriting** are reported separately and are **not** MVP blockers.
- These thresholds are **targets to validate**, not vendor claims. If no approved provider meets them on
  the eval, the honest outcome is to **not** enable OCR (stay on searchable-PDF + manual) until one does.

## Execution outline (for the later implementation phase — not now)

1. Assemble the safe dataset in the private evaluation store (synthetic/anonymized only).
2. Author ground truth JSON.
3. For each candidate with accepted sandbox terms: run OCR (training disabled), capture normalized page
   results, score all metrics, delete documents from the provider.
4. Produce a per-provider scorecard broken down by class/language/quality/pages.
5. Feed results into the final approval condition in [phase-7.4c0-decision.md](./phase-7.4c0-decision.md).
