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

## AI-2b — what shipped

**D8 client-communication generator + D9 internal handover** — delivered as the
`client_update` and `internal_handover` skills (AI-2a). The client-message skill produces
French by default and English on request (`wantsEnglish` detects "in English / en anglais");
its fragment forbids internal notes, SLA thresholds, internal incidents, and hidden-section
data. The handover skill produces a concise internal note (status, department, blockers,
transport/ETA, finance/POD pending, next action).

**UI** — `components/copilot/copilot-panel.tsx`: the generic suggestion chips are replaced by
the **10 skill chips** (each sends a canonical question + explicit skill id), and every
assistant answer renders the **transparency footer** (sources · restricted · unknown ·
confidence) from the server-computed `meta`. i18n: `copilot.skills` + `copilot.transparency`.

**D14 evaluation** — the harness grows from 15 to **23 sanitized scenarios**, adding delay
explanation, blocked customs, unknown-ETA grounding, timeline "what happened", driver
assignment, tracking status, a **hidden-tracking** permission-filtering variant, and
recommendation quality. Both `runEvaluation` and the live runner now build the prompt through
the real **skill routing** (`detectSkill` + `buildMessages({skill, english})`), so the eval
exercises the same path as production. Deterministic scoring is unchanged
(`lib/ai/eval/evaluators`).

**D15 validation** — `npm run typecheck` / `npm test` (628 passed) / `npm run build` green.
Live evaluation run against **qwen2.5:3b** via `npm run ai:eval:local` (sanitized fixtures,
no production data); metrics (median latency, groundedness, French quality, instruction
following, hidden-leak / injection / safety failures, hallucination/fabrication counts) are
written to the gitignored `eval-results/qwen2.5-3b.json` and reported with the phase.

### Live eval metrics (qwen2.5:3b) — see `eval-results/qwen2.5-3b.json`
Reported alongside this phase (artifact is gitignored; sanitized fixtures only). Headline
signals to check: **permission safety** (hidden-leak & injection failures should be 0),
groundedness, French quality, and median warm latency on this CPU.
