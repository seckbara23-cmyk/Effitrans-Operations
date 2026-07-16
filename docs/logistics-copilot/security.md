# Logistics Copilot — Security

**Phase 7.6A.** Read-only, permission-gated, tenant-scoped, safely audited, provider-neutral.

## Permission — `logistics:copilot:read` (independent, no inheritance)

A new tenant permission gates the whole feature. Added consistently across **four** surfaces (parity
enforced by `tests/role-templates.test.ts`):

- migration `20260718000001_logistics_copilot.sql` (additive; idempotent catalog insert + tenant-
  guarded grant — clean-replay safe),
- `supabase/seed.sql` (source of truth for CI),
- `lib/platform/role-templates.ts` (the 17 internal operational-staff templates),
- and the audit action in `lib/audit/events.ts`.

**Granted to** internal operational staff (the roles that already hold `process:read`): SYSTEM_ADMIN,
CEO, OPS_SUPERVISOR, ACCOUNT_MANAGER, COORDINATOR, CHIEF_OF_TRANSIT, CUSTOMS_DECLARANT,
TRANSPORT_OFFICER, FINANCE_OFFICER, COMPLIANCE_HSSE, BILLING_OFFICER, CUSTOMS_FINANCE_OFFICER,
CUSTOMS_FIELD_AGENT, PICKUP_AGENT, ADMINISTRATIVE_OFFICER, COURIER, COLLECTIONS_OFFICER.

**Never granted to** `CLIENT_USER` (the customer portal — it receives *no* copilot), `PARTNER_AGENT`,
or `DRIVER` (whose exact permission set is asserted in CI). Platform admins keep the separate
**Platform Copilot** (`platform:copilot:read`); the two are independent, and there is **no privilege
inheritance** — a `logistics:copilot:read` holder gains no admin/transport/customs/finance write
capability from it.

## Read-only + tenant isolation

- The route gates on `logistics:copilot:read` (403 otherwise) and the context builder composes only
  **existing read services**, each of which self-gates on its domain permission (`transport:read`,
  `customs:read`, `finance:read`, `document:read`) and is tenant-scoped. A domain the caller can’t
  read is recorded in `unavailable` — never leaked.
- The Copilot module graph imports **no** mutation path — no `actions`/`manage-actions`, no
  `notifyCustomer`, no `.insert/.update/.delete` (asserted by test). The only write is the audit row.
- The context never exposes another tenant’s data; RLS + the domain readers’ tenant filters are
  inherited unchanged (no new tables, no new RLS).

## Provider neutrality

The route reuses `runCopilot` (`lib/copilot/engine`) → `lib/ai` — it never imports a provider, an SDK,
or `generateAI` directly (asserted by test). Switching OpenAI ↔ Ollama ↔ vLLM is configuration. The
provider sends no tools.

## Audit — safe metadata only

Every query records `LOGISTICS_COPILOT_QUERY` with **actor, tenant, provider, model, modules
consulted, recommendation count, duration, outcome** (`answered` / `fallback`). It records **never**
the prompt body, the answer, or any secret (asserted by test; mirrors `PLATFORM_COPILOT_QUERY`). The
provider layer separately logs one secret-free diagnostic line (no key, no prompt, no content).

## Fallback (availability, not a security bypass)

If the provider fails, the route returns the **deterministic summary** (HTTP 200) — grounded, no
fabrication — so the UI never fails. The fallback path is audited with `outcome: "fallback"` and is
subject to the same permission gate and tenant scope.

## Bounded (no tenant-wide scan)

Each context source is page-0, ≤100 rows; the caps are disclosed. The Copilot cannot be used to
exfiltrate the full tenant dataset.
