-- 20260716000003_customs_intelligence_state.sql
-- Effitrans Operations Platform — PHASE 7.1B: persist the canonical Customs
-- Intelligence lifecycle (7.1A) ON TOP of the existing customs_record.
--
-- DECISION (docs/phase-7.1b-persistence-decision.md): ADDITIVE COLUMNS, not a
-- satellite table. The declaration is already 1:1 with customs_record; there is a
-- single active provider and no multi-attempt requirement; history already lives
-- in the append-only audit_log (reused CUSTOMS_STATUS_CHANGED). A satellite table
-- would only duplicate RLS/trigger/grant infrastructure for a strictly 1:1 fact.
--
-- The canonical provider-driven lifecycle (intel_status) is DISTINCT from the
-- existing OPERATIONAL status (customs_record.status / lib/customs/status.ts). Both
-- state machines stay independent; neither is replaced.
--
-- SCOPE GUARD: no external customs API (GAINDE stays not_configured — the project
-- integrates GAINDE/Orbus BY REFERENCE, not by API; BLK-1 remains open). No OCR, no
-- AI, no new table, no new permission. RLS inherits customs_record_select; writes
-- remain service-role + permission-gated in server actions. No new grant.

-- ===========================================================================
-- 1. Canonical intelligence lifecycle state (additive, forward-only).
-- ===========================================================================
alter table public.customs_record
  add column if not exists intel_status text not null default 'DRAFT'
    check (intel_status in ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'UNDER_REVIEW', 'INSPECTION',
                            'AWAITING_PAYMENT', 'RELEASED', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  -- Which provider drives the declaration. 'manual' is the current reality (customs
  -- tracked by hand); 'GAINDE' is reserved for the real adapter (7.1C, when an official
  -- contract is available). Constrained; widen when a new provider is genuinely wired.
  add column if not exists provider_code text not null default 'manual'
    check (provider_code in ('manual', 'GAINDE')),
  -- Engine-managed provider reference. Kept DISTINCT from external_ref (the manually
  -- edited "GAINDE/Orbus number") so the manual-edit path never clobbers engine state.
  add column if not exists provider_reference text,
  add column if not exists provider_synced_at timestamptz,
  -- Last SAFE provider error category (never a raw message/stack). Matches the
  -- ProviderError union in lib/customs/intelligence/provider.ts.
  add column if not exists provider_error text
    check (provider_error is null or provider_error in
      ('not_configured', 'unavailable', 'invalid_declaration', 'rejected', 'timeout')),
  -- Optimistic lock for compare-and-set transitions (no lost update / no stale write).
  add column if not exists intel_version integer not null default 0,
  -- Canonical lifecycle timestamps (nullable; set on the respective transition).
  -- submitted_at is the clearance-time numerator; released_at the canonical release.
  add column if not exists submitted_at timestamptz,
  add column if not exists released_at timestamptz;

-- ===========================================================================
-- 2. Indexes for the console (status/provider filters, recency ordering) and the
--    provider-reference sync lookup. Partial on the live (not soft-deleted) set.
-- ===========================================================================
create index if not exists idx_customs_intel_status
  on public.customs_record (tenant_id, intel_status) where deleted_at is null;
create index if not exists idx_customs_intel_provider
  on public.customs_record (tenant_id, provider_code) where deleted_at is null;
create index if not exists idx_customs_intel_updated
  on public.customs_record (tenant_id, updated_at desc) where deleted_at is null;
create index if not exists idx_customs_intel_provider_ref
  on public.customs_record (provider_reference) where provider_reference is not null;

-- ===========================================================================
-- 3. RLS / permissions: unchanged. The new columns live on customs_record and
--    inherit customs_record_select (tenant + customs:read + can_read_file + not
--    deleted). Writes remain service-role-only; reads reuse customs:read, manual
--    transitions customs:update, and the RELEASED transition customs:release.
--    No new policy, grant, or permission row.
-- ===========================================================================
