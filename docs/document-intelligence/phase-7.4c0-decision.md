# Phase 7.4C-0 — OCR Provider Decision

**Evaluation-only phase. No OCR was implemented; no production behavior changed.** This document records
the approval decision, grounded in the official-source evaluation in
[ocr-provider-comparison.md](./ocr-provider-comparison.md),
[ocr-security-review.md](./ocr-security-review.md), and the plans for
[dataset](./ocr-evaluation-dataset.md), [cost](./ocr-cost-model.md), and
[integration](./ocr-integration-plan.md). All provider facts were retrieved from official documentation on
**2026-07-16**.

## Decision status

> ## CONDITIONALLY APPROVED
> **Primary provider: Azure AI Document Intelligence** (`prebuilt-read` + `prebuilt-layout`, v4.0).
> **Approved fallback / runner-up: Mistral OCR** (EU, synchronous).

Approval is **conditional** because (a) **no accuracy evaluation has been run yet** — this phase only
*planned* the dataset and thresholds — and (b) contractual/residency/pricing items remain to be confirmed.
A provider may not be declared "APPROVED FOR PILOT" before its evaluation passes and its DPA is signed.

## Providers evaluated

| Provider | Outcome | One-line reason |
|----------|---------|-----------------|
| **Azure AI Document Intelligence** | **CONDITIONALLY APPROVED (primary)** | Only vendor with an **African region**; mature DPA/deletion; tables + confidence + polygons; FR/EN incl. handwriting; async model fits existing job lifecycle |
| **Mistral OCR** | **CONDITIONALLY APPROVED (fallback)** | EU-by-default + ZDR + public DPA; **synchronous** (best Vercel fit); FR-native; confidence + boxes + tables. Caveats: neural, uncalibrated confidence, no Africa region |
| **Google Document AI** | **Not selected (viable EU alternative)** | Strong no-training + privacy, but **no Africa region** and tables need a separate Form Parser |
| **AWS Textract** | **NOT APPROVED for MVP** | **Opt-IN training default**, no Africa region, French ASCII caveat + EN-only handwriting, mandatory **S3/SNS async** coupling (worst Vercel fit) |
| **Self-hosted (Tesseract/PaddleOCR)** | **NOT APPROVED for MVP** | Best privacy in principle, but **does not fit Vercel**; requires a worker tier that does not exist; all security/ops self-built |

## Rationale

1. **Residency is the decisive differentiator for a Senegalese customs platform.** Azure is the **only**
   candidate offering an **on-continent African region** (South Africa North), plus **France Central**
   (EU/GDPR) with **region-pinned processing**. Google, AWS, and Mistral are EU-at-best.
2. **Contractual/deletion posture is strongest and most mature on Azure**: public DPA, 24-hour auto-purge,
   an on-demand **Delete Analyze Result** API, TLS 1.3, AES-256 (optional customer-managed keys).
3. **Capability fit**: Azure Layout returns **tables + per-word confidence + bounding polygons** and
   supports **FR/EN printed and handwritten** with automatic mixed-language detection — everything the
   confidence-gated review model needs.
4. **Architecture fit**: Azure's submit-and-poll async model maps cleanly onto the platform's **existing
   `document_intelligence_job` lifecycle** and avoids AWS's S3+SNS+IAM coupling.
5. **Mistral is the pragmatic fallback**: EU residency, ZDR on the stateless `/v1/ocr` endpoint, a
   **synchronous** single-call API (the simplest Vercel integration), FR-native quality, and transparent
   pricing — chosen as fallback because it lacks an African region and its confidence is not documented as
   calibrated.
6. **AWS and self-hosting are rejected for the MVP** on training-default/residency/architecture (AWS) and
   Vercel-incompatibility/ops-burden (self-hosting) grounds.

## Unresolved contractual issues (must close before implementation)

- **Azure no-training commitment** is **not** on the Document-Intelligence data-privacy page; it must be
  secured in the **signed Microsoft Products & Services DPA** (no-training + GDPR processor + breach
  notification).
- **Azure DI region availability** in South Africa North / France Central must be confirmed on the official
  *products-by-region* page before pinning.
- **Azure exact per-page pricing** (Read ~$1.50/1k, Layout ~$10/1k) is **third-party/UNVERIFIED** — confirm
  on the official pricing page.
- **Per-processor subprocessor** detail (Azure/Google publish broader lists) if the security gate requires
  processor-specific granularity.
- **(Fallback Mistral)** training default differs Free vs Scale — pin **Scale + training-off + Labs-off** in
  the DPA; confirm the undocumented OCR rate limits and per-call page cap.

## Required account / subscription

- **Primary:** an **Azure subscription** with a **Document Intelligence (Azure AI services)** resource
  created **in the chosen region**; an **Enterprise Agreement / signed DPA**; billing tier **S0** (F0 free
  tier is limited to the first 2 pages/request and is functional-test only).
