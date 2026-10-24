-- migrate:executor db-query
-- ===========================================================================
-- Migration 162 — WP1 closure hardening: audit_log refuses TRUNCATE.
-- ===========================================================================
-- WHAT WAS WRONG. audit_log is append-only against UPDATE and DELETE
-- (trg_audit_log_no_update / trg_audit_log_no_delete → prevent_mutation(),
-- foundation migration). TRUNCATE is neither: it is not a row operation, so
-- no row trigger sees it, and RLS does not govern it. Measured read-only in
-- production on 2026-10-23: anon, authenticated and service_role each hold
-- TRUNCATE on audit_log (Supabase's default privileges, arwdDxtm), and the
-- owner holds it by ownership. A plain `truncate audit_log` is refused today
-- only BY ACCIDENT — expense_visa.audit_log_id is a foreign key to it — and
-- `truncate audit_log cascade` would empty the audit trail AND every expense
-- signature in one statement. PostgREST has no TRUNCATE verb, so no browser
-- session and no service-key call could do it; the exposure is direct SQL — an
-- operator's SQL-editor session, a script, a future migration.
--
-- WHAT THIS DOES — the smallest change that closes it, the same two layers
-- migration 161 gave the document-expiry history:
--   1. A statement-level BEFORE TRUNCATE trigger on prevent_mutation(): refused
--      for every role, the owner included, whatever the grants and with or
--      without CASCADE. This is the layer that does not depend on privileges a
--      later broad GRANT could restore (the CI-REPAIR-02 lesson).
--   2. REVOKE TRUNCATE from PUBLIC, anon, authenticated and service_role, so the
--      API roles are refused before the trigger is even reached. NOTHING ELSE
--      CHANGES: INSERT stays (the server records audit rows through the service
--      role), SELECT stays (RLS scopes it), UPDATE and DELETE stay refused by
--      the existing triggers.
--
-- LIMIT, stated plainly: the owner can still drop or disable the trigger, and a
-- superuser can bypass ordinary triggers (session_replication_role = replica).
-- This guard stops accidents and every non-owner role; it is not a defence
-- against a deliberate owner. Dropping it is a reviewed migration.
--
-- WHAT IT DOES NOT DO.
--   * No other table. The other append-only tables that lack a TRUNCATE guard
--     are a follow-up, listed in docs/releases/WP1/security-findings.md.
--   * No data is read or rewritten. Re-running it is a no-op.
-- ===========================================================================

-- LOCKS. audit_log is written by nearly every server action, so this takes the
-- lightest lock that installs a trigger: CREATE OR REPLACE TRIGGER holds SHARE
-- ROW EXCLUSIVE — readers are never blocked, writers wait only for the catalog
-- change — where the usual `drop trigger if exists` would take ACCESS EXCLUSIVE
-- and block every reader too. The governed runner's lock_timeout (3 s) bounds
-- the wait; a timeout rolls the whole migration back and records nothing.
-- (CREATE OR REPLACE TRIGGER needs PostgreSQL 14+: production runs 17, CI 15.)
create or replace trigger trg_audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.prevent_mutation();

revoke truncate on public.audit_log from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Self-assertions, exercised at migration time: a wrong result aborts the
-- whole migration instead of applying it and leaving the ledger unwritten.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.audit_log'::regclass
       and t.tgname = 'trg_audit_log_no_truncate'
       and p.proname = 'prevent_mutation'
       and (t.tgtype & 2) <> 0     -- BEFORE
       and (t.tgtype & 32) <> 0    -- TRUNCATE
       and (t.tgtype & 1) = 0      -- statement level
       and t.tgenabled <> 'D'
  ) then
    raise exception 'MIGRATION FAILED: TRUNCATE on audit_log is not refused';
  end if;

  if (select count(*) from pg_trigger
       where tgrelid = 'public.audit_log'::regclass
         and tgname in ('trg_audit_log_no_update', 'trg_audit_log_no_delete')) <> 2 then
    raise exception 'MIGRATION FAILED: audit_log no longer refuses UPDATE and DELETE';
  end if;

  if exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(role)
     where to_regrole(r.role) is not null
       and has_table_privilege(r.role, 'public.audit_log', 'TRUNCATE')
  ) then
    raise exception 'MIGRATION FAILED: an API role still holds TRUNCATE on audit_log';
  end if;

  raise notice 'audit_log TRUNCATE guard installed';
end $$;
