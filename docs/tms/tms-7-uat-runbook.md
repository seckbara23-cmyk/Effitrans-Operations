# TMS-7 — End-to-End Production UAT: audit & runbook

**Date:** 2026-08-19 · Scope: the accumulated acceptance criteria of TMS-1,
QO-1, TMS-2, TMS-3, TMS-4, TMS-5/5A/5B/5C and TMS-6. **No feature development.**
Every criterion below is inherited verbatim from its ratified contract — none is
weakened, replaced or reinterpreted.

## 1. Production baseline (read-only, verified 2026-08-19)

| Fact | Value |
| --- | --- |
| Migrations applied | **115–119**, local = remote (`transport_provider` present in prod) |
| Execution-source CHECK | `transport_execution_source_exclusive` **present** |
| Interlock triggers | `trg_transport_vehicle` + `trg_transport_provider` **both armed** |
| Dossiers | 3 — `EFT-IMP-2026-00001` (DELIVERED), `…00002` (DRAFT), `…00003` (CLOSED) |
| Transport records | 3 |
| Vehicles | **0** (the TMS-5C test vehicle AA-826-YY was permanently deleted — `vehicle.deleted` is in the audit log, so controlled deletion has already been exercised once in production) |
| Providers | **0** |

**Consequence for UAT:** both execution branches start from an empty registry,
so every object this runbook uses is **new and clearly identifiable**. The three
existing dossiers are genuine records and are **never modified** — they are read
only, as the regression baseline.

## 2. Test-object naming (production safety)

| Object | Value to use |
| --- | --- |
| Dossier | created fresh; client « UAT » if one exists, else any client — reference `UAT-TMS7` |
| Fleet vehicle | immatriculation **`UAT-TMS7-01`**, code interne `UAT-01` |
| Throwaway vehicle (deletion test) | **`UAT-TMS7-99`** |
| Subcontractor | **`UAT Transporteur SARL`** |

Nothing else is created. No genuine record is altered, and **no historical
evidence is deleted to make a test pass**.

## 3. Category A — Automatable verification (executed 2026-08-19)

| Evidence | Result |
| --- | --- |
| 11 phase suites (TMS-1, QO-1, TMS-2, TMS-3, TMS-4, TMS-5, 5A, 5B, 5C ×2, TMS-6) | **245/245 PASS** |
| Full vitest | 7029 passed / 1 skipped (only the known CRLF-local expense pin) |
| Typecheck + production build | clean |
| CI #519 (`6d0392b`) — `rls-tests` runs every SQL suite against a real Postgres after applying all 119 migrations | **GREEN** |
| DB-behavioural suites proven live in that run | `tms_2` geography, `tms_5` fleet (interlock, one-open-immobilisation, cross-tenant), `tms_6` subcontractor (**exclusion CHECK**, approval interlock, cross-tenant, carrier-name history) |

These establish that the invariants hold **in a database**. They do **not**
substitute for any human case below.

## 4. Category B — Production database verification (operator-run, read-only)

Run in the Supabase SQL editor. Each is READ-ONLY.

**B1 — schema and interlocks are live**
```sql
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='transport_provider') as provider_table,
  (select count(*) from pg_constraint
     where conname='transport_execution_source_exclusive') as exclusion_check,
  (select count(*) from pg_trigger
     where tgname in ('trg_transport_vehicle','trg_transport_provider')) as interlocks;
-- expect: 1, 1, 2
```

**B2 — no transport ever claims two executors (the TMS-6 invariant, in real data)**
```sql
select count(*) as contradictions from transport_record
 where vehicle_id is not null and provider_id is not null;
-- expect: 0
```

**B3 — « En mission » is derived, never stored** (run after UAT-12)
```sql
select v.registration, v.status,
       (select count(*) from transport_record t
         where t.vehicle_id = v.id and t.status in
               ('PLANNED','DRIVER_ASSIGNED','PICKED_UP','IN_TRANSIT')) as engaged_now
  from vehicle v where v.registration = 'UAT-TMS7-01';
-- expect: status stays 'AVAILABLE' while engaged_now = 1
--         (the parc shows « En mission » from the second column, not the first)
```

**B4 — carrier-name history survives a provider rename** (run after UAT-17)
```sql
select t.transport_company as printed_carrier, p.name as registry_name_now
  from transport_record t join transport_provider p on p.id = t.provider_id
 where t.transport_company is not null;
-- expect: printed_carrier keeps the name as at assignment; registry_name_now differs
```

**B5 — audit trail of the UAT session**
```sql
select action, count(*) from audit_log
 where action like 'vehicle%' or action like 'transport_provider%'
    or action like 'transport.%' or action = 'file.commercial_owner_assigned'
 group by action order by action;
```

**B6 — tenant isolation (structural)**
```sql
select count(*) as cross_tenant_leaks from transport_record t
  left join vehicle v on v.id = t.vehicle_id
  left join transport_provider p on p.id = t.provider_id
 where (v.id is not null and v.tenant_id <> t.tenant_id)
    or (p.id is not null and p.tenant_id <> t.tenant_id);
-- expect: 0
```

