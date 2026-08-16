# EFFITRANS-HR-8 — Offboarding: architecture & repository audit

**Date:** 2026-08-16 · **Status: AUDIT ONLY — nothing implemented.** ·
**Baseline:** HR-7A/B/C closed at `9142740` (CI #483), migrations 110/110 local = remote.
Governing decisions: HR-0F architecture freeze (Audit 5: « HR-8 — clearance gates;
equipment return blocks completion »; Audit 7: « prompts — never silently performs — the
8.1A account archive/ban »), DEC-B26 (termination requires reason; rehire = new record),
DEC-B62 (access revocation is a distinct, prompted act), the HR-0R design note
`hr-onboarding-offboarding.md` §2.

**Verdict: GO** — every dependency HR-8 needs is built and live; no Effitrans
ratification gates the foundation. What Effitrans must still decide is *content*
(reason vocabulary, checklist items) and four *policy switches* (RQ-8.1–RQ-8.8 below),
none of which blocks a dark, empty-by-default foundation.

---

## 1. Architecture discovered (what exists today, verified from source)

| Capability | Where | State |
|---|---|---|
| Employee lifecycle | `lib/hr/lifecycle.ts` | `DRAFT→ACTIVE⇄SUSPENDED→TERMINATED→ARCHIVED`; `ARCHIVED` terminal; `terminationRequiresReason` (DEC-B26) |
| Termination transition | `lib/hr/actions.ts` `transitionEmployee` | CAS-guarded; stamps `termination_reason` + `termination_date = today` (no future dating); **document gate** `missingTerminationDocuments` (every active `required_for_termination` document type — the « solde de tout compte » rule, HR-3 addendum §6); mandatory ledger event with compensation; audit; returns `promptRevocation` when a linked account exists |
| Revocation prompt | `components/hr/employee-admin.tsx` | Amber panel already shipped: « Départ enregistré. L'accès à la plateforme n'a PAS été révoqué » → links Administration → Utilisateurs. HR never executes |
| Termination reasons vocabulary | `hr_configuration.termination_reasons` (jsonb, migration 20260801000001) | Ratified structure (HRQ-D1), **empty**; edited in the configuration studio; transition UI currently collects free text |
| Checklist engine | migration 20260802000002 | **Generic template layer** `hr_checklist_template` + `hr_checklist_item_template` (position, label_fr, responsible_function, is_required, is_blocking, evidence_required, due_offset_days) — **no kind column**; consumed today only by onboarding |
| Case pattern | `hr_onboarding_case` / `hr_onboarding_item` | `DRAFT→READY→IN_PROGRESS→COMPLETED` + governed `CANCELLED` (reason CHECK); one live case per employee (partial unique); **item labels snapshot at instantiation**; `PENDING/DONE/NOT_APPLICABLE`; DONE-has-actor CHECK; evidence via `hr_document` |
| Equipment custody | `hr_equipment_assignment` | Open-row idiom (`returned_on is null` = outstanding); single-custodian partial unique; `return_outcome` RETURNED/DAMAGED/LOST/NOT_RETURNED; conditions at issue/return; acknowledgement document; transactional RPCs `hr_assign_equipment` / `hr_return_equipment` emitting ledger events; outstanding + overdue counters already read in `lib/hr/onboarding.ts` |
| Documents & contracts | HR-3 | `hr_document_type.required_for_termination` drives the termination gate; `hr_contract` `DRAFT/VERIFIED/ENDED` |
| Account lifecycle (8.1A) | `lib/users/lifecycle.ts` | `active/inactive → archived` (restore is the only exit); ban kills sessions; gate = `admin:users:manage` (SYSTEM_ADMIN) — **no HR role holds it, by design** |
| Event ledger | `hr_employee_event` | `event_kind` is **unconstrained text** — new offboarding kinds need no CHECK widening; mandatory-emission-with-compensation is the shipped idiom |
| Authorities | `lib/platform/role-templates.ts` | HR_OFFICER: `hr:read`, `hr:manage`, `hr:config:manage`; SYSTEM_ADMIN holds **no** `hr:*`; DAF/DGA org-lanes; parked: `hr:sensitive:read`, `hr:payroll:read/approve` |
| Downstream consumer | HR-7 collection | Flags `TERMINATED_IN_PERIOD` — the departure *fact* is consumed, but nothing yet governs the departure *process* |
| Hub | `app/departments/hr/page.tsx` | `SoonTile title="Offboarding"` — pinned by `tests/hr-1-readiness-audit.test.ts` |

**The gap HR-8 closes:** today an employee can be TERMINATED with company equipment
still in custody and no clearance trail; the document gate is the only clearance that
exists. Everything else is surfaced nowhere.

## 2. Authoritative models to REUSE (no parallel models)

1. **Checklist engine** — reuse `hr_checklist_template`/`hr_checklist_item_template`
   with one additive discriminator: `kind text not null default 'ONBOARDING'
   check (kind in ('ONBOARDING','OFFBOARDING'))`. The default makes every existing row
   truthfully ONBOARDING (data census before the CHECK regardless — MAYA-P0.8-A rule).
   Existing onboarding surfaces must then filter `kind='ONBOARDING'` — **every**
   template-listing site (the EMP-5E two-comparison-sites lesson).
2. **Case pattern** — a sibling `hr_offboarding_case`/`hr_offboarding_item` mirroring
   the onboarding tables (the Air-sibling-of-Ocean precedent), NOT a retrofit of the
   live onboarding case tables.
3. **Equipment custody** — referenced live, never copied, never written by HR-8.
4. **Document gate** — `missingTerminationDocuments` read as-is on the case screen.
5. **Account lifecycle** — prompted handoff only; HR-8 adds zero account writes.
6. **Ledger + audit + INV-7 actor discipline** — as every phase since WES-9/OPS-SEC-2A.

## 3. Proposed employee offboarding journey

```
Départ décidé/notifié
  → hr:manage opens a case (motif, date de départ prévue, template)   [ACTIVE|SUSPENDED]
  → clearance items instantiated (labels snapshot)
  → items reviewed/completed in the case; equipment returned in Équipements
  → derived gates go green: 0 équipement en custody · documents de fin présents
  → employment terminated via the EXISTING lifecycle action (unchanged)
  → « Clôturer le départ » — refused unless TERMINATED + gates green
  → completion PROMPTS the account handoff (Administration → Utilisateurs)
  → case + ledger events retained forever; employee later ARCHIVED as today
```

Termination and offboarding are **distinct events by construction**: the case governs
clearance; `transitionEmployee` keeps governing employment state, unchanged.

## 4. Lifecycle / state model (case)

`OPEN → IN_PROGRESS → COMPLETED`, plus governed `CANCELLED` (mandatory reason), mirroring
onboarding minus the unneeded READY stage. Guards:

| Transition | Guard |
|---|---|
| (create) → OPEN | employee `ACTIVE` or `SUSPENDED` (RQ-8.6 may add TERMINATED regularization); one live case per employee (partial unique on OPEN/IN_PROGRESS) |
| OPEN → IN_PROGRESS | first item action, or explicit start |
| IN_PROGRESS → COMPLETED | **DB-side, in the completion RPC:** employee `status = 'TERMINATED'` · zero open custody rows · every `is_blocking` item DONE or NOT_APPLICABLE |
| any open → CANCELLED | mandatory reason (CHECK); lifecycle untouched |
| COMPLETED / CANCELLED | terminal; rows never deleted |

## 5. Clearance model

A clearance item = one instantiated `hr_offboarding_item`: snapshot `label_fr`,
`responsible_function`, `is_required`, `is_blocking`, `evidence_required` (evidence =
`hr_document` reference), `PENDING/DONE/NOT_APPLICABLE`, DONE-has-actor CHECK. Items come
from the tenant's OFFBOARDING template — **the engine ships empty; Effitrans authors
content** (RQ-8.2). On top of template items, two **derived gates** are computed live,
never stored as items:

* **Équipements** (BLOCKING — freeze-ratified): open custody rows for the employee.
* **Documents de fin** (BLOCKING — already enforced at termination): `missingTerminationDocuments`.

And two **advisories** (non-blocking, recommended): un-ENDED contracts (RQ-8.4), linked
account not yet archived (RQ-8.3).

## 6. Equipment-return integration

The case **displays** the employee's open custody rows (equipment, assigned_on,
expected_return_date) and links to the Équipements workspace, where the existing
`hr_return_equipment` flow records outcome + condition. The case writes nothing to
custody. The completion RPC re-checks `returned_on is null` count **in the database at
completion time** — the gate can never be satisfied by a stale screen. Outcomes
DAMAGED/LOST/NOT_RETURNED close the row and therefore release the gate: the *record of
loss* is the clearance, seizure of value is not HR-8's business (Finance boundary).

