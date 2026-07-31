-- =========================================================================
-- R1.0-R Verification Addendum — consolidated READ-ONLY evidence script
-- Migrations 57–67 (20260724000002 … 20260727000005)
-- =========================================================================
-- Paste into the Supabase SQL Editor as-is. One result set: every row is one
-- check with a boolean `passed`. ALL rows must be true (including the negative
-- controls, which are phrased so that "probe works" = true) before the
-- sixteen-version ledger repair may run.
--
-- READ-ONLY BY CONSTRUCTION: only SELECTs over catalogs and information_schema.
-- No writes, no temp objects, no DDL, no privileged commands.
--
-- Verification standard applied: a table's existence is used only where that
-- table was UNIQUELY introduced by the migration under test. Where a migration
-- replaced a function / widened a constraint / inserted catalog rows, the check
-- inspects the versioned change itself (pg_get_functiondef, pg_get_constraintdef,
-- permission/role_permission rows).
-- =========================================================================

select * from (

-- ------------------------------------------------------------ negative controls
select '00-control' as migration, 'nonexistent table returns NULL' as check_name,
       (to_regclass('public.__r1_0_nonexistent_control__') is null) as passed,
       coalesce(to_regclass('public.__r1_0_nonexistent_control__')::text, 'NULL (correct)') as detail
union all
select '00-control', 'nonexistent function not found',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = '__r1_0_no_such_fn__'),
       'expect true'
union all
select '00-control', 'nonexistent permission row not found',
       not exists (select 1 from public.permission where code = 'zz:never:granted'),
       'expect true'

-- ------------------------------------------------------ 57 · 20260724000002 hr_employee_registry
union all
select '57 20260724000002', 'employee table (unique to 57)',
       to_regclass('public.employee') is not null, coalesce(to_regclass('public.employee')::text,'ABSENT')
union all
select '57 20260724000002', 'employee_counter table (unique to 57)',
       to_regclass('public.employee_counter') is not null, ''
union all
select '57 20260724000002', 'next_employee_number function',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='next_employee_number'), ''
union all
select '57 20260724000002', 'hr:read + hr:manage permission rows',
       (select count(*) from public.permission where code in ('hr:read','hr:manage')) = 2,
       (select string_agg(code, ', ') from public.permission where code like 'hr:%')

-- ------------------------------------------------------ 58 · 20260725000001 expense_documents
union all
select '58 20260725000001', 'expense_voucher_counter table (unique to 58)',
       to_regclass('public.expense_voucher_counter') is not null, ''
union all
select '58 20260725000001', 'expense_visa table (created HERE, not in 60)',
       to_regclass('public.expense_visa') is not null, ''
union all
select '58 20260725000001', 'finance:expense:* permission rows (6)',
       (select count(*) from public.permission where code like 'finance:expense:%') = 6,
       (select count(*)::text || ' rows' from public.permission where code like 'finance:expense:%')

-- ------------------------------------------------------ 59 · 20260726000001 expense_attachments
union all
select '59 20260726000001', 'expense_attachment table (unique to 59)',
       to_regclass('public.expense_attachment') is not null, ''

-- ------------------------------------------------------ 60 · 20260726000002 expense_approval_chain
-- NOTE: no table of its own. Fingerprints = the visa-attempt unique index and
-- the signer grants (DEC-C11: finance:expense:sign was granted to NOBODY by 58).
union all
select '60 20260726000002', 'uq_expense_visa_attempt_step index',
       exists (select 1 from pg_indexes where schemaname='public'
                and indexname='uq_expense_visa_attempt_step'), ''
union all
select '60 20260726000002', 'signer grants exist (TREASURER holds finance:expense:sign)',
       exists (select 1 from public.role_permission rp
                 join public.role r on r.id = rp.role_id
                 join public.permission p on p.id = rp.permission_id
                where p.code = 'finance:expense:sign' and r.code = 'TREASURER'),
       (select string_agg(distinct r.code, ', ' order by r.code)
          from public.role_permission rp
          join public.role r on r.id = rp.role_id
          join public.permission p on p.id = rp.permission_id
         where p.code = 'finance:expense:sign')

