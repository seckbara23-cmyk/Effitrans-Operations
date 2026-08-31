# UAT-PERF-CALENDAR-01 — Shared work calendar not visible to authorized user
## Audit report (read-only; nothing mutated, no code changed)

**Date:** 2026-08-31 · **Status:** AUDIT ONLY — awaiting approval before any fix.

---

## 1. Root cause

`/performance/calendrier` reads the calendar through `listCalendarDays`
([calendar-actions.ts:32](../../lib/hr/calendar-actions.ts)), which requires
**`hr:read`** and returns `[]` otherwise. Fary holds `performance:read` (the
page renders for her) but **no role she holds carries `hr:read`** — proven
grant by grant in production:

| role (Fary's six) | hr:read? |
|---|---|
| PERFORMANCE_MANAGEMENT | no — `performance:manage, performance:read` only |
| PERFORMANCE_PUBLISHER | no |
| CEO (Direction générale) | no |
| COMPLIANCE_HSSE | no |
| ADMINISTRATIVE_OFFICER | no |
| SYSTEM_ADMIN | no — **deliberate** (DEC-B25: SYSTEM_ADMIN holds no `hr:*`) |

I see the calendar because I hold **HR_OFFICER** (`hr:read, hr:manage`) — an
accident of my account, not a property of the Performance module.

The two paths diverge at exactly one point: **capability resolution**. Same
tenant, same page, same query shape — different effective permission set.

**Deliberate or defect?** Both, and the file proves it against itself. The
page's header comment declares the intent: *"Visible to anyone holding
performance:read — the calendar explains every délai… reading the indicators
without being able to see their time base would be opaque."* Yet the
implementation gates the data on `hr:read` and even ships an apologetic
empty-state for exactly Fary's case. The stated intent and the shipped gate
contradict each other; the gate won.

## 2. Classification

**RBAC (capability-scope defect at the read service), UI-notice aggravated.**
Not DATA (rows exist, correct tenant), not TENANT CONTEXT (identical tenants),
not RLS-in-path (the page reads via admin client), not SESSION, not CACHE.

## 3–6. Scope and identities (all proven read-only in production)

- **Calendar scope:** tenant-level by construction — `hr_calendar_day` has
  `tenant_id NOT NULL`, `UNIQUE (tenant_id, day)` (« one ruling per day »);
  `created_by` is attribution only and appears in **no** filter, policy or
  read. Nothing is user-, department- or globally-scoped.
- **The six 2026 rows:** all in tenant `…0001` — Nouvel An · Fête de
  l'Indépendance · Fête du Travail · Assomption · La Toussaint · Noël. One
  tenant, one calendar, exactly as the invariant expects.
- **My identity:** `9d9b8314-…245a`, tenant `…0001`, active.
- **Fary:** `f50a194c-…4b54`, tenant `…0001`, active. `app_user.id` is the PK
  (one login = one tenant — Phase 6.0H), so neither of us has a second
  membership to mis-select. **We are in the exact same tenant.**

## 7. Fary's effective calendar capabilities

`performance:read` ✅ · `performance:manage` ✅ · `hr:read` ❌ · `hr:manage` ❌.
So today she can open every Performance page and read every computed indicator
— but not the time base they are computed on.

## 8. RLS

One policy on `hr_calendar_day`:
`SELECT to authenticated USING (tenant_id = auth_tenant_id() AND has_permission('hr:read'))`.
No write policies (the hr:manage actions are the boundary). Visibility depends
on **tenant + `hr:read`** — not on `auth.uid()`, `created_by`, employee,
department or membership selection. A direct database read as Fary returns
**zero rows** (policy predicate false on `hr:read`), not an error — the RLS
layer and the app gate agree with each other; both refuse her. Cross-tenant
isolation is intact and untouched.

## 9. Exact read path

```
/performance/calendrier (page, force-dynamic, no caching of the read)
  → requireUser() → getEffectivePermissions(user.id)      [DB RPC, per request]
  → canRead = hasPermission('hr:read')  ← THE GATE
  → listCalendarDays(year)              ← asserts hr:read, returns [] otherwise
      → admin client (RLS bypassed; the app gate is the boundary — EC-3C idiom)
      → hr_calendar_day WHERE tenant_id = user.tenantId AND day IN year
  → canRead ? <CalendarEditor days> : explanatory notice naming hr:read
```

No creator/employee/department/year/user-ID filter exists anywhere in the
path. The database *would* return the six rows for her tenant; the
**application refuses before asking**.

## 10. Does Fary's read return rows?

Zero rows on both layers, by the same missing capability: the app gate returns
`[]`; the RLS policy would independently return zero. Consistent, and honest —
the page even tells her why, naming `hr:read` in its empty-state notice.

## 11. Is logout/login required?

**No.** `getEffectivePermissions` is a per-request DB RPC
(`get_user_permissions`) behind React `cache()` — request-scoped, not
session-embedded. Her authorization is resolved fresh on every page load; the
recent SYSTEM_ADMIN grant is already live (and irrelevant: SYSTEM_ADMIN
carries no `hr:*`, by ratified doctrine). This is not a stale session in any
form: her **current** grants genuinely lack `hr:read`.

## 12. Display-only or calculation integrity? — **DISPLAY-ONLY**, proven

The engine never reads the calendar through a viewer:

```ts
loadCalendar(tenantId, period)   // lib/performance/read.ts:110
  → admin client, server-resolved tenantId, NO permission filter, NO auth.uid()
```

Its four callers (`read.ts` dossiers + collaborators, `bi.ts`,
`report-actions.ts`) all pass the server-resolved tenant. **Two authorized
users in tenant …0001 compute identical ICTD / jours-ouvrés / worked-days
figures today — including Fary.** The invariant "authority must not silently
determine which holidays exist *in calculations*" already holds.

The governance nuance that remains: Fary is shown délai and worked-day figures
computed on a time base she cannot inspect — precisely the opacity the page's
own comment set out to avoid. Display-only, but not cosmetic.

## 13. Existing test gap

`hr_calendar_day_test.sql` proves: hr:read reads own tenant · cross-tenant
invisible even with hr:read · no write policy. **Missing:** (a) any test that a
**second authorized same-tenant reader** resolves the same calendar facts;
(b) any test of what a `performance:read`-only holder sees (the Fary shape —
zero coverage: the string `performance:read` does not appear in the suite);
(c) any pin tying the page's stated read authority to `listCalendarDays`'s
actual gate — which is how the comment and the code drifted apart unnoticed;
(d) any proof that the calculation engine's calendar is viewer-independent
(true today, unpinned).

## 14. Minimum safe correction (NOT implemented — for approval)

Widen the calendar **READ** lane to `hr:read OR performance:read`; management
stays `hr:manage`, untouched. Two coordinated edits:

1. `listCalendarDays` — accept either capability (try `hr:read`, else
   `performance:read`; both absent → `[]` as today), and the page's `canRead`
   follows the same rule.
2. **RLS parity** — migration 134: recreate `hr_calendar_day_select` as
   `tenant = auth_tenant_id() AND (has_permission('hr:read') OR
   has_permission('performance:read'))`, so a future user-client read cannot
   silently reproduce this bug in the other layer.

**Explicitly refused alternatives:** granting `hr:read` to
PERFORMANCE_MANAGEMENT (widens into the entire HR registry — employees, leave,
payroll surfaces — to fix one calendar view: authority-widening, no);
`created_by`-based or SYSTEM_ADMIN-bypass reads (wrong source of authority);
service-role reads as the "fix" (the read is already admin-client; the gate is
the point); duplicating rows for Fary (the calendar is tenant-governed — one
calendar, per §3).

## 15. Migration required — **YES (small)**

Migration 134: one RLS policy recreation on `hr_calendar_day`. No table, no
data, no grants, no new permission. (An app-gate-only fix needs no migration
but leaves the two layers disagreeing about who may read — the exact shape of
drift that produced this finding.)

## 16. Files needing modification

`lib/hr/calendar-actions.ts` (read gate) ·
`app/performance/calendrier/page.tsx` (canRead + comment/branch reconciled,
notice updated) · `supabase/migrations/2026…_calendar_read_parity.sql` (policy)
· `supabase/tests/hr_calendar_day_test.sql` (extend) ·
`tests/performance-module-access.test.ts` or new vitest (pins).

## 17. Regression tests required

- SQL: a `performance:read`-only same-tenant user reads the six rows; an
  hr:read-only user still reads; a user with neither reads zero; cross-tenant
  still invisible **for both capabilities**.
- SQL/vitest: **two authorized same-tenant users resolve identical calendar
  facts** (the missing multi-user parity test).
- Vitest: page gate == action gate (pinned to each other, so comment/code
  can't drift again); `loadCalendar` has no viewer context (pins the
  calculation-integrity property that saved us this time); management still
  `hr:manage` only.
- Mutation probes: revert the read gate to hr:read-only → red; widen
  management → red; drop tenant from the policy → red.

## 18. Shortest post-fix UAT

1. Fary (unchanged roles) opens `/performance/calendrier` → the six 2026
   entries render; no logout needed.
2. She does **not** see add/remove controls (no `hr:manage`).
3. My view: identical six entries, with management controls.
4. ICTD dossier délais: identical numbers on both accounts (already true —
   re-confirming).

## 19. Security impact

Read-widening of one tenant-scoped reference table to a capability
(`performance:read`) whose holders are already shown the numbers derived from
it. No write surface changes, no role gains a grant, no cross-tenant movement,
SYSTEM_ADMIN gains nothing, DEC-B25 undisturbed. Net effect: the calendar
becomes exactly as readable as the calculations it explains.

## 20. Verdict

**GO** for the §14 correction — evidence contradicts nothing in the business
invariant; calculations already satisfy it, and the display layer needs the
one bounded capability-lane change. Awaiting approval; nothing implemented.
