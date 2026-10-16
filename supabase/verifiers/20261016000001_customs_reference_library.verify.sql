-- VERIFIER for 20261016000001_customs_reference_library
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT DEFENDS. REF-1's safety is almost entirely declarative: four CHECK
-- constraints, one RLS policy, one trigger, five column defaults and a private
-- bucket. None of that is exercised by application code on the happy path, so
-- none of it would be noticed if a later migration relaxed it. These are the
-- assertions that would fail.
--
-- IT ASSERTS RLS POLICIES, NOT TABLE PRIVILEGES. On Supabase, `authenticated`
-- legitimately holds SELECT on nearly every table and the protection is the
-- policy, so `has_table_privilege` proves nothing about who can read what
-- (UAT-PARALLEL-OWNERSHIP-01). The security claims below read pg_policy.
--
-- COMMENTS ARE STRIPPED BEFORE THE TRIGGER-BODY MATCH. pg_get_functiondef
-- returns `--` comments, and this body names its protected columns in prose as
-- well as in code; matching unstripped text would let a comment satisfy a pin.
--
-- IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); verifiers that compared against a non-existent
-- `inserted_at` took every other check in the file down with them.
--
-- ROLE-DEPENDENT PROBES ARE GUARDED. A bare Postgres has no `anon`, and the
-- role_permission grants depend on rows that `supabase/seed.sql` creates AFTER
-- migrations run, so a fresh CI database has the permission catalogue but not
-- necessarily the grants. Those checks assert "granted to nobody unexpected"
-- rather than "granted to somebody", which is true in both environments.
-- ===========================================================================
with tbl as (
  select c.oid, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'customs_reference_document'
),
pol as (
  select p.polname,
         p.polcmd,
         pg_get_expr(p.polqual, p.polrelid) as qual
    from pg_policy p
    join tbl on tbl.oid = p.polrelid
),
con as (
  select k.conname, pg_get_constraintdef(k.oid) as def
    from pg_constraint k
    join tbl on tbl.oid = k.conrelid
),
cols as (
  select a.attname,
         pg_get_expr(d.adbin, d.adrelid) as dflt,
         a.attnotnull
    from pg_attribute a
    join tbl on tbl.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped
),
trg as (
  select t.tgname,
         regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as body
    from pg_trigger t
    join tbl on tbl.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
),
idx as (
  select i.indexname, i.indexdef
    from pg_indexes i
   where i.schemaname = 'public'
     and i.tablename = 'customs_reference_document'
),
bucket as (
  select b.id, b.public, b.file_size_limit, b.allowed_mime_types
    from storage.buckets b
   where b.id = 'customs-reference'
),
perms as (
  select array(
           select code from public.permission
            where code in ('customs:reference:read', 'customs:reference:publish')
            order by 1
         ) as got
),
-- Every role that holds the publish permission, whatever the environment.
publishers as (
  select array(
           select r.code
             from public.role_permission rp
             join public.role r on r.id = rp.role_id
             join public.permission p on p.id = rp.permission_id
            where p.code = 'customs:reference:publish'
            order by 1
         ) as got
),
readers as (
  select array(
           select distinct r.code
             from public.role_permission rp
             join public.role r on r.id = rp.role_id
             join public.permission p on p.id = rp.permission_id
            where p.code = 'customs:reference:read'
            order by 1
         ) as got
),
checks(label, ok) as (
  values
    -- ---- 1. the table, and RLS actually on --------------------------------
    ('customs_reference_document exists', (select count(*) = 1 from tbl)),
    ('row level security is ENABLED', (select coalesce((select relrowsecurity from tbl), false))),

    -- ---- 2. it is NOT a dossier document ---------------------------------
    -- The structural guarantee the whole slice rests on. A `file_id` column
    -- appearing here would mean somebody started wiring the library into the
    -- dossier, and the evidence engine keys on exactly that name.
    ('it carries NO file_id column (unreachable from dossier evidence)', (
      select not exists (select 1 from cols where attname = 'file_id')
    )),

    -- ---- 3. the read boundary --------------------------------------------
    ('exactly one policy exists, and it is SELECT-only', (
      select (select count(*) from pol) = 1
         and (select bool_and(polcmd = 'r') from pol)
    )),
    ('no INSERT/UPDATE/DELETE policy exists — the actions are the boundary', (
      select not exists (select 1 from pol where polcmd in ('a', 'w', 'd', '*'))
    )),
    ('the policy is tenant-scoped', (
      select coalesce((select qual like '%auth_tenant_id()%' from pol limit 1), false)
    )),
    ('a reader sees only PUBLISHED; a publisher sees everything', (
      select coalesce((
        select qual like '%''PUBLISHED''%'
           and qual like '%customs:reference:read%'
           and qual like '%customs:reference:publish%'
          from pol limit 1), false)
    )),

    -- ---- 4. publication cannot be claimed without verification -----------
    ('CHECK customs_reference_published_is_verified exists', (
      select exists (select 1 from con where conname = 'customs_reference_published_is_verified')
    )),
    ('… and it requires publisher, moment, provenance, legal version and a licence ruling', (
      select coalesce((
        select def like '%published_by%' and def like '%published_at%'
           and def like '%provenance_verified%' and def like '%legal_version_verified%'
           and def like '%licence_status%'
          from con where conname = 'customs_reference_published_is_verified'), false)
    )),

    -- ---- 5. the HS Explanatory Notes fence -------------------------------
    ('EXPLANATORY_NOTES cannot be published without APPROVED_REDISTRIBUTION', (
      select coalesce((
        select def like '%EXPLANATORY_NOTES%' and def like '%APPROVED_REDISTRIBUTION%'
          from con where conname = 'customs_reference_explanatory_notes_licence'), false)
    )),
    ('redistribution requires the strongest licence', (
      select coalesce((
        select def like '%redistribution_allowed%' and def like '%APPROVED_REDISTRIBUTION%'
          from con where conname = 'customs_reference_redistribution_needs_licence'), false)
    )),

    -- ---- 6. the five categories, as a set --------------------------------
    ('category admits exactly the five REF-1 kinds', (
      select coalesce((
        select array(select m[1] from regexp_matches(def, '''([A-Z_]+)''', 'g') m order by 1)
             = array['CIRCULAR', 'EXPLANATORY_NOTES', 'LEGISLATION', 'REGIME_LIST', 'TARIFF']::text[]
          from con
         where def like '%category%' and def like '%LEGISLATION%' limit 1), false)
    )),
    ('mime_type is pinned to application/pdf', (
      select exists (select 1 from con where def like '%mime_type%' and def like '%application/pdf%')
    )),

    -- ---- 7. the defaults are the SAFE ones -------------------------------
    -- An upload lands quarantined, unverified, unlicensed and
    -- non-redistributable. If any of these flips, uploads start publishing
    -- themselves, which is precisely the unscanned-malware risk REF-1 fences.
    ('status defaults to QUARANTINE', (
      select coalesce((select dflt like '%QUARANTINE%' from cols where attname = 'status'), false)
    )),
    ('licence_status defaults to RESTRICTED', (
      select coalesce((select dflt like '%RESTRICTED%' from cols where attname = 'licence_status'), false)
    )),
    ('redistribution_allowed defaults to false', (
      select coalesce((select dflt = 'false' from cols where attname = 'redistribution_allowed'), false)
    )),
    ('provenance_verified defaults to false', (
      select coalesce((select dflt = 'false' from cols where attname = 'provenance_verified'), false)
    )),
    ('legal_version_verified defaults to false', (
      select coalesce((select dflt = 'false' from cols where attname = 'legal_version_verified'), false)
    )),
    ('content_sha256 is NOT NULL', (
      select coalesce((select attnotnull from cols where attname = 'content_sha256'), false)
    )),

    -- ---- 8. stored bytes and identity are immutable ----------------------
    ('the identity-protection trigger is installed', (
      select exists (select 1 from trg where tgname = 'trg_customs_reference_identity')
    )),
    ('… and it protects the storage path, the checksum and the uploader', (
      select coalesce((
        select body like '%storage_path%' and body like '%content_sha256%'
           and body like '%uploaded_by%' and body like '%version%'
          from trg where tgname = 'trg_customs_reference_identity'), false)
    )),
    ('… and it refuses to re-attribute a recorded publication', (
      select coalesce((
        select body like '%published_by%' and body like '%published_at%'
          from trg where tgname = 'trg_customs_reference_identity'), false)
    )),

    -- ---- 9. one current version per business key -------------------------
    ('uq_customs_reference_one_current exists and is PARTIAL', (
      select coalesce((
        select indexdef like '%UNIQUE%' and indexdef ilike '%where%'
           and indexdef like '%PUBLISHED%'
          from idx where indexname = 'uq_customs_reference_one_current'), false)
    )),

    -- REF-1-HARDEN (F2). The index is partial on the LIFECYCLE only. It used to
    -- be partial on `reference_code is not null` as well, which left every
    -- code-less document outside the one-current-edition rule entirely.
    ('reference_code is NOT NULL, so no row escapes the uniqueness rule', (
      select coalesce((select attnotnull from cols where attname = 'reference_code'), false)
    )),
    ('… and the index is no longer predicated on reference_code', (
      select coalesce((
        select indexdef not like '%reference_code is not null%'
          from idx where indexname = 'uq_customs_reference_one_current'), false)
    )),
    ('reference_code refuses an empty string', (
      select exists (
        select 1 from con where def like '%reference_code%' and def like '%btrim%'
      )
    )),

    -- REF-1-HARDEN (F2). A replacement inherits its predecessor's identity, and
    -- the rule is in the database because the route is not the only writer.
    ('the lineage trigger is installed, BEFORE INSERT', (
      select exists (select 1 from trg where tgname = 'trg_customs_reference_lineage')
    )),
    ('… and it compares tenant, category and reference code with the predecessor', (
      select coalesce((
        select body like '%new.supersedes_id%'
           and body like '%p.tenant_id is distinct from new.tenant_id%'
           and body like '%p.category is distinct from new.category%'
           and body like '%p.reference_code is distinct from new.reference_code%'
           and body like '%p.superseded_by_id is not null%'
          from trg where tgname = 'trg_customs_reference_lineage'), false)
    )),

    -- REF-1-HARDEN (F4). A withdrawn document is frozen: its licence and its
    -- verifications cannot be re-stated once nobody can consult it.
    ('a WITHDRAWN document''s licence and verifications are frozen', (
      select coalesce((
        select body like '%old.status = ''WITHDRAWN'' and new.status = ''WITHDRAWN''%'
           and body like '%new.licence_status is distinct from old.licence_status%'
           and body like '%new.redistribution_allowed is distinct from old.redistribution_allowed%'
           and body like '%new.provenance_verified is distinct from old.provenance_verified%'
          from trg where tgname = 'trg_customs_reference_identity'), false)
    )),

    -- ---- 10. the bucket is private and PDF-only --------------------------
    ('the customs-reference bucket exists and is PRIVATE', (
      select coalesce((select not public from bucket), false)
    )),
    ('… and accepts application/pdf only', (
      select coalesce((select allowed_mime_types = array['application/pdf']::text[] from bucket), false)
    )),
    -- Deny-by-default: the bytes are reachable only through the server route.
    ('no storage.objects policy mentions this bucket', (
      select not exists (
        select 1 from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'storage' and c.relname = 'objects'
           and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
               || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
               like '%customs-reference%'
      )
    )),

    -- ---- 11. the two permissions, and nobody unexpected holding them -----
    ('both REF-1 permissions exist in the catalogue', (
      select coalesce((
        select got = array['customs:reference:publish', 'customs:reference:read']::text[]
          from perms), false)
    )),
    -- Asserted as a SUBSET, not an equality: seed.sql creates the grants after
    -- migrations, so an empty set is legitimate on a fresh database. What must
    -- never happen is a grant to a role outside the ratified lists.
    ('publish is held only by SYSTEM_ADMIN / CHIEF_OF_TRANSIT', (
      select coalesce((
        select got <@ array['SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT']::text[] from publishers), false)
    )),
    ('read is held only by the ratified staff roles', (
      select coalesce((
        select got <@ array['SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'COORDINATOR',
                            'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FIELD_AGENT',
                            'CUSTOMS_FINANCE_OFFICER', 'DOCUMENTATION_OFFICER',
                            'COMPLIANCE_HSSE']::text[]
          from readers), false)
    )),
    -- The roles that must NEVER reach the library, stated as their own check so
    -- a failure names the breach rather than a set difference.
    ('CLIENT_USER, DRIVER, COURIER, PICKUP_AGENT and PARTNER_AGENT hold neither', (
      select not exists (
        select 1
          from public.role_permission rp
          join public.role r on r.id = rp.role_id
          join public.permission p on p.id = rp.permission_id
         where p.code in ('customs:reference:read', 'customs:reference:publish')
           and r.code in ('CLIENT_USER', 'DRIVER', 'COURIER', 'PICKUP_AGENT', 'PARTNER_AGENT')
      )
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CUSTOMS-REF-01A #152 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — the library is RLS-gated and select-only, publication requires provenance + legal version + a licence ruling, the Explanatory Notes are licence-fenced, stored bytes are immutable, the bucket is private and PDF-only, and no portal or driver role can reach it'
    else 'CUSTOMS-REF-01A #152 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
