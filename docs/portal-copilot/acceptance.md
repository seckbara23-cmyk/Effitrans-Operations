# Customer AI Assistant — Acceptance (Phase 7.6C)

## Definition of Done

| Requirement | Status | Evidence |
|---|---|---|
| No duplicated AI architecture | ✅ | `lib/ai`, `generateAI()`, providers untouched; portal never imports `@/lib/ai` (test); shared engine + budget + rate-limit reused |
| 100% provider-neutral | ✅ | only `runCopilotDetailed()`; no provider name in the portal copilot (test) |
| Customer data only | ✅ | `getPortalShipmentContext()` composes RLS-scoped portal readers; no admin client, no table query (test) |
| Strict tenant + customer isolation | ✅ | portal RLS is the boundary; uniform 404 for unowned dossiers |
| Deterministic fallback when AI unavailable | ✅ | cards + summary returned on rate-limit, `CopilotError`, and unexpected error |
| Session-only conversations | ✅ | React state only; no localStorage/sessionStorage/cookie/DB (test) |
| Read-only | ✅ | no mutation, no tools, no SQL; only the audit row is written |
| CI green | ✅ | 127 files / 2163 tests pass (incl. unchanged 7.6A/7.6B) |
| Typecheck clean | ✅ | `tsc --noEmit` exit 0 |
| Build clean | ✅ | `next build` compiled successfully; `/api/portal/copilot` registered |

## Capabilities verified

The 8 documented questions are answerable and grounded:

| Question | Grounded in |
|---|---|
| Où est mon expédition ? | `currentLocation`, progress, carriage vessel/flight + last **dated** position |
| Pourquoi est-elle en retard ? | `delay.label` + `delay.explanation` (customer-safe, no score) |
| Quand arrivera-t-elle ? | `eta.estimatedDate` + `basis`; **"INCONNUE"** when absent — never invented |
| Quels documents me manquent ? | requirement states, split: customer-owed vs under review |
| Quel est le statut de la douane ? | timeline-derived: not started / in progress / cleared |
| Qui gère mon dossier ? | assigned account manager or team fallback |
| Résume mon expédition. | full brief + deterministic summary |
| Que dois-je faire maintenant ? | `nextStep` when `party === "client"` |

## Recommendation cards (customer-safe only)

`SHIPMENT_PROGRESS`, `MISSING_DOCUMENTS`, `UPCOMING_ARRIVAL`, `AWAITING_CUSTOMER_ACTION`,
`INVOICE_AVAILABLE`, `CUSTOMS_PROCESSING`, `DOCUMENT_REVIEW`, `NOTIFICATION_AVAILABLE`.

No internal-only card exists in the customer model (test asserts the internal kinds are absent).
No card carries a `confidence` field.

## Test coverage — `tests/portal-copilot.test.ts` (54 tests)

Behavioural: card grounding + citations, owed-vs-review document split, no fabricated ETA, no
upcoming-arrival for a delivered shipment, Missing ≠ Negative, empty context, deterministic
fallback, customs narrowing, map narrowing (drops source/confidence), classifier determinism +
accent folding, budget never zeroes a section, prompt guardrails, bounded history.

Structural: portal-only gate with no RBAC escalation, RLS-only reads, no admin client, shared
engine/budget/rate-limiter reuse, portal-attributed safe audit, no provider diagnostics to the
customer, uniform 404, no provider call on GET, session-only panel, placeholder retired.

## Known gaps / deferred

1. **Live provider run not exercised.** No AI provider is configured in this environment, so the
   `answered` path was verified structurally and by type, not against a live model. The
   deterministic fallback path is exercised. A staging run with a configured provider is an
   operator step (same posture as 6.0G).
2. **No end-to-end RLS test for the copilot route.** The portal RLS policies it relies on are
   already covered by the existing SQL suite (1.12A/1.12B/7.5A); the copilot adds no new table or
   policy, so it inherits that coverage rather than adding its own. A route-level cross-customer
   test would need a live DB session.
3. **Portfolio scope has no UI entry point.** The reader and route support `fileId`-less portfolio
   scope, but the panel is mounted only on the dossier page (the sidebar is a frozen contract).
   Reaching it needs a portal nav decision.
4. **ETA confidence deliberately withheld.** The portal ETA widget already shows customers a
   confidence bar, but the spec's never-list says "confidence scores", so the AI context carries
   `basis` only. This is a conservative reading — revisit if answers feel under-specified.
5. **Reviewer note (`review_note`) withheld.** The customer sees it in `ActionsRequired`, but it is
   free text authored internally (an injection surface and possibly internal language), so cards say
   "à remplacer" without the reason. Revisit if customers ask why.
6. **No portal usage endpoint.** Intentional (see reuse analysis) — staff aggregates already cover
   portal queries via `audit:read:all`.
