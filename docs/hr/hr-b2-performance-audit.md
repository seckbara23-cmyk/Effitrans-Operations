# EFFITRANS-HR-B2 — Performance completion audit & ratification gate

**Date:** 2026-08-16 · **Baseline:** `93113c8` (CI #478 GREEN) · **Audit only — nothing modified.**

## The verdict in one paragraph

HR-6 built the performance machine **end-to-end and dark**: six tables, five
triggers, six transactional RPCs, a four-actor lifecycle with structural
separation (HR614/HR616), basis-point weight enforcement at finalization
(HR617), version-supersede objectives, immutability with a single governed
acknowledgment exit (HR604), two-tier C3 reads, a full HR studio, dashboard
counters, one SQL suite and 59 vitest tests. What it deliberately did **not**
build is the same thing HR-5 didn't: **identity**. Every stage action rides
`hr:manage` — HR operators type the self-assessment, the manager review AND the
employee's acknowledgment on people's behalf (the column is honestly named
`self_entered_by` for exactly this reason); `hr_evaluation.manager_employee_id`
is recorded from the open PRIMARY assignment but **never read as
authorization**; `hr:performance:finalize` is granted to NOBODY. HR-B2 is
therefore the HR-B1 pattern replayed on evaluations — two lanes plus
self-service — and it is buildable now, **except one ratification** (Q2:
identity-scoped C3 disclosure) that determines whether the employee and manager
surfaces can show the prose they act on.

---

## 1. Architecture discovered

**Migration 78** (`20260803000001_hr_performance.sql`):

| Piece | State |
|---|---|
| `hr_performance_cycle` | DRAFT→OPEN→IN_REVIEW→FINALIZED (+CANCELLED from any non-terminal), trigger-guarded (HR601–603); per-cycle `weight_total_bp` snapshot; scope ALL_ACTIVE / ORG_UNIT / POSITION |
| `hr_competency`, `hr_competency_expectation` | Catalog + per-position expected levels — **empty by design, never seeded** (a default list would be an opinion about how Effitrans evaluates people) |
| `hr_evaluation` | Four-actor record: self / manager / finalizer / acknowledger; six states; CHECKs forbid one person in two seats (`manager≠self`, `finalizer≠manager` = **HR616**); immutable once FINALIZED with the acknowledgment as the only exit and every assessment column compared explicitly (HR604) |
| `hr_objective` | Integer basis points (0–10000), employee `progress_bp` vs `manager_achievement_bp`, amendment = **new version superseding**, `locked_at` at finalization (HR605), evidence in HR-3's private bucket |
| `hr_competency_assessment` | Self/manager/expected levels validated against the tenant's own scale (HR607). Primitives only — no average, no rating |
| RPCs ×6 | open-cycle (materializes one evaluation per targeted ACTIVE employee **from open PRIMARY assignments**, manager snapshot, ledger events, single txn), self-submit, manager-review, finalize (weight check HR617 + objective locking), acknowledge, assign-objective. Service-role only |
| RLS | Uniform HR idiom: SELECT on `hr:read`, zero write policies (service role is the only writer), no portal policy, SYSTEM_ADMIN sees nothing (DEC-B25) |

**Application:** [performance.ts](../../lib/hr/performance.ts) (reads — C3 columns
**not even requested** without `hr:sensitive:read`), [performance-actions.ts](../../lib/hr/performance-actions.ts)
(12 actions), [scoring.ts](../../lib/hr/performance/scoring.ts) (pure bp
arithmetic + French labels; no score, per HRQ-P3), [performance-studio.tsx](../../components/hr/performance-studio.tsx)
(HR studio: cycles, population, objectives, four-stage progression, « Contenu
réservé (hr:sensitive:read) » withholding), dashboard counters (« Revues à
finaliser », « Objectifs en retard ») on the HR hub.

**Verification:** `supabase/tests/rls_hr_performance_test.sql` (live: RLS/tenant/
portal isolation, HR616 refusal, weight mismatch, immutability, ledger) +
`tests/hr-6-performance-training.test.ts` (59 tests incl. «exactly ONE new
permission, granted to NOBODY» — a designed mutation target for this phase).

**Integration:** none with /conges, Mon Travail or the employee's self-space —
those don't know Performance exists. Administration is where DGA/DAF seats and
role grants are assigned. `linked_app_user_id` is never consulted anywhere in
the performance path.

## 2. Already complete (reuse, do not rebuild)

Cycle lifecycle & population; the four-actor state machine and every structural
invariant; weight enforcement; objective versioning & locking; competency scale
guard; immutability incl. the acknowledgment-only exit; C3 two-tier reads; audit
(`hr.performance.*`, prose never audited) + `hr_employee_event` ledger; the HR
studio; counters; the SQL + vitest coverage of all of the above.

## 3. Partially implemented

* **Authority is entirely proxy-based.** All stage actions gate `hr:manage`;
  `finalizeEvaluation` gates the parked `hr:performance:finalize` (denies all).
* **The manager snapshot is inert.** `manager_employee_id` is populated at
  cycle-open from the open PRIMARY assignment (exactly the HR-B1 relationship —
  no second hierarchy exists or is needed) but no code path compares an actor's
  linked employee against it.
* **`cycle_kind` validation is promised, not implemented.** The migration
  comment says kinds are "validated app-side against hr_configuration" (the
  employment-kind precedent); `createPerformanceCycle` only trims the string.
* **Acknowledgment is HR-typed.** Stage 4 is designed as the employee's own
  receipt, but the action gates `hr:manage` — HR currently acknowledges on the
  employee's behalf, which hollows the stage's meaning.

## 4. Genuinely missing

1. Identity lanes in the RPCs (self, manager, finalizer) + actor-integrity
   checks — the RPCs predate OPS-SEC-2A and take `p_actor` with **no**
   `assert_actor_authority` and no existence/tenant/active verification (INV-7
   applies the moment they are touched; HR-B1's migration 108 is the template).
2. Employee self-service: see own evaluation, submit own self-assessment,
   acknowledge own finalized review.
3. Manager surface: review queue for direct reports' SELF_SUBMITTED
   evaluations, submit the review, assess objectives/competencies.
4. Finalization grants (×3 sources) and, per the ratified answer, the
   manager-scope finalization lane.
5. Business CONTENT: competencies, scales, expected levels, cycle-kind
   vocabulary — configuration surfaces exist and are empty (correctly).

## 5. Security / RLS / authority findings

* **F1 — INV-7 gap (latent, not live):** all six RPCs are service-role-only
  transport whose only guard is the app-side permission; `p_actor` is written
  into ledger events unverified. Not exploitable from a browser (no EXECUTE for
  anon/authenticated — verified in-file), but any new caller inherits the gap.
  HR-B1 hardened the leave RPCs; the performance RPCs are next.
* **F2 — HR616 is real and DB-enforced** twice (CHECK + RPC): the finalizer
  must differ from the reviewing manager. The ratified "Department Managers
  finalize" answer is compatible: a manager may finalize their scope **except
  the reviews they authored** — those need Direction. HR-1A question (b)
  (confirm or repeal) is still formally unanswered.
* **F3 — C3 discipline holds** in reads (columns not requested), UI
  (« réservé »), and audits (prose never logged). `hr:sensitive:read` is granted
  to NOBODY. Consequence: **no employee can read their own finalized review**,
  and **no manager can read their report's self-assessment** — the C3 gate is
  org-wide, identity-blind. Both surfaces HR-B2 must build act on that prose.
* **F4 — no cross-tenant or portal exposure** (SQL suite proves portal sees 0;
  tenant isolation live-tested).
* **F5 — grants state verified:** `hr:performance:finalize` and
  `hr:sensitive:read` have zero `role_permission` rows in every source
  (role-templates, seed, migrations; the HR-A1 suite asserts the pair stays
  parked — a pin that moves when B2 lands, the HR-B1 playbook).

## 6. The lifecycle as actually implemented today

HR (`hr:manage`) creates a cycle → opens it (evaluations materialized from open
PRIMARY assignments, manager snapshotted) → **HR types** the employee's
self-assessment (`self_entered_by` = the HR login) → **a different HR login
types** the manager review (HR614 forces the second login) → **nobody** can
finalize (permission parked) → were it finalized, **HR would also type** the
employee's acknowledgment. A four-actor design currently operated by one
department with two logins — deliberately, pending exactly this phase.

## 7. UX gaps

No employee-facing surface (the /conges precedent exists and works); no manager
queue; the HR studio shows « Contenu réservé » even for one's own record; no
Mon Travail integration (correct — same reasoning as HR-B1: the workbench is
the process engine's surface); dashboard counters exist but only for HR eyes.

## 8. Test / CI gaps

Coverage of the built machinery is strong (both suites). Nothing tests identity
lanes, self-service scoping, manager-queue scoping or finalization grants —
because none exist. The designed mutation targets that will move with B2:
hr-6's «ONE new code granted to NOBODY», HR-A1's parked-pair assertions (vitest
+ SQL — both twins this time), and the rls_hr_performance suite's finalize
calls (which will need the same jwt-claims clearing and grant-aware fixtures
the HR-B1 CI rounds taught).

## 9. Business decisions requiring Effitrans ratification

| # | Question | Blocks |
|---|---|---|
| **Q1a** | Org-wide finalization seats: DGA/DAF are safe (0 members, staffing = the decision); does CEO (6 broad accounts) also hold it? Same boundary as HR-B1 migration 108 asserts for leave. | Nothing — build DAF/DGA now, assert CEO ungranted |
| **Q1b** | HR616 confirm-or-repeal (HR-1A question b): may a manager finalize a review **they themselves wrote**? Current DB says no, twice. | Nothing if confirmed (recommended); a migration if repealed |
| **Q2** | **Identity-scoped C3 disclosure:** may the employee read their OWN evaluation prose once finalized (acknowledgment presupposes reading), and may the recorded manager read their report's self-assessment (reviewing presupposes reading)? Neither is org-wide `hr:sensitive:read`. | The employee/manager surfaces being meaningful. **The one answer needed before B2 ships whole.** |
| **Q3** | Competency catalog, scales, per-position expected levels — content, not code. | Competency assessments having anything to assess (workflow ships without) |
| **Q4** | Cycle-kind vocabulary values (hr_configuration). | Nothing — validation can land with an empty-list-passes rule |
| **Q5** | Aggregate scoring (HRQ-P3). | Nothing — explicitly out of B2 scope |

## 10. Minimal HR-B2 plan

**Can build now (one migration + app, the HR-B1 playbook):**

* **B2-1 — RPC hardening + identity lanes** (migration 109): actor-integrity
  checks (HR530 idiom) in all six RPCs; self lane in `hr_submit_self_assessment`
  and `hr_acknowledge_evaluation` (linked ACTIVE employee = the evaluation's
  employee); manager lane in `hr_submit_manager_review` (linked ACTIVE employee
  = the evaluation's `manager_employee_id` snapshot) with `hr:manage` kept as
  the HR-desk fallback via `assert_actor_authority`; two lanes in
  `hr_finalize_evaluation` (manager-of-record, HR616 preserved, OR
  `assert_actor_authority('hr:performance:finalize')`); self-assertions incl.
  CEO-stays-ungranted.
* **B2-2 — grants ×3 sources:** `hr:performance:finalize` → DAF + DGA only
  (mirrors 108 §1); HR_OFFICER and CEO asserted ungranted.
* **B2-3 — surfaces:** « Mes évaluations » on the /conges pattern (own record,
  self-assessment submit, acknowledgment) + « Évaluations de mon équipe »
  manager queue; prose display wired but **shown only per Q2's answer**
  (withheld-by-default is the safe ship state, though it leaves acknowledgment
  semantically thin until Q2 lands).
* **B2-4 — `cycle_kind` app-side validation** against hr_configuration
  (empty vocabulary = anything allowed, the employment-kind rule).
* **Moves, not breaks:** hr-6 «granted to NOBODY» pin, HR-A1 parked-pair pins
  (vitest AND SQL twins), rls_hr_performance fixtures (clear jwt claims before
  RPC calls — the EFA08 lesson), new SQL scope suite appended LAST in CI.

**Blocked on Effitrans:** Q2 (prose visibility — the only real gate), Q1a (CEO
seat), Q3/Q4 content, staffing DGA/DAF (the org-wide lane is inert until
someone holds those roles — same standing item as HR-B1).

## 11. Recommendation

**HR-B2 is ready for implementation with one caveat.** The machinery, the
manager relationship, the permission scaffolding and the proven two-lane
pattern (HR-B1, CI #475) are all in place; no architectural unknowns remain and
the migration shape is fully determined. Recommended sequence: put **Q2 to
Effitrans as a one-line question now** (expected answer: yes, own-record
disclosure after finalization + manager-of-record disclosure of the
self-assessment), and implement B2-1…B2-4 immediately — with prose withheld
until Q2's answer arrives if it hasn't. Do not seed competencies, scales,
scores or cycle vocabularies under any circumstances; those are Effitrans's
words, not ours.
