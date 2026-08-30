# TMS-1B — Controlled vehicle deletion & production fleet cleanup
## Pre-implementation audit

**Date:** 2026-08-31 · **Status:** AUDIT ONLY — no code, no migration, no
production mutation. All production access read-only.
**Basis:** TMS-1A shipped and production-UAT-passed (`36f106e`, CI 692,
migration 132 verified live by object probe).

---

## 0. Production state after the TMS-1A UAT — the cleanup mostly happened

The fleet holds **3 vehicles** now, and the audit trail tells the story:

| when (UTC) | event | vehicle | detail |
|---|---|---|---|
| 08-19 → 08-20 | `vehicle.deleted` ×3 | AA-826-YY, UAT-DELETE-20 ×2 | deleteVehicle exercised in production before this program |
| 08-30 22:08 | `vehicle.retired` | `aa-605-mw` | « Demo Vehicle » |
| 08-30 22:09 | **`vehicle.deleted`** | `aa-605-mw` | **deleted 40 s after being retired** |
| 08-30 22:10–22:18 | `vehicle.retired` ×2, `vehicle.reactivated`, re-retired | UAT-TMS7-01 (« Demo Vehicle »), UAT-TMS7-99 (« No Longer exist ») | the governed lifecycle, exercised end-to-end |

Current census: **AA605MW** active/AVAILABLE/clean (untouched, and stays so) ·
**UAT-TMS7-01** retired, history intact (1 mission · 1 intervention · 2
compliance) · **UAT-TMS7-99** retired, history intact (1 intervention).
**Zero rows violate the M132 coherence CHECK.**

Two consequences:

1. **The duplicate-plate collision is already resolved.** `aa-605-mw` is gone
   (through the governed, guarded delete — audited), so a strict normalized
   uniqueness rule can be applied to production **with zero collisions today**.
2. **The retire→delete sequence is a live demonstration of the one genuine
   server-side gap** (§2/G2): deletion currently accepts a *retired* vehicle.
   Harmless here — it was a clean typo row — but it conflates exactly the two
   concepts this slice exists to separate.

## 1. Current deletion contract — verified SUFFICIENT, except one gap

Re-audited at HEAD against the brief's checklist:

| requirement | verdict | evidence |
|---|---|---|
| server-authoritative | ✅ | permission + confirmation + eligibility all re-checked in the action; browser decides nothing |
| exact typed confirmation | ✅ | registration re-compared server-side (case/space-normalized) |
| cannot delete with mission history | ✅ ×2 | app check (`vehicle_in_use`) **and** FK `NO ACTION` backstop (23503 → same refusal) |
| cannot delete with intervention history | ✅ | app check (`vehicle_has_history`) |
| no orphaned/misleading history | ✅ | `vehicle_compliance` CASCADE is deliberate (descriptive master data, documented in the action); `audit_log` survives with registration in payload; `tracking_session.vehicle_plate` is a free-text snapshot with no FK (0 rows in production) |
| no browser bypass | ✅ | RLS enabled, **zero write policies** on `vehicle` → PostgREST writes affect 0 rows; no RPC deletes vehicles; `.delete()` appears once in the repository |
| no force path | ✅ | none, by design — refusal instead of override |
| tenant isolation | ✅ | every query tenant-scoped; children guarded by `enforce_vehicle_child_tenant` |
| audit on success | ✅ | `vehicle.deleted` with registration in `before` — 5 production instances prove it |
| correct capability | ✅ | `transport:manage`, the ratified parc authority |

> **Observation (out of scope, for the OPS-SEC backlog):** Supabase's default
> grants give `anon`/`authenticated` ALL table privileges platform-wide
> (`vehicle`, `payment`, `app_user`, … all identical). The effective wall is
> RLS-without-write-policy — which the ~100 CI RLS suites prove holds — plus
> PostgREST exposing no TRUNCATE verb. Correct today, but revoking the unused
> default write grants would be honest defense-in-depth. **Not a TMS-1B
> change**: it is platform-wide, belongs to an OPS-SEC slice, and must not be
> smuggled into a fleet slice.

