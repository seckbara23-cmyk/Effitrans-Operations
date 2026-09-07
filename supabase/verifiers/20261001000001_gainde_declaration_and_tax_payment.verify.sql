-- VERIFIER for 20261001000001_gainde_declaration_and_tax_payment
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT A VERIFIER IS FOR. The migration's own `do $$ … raise exception` blocks
-- protect the moment of application and can never run again. This is the
-- durable postcondition: what the integrity guard runs months later to answer
-- the question a ledger comparison cannot — is this migration actually applied,
-- or merely unrecorded?
--
-- SO IT CHECKS MEANING, NOT NAMES. « A table called gainde_tax_payment exists »
-- would pass against a table with RLS disabled, a portal policy attached, the
-- balance trigger dropped and the RPC executable by `anon` — every one of which
-- would break the slice. Each assertion below names a property the slice would
-- be WRONG without.
-- ===========================================================================
with checks(label, ok) as (
  values
    -- ---- 1. The Déclarant's fact exists, and is nullable ------------------
    -- NOT NULL would have rejected every dossier predating the slice.
    ('the three declaration-reference columns exist and are nullable', (
      select count(*) = 3 and bool_and(is_nullable = 'YES')
        from information_schema.columns
       where table_schema = 'public' and table_name = 'customs_record'
         and column_name in ('gainde_declaration_reference',
                             'gainde_declaration_recorded_by',
                             'gainde_declaration_recorded_at')
    )),

    -- Half a fact is not a fact: a reference with no author or no date would
    -- be unattributable, which is what the constraint prevents.
    ('the declaration reference cannot exist half-recorded', (
      select count(*) = 1 from pg_constraint
       where conrelid = 'public.customs_record'::regclass
         and conname = 'customs_declaration_reference_complete'
    )),

    -- ---- 2. THE INVARIANT: two acts, two columns -------------------------
    -- The reason this migration exists. If these ever became one column, a
    -- step-6 capture would make Finance's step 9 permanently unperformable.
    ('the Déclarant reference and Finance''s external_ref are DIFFERENT columns', (
      select count(*) = 2 from information_schema.columns
       where table_schema = 'public' and table_name = 'customs_record'
         and column_name in ('gainde_declaration_reference', 'external_ref')
    )),

    -- ---- 3. The payment ledger -------------------------------------------
    ('both tax-payment tables exist', (
      select count(*) = 2 from information_schema.tables
       where table_schema = 'public'
         and table_name in ('gainde_tax_payment', 'gainde_tax_payment_line')
    )),

    -- Integer minor units, per the money doctrine. A numeric or a float here
    -- would silently reintroduce rounding into a fiscal record.
    ('money is stored in integer minor units', (
      select count(*) = 2 from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'gainde_tax_payment'      and column_name = 'total_paid_minor')
           or (table_name = 'gainde_tax_payment_line' and column_name = 'amount_minor'))
         and data_type = 'bigint'
    )),

    -- A total with no breakdown is exactly what the ratification replaced, and
    -- a breakdown that does not add up is worse than none.
    ('the balance trigger is present on BOTH tables, and deferred', (
      select count(*) = 2 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where t.tgname in ('trg_gainde_tax_payment_balances', 'trg_gainde_tax_line_balances')
         and t.tgdeferrable and t.tginitdeferred
    )),

    ('the balance rule refuses both an empty breakdown and a mismatch', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'assert_gainde_tax_payment_balances'
         and p.prosrc like '%tax_lines_required%'
         and p.prosrc like '%tax_total_mismatch%'
    )),

    -- ONE function serves two tables with different shapes. Reading the row's
    -- identity by trying fields in turn raises « record "new" has no field
    -- payment_id » on the header table — PL/pgSQL resolves record fields at
    -- runtime — and CI found exactly that. The identity is resolved from
    -- TG_TABLE_NAME, and NEW/OLD are each read only where they exist.
    ('the balance rule resolves its row from the table it fired on', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'assert_gainde_tax_payment_balances'
         and p.prosrc like '%tg_table_name%'
         and p.prosrc like '%tg_op%'
    )),

    -- Step 9 is ONE act. A second live payment would mean the dossier had been
    -- registered twice; a voided one stays, which is what makes the correction
    -- door auditable rather than destructive.
    ('one LIVE payment per customs record', (
      select count(*) = 1 from pg_indexes
       where schemaname = 'public' and indexname = 'uq_gainde_tax_payment_live'
         and indexdef ilike '%unique%' and indexdef ilike '%voided_at is null%'
    )),

    ('a void is all of motif, author and date, or none of them', (
      select count(*) = 1 from pg_constraint
       where conrelid = 'public.gainde_tax_payment'::regclass
         and conname = 'gainde_tax_payment_void_complete'
    )),

    -- ---- 4. STAFF ONLY (DEC-C39) -----------------------------------------
    -- The ratified reason the taxes are not columns on `customs_record`: that
    -- table's portal policy has no column list, so anything added to it is
    -- customer-readable by construction.
    ('RLS is enabled on both tax tables', (
      select count(*) = 2 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relname in ('gainde_tax_payment', 'gainde_tax_payment_line')
         and c.relrowsecurity
    )),

    ('NO portal policy reaches the fiscal detail', (
      select count(*) = 0 from pg_policies
       where schemaname = 'public'
         and tablename in ('gainde_tax_payment', 'gainde_tax_payment_line')
         and qual ilike '%portal_can_read_file%'
    )),

    ('reads are tenant-scoped, permission-gated and dossier-scoped', (
      select count(*) = 1 from pg_policies
       where schemaname = 'public' and tablename = 'gainde_tax_payment'
         and policyname = 'gainde_tax_payment_select'
         and qual ilike '%auth_tenant_id%'
         and qual ilike '%has_permission%'
         and qual ilike '%can_read_file%'
    )),

    -- No write policy anywhere: the server actions ARE the boundary, and a
    -- stray INSERT policy would open a second write path around the RPC.
    ('there is no write policy on either tax table', (
      select count(*) = 0 from pg_policies
       where schemaname = 'public'
         and tablename in ('gainde_tax_payment', 'gainde_tax_payment_line')
         and cmd <> 'SELECT'
    )),

    -- ---- 5. ONE Finance registration action ------------------------------
    -- Leaving the 3-arg version alive would let the incomplete act — a
    -- reference with no taxes — keep happening beside its replacement.
    ('the 3-arg record_gainde_registration is GONE', (
      select count(*) = 0 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and pg_get_function_identity_arguments(p.oid) = 'uuid, text, uuid'
    )),

    ('exactly one record_gainde_registration remains, and it takes the taxes', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and pg_get_function_identity_arguments(p.oid)
             = 'uuid, text, uuid, timestamp with time zone, text, text, jsonb'
    )),

    -- A re-registration is a CORRECTION: the previous payment is superseded by
    -- a void, never edited. Without this the one-live-payment index would refuse
    -- the repair path the RPC has always allowed.
    ('a re-registration supersedes the previous payment rather than editing it', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.prosrc like '%voided_at   = now()%'
         and p.prosrc like '%Remplac%'
    )),

    ('registration refuses a reference with no breakdown, and no quittance', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.prosrc like '%tax_lines_required%'
         and p.prosrc like '%quittance_required%'
    )),

    -- ---- 6. INV-7 and the grant posture ----------------------------------
    -- Every definer function taking an actor proves that actor's authority in
    -- the database rather than believing the caller, and each names its OWN
    -- permission: the Déclarant's capture and Finance's registration are
    -- different authorities and must not collapse into one.
    ('each new RPC asserts its own actor authority', (
      select bool_and(found) from (
        select p.prosrc like '%assert_actor_authority%'
           and p.prosrc like '%' || perm || '%' as found
          from (values ('record_declaration_reference', 'customs:update'),
                       ('record_gainde_registration',   'customs:register'),
                       ('void_gainde_tax_payment',      'customs:register')) as w(fname, perm)
          join pg_proc p on p.proname = w.fname
          join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      ) s
    )),

    -- OPS-SEC-1: a definer RPC executable by `anon` or `authenticated` is a
    -- P0. The revoke/grant quartet names each new signature explicitly.
    ('no new RPC is browser-executable', (
      select count(*) = 0 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.proname in ('record_declaration_reference', 'record_gainde_registration',
                           'void_gainde_tax_payment')
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    )),

    ('and service_role can execute all three', (
      select count(*) = 3 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.proname in ('record_declaration_reference', 'record_gainde_registration',
                           'void_gainde_tax_payment')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
    )),

    -- ---- 7. Nothing was invented, and nothing was rewritten --------------
    -- No money in the event ledger (WES-9C), on either the recording or the
    -- correction path. The figures live in the payment ledger, where they are
    -- governed.
    ('the registration event still carries no money', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.prosrc like '%GAINDE_REGISTRATION_RECORDED%'
         and p.prosrc not like '%''amount%'
         and p.prosrc not like '%total_paid_minor''%'
    )),

    -- ONE money authority: this ledger records an execution, it never
    -- authorizes one, and it never reaches a customer invoice.
    ('the payment ledger has no approval lifecycle and no billing path', (
      select count(*) = 0 from information_schema.columns
       where table_schema = 'public' and table_name = 'gainde_tax_payment'
         and column_name in ('status', 'reviewed_by', 'approved_by', 'billing_charge_id')
    )),

    ('but it can be SETTLED against a finance_request when one exists', (
      select count(*) = 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gainde_tax_payment'
         and column_name = 'finance_request_id' and is_nullable = 'YES'
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'GAINDE-04 #139 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'GAINDE-04 #139 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
