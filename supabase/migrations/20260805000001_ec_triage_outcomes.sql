-- 20260805000001_ec_triage_outcomes.sql
-- Effitrans — EC-2: Triage outcomes over EC-1's immutable capture.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 81. Migrations 1–80 untouched.
--
-- FIVE RULES THIS MIGRATION ENCODES:
--
-- 1. EC-1'S QUARANTINE SEMANTICS ARE UNCHANGED (ratified Q-EC2-1). Quarantine
--    still means UNROUTABLE, still carries tenant_id = NULL, and
--    `ec_triage_transition_guard` — EC-1's trigger — is NOT redefined here.
--    EC-2 adds a SECOND, separate trigger for outcome coherence. One guard per
--    concern; the status machine keeps its own owner. There is deliberately NO
--    second quarantine concept anywhere below.
--
-- 2. FOUR OUTCOMES, AND RESOLVING REQUIRES ONE. A triage item may only reach
--    RESOLVED with an outcome recorded. Attach requires a dossier; discard
--    requires a reason code. Enforced by CHECK + trigger, not by convention.
--
-- 3. AN OUTCOME IS IMMUTABLE ONCE SET. A correction is a new decision about a
--    new message, never a rewrite — the EC-1 doctrine carried forward.
--
-- 4. NOTHING HERE CREATES A BUSINESS OBJECT. The only foreign keys added point
--    at `operational_file` and `client` — and both are READ references
--    recording a link that a human asserted, never a row this migration mints.
--    HANDOFF_TO_QUOTATION stores INTENT ONLY: there is no quotation column,
--    because EC-3 owns that entity and inventing its shape here would prejudge it.
--
-- 5. THE DOSSIER TIMELINE IS FED BY EMISSION, NOT BY QUERYING. The RPCs below
--    call emit_business_event in the SAME transaction as the state change, with
--    the DOSSIER as subject for attachment. Tracking consumes that event; it
--    never reads an ec_* table as its source of business truth (Digital LOS).
--
-- No new permission is created: communication:inbound:read and
-- communication:triage were both catalogued by migration 80 and remain granted
-- to NOBODY. Activation is a separate operator step (see the completion report).

-- ===========================================================================
-- 1. EVENT VOCABULARY — add the `communication` domain.
--    Uses the WES-5 precedent verbatim (20260727000005 §3): drop the CHECK,
--    re-add it widened. Idempotent and non-destructive.
-- ===========================================================================
alter table public.business_event drop constraint if exists business_event_event_domain_check;
alter table public.business_event
  add constraint business_event_event_domain_check
  check (event_domain in (
    'dossier', 'document', 'customs', 'transport',
    'task', 'handoff', 'finance', 'policy', 'ledger', 'process',
    -- EC-2: inbound correspondence becomes part of the operational timeline.
    'communication'));

-- ===========================================================================
-- 2. TRIAGE OUTCOME COLUMNS — additive and nullable, on the table EC-1 shipped
--    deliberately without them.
--
--    `discard_reason_code` is TENANT VOCABULARY validated app-side against a
--    registry (the `cycle_kind` / `contract_kind` idiom), so adding a reason
--    needs no migration. Its PRESENCE is enforced here; its VALUE is not
--    frozen into the schema.
-- ===========================================================================
alter table public.ec_triage_item
  add column if not exists outcome              text,
  add column if not exists outcome_file_id      uuid references public.operational_file (id),
  add column if not exists outcome_client_id    uuid references public.client (id),
  add column if not exists discard_reason_code  text,
  add column if not exists outcome_comment      text,
  add column if not exists outcome_recorded_by  uuid references public.app_user (id),
  add column if not exists outcome_recorded_at  timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ec_triage_outcome_values') then
    alter table public.ec_triage_item add constraint ec_triage_outcome_values
      check (outcome is null or outcome in (
        'ATTACH_TO_DOSSIER', 'HANDOFF_TO_QUOTATION',
        'GENERAL_CORRESPONDENCE', 'DISCARD'));
  end if;

  -- Attach means a dossier; discard means a reason. Neither is optional.
  if not exists (select 1 from pg_constraint where conname = 'ec_triage_outcome_shape') then
    alter table public.ec_triage_item add constraint ec_triage_outcome_shape
      check (
        outcome is null
        or (outcome = 'ATTACH_TO_DOSSIER'      and outcome_file_id is not null
                                               and discard_reason_code is null)
        or (outcome = 'DISCARD'                and coalesce(btrim(discard_reason_code), '') <> ''
                                               and outcome_file_id is null)
        or (outcome in ('HANDOFF_TO_QUOTATION', 'GENERAL_CORRESPONDENCE')
                                               and outcome_file_id is null
                                               and discard_reason_code is null)
      );
  end if;

  -- An outcome is a recorded decision: it has an actor and a moment.
  if not exists (select 1 from pg_constraint where conname = 'ec_triage_outcome_attributed') then
    alter table public.ec_triage_item add constraint ec_triage_outcome_attributed
      check (outcome is null
             or (outcome_recorded_by is not null and outcome_recorded_at is not null));
  end if;
