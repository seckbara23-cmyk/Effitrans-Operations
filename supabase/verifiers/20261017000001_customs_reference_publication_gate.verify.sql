-- VERIFIER for 20261017000001_customs_reference_publication_gate
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT DEFENDS. Two controls that are almost entirely declarative, and one
-- trust boundary that is a single trigger. If a later migration dropped any of
-- them the application would keep working and publish unscanned, self-approved
-- documents in silence. These are the assertions that would fail.
--
-- IT ASSERTS RLS POLICIES AND FUNCTION PRIVILEGES, NOT TABLE PRIVILEGES. On
-- Supabase `authenticated` legitimately holds SELECT on nearly every public
-- table and the policy is the protection (UAT-PARALLEL-OWNERSHIP-01). Function
-- EXECUTE is different: it is revoked here on purpose, so it IS asserted.
--
-- COMMENTS ARE STRIPPED BEFORE EVERY BODY MATCH. pg_get_functiondef returns the
-- `--` comments, and these bodies name their own rules in prose as well as in
-- code; matching unstripped text would let a comment satisfy a pin.
--
-- ROLE-DEPENDENT PROBES ARE GUARDED: a bare Postgres has no `anon`, so each
-- role is probed only where it exists.
-- ===========================================================================
with tbl as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customs_reference_document'
),
scantbl as (
  select c.oid, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customs_reference_scan'
),
con as (
  select k.conname, pg_get_constraintdef(k.oid) as def
    from pg_constraint k join tbl on tbl.oid = k.conrelid
),
cols as (
  select a.attname, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as dflt
    from pg_attribute a
    join tbl on tbl.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped
),
trg as (
  select t.tgname, t.tgrelid,
         regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as body
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid in (select oid from tbl union all select oid from scantbl)
),
fn as (
  select p.proname,
         p.oid,
         p.prosecdef as secdef,
         regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('record_customs_reference_scan',
                       'submit_customs_reference_for_publication',
                       'publish_customs_reference',
                       'guard_customs_reference_scan_status')
),
pol as (
  select p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid) as qual
    from pg_policy p join scantbl on scantbl.oid = p.polrelid
),
checks(label, ok) as (
  values
    -- ---- 1. the scan lifecycle exists, and defaults to the safe state -----
    ('scan_status exists, NOT NULL, defaulting to UNSCANNED', (
      select coalesce((
        select attnotnull and dflt like '%UNSCANNED%' from cols where attname = 'scan_status'
      ), false)
    )),
    ('scan_status admits exactly the five lifecycle values', (
      select coalesce((
        select array(select m[1] from regexp_matches(def, '''([A-Z]+)''', 'g') m order by 1)
             = array['CLEAN', 'ERROR', 'INFECTED', 'SCANNING', 'UNSCANNED']::text[]
          from con where conname = 'customs_reference_scan_status_check'), false)
    )),
    ('the binding columns exist', (
      select (select count(*) from cols
               where attname in ('scanned_sha256', 'scanned_storage_path',
                                 'scan_completed_at', 'scanner_name')) = 4
    )),
    ('the submission columns exist', (
      select (select count(*) from cols
               where attname in ('submitted_for_publication_by',
                                 'submitted_for_publication_at')) = 2
    )),

    -- ---- 2. a CLEAN verdict must say what it examined ---------------------
    ('a CLEAN verdict is bound to bytes, a path, a moment and a scanner', (
      select coalesce((
        select def like '%scanned_sha256%' and def like '%scanned_storage_path%'
           and def like '%scan_completed_at%' and def like '%scanner_name%'
          from con where conname = 'customs_reference_clean_scan_is_bound'), false)
    )),

    -- ---- 3. PUBLICATION REQUIRES A CLEAN SCAN OF THESE EXACT BYTES --------
    ('publication requires scan_status CLEAN', (
      select coalesce((
        select def like '%CLEAN%' from con
         where conname = 'customs_reference_publication_requires_clean_scan'), false)
    )),
    ('… bound to content_sha256 AND storage_path, so a clearance is not transferable', (
      select coalesce((
        select def like '%scanned_sha256%' and def like '%content_sha256%'
           and def like '%scanned_storage_path%' and def like '%storage_path%'
          from con where conname = 'customs_reference_publication_requires_clean_scan'), false)
    )),

    -- ---- 4. PUBLICATION REQUIRES TWO DISTINCT ACTORS ----------------------
    ('publication requires a submission and a DIFFERENT approver', (
      select coalesce((
        select def like '%submitted_for_publication_by%'
           and def like '%published_by%'
           and def ~ 'published_by <> submitted_for_publication_by'
          from con where conname = 'customs_reference_publication_requires_two_actors'), false)
    )),
    ('a submission is coherent in both its columns', (
      select exists (select 1 from con where conname = 'customs_reference_submission_coherent')
    )),

    -- ---- 5. withdrawal coherence admits the scanner, and only it ----------
    ('an OPERATOR withdrawal still needs a person; a SCAN withdrawal does not', (
      select coalesce((
        select def like '%OPERATOR%' and def like '%SCAN%' and def like '%withdrawn_by%'
          from con where conname = 'customs_reference_withdrawal_coherent'), false)
    )),

    -- ---- 6. scan evidence is append-only ----------------------------------
    ('customs_reference_scan exists with RLS enabled', (
      select coalesce((select relrowsecurity from scantbl), false)
    )),
    ('its verdicts can never be updated or deleted', (
      select coalesce((
        select body like '%prevent_mutation%' or body like '%append%'
          from trg where tgname = 'trg_customs_reference_scan_append_only'), false)
    )),
    ('it is readable only by a holder of customs:reference:publish, in its tenant', (
      select coalesce((
        select qual like '%auth_tenant_id()%'
           and qual like '%customs:reference:publish%'
          from pol limit 1), false)
    )),
    ('no write policy exists on the evidence table', (
      select not exists (select 1 from pol where polcmd in ('a', 'w', 'd', '*'))
    )),

    -- ---- 7. THE TRUST BOUNDARY --------------------------------------------
    -- The whole of "users and publishers cannot manufacture a CLEAN result".
    ('the CLEAN guard trigger is installed on insert AND update', (
      select exists (select 1 from trg where tgname = 'trg_customs_reference_scan_guard')
    )),
    ('… and it refuses CLEAN unless the trusted recorder set its transaction guard', (
      select coalesce((
        select body like '%effitrans.scan_recorder%'
           and body like '%customs_reference%'
           and body ilike '%raise exception%'
          from fn where proname = 'guard_customs_reference_scan_status'), false)
    )),
    ('… and it refuses re-binding an existing clearance', (
      select coalesce((
        select body like '%cannot be re-bound%'
          from fn where proname = 'guard_customs_reference_scan_status'), false)
    )),

    -- ---- 8. the recorder: bound, evidenced, and invalidating --------------
    ('record_customs_reference_scan refuses a verdict about other bytes', (
      select coalesce((
        select body like '%binding_mismatch%'
           and body ~ 'p_sha256 is distinct from v_doc.content_sha256'
           and body ~ 'p_storage_path is distinct from v_doc.storage_path'
          from fn where proname = 'record_customs_reference_scan'), false)
    )),
    ('… writes append-only evidence for every verdict', (
      select coalesce((
        select body like '%insert into public.customs_reference_scan%'
          from fn where proname = 'record_customs_reference_scan'), false)
    )),
    ('… invalidates the clearance when a rescan disagrees', (
      select coalesce((
        select body like '%scanned_sha256       = null%'
            or body like '%scanned_sha256 = null%'
          from fn where proname = 'record_customs_reference_scan'), false)
    )),
    ('… and retires a PUBLISHED document in the same statement', (
      select coalesce((
        select body like '%WITHDRAWN%' and body like '%SCAN%'
          from fn where proname = 'record_customs_reference_scan'), false)
    )),
    ('… and locks the row it decides on', (
      select coalesce((
        select body ilike '%for update%' from fn
         where proname = 'record_customs_reference_scan'), false)
    )),

    -- ---- 9. the two human acts assert the NOMINATED actor's authority -----
    ('submission asserts the actor holds customs:reference:publish', (
      select coalesce((
        select body ~ 'assert_actor_authority\s*\(\s*p_actor\s*,\s*p_tenant\s*,\s*''customs:reference:publish''\s*,\s*''SERVICE''\s*\)'
          from fn where proname = 'submit_customs_reference_for_publication'), false)
    )),
    ('publication asserts the APPROVER holds it', (
      select coalesce((
        select body ~ 'assert_actor_authority\s*\(\s*p_approver\s*,\s*p_tenant\s*,\s*''customs:reference:publish''\s*,\s*''SERVICE''\s*\)'
          from fn where proname = 'publish_customs_reference'), false)
    )),
    ('publication refuses self-approval by name', (
      select coalesce((
        select body like '%self_approval_forbidden%'
           and body ~ 'submitted_for_publication_by = p_approver'
          from fn where proname = 'publish_customs_reference'), false)
    )),
    ('publication refuses every non-CLEAN scan state, individually', (
      select coalesce((
        select body like '%scan_required%' and body like '%scan_in_progress%'
           and body like '%scan_infected%' and body like '%scan_error%'
           and body like '%scan_binding_mismatch%'
          from fn where proname = 'publish_customs_reference'), false)
    )),
    ('publication retires the predecessor in its own transaction', (
      select coalesce((
        select body like '%superseded_by_id = p_document%'
           and body like '%superseded_by_id is null%'
          from fn where proname = 'publish_customs_reference'), false)
    )),
    ('publication still enforces the 152 preconditions', (
      select coalesce((
        select body like '%provenance_unverified%' and body like '%legal_version_unverified%'
           and body like '%licence_unresolved%'
           and body like '%explanatory_notes_licence_required%'
          from fn where proname = 'publish_customs_reference'), false)
    )),

    -- ---- 10. privilege shape: definer, and service_role only --------------
    ('all four functions are SECURITY DEFINER', (
      select (select count(*) from fn where secdef) = 4
    )),
    -- Asserted from `proconfig`, not from the printed body: pg_get_functiondef
    -- renders the clause as `SET search_path TO 'public', 'pg_temp'`, so a
    -- match on the `=` form reported a healthy database as broken. proconfig is
    -- where the setting actually lives, and it is quoting-independent.
    ('all four pin search_path to public, pg_temp', (
      select (select count(*) from fn
               where cfg like '%search_path=%'
                 and cfg like '%public%'
                 and cfg like '%pg_temp%') = 4
    )),
    ('the three RPCs are executable by service_role only', (
      select coalesce((
        select bool_and(
                 (to_regrole('service_role') is null
                  or has_function_privilege('service_role', oid, 'EXECUTE'))
             and (to_regrole('authenticated') is null
                  or not has_function_privilege('authenticated', oid, 'EXECUTE'))
             and (to_regrole('anon') is null
                  or not has_function_privilege('anon', oid, 'EXECUTE'))
               )
          from fn
         where proname in ('record_customs_reference_scan',
                           'submit_customs_reference_for_publication',
                           'publish_customs_reference')), false)
    )),

    -- ---- 11. no exception, no bypass, no new authority -------------------
    -- The brief was explicit that a general-purpose malware exception must not
    -- exist. Its absence is asserted rather than assumed.
    ('no override, bypass or exception column exists', (
      select not exists (
        select 1 from cols
         where attname ~ '(override|bypass|exempt|exception|force|skip)'
      )
    )),
    ('no new permission code was introduced', (
      select not exists (
        select 1 from public.permission
         where code like 'customs:reference:%'
           and code not in ('customs:reference:read', 'customs:reference:publish')
      )
    )),
    ('publish remains held only by SYSTEM_ADMIN / CHIEF_OF_TRANSIT', (
      select coalesce((
        select array(select distinct r.code
                       from public.role_permission rp
                       join public.role r on r.id = rp.role_id
                       join public.permission p on p.id = rp.permission_id
                      where p.code = 'customs:reference:publish'
                      order by 1)
             <@ array['SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT']::text[]), false)
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CUSTOMS-REF-01A #153 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — publication requires a CLEAN scan bound to the stored bytes and two distinct actors, only the trusted recorder can record CLEAN, scan evidence is append-only, the three RPCs are service_role-only definers asserting the nominated actor, and no exception or bypass exists'
    else 'CUSTOMS-REF-01A #153 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
