# Logistics Copilot — Recommendation Model

**Phase 7.6A.** Recommendations are **deterministic operational cards** built from real, bounded rows
(`lib/logistics/copilot/cards.ts`) — **no model, no hallucinated facts**. The LLM narrates on top; the
cards are the ground truth (and the provider-down fallback).

## Card contract

Every `RecommendationCard` carries:

| Field | Meaning |
|-------|---------|
| `kind` | one of the nine card kinds below |
| `title` | short French label |
| `finding` | what was found (counts + plain statement) |
| `evidence` | the **records analyzed**, each with a real `reference` (declaration / invoice / file number), a `detail`, and a `link` to the module |
| `confidence` | `HIGH` (concrete identified records) · `MEDIUM` (a real signal without a citable id, or a suggestion) · `LOW` |
| `reasoning` | why the finding holds, and any caveat |
| `suggestedAction` | what a human should do (a suggestion — the Copilot never acts) |
| `sourceModules` | the module(s) the finding came from (customs / ocean / air / road / finance / documents) |
| `timestamp` | the context snapshot time |

## The nine card kinds → sources

| Kind | Source (bounded reader) | Evidence identifiers | Confidence |
|------|-------------------------|----------------------|:----------:|
| **Blocked Customs** | `listDeclarations` filtered to REJECTED / CANCELLED / AWAITING_PAYMENT | declaration reference, file number | HIGH |
| **Compliance Warning** | the REJECTED/CANCELLED subset of blocked customs | declaration reference | HIGH |
| **Delayed Vessel** | Command Center `attention` (ocean) | file number, client, reason | HIGH/MEDIUM |
| **Late Flight** | Command Center `attention` (air) | file number, client, reason | HIGH/MEDIUM |
| **Risk Shipment** | Command Center `attention` (severity = critical, any mode) | file number, client | HIGH/MEDIUM |
| **Upcoming ETA** | Command Center `upcoming` (ocean/air, dated) | file number, route, date | HIGH |
| **Customer Notification Suggested** | the same upcoming arrivals | file number, route | MEDIUM (a suggestion) |
| **Overdue Invoice** | `getFinanceQueue().filter(overdue)` (finance-gated) | invoice number, balance, due date | HIGH |
| **Missing/Review Document** | Command Center doc-intel counts | ready-for-review / failed counts | MEDIUM |

Confidence is deterministic: a card built from concrete, identified records is `HIGH`; a signal
without a citable identifier, or an advisory (customer-notification), is `MEDIUM`.

## Emission rules (Missing ≠ Negative)

- A card is emitted **only** when its module was consulted **and** real records exist.
- A module that is **unauthorized or unavailable** produces **no** card and is listed in the context’s
  `unavailable` set — the Copilot says “not included”, never “nothing found”.
- **Authorized-but-empty** is a legitimate negative: the summary says “Aucune recommandation à
  signaler dans les modules consultés”, distinct from “module non consulté”.

## Bounded by construction

Each source is **page-0, ≤ 100 rows** (the tenant is never fully scanned); the caps are disclosed in
the context `counts`. Evidence lists are capped in the UI (first 8 shown, remainder counted).

## Notes / 7.6B

- **Missing/Review Document** reflects the OCR-extraction review queue (ready-for-review / failed),
  **not** portfolio-wide missing *required* documents — that reader is Phase 7.6B.
- **Risk** currently derives from the Command Center’s critical-severity attention. A full portfolio
  `assessRisk`-per-file pass (a bounded risk reader) is Phase 7.6B.
- The overdue-invoice source is request-memoized; a dedicated bounded overdue-invoice reader is 7.6B.