end $$;

create index if not exists idx_ec_triage_outcome
  on public.ec_triage_item (tenant_id, outcome) where outcome is not null;
create index if not exists idx_ec_triage_outcome_file
  on public.ec_triage_item (outcome_file_id) where outcome_file_id is not null;

-- ===========================================================================
-- 3. OUTCOME GUARD — a SECOND trigger, beside EC-1's untouched status guard.
--    Trigger order is alphabetical: trg_ec_triage_guard (EC-1, status legality)
--    fires before trg_ec_triage_outcome (EC-2, outcome coherence). Status is
--    therefore validated first, which is the right order.
-- ===========================================================================
create or replace function public.ec_triage_outcome_guard()
returns trigger
language plpgsql
as $$
begin
  -- Rule 3 — an outcome, once recorded, is permanent.
  if old.outcome is not null and new.outcome is distinct from old.outcome then
    raise exception 'une décision de tri est définitive' using errcode = 'EC610';
  end if;
  if old.outcome is not null
     and (new.outcome_file_id     is distinct from old.outcome_file_id
       or new.discard_reason_code is distinct from old.discard_reason_code
       or new.outcome_recorded_by is distinct from old.outcome_recorded_by) then
    raise exception 'les éléments d''une décision de tri sont définitifs' using errcode = 'EC610';
  end if;

  -- Rule 2 — RESOLVED is only reachable with a decision.
  if new.status = 'RESOLVED' and new.outcome is null then
    raise exception 'une résolution exige une décision de tri' using errcode = 'EC611';
  end if;

  -- An outcome belongs to a resolution, never to an open item.
  if new.outcome is not null and new.status <> 'RESOLVED' then
    raise exception 'une décision de tri accompagne la résolution' using errcode = 'EC612';
  end if;

  -- Rule 1 — quarantine is EC-1's, and it is capture-time only. A quarantined
  -- item can never acquire an outcome: no tenant user can even see it.
  if old.status = 'QUARANTINED' then
    raise exception 'un élément en quarantaine n''est pas triable' using errcode = 'EC613';
  end if;

  return new;
end $$;

drop trigger if exists trg_ec_triage_outcome on public.ec_triage_item;
create trigger trg_ec_triage_outcome before update on public.ec_triage_item
  for each row execute function public.ec_triage_outcome_guard();

-- ===========================================================================
-- 4. TRANSACTIONAL RPCs — the state change, the outcome and the timeline event
--    commit together or not at all (ADR-HR2-01 as hardened in HR-4/HR-5/EC-1).
--    Authorization is checked by the APPLICATION; these are service-role only.
-- ===========================================================================

