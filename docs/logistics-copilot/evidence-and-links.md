# Logistics Copilot — Evidence & Drill-Down Links

**Phase 7.6B, Parts 11-12.** Every recommendation is a factual source list with authorized deep
links — not hidden AI reasoning.

## Evidence panel (safe fields only)

Each card carries an expandable evidence list. An `EvidenceRecord` exposes **only**:

| Field | Example | Safe because |
|-------|---------|--------------|
| `module` | Douane / Maritime / Finance | a label, not a table |
| `reference` | `DEC-001`, `INV-9`, `EFT-IMP-2099-4` | a human identifier, never an internal DB id |
| `status` | `REJECTED`, `EXPIRED`, `MEDIUM` | a safe enum |
| `detail` | `120000 XOF · 16 j de retard` | derived safe facts |
| `timestamp` | `2026-07-18` | a date |
| `confidence` | HIGH / MEDIUM / LOW | deterministic |
| `link` | `/files/f4` | an authorized route |

It **never** exposes: internal database IDs (surrogate keys), raw provider payloads, document bodies,
customer PII (email / phone), hidden staff notes, the prompt, or model chain-of-thought. The panel is
a **source list**, and the card's `reasoning` is a concise evidence-based explanation — not internal
reasoning.

## Drill-down links (server-built, never model-generated)

Links are constructed **deterministically** in the readers/cards from safe route identifiers
(`/files/{fileId}`, `/shipping/shipments/{id}`, `/files/{fileId}/documents/{documentId}/intelligence`,
etc.). **The model never generates a URL** — the LLM produces prose; the links come only from the
deterministic card evidence. An unauthorized module produces no records and therefore no links.

Potential targets: the dossier, a customs declaration's file, an ocean/air shipment, an invoice's
file, and the Document-Intelligence review. Each resolves to an existing authorized route.

## Guarantees (tested)

- Evidence carries safe fields (module / reference / status / timestamp / confidence / link) and no
  internal ids or PII.
- Card links are built server-side; the model cannot inject an arbitrary URL.
- A module the caller can't read contributes no evidence and no link.