**G2 — the one genuine server gap: a RETIRED vehicle can be permanently
deleted.** `deleteVehicle` checks history but not `is_active` — proven live by
the `aa-605-mw` sequence. Post-TMS-1A this is wrong by the slice's own
doctrine: retirement is the terminal lifecycle for a vehicle that legitimately
existed; deletion is for mistakes, and a mistake that was also mistakenly
retired has a clean path (reactivate → delete) that keeps every act audited
under its true name. Deletion should refuse a retired vehicle.

## 2. Gap census (everything found, ranked)

| # | gap | severity | proven by |
|---|---|---|---|
| G1 | **Wrong lifecycle advice in the refusal wording** — the ERR map (2 messages) and the delete-block explainer all say « Mettez-le hors service » / « utilisez “Mettre hors service” » for a vehicle with history. Post-TMS-1A the correct advice is « Retirer du parc »; « Mettre hors service » is temporary unavailability | UX / semantics | `components/fleet/fleet-console.tsx` lines 36–37 + explainer |
| G2 | **Deletion accepts a retired vehicle** (server) — and the UI renders the delete block for retired vehicles | server hardening | live `aa-605-mw` retire→delete, 40 s apart |
| G3 | **Plate uniqueness ignores separators** — index is `upper(btrim(registration))`, so `AA605MW` / `aa605mw` collide (good) but `AA-605-MW` / `AA 605 MW` are four distinct vehicles. This is exactly how the duplicate was born | schema | the original aa-605-mw/AA605MW pair |
| G4 | **Retired vehicles sit in the primary fleet table indefinitely** — clearly chipped since TMS-1A, but the operational view will accumulate them forever | presentation | design review |
| G5 | `vehicle.reactivated` audit event carries no registration (identity answerable via `entity_id`, but the trail line reads `reg=-`) | minor / legibility | audit probe above |

Confirmed **non-gaps**: assignment/dispatch selectors already exclude retired
vehicles (`listAssignableVehicles` filters `isActive`; the sole consumer is the
dossier transport panel); operational counters already exclude them (TMS-1A);
mission/intervention/compliance/audit history survives retirement (proven in
UAT and by the SQL suite).

## 3. Plate normalization — design (STOPPED, per the brief, awaiting approval)

**Proposed rule:** two registrations are the same vehicle iff they are equal
after `upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g'))` — case,
spaces, hyphens, dots and any other separator are formatting, not identity.
`AA605MW` ≡ `aa605mw` ≡ `AA-605-MW` ≡ `AA 605 MW` → one vehicle.

**Migration 133 (forecast `20260925000001_vehicle_plate_normalization`),
additive:**

1. **Collision census FIRST** (a code census is not a data census): a DO block
   counts rows whose normalized forms collide and **raises, listing them** —
   the migration refuses to guess which duplicate is canonical. Production
   today: **0 collisions** (verified above), so it applies cleanly; the census
   protects every other environment and the future.
2. `create unique index uq_vehicle_registration_normalized on vehicle
   (tenant_id, upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g')))` —
   **all rows, including retired**: a retired duplicate is precisely the
   accident that started this (the operator reactivates rather than re-creates).
3. The existing `uq_vehicle_registration` index stays (strictly weaker,
   harmless, and dropping it buys nothing).
4. Stored registrations are **not rewritten** — the typed form remains the
   display form; only the comparison is normalized. AA605MW and all history
   untouched.

**Accepted limitation, stated rather than hidden:** if the state ever reassigns
a physical plate to a *different* vehicle, the index will refuse the new row
while the old one exists (even retired). That is the safe default — an operator
who really means it records the distinction in the registration text. No
current data is affected.

The action layer needs **no change**: unique violations already map to
`duplicate_registration` → « Cette immatriculation existe déjà dans le parc. »