## 5. Category C — Human production UAT (operator-run, one at a time)

Sequenced so early objects are reused. **The operator performs these; a green
test suite never marks one PASS.**

| ID | Inherited from | What it proves |
| --- | --- | --- |
| UAT-01 | TMS-5B | Transport is a department in the sidebar, in the ratified order |
| UAT-02 | TMS-5B/5A | Transport owns its four responsibilities; Transit no longer shows them |
| UAT-03 | TMS-5 vehicle registry + **TMS-5C** stale-selection fix | **PASS** (operator, 2026-08-19) | `UAT-TMS7-01 / UAT-01` (Renault Midlum 2020, Camion, 5000 kg) created from an EMPTY parc; tiles auto-updated 1/1/0/0/0/0 without manual refresh; row Disponible / Non renseignée; vehicle became the active « Véhicule concerné »; conformité, intervention and « Mettre hors service » all ENABLED; « Déclarer disponible » correctly disabled with « État actuel : Disponible »; suppression area present | None — **the original TMS-5C production defect did not recur** | Closed |
| UAT-04 | TMS-5 compliance — dates/references only, reusing `classifyExpiry` | **PASS** (operator, 2026-08-19) | `Assurance : Expire bientôt (2026-09-03)` (amber) and `Visite technique : Valide (2027-06-15)` (teal) rendered on the row; « Conformité à surveiller » = 1; vehicle stayed Disponible (1/1); **no file-upload control exists** | None. An initial mismatch was **operator test-data entry error** (wrong expiry date), corrected by re-entry — not a product defect. The re-entry additionally exercised the ratified renewal path (one row per vehicle+type, updated in place, no duplicate) | Closed |
| UAT-05 | TMS-5 immobilising intervention + availability interlock; TMS-5A history rendered | **PASS** (operator, 2026-08-19) | « Imprévue » intervention `UAT-TMS7 — plaquettes de frein` opened; vehicle moved Disponible → **Maintenance automatically** (not set by hand); tiles Disponibles 0 / En maintenance 1; entry shown in « Historique des interventions » as En cours · Imprévue · immobilisante; **« Déclarer disponible » REFUSED** with « Une intervention immobilisante est déjà ouverte pour ce véhicule. » and État stayed Maintenance | None | Closed — interlock proven non-bypassable from the UI |
| UAT-06 | TMS-5/5C close intervention → return to service | **PASS** (operator, 2026-08-19) | Intervention closed with a résolution; vehicle returned to **Disponible** | None | Closed |
| UAT-06b | TMS-5 out-of-service and reinstatement | **PASS** (operator, 2026-08-19) | Full lifecycle demonstrated end-to-end: **Disponible → Maintenance → Disponible → Hors service → Disponible**; transitions, maintenance lifecycle, dispatch interlock and reinstatement coherent together | None | Closed |
| UAT-07 | TMS-6 provider registry — external company, approved on creation | **PASS** (operator, 2026-08-19) | `UAT Transporteur SARL` (NINEA `UAT-NINEA-001`) registered directly in **Agréé** state; tiles 1/1/0/0; contact rendered; provider auto-became the active « Sous-traitant concerné » without reload (same self-healing selection as UAT-03); « Agréer » correctly disabled as already-agréé, « Suspendre » and « Retirer du répertoire » enabled; « Aucun transport confié à ce jour. » shown | None | Closed |
| UAT-09 | QO-1 « Sans devis » + TMS-1 « À affecter » (+ TMS-2 anchors observed) | **PASS** (operator, 2026-08-19) | Dossier **EFT-IMP-2026-00004** created (client SENEGAL DISTRIBUTION DEMO SARL, réf. `UAT-TMS7`, IMP/Maritime, Shanghai → Dakar). « Origine commerciale » = **Sans devis** with no devis falsely associated. « Responsable client » = **À affecter**, UI states the creator is not automatically Responsable client, no auto-assignment. Responsabilités panel corroborates: Responsable commercial **Non désigné**, Responsable opérationnel **Non désigné**. **TMS-2 bonus**: both référentiel selectors appeared, Port de Shanghai (CNSHA) / Port de Dakar (SNDKR) selected and persisted | None | Closed — QO-1 and TMS-1 creation invariants proven together |
| UAT-03 | TMS-5 | A vehicle can be registered (Parc & Flotte) |
| UAT-04 | TMS-5 | Compliance dates recorded; expiry state rendered |
| UAT-05 | TMS-5/5C | Immobilising intervention → Maintenance; excluded from dispatch |
| UAT-06 | TMS-5/5C | Close intervention → return to service |
| UAT-07 | TMS-6 | An external provider can be registered and approved |
| UAT-08 | TMS-6 | A suspended provider cannot be assigned — **RESEQUENCED after UAT-11**: it needs a transport_record to attempt an assignment against, which does not exist until the request is raised |
| UAT-09 | QO-1 + TMS-1 | New dossier reads « Sans devis » and « À affecter » |
| UAT-10 | TMS-1 | Operations Manager designates the Responsable client |
| UAT-11 | TMS-4 | Transport request raised; Transport receives it |
| UAT-12 | TMS-5/5C | Internal branch: eligible vehicle assigned; « En mission » derived |
| UAT-13 | TMS-6 | Fleet **and** provider on one transport is refused |
| UAT-14 | TMS-5 | An immobilised vehicle cannot be dispatched |
| UAT-15 | TMS-4 | Customs interlock at PICKED_UP, then delivery + POD evidence |
| UAT-16 | TMS-6 | External branch: provider assigned, « Transport externe » |
| UAT-17 | TMS-6 | Provider rename does not rewrite a past transport's carrier |
| UAT-18 | TMS-6/TMS-4 | ORDRE DE TRANSPORT prints the right carrier identity |
| UAT-19 | TMS-5C | A vehicle with history **cannot** be permanently deleted |
| UAT-20 | TMS-5C | A never-used vehicle **can** be permanently deleted |
| UAT-21 | TMS-5A/5C | A `transport:read`-only user sees the parc read-only, no grey buttons |
| UAT-22 | TMS-3 | Road tracking honesty (only if `TRACKING_ENABLED=true`) |

