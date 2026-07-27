# WES-3B — Rollout Consistency Repair: Recouvrement Activation

**Date:** 2026-07-27 · **No migration** — the schema and the persisted row were both correct.

---

## 1. The complete call chain

```
Platform checkbox                components/platform/rollout-controls.tsx
  -> server action               lib/platform/rollout-actions.ts :: setTenantRollout
  -> authority                   assertPlatformPermission("platform:rollout:manage")
  -> table                       public.tenant_process_rollout
  -> row key                     tenant_id  (UUID, onConflict: "tenant_id")
  -> persisted columns           process_engine, process_workspaces,
                                 physical_invoice_deposit, collections, note,
                                 updated_at, updated_by, first_enabled_at
  -> invalidation                revalidatePath("/platform/rollout")
  -> returns                     the NORMALIZED persisted state, which the UI adopts

Tenant read                      lib/process/rollout-server.ts
  -> getTenantProcessFlags(tenantId)     React cache() — REQUEST-scoped
  -> getTenantRollout(tenantId)          .eq("tenant_id", tenantId)
  -> resolveEffectiveFlags(env, rollout) lib/process/rollout.ts
  -> consumers                   Finance tile · sidebar · /collections
```

| Boundary | Tenant ID | Input | Persisted | Resolved | Cache |
|---|---|---|---|---|---|
| Checkbox | `row.tenantId` (UUID, displayed on the card) | `collections: true` | — | — | none |
| `setTenantRollout` | `input.tenantId` | `collections: true` | `collections = true` | — | `revalidatePath` |
| `getTenantRollout` | `user.tenantId` | — | `collections = true` | `true` (raw row) | React `cache()`, per request |
| `resolveEffectiveFlags` | same | env + row | — | **`false`** | none |
| Finance tile | same | — | — | **`false`** | none |

---

## 2. Root cause — **none of the suspected classes**

Not caching. Not a tenant mismatch. Not a persistence failure. Not duplicate rows, a key
mismatch, a duplicate resolver, or static rendering.

**A tenant rollout toggle is ANDed with a PER-FEATURE DEPLOYMENT flag.**

```ts
// lib/process/rollout.ts
collections: enabled && env.collections && t.collections
```

`env.collections` comes from `EFFITRANS_COLLECTIONS_ENABLED`, and the parser is
`on = (v) => v === "true"` — so an **unset** variable is `false`. With that variable absent
from the deployment, `collections` resolves to `false` for **every** tenant, no matter what
the row says.

The row was persisted correctly. The write path checks its result, returns the persisted
state, and the UI adopts it. Everything worked as designed. **The defect is that the console
displayed the raw tenant row as though it were the live state**, while
`getRolloutOverview` was already computing the effective value for exactly this reason —
its own comment says *"the console must show what is LIVE, not what someone once ticked."*

The control surfaced this for the **master** switch (*« coché, mais l'interrupteur global est
coupé »*) but not for the **per-feature** flags. So Recouvrement could be ticked, persisted,
and invisible, with nothing on screen explaining why.

Both screens were telling the truth about different things. Neither was lying; neither was
complete.

---

## 3. The repair — UI truthfulness, nothing else

`RolloutControls` now receives the per-feature deployment flags and marks any capability
that is ticked but not live:

> **Activé pour ce tenant, mais INACTIF :** le commutateur de déploiement de cette
> fonctionnalité est coupé. Les utilisateurs ne la verront pas.

Wired at both platform call sites (`/platform/rollout` and the company detail page).

**No behaviour changed.** No migration, no new flag store, no permission change, no
automatic enablement, no `/finance/recouvrement`. The fail-closed doctrine is untouched and
re-proven by test: missing row → off; tenant engine off → everything off; master switch off
→ everything off.

---

## 4. Operator steps — required to actually enable Recouvrement

The code is correct; **the deployment is missing an environment variable.** This is an
operator action and is deliberately not automated.

### 4.1 Read-only diagnostic

```sql
-- Which tenants have collections ticked, and is the row unique?
select o.id            as tenant_id,
       o.name,
       o.slug,
       r.process_engine,
       r.collections,
       r.updated_at,
       count(*) over (partition by r.tenant_id) as rows_for_tenant
from public.organization o
left join public.tenant_process_rollout r on r.tenant_id = o.id
order by o.name;
```

Expected for Effitrans: exactly one row, `process_engine = true`, `collections = true`,
`rows_for_tenant = 1`. If that is what you see, **the database is correct and no data repair
is needed** — the fix is the environment variable below.

### 4.2 The actual fix

Set on the deployment (Vercel → Project → Settings → Environment Variables), then redeploy
**or** restart so the server process picks it up:

```
EFFITRANS_COLLECTIONS_ENABLED=true
```

The value must be exactly `true` — `1`, `TRUE` and `yes` are all read as false, and a test
pins that.

Note the master switch is also required and presumably already set:
`EFFITRANS_PROCESS_ENGINE_ENABLED=true`.

### 4.3 Verification

After the deployment picks up the variable:

1. `/platform/rollout` — the *recouvrement* pill in the global kill-switch card turns on,
   and the amber "INACTIF" note disappears from the Effitrans card.
2. Tenant app → **Finance** — the Recouvrement tile appears for a user holding
   `collections:manage`.
3. `/collections` opens.

No logout is required: `getTenantProcessFlags` is request-scoped, so a normal refresh is
enough once the process has the variable.

### 4.4 Rollback

Remove the variable, or set `EFFITRANS_COLLECTIONS_ENABLED=false`, and redeploy. Every
tenant's Recouvrement goes dark immediately; no tenant row is modified, so re-enabling
restores exactly the previous per-tenant state.

### 4.5 If the diagnostic shows something else

- **`rows_for_tenant > 1`** — duplicate rollout rows. Do not delete blindly; report it, and
  repair with the operator present. `getTenantRollout` uses `maybeSingle()`, which would
  error on duplicates and then **fail closed**, so the symptom would be the same.
- **`collections = false`** — the write did not land. Re-tick it and watch for the error
  banner; the action returns `write_failed` and reverts the checkbox on failure.
- **no row at all** — fail-closed by design. Tick the engine first, then Recouvrement.

---

## 5. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3798 passed / 168 files** (28 new) |
| Production build | compiled |
| SQL/RLS suites | **52**, unchanged — no SQL changed |
| Migrations | 65, unchanged |
| Seed | unchanged |

The new tests exercise the real resolvers rather than scanning source: they **reproduce**
the defect (row on + flag unset → resolved off), prove it disappears when the flag is set,
and pin the `v === "true"` parsing that made it silent.

---

## 6. Known limitations

1. **The environment variable is still required.** This repair makes the console honest; it
   cannot enable a capability the deployment withholds, and it must not.
2. **Per-feature deployment flags remain env-only.** Making them operator-editable would be
   a rollout-system redesign, which this phase's scope forbids.
3. **The amber notice is per-tenant-card.** The global kill-switch card already shows the
   same information as pills; there are now two places to read it, which is deliberate
   redundancy at the point of decision rather than a single distant indicator.