-- ------------------------------------------------------ 61 · 20260726000003 workflow_policy_registry
union all
select '61 20260726000003', 'workflow_policy_version table (unique to 61)',
       to_regclass('public.workflow_policy_version') is not null, ''
union all
select '61 20260726000003', 'uq_workflow_policy_tenant_active index',
       exists (select 1 from pg_indexes where schemaname='public'
                and indexname='uq_workflow_policy_tenant_active'), ''

-- ------------------------------------------------------ 62 · 20260726000004 business_event_ledger
union all
select '62 20260726000004', 'business_event table (unique to 62)',
       to_regclass('public.business_event') is not null, ''
union all
select '62 20260726000004', 'business_event.causation_id column (baseline shape — proves 62, NOT 63)',
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='business_event'
                  and column_name='causation_id'), ''
union all
select '62 20260726000004', 'emit_business_event function exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='emit_business_event'), ''

-- ------------------------------------------------------ 63 · 20260727000001 business_event_atomicity
-- Function REPLACEMENT: existence proves nothing (62 created it). The versioned
-- fingerprint is WES-9A's Model-A abort marker: SQLSTATE 'EF001' appears in the
-- replaced bodies (15 occurrences in 63's file; zero in 62's).
union all
select '63 20260727000001', 'emit_business_event body carries the EF001 abort marker',
       coalesce((select pg_get_functiondef(p.oid) like '%EF001%'
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='emit_business_event'
                  limit 1), false), ''
union all
select '63 20260727000001', 'emit_dossier_events body carries EF001',
       coalesce((select pg_get_functiondef(p.oid) like '%EF001%'
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='emit_dossier_events'
                  limit 1), false), ''

-- ------------------------------------------------------ 64 · 20260727000002 assignment_history
union all
select '64 20260727000002', 'assignment_event table (unique to 64)',
       to_regclass('public.assignment_event') is not null, ''
union all
select '64 20260727000002', 'assign_task RPC exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='assign_task'), ''

-- ------------------------------------------------------ 65 · 20260727000003 document_governance
union all
select '65 20260727000003', 'document_review table (unique to 65)',
       to_regclass('public.document_review') is not null, ''
union all
select '65 20260727000003', 'document.superseded_by_id column (added by 65)',
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='document'
                  and column_name='superseded_by_id'), ''
union all
select '65 20260727000003', 'document_status_check widened (CONSUMED_AS_EVIDENCE present)',
       coalesce((select pg_get_constraintdef(oid) like '%CONSUMED_AS_EVIDENCE%'
                   from pg_constraint
                  where conname='document_status_check'
                  limit 1), false),
       coalesce((select left(pg_get_constraintdef(oid), 120) from pg_constraint
                  where conname='document_status_check' limit 1), 'constraint ABSENT')

-- ------------------------------------------------------ 66 · 20260727000004 generated_artifacts
union all
select '66 20260727000004', 'document.artifact_code column (added by 66)',
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='document'
                  and column_name='artifact_code'), ''
union all
select '66 20260727000004', 'finalize_generated_artifact function',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='finalize_generated_artifact'), ''

-- ------------------------------------------------------ 67 · 20260727000005 process_reconciliation
union all
select '67 20260727000005', 'evidence_consumption table (unique to 67)',
       to_regclass('public.evidence_consumption') is not null, ''
union all
select '67 20260727000005', 'reconcile_step_completion function (catalog check — REST RPC probes are unreliable for signature reasons)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='reconcile_step_completion'), ''
union all
select '67 20260727000005', 'business_event domain constraint widened to include ''process''',
       coalesce((select pg_get_constraintdef(oid) like '%process%'
                   from pg_constraint
                  where conname='business_event_event_domain_check'
                  limit 1), false),
       coalesce((select left(pg_get_constraintdef(oid), 120) from pg_constraint
                  where conname='business_event_event_domain_check' limit 1), 'constraint ABSENT')

) checks
order by migration, check_name;
