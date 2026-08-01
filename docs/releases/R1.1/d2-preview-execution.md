# R1.1 · D2 — Preview visual sign-off: execution guide

**Date:** 2026-08-01 · **Gate owner:** Finance Manager (sign-off) + operator (setup)
**Scope: PREVIEW ONLY.** Nothing here touches production — the only production-adjacent
step is pushing a git branch, which Vercel builds as a *preview* deployment.

Companion to [`../../finance/aging/preview-runbook.md`](../../finance/aging/preview-runbook.md);
this guide adds what the runbook predates: the post-R1.0 state, the preview-DB safety
preflight, and the role-seeding SQL the demo tenant needs (the dataset script creates the
tenant **bare** — no roles, no logins).

> **Runbook staleness note (do not be confused by it).** The runbook's gate table says
> production has « migration 72: not applied » and « permission row does not exist ».
> That was true when written; **R1.0-R reconciled migration 72 and its grants are live in
> production**. Production darkness now rests on **one** gate: the unset
> `EFFITRANS_FINANCE_AGING_ENABLED` (route 404s). This changes nothing for D2 — but it is
> why D5 is a single flag flip, and why nobody should re-run the runbook's gate table as
> a current claim about production.

---

## Step 1 — Identify the preview stack and PROVE it is not production

Two things must exist: a **preview Supabase project** and the **Vercel Preview
environment** wired to it (gate C3 of Phase 8.0 required the refs to differ).

1. Vercel → Project → Settings → Environment Variables → filter by **Preview**.
   Read `NEXT_PUBLIC_SUPABASE_URL` for the **Preview** row.
2. **STOP CONDITION:** if that URL contains `xtpppzhkiagdpmnghdlc` (the production ref),
   the Preview environment points at the production database — **abort D2** and fix the
   env before anything else. No step below may run against that ref.
