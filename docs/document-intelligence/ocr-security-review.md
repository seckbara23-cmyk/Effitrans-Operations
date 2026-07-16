# OCR Security & Privacy Review

**Phase 7.4C-0.** Applies the **Security Gate** to each candidate. A provider **cannot be approved**
unless every gate item is verified from **official documentation or contract terms** — never inferred
from marketing language. Sources are the official pages enumerated in
[ocr-provider-comparison.md](./ocr-provider-comparison.md) (retrieved 2026-07-16).

Legend: **PASS** (officially verified) · **COND** (available but requires explicit configuration/contract
action) · **VERIFY** (not published; must confirm before sign-off) · **N/A**.

## Security gate matrix

| Gate item | AZURE | GCP | AWS | MISTRAL | SELFHOST |
|-----------|:-----:|:---:|:---:|:-------:|:--------:|
| Official API documentation | PASS | PASS | PASS | PASS | PASS |
| Authentication method | PASS (key / Entra ID) | PASS (service account / OAuth) | PASS (IAM / SigV4) | PASS (Bearer key) | N/A (self) |
| HTTPS transport | PASS (TLS 1.3) | PASS | PASS (TLS 1.2+) | PASS (TLS 1.2+) | Self-owned |
| DPA / processing terms | PASS | PASS | PASS | PASS | N/A |
| Retention policy | PASS (24 h + Delete) | PASS (sync not persisted) | **VERIFY** (duration unpublished) | PASS (ZDR on Scale) | Self-owned |
| Model-training policy | COND (via DPA) | PASS (no-training default) | **COND** (opt-IN → must opt-out) | COND (Scale/no-Labs) | N/A |
| Regional processing options | PASS (Africa + EU) | COND (EU pin) | COND (EU pin) | COND (EU default) | Self-owned |
| Deletion behavior | PASS | PASS | COND (Support / opt-out) | PASS | Self-owned |
| Subprocessors | PASS | COND (org-wide only) | PASS | PASS | N/A |
| Incident-response policy | PASS (DPA/Trust Center) | PASS (CDPA §7.2.1) | PASS (DPA) | PASS (SOC 2 II) | Self-built |
| Rate & size limits | PASS | PASS | PASS | **VERIFY** (OCR limits) | Self-owned |
| Safe error vocabulary | PASS | PASS | PASS | PASS | Self-built |
| Sandbox / test environment | PASS (F0 + Studio) | PASS ($300 trial) | PASS (free tier) | COND (Free trains data) | Local |
| Production credential process | PASS | PASS | PASS | PASS | Self-owned |

**No provider fails outright on the contractual gate** — all four cloud vendors publish a DPA, HTTPS,
subprocessors, and incident-response terms. The differences are in **defaults** and **residency**, which
drive the conditions below.

## Provider-specific risk notes

### Azure AI Document Intelligence — lowest residual risk
- **Residency win:** processing is region-pinned and an **African region (South Africa North)** exists,
  plus **France Central** (EU/GDPR). This is the strongest posture for Senegalese customs data.
- **Retention:** 24-hour auto-purge + on-demand permanent **Delete Analyze Result** API — strong deletion story.
- **Risk:** the Document-Intelligence-specific data-privacy page does **not** itself state "not used to
  train"; that commitment lives in the **Microsoft Products & Services DPA**. → **Condition: pin no-training +
  GDPR processor terms in the signed DPA.** Confirm DI is offered in the chosen region on the official
  products-by-region page. Exact per-page pricing was not loadable (third-party figures only).

### Google Document AI — strong privacy, residency gap
- **Privacy win:** explicit official statement — *"we never use customer data to train our Document AI
  models"*; synchronous OCR is **not persisted to disk**.
- **Risk:** **no African region** — best achievable is EU-pinned processing (contractually backed).
  Subprocessor list is **org-wide, not per-processor**. Tables need a **separate Form Parser**.
  → **Condition: written confirmation EU residency satisfies customs data-sovereignty obligations.**

### AWS Textract — weakest default, heaviest coupling
- **Risk (training):** **default is opt-IN** to service-improvement storage, possibly **cross-region**.
  A strict gate **requires** running the **AWS Organizations AI-services opt-out** (which also deletes
  historical improvement content). → hard prerequisite, not optional.
- **Risk (residency):** **no African region**; EU pin only, and only *after* opt-out.
- **Risk (retention):** the "provide/maintain" storage **duration is unpublished** → **VERIFY**.
- **Risk (French):** "Standard English alphabet / ASCII" phrasing + **English-only handwriting**.
- **Risk (architecture):** multipage PDFs **force async + S3 + SNS/SQS + IAM** — a larger data-residency
  and deletion surface than a stateless OCR call, and EU TPS as low as 1–5.

### Mistral OCR — strong EU posture, calibration & maturity caveats
- **Privacy win:** **EU by default**, **Zero Data Retention** on the stateless `/v1/ocr` endpoint (Scale
  plan), public DPA (2026-03-12), SOC 2 Type II / ISO 27001/27701, French-native.
- **Risk (plan):** training is **not disabled on the Free plan** — real customer documents must **never**
  go through Free mode; use **Scale** with the training toggle off and **Labs models disabled**
  (Labs can train regardless of opt-out).
- **Risk (LLM boundary):** the `*_annotation_*` / Document-QnA parameters are an **LLM-backed** path
  (`mistral-small-2603`). The pilot must call `/v1/ocr` with `include_blocks=true` +
  `confidence_scores_granularity` and **never** pass annotation params — otherwise it violates the
  "no OCR+LLM in the first pilot" rule.
- **Risk (confidence):** exposed but **not documented as calibrated** → validate empirically.
- **Risk:** OCR-specific rate limits and per-call page cap are **unpublished** → **VERIFY**.

### Self-hosted (Tesseract / PaddleOCR) — privacy ceiling, ops floor
- **Privacy win:** data never leaves Effitrans infrastructure — the strongest possible residency (could be
  Senegal-hosted).
- **Risk:** shifts **all** security responsibility to Effitrans (patching Tesseract/Leptonica/Poppler/
  PaddlePaddle/CUDA, encryption, access control, key management, secure deletion, monitoring, incident
  response). None of SOC 2 / ISO / DPA exists — you *are* the processor.
- **Blocker:** does not fit Vercel; needs a **separate worker tier that does not exist today**.

## Untrusted-content posture (unchanged, applies to any provider)

Per the platform's standing rule ([security-and-privacy.md](./security-and-privacy.md)): **document
content is data, never instructions.** OCR output is untrusted text — it is normalized, control-char
stripped, evidence-bounded, and fed only into the **deterministic** classifier + schema-bound extractor +
validators, then human review. No OCR text is ever executed as an instruction, and OCR **never** writes an
operational record. Introducing an external OCR provider does **not** change this: the provider returns
page text + confidence + boxes into the adapter, and nothing beyond the existing four apply-target fields
becomes writable.

## Gate conclusion

- **Azure** clears the gate with the fewest residual conditions (Africa/EU residency, deletion API,
  24 h purge) — **pending** the DPA no-training clause and region-availability confirmation.
- **Google** and **Mistral** clear the gate **conditionally** (EU residency acceptance; Mistral plan +
  LLM-boundary + calibration).
- **AWS** clears the gate **only after** the Organizations opt-out and EU pin, and carries the heaviest
  architectural/residency surface.
- **Self-hosting** cannot pass for the MVP (no worker infrastructure; all controls self-built).

The ranked outcome feeds [phase-7.4c0-decision.md](./phase-7.4c0-decision.md).
