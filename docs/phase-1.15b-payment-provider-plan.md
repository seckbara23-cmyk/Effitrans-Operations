# Phase 1.15B — Real Payment Provider Integration (PLAN ONLY)

> **Status: DESIGN. No code, no migration, no credentials, no live money.**
> Pairs with Phase 1.15A (manual payment verification + reconciliation, shipped
> in migration `20260615000010`). This plan adds *provider-initiated* online
> payments **without changing** the 1.11 finance calculations, the 1.15A
> reconciliation workflow, RLS, or the append-only audit. Everything here is
> additive and gated behind a feature flag.

---

## 0. Guiding principles (carried from existing architecture)

These are non-negotiable constraints the design must respect — they are how the
rest of the platform already works:

1. **Money is finance-role gated, never dossier-inherited.** `payment`/`invoice`
   RLS = `tenant + has_permission(finance:read)` (the CI-tested boundary). A
   `payment_intent` inherits the *same* gating.
2. **Provider calls are server-only.** Service-role admin client + `import
   "server-only"`. No provider SDK, secret, or signing key ever reaches the
   client bundle (the boundary grep gate enforces this).
3. **The 1.11 paid/balance formula is sacred.** `paid = Σ non-reversed payment
   amounts`. Online payments must result in a **normal `payment` row** so the
   formula is unchanged. A `payment_intent` is an *orchestration record*, not a
   money record — only its terminal success **creates a `payment`**.
4. **Append-only audit.** Every provider event writes `audit_log` via
   `writeAudit` (actorId for staff, clientUserId for portal, or system for
   webhooks). Triggers already block mutation/delete.
5. **Additive RLS only** (the 1.12 portal pattern): portal policies are OR'd
   with staff policies; staff RLS is never weakened.
6. **Reuse before adding.** Reuse `finance:payment` / `finance:read` /
   `finance:void`; reuse the Communications Hub for links/receipts; reuse the
   1.15A reconciliation view for intent visibility.

---

## 1. Payment-provider architecture

### 1.1 Provider abstraction (`lib/finance/providers/`)

A small server-only interface so Wave / Orange Money / mock are interchangeable
and the service layer never branches on provider name:

```
PaymentProvider {
  readonly name: "WAVE" | "ORANGE_MONEY" | "MOCK"
  readonly capabilities: ProviderCapabilities
  createCheckout(input): Promise<ProviderCheckout>      // returns provider_intent_id + checkout_url + expires_at
  parseWebhook(rawBody, headers): Promise<ProviderEvent> // verifies signature, returns normalized event
  getIntentStatus(providerIntentId): Promise<ProviderStatus>  // poll fallback when webhooks are late
}

ProviderCapabilities {
  checkoutUrl: boolean        // hosted redirect (Wave)
  pushPayment: boolean        // STK/USSD push (Orange Money)
  webhooks: boolean
  statusPolling: boolean
  partialPayments: boolean    // false in MVP for all
  refunds: boolean            // false in MVP for all
}
```

- **`MockProvider`** — the dev/test default. Deterministic `provider_intent_id`,
  a fake `checkout_url` (`/finance/mock-pay/{intentId}`) that lets a developer
  flip an intent to SUCCEEDED/FAILED, and a `parseWebhook` that accepts a shared
  dev secret. This is the **only** provider built in the MVP scaffold (mirrors
  the 1.14 no-op communications provider).
- **`WaveProvider` / `OrangeMoneyProvider`** — **placeholders** in 1.15B:
  interface implemented, real HTTP calls stubbed/throwing `not_configured`
  until credentials + the provider's API contract are approved. No live calls.

### 1.2 Provider registry + selection

`getPaymentProvider(name)` resolves from a registry keyed by env. Selection is
constrained by `ProviderCapabilities` and a **tenant-level allowlist** (which
providers a tenant has enabled). Unknown/disabled provider → `provider_disabled`.

### 1.3 Env config (server-only, never `NEXT_PUBLIC_`)

```
PAYMENTS_ENABLED=false                 # master feature flag (off by default)
PAYMENTS_PROVIDERS=MOCK                # comma list of enabled providers
PAYMENTS_MOCK_WEBHOOK_SECRET=...       # dev only
WAVE_API_KEY= / WAVE_WEBHOOK_SECRET=   # absent in 1.15B → WaveProvider stays not_configured
ORANGE_MONEY_CLIENT_ID= / _SECRET= / _WEBHOOK_SECRET=
PAYMENTS_INTENT_TTL_MINUTES=30
```

