# WES-7 — Versioned Workflow Policy Registry

**Date:** 2026-07-26 · **Implements:** ADR-WES-012 · **Migration:** `20260726000003_workflow_policy_registry` (61st)
**Depends on:** WES-0/0A (architecture), WES-1 (integrity), WES-2 (canonical projection)

Separates *engine invariants* (code) from *business policy* (versioned configuration), so WES-3, WES-4,
WES-5 and WES-8 write their seat bindings, evidence requirements, routing and SLA targets **as
configuration** rather than hardcoding them and migrating later.

---

## 1. Architecture discovered, and what was reused

| Existing structure | Verdict |
|---|---|
| `expense_template` (11.0B) — version + `DRAFT/ACTIVE/RETIRED` + checksum + `active_from`/`retired_at` | **Closest precedent.** Its lifecycle vocabulary is reused verbatim. It could not be reused as storage: it is a GLOBAL, non-tenant catalogue of PDF metadata with a two-value code CHECK, carrying no document, no tenant scope, no validation state and no activation actor. |
| `tenant_process_rollout` (5.0E-2A) | Boolean feature flags, not versioned content. Its **fail-closed, request-memoized tenant-resolution pattern** is reused by the resolver. |
| `EFFITRANS_PROCESS` (26 steps), `STEP_APPLICABILITY`, `PROCESS_SLA_POLICIES`, `lib/process/roles`, `DOCUMENT_MAPPINGS` | The registries the **platform default is derived from** — not replaced. |
| `role`, `permission`, `document_type` | The **catalogs** policy is validated against. Not a place to store policy. |
| `provision_tenant`, `next_*_number` RPCs | The **atomic multi-table write** precedent, reused for activation. |
| `admin:config:manage` | The existing high-authority configuration permission. **No new privileged permission was invented.** |
| `lib/finance/expense/hash.ts` `canonicalize()` | The **content-hash discipline**, reused rather than re-invented. |

**Hardcoded policy bindings mapped** (what WES-3/4/5/8 would otherwise each duplicate): step→department
(`EFFITRANS_PROCESS[].department`), step→role (`[].role` + `lib/process/roles`), evidence
(`[].requiredDocuments`/`[].requiredEvidence`), applicability (`STEP_APPLICABILITY`), handoff routing
(`[].nextSteps` across a department edge + `lib/handoffs/rules.ts`), SLA (`PROCESS_SLA_POLICIES` +
the four unratified thresholds in `lib/sla/config.ts`), supervisor authority (implicit in permissions).

---

## 2. The code / configuration boundary

**CODE, never configurable.** Tenant isolation · RLS · the permission catalog · legal state-machine
transitions · CAS and idempotency · maker-checker **identity** separation · the monotonic lifecycle ·
audit requirements · append-only ledgers · the evidence-evaluation **framework** · the canonical
projection and its single progress formula.

**CONFIGURATION** — seven domains: applicability · department responsibility · seat/role bindings ·
evidence requirements · handoff routing · supervisor intervention · SLA targets (contract only).

Three of the eight safety boundaries are enforced **structurally**: the schema has no field that could
disable RLS, disable audit, or reorder the lifecycle. That is stronger than validating them away, and a
test asserts those fields stay absent.

---

## 3. Policy schema reference (`policySchemaVersion: 1`)

| Domain | Shape | Notes |
|---|---|---|
| `applicability` | `{ stepKey, anyOf: ApplicabilityFact[] }` | Closed fact vocabulary (file type, mode, customs leg, finance/delivery required). Empty `anyOf` ⇒ always applies. **No expression language** — it could not be validated fail-closed. |
| `departments` | `{ stepKey, department }` | `ProcessDepartment` code. One binding per step. |
| `seats` | `{ stepKey, seat, roles[], identityBound? }` | Seats: uploader · verifier · checker · assignee · supervisor · handoff_recipient. `identityBound` seats carry **no** role. |
| `evidence` | `{ stepKey, documentTypeCodes[], evidenceKeys[], requiresVerification }` | Identifiers only, never labels. |
| `handoffs` | `{ fromStepKey, toStepKey, targetDepartment, targetRole, requiresExplicitReception, notifyOnSend }` | The handoff **mechanism** stays code. |
| `supervisors` | `{ department, mayReassign, mayCompleteByIntervention, mayVerify, mayRequestCorrection, requiresReason: true }` | `requiresReason` is typed `true` and validated — policy can never waive it. |
| `sla` | `{ policyKey, unit, target, warningThreshold, breachThreshold, escalationRoles[], businessCalendarId, pauseSemanticsRef }` | **Stored and validated only.** Nothing computes with it — that is WES-8. |

