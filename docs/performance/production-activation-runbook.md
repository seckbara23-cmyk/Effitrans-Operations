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
PERFORMANCE_MANAGEMENT role ............................. absent
performance grants ...................................... 0   (expected 1 each,
                                                              to that role only)
```

**Consequence while it is missing:** the role does not exist, nobody holds
`performance:read`, and `/performance` returns 404 for every user. The module is
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

Expected: `perms = 2`, and **`read_grants = 1`, `manage_grants = 1`** — both held
by `PERFORMANCE_MANAGEMENT` and by no other role. A count above 1 means an
operational role acquired performance access, which the ruling forbids.

---

## 3. Granting access to real Effitrans users

**RATIFIED 2026-08-28.** Access is an explicit role assignment. Migration 129
creates the role **`PERFORMANCE_MANAGEMENT`**, shown to operators as
**« Gestion de la Performance »**, and grants the two capabilities to it and to
nothing else. No job role carries performance access — not CEO, not
OPS_SUPERVISOR, not SYSTEM_ADMIN.

### To give someone access

1. Administration → **Utilisateurs** → open the person.
2. **Ajouter un rôle…** → choose **Gestion de la Performance** → **Attribuer**.
3. The role appears among their role chips, alongside whatever they already are.

It is an *additional* access role: somebody stays CEO, Chargé RH or Operations
and holds this as well. Removing it through the same screen removes module
access and leaves every other role untouched — proven in CI against the real
seeded roles (`before_assignment_no_access` → `assignment_grants_access` →
`removal_revokes_access`, with `job_role_survives_assignment` and
`job_role_survives_removal` on either side).

### Verify an assignment took

```bash
env -u SUPABASE_ACCESS_TOKEN npx supabase db query --linked   "select u.email, r.code
     from public.user_role ur
     join public.app_user u on u.id = ur.user_id
     join public.role r on r.id = ur.role_id
    where r.code = 'PERFORMANCE_MANAGEMENT';"
```

### Who can assign it

Any holder of `admin:roles:manage` / `admin:users:update` — SYSTEM_ADMIN in
practice. SYSTEM_ADMIN can **assign** the role without **holding** it, which is
deliberate: administering the platform is not a reason to read what a named
colleague produced last month. That follows DEC-B61, which already withholds
`hr:*` from SYSTEM_ADMIN because the data is personal; per-person indicators
computed partly from that leave data are the same kind of fact. If a system
administrator should read performance, assign them the role like anyone else.

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
