-- 20260728000002_customs_department_discovery.sql
-- Effitrans Operations Platform — Douane dossier discoverability.
-- ---------------------------------------------------------------------------
-- FUNCTION REPLACEMENT ONLY. No table, no column, no index, no data change.
--
-- ===========================================================================
-- THE DEFECT
-- ===========================================================================
-- `user_readable_file_ids` grants dossier visibility PERSON BY PERSON: account
-- manager, coordinator, creator, process-instance owner, task assignee, step
-- assignee, or a bounded assignment history. It has no notion of a DEPARTMENT.
--
-- CUSTOMS_DECLARANT, CHIEF_OF_TRANSIT and CUSTOMS_FIELD_AGENT hold `file:read`
-- but not `file:read:all`, so every list falls through to this function. A
-- Douane user who had not been personally assigned saw ZERO dossiers — even
-- one where customs was required, declared, and released by their own team.
--
-- The function's own comment already described the intended layering:
--
--     'Department-responsibility visibility is applied in the server resolver
--      (lib/workflow/access), which is projection-aware; this function is the
--      coarse row filter, never the whole contract.'
--
-- That resolver does implement department relation — but PER DOSSIER. So the
-- fine-grained contract knew about departments and the coarse filter did not:
-- a Douane user could OPEN the dossier by URL and never DISCOVER it in a list.
-- This aligns the two, so list, search, counts, queues, direct URL and archived
-- retrieval all resolve through one rule.
--
-- ===========================================================================
-- SCOPE — NARROW, AND DELIBERATELY NOT EXTENDED BY ANALOGY
-- ===========================================================================
-- Customs ONLY. Transport and Finance keep their existing governance; adding
-- them "for symmetry" would widen access on the strength of a pattern rather
-- than an audit. CASHIER is untouched: it holds no `file:read` and stays
-- execution-only under DEC-C21 — zero dossiers is correct behaviour there, not
-- a defect.
--
-- A customs leg means: a live `customs_record` for the dossier, in the same
-- tenant, with `required = true`. A record with `required = false` is the
-- documented escape hatch for the close-guard — customs explicitly waived — and
-- is EXCLUDED, matching `customsApplicable` in the canonical projection.
--
-- Discovery is history-aware on purpose: a dossier stays discoverable whether
-- customs is current, upcoming, completed or archived. Archival constrains
-- MUTABILITY, not the ability to retrieve completed customs work for audit,
-- compliance or a dispute. Every action remains permission- and status-gated.
--
-- Not a permission grant: no role gains `file:read:all`, and a Douane user
-- still sees nothing on a handling-only dossier with no customs leg.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Re-apply the previous definition — this file changes nothing else. The
-- previous body is identical to the one below minus the final `or (...)`
-- branch labelled DEPARTMENT INVOLVEMENT.
--
-- Indexes relied upon already exist: idx_customs_file (customs_record.file_id)
-- and idx_user_role_user (user_role.user_id).
create or replace function public.user_readable_file_ids(p_user uuid, p_tenant uuid)
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select f.id
  from public.operational_file f
  where f.tenant_id = p_tenant
    and (
      -- explicit governance permission
      exists (select 1 from public.get_user_permissions(p_user) gp where gp.code = 'file:read:all')
      -- commercial ownership
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.created_by = p_user
      -- CANONICAL operational ownership (WES-3G)
      or exists (
        select 1 from public.process_instance pi
         where pi.file_id = f.id and pi.owner_user_id = p_user)
      -- current work assignment: task …
      or exists (
        select 1 from public.task t
         where t.file_id = f.id and t.assigned_to = p_user)
      -- … or step execution (WES-3B)
      or exists (
        select 1 from public.process_step_execution e
          join public.process_instance pi on pi.id = e.process_instance_id
         where pi.file_id = f.id and e.assigned_user_id = p_user)
      -- BOUNDED historical relationship: this user was verifiably assigned work
      -- on this dossier before. Read from the append-only ledger, so it cannot
      -- be claimed by merely holding a role.
      or exists (
        select 1 from public.assignment_event ae
         where ae.file_id = f.id
           and (ae.new_user_id = p_user or ae.previous_user_id = p_user))
      -- DEPARTMENT INVOLVEMENT — Customs only.
      --
      -- Legitimate involvement, not current responsibility: a customs officer
      -- must find the dossiers their department's work touches, including ones
      -- that have moved on to Finance or been archived. The role check is
      -- tenant-scoped too, so a role held in another tenant grants nothing here.
      or (
        exists (
          select 1
            from public.user_role ur
            join public.role r on r.id = ur.role_id
           where ur.user_id = p_user
             and ur.tenant_id = p_tenant
             and r.code in ('CUSTOMS_DECLARANT', 'CHIEF_OF_TRANSIT', 'CUSTOMS_FIELD_AGENT')
        )
        and exists (
          select 1
            from public.customs_record c
           where c.file_id = f.id
             and c.tenant_id = p_tenant
             and c.deleted_at is null
             and c.required = true
        )
      )
    );
$$;

comment on function public.user_readable_file_ids(uuid, uuid) is
  'WES-3E + Douane discovery. Ownership + assignment + bounded assignment history, '
  'PLUS department involvement for the three customs roles when the dossier has a '
  'live, non-waived customs_record. operational_file.assigned_to_user_id remains '
  'DELIBERATELY ABSENT as a visibility source (WES-3F). Customs discovery is '
  'history-aware (completed and archived dossiers stay discoverable) and is NOT '
  'extended to Transport, Finance or CASHIER — those keep their own governance.';
