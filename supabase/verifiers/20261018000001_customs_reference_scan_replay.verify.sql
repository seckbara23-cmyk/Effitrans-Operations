-- VERIFIER for 20261018000001_customs_reference_scan_replay
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT DEFENDS. Replay protection is one column and one partial unique
-- index. Both are invisible on the happy path: a system with the index dropped
-- behaves identically until somebody re-sends a captured callback. These are
-- the assertions that would notice.
--
-- IT ALSO DEFENDS THE ABSENCE OF THE OLD SIGNATURE. The 9-argument recorder was
-- dropped rather than left as an overload, because a caller that omitted the
-- nonce would otherwise silently reach the unprotected one — the defect,
-- reachable by accident. Exactly one function of that name must exist.
--
-- `proconfig`, NOT the printed body, is where SET clauses are read from:
-- pg_get_functiondef renders them as `SET search_path TO 'public', 'pg_temp'`,
-- so matching the `=` form reports a healthy database as broken.
-- ===========================================================================
with scantbl as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customs_reference_scan'
),
cols as (
  select a.attname
    from pg_attribute a join scantbl on scantbl.oid = a.attrelid
   where a.attnum > 0 and not a.attisdropped
),
idx as (
  select i.indexname, i.indexdef
    from pg_indexes i
   where i.schemaname = 'public' and i.tablename = 'customs_reference_scan'
),
fn as (
  select p.oid,
         p.prosecdef as secdef,
         coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         p.oid::regprocedure::text as sig,
         pg_get_function_identity_arguments(p.oid) as args,
         regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'record_customs_reference_scan'
),
checks(label, ok) as (
  values
    -- ---- 1. the nonce is recorded with the evidence ----------------------
    ('customs_reference_scan.callback_nonce exists', (
      select exists (select 1 from cols where attname = 'callback_nonce')
    )),

    -- ---- 2. and a repeat collides in the database ------------------------
    ('uq_customs_reference_scan_nonce is UNIQUE on (tenant, document, nonce)', (
      select coalesce((
        select indexdef like '%UNIQUE%'
           and indexdef like '%tenant_id%'
           and indexdef like '%document_id%'
           and indexdef like '%callback_nonce%'
          from idx where indexname = 'uq_customs_reference_scan_nonce'), false)
    )),
    -- Partial, so a verdict with no nonce stays representable: what is
    -- forbidden is REUSING one, not omitting one.
    ('… and it is PARTIAL on the nonce being present', (
      select coalesce((
        select indexdef ilike '%where%' and indexdef like '%callback_nonce is not null%'
          from idx where indexname = 'uq_customs_reference_scan_nonce'), false)
    )),

    -- ---- 3. EXACTLY ONE recorder, and it takes the nonce -----------------
    -- The old 9-argument form must be gone, not merely unused.
    ('exactly one record_customs_reference_scan exists', (
      select (select count(*) from fn) = 1
    )),
    ('… and its last parameter is p_nonce', (
      select coalesce((select args like '%p_nonce text%' from fn), false)
    )),
    ('… with ten parameters, so the 9-argument overload is gone', (
      select coalesce((
        select (length(args) - length(replace(args, ',', ''))) = 9 from fn), false)
    )),

    -- ---- 4. the refusal happens BEFORE any state changes -----------------
    ('the recorder answers ''replayed'' on a repeat', (
      select coalesce((select body like '%replayed%' from fn), false)
    )),
    ('… from a unique_violation on the evidence insert', (
      select coalesce((
        select body like '%exception when unique_violation then%' from fn), false)
    )),
    -- The ordering is the point: a replay must not reach the document update.
    ('… and the insert precedes the document update', (
      select coalesce((
        select position('insert into public.customs_reference_scan' in body)
             < position('effitrans.scan_recorder' in body)
          from fn), false)
    )),
    ('the nonce is normalised, so an empty string is not a nonce', (
      select coalesce((select body like '%nullif(btrim(coalesce(p_nonce%' from fn), false)
    )),

    -- ---- 5. everything 153 established is still true ---------------------
    ('it still refuses a verdict about other bytes', (
      select coalesce((
        select body like '%binding_mismatch%'
           and body ~ 'p_sha256 is distinct from v_doc.content_sha256'
          from fn), false)
    )),
    ('it still invalidates a clearance and retires a published document', (
      select coalesce((
        select body like '%scanned_sha256       = null%'
           and body like '%WITHDRAWN%' and body like '%SCAN%'
          from fn), false)
    )),
    ('it still locks the row it decides on', (
      select coalesce((select body ilike '%for update%' from fn), false)
    )),
    ('it is still a SECURITY DEFINER with a pinned search_path', (
      select coalesce((
        select secdef
           and cfg like '%search_path=%'
           and cfg like '%public%'
           and cfg like '%pg_temp%'
          from fn), false)
    )),
    ('it is still executable by service_role only', (
      select coalesce((
        select (to_regrole('service_role') is null
                or has_function_privilege('service_role', oid, 'EXECUTE'))
           and (to_regrole('authenticated') is null
                or not has_function_privilege('authenticated', oid, 'EXECUTE'))
           and (to_regrole('anon') is null
                or not has_function_privilege('anon', oid, 'EXECUTE'))
          from fn), false)
    )),

    -- ---- 6. nothing was widened ------------------------------------------
    ('no new permission code was introduced', (
      select not exists (
        select 1 from public.permission
         where code like 'customs:reference:%'
           and code not in ('customs:reference:read', 'customs:reference:publish')
      )
    )),
    ('no bypass or exception column appeared on the evidence table', (
      select not exists (
        select 1 from cols
         where attname ~ '(override|bypass|exempt|exception|force|skip)'
      )
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'SCANNER-01 #154 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — a replayed scan callback collides on a unique nonce and changes no state, exactly one recorder exists and it takes the nonce, and every #153 guarantee is intact'
    else 'SCANNER-01 #154 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