**Evidence identifiers span two real spaces** and policy may reference either: `document_type.code`
(uploadable documents) and the official document **keys** in `lib/process/documents.ts`, which is what
the 26-step registry's `requiredDocuments` already use. Validating against only one would have rejected
the platform's own default — a finding from implementation, not an assumption.

---

## 4. Version lifecycle

```
DRAFT ──validate──> VALIDATED ──activate──> ACTIVE ──(next activation)──> RETIRED
  ^                     │
  └──────edit───────────┘
```

- A published version (`ACTIVE`/`RETIRED`) is **immutable**: a trigger blocks any change to its
  document, hash, schema version, scope or number. Editing an active policy creates a **new draft**.
- A published version can never be **deleted** — history stays queryable forever.
- A retired version can never be **reactivated**.
- **Exactly one ACTIVE per scope**, enforced by two partial unique indexes (tenant, platform).
- **Duplicate detection**: a draft whose content hash already exists in the scope is refused —
  identical content is not a new policy.

**Content hash** is `sha256` over the *normalized* document: bindings are sets, so they are sorted by
their natural key and their inner string arrays sorted too. Two documents differing only in the order an
operator added rules hash identically — otherwise duplicate detection could never fire. The hash covers
**content only**, never storage metadata.

---

## 5. Resolution order

```
1. the version PINNED to this process instance   (authoritative, immutable)
2. the tenant's ACTIVE override
3. the platform's ACTIVE default
4. the BUILT-IN default derived from the code registries
5. fail closed
```

**Why step 4 exists.** WES-7G requires the registry to reproduce current behaviour exactly on day one.
Until an operator publishes a platform default there is no stored version, and refusing to resolve would
take the workflow offline for a feature nobody has configured. The built-in default is **derived from the
same registries the engine already obeys**, so resolving it changes nothing, and it is reported with
provenance `LEGACY_DEFAULT` — never dressed up as a pinned version.

**Step 5 is real.** A pinned id that cannot be loaded, or a stored document on an unknown schema version,
**fails** rather than falling back. A dossier must never be governed by rules other than the ones it was
pinned to.

One resolver, `lib/workflow/policy/resolver.ts`, server-only and request-memoized. No module implements
its own fallback; a test asserts nothing else reads the table.

---

## 6. Dossier pinning

The policy version is pinned on `process_instance` at creation — beside `process_version`, which already
exists for exactly this purpose.

| Provenance | Meaning |
|---|---|
| `PINNED` | resolved and pinned when the instance was created |
| `LEGACY_DEFAULT` | predates the registry (or no version was active). **Honest marker — historical policy is never fabricated.** |
| `MIGRATED` | moved by an explicit, reasoned, audited action |

**A later activation cannot reach a pinned dossier.** Migration is deliberately narrow: one dossier, an
explicit ACTIVE target of a scope the dossier belongs to, on the current schema version, with a mandatory
reason recorded as an override. There is no bulk migration and no unrestricted migration UI.

---

## 7. Validation and safety boundaries

| # | Boundary | Enforcement |
|---|---|---|
| 1 | No RLS / tenant-isolation bypass | **structural** — no such field exists |
| 2 | No permission outside the catalog | `unknown_permission`; roles validated against the catalog |
| 3 | No audit disabling | **structural** |
| 4 | No maker = checker | `maker_checker_conflict` |
| 5 | No illegal transition | `unknown_step`, `invalid_handoff`, `circular_handoff` |
| 6 | No monotonicity break | **structural** — stage order is code |
| 7 | No emptying mandated evidence | `evidence_required_empty` |
| 8 | No non-existent seat | `unknown_role`, `unknown_department` |