## 4. Exact proposed changes (implementation, on approval)

| file | change |
|---|---|
| `supabase/migrations/20260925000001_…` | §3 design: census + normalized unique index + self-assertions |
| `lib/fleet/actions.ts` | `deleteVehicle`: refuse `!is_active` (`vehicle_retired` error, French message pointing to reactivation); add optional-but-audited deletion motif is **not** proposed — the typed registration is the confirmation, and the audit already records identity (keeping the act minimal) |
| `lib/fleet/actions.ts` | `reactivateVehicle`: include `registration` in the audit `before` (G5) |
| `components/fleet/fleet-console.tsx` | G1 wording — refusals and explainer become: « Ce véhicule possède un historique opérationnel et ne peut pas être supprimé définitivement. Utilisez “Retirer du parc” pour le conserver dans l'historique tout en le retirant de la flotte active. » « Mettre hors service » text survives only in the availability control; delete block rendered **only for active** vehicles |
| `app/transport/parc/page.tsx` | G4 — primary table lists **active** vehicles; retired ones move to a `<details>` section « Véhicules retirés (n) » beneath it (server component, no client state, history section unchanged) |
| `tests/tms-1b-…` + SQL suite | §5 below |

Nothing else. `deleteVehicle`'s guards, FK posture, audit event, confirmation
and authority are classified **sufficient and untouched**.

## 5. Required tests

- **SQL suite** (`tms_1b_plate_normalization_test.sql`, CI-wired before the
  journey): the four format variants of one plate all refuse as duplicates;
  a retired vehicle's plate still blocks a new active twin; distinct plates
  still register; deletion of a retired vehicle refused server-side is
  action-layer (vitest) — DB-side the RLS/write-policy wall is already proven.
- **Vitest matrix**: G1 wording pinned (new sentence present; « Mettez-le hors
  service » absent from every deletion context); delete block gated on
  `selected.isActive`; `deleteVehicle` refuses `!is_active`; reactivation audit
  carries registration; retired-section rendering; migration census +
  normalized index pinned (comments stripped).
- **Mutation probes**: revert the wording → red; unhide delete for retired →
  red; drop the `is_active` server check → red; weaken the regex (keep only
  `upper`) → red; drop the census → red.

## 6. Production impact

Zero data mutation. Migration 133 creates one index over 3 rows (instant) and
rewrites nothing. UI changes are presentation-only. The UAT pair and AA605MW
are untouched by construction — the only behavioural change a user can observe
is stricter duplicate refusal, corrected guidance, and the retired section.

## 7. Shortest manual UAT (post-implementation)

1. `Parc & Flotte` → « Ajouter un véhicule » with `AA-605-MW` → refused:
   « Cette immatriculation existe déjà dans le parc. » (collides with AA605MW
   through the normalized index). Same for `aa 605 mw`.
2. Primary table shows only AA605MW; « Véhicules retirés (2) » opens to the UAT
   pair with dates and motifs; their intervention history still renders below.
3. Select UAT-TMS7-01 in the console → **no** « Suppression définitive » block
   (retired); the retirement panel shows date + motif + « Réintégrer ».
4. Select AA605MW → the delete block renders, and its explainer now names
   « Retirer du parc » for vehicles with history. **Do not proceed with the
   deletion** — the typed-confirmation gate refusing a wrong registration is
   already UAT-proven.
5. `Journal plateforme`: no new lifecycle events from steps 1–4 (refusals and
   renders write nothing).

## 8. Verdict

**GO.** No business ambiguity remains: the canonical plate is resolved and
live, the collision set is empty, the UAT pair is correctly retired with
history intact, and every proposed change is a bounded hardening of mechanisms
that already work. The deletion implementation is classified **sufficient**
except the single retired-vehicle gap (G2), which the production trail itself
demonstrated. Implementation awaits explicit approval; TMS-1C remains not
begun.