## 7. Documents & contracts during departure

Unchanged authority: the « solde de tout compte » gate stays on the TERMINATED
transition; HR-8 additionally surfaces the same missing-list on the case so HR sees it
*before* attempting termination. Item evidence attaches via the existing `hr_document`
flow. Contracts: the case lists contracts not `ENDED` as an advisory; ending a contract
remains the contracts surface's act. Nothing is auto-ended, nothing deleted; documents
stay protected after departure (bucket policies key on permissions, not subject status).

## 8. Account-access handoff

Reuses the shipped idiom (DEC-B62): a persistent « Accès plateforme » panel on the case
for linked employees — account state, plain-French instruction, link to Administration →
Utilisateurs. **No execute button in HR; no HR role gains `admin:users:*`** (structural
test). Completion with a still-active linked account emits a distinct ledger event
(`offboarding_completed_account_active`) so the condition is queryable, and the panel
persists on the completed case until the account is archived. Blocking vs advisory is
RQ-8.3 (recommended: advisory — blocking would handcuff HR to SYSTEM_ADMIN availability).

## 9. Authority model

**No new permission is genuinely required.** `hr:manage` operates cases and items (the
onboarding tier); `hr:read` views; equipment return already `hr:manage`; the account
step stays `admin:users:manage` outside HR; template authoring stays `hr:config:manage`.
Any new SECURITY DEFINER RPC taking `p_actor` performs the HR630 actor-integrity check +
`assert_actor_authority` (INV-7 — MAYA-P0.7-A rule). No four-eyes on completion in v1
(single HR_OFFICER staffing; a dual-control CHECK today = self-lockout — the
HR-IMP-MST7EF6P lesson); RQ-8.5 offers it as an opt-in.

