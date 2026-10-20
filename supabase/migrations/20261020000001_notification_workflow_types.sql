-- INTERNAL-COMMS-PUSH-01B / B3 — distinct types for verified workflow events.
-- ===========================================================================
-- WHY. `public.notification.type` has carried workflow events under
-- `FILE_ASSIGNED` since the engine started producing them. Five different
-- things — a department handoff, a customs milestone, a customs release, a
-- transport order, an approval decision — arrive in the bell wearing the same
-- label, so an operator cannot triage by type and a notification title is the
-- only thing distinguishing them. That is tolerable for an in-app list and
-- unusable for anything that has to summarise a notification in a few words.
--
-- ADDITIVE, AND ONLY ADDITIVE. Every value that was legal before this migration
-- is legal after it. The 281 rows in production at the time of writing hold
-- `FILE_ASSIGNED` (153), `TASK_ASSIGNED` (120) and `MESSAGE_RECEIVED` (8), and
-- not one of them is rewritten, re-typed or touched. Nothing is removed, so
-- this migration cannot invalidate a row that already exists.
--
-- WHAT THIS MIGRATION DOES NOT DO. It adds no column, no index, no policy, no
-- trigger, no function, no permission and no grant. `notification` keeps its
-- select-only RLS (`tenant_id = auth_tenant_id() and user_id = auth.uid()`),
-- keeps having NO insert/update/delete policy, and keeps its tenant-integrity
-- trigger. A notification type is a label; widening the label set must not
-- widen who can read or write one.
--
-- ⚠ DEPLOYMENT ORDER. Producers that emit the new values must NOT ship before
-- this migration is applied. `createNotification` swallows an insert error by
-- design (a notification must never fail the business action it describes), so
-- a producer running ahead of its constraint would lose notifications SILENTLY
-- rather than fail loudly. Migration first, producers second.
-- ===========================================================================

alter table public.notification
  drop constraint if exists notification_type_check;

alter table public.notification
  add constraint notification_type_check
  check (type in (
    -- Phase 1.6 — tasks.
    'TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE',
    -- Phase 1.x — dossier assignment, and the catch-all the engine has been
    -- using for every workflow event until now. KEPT: 153 production rows.
    'FILE_ASSIGNED',
    -- Phase 8.7 — Effitrans Messaging Center.
    'MESSAGE_RECEIVED', 'CONVERSATION_ASSIGNED',
    -- 01B-B3 — ONLY the events this gate actually emits. A permitted value with
    -- no producer is dead schema: it looks like coverage, cannot be tested
    -- end to end, and invites someone to assume the notification exists. The
    -- remaining candidates from the 01A matrix (customs milestone, customs
    -- release, transport ordered, approval decided) are deliberately absent
    -- until a producer is written for each.
    'HANDOFF_RECEIVED',     -- a dossier reached your department
    'MISSION_STARTED',      -- a driver opened a tracking session
    'MISSION_COMPLETED'     -- a driver closed one
  ));

comment on constraint notification_type_check on public.notification is
  'INTERNAL-COMMS-PUSH-01B / B3. Additive: every value legal before this migration is still legal. Widening the label set grants no read or write authority — notification RLS stays select-only and the tenant-integrity trigger is unchanged.';