- **Fallback:** a **Mistral la Plateforme account on the Scale plan** (never Free for real documents), with
  a **ZDR request approved** for the stateless OCR endpoint.

## Required environment variables (documented only — NOT created this phase; from official docs)

> Scope control: this phase **does not create** any environment variable. These are the variables the
> future 7.4C adapter would require, per official documentation. They are server-side secrets and must
> never reach the client bundle.

**Azure (primary):**
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` — the resource endpoint (region-scoped, e.g. `https://<resource>.cognitiveservices.azure.com/`)
- `AZURE_DOCUMENT_INTELLIGENCE_KEY` — API key (`Ocp-Apim-Subscription-Key`) **or** use Entra ID/managed identity (no key)
- (adapter constants, not secrets) API version `2024-11-30`; model id `prebuilt-read` / `prebuilt-layout`

**Mistral (fallback):**
- `MISTRAL_API_KEY` — Bearer token
- (adapter constants) EU endpoint `https://api.mistral.ai/v1/ocr`; pinned model id (e.g. `mistral-ocr-<version>`, **not** `-latest`)

## Processing region

- **Primary recommendation:** pin to **France Central** (EU/GDPR; likely favourable subsea latency from
  Dakar) **or** **South Africa North** (on-continent residency) — decided by (a) confirmed DI availability
  and (b) whether in-Africa residency is contractually mandated. **Do not deploy multi-region;** pin to one.
- **Fallback (Mistral):** **EU** endpoint only (never the US endpoint); disable any non-EU subprocessor
  feature.

## Retention configuration

- **Azure:** rely on the **24-hour auto-purge** and additionally call the **Delete Analyze Result** API
  immediately after retrieving results; **no custom-model training**; customer-managed keys optional.
- **Mistral:** **Scale plan + Zero Data Retention** on the stateless `/v1/ocr` endpoint; send documents
  **inline (base64/URL)**, not via the Files API; training toggle **off**; **Labs models off**.
- **General:** store only normalized results under existing tenant RLS; delete provider-side copies after
  processing; minimize scanned-document retention.

## Pilot limits

- **Evaluation** uses **synthetic / public-domain / anonymized** documents only — **no uncontrolled PII**,
  no production secrets, nothing sensitive committed to Git (see [dataset plan](./ocr-evaluation-dataset.md)).
- Enable OCR for a **small internal pilot cohort** first (feature-flagged), not all tenants.
- Enforce a **per-tenant monthly page/cost ceiling** and a **kill switch** from day one.
- OCR is invoked **only** for scanned/image-only inputs (`OCR_REQUIRED`); searchable PDFs stay on the free
  local path.

## Cost ceiling

- Enforce a configurable **per-tenant monthly ceiling** via the cost-cap mechanism in the
  [integration plan](./ocr-integration-plan.md). Initial pilot ceiling: **on the order of a few thousand
  pages / low tens of USD per tenant per month** (illustrative — set from business input), beyond which OCR
  disables for that tenant and falls back to manual. Re-derive `monthly_ocr_cost` with the **measured**
  scanned-fraction and pages/document from the evaluation ([cost model](./ocr-cost-model.md)).

## Rollback / disable strategy

- **This phase changes no code or schema, so there is nothing to roll back.**
- For 7.4C: a **kill switch** config flag instantly sets the OCR provider to `not_configured`; the pipeline
  then falls back to the **already-shipped** searchable-PDF + manual path (`OCR_REQUIRED`). Any 7.4C schema
  change is **additive-only** (mirroring 7.4B), so disabling OCR never requires a destructive migration.
- **Provider-health auto-disable** on sustained failure; **manual retry** re-queues a fresh, checksum-
  verified job.

## Approval conditions for implementation (the gate to build Phase 7.4C)

1. **Signed DPA** (no-training + GDPR processor + deletion), with the **region pinned**.
2. **Confirm** DI region availability and **exact per-page pricing** on official pages.
3. **Run the evaluation** on synthetic/anonymized documents and **meet the thresholds** — especially
   **French CER ≤ 5%**, **apply-target field recall ≥ 90% / precision ≥ 95%**, and **usable confidence
   calibration** ([dataset & metrics](./ocr-evaluation-dataset.md)).
4. **Sandbox-validate** confidence, bounding boxes, latency, and the async poll behavior end-to-end.
5. **Design cost caps + kill switch + health monitoring + fallback** before enabling any tenant.

Only when **all five** conditions are met does the status advance from CONDITIONALLY APPROVED to
**APPROVED FOR PILOT**, and Phase 7.4C implementation may begin per the
[integration plan](./ocr-integration-plan.md).

## Scope confirmation (this phase)

No provider SDK added · no environment variable created · no document sent externally · no database schema,
RLS, or permission change · no OCR/LLM implemented · no writable field expanded · review studio unchanged ·
document storage unchanged. Baseline (commit `bce1bd7`) behavior is unchanged; CI remains green.
