# Phase 7.1B — Customs Intelligence persistence decision

**Decision: Option A — additive columns on `customs_record`.** No satellite table.

## Context

Phase 7.1A shipped the pure Customs Intelligence layer (`lib/customs/intelligence/`):
a canonical, provider-driven declaration lifecycle (`DRAFT → … → COMPLETED/REJECTED/
CANCELLED`), a provider abstraction (`CustomsEngine`, `ManualProvider`, `GaindeProvider`
stub), an immutable timeline projected from the audit log, and pure dashboard aggregates.
Nothing was persisted — the canonical status lived only in memory.

7.1B persists that canonical state **without disturbing the existing operational model**:

- `customs_record` is the 1:1 declaration record (unique `file_id`), tenant-scoped, with
  the CI-tested `customs_record_select` RLS policy and a tenant-matching trigger.
- `lib/customs/status.ts` owns the **operational** state machine (`NOT_STARTED …
  RELEASED/BLOCKED/CANCELLED`). It is **not** replaced. The canonical intelligence
  lifecycle is a **distinct** dimension, stored alongside it.

## The two candidates

**Option A — additive columns on `customs_record`.**
**Option B — a satellite table `customs_intelligence_state` (FK to `customs_record`).**

Per the brief, choose the **smallest** model the architecture justifies, and never build both.

## Why Option A

A satellite table (Option B) is justified only when the provider lifecycle is *materially
separate*, when *multiple providers or attempts* must be represented as distinct rows, when
sync metadata would *overload* the parent, or when historical state needs *independent
constraints*. **None of those hold here:**

1. **The declaration is already 1:1 with `customs_record`** (`file_id` is unique). The
   canonical status is one more attribute of that same declaration — not a separate entity.
2. **One active provider per declaration** in this phase. There is no multi-provider or
   multi-attempt requirement, so no need for multiple rows per declaration.
3. **Sync metadata is a handful of columns**, not a payload. It does not overload the record.
4. **History already has a home.** The immutable timeline is projected from the append-only
   `audit_log` (reusing `CUSTOMS_STATUS_CHANGED`), so we do not need an independent history
   table with its own constraints.
5. **A satellite table would duplicate infrastructure** — its own RLS policy, its own
   tenant-matching trigger, its own FK and grants — to describe a strictly 1:1 relationship.
   That is more surface area (and more that can drift) for zero added capability.

Option A reuses the existing RLS policy, the existing tenant trigger, the existing grants,
and the existing `updated_at` trigger. It is the smaller, safer model.

## What is added (all additive, forward-only, nullable/defaulted)

| Column | Type | Purpose |
|---|---|---|
| `intel_status` | `text NOT NULL default 'DRAFT'` (CHECK: 10 canonical values) | canonical provider-driven status — **distinct** from operational `status` |
| `provider_code` | `text NOT NULL default 'manual'` (CHECK: `manual`,`GAINDE`) | which provider drives the declaration |
| `provider_reference` | `text` (nullable) | the provider's declaration reference (engine-set) |
| `provider_synced_at` | `timestamptz` (nullable) | last provider sync attempt |
| `provider_error` | `text` (nullable, CHECK: ProviderError set) | last **safe** provider error category |
| `intel_version` | `integer NOT NULL default 0` | optimistic lock for **compare-and-set** transitions |
| `submitted_at` | `timestamptz` (nullable) | canonical SUBMITTED time (clearance-time numerator) |
| `released_at` | `timestamptz` (nullable) | canonical RELEASED time |

Notes on honesty and non-duplication:

- `provider_reference` is **engine-managed** and kept distinct from the existing manually
  edited `external_ref` (the human-entered "GAINDE/Orbus number") so the manual-edit path
  can never clobber engine state.
- No raw provider payload, credential, or token is ever stored on the declaration row.
- Transition metadata (in `audit_log`) carries only status/provider/reason — never document
  contents.
- `intel_status` is deliberately **separate** from operational `status`; the two state
  machines stay independent.

## Constraints, indexes, RLS

- CHECK constraints pin `intel_status`, `provider_code`, and `provider_error` to closed
  vocabularies.
- Indexes (all `where deleted_at is null` where tenant-scoped):
  `(tenant_id, intel_status)`, `(tenant_id, provider_code)`, `(tenant_id, updated_at desc)`,
  and a partial `(provider_reference) where provider_reference is not null` for sync lookups.
- **No RLS change.** The new columns live on `customs_record` and inherit
  `customs_record_select` (tenant + `customs:read` + `can_read_file` + not-deleted). Writes
  remain service-role-only and permission-gated in server actions. No new grant.
- **No new permission.** Reads reuse `customs:read`; manual transitions reuse `customs:update`;
  the RELEASED transition reuses `customs:release` (the existing BAE authority).

## Compare-and-set

Transitions update `... set intel_status = <to>, intel_version = intel_version + 1 …
where id = <id> and tenant_id = <tenant> and intel_version = <expected> and deleted_at is
null` and require exactly one affected row. A stale or concurrent transition affects zero
rows and is rejected — no lost update.
