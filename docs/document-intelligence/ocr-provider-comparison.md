# OCR Provider Comparison

**Phase 7.4C-0.** Evaluation only — **no OCR is implemented in this phase**. This document compares
credible OCR / document-intelligence providers against the 30 evaluation criteria, using **official
vendor documentation only** (all sources retrieved **2026-07-16** via live fetch). Where a fact is
not stated in an official source it is marked **UNVERIFIED — must confirm**; it is not fabricated.

Context: Effitrans is a **Senegal-based** French/English logistics SaaS processing **customs and
commercial documents**, deployed on **Vercel serverless** with **no separate worker infrastructure
today**. Only OCR / page-text extraction is in scope for the MVP — **not** LLM field extraction.

## Candidates

| Code | Provider | Category |
|------|----------|----------|
| **AZURE** | Azure AI Document Intelligence (`prebuilt-read` / `prebuilt-layout`, v4.0) | Cloud document-intelligence |
| **GCP** | Google Cloud Document AI — Enterprise Document OCR | Cloud document-intelligence |
| **AWS** | AWS Textract (`DetectDocumentText` / `AnalyzeDocument`) | Cloud OCR |
| **MISTRAL** | Mistral OCR 4 (`mistral-ocr-latest`, `/v1/ocr`) | Cloud (EU) document OCR |
| **SELFHOST** | Tesseract / PaddleOCR (self-hosted) | Local open-source OCR |

## Privacy, residency, retention, contracts (criteria 1–7, 28–29)

| Criterion | AZURE | GCP | AWS | MISTRAL | SELFHOST |
|-----------|-------|-----|-----|---------|----------|
| 1. Data privacy default | Region-pinned, encrypted, isolated, temp-stored | Sync **not persisted to disk** | **Opt-IN** to service-improvement storage | EU-hosted; plan-dependent | Data never leaves your infra |
| 2. Data residency | Region-pinned; **S. Africa North** or France Central | US/EU multi-region; **no Africa** | 14+ regions; **no Africa** (`af-south-1` absent) | **EU by default**; US opt-in | Wherever you host (could be Senegal) |
| 3. Retention | 24 h auto-purge + Delete API | Sync in-memory; batch ≤1-day TTL | "provide/maintain" storage, **duration UNVERIFIED** | 30-day default; **ZDR** on stateless `/v1/ocr` (Scale) | You configure (can persist nothing) |
| 4. Model-training policy | No-training via **DPA** (not on DI page) | **"never use customer data to train our Document AI models"** | Trains by default; **must opt-out** via Organizations | Non-training on **Scale**; trains on **Free** | N/A (no vendor) |
| 5. DPA availability | Microsoft Products & Services DPA (aka.ms/DPA) | Cloud Data Processing Addendum | GDPR DPA auto-in Service Terms | Public DPA (2026-03-12) | N/A |
| 6. Subprocessors | Service Trust Portal | Org-wide list (not per-processor) | Public list, 30-day notice | Trust Center, 10-day objection | N/A |
| 7. Encryption | TLS 1.3; AES-256 at rest; CMK optional | In-flight + ephemeral-key at rest | TLS 1.2+; at rest in-region; CMK at S3 | AES-256; TLS 1.2+ | Your responsibility |
| 28. Disable training | Yes (DPA) | Default (no training) | Yes (Organizations opt-out) | Yes (toggle + Scale + no Labs) | N/A |
| 29. Delete submitted data | Delete Analyze Result API + 24 h | Sync nothing to delete; you own batch bucket | Via AWS Support; opt-out deletes history | Account/DPA deletion; ZDR | You control |

**Residency headline:** **Azure is the only provider with an African region** (South Africa North /
Johannesburg — on-continent). Google, AWS, and Mistral are **EU-at-best** for a Senegal operation.
Self-hosting could physically reside in Senegal but requires infrastructure that does not exist today.