-- Assign or reassign. Reassignment is distinguished so the timeline records
-- WHICH act happened — supervisory reassignment is not the same fact as a
-- triager claiming an unassigned item.
create or replace function public.ec_assign_triage(
  p_tenant uuid, p_item uuid, p_actor uuid, p_assignee uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_prev uuid; v_msg uuid; v_reassign boolean;
begin
  select status, assigned_to, message_id into v_status, v_prev, v_msg
    from public.ec_triage_item where id = p_item and tenant_id = p_tenant for update;
  if not found then raise exception 'élément de tri introuvable' using errcode = 'EC614'; end if;
  if v_status in ('RESOLVED', 'QUARANTINED') then
    raise exception 'élément de tri terminal' using errcode = 'EC601';
  end if;
  if p_assignee is null then
    raise exception 'destinataire obligatoire' using errcode = 'EC615';
  end if;

  v_reassign := v_prev is not null and v_prev <> p_assignee;

  update public.ec_triage_item
     set status = 'ASSIGNED', assigned_to = p_assignee, assigned_at = now()
   where id = p_item;

  perform public.emit_business_event(
    p_tenant,
    case when v_reassign then 'CORRESPONDENCE_REASSIGNED' else 'CORRESPONDENCE_ASSIGNED' end,
    'communication', 'policy_rpc',
    'ec_triage_item', p_item, null, p_actor,
    jsonb_build_object('triage_item_id', p_item, 'message_id', v_msg));
  return p_item;
end $$;

-- Move an assigned item into review. No event: taking something off a shelf to
-- look at it is not an operational fact worth a permanent ledger row.
create or replace function public.ec_review_triage(
  p_tenant uuid, p_item uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select status into v_status
    from public.ec_triage_item where id = p_item and tenant_id = p_tenant for update;
  if not found then raise exception 'élément de tri introuvable' using errcode = 'EC614'; end if;
  update public.ec_triage_item set status = 'IN_REVIEW' where id = p_item;
  return p_item;
end $$;

-- THE resolution. One entry point for all four outcomes, so the invariants are
-- enforced once. For ATTACH_TO_DOSSIER the dossier is verified to belong to the
-- SAME TENANT before anything is written — cross-tenant attachment is refused
-- here as well as by RLS.
create or replace function public.ec_resolve_triage(
  p_tenant uuid, p_item uuid, p_actor uuid, p_outcome text,
  p_file_id uuid default null, p_client_id uuid default null,
  p_reason_code text default null, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_msg uuid; v_file uuid; v_client uuid; v_reason text; v_evt text;
begin
  if p_outcome not in ('ATTACH_TO_DOSSIER','HANDOFF_TO_QUOTATION',
                       'GENERAL_CORRESPONDENCE','DISCARD') then
    raise exception 'décision de tri invalide' using errcode = 'EC616';
  end if;

  select status, message_id into v_status, v_msg
    from public.ec_triage_item where id = p_item and tenant_id = p_tenant for update;
  if not found then raise exception 'élément de tri introuvable' using errcode = 'EC614'; end if;
  if v_status in ('RESOLVED','QUARANTINED') then
    raise exception 'élément de tri terminal' using errcode = 'EC601';
  end if;

  if p_outcome = 'ATTACH_TO_DOSSIER' then
    -- Tenant ownership of the dossier, verified before the link exists.
    select id into v_file from public.operational_file
     where id = p_file_id and tenant_id = p_tenant;
    if v_file is null then
      raise exception 'dossier introuvable dans ce tenant' using errcode = 'EC617';
    end if;
  elsif p_outcome = 'DISCARD' then
    v_reason := nullif(btrim(coalesce(p_reason_code, '')), '');
    if v_reason is null then
      raise exception 'motif de rejet obligatoire' using errcode = 'EC618';
    end if;
  end if;

  if p_client_id is not null and p_outcome <> 'ATTACH_TO_DOSSIER' then
    select id into v_client from public.client where id = p_client_id and tenant_id = p_tenant;
    if v_client is null then
      raise exception 'client introuvable dans ce tenant' using errcode = 'EC619';
    end if;
  end if;

  update public.ec_triage_item
     set status = 'RESOLVED',
         outcome = p_outcome,
         outcome_file_id = v_file,
         outcome_client_id = v_client,
         discard_reason_code = v_reason,
         outcome_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         outcome_recorded_by = p_actor,
         outcome_recorded_at = now(),
         resolved_at = now()
   where id = p_item;

  -- The outcome-specific timeline fact. ATTACH carries the DOSSIER as subject
  -- AND as dossier_id, which is what puts the customer interaction on that
  -- shipment's timeline (Digital LOS, communication dimension).
  if p_outcome = 'ATTACH_TO_DOSSIER' then
    perform public.emit_business_event(
      p_tenant, 'CORRESPONDENCE_ATTACHED', 'communication', 'policy_rpc',
      'operational_file', v_file, v_file, p_actor,
      jsonb_build_object('triage_item_id', p_item, 'message_id', v_msg));
  elsif p_outcome = 'HANDOFF_TO_QUOTATION' then
    perform public.emit_business_event(
      p_tenant, 'CORRESPONDENCE_QUOTATION_HANDOFF', 'communication', 'policy_rpc',
      'ec_triage_item', p_item, null, p_actor,
      jsonb_build_object('triage_item_id', p_item, 'message_id', v_msg));
  elsif p_outcome = 'DISCARD' then
    perform public.emit_business_event(
      p_tenant, 'CORRESPONDENCE_DISCARDED', 'communication', 'policy_rpc',
      'ec_triage_item', p_item, null, p_actor,
      -- reason_CODE only: the comment stays in the domain row (WES-9C).
      jsonb_build_object('triage_item_id', p_item, 'message_id', v_msg,
                         'reason_code', v_reason));
  end if;

  -- Every resolution also records the closing fact, with the outcome as a code.
  perform public.emit_business_event(
    p_tenant, 'CORRESPONDENCE_RESOLVED', 'communication', 'policy_rpc',
    'ec_triage_item', p_item, v_file, p_actor,
    jsonb_build_object('triage_item_id', p_item, 'message_id', v_msg, 'outcome', p_outcome));

  return p_item;
end $$;

revoke execute on function public.ec_assign_triage(uuid,uuid,uuid,uuid) from public;
revoke execute on function public.ec_review_triage(uuid,uuid,uuid) from public;
revoke execute on function public.ec_resolve_triage(uuid,uuid,uuid,text,uuid,uuid,text,text) from public;
grant execute on function public.ec_assign_triage(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.ec_review_triage(uuid,uuid,uuid) to service_role;
grant execute on function public.ec_resolve_triage(uuid,uuid,uuid,text,uuid,uuid,text,text) to service_role;

-- ===========================================================================
-- 5. RLS — unchanged. ec_triage_item's SELECT policy (migration 80) already
--    gates on tenant + communication:inbound:read, grants SELECT only, and has
--    no portal policy. New COLUMNS inherit it; no policy edit is needed, and
--    none is made. Quarantined rows keep tenant_id = NULL and stay invisible.
-- ===========================================================================
