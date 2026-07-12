# Phase AI-2 — Operational Copilot (Shipment Understanding)

Turns the read-only dossier Copilot into a **shipment-aware operations assistant**:
it now understands the whole shipment (lifecycle + documents + customs + transport
+ **tracking/ETA/incidents/delays/POD/timeline** + finance + SLA + risk), routes each
question to an explicit **skill**, grounds its answer (Known / Unknown / Unauthorized),
and returns a **deterministic transparency footer** (sources, restrictions, unknowns,
confidence). Still **read-only** — no actions, no writes, no external calls.

Delivered in two increments. **AI-2a (this commit)** = D1–D7 + D10–D13. **AI-2b** =
client/handover generators polish, expanded eval scenarios, the live `qwen2.5:3b` run,
and the panel UI (skill chips + transparency footer).

## Reuse (no second engine)
The existing single context engine is **extended, not duplicated**. `buildCopilotContext`
still calls the same permission-scoped read services as the dossier page; AI-2a adds one
gated section by reusing existing readers/engines:
- `lib/tracking/service` (`getTrackingTimeline`, `getLatestTrackingPosition`),
- `lib/tracking/eta` (`deriveRealtimeEta`) + `lib/tracking/position` (`classifyFreshness`),
- `lib/copilot/risk-engine` (unchanged — still the single risk source).
No new tracking engine, lifecycle engine, or context builder.

## AI-2a — what shipped

**D1 Unified shipment context** — `CopilotContext.tracking` (`Section<CopilotTracking>`),
gated by `tracking:read`. One section covers tracking, driver, ETA (basis + confidence),
incidents, delays, delivery/POD, the operational **timeline**, and a customer-visible
summary (what the client saw on the portal). The raw GPS trail is never exposed — only the
last-known-position time + freshness + a compressed event timeline. Sections the caller
cannot read stay `{included:false}` (no data, no speculation).

**D2 Compression** — `lib/copilot/compress.ts` (pure): `capItems` caps long event lists
deterministically but **never drops** a critical event (incident, delay, delivery/POD,
customs stop, border). Active blockers, missing documents, current department, active
transport and delivery status are structured fields, never in the capped lists. The brief
discloses how many entries were omitted.

**D3 Skills + D4 routing** — `lib/copilot/skills.ts` (pure): 10 skills
(`shipment_summary, missing_documents, customs_status, tracking_status, delay_analysis,
risk_summary, next_step, client_update, internal_handover, timeline_summary`) + `general`
fallback. `detectSkill(question)` is a transparent keyword score (FR/EN) with a fixed
priority tie-break, run **before** prompt construction. `buildMessages` layers
**system prompt → skill fragment → context → question** (no giant prompt).

**D5 Grounding** — the system prompt now forces the three-way distinction: information
**CONNUE** vs **INCONNUE** (say "non renseigné / non planifié") vs **NON AUTORISÉE**
(permission-hidden — say so, never speculate).

**D6 Timeline** — the tracking events form a chronological "SUIVI / CHRONOLOGIE" brief
section; the `timeline_summary` skill answers "what happened yesterday / when did the delay
start / what changed", using only dates actually present.

**D7 Recommendations** — every proposed action must be prefixed `Action suggérée :` and
framed as a suggestion; the model never claims to have executed anything (reinforced by the
`next_step` skill fragment).

**D10 Transparency + D11 citations** — `lib/copilot/transparency.ts` (pure)
`buildTransparency(ctx, skill)` computes, **server-side (not model-reported)**:
`sources` (section names used), `restricted` (permission-hidden sections),
`unknown` (genuinely-absent facts — unknown ≠ hidden), and `confidence`
(high/medium/low from the skill's primary section). The route returns it as `meta`;
citations reference **section names**, never raw DB fields. No fabricated certainty.

**D12 Performance** — `getShipmentContext(fileId, tenantId, permissions)` memoises the built
context for 15 s, keyed by **tenant + file + permission fingerprint** (a different tenant or
differently-permissioned caller never gets someone else's cached snapshot; the underlying
reads remain the RLS boundary). Reads already run in one `Promise.all` (no N+1).
`buildCopilotContext` stays the uncached builder used by tests and the eval harness.

**D13 Security** — permission gating preserved end-to-end (`{included:false}` sections carry
no data and are labelled "ACCÈS NON AUTORISÉ"); the model is never fed raw audit rows,
prompts, provider config, or keys; cross-tenant/other-shipment access is blocked by the
RLS-scoped read services; internal incident notes never enter a client-message skill.

**Route** — `/api/copilot` accepts an optional `skill` (validated) or detects it, resolves
the English hint, returns `{ text, meta }`. Backward compatible (older clients ignore `meta`).

## Tests / validation (AI-2a)
- `tests/copilot-skills.test.ts` — skill detection (FR/EN, priority, fallback), English hint,
  per-skill fragments, suggested-action marking.
- `tests/copilot-compress.test.ts` — criticals never dropped, budget filling, omitted count,
  classifiers.
- `tests/copilot-transparency.test.ts` — sources by section name, restricted/unknown,
  confidence per skill (low when the primary section is hidden).
- `tests/copilot-context.test.ts` — tracking gating, incident/delay counting, event
  compression, present:false when empty.
- `tests/copilot-prompt.test.ts` — SUIVI/CHRONOLOGIE serialization, grounding bullets,
  skill routing (3-message prompt), compression disclosure.
- `npm run typecheck` / `npm test` (628 passed) / `npm run build` all green.

## Remaining for AI-2b
D8 client-communication generator (FR default, EN on request) + D9 internal-handover polish;
D14 expanded eval scenarios (missing doc, delay, risk, handover, client update, blocked
customs, permission filtering, unknown ETA, timeline, driver assignment, recommendation
quality, grounding); D15 live evaluation vs **qwen2.5:3b** (latency, groundedness,
hallucination, recommendation quality, French quality, permission safety); the panel UI
(10 skill chips + transparency footer rendering) + i18n labels.
