-- 20260616000001_finance_file_read.sql
-- Phase 1.19 (A1) — unblock the Finance Officer billing flow.
-- ---------------------------------------------------------------------------
-- Invoices, charges and payments are authored on the file detail page
-- (/files/[id]). That page's render gate and the operational_file SELECT RLS
-- both require the literal `file:read` permission, and the row-level scope
-- (can_read_file -> user_readable_file_ids) only returns a dossier the user is
-- assigned to UNLESS they also hold `file:read:all`. A finance officer is never
-- assigned to dossiers, so without BOTH grants getFile() returns null, the file
-- page 404s, and the finance panel never renders — leaving FINANCE_OFFICER
-- unable to exercise its finance:* permissions.
--
-- Grant tenant-wide file READ (read-only) so finance can open any dossier to
-- bill it. This adds NO write capability (no file:create/update/delete) and does
-- NOT touch customs release or document approval permissions. Mirrored in
-- seed.sql. Forward-only, idempotent.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