Plus: unknown schema version, **unknown top-level keys** (no untyped JSON is ever accepted), unknown
applicability facts, unknown SLA policy keys, unsupported SLA units, duplicate bindings, and unsafe
supervisor authority. Validation is **deterministic** and **fail-closed**: only a `VALIDATED` +
`PASSED` version of a known schema can ever be activated, re-checked inside the activation RPC.

**Roles are validated per tenant.** A tenant policy validates against *that tenant's* roles; the platform
default validates against the canonical role-template keys. Reading the whole `role` table would have let
one tenant's policy reference a role that exists only in another — caught by the repository's leak guard
during implementation.

---

## 8. Activation atomicity

`activate_workflow_policy(version_id, actor, reason, schema_version)` — a `security definer` RPC that
retires the previous active version and promotes the new one in **one transaction**. The supabase-js
service-role client cannot hold a multi-statement transaction, so an application-side retire-then-promote
would be a dual write: a partial activation would leave a scope with zero or two active versions and the
resolver would start refusing work. The RPC re-checks status, validation outcome, schema version and the
mandatory reason, and refuses otherwise.

---

## 9. RLS and authorization

- **SELECT-only** for `authenticated`, gated on `admin:config:manage`, scoped to
  `tenant_id = auth_tenant_id() OR tenant_id IS NULL` (the shared platform default every tenant runs on).
- **No** authenticated INSERT/UPDATE/DELETE policy. All writes go through the service-role actions.
- **Tenant policy** → `admin:config:manage`, strictly bound to the caller's own tenant.
- **Platform default** → the platform-admin identity, a separate table and auth path — never a tenant
  permission.
- Actor columns on a tenant-scoped version are tenant-verified by trigger.

---

## 10. Operator runbook

**Publish a policy change**
1. Open **Paramètres → Politique de workflow**.
2. *Créer un brouillon* — seeded from the current active version (or the built-in default).
3. *Valider* — failures are listed with domain, path and reason. Fix and re-validate.
4. *Activer* with a **mandatory reason**. The previous version is retired atomically.

**Roll back.** Activate a prior version — which publishes it as a **new** version. Versions are never
mutated or deleted, so rollback is itself an auditable forward step.

**Dossiers already in flight** keep the version they were pinned to. Moving one is a deliberate, reasoned
action per dossier.

**Verify what is live.** The active-version card shows version, scope, activation time, reason and
content hash. When nothing is published it says so plainly and shows the built-in default's hash.

---

## 11. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3516 passed / 163 files** (+59 new) |
| Production build | compiled |
| Migration clean replay | green (no literal tenant insert) |
| Seed idempotency | **unchanged** — `supabase/seed.sql` not modified |
| RLS suite | `supabase/tests/rls_workflow_policy_test.sql`, wired into CI |

---

## 12. Known limitations

1. **No policy is consumed yet.** WES-7G is explicit: the registry must first reproduce current
   behaviour exactly. `resolvePolicy` is the typed seam WES-3/4/5/8 consume; no workflow action reads it
   today, so behaviour is byte-for-byte unchanged. Migrating lookups is those phases' work.
2. **No platform default row is seeded.** Seeding a frozen SQL copy would create the second source of
   truth this phase exists to remove. Until an operator publishes one, dossiers resolve the built-in
   default and are marked `LEGACY_DEFAULT`.
3. **The editor is intentionally minimal** — draft-from-active, validate, activate, compare. No
   free-form authoring, no expression language, no place to type a role, permission or SQL. Structured
   per-domain editing arrives when a phase actually needs to change a binding.
4. **`policy_schema_version` is 1.** There is no migration path between schema versions yet; a stored
   document on an unknown version fails resolution rather than being coerced.
5. **SLA is contract-only.** Targets are stored and validated; no clock, calendar or escalation exists.
   The four unratified thresholds in `lib/sla/config.ts` are carried through unchanged and still await
   WES-8's explicit ratify-or-retire decision.
6. **Legacy dossiers are not backfilled.** Their historical policy was never recorded and is not
   invented.
