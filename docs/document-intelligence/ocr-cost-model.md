# OCR Cost Model

**Phase 7.4C-0.** Estimates OCR cost per page / document / month at several volumes, with **explicit
assumptions and formulas**. Cloud per-page prices are from **official pricing pages** (retrieved
2026-07-16); where a price could not be loaded from an official page it is marked **UNVERIFIED — confirm
on the official pricing page** and is **not** used as a firm quote. **No pricing is fabricated.**

## Verified per-page prices (OCR / text detection)

| Provider | OCR price / 1,000 pages | Tier / notes | Source status |
|----------|-------------------------|--------------|---------------|
| **Google** Enterprise Document OCR | **$1.50** (≤5M/mo), **$0.60** (>5M/mo) | No perpetual free tier; $300 90-day trial | **Verified** (cloud.google.com/document-ai/pricing) |
| **AWS** Textract DetectDocumentText | **$1.50** (≤1M/mo), **$0.60** (>1M/mo) | Tables **$15**/1k; Forms $50/1k; 3-mo free (1,000 pp/mo) | **Verified** (Oregon/us-east-1); **EU region price must be confirmed** |
| **Mistral** OCR 4 | **$4.00** (sync); **$2.00** (batch −50%) | Annotations (LLM) $5/1k — not used in pilot | **Verified** (mistral.ai/pricing/api) |
| **Azure** Read (OCR) | **~$1.50** | Layout (tables) **~$10** | **UNVERIFIED** — official pricing SPA did not load; figures are third-party, structure (per-page + commitment tiers + free custom training) is verified |
| **Self-host** (Tesseract/PaddleOCR) | **$0 per page** | Fixed infra + engineering instead | Apache-2.0; no per-page fee |

**Table extraction surcharge** (only if structured line-items are needed):
Azure Layout ~$0.010/page (includes OCR) · AWS Tables $0.015/page · Google **Form Parser is a separate
processor** (price not fetched — **VERIFY**) · Mistral returns markdown/HTML tables within the $4/1k OCR
call · PaddleOCR PP-Structure at no per-page fee (self-host).

## Formulas & assumptions

```
pages_per_document        = P            (assumption; customs bundles vary)
documents_per_month       = D
pages_per_month           = P × D
ocr_price_per_page        = p_ocr        (from table; tier-dependent)
table_price_per_page      = p_tbl        (0 if OCR-only)
scanned_fraction          = f_scan       (only scanned/image PDFs hit OCR; searchable PDFs stay local)

billable_pages_per_month  = pages_per_month × f_scan
monthly_ocr_cost          = billable_pages_per_month × (p_ocr + p_tbl)
cost_per_document         = P × f_scan × (p_ocr + p_tbl)
```

**Key assumption — `f_scan`:** the platform already extracts **searchable** PDFs locally for free
(Phase 7.4B). OCR is invoked **only** for scanned / image-only inputs (`OCR_REQUIRED`). So billable OCR
volume is a *fraction* of all documents. Illustrative `f_scan = 0.5` is used below and must be replaced
with the measured scanned-document rate.

**Assumption — `P` (pages/document):** illustrative **3** pages/document for customs/commercial docs.
Replace with the measured average.

## Illustrative monthly OCR cost (OCR-only, `f_scan` applied)

Billable pages = stated volume (already net of searchable PDFs). Prices are per-page from the table.

| Billable pages / month | Google / AWS-Detect / Azure-Read (~$0.0015) | Mistral sync ($0.004) | Mistral batch ($0.002) |
|-----------------------:|--------------------------------------------:|----------------------:|-----------------------:|
| 1,000 | ~$1.50 | $4 | $2 |
| 5,000 | ~$7.50 | $20 | $10 |
| 10,000 | ~$15 | $40 | $20 |
| 50,000 | ~$75 | $200 | $100 |
| 200,000 | ~$300 | $800 | $400 |

**With table extraction** (multiply the table-bearing pages by the surcharge): e.g. AWS Tables at
$0.015/page makes 10,000 table pages ≈ **$150/mo**; Azure Layout at ~$0.010/page ≈ **$100/mo** (includes
OCR); Mistral tables are included in the OCR price. Only apply the surcharge to pages that actually need
structured tables.

**Reading the table:** at realistic MVP volume (a few thousand scanned pages/month), OCR cost is
**single- to low-double-digit dollars/month** for the $1.50/1k providers, and low-tens for Mistral. Cost
is **not** the deciding factor at MVP scale — residency, privacy, accuracy, and Vercel-fit are.

## Additional charges to budget

- **Async job storage** (AWS): multipage PDFs require an **S3 bucket** for input + output (S3 storage +
  request + egress charges) and **SNS/SQS** for completion — small but non-zero, and an added surface.
- **Google batch**: outputs land in a **Cloud Storage bucket you own** (storage + egress).
- **Network egress**: sending document bytes to the provider and retrieving results — normally minor at
  these volumes; confirm per provider.
- **Support plans**: enterprise support tiers (AWS/GCP/Azure) are separate paid add-ons if required.
- **Minimum commitments**: none required for pay-as-you-go on any cloud candidate at pilot scale
  (Azure/GCP offer **commitment tiers** only as a *discount* option at high volume).

## Self-hosted total cost of ownership

Self-hosting trades **per-page fees** for **fixed infrastructure + standing engineering**:

- **Infrastructure:** a 24/7 CPU container/VM sized for peak concurrency (GPU markedly more expensive),
  plus object storage, a queue, and networking — paid whether or not documents flow.
- **Build:** the worker service, PDF rasterization (Poppler/Ghostscript), queueing, retries, result
  storage, confidence-gating.
- **Maintenance/security:** ongoing patching of Tesseract/Leptonica/Poppler/PaddlePaddle (+ CUDA if GPU),
  CVEs, encryption, access control — all Effitrans-owned.
- **Monitoring/on-call:** dashboards, alerting, capacity planning, human on-call.

**Illustrative break-even (infra only, estimate — not a vendor fact):** at a metered OCR price of
$0.0015/page, a standing worker that all-in costs `$C`/month breaks even at `C / 0.0015` pages/month —
e.g. a **$300/month** worker ≈ **200,000 pages/month**. Once one-time build + ongoing engineering +
security-patching + on-call are included, the real break-even is **substantially higher**. **Do not adopt
self-hosting merely to avoid API costs** — at MVP volume the fixed + engineering + security overhead
typically **exceeds** a metered API, and it diverts engineering from the product. Self-hosting is
justified by **hard residency/privacy constraints** or **sustained high volume**, not by cost-cutting.

## Cost takeaway

At MVP scale, **all cloud candidates are cheap** ($1.50/1k providers ≈ tens of dollars/month; Mistral
2–3× that). Cost does not separate the finalists; it only rules **self-hosting out** on economics at MVP
volume. Confirm the **exact Azure per-page price** and the **AWS EU-region price** before any commitment,
and re-derive `monthly_ocr_cost` with the **measured** `f_scan` and `P` from the evaluation.
