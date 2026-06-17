-- 20260617000001_task_handoff_type.sql
-- Effitrans Operations Platform — PHASE 2.1: Automatic department handoff tasks.
-- ---------------------------------------------------------------------------
-- Reuses the EXISTING task table (no second task system, no department_tasks).
-- Adds a nullable `handoff_type` discriminator for the four department handoffs,
-- plus a PARTIAL UNIQUE INDEX that hard-enforces idempotency: at most one OPEN
-- (status not DONE/CANCELLED) handoff task of a given type per dossier — the
-- race-proof backstop behind the app-level pre-check.
--
-- SCOPE GUARD: additive column + indexes only. NO RLS change (task_select stays
-- tenant + task:read + can_read_task). No new permission. Forward-only.

alter table public.task
  add column if not exists handoff_type text
    check (handoff_type is null or handoff_type in
      ('CUSTOMS_HANDOFF', 'TRANSPORT_HANDOFF', 'FINANCE_HANDOFF', 'ARCHIVE_HANDOFF'));

-- Hard idempotency: one open handoff task per (dossier, type).
create unique index if not exists idx_task_open_handoff
  on public.task (file_id, handoff_type)
  where handoff_type is not null and status not in ('DONE', 'CANCELLED');

-- Department dashboard counts by handoff type.
create index if not exists idx_task_handoff
  on public.task (tenant_id, handoff_type)
  where handoff_type is not null;