3. Note the preview DB connection string (`$PREVIEW_DATABASE_URL`, from the preview
   Supabase project's settings). Same stop condition applies to it.

**Preflight, run against `$PREVIEW_DATABASE_URL` (read-only):**

```sql
-- fingerprint: this must NOT look like production
select
  (select count(*) from public.organization)                                  as org_count,
  (select count(*) from public.invoice)                                       as invoice_count,
  exists (select 1 from public.invoice where invoice_number = 'EFT-INV-2026-00001')
                                                                              as has_production_invoice;
```

**STOP if `has_production_invoice` is true** — that is production or a copy of it fresh
enough to be treated with production care.

Record: preview ref = `________` · production ref `xtpppzhkiagdpmnghdlc` · differ ✔

## Step 2 — Verify / apply migration 72 on the preview DB

Check first (read-only):

```sql
select to_regclass('public.aging_report')                                   is not null as tables_present,
       (select count(*) from public.permission where code like 'finance:aging:%') = 11  as perms_present;
```

- Both true → skip to Step 3.
- Otherwise apply — the migration is idempotent (`create table if not exists` × 10,
  guarded policies/triggers), so a partial prior state is safe:

```bash
psql "$PREVIEW_DATABASE_URL" -f supabase/migrations/20260729000002_aging_balance_foundation.sql
```

Re-run the check; both must be true. Record both booleans.

## Step 3 — Load the synthetic dataset

```bash
psql "$PREVIEW_DATABASE_URL" -f supabase/demo/aging_preview_dataset.sql
```

Safety is in the script itself: own tenant (`00000000-0000-0000-0000-00000000de00`),
aborts if that tenant holds non-demo invoices, every row `DEMO-`/« Démo »-prefixed,
idempotent re-run. `\set ON_ERROR_STOP on` is already in the file.

**Verify (read-only):**

```sql
select
  (select count(*) from public.invoice where tenant_id = '00000000-0000-0000-0000-00000000de00') as demo_invoices,  -- expect 25
  (select count(*) from public.client  where tenant_id = '00000000-0000-0000-0000-00000000de00') as demo_clients;   -- expect 12
```

## Step 4 — Reviewer login (the runbook's missing mechanics)

The dataset creates **no roles and no users** in the demo tenant. Preview-only SQL:

```sql
-- 4a. a DAF role in the demo tenant (DAF holds all 11 aging codes per the ratified matrix)
insert into public.role (tenant_id, code, label_fr)
values ('00000000-0000-0000-0000-00000000de00', 'DAF', 'DAF (démo)')
on conflict do nothing;

-- 4b. grant it every finance:aging:* permission
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
  from public.role r
  join public.permission p on p.code like 'finance:aging:%'
 where r.tenant_id = '00000000-0000-0000-0000-00000000de00' and r.code = 'DAF'
on conflict do nothing;
```

Then create the auth login in the **preview** Supabase dashboard:
**Authentication → Users → Add user** — email e.g. `revue.aging@demo.effitrans.sn`,
a password, **Auto Confirm ON**. Copy the created user's UUID, then:

```sql
-- 4c. attach it to the demo tenant with the demo DAF role  (replace <AUTH_UUID>)
insert into public.app_user (id, tenant_id, email, name, status)
values ('<AUTH_UUID>', '00000000-0000-0000-0000-00000000de00',
        'revue.aging@demo.effitrans.sn', 'Revue Aging (démo)', 'active')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '<AUTH_UUID>', r.id, r.tenant_id
  from public.role r
 where r.tenant_id = '00000000-0000-0000-0000-00000000de00' and r.code = 'DAF'
on conflict do nothing;
```

## Step 5 — Flag + preview deployment

1. Vercel → Settings → Environment Variables → **Add**:
   `EFFITRANS_FINANCE_AGING_ENABLED` = `true`, environment **Preview ONLY** —
   double-check the Production box is **unchecked** before saving.
2. Env vars apply at build time → a **new preview build** is needed. From the repo:
   ```bash
   git checkout -b preview/aging-d2 && git push -u origin preview/aging-d2
   ```
   Vercel builds the branch as a preview deployment carrying the Preview env. Open the
   deployment URL from the Vercel dashboard (`…-git-preview-aging-d2-….vercel.app`).
3. Log in as `revue.aging@…` on **that URL** → `/departments/finance` should show the
   « Balance âgée » tile → `/finance/aging` renders.

**Cross-check while there (expected, honest):** production `/finance/aging` still 404s —
the flag was Preview-scoped. Record that check.

## Step 6 — The §4 visual checklist, recordable form

Reviewer: **Finance Manager**, on the preview URL, logged in as the demo reviewer.
The four URLs to exercise: `/finance/aging` · `?date=2026-06-12` (figures must change) ·
`?currency=EUR` · `?population=OVERDUE_ONLY`.

| # | §4 item | What to confirm | ✔/✘ + note |
|---|---|---|---|
| V1 | Tableau de bord | « Total encours » clearly the headline; tooltips on « Retard moyen »/« Dossiers critiques » adequate; bucket table reads green→red; « TOTAL GÉNÉRAL » prominent | |
| V2 | Données brutes | density at 50 rows; sticky header helps; the six filters are the right six; « N affichée(s) sur M » cannot be mistaken for a smaller portfolio | |
| V3 | Analyse clients | ranking readable; risk badges meaningful without colour; « Part encours » to one decimal | |
| V4 | Dossiers critiques | urgency visible; legacy refs + dispute markers legible; follow-up column width | |
| V5 | Graphiques | bucket labels legible; colours consistent with dashboard; narrow-window behaviour | |
| V6 | Terminology | every French label natural against the workbook's wording — **the item the author most wants challenged** | |
| V7 | Mobile | KPI cards stack; tables scroll inside their container (page never scrolls sideways); tabs wrap | |
| V8 | Dataset states | 365 vs 366 boundary; partial payment `DEMO-INV-0023`; settled `-0024` excluded; overpayment `-0025` credit; dispute `-0017`; EUR exclusion notice; « Faible » floor client; back-dated arrêté changes figures | |

**Q-01 confirmation on screen (new since the runbook):** with Q-01 now closed verbatim,
V8's partial-payment row is also a semantic check — `DEMO-INV-0023` must show
**5 000 000** (8 000 000 billed − 3 000 000 paid), i.e. « Montant » is the *outstanding
balance*, not the invoice total. If it shows 8 000 000, stop: that is a Q-01 violation,
not a cosmetic finding.

## Step 7 — Record and determine

- Every row ✔ (cosmetic notes allowed — record them as FIN-AGING-3C candidates, they do
  not fail D2) → **D2 PASS**: Finance Manager records name + date here and in the §D
  checklist. **D5 becomes unblocked** (D1 ✅ · D2 ✅ · D3 ✅ · D4 ✅).
- Any ✘ that is *semantic* (wrong figure, wrong bucket, Q-01 violation, missing
  exclusion notice) → **D2 FAIL**: stop, record, fix under a governed change, re-run D2.
  The flag stays off everywhere but Preview.

### Teardown (after D7, not before)

The dataset file ends with a commented teardown block removing every demo row including
the tenant. The preview branch and the Preview env var can stay — they are inert.

---

**D2 result:** ☐ PASS ☐ FAIL · Finance Manager: ____________ · Date: ________
