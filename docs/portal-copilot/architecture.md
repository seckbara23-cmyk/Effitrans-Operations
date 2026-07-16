# Customer AI Assistant — Architecture (Phase 7.6C)

The **Assistant Logistique IA** is the customer-facing sibling of the internal Logistics Copilot
(7.6A/7.6B). It is **not a new AI subsystem**: it reuses the same provider chain, the same engine,
the same prompt contract, the same budgeting, and the same rate-limit ledger. The only things that
are new are the ones that *must* be customer-specific: **what it may read**, **what it may say**,
and **who it answers to**.

## Provider chain (mandatory, unchanged)

```
Customer Portal  (components/portal/portal-copilot-panel.tsx)
        ↓  POST /api/portal/copilot   (never calls a provider directly)
Customer AI Route  (app/api/portal/copilot/route.ts)
        ↓
Customer Context Reader  (lib/portal/copilot/context.ts → getPortalShipmentContext)
        ↓
Deterministic Recommendation Cards  (lib/portal/copilot/cards.ts)
        ↓
runCopilotDetailed()  (lib/copilot/engine.ts — SHARED, untouched)
        ↓
lib/ai  (UNTOUCHED)
        ↓
Configured Provider (OpenAI / Azure OpenAI / Ollama / vLLM)
```

`lib/ai`, `generateAI()`, and every provider implementation are **untouched** by this phase. The
portal copilot contains **zero** provider-specific code and never imports `@/lib/ai` (enforced by
test).

## The one structural difference: identity

| | Logistics Copilot (7.6A/B) | Customer Assistant (7.6C) |
|---|---|---|
| Actor | `app_user` (staff) | `client_user` (portal) |
| Gate | `assertPermission("logistics:copilot:read")` | `getCurrentPortalUser()` + `status === "ACTIVE"` |
| Scope | tenant-wide (`getCommandCenter()`) | this customer's own rows (`getPortalShipmentContext()`) |
| Boundary | RBAC permissions + tenant | **RLS** (tenant + customer + portal account) |
| Audit actor | `actorId` | `clientUserId` |
| Rate limit | `actor_id`, 12/min | `client_user_id`, 6/min |

**No new permission was created, and none is asserted.** A portal user holds no
`transport:read` / `customs:read` / `finance:read` and must not acquire one here. The route calls
`getCurrentPortalUser()` only — verified structurally.

## Context reader — composition, not new logic

`getPortalShipmentContext(question, fileId?)` replaces `getCommandCenter()`. It **composes the
existing, RLS-enforced portal readers** and adds no domain calculation and no write path:

| Source (already existed) | Contributes |
|---|---|
| `getPortalTracking(fileId)` (3.3A) | route, customer timeline, progress, ETA, delay, next step, documents + requirements, officer, activity |
| `getPortalCarriage(fileId)` (7.5A) | vessel/flight, containers/ULDs, safe references (MBL/HBL/MAWB/HAWB), map projection |
| `listPortalInvoices(fileId)` (1.12B) | the customer's own invoices |
| `listClientNotifications()` | the customer's own notifications |
| `getPortalShipments()` (3.3) | the customer's other shipments (portfolio scope) |

Because every one of those readers resolves the caller with `getCurrentPortalUser()` and reads
through the **RLS user-context client**, tenant + customer scoping is enforced by the **database**,
not by this file. The reader holds **no service-role client and issues no query of its own** — it
therefore cannot widen the boundary even by mistake (enforced by test).

`portalCustomsView()` and `portalMapSummary()` are **pure** and live in `lib/portal/copilot/view.ts`,
following the existing portal split (pure `tracking-derive.ts` vs server-only `tracking.ts`). That
narrowing *is* the security boundary, so it is directly unit-tested.

## What was extracted to be shared (de-duplication)

Two primitives were duplicated the moment a second copilot existed, so they were lifted out and are
now used by **both**:

- `lib/copilot/budget.ts` — `BUDGET` caps, `capSerialized()`, `capsFor()`.
  `lib/logistics/copilot/budget.ts` re-exports them (its contract is unchanged); each copilot keeps
  only its **own domain** classification (question classes + section priorities).
- `lib/copilot/rate-limit.ts` — `checkAuditRateLimit()` over the existing `audit_log`
  (no new table). The only per-caller difference is the action, the **actor column**, and the limits.

## Scope

The panel lives in the portal dossier sidebar (`/portal/files/[id]`) and passes `fileId`, so the
assistant is **dossier-scoped** by default. The reader also supports portfolio scope (`fileId`
omitted) for a future global entry point; the route already accepts it.

## Read-only

No mutation, no tools, no SQL from the model, no writes except the single audit row. A provider
call happens **only** on an explicit customer question — `GET` returns configuration only and never
calls the model.