## 10. Audit / evidence requirements

* `hr_employee_event` kinds (free-text, no widening needed):
  `offboarding_case_opened`, `offboarding_item_completed`, `offboarding_case_completed`,
  `offboarding_case_cancelled`, `offboarding_completed_account_active` — emitted
  transactionally in the RPCs (the `hr_complete_onboarding*` pattern), with the
  mandatory-emission/compensation discipline in app-layer writes.
* `writeAudit` entries for open/complete/cancel (existing `AuditActions` idiom).
* Item DONE carries `completed_by`/`completed_at` (CHECK-enforced).
* Permanent retention: no delete path exists on any HR-8 table, mirroring onboarding.

## 11. Cancellation / reversal

Cancelling a case (mandatory reason, terminal, retained forever) never touches the
employee lifecycle. A reversed *departure decision* before termination = cancel the
case; employment was never altered. After TERMINATED there is no un-terminate
(`TERMINATED→ARCHIVED` only): a genuinely reversed termination is organizationally a
rehire — see §12. A new case may be opened after cancellation (live-case uniqueness
covers open statuses only).

## 12. Rehire

Already ratified and already structural (DEC-B26): rehire = **new employee record**; the
old record keeps its termination facts, completed/cancelled cases, custody history,
ledger — queryable forever. The new record gets its own onboarding case. HR-8 builds
nothing for rehire and must not link records.

## 13. Proposed French UX (plain labels, no technical codes)

Hub tile: **« Départs »** — subtitle « Clôture des départs — restitution, documents,
accès » (replaces the SoonTile currently labeled "Offboarding"; route
`/departments/hr/departs`). Workspace:

* **List:** employee, date de départ prévue, motif, progression (« 3/5 étapes »),
  badge « Équipements : 2 en attente », status (En cours / Clôturé / Annulé).
* **Case screen (a short checklist, not a console):**
  * header: employee, motif, date prévue, statut d'emploi;
  * « Étapes de clôture » — items with Fait / Non applicable + evidence when required;
  * « Équipements à restituer » — live custody list → link « Enregistrer la restitution » (Équipements);
  * « Documents de fin de contrat » — the missing-list, plain sentences;
  * « Accès plateforme » — the handoff panel (§8);
  * « Clôturer le départ » — disabled with the *reason in French* while gates are red
    (« 2 équipements non restitués », « Documents requis manquants », « Le départ n'est
    pas encore enregistré au registre »).

## 14. Invariants the implementation must enforce

