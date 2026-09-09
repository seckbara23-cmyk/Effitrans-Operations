-- VERIFIER for 20261004000001_gainde_payment_registration
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT CHECKS, AND WHY IT CHECKS MEANING. « The function exists » would pass
-- against the version that produced this blocker — the signature never changed,
-- only which fact it guards. So every assertion below is about the PREDICATE:
-- the reference-identity refusal is gone, the duplicate-PAYMENT refusal is
-- there and looks only at live rows, and the three things this slice promised
-- not to weaken are each still standing.
-- ===========================================================================
with src as (
  select
    (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_gainde_registration'
        and p.oid::regprocedure::text like '%timestamp with time zone%')      as payment,
    (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_declaration_reference') as declaration
),
checks(label, ok) as (
  select * from (values
    -- ---- 1. The act exists, in the shape the application calls -------------
    ('the 7-argument payment RPC exists', (
      select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.oid::regprocedure::text like '%timestamp with time zone%'
    )),

    -- ---- 2. THE FIX. The guard no longer looks at the reference -----------
    -- This is the whole blocker: Finance pays AGAINST the declaration the
    -- Déclarant recorded, so reusing that reference is correct. While this
    -- predicate is present, step 9 is unperformable on every dossier whose
    -- external_ref is already populated.
    ('the payment RPC does NOT refuse a reused declaration reference', (
      select payment is not null and payment !~ 'v_prev\s+is\s+not\s+distinct\s+from\s+v_ref'
        from src
    )),

    -- ---- 3. …and it guards the payment instead ----------------------------
    ('the payment RPC refuses an identical live payment', (
      select payment ~ 'payment_unchanged' from src
    )),
    ('that guard considers only LIVE (non-voided) payments', (
      select payment ~ 'voided_at\s+is\s+null' from src
    )),
    ('it compares the receipt, the instant and the total', (
      select payment ~ 'quittance_reference' and payment ~ 'paid_at'
         and payment ~ 'total_paid_minor'
        from src
    )),

    -- ---- 4. NOT WEAKENED: declaration-reference uniqueness ----------------
    ('the declaration act still refuses its own duplicate', (
      select declaration is not null and declaration ~ 'reference_unchanged' from src
    )),
    ('the declaration act still never writes Finance''s column', (
      select declaration !~ 'external_ref\s*=' from src
    )),
    ('the payment act still never writes the declaration reference', (
      select payment !~ 'gainde_declaration_reference\s*=' from src
    )),

    -- ---- 5. NOT WEAKENED: authority, money and tenancy --------------------
    ('the payment RPC still establishes the actor''s authority itself', (
      select payment ~ 'assert_actor_authority' and payment ~ 'customs:register' from src
    )),
    ('it is still SECURITY DEFINER with a pinned search_path', (
      select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.oid::regprocedure::text like '%timestamp with time zone%'
         and p.prosecdef
         and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'
    )),
    -- EXECUTE belongs to service_role alone. anon holds every grant platform
    -- wide, so a function that writes money must not be reachable from it.
    ('EXECUTE is service_role only — never anon, authenticated or public', (
      select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_gainde_registration'
         and p.oid::regprocedure::text like '%timestamp with time zone%'
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')
    )),

    -- ---- 6. NOT WEAKENED: the lines still have to add up ------------------
    ('the lines-equal-total trigger function still exists', (
      select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'assert_gainde_tax_payment_balances'
    )),
    ('…and is still attached as a constraint trigger on the ledger', (
      select count(*) >= 1
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and p.proname = 'assert_gainde_tax_payment_balances'
    )),

    -- ---- 7. NOT WEAKENED: the two columns are still two -------------------
    ('customs_record still carries both references as separate columns', (
      select count(*) = 2 from information_schema.columns
       where table_schema = 'public' and table_name = 'customs_record'
         and column_name in ('external_ref', 'gainde_declaration_reference')
    )),

    -- ---- 8. This migration wrote no data ----------------------------------
    -- A payment that nobody made must not exist because a migration ran. The
    -- ledger is written by Finance's act alone.
    ('no payment carries this migration as its author', (
      select count(*) = 0 from public.gainde_tax_payment
       where created_by is null or paid_by is null
    ))
  ) as t(label, ok)
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'UAT-STEP9-FINANCE-01 #142 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'UAT-STEP9-FINANCE-01 #142 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
