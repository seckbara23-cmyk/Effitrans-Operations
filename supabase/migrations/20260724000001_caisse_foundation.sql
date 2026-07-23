-- 20260724000001_caisse_foundation.sql
-- Effitrans Operations Platform — PHASE 9.3A: Caisse & Trésorerie foundation.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Introduces the ORGANIZATIONAL + AUTHORIZATION foundation for the
-- Finance "Caisse" (multi-channel treasury) workspace:
--   * the dedicated `caisse:manage` permission, and
--   * the CASHIER tenant role (the 24th), mapped to the FINANCE canonical
--     department (department mapping is metadata, in lib/organization/
--     departments.ts — never stored as a column).
--
-- CAISSE IS NOT A DEPARTMENT (FINANCE remains the department; Caisse is a
-- workspace under it) and CAISSIER/CAISSIÈRE IS ONLY A ROLE LABEL, never a
-- navigation/department/workspace label.
--
-- SEGREGATION OF DUTIES: `caisse:manage` is operational treasury HANDLING /
-- RECORDING. It is deliberately DISTINCT from finance AUTHORIZATION
-- (finance:validate / finance:issue / finance:void / finance:delete /
-- finance:payment) and from collections:manage — so a Cashier may later
-- execute/record an approved transaction without gaining authority to approve
-- the underlying request.
--
-- NO treasury/cash/bank/wallet/check/transaction/reconciliation TABLES are
-- created in this phase (that is a future treasury-neutral domain phase). NO
-- existing role or grant is modified. Clean-replay safe: the role insert is a
-- guarded backfill and the grants are select-driven (they match zero rows on an
-- empty DB, where supabase/seed.sql owns creation); on production (tenant
-- 00000000-…-0001 already present) they materialize.

-- ===========================================================================
-- 1. Permission catalog (GLOBAL reference data — no tenant).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('caisse:manage', 'caisse', 'manage', 'own', 'Gérer les opérations de caisse et de trésorerie')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. CASHIER role for the Effitrans tenant. Guarded backfill (no-op on an empty
--    database — seed.sql creates it there). No businessProfile: a general role.
-- ===========================================================================
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', 'CASHIER', 'Caissier / Caissière', 'Cashier', true
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- ===========================================================================
-- 3. CASHIER grants — LEAST PRIVILEGE.
--    profile:read/update:self (baseline) · finance:read (Finance module
--    visibility, read-only) · caisse:manage (treasury operations) · process:read
--    (READ-ONLY; required for the "Mon Travail" workspace builder to surface the
--    Caisse workspace — every finance operational role, e.g. COLLECTIONS_OFFICER,
--    already holds it; it grants NO authorization and is dark until the process
--    workspaces flag is on).
--    Deliberately NOT: finance:validate / finance:issue / finance:void /
--    finance:delete / finance:payment / collections:manage / admin_service:manage.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'finance:read', 'caisse:manage', 'process:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CASHIER'
on conflict do nothing;

-- ===========================================================================
-- 4. Supervisory oversight of caisse:manage. SYSTEM_ADMIN follows the platform's
--    full-admin grant convention; OPS_SUPERVISOR is the operations/finance
--    supervisory role (there is NO separate Finance Manager role, and this phase
--    does not create one). Deliberately NOT granted to FINANCE_OFFICER,
--    BILLING_OFFICER, COLLECTIONS_OFFICER, CUSTOMS_FINANCE_OFFICER,
--    ADMINISTRATIVE_OFFICER or COURIER.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'caisse:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;
