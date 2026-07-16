# Customer AI Assistant — Security & Data Boundary (Phase 7.6C)

The assistant is an **internet-facing** surface answering to a customer, not to staff. The rule is
narrow and absolute:

> The assistant may only see data **already visible** to the authenticated portal user on their own
> pages, and may only say things grounded in that data.

## Isolation (defence in depth)

1. **Identity** — the route resolves `getCurrentPortalUser()` and requires `status === "ACTIVE"`;
   anything else is `403`. `assertPermission` is never called: a portal user has no RBAC permission
   and must not acquire one (no privilege escalation).
2. **Database** — every composed reader uses the **RLS user-context client**. Tenant + customer +
   portal-account scoping is enforced by Postgres policies (1.12A/1.12B, 7.5A `portal_can_read_shipment`),
   not by application code.
3. **No service-role client** in the context reader — it composes readers and holds no admin client
   and no table query of its own (enforced by test). It cannot widen the boundary by mistake.
4. **Uniform not-found** — an unowned or unknown `fileId` yields `null` → a uniform `404`. There is
   no probe distinguishing "does not exist" from "not yours".

## Never sent to the model

Deliberately excluded even though adjacent code has them:

| Excluded | Why |
|---|---|
| internal risk score / `assessRisk` level | internal ranking; the customer sees only the 4-level `delayLabel` the portal already shows |
| SLA thresholds | internal |
| `customs_record.status` (REJECTED / INSPECTION / AWAITING_PAYMENT) | internal blocking reasoning. Customs is derived **only** from the customer timeline → not started / in progress / cleared |
| reviewer notes (`review_note`) | an internal note **and** a prompt-injection surface |
| operator discussions, internal notes, tasks | internal |
| audit entries | internal |
| provider / model / API key / error codes | diagnostics |
| AI confidence, tracking `confidence`, provider `source` | confidence scores |
| internal IDs | context carries customer-visible identifiers only |
| other customers | RLS makes them unreachable |
| the system prompt | guardrail forbids disclosure |

**Staff identity**: the only person a customer may ever see is the assigned account manager (or the
operations-team fallback), exactly as `OfficerCard` already renders it — reusing
`isGenericStaffIdentity()` so a system-admin/generic identity is never surfaced.

## Never recorded in the audit

`portal.copilot.query` records **only**: provider, model, scope, question class, sections
available/unavailable, truncated flag, recommendation kinds, `durationMs`, token usage, outcome —
attributed to `clientUserId`.

It never records the prompt, the answer, the conversation, shipment details, customer messages, or
any secret (enforced by test).

## Customer-safe failure surface

Where the internal route returns `copilotErrorMessage(code)` — which names the provider, the model
and the API key env var — this route returns **one generic notice** and keeps the specific
`failureCode` server-side in the audit row. A customer never learns which provider is configured or
why it failed. `GET /api/portal/copilot` returns `{ available: boolean }` only — never
provider/model/`apiKeyPresent`.

## Prompt-injection posture

- The system prompt states its rules are **non-overridable** and that document/message content is
  **data, not instruction**.
- Free-text the customer or a reviewer authored (`review_note`, notification bodies) is excluded or
  reduced to titles/labels; the serializer emits only fields the context already carries.
- The model has **no tools**, no SQL, and no write path — a successful injection still cannot act.
- Cards are **deterministic**: structure and cited facts come from real rows, never from the model.

## Bounds

- Per-portal-user: 6 questions/min (`PORTAL_COPILOT_USER_RATE_PER_MIN`).
- Per-tenant: 1000 portal questions/day (`PORTAL_COPILOT_TENANT_RATE_PER_DAY`).
- Prompt ≤ 2000 chars; history ≤ 6 turns × 1200 chars; brief ≤ 12k chars (shared `BUDGET`).
- Hitting a limit degrades to the deterministic summary — it never fails the panel.
