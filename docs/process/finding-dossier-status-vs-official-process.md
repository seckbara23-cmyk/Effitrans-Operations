# GOVERNANCE FINDING — dossier lifecycle vs official process, out of step

**Raised:** 2026-09-03, out of UAT-OPS-TRANSIT-00009.
**Status:** OPEN — recorded, deliberately **not** addressed in the diagnostic slice.
**Class:** business / data governance. **Not** a defect in the handoff guard.

## What was seen

`EFT-IMP-2026-00009` shows dossier status **DELIVERED / « Livré »** while its
official process stands at **1/26 steps** — step 1 `cotation` SKIPPED, step 2
`operations_intake` still open, nothing handed to Transit, and its transport
record `NOT_STARTED`.

## Why this is not a state-machine bug

The two are ratified as **different objects**:

* `operational_file.status` — the legacy dossier lifecycle, moved by
  `transitionFile` under its own permission and audit;
* `process_instance` + `process_step_execution` — the official 26-step process.

The engine never writes `operational_file.status` except at one seam
(`openDossierWorkflow`, `DRAFT → OPENED`). Nothing reconciles the two, by design.
`handDossierToTransit` does not read the dossier status at all, so **DELIVERED
blocks nothing and caused nothing** — verified in the UAT-00009 audit.

## Recorded history (read-only, 2026-09-01)

```
2026-08-27 17:12  DRAFT       → OPENED       operations4@effitrans.com
2026-09-01 12:44  OPENED      → IN_PROGRESS  operations4@effitrans.com
2026-09-01 16:30  IN_PROGRESS → DELIVERED    seckbara23@gmail.com
```

Operator-driven. No module advanced it; no reconciliation ran.

## The question for the business, not for the code

A dossier marked *delivered* that has never been transmitted to Transit is
operationally implausible, and the platform currently permits it silently. Three
options, none of them taken here:

1. **Leave the planes independent** (status quo) — the lifecycle is a commercial
   convenience, the official process is the record of work. Then the dossier
   page should say so, so nobody reads « Livré » as *the work is done*.
2. **Constrain the lifecycle by the process** — refuse terminal statuses while
   the official process is early. This is a real behavioural change and would
   need its own ratification: it can strand dossiers whose status was set by
   hand for legitimate commercial reasons.
3. **Reconcile on open** — when the official process is initialised on a dossier
   that already carries a late lifecycle status, record the divergence explicitly
   rather than letting the two drift unremarked.

## Related, and also open

`EFT-IMP-2026-00003` (step 2 PENDING, step 3 COMPLETED) and `EFT-IMP-2026-00004`
(step 2 ACTIVE, step 3 COMPLETED) hold an **out-of-order completion** that
`submitStep` cannot produce — `canTransitionStep` forbids it. Some other path
reached those rows. That bears on whether ladder ordering is enforced everywhere
it is claimed to be, and it needs its own audit.

## What must not happen

Neither item is a reason to weaken the Operations → Transit guard, the document
verification rule, or the meaning of any document type. The UAT-00009 slice
changed **diagnostics only**.