## OCR quality & capability (criteria 9–14, 16–17, 30)

| Criterion | AZURE | GCP | AWS | MISTRAL | SELFHOST |
|-----------|-------|-----|-----|---------|----------|
| 9. French OCR | FR printed **+ handwriting**; auto-detect; mixed-lang | FR (200+ langs); hints | FR listed but **ASCII caveat**; **handwriting EN-only** | FR explicit (French co); 170 langs | `fra`/`--lang fr`/Latin; quality UNVERIFIED |
| 10. English OCR | High | High | High (Latin-script) | High | High |
| 11. Table extraction | **Layout** (tables/structure) | **Needs Form Parser** (separate) | **AnalyzeDocument** Tables/Forms | markdown/html tables + block boxes | PaddleOCR **PP-Structure** (CN/EN models); Tesseract none |
| 12. Multi-page | Async up to 2,000 pages | Sync ≤15 pp; batch ≤500 pp | **PDF = async + S3**, ≤3,000 pp | 512 MB; per-call page cap UNVERIFIED | Loop per rasterized page |
| 13. PDF support | Native (async) | Native | Async only (multipage) | Native | **Needs rasterizer** (Poppler) |
| 14. PNG/JPEG | Yes (+ BMP/TIFF/HEIF) | Yes (+ TIFF/GIF/WebP/BMP) | Yes | Yes (+ TIFF/BMP/GIF/WebP/AVIF) | Yes (native) |
| 16. Confidence output | Per-word confidence | Per-element confidence | Per-block 0–100 | Page/word (**calibration UNVERIFIED**) | Tesseract word conf; Paddle scores |
| 17. Bounding boxes / provenance | Polygons + page angle | boundingPoly + normalized verts | Geometry (bbox+polygon)+page | Block/image boxes + page dims | hOCR/TSV boxes; Paddle boxes |
| 30. Customs/commercial fit | Designed for scanned docs; rotation via `angle` | Deskew + rotation + 8-D quality score | Rotation to 45°; ≥15 px text floor | Document-understanding model | Capable; preprocessing-sensitive |

## API, limits, ops, integration (criteria 15, 18–27)

| Criterion | AZURE | GCP | AWS | MISTRAL | SELFHOST |
|-----------|-------|-----|-----|---------|----------|
| 15. Page/file limits | 500 MB / 2,000 pp (S0); 4 MB / 2 pp (F0) | Sync 40 MB/15 pp; batch 1 GB/500 pp | Sync 10 MB/1 pp; async 500 MB/3,000 pp | 512 MB file / 20 MB image | Rasterizer/mem bound |
| 18. Sync vs async | **Async only** (POST→202→poll) | **Both** (sync ≤15 pp) | **Both** (PDF forces async + S3/SNS) | **Sync** `/v1/ocr` (+ batch async) | Your service (sync or queued) |
| 19. Rate limits | 15 TPS default (S0), adjustable | ~120 pp/min; adjustable | **EU as low as 1–5 TPS**; adjustable | Workspace-scoped; **OCR-specific UNVERIFIED** | Your capacity |
| 20. Timeout/retry | `retry-after` header; backoff | Client gRPC deadlines/backoff | SDK retry; result TTL UNVERIFIED | SDK retries; SLAs UNVERIFIED | You build |
| 21. Pricing (per 1,000 pp) | Read ~$1.50 / Layout ~$10 (**exact UNVERIFIED**) | **$1.50** (>5M: $0.60); add-ons $6 | Detect **$1.50**; Tables **$15**; Forms $50 | **$4** ($2 batch); annot. $5 | Fixed infra (no per-page) |
| 22. Sandbox | F0 free tier + Studio UI | $300 90-day trial (no perpetual free) | 3-month free (1,000 pp/mo Detect) | Free mode (**trains data**) | Local |
| 23. Node without SDK | Yes (`Ocp-Apim-Subscription-Key`) | Yes (OAuth bearer) | Yes (SigV4 signed) | Yes (`Bearer` API key) | N/A (server-side) |
| 24. Vendor lock-in | Moderate (JSON schema) | Moderate (thin interface) | **Higher** (S3/SNS/IAM coupling) | Low (REST + markdown/JSON) | None (portable) |
| 25. Self-hosting | No | No | No | No | **Yes** (needs worker tier) |
| 26. Operational support | Enterprise + Trust Center | Enterprise + CDPA | Enterprise + Artifact | SOC 2 II / ISO 27001/27701 | **Self-built** |
| 27. Auditability | Result IDs; compliance certs | Response provenance; certs | Confidence/geometry; certs | Trust Center | **Self-built** |

