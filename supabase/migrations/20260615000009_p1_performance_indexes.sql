-- 20260615000009_p1_performance_indexes.sql
-- Effitrans Operations Platform — PERFORMANCE P1: index audit (additive).
--
-- Composite indexes for the hot read paths surfaced in the P1 audit
-- (docs/performance-p1.md). All IF NOT EXISTS, additive, no data/RLS change.
-- NOTE: at production scale, prefer CREATE INDEX CONCURRENTLY (run outside a
-- migration transaction) to avoid write locks; at current volume plain creation
-- is fine.

-- Audit log page: tenant-scoped, ordered by occurred_at desc, paginated.
create index if not exists idx_audit_log_tenant_occurred
  on public.audit_log (tenant_id, occurred_at desc);

-- Analytics avg-closure-time: CLOSED transitions per tenant.
create index if not exists idx_fst_tenant_status
  on public.file_state_transition (tenant_id, to_status);

-- Recent dossiers + new-per-month + analytics scans: tenant + created_at desc.
create index if not exists idx_operational_file_tenant_created
  on public.operational_file (tenant_id, created_at desc);

-- Analytics revenue-by-month + financial filters: tenant + issue_date.
create index if not exists idx_invoice_tenant_issue
  on public.invoice (tenant_id, issue_date);

-- Communications recipients + portal lookups: tenant + client.
create index if not exists idx_client_user_tenant_client
  on public.client_user (tenant_id, client_id);