A missing secret degrades that provider to `not_configured` (same pattern as the
Supabase-not-configured notices and the communications `NOTIFICATIONS_EMAIL_ENABLED`
stub) — the app never crashes, the feature is simply unavailable.

---

## 2. Payment-intent model — **new `payment_intent` table** (recommended)

**Decision: add a table, do not overload `payment`.** Rationale: a `payment` row
means "money received" and feeds the balance formula. An intent is a transient
orchestration object that may never become money (FAILED/EXPIRED/CANCELLED).
Overloading `payment` would force "pending/failed" payments into the paid/balance
math or require excluding them — exactly the fragility 1.15A avoided. Keeping them
separate means **the 1.11 formula is untouched**: only a SUCCEEDED intent spawns a
real `payment`.

### 2.1 Schema proposal (additive migration `…011`, NOT created here)

```
payment_intent (
  id                   uuid pk default gen_random_uuid(),
  tenant_id            uuid not null references organization(id),
  invoice_id           uuid not null references invoice(id) on delete cascade,
  provider             text not null check (provider in ('WAVE','ORANGE_MONEY','MOCK')),
  amount               numeric(14,2) not null check (amount > 0),
  currency             text not null default 'XOF',
  status               text not null default 'CREATED'
                         check (status in ('CREATED','PENDING','PROCESSING',
                                           'SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  provider_intent_id   text,                 -- id returned by provider (unique per provider)
  provider_checkout_url text,
  provider_reference   text,                 -- provider's settlement/transaction ref
  payment_id           uuid references payment(id),  -- set when SUCCEEDED auto-creates a payment
  expires_at           timestamptz,
  completed_at         timestamptz,
  failed_at            timestamptz,
  last_error           text,
  created_by           uuid references app_user(id),       -- staff who generated the link (nullable)
  created_by_client    uuid references client_user(id),    -- portal user who self-initiated (nullable)
  created_at           timestamptz not null default now()
)

indexes:
  (tenant_id, status)                        -- reconciliation queues
  (invoice_id)                               -- per-invoice intent history
  unique (provider, provider_intent_id) where provider_intent_id is not null
                                             -- idempotency anchor (see §4)

-- provider event log (append-only, idempotency + replay protection)
provider_webhook_event (
  id                   uuid pk default gen_random_uuid(),
  tenant_id            uuid,                  -- resolved from intent; nullable until matched
  provider             text not null,
  provider_event_id    text not null,         -- provider's event id
  event_type           text not null,
  payment_intent_id    uuid references payment_intent(id),
  signature_valid      boolean not null,
  outcome              text not null check (outcome in ('APPLIED','DUPLICATE','REPLAYED','REJECTED','UNMATCHED')),
  received_at          timestamptz not null default now(),
  unique (provider, provider_event_id)        -- dedupe / replay anchor
)
```

### 2.2 RLS (additive, mirrors `payment`)

- `payment_intent`: SELECT gated `tenant + has_permission(finance:read)`;
  writes via service-role only. **Plus** an additive portal policy (1.12
  pattern): a `client_user` may SELECT intents for invoices their client owns
  (`portal_can_read_invoice(invoice_id)`) — read-only, safe projection (no
  `last_error` internals). Portal **never** sees other clients' intents.
- `provider_webhook_event`: service-role + `finance:read` SELECT only; no portal
  access. Append-only (reuse the existing `prevent_mutation` trigger pattern).

### 2.3 db types + pure module

- `lib/db/types.ts`: hand-author `payment_intent` + `provider_webhook_event`
  Row/Insert/Update (numeric → number, coerced with `Number()`).
- `lib/finance/payment-intent.ts` (PURE, unit-tested): `INTENT_STATUSES`,
  `isIntentStatus`, the **status transition machine** (§3), `isTerminal`,
  `canCancel`, `canRetry`, `amountMatches(intentAmount, invoiceBalance)`.

---

## 3. Status workflow

```
CREATED ─▶ PENDING ─▶ PROCESSING ─▶ SUCCEEDED        (terminal, → creates payment)
   │          │            │
   │          │            └────────▶ FAILED          (terminal, retryable via new intent)
   │          └─────────────────────▶ EXPIRED         (terminal; TTL elapsed, no callback)
   └────────────────────────────────▶ CANCELLED       (terminal; staff/portal aborts before success)
```

