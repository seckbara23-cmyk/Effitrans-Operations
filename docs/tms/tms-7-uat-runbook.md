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
| UAT-10 | TMS-1 designation is an act with immutable history | **PASS** (operator, 2026-08-19) | EFT-IMP-2026-00004: « À affecter » → designated **System Administrator**; button correctly read **Désigner** for the FIRST designation and **no replacement motif was demanded**; afterwards the UI switched to the replacement workflow (**Remplacer** + mandatory « Motif détaillé du remplacement »), which is the TMS-1 replacement invariant; « Historique des désignations (1) » shows `19/08/2026 — System Administrator · Affectation initiale · par System Administrator` | None | Closed |
| UAT-11a | TMS-4 — `transport:create` supersedes the request lane; execution record created | **PASS** (operator, 2026-08-19) | EFT-IMP-2026-00004: before creation « Démarrer le transport » present and « Demander le transport » **absent** (supersession confirmed); transport created at **NOT_STARTED / Non démarré**; « Affecter chauffeur / véhicule » available with BOTH execution-source selectors rendered — « Véhicule du parc » offering `UAT-TMS7-01 — UAT-01` and « Sous-traitant (transport externe) » offering `UAT Transporteur SARL (UAT-NINEA-001)`; no assignment submitted, transport preserved for the branch/invariant tests | None | Closed |
| UAT-08 | TMS-6 approval interlock — only an APPROVED, active provider is eligible | **PASS** (operator, 2026-08-19) | `UAT Transporteur SARL` suspended → tiles Agréés 0 / Suspendus 1, state **Suspendu**; on EFT-IMP-2026-00004 the provider was removed from the assignment UI — and with no eligible subcontractor left the selector itself was **not rendered** (intended: an empty picker is never shown); re-approved → Agréés 1 / Suspendus 0 and the provider offered again; **Transports confiés stayed 0 and the transport was untouched**, proving suspension governs NEW work only | None | Closed — eligibility cycle Agréé → Suspendu → Agréé demonstrated |
| UAT-12 | TMS-5 fleet assignment + **TMS-5C derived availability** | **PASS** (operator, 2026-08-19) | EFT-IMP-2026-00004 moved to **Planifié**; execution source reads « **Flotte Effitrans · UAT-TMS7-01 — UAT-01** »; no subcontractor bound; `/transport/parc` independently shows the vehicle as « **En mission · EFT-IMP-2026-00004** » with tiles 1/0/1/0/0 and the panel stating « Ce véhicule est actuellement en mission (EFT-IMP-2026-00004). » — **no manual availability change was made**, so « En mission » is demonstrably derived from operational truth, not a stored duplicate | None. Observation (not a defect): `UAT Chauffeur` is a free-text driver, not an authenticated mobile-driver account — free-text `driver_name` coexists with `driver_user_id` by design; deferred to driver/mobile scope | Closed |
| UAT-13 | TMS-6 execution-source invariant (fleet XOR provider) | **BLOCKED → defect found & fixed; awaiting re-run** (operator, 2026-08-19) | Selecting `UAT Transporteur SARL` while `UAT-TMS7-01` stayed bound was refused **every time** with « Le transport a été modifié par un autre utilisateur. Actualisez la page… », persisting across hard refresh; after refresh the subcontractor reverted to « — Aucun — ». **Query B2 = 0 contradictions** and nothing persisted, so the invariant itself HELD | **MAJOR — DEFECT-UAT13**: `casUpdate` collapsed *every* database error into `"stale"` (`if (error) return "stale"`), so the TMS-6 CHECK refusal was reported as a version conflict and the operator was told to refresh — an action that could never help. Integrity unaffected; diagnosis wrong | **FIXED `7736be7`, CI #532 GREEN** (HEAD #533 green) — refused vs stale now distinguished; 23514 maps to « Un transport est exécuté soit par la flotte Effitrans, soit par un sous-traitant — jamais les deux. »; interlock refusals named too. CHECK and assignment semantics unchanged. Mutations M1–M5 caught. **UAT-13 to be RE-RUN** |
| UAT-13 (re-run) | TMS-6 execution-source invariant — refusal now names itself | **PASS** (operator, 2026-08-19) | Simultaneous fleet + subcontractor refused with the new TMS-6 explanatory message (no longer the stale/refresh wording); fleet binding remained `UAT-TMS7-01 — UAT-01`; **B2 contradictions = 0** | DEFECT-UAT13 **verified fixed in production** | Closed — invariant and its explanation both proven |
| UAT-14 | TMS-5 — an ineligible vehicle cannot be dispatched | **PASS** (operator, 2026-08-19) | **Positive control first**: `UAT-TMS7-99` (Camionnette) WAS offered in the dossier picker while Disponible. Set **Hors service** → disappeared from the picker. Restored to Disponible, then an immobilising « Planifiée » intervention `UAT-TMS7 — révision` → **Maintenance** → absent again. EFT-IMP-2026-00004 stayed bound to `UAT-TMS7-01 — UAT-01` throughout; the intervention is left OPEN as the UAT-19 subject | None | Closed — both ineligibility modes (hors service, maintenance) excluded from dispatch |
| UAT-15 (part 1) | TMS-4 customs interlock at PICKED_UP | **PASS** (operator, 2026-08-19) | Pre-BAE pickup **refused** with « Enlèvement bloqué : dédouanement non libéré (BAE). » — the physical hard gate fired correctly | None | Closed (part 1) |
| UAT-15 (part 2) | Document verification en route to BAE | **BLOCKED** (operator, 2026-08-19) | « Vérifier » on Facture commerciale / Liste de colisage failed with « L'action a échoué. Veuillez réessayer. »; documents stayed **Téléversé** and the required-documents banner still reported them missing | **MAJOR — DEFECT-UAT15**: the refusal was CORRECT but anonymous. Root cause traced end-to-end: `resolveDocumentGovernance` binds the verifier seat to the dossier's current process STEP; **EFT-IMP-2026-00004 has no process instance** (never opened), so stepKey is empty → no verifier seat → `isEligibleForSeat` false → `not_a_verifier`, which was **not in the documents error map** and fell through to `generic`. Production correlation is exact: of four dossiers, only 00003 has a process instance and it is the only one with VERIFIED documents. `workflow_policy_version` being empty is NOT the cause — `resolvePolicy` falls back to LEGACY_DEFAULT by design | **FIXED** — all three governance refusals (`not_a_verifier`, `self_verification`, `policy_unresolved`) plus the RPC codes now carry explicit French; the « not a verifier » message names the remedy (open the dossier). **No control weakened**: maker-checker, seat resolution and the empty-seat refusal are pinned unchanged; mutations M1–M4 caught. **UAT-15 part 2 to be RE-RUN after opening the dossier**. Fix `c7fee6d`, **CI #537 GREEN** (rls-tests + build), deployed to main. ⚠ **This root cause was INCOMPLETE — see DEFECT-UAT15b below**: the re-run with a process instance present still refused, falsifying it |
| UAT-15 (part 2, re-run) | Document verification with the process engine ACTIVE | **FAIL** (operator, 2026-08-19) | Dossier opened via « Ouverture du dossier », owner assigned, lifecycle 57 % with next action « Vérifier les documents en attente : Facture commerciale, Liste de colisage ». « Vérifier » **still refused**, now with the explicit empty-seat message | **MAJOR — DEFECT-UAT15b**: `defaultSeats()` emitted **`assignee` bindings and nothing else**, so `resolveSeatEligibility(…, "verifier")` returned an EMPTY binding for **every step of every dossier**. An empty binding is refused by design ⇒ document verification was **structurally impossible platform-wide** since WES-4H (2026-07-27). Confirmed in production: `document_review` = **0 rows**, `workflow_policy_version` = **0 rows** (so every dossier resolves LEGACY_DEFAULT). The earlier « only 00003 has verified documents » correlation was a **confound** — 00003's APPROVED docs predate the gate (uploaded 2026-07-26) and its two VERIFIED rows are self-issued artifacts, not governed reviews. Defect located in **policy configuration / seat binding**, not step-key mapping, initialization or governance resolution | **FIXED** — the platform default now binds the verifier seat to the roles the ratified templates grant `document:approve` (the authority that governed verification *before* the seat check existed), keyed on template `key` so it matches live role codes. Derivation reproduces the 5 live holders exactly: ACCOUNT_MANAGER, CHIEF_OF_TRANSIT, COMPLIANCE_HSSE, OPS_SUPERVISOR, SYSTEM_ADMIN. **No control weakened**: permission check still first, maker-checker intact, empty-seat refusal intact, checker seat still unbound, un-opened dossiers still refuse. 17 regression tests; mutations M1–M6 all caught. ⚠ **Open ratification question RQ-15b** — see below |
| UAT-03 | TMS-5 | A vehicle can be registered (Parc & Flotte) |
| UAT-04 | TMS-5 | Compliance dates recorded; expiry state rendered |
| UAT-05 | TMS-5/5C | Immobilising intervention → Maintenance; excluded from dispatch |
| UAT-06 | TMS-5/5C | Close intervention → return to service |
| UAT-07 | TMS-6 | An external provider can be registered and approved |
| UAT-08 | TMS-6 | A suspended provider cannot be assigned — **RESEQUENCED after UAT-11**: it needs a transport_record to attempt an assignment against, which does not exist until the request is raised |
| UAT-09 | QO-1 + TMS-1 | New dossier reads « Sans devis » and « À affecter » |
| UAT-10 | TMS-1 | Operations Manager designates the Responsable client |
| UAT-11a | TMS-4 | The request lane is correctly SUPERSEDED for a `transport:create` holder, and execution starts (performable by the current session) |
| UAT-11b | TMS-4 | **DEFERRED — needs an ACCOUNT_MANAGER account** (holds `transport:request` but NOT `transport:create`): only such a user sees « Demander le transport ». The current session holds `transport:create`, for which the button is deliberately not rendered |
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