* **I-8.1** The case never writes `employee`, custody, contract, document, or `app_user` rows.
* **I-8.2** Completion requires — DB-side, inside the RPC — `TERMINATED` + zero open custody + all blocking items resolved.
* **I-8.3** No HR role holds any `admin:users:*`; the account step is a prompt, never a call.
* **I-8.4** Item labels are snapshots; editing a template never rewrites open cases.
* **I-8.5** One live case per employee (partial unique index).
* **I-8.6** CANCELLED requires a non-blank reason (CHECK); COMPLETED requires `completed_at` (CHECK); DONE requires actor + timestamp (CHECK).
* **I-8.7** No delete path; terminal cases retained forever.
* **I-8.8** Ledger emission is transactional in RPCs / compensated in app writes.
* **I-8.9** Definer RPCs taking `p_actor` = HR630 + `assert_actor_authority` (INV-7).
* **I-8.10** Template `kind` discriminates ONBOARDING/OFFBOARDING; every existing template-consuming site filters its own kind.
* **I-8.11** New tables enter `TENANT_SCOPED_TABLES` (`lib/db/tenant-tables.ts`) + `lib/db/types.ts` with `Relationships: [];` + RLS on `hr:read`/`hr:manage`.
* **I-8.12** Termination behaviour (`transitionEmployee`) is not modified by HR-8.

## 15. Testing / mutation strategy

SQL suite `hr_8_offboarding_test.sql` appended LAST in ci.yml (runs-last pin in
`tests/fin-aging-schema.test.ts` moves): open→complete lifecycle; completion refused with
open custody (then return → allowed); refused with blocking item PENDING; refused while
ACTIVE; cancel-needs-reason; live-case uniqueness; label-snapshot immunity; ledger rows
per act; RLS isolation; EFA08 jwt-clear before RPCs; suite actors hold real grants.
Vitest structural suite: hub tile swap (move the `hr-1-readiness` SoonTile pin — only
« Reporting RH » remains Soon); route census +`departs` (`hr-5a-activation`); completion
guard pinned on the **function slice**; a structural test that no `admin:users` string
enters `lib/hr/` or HR role grants. Mutations (inverse-patch reverts only): (M1) drop
the custody check from the completion RPC; (M2) drop the TERMINATED requirement; (M3)
grant `admin:users:manage` to HR_OFFICER; (M4) remove the cancellation-reason CHECK;
(M5) widen the live-case index to all statuses; (M6) remove ledger compensation — every
one must turn CI red before implementation is called done.

## 16. Ratification questions for Effitrans (tabled, not answered)

| # | Question | Recommended default until answered |
|---|---|---|
| RQ-8.1 | Content of `termination_reasons` (HRQ-D1, still empty) | free-text motif, as today |
| RQ-8.2 | Offboarding checklist content: items, responsible functions, evidence requirements | engine ships empty; no invented list |
| RQ-8.3 | Must account archive BLOCK completion, or remain a prompted advisory? | advisory (DEC-B62 spirit) |
| RQ-8.4 | Must an un-ENDED contract block completion? | advisory |
| RQ-8.5 | Dual control (four-eyes) on « Clôturer le départ »? | none in v1 (single HR_OFFICER) |
| RQ-8.6 | Regularization cases for already-TERMINATED employees (clear past departures)? | recommended yes — the audit found terminated-with-custody is possible today |
| RQ-8.7 | Future-dated / effective-date termination (today the transition stamps *today*)? | out of HR-8 scope; lifecycle unchanged |
| RQ-8.8 | A « quitus Finance » clearance item (advances/loans settled)? | plain template item confirmed by a human; HR never reads Finance rows |

None blocks the foundation: all defaults are the *absence* of invented policy.

## 17. Phased implementation recommendation

* **HR-8A — foundation, dark:** one additive migration (template `kind` +
  `hr_offboarding_case`/`_item` + guards/CHECKs + RPCs with INV-7 + RLS), lib layer,
  SQL suite; hub untouched.
* **HR-8B — workspace:** `/departments/hr/departs` French UI, hub tile activation,
  pins moved, structural/mutation suite complete.
* **HR-8C — closure:** operator UAT (open → equipment-refusal → return → terminate →
  clôture → prompt), completion report.

A/B may land as one commit if small enough; C is always separate. **Classification: GO.**

## 18. HR-10 roadmap registration

**Recorded** (dated addendum in `hr-0f-architecture-freeze.md` §3, after HR-9):
**HR-10 — Guide utilisateur & SOP RH** — in-platform, French, concise, non-technical,
organized around the actual HR workspaces, real production screenshots, numbered
operating instructions, contextual « Aide » entry points from HR workspaces, suitable for
Chargé RH / HR Manager users; a printable/branded PDF may also be produced (Brand Center
ReportLayout is the natural engine). **Not built now**; scheduled after HR-8 and HR-9.
(The pre-freeze note in `hr-erd-roadmap-decisions.md` naming ATS an "HR-10 candidate" is
superseded by the ratified renumbering — ATS remains unscheduled.)