**Deferred / not human-testable in this environment**, recorded rather than
silently skipped: cross-tenant rejection (single production tenant — covered by
B6 and the SQL suites), and UAT-21/22 require respectively a second account
without `transport:manage` and the tracking flag; both are stated as conditions,
not assumed.

### Scope validated so far (2026-08-19)

**Parc & Flotte LIFECYCLE — UAT VALIDATED.** UAT-01…06b cover the TMS-5B/5A
navigation split, vehicle registration, compliance and expiry classification,
the maintenance lifecycle, the dispatch interlock and reinstatement. Not to be
re-opened unless a later code change touches this scope.

**Still OPEN inside TMS-5/5A/5C scope** — these were *not* exercised by that
sequence and are deliberately NOT closed by association:

| ID | Why it is still open |
| --- | --- |
| UAT-19 | A vehicle **with** history must be REFUSED permanent deletion. This is the half of the retention rule that protects operational evidence; it has never been demonstrated in production. `UAT-TMS7-01` now carries compliance **and** a closed intervention, so it is the correct subject. |
| UAT-20 | A never-used vehicle **may** be deleted — partially evidenced by the earlier `vehicle.deleted` of AA-826-YY (audit log), but not performed as a controlled UAT with the confirmation step. |
| UAT-21 | Requires a second account holding `transport:read` **without** `transport:manage`. |
| UAT-22 | Requires `TRACKING_ENABLED=true`. |

## 6. Defect classification

**BLOCKER** — authority, security, data integrity, or the core journey broken.
Stop and report before dependent tests. **MAJOR** — required capability broken,
workaround exists. **MINOR** — usability/presentation, no integrity impact.

## 7. Evidence matrix

Filled in as results arrive; every inherited criterion appears with its test,
result, evidence and disposition. TMS-7 is **not** complete until every row is
resolved.

| ID | Inherited criterion | Result | Evidence | Defect | Disposition |
| --- | --- | --- | --- | --- | --- |
| A (auto) | All 11 phase suites + full vitest + typecheck + build | **PASS** | 245/245 phase tests; 7029 vitest (1 known CRLF-local pin); tsc + build clean (2026-08-19) | — | Accepted as automated evidence only |
| A (CI) | Every SQL suite against a real Postgres after 119 migrations | **PASS** | CI #519 on `6d0392b`, jobs `rls-tests` + `build` green | — | Accepted; does not substitute for human cases |
| UAT-01 | TMS-5B — Transport is a first-class DÉPARTEMENTS entry, in the ratified order | **PASS** (operator, 2026-08-19) | Sidebar order observed Opérations → Transit → Transport → Finance; Transport not nested; `/departments/transport` loads with meta « DÉPARTEMENTS » and H1 « Transport »; no error boundary or unauthorized message; screenshot captured | None | Closed — no code change required |
| UAT-02 | TMS-5B/5A — Transport owns Demandes & Exécution, Parc & Flotte, Sous-traitants, Parcours; Transit keeps only customs + international follow-up | **PASS** (operator, 2026-08-19) | All four responsibility cards present on `/departments/transport` with the « Suivi routier » explanatory line; Parc & Flotte card opened `/transport/parc` cleanly; Transit subtitle « Dédouanement et suivi international des expéditions. » with exactly Douane, Intelligence douanière, Suivi maritime, Suivi aérien; neither « Transport & Logistique » nor « Parc & Flotte » present on Transit; screenshots captured | None | Closed — relocation confirmed complete in production |
