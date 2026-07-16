# Logistics Copilot — Context Budgeting

**Phase 7.6B, Part 8.** Deterministic, allowlisted budgeting so the context stays bounded and
relevant, the LLM never chooses what runs, and no requested module is silently emptied.
Source: [`lib/logistics/copilot/budget.ts`](../../lib/logistics/copilot/budget.ts) (pure).

## Question classification (deterministic, allowlisted)

`classifyQuestion(question)` folds the text and scores it against a fixed keyword map, returning one
of: `attention · customs · transport · documents · finance · risk · customer · general`. Ties resolve
by a fixed class order; no match → `general`. **The model plays no part** — classification is a pure
function computed server-side before any read.

| Question (example) | Class | Prioritized modules |
|--------------------|-------|---------------------|
| « déclarations douanières bloquées ? » | `customs` | customs, documents |
| « navires / vols en retard ? » | `transport` | ocean, air, road |
| « factures impayées ? » | `finance` | finance |
| « dossiers à risque élevé ? » | `risk` | all |
| « que faut-il traiter aujourd'hui ? » | `attention` | all |

## Per-module caps

`moduleCaps(class)` returns a record `{ road, ocean, air, customs, documents, finance }`:

- **Prioritized** modules for the class → `BUDGET.priorityCap` (25 records).
- **Other** modules → `BUDGET.minorCap` (8 records) — **trimmed, never zero**, so a requested module
  always retains records.

The context builder applies these caps when slicing each module's records and records any capped
module in `truncated`.

## Total serialized cap

`capSerialized(text)` caps the serialized brief at `BUDGET.maxSerializedChars` (12 000, well under the
AI layer's 24 000-char prompt cap) and returns `{ text, truncated }`. Truncation appends an explicit
marker and is reported.

## Truncation is disclosed, never silent

Every truncation is surfaced: in the context (`truncated: LogisticsModule[]`), in the serialized brief
(a `Contexte tronqué : …` line), in the deterministic summary, and in the panel footer. This upholds
**Missing ≠ Negative** — a truncated module is "limité", not "vide", and an unavailable module is
"non inclus", not "rien à signaler".

## Guarantees (tested)

- Customs / transport / finance / risk questions classify correctly; ties → `general`.
- Prioritized modules get the full cap; every module cap is > 0 (a requested module is never emptied).
- The serialized brief is capped and truncation is flagged; short briefs are untouched.
