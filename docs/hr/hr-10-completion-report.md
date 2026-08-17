# EFFITRANS-HR-10 — Guide utilisateur & SOP RH: completion report & UAT closure

**Date:** 2026-08-17 · **Audit:** `11ba23e` (CI #498) · **Implementation:** `4c65a92`
(CI #499) · **Blocker fix UAT-HR10-01:** `b4a570e` (CI #500) · **Record:** `a524139`
(CI #501) · **HR-10D closure:** this document.
**No migration** — HR-10 added no database object, no permission and no HR capability.

## Closure status

# **HR-10: COMPLETE / PRODUCTION-VALIDATED.**

The operator exercised the guide in production as Chargé RH after the UAT-HR10-01 fix.
Every performed step passed, and the evidence is internally consistent with the shipped
content model: the guide reports **5 unavailable activities out of 14 sections**, which is
exactly what the model declares for the current authority census — `documents-contrats`
and `imports` (both need a second Chargé RH), `conges` (Direction seat), `performance`
(finalisation seat) and `paie` (approval seat). Nine sections render as available. The
operator did not read that arithmetic from anywhere; the page computed it.

## Production UAT evidence (operator-observed, recorded verbatim)

> **Step 1 PASS** after UAT-HR10-01 fix: Guide RH renders successfully in production with
> the 14-section summary and live readiness banner.
>
> **Readiness evidence PASS:** the guide identifies 5 activities currently unavailable
> because required authority holders are absent; these are presented as operational
> staffing gaps, not software defects.
>
> **Contextual-help PASS:** « Aide — mode opératoire » from Départs lands directly on the
> Départs section; the same test from Congés & présence lands directly on its corresponding
> section with its amber readiness explanation.
>
> **Fidelity spot-check PASS 3/3** against production UI: « Nouveau départ », « Nouvel
> employé », and « Exporter (CSV) » match the guide.
>
> **Boundary check PASS:** « Ce que la plateforme ne fait pas » explicitly states that the
> platform does not calculate payroll, does not terminate contracts automatically, and does
> not deactivate login accounts automatically. It also preserves the four-eyes and
> non-deletion boundaries.
>
> **Step 7** was optional and was not performed because no second Chargé RH has been
> designated. We will not alter production staffing/permissions solely for UAT.

## Step 7 — why its absence does not withhold the verdict

Step 7 would have designated a second Chargé RH and watched the affected sections flip to
« Disponible aujourd'hui ». Declining to change production staffing for a test is the right
call, and the claim it would have tested is already proven — by the session itself:

* **Both branches of the readiness predicate executed live.** Nine sections rendered
  available and five rendered unavailable, in one page load, from real counts. The
  predicate is a single comparison (`holders < minHolders`); nothing about it is
  direction-specific.
* **The counts were correct.** Five blocked sections is exactly what the content model
  declares for a tenant with one `hr:manage` holder and no Direction, finalisation or
  payroll-approval seats — the census the audit recorded independently.
* **There is no cache to go stale.** The route is `force-dynamic`; each render recomputes
  the census, so a newly designated holder is reflected on the next page load. No
  invalidation step exists that could fail.
* **A mutation proves the counting is load-bearing:** replacing the comparison with a
  constant turns the suite red (V2), as does counting suspended accounts as holders (V3).

Step 7 therefore remains a *nice-to-have observation of a transition*, not an unproven
acceptance criterion. It can be observed for free the day Effitrans designates the second
Chargé RH — which the operational readiness item recommends for its own reasons.

## UAT-HR10-01 — the blocker, and what it cost

Recorded in full in `hr-10-guide-sop-audit.md`. In summary: the guide crashed into the
error boundary on its first production render because its view-audit passed the business
key `"sop"` as `entityId`, and `audit_log.entity_id` is a uuid column whose validator
refuses a non-UUID by design. A page that documents workspaces has no row, so it must pass
no `entityId` at all; the key belongs in `after`, exactly as the validator's message says.

Two things are worth keeping from it. **The same defect existed at `/brand-center/guides`**
(`entityId: "install"`) and would have crashed identically for any admin — found during the
investigation and fixed with it. And **the regression is written against the class, not the
instance**: the real validator is executed on both shapes, and a scan of `app/`, `lib/` and
`components/` refuses any literal non-UUID `entityId` anywhere, so neither occurrence can
return.

Nothing else in HR was affected: the production log for the same window shows every other
HR workspace serving normally, and only `/departments/hr/guide` produced an error group.

## What HR-10 delivered

* `/departments/hr/guide` — 14 sections, French, gated on `hr:read`, audited on view. Each
  section answers the same questions in the same order: **qui**, **quand**, **étapes
  numérotées**, **pièces nécessaires**, **ce que la plateforme fait toute seule**, **ce qui
  se fait ailleurs**, **à définir par Effitrans**.
* **Availability is counted, never written.** Each section declares the authority its
  workflow needs and how many *distinct* people must hold it — two, where a maker-checker
  control demands a second pair of eyes. The page counts live holders and states the reason
  when a workflow cannot run. The guide corrects itself as seats are filled.
* **Contextual « Aide — mode opératoire »** on all twelve documented workspaces, resolving
  its own anchor from the route, plus a Guide RH tile on the hub.
* Labels are **quoted** from the shipped screens and pinned by test, so a future rename
  breaks CI rather than silently making the guide wrong.

Held to scope, as ratified: **no screenshots** (RQ-10.1), **no PDF** (RQ-10.4), one route
gated on `hr:read` with no employee self-service (RQ-10.3), and **no feature, permission or
migration**. The four empty vocabularies are explained and marked « à définir par
Effitrans »; a mutation that invents departure motives turns the suite red.

Verification: 21 tests, mutations V1–V7 plus the UAT-HR10-01 reproduction all caught, full
vitest 6759 passed / 1 skipped, typecheck clean, build compiled, CI #500 and #501 green.

## Carried forward — an Effitrans operational item, not a software defect

`docs/hr/hr-operational-readiness.md` records the staffing and content gap in full. The
headline: **one `hr:manage` holder** means all three four-eyes controls — contract
verification, import approval, payroll adjustment decisions — cannot complete; and four
authorities have **no holder at all**. Designating a **second Chargé RH** is the single
highest-value action available: it unblocks the import batch `HR-IMP-MST7EF6P`, which
populates the registry that every workspace and the reporting describe. Today the registry
holds three employees, none active.

Also open, unchanged: RQ-8.1 (motifs de départ), RQ-8.2 (contenu des check-lists), HR-7
Q1/Q4–Q10, RQ-9.3 (méthode du taux de rotation), and the competency catalogue.

## HR foundation — closed

HR-1 through HR-10 are complete. HR-8, HR-9 and HR-10 are production-validated; the
earlier phases were validated in their own closures. The platform's HR module is built,
documented in the product, and honest about what it does not do and what it cannot yet do.

**Next: HOLD.** The next product workstream is **TMS**, which starts from its own ratified
lightweight roadmap and requires an explicit GO. No further HR feature phase begins.
