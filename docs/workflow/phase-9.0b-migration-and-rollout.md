# Phase 9.0B — Migration & Rollout (Workflow Structural Extensions)

**State after this phase: schema and actions exist, everything is DARK.** No decision,
blocker, owner, team membership or skip is ever generated automatically; no production
lifecycle transition changes; no UI exposes the new contracts.

## What ships

| Piece | Where |
|---|---|
| Migration (additive only) | `supabase/migrations/20260723000001_workflow_structures.sql` |
| Server actions (the only write path) | `lib/process/engine/structures-actions.ts` |
| Pure contracts | `lib/process/ownership.ts` · `lib/process/decision-policy.ts` · `lib/process/applicability.ts` · `lib/process/lifecycle-map.ts` |
| State-machine change | `SKIPPED → PENDING` reopen transition (`lib/process/engine/state.ts`) — additive; SKIPPED was previously terminal and never assigned |
| Flag | `EFFITRANS_PROCESS_STRUCTURES_ENABLED` (requires the engine master flag; default false) |
| RLS test | `supabase/tests/rls_workflow_structures_test.sql` (wired into the `rls-tests` CI job) |

## Migration order

One migration, self-contained, after `20260722000001_messaging_center`:

1. `alter process_instance` — owner columns (all nullable) + tenant trigger.
2. `alter process_step_execution` — `assigned_team_code`, skip provenance columns (all nullable).
3. `create process_decision` + tenant trigger + **immutability trigger** (a FINALIZED row can
   never be updated or deleted; supersede = new row).
4. `create process_blocker` + tenant trigger.
5. `create organization_team_member` + tenant trigger.
6. RLS enable + SELECT-only policies (staff: tenant + `process:read` + dossier visibility;
   team rosters: tenant only; **no portal policy on anything**).
7. Permission catalog (6 codes) + narrow seed-tenant role grants (select-driven, clean-replay
   safe; mirrored in `seed.sql` + `role-templates.ts`, parity test-enforced).

Apply with the standard operator flow (Supabase SQL editor or `supabase db push`). No data is
touched — the migration only adds.

## Verification queries (run after applying)

```sql
-- 1. New columns exist and are all NULL (no backfill ran):
select count(*) as instances, count(owner_user_id) as owned
from public.process_instance;                        -- owned = 0

-- 2. New tables exist and are empty:
select (select count(*) from public.process_decision)        as decisions,   -- 0
       (select count(*) from public.process_blocker)         as blockers,    -- 0
       (select count(*) from public.organization_team_member) as team_members; -- 0

-- 3. Permissions cataloged:
select code from public.permission where code like 'process:%'
  and code in ('process:owner:assign','process:decision:create','process:decision:approve',
               'process:blocker:manage','process:team:manage','process:step:skip');  -- 6 rows

-- 4. Grants are narrow (per role):
select r.code, count(*) from public.role_permission rp
join public.role r on r.id = rp.role_id
join public.permission p on p.id = rp.permission_id
where p.code like 'process:owner%' or p.code like 'process:decision%'
   or p.code like 'process:blocker%' or p.code like 'process:team%' or p.code like 'process:step:skip'
group by r.code order by r.code;
-- expected: SYSTEM_ADMIN 6, OPS_SUPERVISOR 6, COORDINATOR 4, CHIEF_OF_TRANSIT 3
```

## Optional backfill strategy (NOT run automatically)

Canonical owners for existing instances can be derived with the documented precedence
(coordinator → account manager) — but Phase 9.0B deliberately ships **read-side resolution
only** (`resolveEffectiveProcessOwner`). If the business later wants stored owners for legacy
instances, that is a separate operator script following the house pattern
(idempotent, audited, verification query), approved against a live status distribution first.
Until then, `owner_user_id` stays NULL on legacy rows and every reader falls back correctly.

## Activation strategy

Nothing to activate in 9.0B. The activation ladder, when 9.0C+ arrive:

1. `EFFITRANS_PROCESS_ENGINE_ENABLED=true` (deployment) — prerequisite, already the engine's own switch.
2. `EFFITRANS_PROCESS_STRUCTURES_ENABLED=true` (deployment) — makes the structures actions callable.
3. Per-tenant `tenant_process_rollout.process_engine` — the existing tenant gate (structures
   deliberately have no separate tenant column in 9.0B; they are engine plumbing, and
   per-tenant activation of user-facing behavior belongs to the phases that add that behavior).
4. Feature-specific sub-flags per 9.0C-9.0I phase.

## Rollback

- **Flag off** (`EFFITRANS_PROCESS_STRUCTURES_ENABLED` unset): every structures action refuses
  with `engine_disabled`; the tables stop being written. Instant, no data touched.
- **Migration rollback**: not required and not recommended — the schema is additive and inert
  when dark. If ever forced: the three new tables contain audited operational history once
  used; per deployment discipline they must NOT be casually dropped — export first, and never
  drop `process_decision` (append-only decision record) without a governance sign-off. The
  owner/skip/team columns are nullable and harmless to leave in place permanently.
- The `SKIPPED → PENDING` transition is only reachable through the permission-gated reopen
  action; with the flag off it is dead code, so no state rollback concern exists.

## Data-retention boundary

`process_decision` and `process_blocker` are operational records referenced by the audit log
(ids in payloads). Retention follows the audit log's own policy: keep as long as the audit
trail is kept. `organization_team_member` rows are deactivated (`active=false`), never deleted.

## Production operator checklist

1. Apply `20260723000001_workflow_structures.sql` to production.
2. Run the four verification queries above; confirm zero-row / zero-backfill results.
3. Do NOT set `EFFITRANS_PROCESS_STRUCTURES_ENABLED` (leave dark).
4. Confirm `/api/version` serves the deployed SHA and the ops console's expected-migration
   marker reads `20260723000001_workflow_structures` (probe permission `process:owner:assign`).
5. Confirm CI `rls-tests` is green (includes `rls_workflow_structures_test.sql`).

## Recommended Phase 9.0C scope

**Operations Intake and Dossier Ownership** — the first activation phase:
Operations-owned dossier creation, owner assignment at intake (using `assignProcessOwner`),
initial task generation, the Transit handoff (existing `process_handoff`), the customer's
initial milestone, and dossier-detail ownership + task display. 9.0C also decides the
ownership-reconciliation question (which legacy column becomes authoritative) with real usage
in front of it.
