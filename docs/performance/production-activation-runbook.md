# Gestion de la Performance — production activation runbook

**Verified against production 2026-08-28, read-only** (`supabase db query --linked`).
Nothing in this document has been executed against production by the build; every
step below is an operator action.

---

## 1. What production already has

Migrations **127** (`hr_working_day_calendar`) and **128** (`customs_governed_data`)
are **already applied**. They were applied out-of-band by the Supabase↔GitHub
integration — the mechanism `docs/operations/migration-ledger-reconciliation.md`
describes — so their schema is live while their CLI ledger markers are blank.

Postconditions verified in production:

| check | expected | production |
|---|---|---|
| `customs_record` governed columns | 5 | **5** |
| `declaration_type` CHECK listing SIMPLE | 1 | **1** |
| …and admitting `DPE` | 0 | **0** |
| `record_customs_correction` + `record_customs_revalidation` | 2 | **2** |
| `customs_correction_worm` trigger | 1 | **1** |
| `customs_correction` policies / write policies | 1 / 0 | **1 / 0** |
| `hr_calendar_day` policies / write policies | 1 / 0 | **1 / 0** |
| `customs:correct` grants | 2 | **2** |
| `customs:revalidate` grants | 3 | **3** |

D3 and D4 are therefore **live in production**, with the ratified authority model
intact and no write policy on either governed table.

---

## 2. What production is missing — ONE migration

**129 — `20260921000001_performance_management_access`** is genuinely not applied:

```
performance:read / performance:manage permissions ....... 0   (expected 2)
performance:read grants ................................. 0   (expected 3)
performance:manage grants ............................... 0   (expected 2)
```

**Consequence while it is missing:** nobody holds `performance:read`, so
`/performance` returns 404 for every user — including the CEO. The module is
deployed and inert. That is the correct failure mode (a missing capability
refuses rather than opens), but it means **UAT cannot begin until 129 is applied**.

It may still land on its own: the integration applied 127/128 after their commit,
and 129 shipped in `cf12f09`, whose CI passed ~20 minutes before this check. Verify
before doing anything manual.

### Operator action

**Step 1 — check whether it has already landed:**

```bash
env -u SUPABASE_ACCESS_TOKEN npx supabase db query --linked \
  "select count(*) as perms from public.permission
    where code in ('performance:read','performance:manage');"
```

`perms = 2` → nothing to do, go to §3. `perms = 0` → step 2.

**Step 2 — apply it.** Because 123–128 carry blank ledger markers, a bare
`supabase db push` would try to re-apply migrations whose objects already exist
and fail. Repair the markers for what is already live FIRST, then push:

```bash
# Mark as applied the six migrations whose schema is already in production.
env -u SUPABASE_ACCESS_TOKEN npx supabase migration repair --status applied \
  20260915000001 20260916000001 20260917000001 20260918000001 20260919000001 20260920000001

# Confirm 129 is the only pending one.
env -u SUPABASE_ACCESS_TOKEN npx supabase db push --dry-run --linked

# Apply it.
env -u SUPABASE_ACCESS_TOKEN npx supabase db push --linked
```

`migration repair` writes only to `supabase_migrations.schema_migrations`, which
the application never reads; it creates and drops no schema object. It is
reversible with `--status reverted`.

**Step 3 — verify the postconditions:**

```bash
env -u SUPABASE_ACCESS_TOKEN npx supabase db query --linked \
  "select
     (select count(*) from public.permission
       where code in ('performance:read','performance:manage')) as perms,
     (select count(*) from public.role_permission rp
        join public.permission p on p.id = rp.permission_id
       where p.code = 'performance:read') as read_grants,
     (select count(*) from public.role_permission rp
        join public.permission p on p.id = rp.permission_id
       where p.code = 'performance:manage') as manage_grants;"
```

Expected: `perms = 2`, `read_grants = 3` (CEO, OPS_SUPERVISOR, SYSTEM_ADMIN),
`manage_grants = 2` (CEO, SYSTEM_ADMIN).

---

## 3. Granting access to real Effitrans users

The migration grants the two capabilities to **role templates**. A named person
receives them through the platform's ordinary user administration
(Administration → Utilisateurs), by holding one of those roles. No parallel
mechanism exists and none was created.

To give someone access without making them an OPS_SUPERVISOR, grant
`performance:read` to their existing role through the normal permission
management screen. The capability is deliberately thin: it opens the module and
confers nothing else — not `hr:manage`, not `customs:update`, not correction
authority. That separation is asserted in CI in both directions.

---

## 4. Before the first UAT session

- **The calendar is empty.** Until HR records the Senegal public holidays for the
  period, every jours-ouvrés figure excludes weekends only. The module says so on
  the Calendrier tab rather than quietly under-reporting.
- **The five customs elements are empty on existing dossiers.** They are nullable
  by design, so historical dossiers read « non calculable » rather than scoring
  zero. ICTD becomes meaningful as declarants capture them on new dossiers.
- **ICAM and IPAM will show as unavailable.** That is correct, not a defect: their
  source registers do not exist. See the completion report for the list.