- **CREATED** — row inserted, before the provider call returns.
- **PENDING** — provider accepted, `checkout_url`/push issued, awaiting customer.
- **PROCESSING** — provider reports in-flight settlement (optional; some providers
  jump straight to SUCCEEDED).
- **SUCCEEDED** — webhook (signature-valid) or polling confirms; **auto-creates a
  `payment`** (§4.5) and links `payment_id`.
- **FAILED / EXPIRED / CANCELLED** — terminal, no money. Remain **visible in
  reconciliation** (1.15A view gains an "intents" band) so staff can follow up.
- Transitions are **monotonic** and validated by the pure machine; a terminal
  state never changes. The DB `check` constrains the value set; the action layer
  enforces the *allowed transition* (e.g. can't go SUCCEEDED→FAILED).

---

## 4. Webhooks / callbacks

### 4.1 Endpoint

`app/api/payments/webhook/[provider]/route.ts` — a **Route Handler** (not a
server action; providers POST here). Server-only, no auth cookie (it's
machine-to-machine), secured entirely by **signature verification**.

### 4.2 Signature verification (mandatory)

Each provider's `parseWebhook(rawBody, headers)` verifies the HMAC/signature
against `*_WEBHOOK_SECRET` over the **raw** body (must read the raw stream, not
parsed JSON). Invalid signature → log `provider_webhook_event(signature_valid=false,
outcome='REJECTED')`, return `401`, **no state change**.

### 4.3 Idempotency

- Every event is keyed by `unique(provider, provider_event_id)` in
  `provider_webhook_event`. Insert-first: a unique-violation ⇒ this event was
  already processed ⇒ record `outcome='DUPLICATE'`, return `200` (so the provider
  stops retrying), **no second payment**.
- The `payment` auto-creation is itself idempotent: an intent already
  `SUCCEEDED` with a linked `payment_id` short-circuits.

### 4.4 Replay protection

- Reject events older than a skew window (e.g. > 15 min by provider timestamp)
  → `outcome='REPLAYED'`.
- Combined with the dedupe key, a replayed captured event cannot re-apply.

### 4.5 Match + auto-record (the critical path)

On a signature-valid, non-duplicate **success** event:
1. Resolve `payment_intent` by `(provider, provider_intent_id)`. No match →
   `outcome='UNMATCHED'`, alert in reconciliation, no money created.
2. **Amount match:** `amountMatches(intent.amount, current invoice balance)` —
   guard against overpayment (reuse the 1.11 `balanceDue`). Mismatch (e.g.
   balance already cleared by a manual payment) → do **not** create a payment;
   mark intent SUCCEEDED but flag for manual reconciliation
   (`outcome='APPLIED'` with a discrepancy note → surfaces in 1.15A).
3. **Create the `payment`** via the *existing* `recordPayment` path semantics
   (caps at balance, recompute `paymentStatus`), with:
   `method = WAVE|ORANGE_MONEY`, `provider_name`, `provider_reference`,
   `recorded_by = system`, and — per the recommended default —
   `verification_status = VERIFIED` (a signature-valid provider confirmation
   *is* the verification; see open decision Q4).
4. Link `intent.payment_id`, set `status=SUCCEEDED`, `completed_at`.
5. Audit `payment_intent.succeeded` + `payment.auto_recorded`.

Failure events → `status=FAILED`, `last_error`, audit `payment_intent.failed`.
No payment created.

---

## 5. Portal payment flow (behind `PAYMENTS_ENABLED` flag)

Portal stays **read-only for data**; paying is an *action on the customer's own
issued invoice*, not a data write to internal tables.

```
Portal user opens an ISSUED / PARTIALLY_PAID invoice
  └─ "Payer" button (only if PAYMENTS_ENABLED && tenant has a provider && balance > 0)
       └─ chooses Wave / Orange Money
            └─ server action createPaymentIntent(invoiceId, provider)   [portal-gated]
                 ├─ portal_can_read_invoice guard + invoice is payable + amount = balance
                 ├─ provider.createCheckout → PENDING + checkout_url
                 └─ redirect (Wave hosted page) OR show push instruction (Orange Money)
                      └─ customer pays on provider
                           └─ provider webhook → auto-record payment (SUCCEEDED)
                                └─ portal invoice now shows reduced balance + receipt
```

- The portal **never** records a payment directly — it only *creates an intent*.
  Money appears only via the verified webhook. This keeps the trust boundary at
  the signature check.
- A return URL (`/portal/invoices/[id]?intent=...`) shows "paiement en cours" and
  polls intent status (fallback to `getIntentStatus`) until the webhook lands.
- Guard: only one *active* (non-terminal) intent per invoice at a time;
  re-clicking returns the existing checkout URL.

## 6. Staff flow (payment links via Communications Hub)

```
Finance staff on an invoice (finance:payment)
  └─ "Générer un lien de paiement" → createPaymentIntent(invoiceId, provider, channel='LINK')
       └─ PENDING + checkout_url
            └─ "Envoyer le lien" → Communications Hub (1.14) email with the link
                 └─ customer pays → webhook → auto-record (same path as §4.5)
```

- Staff see the **intent status** on the invoice card and in the reconciliation
  view: PENDING/PROCESSING/SUCCEEDED/FAILED/EXPIRED.
- **Manual reconciliation:** for FAILED/EXPIRED/UNMATCHED/discrepancy intents,
  staff fall back to the **1.15A manual flow** — record a manual payment +
  verify, or cancel the intent. The two systems are complementary: online is the
  happy path, manual is the safety net.
- Staff-generated links are the **recommended first rollout** (portal Pay button
  stays flag-off) — lower blast radius, no portal UX risk while the provider
  contract is validated.

---

## 7. Security model

| Concern | Control |
|---|---|
| Provider secrets | Server-only env, never `NEXT_PUBLIC_`; boundary grep keeps them out of the client bundle |
| Provider calls | Service-role admin client + `server-only` modules |
| Webhook authenticity | Mandatory signature verification over the raw body; invalid → 401, no state change |
| Idempotency | `unique(provider, provider_event_id)` + insert-first; intent already-SUCCEEDED short-circuit |
| Replay | Timestamp-skew rejection + event dedupe |
| Overpayment | `amountMatches` vs live `balanceDue`; reuse 1.11 cap-at-balance in `recordPayment` |
| Tenant/invoice scoping | Every intent + event carries `tenant_id`; resolution is tenant-scoped; RLS gated |
| Portal isolation | Additive RLS via `portal_can_read_invoice`; portal can only intent on its own invoices |
| Auditability | Every intent transition + webhook event + auto-recorded payment writes `audit_log` |
| Least privilege | Reuse existing finance permissions; only one new optional permission (§8) |

---

## 8. Permissions

**Reuse:** `finance:payment` (staff create payment link), `finance:read` (view
intents/reconciliation), `finance:void` (cancel intent / reverse an
auto-recorded payment — same gate as 1.15A reject).

**Add only if needed:** `payment_provider:manage` — to configure a tenant's
provider allowlist / toggle providers (admin surface). Defer until there's a
config UI; until then provider enablement is env-driven and this permission is
unused. **Portal payment initiation uses the portal identity + `portal_can_read_invoice`,
not an RBAC permission** (consistent with 1.12).

---

## 9. Audit events (add to `AuditActions`)

```
PAYMENT_INTENT_CREATED   = "payment_intent.created"
PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded"
PAYMENT_INTENT_FAILED    = "payment_intent.failed"
PAYMENT_INTENT_CANCELLED = "payment_intent.cancelled"
PAYMENT_INTENT_EXPIRED   = "payment_intent.expired"
PROVIDER_WEBHOOK_RECEIVED= "provider.webhook.received"
PROVIDER_WEBHOOK_REPLAYED= "provider.webhook.replayed"   // also covers DUPLICATE/REJECTED via metadata
PAYMENT_AUTO_RECORDED    = "payment.auto_recorded"
```

- Staff-initiated → `actorId`. Portal-initiated → `clientUserId` (1.12 audit
  column). Webhook-driven → system actor (no actorId; the webhook event row is
  the attribution, linked by `provider_event_id`).
- `payment.auto_recorded` complements the 1.15A `payment.verified`: an
  auto-recorded payment is born VERIFIED, so it does **not** also emit
  `payment.verified` (avoids double-counting in analytics).

---

## 10. Communications integration (reuse 1.14)

New no-op-friendly templates in the Communications Hub:
- **`PAYMENT_LINK`** — "Réglez votre facture {number}: {checkout_url}".
- **`PAYMENT_SUCCESS`** — receipt on auto-record (triggered by §4.5).
- **`PAYMENT_FAILED`** *(optional)* — on FAILED, prompt retry.

These go through the existing `communication_message` table + provider stub +
`EmailTriggerButton` / triggered send. No new delivery mechanism — the Hub's
deferred real provider serves payments and reminders alike.

---

## 11. MVP scope vs deferred

### Build in 1.15B (when approved — flag-off by default)
- `payment_intent` + `provider_webhook_event` tables (additive migration) + RLS + db types
- `lib/finance/payment-intent.ts` pure status machine + unit tests
- Provider abstraction + **MockProvider** (full) + **Wave/Orange Money placeholders** (`not_configured`)
- Provider env config + capability flags + tenant allowlist resolution
- Webhook Route Handler scaffold: signature verify, idempotency, replay, event log, match+auto-record
- `createPaymentIntent` / `cancelPaymentIntent` server actions (staff + portal variants)
- Auto-create + auto-verify payment on signature-valid success (reusing 1.11 `recordPayment` semantics)
- Intent status on invoice card + a new **"Intents en ligne"** band in the 1.15A reconciliation view
- Staff "generate + send payment link" via Communications Hub
- Portal **Pay button behind `PAYMENTS_ENABLED`** (ships off)
- Audit events §9; i18n; tests (pure machine, idempotency/replay logic, boundary grep, RLS regression for the new tables)

### Defer (NOT in 1.15B)
- Real production credentials / live API calls (providers stay `not_configured`)
- Bank-transfer reconciliation API (manual 1.15A remains)
- Refunds, disputes, chargebacks, payouts/settlement reconciliation
- Partial online payments (intent amount = full balance only)
- Recurring/scheduled payments
- Real Communications provider (still the 1.14 stub)

---

## 12. Open decisions (recommended defaults in force until confirmed)

| # | Question | Recommended default |
|---|---|---|
| Q1 | Wave first or Orange Money first? | **Architecture + Mock first**; Wave first once credentials land (hosted checkout is the simpler integration). |
| Q2 | Portal payments immediately, or staff links first? | **Staff-generated links first**; portal Pay button ships behind `PAYMENTS_ENABLED` (off). |
| Q3 | Partial online payments allowed? | **No** in MVP — intent amount = full invoice balance. |
| Q4 | Should provider success auto-verify the payment? | **Yes** — a signature-valid webpush *is* verification → payment born `VERIFIED`, `payment.auto_recorded`. |
| Q5 | Should failed/expired intents auto-expire? | **Yes** — TTL (`PAYMENTS_INTENT_TTL_MINUTES`) → EXPIRED; remain visible in reconciliation. (Expiry sweep needs the deferred scheduler; until then, expiry is computed lazily on read + on next intent creation.) |
| Q6 | Do webhooks create payment directly, or queue for reconciliation? | **Create directly** *only* after signature+idempotency+amount-match pass; any failure of those → no payment, flagged in reconciliation (manual fallback). |

> These defaults are **proposals**, not locked. They will be confirmed (likely
> via a short decision round, as with 1.15A) **before** any 1.15B build begins.
> A `DEC-B24` register entry will record the locked answers at that time.

---

## 13. Implementation sequence (when 1.15B is approved)

1. Migration `…011`: `payment_intent` + `provider_webhook_event` + RLS + indexes (additive).
2. db types + `lib/finance/payment-intent.ts` pure machine + unit tests.
3. Provider abstraction + MockProvider + Wave/OM placeholders + env/capability config.
4. Webhook Route Handler (signature/idempotency/replay/event-log/match/auto-record) + tests.
5. Server actions: `createPaymentIntent` (staff + portal), `cancelPaymentIntent`; reuse `recordPayment` for auto-record.
6. UI: intent status on invoice card; "Intents en ligne" band in `/finance/reconciliation`; staff link generate+send; portal Pay button (flag-off).
7. Communications templates (PAYMENT_LINK / SUCCESS / FAILED).
8. Audit events + i18n.
9. Validate: tsc, vitest, build, boundary grep, secrets check, **RLS regression for the two new tables**, mock end-to-end (create → mock webhook → auto-record → balance drop). Commit per phase; CI green.

---

## Invariants this plan preserves

- **Finance calculations unchanged** — online payment ⇒ a normal `payment` row;
  the 1.11 `paid = Σ non-reversed` formula and 1.15A reconciliation are untouched.
- **RLS unchanged for staff** — new tables add their own finance-gated policies;
  portal access is additive only.
- **Audit append-only** — every provider event is recorded and immutable.
- **No live money in 1.15B** — providers ship `not_configured`; only the Mock
  provider moves an intent end-to-end, behind a default-off flag.