## RQ-15b — open ratification question (raised by DEFECT-UAT15b)

The fix RESTORES the pre-WES-4H authority rather than deciding a new rule: whoever
holds `document:approve` may verify. That is the conservative reading, and it is the
documented contract of the platform default ("reproduit le comportement ratifié
existant, sans nouvelle règle métier").

Effitrans should still ratify whether that is the intended verification authority,
because WES-4H clearly *intended* narrower, step-specific verifier seats and simply
never supplied them. Two points need a decision:

1. **Who verifies?** Today: the 5 roles holding `document:approve`, at any step.
   A narrower rule (e.g. only the department owning the step) is expressible by
   activating a policy version — the mechanism works and overrides the default.
2. **Un-opened dossiers.** A dossier with no process instance has no active step,
   so no verifier seat resolves and verification stays refused. Dossiers
   EFT-IMP-2026-00001 and 00002 are in that state. Confirm that requiring a dossier
   to be OPENED before its documents can be verified is the intended rule.

Neither question blocks UAT-15 part 2; both should be answered before TMS-7 closes.

### RQ-15b — RATIFIED (operator, 2026-08-19)

**1. Verifier seat under LEGACY_DEFAULT — APPROVED as a COMPATIBILITY rule.**
`document:approve` holders may populate the LEGACY_DEFAULT verifier seat. This
validates the `1498e9f` repair and allows existing dossiers to operate.

⚠ **This is expressly NOT ratification** of « all five holders may verify every
document at every step » as the final business rule. It is the fallback, not the
target. Two constraints follow and bind future work:

* The intended target is **step-specific verifier seats configured through
  workflow policy**, aligned to the responsible function. The override mechanism
  already exists and takes precedence over the default — activating a policy
  version is the ratified path to get there, NOT editing the default again.
* **SYSTEM_ADMIN is technical / break-glass authority, not the normal operational
  verifier.** It appears in the fallback seat because it holds `document:approve`;
  the target configuration should not treat it as an operating verifier.

**2. Un-opened dossiers remain non-verifiable — RATIFIED as INTENTIONAL.**
A dossier must first be opened through the process engine so that an active step
and a governance context exist. No process instance → no verifier seat →
verification refused. This is the intended rule, not a gap. Dossiers
EFT-IMP-2026-00001 and 00002 stay non-verifiable until opened.

**3. Controls frozen.** Maker-checker, the `document:approve` check, the
empty-seat refusal and policy-override behaviour are preserved EXACTLY as
implemented in `1498e9f`. Any later change to these is a new ratification.

**Verification:** CI **#539 GREEN** (`build` + `rls-tests`) on `1498e9f`.

## UAT-15 part 2 — second FAIL (2026-08-19): root cause is NOT a code defect

Operator re-ran after CI #539. Both documents stayed **Téléversé** with the
empty-verifier-seat message. The four candidate causes were discriminated with
read-only evidence for **EFT-IMP-2026-00004** (`f36d4518-a6a7-442f-98ab-ba69ac80a3c2`).

| Candidate | Verdict | Evidence |
| --- | --- | --- |
| **A** deployment/version | **ELIMINATED** | `GET /api/version` → `sha ab2bacb0…`, `ref main`, `env production`. That is the ratification commit, which CONTAINS `1498e9f`. The fix is live |
| **B** persisted policy without the binding | **ELIMINATED** | `workflow_policy_version` = **0 rows**. Nothing is stored, so resolution reaches the built-in floor |
| **C** runtime construction/cache | **ELIMINATED** | The floor is `buildPlatformDefaultPolicy()` itself (`resolver.ts`), memoized per server process; the new deployment starts new processes, and prod already reports the new SHA |
| **D** step/policy mismatch | **CONFIRMED — in its most basic form** | **`process_instance` = 0 rows for EFT-IMP-2026-00004.** No instance ⇒ no active step ⇒ `stepKey = ""` ⇒ no binding matches ⇒ empty verifier eligibility ⇒ `not_a_verifier` |

### What actually happened

The dossier was **never opened through the process engine.** The audit log for the
operator session contains `file.assigned` (21:50:30Z) and `file.transition`
(21:51:00Z) — the ordinary dossier owner-assignment and status transition, which
moved `operational_file.status` to **OPENED**. That is what renders « 57 % terminé »
and the « Vérifier les documents en attente » next action: those come from the FILE
lifecycle, not from the process engine. **No process/intake action appears in the
audit log at all**, and `openDossierWorkflow` writes a `process_instance` row.

Instances by dossier: 00001 = 0, 00002 = 0, **00003 = 1**, 00004 = **0**.

**Therefore the refusal is CORRECT and is the behaviour ratified under RQ-15b(2):**
no process instance → no verifier seat → verification refused. The `1498e9f` repair
is live and correct; its precondition is simply not met on this dossier.

### Hypotheses additionally eliminated

* **Step-state vocabulary mismatch** — production writes `PENDING` / `COMPLETED` /
  `SKIPPED`; the governance query accepts `AVAILABLE`/`ACTIVE`/`PENDING`, so the
  only open state IS covered. Now pinned, and mutation-tested (M7, M8).
* **Live step keys outside the binding** — `pre_gate`, `bon_a_delivrer` and
  `transport_docs_transmission` are all registry keys and all carry a verifier
  binding. Now pinned.
* **Tenant flag layer** — `tenant_process_rollout` has `process_engine = true`.
  The tenant is NOT the blocker.

### Remaining unknown (needs one operator action)

Why « Ouvrir le dossier » did not run. `intake` requires the tenant flag (satisfied)
ANDed with TWO environment-only flags, `EFFITRANS_PROCESS_STRUCTURES_ENABLED` and
`EFFITRANS_OPERATIONS_INTAKE_ENABLED`, which cannot be read from the database.
If either is unset, `openDossierWorkflow` refuses with `engine_disabled`.

The platform already ships a read-only, auth-required diagnostic that answers
exactly this: **`/api/diagnostics/intake?fileId=f36d4518-a6a7-442f-98ab-ba69ac80a3c2`**.
It re-evaluates the same expressions the page evaluates and reports each boolean.
It writes nothing and creates no process instance.

### Coverage added (no production code changed)

The prior tests proved the DEFAULT POLICY correct, which is not the same as proving
the PATH correct — a fair criticism, and the gap that let this recur. Six tests now
pin the composed production path: resolver floor identity, the built-in fallback,
the active-step state filter, COMPLETED/SKIPPED exclusion, live step-key coverage,
and the ratified no-instance refusal. Mutations **M7–M10** all caught.

## DEFECT-UAT15c — the opening surface was unreachable (2026-08-19)

**Classification: navigation / action-wiring defect.** Same class as the TMS-5A
Parc & Flotte reachability defect — the capability existed and worked; nothing led
to it.

### Control audit (what the operator clicked vs. what opens a process)

| Control | Route / component | Server action | Effect |
| --- | --- | --- | --- |
| « Responsable » assignment | dossier page | `assignFile` | `file.assigned`. **No process instance** |
| « Faire avancer → Ouvert » (under heading « Clôture du dossier ») | `components/files/file-workflow.tsx` | `transitionFile` | `file.transition`, sets `operational_file.status = OPENED`. **No process instance** |
| **« Ouvrir le dossier »** — the REAL intake control | `/files/[id]/process` → `components/process/intake-panel.tsx` | **`openDossierWorkflow`** | Creates the `process_instance` |

The two controls that ran are correctly labelled — neither claims to be the
process-engine opening action, so this is **not** a mislabelling defect. They are
simply the only opening-shaped controls that were *visible*.

### Root cause

`ProcessJourneyPanel` held the **only** link to `/files/{id}/process`, and it
returned `null` whenever `getProcessState` returned null — which it does when the
dossier has no instance (`service.ts`: `if (!snap?.instance) return null;`).

**The catch-22:** to open a process you must reach the intake surface, and the only
link to it appeared *after* the process already existed. For a dossier that had
never been opened, that surface was reachable only by typing the URL. The other
entry points (`/journeys`, `/queues/[key]`) list dossiers already in the process.

This is why the environment/rollout/permission hypothesis was correctly eliminated
by the diagnostics run: **everything was green because nothing was wrong with the
action — the operator never reached it.**

### Fix

When a dossier has no instance, the panel now renders a signpost with a link to the
intake surface, stating plainly that the dossier STATUS is not the process. It is
gated by `getIntakeState` — the SAME resolver the process page and the diagnostics
route use — so the invitation is never shown to someone who could not act on it, and
no rollout rule is re-derived locally. **It opens nothing**: no write, no instance,
no flag re-read. `transitionFile` is untouched and still creates no instance; the
two concepts stay separate. 10 tests, mutations **M11–M14** all caught.

## UAT-15 part 2 — operational-owner eligibility (2026-08-19): NOT a defect

**The rule.** `eligibleOperationsOwners` (lib/process/engine/intake-actions.ts) returns
tenant users who are `status = active` AND hold at least one role whose CANONICAL
DEPARTMENT is `OPERATIONS` — `roleCanonicalDepartment(code) === "OPERATIONS"`.
Department is DERIVED from roles, never stored, per the canonical registry doctrine.
Eligible role codes: `COORDINATOR`, `OPS_SUPERVISOR`, `ACCOUNT_MANAGER`,
`DOCUMENTATION_OFFICER`, `WAREHOUSE_COORDINATOR`.

**Two different questions, deliberately separated:**

| | Question | Mechanism | Operator account |
| --- | --- | --- | --- |
| **Permission to ASSIGN an owner** | may this user hand out the seat? | RBAC verbs `process:manage` + `process:owner:assign` | **YES** — this is what `canOpen = true` reported |
| **Eligibility to BE the owner** | does this user hold operational authority? | organizational fact derived from role → canonical department | **NO** |

**Why the operator is excluded.** `seckbara23@gmail.com` = « System Administrator »,
holding `SYSTEM_ADMIN`, `HR_OFFICER`, `MAIL_ADMIN`. Their canonical departments are
`null` (SYSTEM_ADMIN — "cross-cutting IT/config administration"), `HUMAN_RESOURCES`
(HR_OFFICER) and `null` (MAIL_ADMIN). **None is OPERATIONS.**

**Verdict: INTENDED under the ratified workflow.** An administrator may hand out the
operational seat but does not occupy it — the same principle ratified in RQ-15b,
where SYSTEM_ADMIN was confirmed as technical/break-glass authority and not a normal
operating role. No code change; nothing to fix.

**Selected for this UAT: « Superviseur Ops » — `ops.supervisor.demo@effitrans.sn`.**
It holds exactly `OPS_SUPERVISOR` (« Superviseur opérations » / Operations
Supervisor), which is the operational authority the Effitrans workflow places
alongside the Account Manager in the assignment/coordination area. It is also a
clearly identifiable DEMO account, so the UAT does not attach a genuine Effitrans
employee to a test dossier — the intake action sends the owner a staff notification.

⚠ Data observation only, NOT actioned: several people hold duplicate accounts across
`@effitrans.sn` and `@effitrans.com` (Aminata Mbaye, Aida Rose SARR). Recorded for
Effitrans; no change made.

⚠ Note: the dossier`s `assigned_to_user_id` (« Responsable ») is currently System
Administrator, set by the earlier `file.assigned`. That field is the FILE`s
responsable and is independent of the process instance`s `owner_user_id`. The intake
panel reads the latter, which is why the picker starts empty.

## UAT-15 part 2 — the controls retired because the work was DONE (2026-08-19)

**Not a defect, and not role separation: the verification SUCCEEDED.**

| Evidence | Value |
| --- | --- |
| `document.status` — Facture commerciale | **VERIFIED** (23:56:15Z) |
| `document.status` — Liste de colisage | **VERIFIED** (23:55:57Z) |
| `document_review` rows | **2** — was **0 platform-wide** since WES-4H shipped 2026-07-27 |
| Review actor | `seckbara23@gmail.com` |
| `maker_checker_required` | `false` (correct: conditional for these types; only BAE is always maker-checked) |
| `policy_version_id` | `null` (correct: LEGACY_DEFAULT records null honestly rather than fabricating a version id) |

**Why the buttons disappeared.** `document-row.tsx`: `reviewable = canApprove &&
canReview(doc.status)`, and `canReview` returns true ONLY for `UPLOADED` or
`PENDING_REVIEW`. Once a document reaches VERIFIED there is nothing left to review,
so « Vérifier » and « Rejeter » retire. Before initialization the documents were
UPLOADED, so the controls showed and produced the governed refusal; after a
successful verification they are gone because the state moved on.

**UI vs server authority: they AGREE.** The UI predicate is `document:approve` +
a reviewable status; the server path is `document:approve` (assertPermission in
`runReview`) + `mayVerifyDocument` + a reviewable status enforced by the RPC. The UI
is the strictly weaker of the two, which is the correct direction — it can never
offer an action the server would refuse.

**These are the first two governed document verifications in the platform`s
production history.** The DEFECT-UAT15 → 15b → 15c chain is closed end to end:
discriminated refusals (`c7fee6d`), a bound verifier seat (`1498e9f`), and a
reachable intake surface (`9355966`).

### ⚠ Separate latent defect found in the same component — NOT fixed, awaiting GO

DEFECT-UAT15d (minor, non-blocking). In `components/documents/document-row.tsx` the
share and notify controls are gated on `doc.status === "APPROVED"` — a RAW comparison
against the LEGACY alias — while the platform now writes `VERIFIED`. Two lines above,
the shared/not-shared indicator correctly uses `isVerified(doc.status)`, which
normalizes via `LEGACY_STATUS_ALIAS`. So the row is internally inconsistent:

* « Partager avec le client » never renders for a properly VERIFIED document;
* the client-notification trigger never renders either.

This is why only Télécharger and Supprimer remained visible. It does not block
UAT-15, but it will block the customer-portal half of later cases. Recommended fix:
use `isVerified(doc.status)` in both places, matching the indicator. Not implemented —
out of scope for the blocked test.

## DEFECT-UAT15d — canonical document status for share/notify (2026-08-20)

**Fixed (3 sites).** The platform writes `VERIFIED`; `APPROVED` is only the legacy
spelling `canonicalStatus` maps onto it. Three gates still compared the raw string:

| Site | Was | Now |
| --- | --- | --- |
| `components/documents/document-row.tsx` — share | `doc.status === "APPROVED"` | `isVerified(doc.status)` |
| `components/documents/document-row.tsx` — notify | `doc.status === "APPROVED"` | `isVerified(doc.status)` |
| **`lib/comms/actions.ts` — `notifyDocumentShared` (SERVER)** | `doc.status !== "APPROVED"` | `!isVerified(doc.status)` |

**The server twin is why both halves had to move together.** Fixing only the button
would have made the UI offer an action the server then refused with `not_shared` —
the exact UI/authority disagreement this phase has spent three rounds hunting.

**Compatibility preserved.** `isVerified` accepts BOTH spellings via
`LEGACY_STATUS_ALIAS`, so historic `APPROVED` rows keep working: this widens
recognition, it never narrows it. `CONSUMED_AS_EVIDENCE` counts as verified too.

**Nothing loosened.** `setDocumentShared` remains the stricter authority — it also
requires a client-safe type and a non-superseded version (`isShareable`), so the UI
can never offer what the server would refuse. Verification semantics, RBAC, RLS and
maker-checker are untouched. 13 tests; mutations **M15–M20** caught, including
removing the client-safe and superseded checks.

### Audit of other raw `"APPROVED"` document-status comparisons

| Site | Verdict |
| --- | --- |
| `lib/portal/shipments.ts`, `lib/portal/tracking.ts` | ✅ already use `isVerified` |
| `lib/documents/doctrine.ts` — `isShareable` | ✅ already uses `isVerified` |
| **`lib/analytics/service.ts:57`** | ⚠ **STALE — reported, NOT fixed.** `.eq("status", "APPROVED")` on the shared-documents count, so every canonically VERIFIED shared document is **missing from the analytics total**. It is a DB-level filter, so the fix is `.in("status", ["APPROVED", "VERIFIED"])`. Left alone per instruction — it changes a number the business reads, and warrants its own GO |
| `lib/ai/eval/harness.ts` | ⚠ synthetic eval fixtures only, no production effect. No action recommended |

All other `"APPROVED"` hits belong to different domains (expense visas, quotations,
finance requests, subcontractor approval, brand lifecycle, docintel field decisions)
and are correctly unrelated to document status.

## DEFECT-UAT15d (analytics half) — the shared-document undercount (2026-08-20)

`lib/analytics/service.ts` filtered `.eq("status", "APPROVED")` at the DATABASE, so
every canonically VERIFIED shared document was missing from the metric.

**Fix.** The filter is now `.in("status", [...VERIFIED_STORED_STATUSES])`. A DB filter
cannot call `isVerified` — the normalization lives in TypeScript — so the stored
spellings are **DERIVED from the doctrine alias map**, not hand-listed:

* `VERIFIED_CANONICAL_STATUSES` = the canonical set; **`isVerified` is now derived
  from it** rather than repeating the list, so the two cannot disagree;
* `VERIFIED_STORED_STATUSES` = that set PLUS every `LEGACY_STATUS_ALIAS` entry
  pointing at it — so `APPROVED` appears automatically.

A hand-kept `.in([...])` is exactly how this drifted in the first place; deriving it
means the next status cannot be silently forgotten.

**Scope held.** Only the status predicate widened. The metric still counts only
`shared_with_client = true`, still excludes `deleted_at`, and is still tenant-scoped —
each pinned and mutation-tested. Verification, sharing, RBAC, RLS, maker-checker and
portal behaviour are untouched. 12 tests, mutations **M21–M26** caught, including
both drift directions (back to legacy-only, and forward to canonical-only).

### ⚠ Remaining stale site — reported, NOT fixed

`lib/deposit/actions.ts:845` **WRITES** `status: "APPROVED"` to a document — the
legacy spelling — when a deposit proof is accepted. It is a WRITE, not a comparison,
and it still functions correctly because `isVerified` accepts both spellings (and the
analytics fix above deliberately keeps counting it). But it perpetuates the legacy
vocabulary in NEW rows. Changing what status is written could affect the deposit
workflow`s own state checks, so it is out of scope without its own GO.

No other DB-level document-status filters exist.

## TECHNICAL DEBT — canonical document-status normalization (opened 2026-08-20)

**Item: `lib/deposit/actions.ts:845` writes the LEGACY spelling.**

When a deposit proof is accepted it writes `status: "APPROVED"` to the document,
minting legacy vocabulary in NEW rows. It is a WRITE, not a comparison.

**Status: NO GO. Untouched during UAT-15, by operator decision (2026-08-20).**

**Currently harmless:** `isVerified` accepts both spellings via `LEGACY_STATUS_ALIAS`,
and the DEFECT-UAT15d analytics fix deliberately keeps counting `APPROVED`, so
deposit-generated documents are correctly recognised everywhere today.

**Preconditions for a future change — ALL required before touching it:**

1. Trace EVERY reader of the deposit-generated document status — application
   readers, RLS policies, SQL suites, analytics, portal projections and the deposit
   workflow`s own state checks (`recordCustody`, the PROOF_ACCEPTED transition).
2. Trace every TRANSITION that depends on that value, including anything asserting
   the literal string rather than calling `canonicalStatus`/`isVerified`.
3. PROVE the change from `APPROVED` to `VERIFIED` is behaviour-preserving for each
   one — a code census is not a data census, so count existing rows too.
4. Decide whether historic rows are migrated or left dual-spelled. If left, the
   alias must stay permanently, and that must be stated rather than assumed.

Not a defect today; a normalization debt with a real trap if changed carelessly.
