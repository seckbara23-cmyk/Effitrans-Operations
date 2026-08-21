# INV-PERF-1 — Parameter Versioning Invariant (architectural, non-negotiable)

**Status:** architectural invariant of any ICTD/ICAM/IPAM implementation.
**Not a business question.** It is deliberately excluded from the Effitrans
decision packet: reproducibility of history is not optional and no answer from the
business could make it so.

## The invariant

> **A historical performance period must remain exactly reproducible after any
> change to coefficients, caps, weights, thresholds, lists, calendars or formulas.**
> Recomputing a closed period under new parameters is a new calculation with a new
> provenance — never a silent replacement.

Formally: every published indicator value is a pure function of
**(source facts, parameter-set version, formula version, period)** — all four
persisted, none implicit.

## Why it must be an invariant

1. **The methodology requires it.** §17.2: every parameter evolution carries a
   justification, an effect date, a validation, an identifiable version, and
   **non-retroactive application** except formally authorized correction. §15
   closes the door explicitly: parameters must never be changed to correct an
   individual result.
2. **Excel structurally violates it.** The canonical workbooks resolve
   coefficients at calculation time (`VLOOKUP` into PARAMETRES, named ranges): edit
   `UF` from 0,50 to 0,60 and every past month silently reprices. The workbook
   only survives because months are closed by convention. A platform that mimicked
   the live-lookup behaviour would industrialize the violation.
3. **The scores govern people.** A déclarant's or Account Manager's published
   month must mean the same thing when re-opened during a contestation (§16.12), a
   calibration back-test (§18 M3), or an audit — years later.

## What it binds (a checklist for the future design, not the design itself)

* Parameter sets (all PARAMETRES values, the CDP/CCT/DPI tables, ICAM
  coefficients/caps, FP/score/IPAM weights, thresholds 10/80 %/±5, score bands) are
  **versioned as one immutable document**, with effect dates; periods pin the
  version they were computed under.
* The **holiday calendar** (Décision 3) and the **vocabulary lists** (types,
  DPI states, causes, imputabilité) version identically — they are parameters.
* **Formula changes** version like parameter changes (the workbook's own precedent:
  the rounding order is part of the result; the platform's precedent:
  `RENDERER_VERSION` on generated artifacts).
* Published period results are **snapshots carrying their provenance**
  (facts hash, parameter version, formula version) — the proven platform patterns
  apply: workflow-policy pinning per process instance, payroll's copied snapshot,
  the artifact reproduction contract (source_snapshot, renderer_version, version,
  generated_at).
* An authorized retroactive correction **creates a new version of the period
  result** with actor, justification and date — the prior publication remains
  readable. No overwrite.
* During the pilot, calibration runs (§18 M3 back-tests) execute under candidate
  parameter versions **labelled as candidates** — never by mutating the live set.

## Out of scope here

The implementation design (tables, APIs, storage) is Phase 1+ work and is not
proposed in this document, per the standing instruction that no roadmap precedes
frozen parity and the business decisions in `effitrans-decision-packet.md`.
