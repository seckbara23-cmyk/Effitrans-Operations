# Customer AI Assistant — Reuse Analysis (Phase 7.6C)

An honest accounting of what already existed, what was reused as-is, what was extracted to be
shared, and what genuinely had to be new.

## Reused AS-IS (zero change)

| Component | Phase | Reused for |
|---|---|---|
| `lib/ai/*` (provider, config, types, openai/ollama/vllm/openai-compatible) | AI-1 | the entire provider layer — **untouched**, never imported by the portal copilot |
| `generateAI()` | AI-1 | untouched |
| `runCopilotDetailed()` / `CopilotError` / `getCopilotConfig()` | 7.6B | the model call + token/latency + stable error codes |
| `CopilotChatMessage` (`lib/copilot/prompt`) | 3.1A | the chat-message contract (no second prompt engine) |
| `getPortalTracking()` | 3.3A | route, timeline, progress, ETA, delay, next step, documents + requirements, officer, activity |
| `getPortalCarriage()` | 7.5A | vessel/flight, containers/ULDs, safe refs, map projection |
| `listPortalInvoices()` | 1.12B | the customer's invoices |
| `listClientNotifications()` | 2.x | the customer's notifications |
| `getPortalShipments()` | 3.3 | portfolio scope |
| `getCurrentPortalUser()` | 1.12A | portal identity gate |
| `writeAudit({ clientUserId })` | AUD-2 | the portal actor was **already** a first-class audit actor — no schema change |
| Portal RLS policies | 1.12A/1.12B/7.5A | the hard isolation boundary |
| `derivePortalEta`, `deriveDelay`, `deriveNextStep`, `documentRequirements`, `toPortalTimeline`, `isGenericStaffIdentity` | 3.3/3.3A | every customer-safe derivation — **no logic re-derived** |

## Extracted to SHARED (de-duplication, both copilots now use one copy)

| New shared module | Was | Now |
|---|---|---|
| `lib/copilot/budget.ts` | `BUDGET` + `capSerialized` lived only in `lib/logistics/copilot/budget.ts` | shared; logistics **re-exports** them so its contract is unchanged. Each copilot keeps only its own domain classification. |
| `lib/copilot/rate-limit.ts` | the audit-log counting rule lived only in `lib/logistics/copilot/usage.ts` | shared `checkAuditRateLimit()`; callers differ only by action, **actor column**, and limits. `checkCopilotRateLimit()` keeps its signature and delegates. |

Both refactors are behaviour-preserving; the full 7.6A/7.6B suites pass unchanged.

## Genuinely NEW (and why it could not be reused)

| New | Why it cannot be the internal one |
|---|---|
| `getPortalShipmentContext()` | `getCommandCenter()` is tenant-wide and operator-shaped. A customer must see only their own rows. It **composes** existing readers — no new domain logic. |
| `lib/portal/copilot/view.ts` | the internal→customer narrowing *is* the security boundary; kept pure and unit-tested. Customs is derived from the customer timeline because `customs_record.status` is internal. |
| `lib/portal/copilot/cards.ts` | the internal card kinds (`RISK_SHIPMENT`, `COMPLIANCE_WARNING`, `BLOCKED_CUSTOMS`…) are internal-only by definition. The 8 customer kinds are a different, safe set — and carry **no confidence**. |
| `lib/portal/copilot/prompt.ts` | the internal guardrails address an operator ("tu réponds au personnel interne") and permit finance/customs detail. The customer prompt adds the anti-internal-disclosure rules. |
| `lib/portal/copilot/budget.ts` | keyword classes are domain vocabulary: "Où est mon expédition ?" is not an operator question. Reuses the shared caps + `capSerialized`. |
| `app/api/portal/copilot/route.ts` | different gate (portal identity, not RBAC), different audit actor, and a customer-safe error surface. |
| `components/portal/portal-copilot-panel.tsx` | same session-only UX, minus every internal surface (no module filter, no confidence badge, no usage strip). |

## Not duplicated — deliberately

- **No new AI framework, no second prompt engine, no provider-specific code.**
- **No new permission** (a portal user has none, and must not gain one).
- **No new table** — the rate limiter and audit reuse `audit_log`.
- **No new map/ETA/lifecycle/risk engine** — all composed.
- **No portal usage endpoint** — staff already have `audit:read:all` aggregates, and a customer must
  never see provider/token/latency diagnostics.

## Deleted

`components/portal/copilot-suggestions.tsx` — the Phase 3.3 "Assistant Effitrans — Bientôt"
placeholder (UI-only, no backend). Replaced by the real panel; no other reference existed.