## Cross-cutting observations

- **Africa residency** eliminates a hard requirement for GCP/AWS/Mistral (EU-only) if in-continent
  processing is mandated — **only Azure offers it** (South Africa North). Confirm Document Intelligence
  is offered in that region on the official products-by-region page before relying on it.
- **Vercel fit**: AWS is the worst structural fit (multipage PDF *requires* S3 + SNS/SQS + IAM);
  self-hosting does not fit Vercel at all (needs a container/VM worker tier). Azure's async
  submit-and-poll maps cleanly onto the platform's **existing `document_intelligence_job` lifecycle**;
  Mistral's synchronous single call is the simplest integration.
- **Training default**: AWS is opt-IN (must run an Organizations opt-out); GCP and Mistral-Scale and
  Azure-via-DPA are stronger.
- **French handwriting**: Azure supports it; AWS is English-only for handwriting.
- **Tables**: available natively on Azure (Layout), AWS (AnalyzeDocument), Mistral, and PaddleOCR;
  Google requires a **separate Form Parser** (extra cost).
- **Confidence for a "suggestions, not authority" gate**: all cloud providers expose confidence +
  bounding boxes; **Mistral's confidence is not documented as calibrated** (validate empirically).
- **No accuracy has been measured.** Every "French/English OCR quality" cell reflects *documented
  language support*, not measured accuracy on Effitrans documents. Accuracy is resolved by the
  evaluation in [ocr-evaluation-dataset.md](./ocr-evaluation-dataset.md), not by vendor claims.

## Primary official sources (retrieved 2026-07-16)

- **Azure:** learn.microsoft.com/azure/ai-services/document-intelligence/ (read, layout, service-limits,
  language-support, encrypt-data-at-rest, authentication); legal/cognitive-services/document-intelligence/data-privacy-security;
  microsoft.com/licensing (DPA); servicetrust.microsoft.com.
- **Google:** docs.cloud.google.com/document-ai (enterprise-document-ocr, security, regions, limits,
  handle-response, quotas); cloud.google.com/document-ai/pricing; cloud.google.com/terms/data-processing-addendum;
  cloud.google.com/terms/service-terms.
- **AWS:** docs.aws.amazon.com/textract (data-protection, limits-document, async, APIReference);
  aws.amazon.com/textract/{faqs,pricing}; docs.aws.amazon.com/general/latest/gr/textract.html;
  docs.aws.amazon.com/organizations/.../orgs_manage_policies_ai-opt-out.html; aws.amazon.com/compliance/sub-processors/.
- **Mistral:** docs.mistral.ai (api/endpoint/ocr, studio-api/document-processing, resources/languages,
  resources/known-limitations, admin/monitor-comply/privacy-data-controls); mistral.ai/pricing/api;
  legal.mistral.ai/terms/{data-processing-addendum,privacy-policy}; help.mistral.ai; trust.mistral.ai.
- **Self-hosted:** github.com/tesseract-ocr/tesseract; tesseract-ocr.github.io/tessdoc;
  github.com/PaddlePaddle/PaddleOCR (+ ppstructure/table, PP-OCRv5 docs); vercel.com/docs/functions/limitations.
